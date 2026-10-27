import { ConvexError } from "convex/values";
import { httpAction, env, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { secureUrl, shortWorker } from "./lib/signingWorker";
import { PREPARATION_MESSAGES } from "./lib/signingPreparation";
import { completedDownload } from "./signingFinalisation";
import { maskedEmail } from "./lib/signingInvitations";
import { accessKeys, makeEmail } from "./signingEmailPayloads";
import {
  constantEqual,
  credentialHash,
  keyedHash,
  otpCode,
  secretToken,
  sessionCredential,
  TOKEN_PATTERN,
} from "./lib/signingAccessCrypto";

export async function boundedBody(request: Request, max = 4096) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) throw new Error("Body too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let index = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, index);
    index += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
const SESSION_OPERATIONS = new Set([
  "portal",
  "document",
  "final_document",
  "consent",
  "save_draft",
  "adopt_mark",
  "submit",
  "decline",
  "request_correction",
  "attachment_form",
  "attachment_complete",
]);
const RETRYABLE_SCAN_MESSAGES = new Set(
  (
    [
      "not_configured",
      "transfer_failed",
      "scanner_unavailable",
      "storage_failed",
      "preparation_failed",
      "result_invalid",
    ] as const
  ).map((code) => PREPARATION_MESSAGES[code]),
);
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length <= max ? value : "";
/** Signer-session operations. Raw credentials stay in this action; internal functions receive hashes. */
async function portalOperation(
  ctx: ActionCtx,
  operation: string,
  sessionHash: string,
  body: Record<string, unknown>,
  reply: (value: unknown, status?: number) => Response,
) {
  try {
    if (operation === "portal")
      return reply(
        await ctx.runQuery(internal.signerPortal.context, { sessionHash }),
      );
    if (operation === "final_document") {
      const completion = await ctx.runQuery(
        internal.signerPortal.finalDocumentContext,
        { sessionHash },
      );
      if (!completion)
        return reply(
          { ok: false, error: "The signed agreement is not available" },
          400,
        );
      // The private link goes only to the first-party portal server, which verifies the bytes.
      return reply({ ok: true, ...(await completedDownload(completion)) });
    }
    if (operation === "document") {
      const bundle = await ctx.runQuery(internal.signerPortal.documentContext, {
        sessionHash,
      });
      if (!bundle)
        return reply({ ok: false, error: "The agreement is unavailable" }, 400);
      const result = await shortWorker(
        "download",
        bundle.tenantId,
        bundle.agreementId,
        {
          attemptId: bundle.attemptId,
          manifestVersion: bundle.manifestVersion,
          manifestHash: bundle.manifestHash,
          storageVersion: bundle.storageVersion,
          pdfHash: bundle.pdfHash,
        },
      );
      if (
        result.status !== "download" ||
        typeof result.expiresAt !== "number" ||
        result.expiresAt <= Date.now() ||
        result.expiresAt > Date.now() + 65_000
      )
        throw new Error("Prepared file link invalid");
      // The URL goes only to the first-party portal server, which verifies and streams the bytes.
      return reply({
        ok: true,
        url: secureUrl(result.url),
        pdfHash: bundle.pdfHash,
      });
    }
    if (operation === "attachment_form") {
      const reserved = await ctx.runMutation(
        internal.signerPortal.reserveAttachment,
        {
          sessionHash,
          fieldKey: text(body.fieldKey, 64),
          filename: text(body.filename, 255),
          contentType: text(body.contentType, 40),
          sizeBytes: Number(body.sizeBytes),
        },
      );
      const form = await shortWorker(
        "attachment_upload",
        reserved.tenantId,
        reserved.agreementId,
        {
          attachmentId: reserved.attachmentId,
          contentType: reserved.contentType,
          sizeBytes: reserved.sizeBytes,
        },
      );
      const fields = form.fields as Record<string, string> | undefined;
      if (
        form.status !== "upload" ||
        !fields ||
        fields.key !==
          `attachments-quarantine/${reserved.tenantId}/${reserved.agreementId}/${reserved.attachmentId}` ||
        fields["Content-Type"] !== reserved.contentType
      )
        throw new Error("Upload form identity mismatch");
      return reply({
        ok: true,
        attachmentId: reserved.attachmentId,
        url: secureUrl(form.url),
        fields,
      });
    }
    if (operation === "attachment_complete") {
      const row = await ctx.runQuery(internal.signerPortal.attachmentContext, {
        sessionHash,
        attachmentId: text(body.attachmentId, 64),
      });
      if (!row) return reply({ ok: false, error: "Upload not found" }, 400);
      let scanned: Record<string, unknown>;
      try {
        scanned = await shortWorker(
          "attachment_scan",
          row.tenantId,
          row.agreementId,
          {
            attachmentId: row._id,
            contentType: row.contentType,
            sizeBytes: row.sizeBytes,
          },
        );
      } catch (error) {
        const message =
          error instanceof ConvexError && typeof error.data === "string"
            ? error.data
            : "The document could not be verified";
        // Service outages stay pending so the participant can retry; content failures are final.
        if (RETRYABLE_SCAN_MESSAGES.has(message))
          return reply({ ok: false, error: message }, 503);
        const rejected = await ctx.runMutation(
          internal.signerPortal.finishAttachment,
          {
            sessionHash,
            attachmentId: row._id,
            result: { status: "rejected", error: message.slice(0, 200) },
          },
        );
        return reply(rejected, 409);
      }
      if (
        scanned.status !== "clean" ||
        typeof scanned.sha256 !== "string" ||
        typeof scanned.storageVersion !== "string" ||
        typeof scanned.retainUntil !== "number" ||
        typeof scanned.scanEngine !== "string" ||
        typeof scanned.scanVersion !== "string" ||
        typeof scanned.scannedAt !== "number"
      )
        throw new Error("Attachment scan result invalid");
      const finished = await ctx.runMutation(
        internal.signerPortal.finishAttachment,
        {
          sessionHash,
          attachmentId: row._id,
          result: {
            status: "clean",
            sha256: scanned.sha256,
            storageVersion: scanned.storageVersion,
            retainUntil: scanned.retainUntil,
            scanEngine: scanned.scanEngine,
            scanVersion: scanned.scanVersion,
            scannedAt: scanned.scannedAt,
          },
        },
      );
      return reply(finished, finished.ok ? 200 : 409);
    }
    if (
      operation === "adopt_mark" &&
      !(await ctx.runQuery(internal.signerPortal.sessionActive, {
        sessionHash,
      }))
    )
      return reply(
        {
          ok: false,
          error:
            "This signing session is no longer active. Reopen your invitation to continue",
        },
        400,
      );
    const requestKey = text(body.requestKey, 64);
    const markKind = body.kind === "initials" ? "initials" : "signature";
    const result =
      operation === "consent"
        ? await ctx.runMutation(internal.signerPortal.consent, {
            sessionHash,
            consentHash: text(body.consentHash, 64),
          })
        : operation === "save_draft"
          ? await ctx.runMutation(internal.signerPortal.saveDraft, {
              sessionHash,
              expectedRevision: Number(body.expectedRevision),
              values: body.values ?? null,
            })
          : operation === "adopt_mark"
            ? await ctx.runMutation(internal.signerPortal.adoptMark, {
                sessionHash,
                kind: markKind,
                method:
                  body.method === "typed" || body.method === "uploaded"
                    ? body.method
                    : "drawn",
                image: await ctx
                  .runAction(internal.signerMarks.sanitize, {
                    image: text(body.image, 120_000),
                    kind: markKind,
                  })
                  .then(({ png, width, height }) => ({ png, width, height })),
                ...(typeof body.typedText === "string"
                  ? { typedText: text(body.typedText, 200) }
                  : {}),
              })
            : operation === "submit"
              ? await ctx.runMutation(internal.signerPortal.submit, {
                  sessionHash,
                  requestKey,
                  expectedDraftRevision: Number(body.expectedDraftRevision),
                  preparationHash: text(body.preparationHash, 64),
                  pdfHash: text(body.pdfHash, 64),
                  consentHash: text(body.consentHash, 64),
                })
              : await ctx.runMutation(
                  operation === "decline"
                    ? internal.signerPortal.decline
                    : internal.signerPortal.requestCorrection,
                  { sessionHash, requestKey, reason: text(body.reason, 1000) },
                );
    return reply(result, result.ok ? 200 : 409);
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === "string")
      return reply({ ok: false, error: error.data }, 400);
    throw error;
  }
}
type ChallengeContext = {
  challenge: Doc<"signingAccessChallenges">;
  invite: Doc<"signingInvitations">;
  tx: Doc<"signingTransactions">;
  party: { key: string; email: string };
};
export const handle = httpAction(async (ctx, request) => {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  const reply = (value: unknown, status = 200) =>
    Response.json(value, { status, headers });
  const secret = env.SIGNING_PORTAL_SERVICE_TOKEN;
  if (!secret || secret.length < 32)
    return reply({ ok: false, error: "Signing access is not configured" }, 503);
  if (
    !constantEqual(
      request.headers.get("authorization") ?? "",
      `Bearer ${secret}`,
    )
  )
    return reply({ ok: false, error: "Unauthorized" }, 401);
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return reply({ ok: false, error: "Invalid request" }, 400);
    const body = JSON.parse(await boundedBody(request, 160_000)) as Record<
      string,
      unknown
    >;
    const ring = accessKeys();
    const network =
      typeof body.network === "string" && body.network.length < 200
        ? body.network
        : "unattributed";
    const networkKey = await keyedHash(
      ring.keys[ring.active],
      "network-v1",
      network,
    );
    const operation = body.operation,
      credential =
        typeof body.credential === "string" && body.credential.length <= 100
          ? body.credential
          : "";
    if (operation === "exchange") {
      const raw = secretToken(),
        result = await ctx.runMutation(internal.signingAccessState.exchange, {
          invitationHash: await credentialHash(
            "invitation",
            TOKEN_PATTERN.test(credential) ? credential : "invalid",
          ),
          challengeHash: await credentialHash("challenge", raw),
          keyId: ring.active,
          networkKey,
        });
      return result.ok
        ? reply({ ...result, challengeCredential: raw })
        : reply(result, 400);
    }
    if (operation === "kiosk_exchange") {
      const raw = secretToken(),
        result = await ctx.runMutation(
          internal.signingAccessState.kioskExchange,
          {
            kioskHash: await credentialHash(
              "in_person",
              TOKEN_PATTERN.test(credential) ? credential : "invalid",
            ),
            challengeHash: await credentialHash("challenge", raw),
            keyId: ring.active,
            networkKey,
          },
        );
      return result.ok
        ? reply({ ...result, challengeCredential: raw })
        : reply(result, 400);
    }
    if (operation === "session")
      return reply(
        await ctx.runQuery(internal.signingAccessState.session, {
          sessionHash: await credentialHash("session", credential),
        }),
      );
    if (operation === "challenge") {
      const info: ChallengeContext | null = await ctx.runQuery(
        internal.signingAccessState.challenge,
        { challengeHash: await credentialHash("challenge", credential) },
      );
      return reply(
        info
          ? {
              ok: true,
              challengeReady: true,
              expiresAt: info.challenge.expiresAt,
              recipient: maskedEmail(info.party.email),
            }
          : { ok: false },
      );
    }
    if (operation === "logout")
      return reply(
        await ctx.runMutation(internal.signingAccessState.logout, {
          sessionHash: await credentialHash("session", credential),
        }),
      );
    if (typeof operation === "string" && SESSION_OPERATIONS.has(operation))
      return await portalOperation(
        ctx,
        operation,
        await credentialHash("session", credential),
        body,
        reply,
      );
    if (operation !== "request_code" && operation !== "verify_code")
      return reply({ ok: false, error: "Invalid operation" }, 400);
    if (
      !(await ctx.runMutation(internal.signingAccessState.accessRate, {
        networkKey,
        operation,
      }))
    )
      return reply(
        { ok: false, error: "Please wait before trying verification again" },
        429,
      );
    const challengeHash = await credentialHash("challenge", credential);
    const info: ChallengeContext | null = await ctx.runQuery(
      internal.signingAccessState.challenge,
      { challengeHash },
    );
    if (!info)
      return reply(
        {
          ok: false,
          error:
            "Verification expired or access was revoked. Open the invitation again",
        },
        400,
      );
    if (operation === "request_code") {
      const code = otpCode(),
        generation = info.challenge.generation + 1;
      const codeHash = await keyedHash(
        ring.keys[info.challenge.keyId],
        "otp-v1",
        `${info.challenge._id}:${generation}:${code}`,
      );
      const mail = await makeEmail({
        kind: "otp",
        participantKey: info.party.key,
        version: info.invite.version,
        recipient: info.party.email,
        companyName: info.tx.companyName,
        title: info.tx.title,
        expiresAt: info.challenge.expiresAt,
        code,
      });
      const result = await ctx.runMutation(
        internal.signingAccessState.requestCode,
        {
          challengeHash,
          generation: info.challenge.generation,
          codeHash,
          mail,
          networkKey,
        },
      );
      return reply(result, result.ok ? 200 : 400);
    }
    const submitted =
      typeof body.code === "string" && body.code.length <= 64
        ? body.code
        : "invalid";
    const submittedHash = await keyedHash(
      ring.keys[info.challenge.keyId],
      "otp-v1",
      `${info.challenge._id}:${info.challenge.generation}:${submitted}`,
    );
    const raw = await sessionCredential(
      ring.keys[info.challenge.keyId],
      info.challenge._id,
      info.challenge.generation,
      info.challenge.tokenHash,
    );
    const result = await ctx.runMutation(
      internal.signingAccessState.verifyCode,
      {
        challengeHash,
        generation: info.challenge.generation,
        submittedHash,
        sessionHash: await credentialHash("session", raw),
        networkKey,
      },
    );
    return result.ok
      ? reply({ ...result, sessionCredential: raw })
      : reply(result, 400);
  } catch {
    return reply(
      {
        ok: false,
        error:
          "Signing verification is temporarily unavailable. Please try again or contact the company",
      },
      503,
    );
  }
});
