import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  consumeRate,
  insertDelivery,
  parseFrozen,
  validInvitation,
  type FrozenParty,
  type MailDraft,
} from "./lib/signingInvitations";
import {
  assertSigningTransition,
  boundedText,
  signingHash,
} from "./lib/signing";
import { appendSigningEvent } from "./lib/signingAudit";
import {
  acceptedValues,
  checkDraftValues,
  consentHash,
  editableFields,
  ownFields,
  parseDraftValues,
  PLATFORM_CONSENT_TEXT,
  PLATFORM_CONSENT_VERSION,
  sanitizePng,
  signerMarkKind,
  signerMarkMethod,
  ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  type AttachmentContentType,
  type FrozenSigning,
  type MarkKind,
  type ReferenceKind,
  type SignerIntent,
} from "./lib/signerPortal";
import { makeEmail, regenerateInvitation } from "./signingEmailPayloads";
import { sha256Text } from "./lib/signingAccessCrypto";
import { releaseBlockers } from "./lib/signingRelease";
import { raiseAlert, resolveAlert } from "./lib/signingAlerts";

const REQUEST_KEY = /^[A-Za-z0-9-]{16,64}$/;
const ACTORS = new Set(["signer", "approver"]);
type Mode = "active" | "completed" | "paused" | "closed";

/**
 * Resolves a verified signer session. Only `active` permits entries and outcomes; the other
 * modes are read-only so a participant can see what was recorded or why signing stopped.
 */
async function signerAccess(ctx: QueryCtx | MutationCtx, sessionHash: string) {
  const session = await ctx.db
    .query("signingSignerSessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", sessionHash))
    .unique();
  if (
    !session ||
    session.revokedAt !== undefined ||
    session.expiresAt <= Date.now()
  )
    return null;
  const invite = await ctx.db.get(session.invitationId);
  if (
    !invite ||
    invite.status === "revoked" ||
    invite.version !== session.invitationVersion ||
    invite.participantKey !== session.participantKey
  )
    return null;
  const live = await validInvitation(ctx, invite);
  const tx = live?.tx ?? (await ctx.db.get(invite.transactionId));
  const agreement =
    live?.agreement ?? (tx ? await ctx.db.get(tx.agreementId) : null);
  const frozen =
    live?.frozen ?? (tx ? await ctx.db.get(tx.frozenPreparationId) : null);
  const tenant = tx ? await ctx.db.get(tx.tenantId) : null;
  if (
    !tx ||
    !agreement ||
    !frozen ||
    !tenant ||
    tenant.status !== "active" ||
    tx._id !== session.transactionId ||
    tx.preparationHash !== session.preparationHash ||
    agreement.signingTransactionId !== tx._id ||
    frozen._id !== tx.frozenPreparationId ||
    frozen.preparationHash !== tx.preparationHash ||
    (!live &&
      (await signingHash(JSON.parse(frozen.snapshot))) !== tx.preparationHash)
  )
    return null;
  const snapshot = JSON.parse(frozen.snapshot) as FrozenSigning;
  const party = parseFrozen(frozen).participants.find(
    (p) => p.key === invite.participantKey,
  );
  if (!party || party.responsibility === "copy") return null;
  const submission = await latestOutcome(ctx, invite);
  const mode: Mode = live
    ? "active"
    : invite.status === "completed" && submission
      ? "completed"
      : tx.status === "paused" && invite.status === "active"
        ? "paused"
        : "closed";
  return {
    mode,
    session,
    invite,
    tx,
    agreement,
    frozen,
    snapshot,
    party,
    submission,
  };
}
type Access = NonNullable<Awaited<ReturnType<typeof signerAccess>>>;

async function latestOutcome(
  ctx: QueryCtx | MutationCtx,
  invite: Doc<"signingInvitations">,
) {
  const rows = await ctx.db
    .query("signingSubmissions")
    .withIndex("by_invitationId", (q) => q.eq("invitationId", invite._id))
    .order("desc")
    .take(20);
  return (
    rows.find(
      (row) =>
        row.invitationVersion === invite.version &&
        row.intent !== "correction_request",
    ) ?? null
  );
}
async function currentDraft(
  ctx: QueryCtx | MutationCtx,
  invite: Doc<"signingInvitations">,
) {
  return ctx.db
    .query("signingDrafts")
    .withIndex("by_invitationId_and_invitationVersion", (q) =>
      q.eq("invitationId", invite._id).eq("invitationVersion", invite.version),
    )
    .unique();
}
async function currentConsent(
  ctx: QueryCtx | MutationCtx,
  invite: Doc<"signingInvitations">,
) {
  return ctx.db
    .query("signingConsents")
    .withIndex("by_invitationId_and_invitationVersion", (q) =>
      q.eq("invitationId", invite._id).eq("invitationVersion", invite.version),
    )
    .unique();
}
async function markKinds(
  ctx: QueryCtx | MutationCtx,
  invite: Doc<"signingInvitations">,
  hashes: string[],
) {
  const kinds = new Map<string, ReferenceKind>();
  for (const hash of new Set(hashes).values()) {
    const mark = await ctx.db
      .query("signingMarks")
      .withIndex("by_invitationId_and_imageHash", (q) =>
        q.eq("invitationId", invite._id).eq("imageHash", hash),
      )
      .first();
    if (mark && mark.invitationVersion === invite.version)
      kinds.set(hash, mark.kind);
    const attachment = await ctx.db
      .query("signingAttachments")
      .withIndex("by_invitationId_and_sha256", (q) =>
        q.eq("invitationId", invite._id).eq("sha256", hash),
      )
      .first();
    if (
      attachment?.status === "clean" &&
      attachment.invitationVersion === invite.version
    )
      kinds.set(hash, "attachment");
  }
  return kinds;
}
/** Only signature/initials entries reference adopted marks; at most one distinct value per kind is accepted. */
function markValues(fields: { key: string; type: string }[], values: unknown) {
  if (!values || typeof values !== "object") return [];
  const record = values as Record<string, unknown>;
  return [
    ...new Set(
      fields.flatMap((f) =>
        (f.type === "signature" ||
          f.type === "initials" ||
          f.type === "attachment") &&
        typeof record[f.key] === "string" &&
        record[f.key]
          ? [record[f.key] as string]
          : [],
      ),
    ),
  ].slice(0, 24);
}
function receipt(row: Doc<"signingSubmissions">) {
  return {
    intent: row.intent,
    acceptedAt: row.acceptedAt,
    submissionHash: row.submissionHash,
    preparationHash: row.preparationHash,
  };
}
function participantView(party: FrozenParty) {
  return {
    name: party.name,
    role: party.role,
    responsibility: party.responsibility,
    stage: party.stage,
  };
}

export const context = internalQuery({
  args: { sessionHash: v.string() },
  handler: async (ctx, args) => {
    const access = await signerAccess(ctx, args.sessionHash);
    if (!access) return { ok: false as const };
    const { invite, tx, snapshot, party } = access;
    const invites = await ctx.db
      .query("signingInvitations")
      .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
      .take(21);
    const actors = parseFrozen(access.frozen).participants.filter((p) =>
      ACTORS.has(p.responsibility),
    );
    const done = new Set(
      invites
        .filter((i) => i.status === "completed")
        .map((i) => i.participantKey),
    );
    const draft = await currentDraft(ctx, invite);
    const values = draft ? parseDraftValues(draft.values) : {};
    const consent = await currentConsent(ctx, invite);
    const expectedConsent = await consentHash(snapshot);
    const latest = await Promise.all(
      (["signature", "initials"] as const).map((kind) =>
        ctx.db
          .query("signingMarks")
          .withIndex("by_invitationId_and_kind", (q) =>
            q.eq("invitationId", invite._id).eq("kind", kind),
          )
          .order("desc")
          .first(),
      ),
    );
    const marks = new Map<string, Doc<"signingMarks">>();
    for (const mark of latest)
      if (mark && mark.invitationVersion === invite.version)
        marks.set(mark.imageHash, mark);
    const markFields = new Set(
      ownFields(snapshot, party.key)
        .filter((f) => f.type === "signature" || f.type === "initials")
        .map((f) => f.key),
    );
    for (const [key, hash] of Object.entries(values)) {
      if (!markFields.has(key) || marks.has(hash)) continue;
      const mark = await ctx.db
        .query("signingMarks")
        .withIndex("by_invitationId_and_imageHash", (q) =>
          q.eq("invitationId", invite._id).eq("imageHash", hash),
        )
        .first();
      if (mark && mark.invitationVersion === invite.version)
        marks.set(hash, mark);
    }
    const editable = new Set(
      editableFields(snapshot, party.key).map((f) => f.key),
    );
    const completion = await sealedCopy(ctx, access);
    const roleOf = new Map(
      parseFrozen(access.frozen).participants.map((p) => [p.key, p.role]),
    );
    return {
      ok: true as const,
      portal: {
        mode: access.mode,
        sessionExpiresAt: access.session.expiresAt,
        company: {
          name: tx.companyName,
          contact: snapshot.policy?.signerContact ?? null,
        },
        agreement: {
          title: tx.title,
          reference: tx.reference,
          expiresAt: tx.expiresAt,
          currentStage: tx.currentStage,
          paused: tx.status === "paused",
        },
        participant: participantView(party),
        progress: {
          completed: actors.filter((p) => done.has(p.key)).length,
          total: actors.length,
        },
        document: {
          available: Boolean(snapshot.pdfHash && snapshot.bundleId),
          pdfHash: snapshot.pdfHash ?? null,
          preparationHash: tx.preparationHash,
          pages: (snapshot.pages ?? []).map((page) => ({
            pageIndex: page.pageIndex,
            cropBox: page.cropBox,
            rotation: page.rotation,
            userUnit: page.userUnit,
            widthPt: page.widthPt,
            heightPt: page.heightPt,
          })),
        },
        // Own fields are interactive; other participants' fields only show locked approved values.
        fields: (snapshot.fields ?? [])
          .filter(
            (field) => field.participantKey === party.key || field.readOnly,
          )
          .map((field) => ({
            key: field.key,
            type: field.type,
            label: field.label,
            pageIndex: field.pageIndex,
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height,
            required: field.required,
            own: field.participantKey === party.key,
            editable:
              field.participantKey === party.key && editable.has(field.key),
            ownerRole:
              field.participantKey === party.key
                ? null
                : (roleOf.get(field.participantKey) ?? null),
            value:
              field.type === "full_name" && field.readOnly
                ? field.participantKey === party.key
                  ? party.name
                  : null
                : field.readOnly
                  ? (field.fixedValue ?? null)
                  : null,
            minLength: field.minLength,
            maxLength: field.maxLength,
            options: field.options,
            showIf: field.showIf,
            min: field.min,
            max: field.max,
            decimals: field.decimals,
          })),
        consent: {
          required: ACTORS.has(party.responsibility),
          accepted: Boolean(consent && consent.consentHash === expectedConsent),
          acceptedAt: consent?.acceptedAt ?? null,
          consentHash: expectedConsent,
          platformVersion: PLATFORM_CONSENT_VERSION,
          policyVersion: snapshot.consentVersion ?? "",
          privacyNoticeReference: snapshot.policy?.privacyNoticeReference ?? "",
          text: [...PLATFORM_CONSENT_TEXT],
        },
        draft: {
          revision: draft?.revision ?? 0,
          values,
          updatedAt: draft?.updatedAt ?? null,
        },
        marks: [...marks.values()].map((mark) => ({
          hash: mark.imageHash,
          kind: mark.kind,
          method: mark.method,
          image: `data:image/png;base64,${mark.png}`,
          width: mark.width,
          height: mark.height,
        })),
        submission: access.submission ? receipt(access.submission) : null,
        completion: completion
          ? {
              pdfHash: completion.pdfHash,
              completedAt: completion.completedAt,
              sealedAt: completion.sealedAt,
            }
          : null,
        finalising: access.agreement.status === "finalising",
      },
    };
  },
});

/** The sealed copy is offered only to participants who completed their own action. */
async function sealedCopy(ctx: QueryCtx | MutationCtx, access: Access) {
  if (
    access.mode !== "completed" ||
    access.submission?.intent === "decline" ||
    access.agreement.status !== "completed" ||
    !access.agreement.completionId
  )
    return null;
  const completion = await ctx.db.get(access.agreement.completionId);
  return completion &&
    completion.agreementId === access.agreement._id &&
    completion.transactionId === access.tx._id
    ? completion
    : null;
}
export const finalDocumentContext = internalQuery({
  args: { sessionHash: v.string() },
  handler: async (ctx, args) => {
    const access = await signerAccess(ctx, args.sessionHash);
    return access ? await sealedCopy(ctx, access) : null;
  },
});

/** Cheap pre-check so unauthenticated callers cannot trigger image processing. */
export const sessionActive = internalQuery({
  args: { sessionHash: v.string() },
  handler: async (ctx, args) =>
    (await signerAccess(ctx, args.sessionHash))?.mode === "active",
});

export const documentContext = internalQuery({
  args: { sessionHash: v.string() },
  handler: async (ctx, args) => {
    const access = await signerAccess(ctx, args.sessionHash);
    if (!access || access.mode === "closed") return null;
    const { snapshot, tx } = access;
    const bundleId = snapshot.bundleId
      ? ctx.db.normalizeId("signingBundles", snapshot.bundleId)
      : null;
    const bundle = bundleId ? await ctx.db.get(bundleId) : null;
    if (
      !bundle ||
      !bundle.attemptId ||
      bundle.tenantId !== tx.tenantId ||
      bundle.agreementId !== tx.agreementId ||
      bundle.pdfHash !== snapshot.pdfHash ||
      bundle.storageVersion !== snapshot.storageVersion ||
      bundle.manifestVersion !== snapshot.manifestVersion ||
      bundle.manifestHash !== snapshot.manifestHash ||
      (bundle.retainUntil ?? 0) <= Date.now()
    )
      return null;
    return {
      tenantId: bundle.tenantId,
      agreementId: bundle.agreementId,
      attemptId: bundle.attemptId,
      manifestVersion: bundle.manifestVersion,
      manifestHash: bundle.manifestHash,
      storageVersion: bundle.storageVersion,
      pdfHash: bundle.pdfHash,
    };
  },
});

async function activeAccess(
  ctx: MutationCtx,
  sessionHash: string,
  rate: [string, number],
) {
  const access = await signerAccess(ctx, sessionHash);
  if (!access || access.mode !== "active")
    throw new ConvexError(
      "This signing session is no longer active. Reopen your invitation to continue",
    );
  if (
    !(await consumeRate(
      ctx,
      `portal-${rate[0]}:${access.session._id}`,
      rate[1],
      15 * 60_000,
    ))
  )
    throw new ConvexError(
      "Too many requests. Wait a few minutes and try again",
    );
  return access;
}
function requireActor(access: Access) {
  if (!ACTORS.has(access.party.responsibility))
    throw new ConvexError("Your invitation is for viewing only");
}

export const consent = internalMutation({
  args: { sessionHash: v.string(), consentHash: v.string() },
  handler: async (ctx, args) => {
    const access = await activeAccess(ctx, args.sessionHash, ["consent", 10]);
    requireActor(access);
    const hash = await consentHash(access.snapshot);
    if (hash !== args.consentHash)
      throw new ConvexError(
        "The consent wording changed. Reload and review it again",
      );
    const prior = await currentConsent(ctx, access.invite);
    if (prior?.consentHash === hash)
      return { ok: true as const, acceptedAt: prior.acceptedAt };
    if (prior) await ctx.db.delete(prior._id);
    const acceptedAt = Date.now();
    await ctx.db.insert("signingConsents", {
      transactionId: access.tx._id,
      invitationId: access.invite._id,
      invitationVersion: access.invite.version,
      participantKey: access.party.key,
      sessionId: access.session._id,
      platformConsentVersion: PLATFORM_CONSENT_VERSION,
      policyConsentVersion: access.snapshot.consentVersion ?? "",
      consentHash: hash,
      acceptedAt,
    });
    await ctx.db.insert("signingAccessEvents", {
      transactionId: access.tx._id,
      invitationId: access.invite._id,
      eventType: "consent_accepted",
      occurredAt: acceptedAt,
      invitationVersion: access.invite.version,
    });
    await appendSigningEvent(
      ctx,
      access.agreement,
      undefined,
      "participant_consented",
      {
        transactionId: access.tx._id,
        invitationId: access.invite._id,
        version: access.invite.version,
        consentHash: hash,
        platformConsentVersion: PLATFORM_CONSENT_VERSION,
      },
      { actorKind: "signer", participantKey: access.party.key },
    );
    return { ok: true as const, acceptedAt };
  },
});

async function requireConsent(ctx: MutationCtx, access: Access) {
  const consent = await currentConsent(ctx, access.invite);
  if (!consent || consent.consentHash !== (await consentHash(access.snapshot)))
    throw new ConvexError("Accept the electronic signing consent first");
  return consent;
}

/** Draft saves are never signatures; revisions prevent two tabs silently overwriting each other. */
export const saveDraft = internalMutation({
  args: {
    sessionHash: v.string(),
    expectedRevision: v.number(),
    values: v.any(),
  },
  handler: async (ctx, args) => {
    const access = await activeAccess(ctx, args.sessionHash, ["save", 300]);
    requireActor(access);
    await requireConsent(ctx, access);
    const draft = await currentDraft(ctx, access.invite);
    if ((draft?.revision ?? 0) !== args.expectedRevision)
      return {
        ok: false as const,
        error: "Your entries were changed in another window",
        conflict: {
          revision: draft?.revision ?? 0,
          values: draft ? parseDraftValues(draft.values) : {},
        },
      };
    const fields = editableFields(access.snapshot, access.party.key);
    const values = checkDraftValues(
      fields,
      args.values,
      await markKinds(ctx, access.invite, markValues(fields, args.values)),
    );
    const revision = (draft?.revision ?? 0) + 1,
      updatedAt = Date.now();
    const row = {
      transactionId: access.tx._id,
      invitationId: access.invite._id,
      invitationVersion: access.invite.version,
      participantKey: access.party.key,
      revision,
      values: JSON.stringify(values),
      updatedAt,
      sessionId: access.session._id,
    };
    if (draft) await ctx.db.replace(draft._id, row);
    else await ctx.db.insert("signingDrafts", row);
    return { ok: true as const, draft: { revision, values, updatedAt } };
  },
});

/** Reserves a supporting-document upload for one of this participant's attachment fields. */
export const reserveAttachment = internalMutation({
  args: {
    sessionHash: v.string(),
    fieldKey: v.string(),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const access = await activeAccess(ctx, args.sessionHash, [
      "attachment",
      20,
    ]);
    requireActor(access);
    await requireConsent(ctx, access);
    const field = editableFields(access.snapshot, access.party.key).find(
      (f) => f.key === args.fieldKey && f.type === "attachment",
    );
    if (!field?.purpose)
      throw new ConvexError("This field does not accept documents");
    if (!(args.contentType in ATTACHMENT_TYPES))
      throw new ConvexError("Upload a PDF, JPEG or PNG file");
    if (
      !Number.isInteger(args.sizeBytes) ||
      args.sizeBytes < 1 ||
      args.sizeBytes > MAX_ATTACHMENT_BYTES
    )
      throw new ConvexError("Supporting documents must be 10 MB or smaller");
    const existing = await ctx.db
      .query("signingAttachments")
      .withIndex("by_invitationId_and_sha256", (q) =>
        q.eq("invitationId", access.invite._id),
      )
      .take(41);
    if (existing.length > 40)
      throw new ConvexError(
        "Upload limit reached. Contact the company for help",
      );
    const filename =
      args.filename
        .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
        .trim()
        .slice(0, 120) || "document";
    const attachmentId = await ctx.db.insert("signingAttachments", {
      tenantId: access.tx.tenantId,
      agreementId: access.agreement._id,
      transactionId: access.tx._id,
      invitationId: access.invite._id,
      invitationVersion: access.invite.version,
      participantKey: access.party.key,
      fieldKey: field.key,
      purpose: field.purpose,
      filename,
      contentType: args.contentType as AttachmentContentType,
      sizeBytes: args.sizeBytes,
      status: "pending",
      createdAt: Date.now(),
    });
    return {
      ok: true as const,
      attachmentId,
      tenantId: access.tx.tenantId,
      agreementId: access.agreement._id,
      contentType: args.contentType as AttachmentContentType,
      sizeBytes: args.sizeBytes,
    };
  },
});

export const attachmentContext = internalQuery({
  args: { sessionHash: v.string(), attachmentId: v.string() },
  handler: async (ctx, args) => {
    const access = await signerAccess(ctx, args.sessionHash);
    const id = ctx.db.normalizeId("signingAttachments", args.attachmentId);
    const row = id ? await ctx.db.get(id) : null;
    if (
      !access ||
      access.mode !== "active" ||
      !row ||
      row.invitationId !== access.invite._id ||
      row.invitationVersion !== access.invite.version
    )
      return null;
    return row;
  },
});

/** Records the worker's scan result. Rejected uploads are never offered back to the participant. */
export const finishAttachment = internalMutation({
  args: {
    sessionHash: v.string(),
    attachmentId: v.id("signingAttachments"),
    result: v.union(
      v.object({
        status: v.literal("clean"),
        sha256: v.string(),
        storageVersion: v.string(),
        retainUntil: v.number(),
        scanEngine: v.string(),
        scanVersion: v.string(),
        scannedAt: v.number(),
      }),
      v.object({ status: v.literal("rejected"), error: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    const access = await activeAccess(ctx, args.sessionHash, [
      "attachment-finish",
      40,
    ]);
    const row = await ctx.db.get(args.attachmentId);
    if (!row || row.invitationId !== access.invite._id)
      throw new ConvexError("Upload not found");
    if (row.status !== "pending")
      return row.status === "clean"
        ? { ok: true as const, sha256: row.sha256!, filename: row.filename }
        : { ok: false as const, error: "This upload was rejected" };
    if (args.result.status === "rejected") {
      await ctx.db.patch(row._id, {
        status: "rejected",
        error: args.result.error,
      });
      await appendSigningEvent(
        ctx,
        access.agreement,
        undefined,
        "supporting_document_rejected",
        {
          attachmentId: row._id,
          fieldKey: row.fieldKey,
          error: args.result.error,
        },
        { actorKind: "signer", participantKey: row.participantKey },
      );
      return {
        ok: false as const,
        error: "The document could not be accepted",
      };
    }
    const { status: _status, ...clean } = args.result;
    if (!/^[0-9a-f]{64}$/.test(clean.sha256))
      throw new ConvexError("Invalid scan result");
    await ctx.db.patch(row._id, { status: "clean", ...clean });
    await appendSigningEvent(
      ctx,
      access.agreement,
      undefined,
      "supporting_document_accepted",
      {
        attachmentId: row._id,
        fieldKey: row.fieldKey,
        purpose: row.purpose,
        sha256: clean.sha256,
        scanEngine: clean.scanEngine,
        scanVersion: clean.scanVersion,
      },
      { actorKind: "signer", participantKey: row.participantKey },
    );
    return { ok: true as const, sha256: clean.sha256, filename: row.filename };
  },
});

export const adoptMark = internalMutation({
  args: {
    sessionHash: v.string(),
    kind: signerMarkKind,
    method: signerMarkMethod,
    // Output of `signerMarks.sanitize`; the hash is recomputed so it always matches the stored bytes.
    image: v.object({ png: v.string(), width: v.number(), height: v.number() }),
    typedText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await activeAccess(ctx, args.sessionHash, ["mark", 20]);
    requireActor(access);
    await requireConsent(ctx, access);
    if (
      !ownFields(access.snapshot, access.party.key).some(
        (f) => f.type === args.kind,
      )
    )
      throw new ConvexError(
        `This agreement has no ${args.kind} fields for you`,
      );
    const typedText =
      args.method === "typed"
        ? boundedText(args.typedText ?? "", "Typed signature", 80)
        : undefined;
    const image = {
      ...args.image,
      imageHash: await sha256Text(`${args.kind}:${args.image.png}`),
    };
    const existing = await ctx.db
      .query("signingMarks")
      .withIndex("by_invitationId_and_imageHash", (q) =>
        q
          .eq("invitationId", access.invite._id)
          .eq("imageHash", image.imageHash),
      )
      .first();
    if (!existing || existing.invitationVersion !== access.invite.version)
      await ctx.db.insert("signingMarks", {
        transactionId: access.tx._id,
        invitationId: access.invite._id,
        invitationVersion: access.invite.version,
        participantKey: access.party.key,
        kind: args.kind,
        method: args.method,
        ...(typedText ? { typedText } : {}),
        png: image.png,
        imageHash: image.imageHash,
        width: image.width,
        height: image.height,
        createdAt: Date.now(),
      });
    return {
      ok: true as const,
      mark: {
        hash: image.imageHash,
        kind: args.kind,
        method: args.method,
        image: `data:image/png;base64,${image.png}`,
        width: image.width,
        height: image.height,
      },
    };
  },
});

async function priorRequest(
  ctx: MutationCtx,
  requestKey: string,
  invitationId: Id<"signingInvitations">,
  intent: SignerIntent,
) {
  if (!REQUEST_KEY.test(requestKey)) throw new ConvexError("Invalid request");
  const prior = await ctx.db
    .query("signingSubmissions")
    .withIndex("by_requestKey", (q) => q.eq("requestKey", requestKey))
    .unique();
  if (prior && (prior.invitationId !== invitationId || prior.intent !== intent))
    throw new ConvexError("This request was already used for another action");
  return prior;
}

async function recordOutcome(
  ctx: MutationCtx,
  access: Access,
  input: {
    intent: SignerIntent;
    requestKey: string;
    evidence: Record<string, unknown>;
    acceptedAt: number;
  },
) {
  const { invite, tx, agreement, party } = access;
  const inPerson = access.session.inPersonCheckId
    ? await ctx.db.get(access.session.inPersonCheckId)
    : null;
  if (access.session.inPersonCheckId && inPerson?.invitationId !== invite._id)
    throw new ConvexError("In-person identity check is unavailable");
  const evidence = {
    contractVersion: 1,
    tenantId: tx.tenantId,
    agreementId: agreement._id,
    transactionId: tx._id,
    reference: tx.reference,
    preparationHash: tx.preparationHash,
    pdfHash: access.snapshot.pdfHash ?? null,
    manifestHash: access.snapshot.manifestHash ?? null,
    participant: {
      key: party.key,
      name: party.name,
      email: party.email,
      role: party.role,
      responsibility: party.responsibility,
      stage: party.stage,
    },
    invitation: { id: invite._id, version: invite.version },
    authentication: {
      method: access.session.authMethod,
      verifiedAt: access.session.verifiedAt,
      sessionId: access.session._id,
      ...(inPerson
        ? {
            inPerson: {
              checkId: inPerson._id,
              documentType: inPerson.documentType,
              documentEnding: inPerson.documentEnding,
              checkedBy: inPerson.staffUserId,
              checkedAt: inPerson.createdAt,
            },
          }
        : {}),
    },
    intent: input.intent,
    acceptedAt: input.acceptedAt,
    ...input.evidence,
  };
  const submissionHash = await signingHash(evidence);
  const eventType = {
    sign: "participant_signed",
    approve: "participant_approved",
    decline: "participant_declined",
    correction_request: "participant_requested_correction",
  }[input.intent];
  await appendSigningEvent(
    ctx,
    agreement,
    undefined,
    eventType,
    {
      transactionId: tx._id,
      invitationId: invite._id,
      version: invite.version,
      stage: party.stage,
      submissionHash,
    },
    { actorKind: "signer", participantKey: party.key },
  );
  const head = (await ctx.db.get(agreement._id))!;
  const id = await ctx.db.insert("signingSubmissions", {
    tenantId: tx.tenantId,
    agreementId: agreement._id,
    transactionId: tx._id,
    invitationId: invite._id,
    invitationVersion: invite.version,
    participantKey: party.key,
    intent: input.intent,
    requestKey: input.requestKey,
    stage: party.stage,
    preparationHash: tx.preparationHash,
    evidence: JSON.stringify(evidence),
    submissionHash,
    acceptedAt: input.acceptedAt,
    eventSequence: head.eventCount,
  });
  await ctx.db.insert("signingAccessEvents", {
    transactionId: tx._id,
    invitationId: invite._id,
    eventType,
    occurredAt: input.acceptedAt,
    invitationVersion: invite.version,
  });
  return (await ctx.db.get(id))!;
}

/** Moves to the next stage or to finalising once every actor in the current stage has finished. */
async function advance(ctx: MutationCtx, access: Access) {
  const tx = (await ctx.db.get(access.tx._id))!;
  const agreement = (await ctx.db.get(access.agreement._id))!;
  const actors = parseFrozen(access.frozen).participants.filter((p) =>
    ACTORS.has(p.responsibility),
  );
  const invites = await ctx.db
    .query("signingInvitations")
    .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
    .take(21);
  const done = new Set(
    invites
      .filter((i) => i.status === "completed")
      .map((i) => i.participantKey),
  );
  const stageDone = actors
    .filter((p) => p.stage === tx.currentStage)
    .every((p) => done.has(p.key));
  const later = actors.filter((p) => p.stage > tx.currentStage);
  if (stageDone && !later.length) {
    assertSigningTransition(agreement.status, "finalising", {
      allSigned: true,
    });
    await ctx.db.patch(tx._id, { status: "signed" });
    await ctx.db.patch(agreement._id, {
      status: "finalising",
      updatedAt: Date.now(),
    });
    await appendSigningEvent(
      ctx,
      agreement,
      undefined,
      "all_participants_completed",
      { transactionId: tx._id, completed: actors.length },
    );
    // Separate transaction: a finalisation problem must never roll back an accepted signature.
    await ctx.scheduler.runAfter(0, internal.signingFinalisation.begin, {
      agreementId: agreement._id,
    });
    return;
  }
  if (agreement.status === "awaiting_signatures") {
    assertSigningTransition(agreement.status, "partially_signed");
    await ctx.db.patch(agreement._id, {
      status: "partially_signed",
      updatedAt: Date.now(),
    });
  }
  if (!stageDone) return;
  const next = Math.min(...later.map((p) => p.stage));
  await ctx.db.patch(tx._id, { currentStage: next });
  await appendSigningEvent(
    ctx,
    agreement,
    undefined,
    "signing_stage_advanced",
    {
      transactionId: tx._id,
      from: tx.currentStage,
      to: next,
    },
  );
  await ctx.scheduler.runAfter(0, internal.signerPortal.activateStage, {
    transactionId: tx._id,
    stage: next,
  });
}

export const submit = internalMutation({
  args: {
    sessionHash: v.string(),
    requestKey: v.string(),
    expectedDraftRevision: v.number(),
    preparationHash: v.string(),
    pdfHash: v.string(),
    consentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const resolved = await signerAccess(ctx, args.sessionHash);
    // A repeated click after acceptance returns the one accepted outcome.
    if (
      resolved?.mode === "completed" &&
      (resolved.submission?.intent === "sign" ||
        resolved.submission?.intent === "approve")
    )
      return {
        ok: true as const,
        duplicate: true,
        receipt: receipt(resolved.submission),
      };
    const access = await activeAccess(ctx, args.sessionHash, ["submit", 20]);
    requireActor(access);
    const intent: SignerIntent =
      access.party.responsibility === "approver" ? "approve" : "sign";
    const prior = await priorRequest(
      ctx,
      args.requestKey,
      access.invite._id,
      intent,
    );
    if (prior)
      return { ok: true as const, duplicate: true, receipt: receipt(prior) };
    if (
      args.preparationHash !== access.tx.preparationHash ||
      args.pdfHash !== (access.snapshot.pdfHash ?? "")
    )
      throw new ConvexError(
        "The agreement version changed. Reload before signing",
      );
    const consent = await requireConsent(ctx, access);
    if (consent.consentHash !== args.consentHash)
      throw new ConvexError(
        "The consent wording changed. Reload and review it again",
      );
    const draft = await currentDraft(ctx, access.invite);
    if ((draft?.revision ?? 0) !== args.expectedDraftRevision)
      return {
        ok: false as const,
        error:
          "Your entries changed since you reviewed them. Review them again before signing",
        conflict: {
          revision: draft?.revision ?? 0,
          values: draft ? parseDraftValues(draft.values) : {},
        },
      };
    const values = draft ? parseDraftValues(draft.values) : {};
    const marks = await markKinds(
      ctx,
      access.invite,
      markValues(editableFields(access.snapshot, access.party.key), values),
    );
    const acceptedAt = Date.now();
    const { accepted, problems } = acceptedValues(
      access.snapshot,
      access.party,
      values,
      marks,
      acceptedAt,
    );
    if (problems.length)
      return { ok: false as const, error: problems[0], problems };
    const usedMarks = await Promise.all(
      [
        ...new Set(accepted.flatMap((a) => (a.markHash ? [a.markHash] : []))),
      ].map(async (hash) => {
        const mark = (await ctx.db
          .query("signingMarks")
          .withIndex("by_invitationId_and_imageHash", (q) =>
            q.eq("invitationId", access.invite._id).eq("imageHash", hash),
          )
          .first())!;
        return {
          hash,
          kind: mark.kind,
          method: mark.method,
          width: mark.width,
          height: mark.height,
        };
      }),
    );
    const row = await recordOutcome(ctx, access, {
      intent,
      requestKey: args.requestKey,
      acceptedAt,
      evidence: {
        consent: {
          platformVersion: consent.platformConsentVersion,
          policyVersion: consent.policyConsentVersion,
          consentHash: consent.consentHash,
          acceptedAt: consent.acceptedAt,
        },
        presented: {
          preparationHash: args.preparationHash,
          pdfHash: args.pdfHash,
        },
        draftRevision: draft?.revision ?? 0,
        values: accepted,
        marks: usedMarks,
        explicitIntent:
          intent === "sign" ? "finish_and_sign" : "finish_and_approve",
      },
    });
    await ctx.db.patch(access.invite._id, {
      status: "completed",
      completedAt: acceptedAt,
    });
    if (draft) await ctx.db.delete(draft._id);
    await advance(ctx, access);
    return { ok: true as const, duplicate: false, receipt: receipt(row) };
  },
});

export const decline = internalMutation({
  args: { sessionHash: v.string(), requestKey: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const resolved = await signerAccess(ctx, args.sessionHash);
    if (
      resolved?.mode === "completed" &&
      resolved.submission?.intent === "decline"
    )
      return {
        ok: true as const,
        duplicate: true,
        receipt: receipt(resolved.submission),
      };
    const access = await activeAccess(ctx, args.sessionHash, ["decline", 10]);
    requireActor(access);
    const prior = await priorRequest(
      ctx,
      args.requestKey,
      access.invite._id,
      "decline",
    );
    if (prior)
      return { ok: true as const, duplicate: true, receipt: receipt(prior) };
    const reason = boundedText(args.reason, "Reason for declining", 1000);
    const acceptedAt = Date.now();
    const row = await recordOutcome(ctx, access, {
      intent: "decline",
      requestKey: args.requestKey,
      acceptedAt,
      evidence: { reason },
    });
    await ctx.db.patch(access.invite._id, {
      status: "completed",
      completedAt: acceptedAt,
    });
    const agreement = (await ctx.db.get(access.agreement._id))!;
    assertSigningTransition(agreement.status, "declined");
    await ctx.db.patch(agreement._id, {
      status: "declined",
      updatedAt: acceptedAt,
    });
    await ctx.db.patch(access.tx._id, { status: "declined" });
    return { ok: true as const, duplicate: false, receipt: receipt(row) };
  },
});

/** A correction request pauses the transaction; it never completes or cancels the agreement. */
export const requestCorrection = internalMutation({
  args: { sessionHash: v.string(), requestKey: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const resolved = await signerAccess(ctx, args.sessionHash);
    if (resolved?.mode === "paused") {
      const prior = await ctx.db
        .query("signingSubmissions")
        .withIndex("by_requestKey", (q) => q.eq("requestKey", args.requestKey))
        .unique();
      if (prior && prior.invitationId === resolved.invite._id)
        return { ok: true as const, duplicate: true, receipt: receipt(prior) };
    }
    const access = await activeAccess(ctx, args.sessionHash, [
      "correction",
      10,
    ]);
    requireActor(access);
    const prior = await priorRequest(
      ctx,
      args.requestKey,
      access.invite._id,
      "correction_request",
    );
    if (prior)
      return { ok: true as const, duplicate: true, receipt: receipt(prior) };
    const reason = boundedText(args.reason, "Correction request", 1000);
    const acceptedAt = Date.now();
    const row = await recordOutcome(ctx, access, {
      intent: "correction_request",
      requestKey: args.requestKey,
      acceptedAt,
      evidence: { reason },
    });
    await ctx.db.patch(access.tx._id, { status: "paused" });
    return { ok: true as const, duplicate: false, receipt: receipt(row) };
  },
});

export const stageContext = internalQuery({
  args: { transactionId: v.id("signingTransactions"), stage: v.number() },
  handler: async (ctx, args) => {
    const tx = await ctx.db.get(args.transactionId);
    if (!tx || tx.status !== "active" || tx.currentStage !== args.stage)
      return null;
    const frozen = await ctx.db.get(tx.frozenPreparationId);
    if (!frozen || frozen.preparationHash !== tx.preparationHash) return null;
    const parties = parseFrozen(frozen).participants;
    const invites = await ctx.db
      .query("signingInvitations")
      .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
      .take(21);
    return {
      tx,
      invitations: invites.flatMap((invite) => {
        const party = parties.find((p) => p.key === invite.participantKey);
        return invite.status === "waiting" &&
          party &&
          ACTORS.has(party.responsibility) &&
          party.stage === args.stage
          ? [{ invite, party }]
          : [];
      }),
    };
  },
});
export const commitStage = internalMutation({
  args: {
    transactionId: v.id("signingTransactions"),
    stage: v.number(),
    emails: v.any(),
  },
  handler: async (ctx, args) => {
    const tx = await ctx.db.get(args.transactionId);
    if (!tx || tx.status !== "active" || tx.currentStage !== args.stage)
      return null;
    const agreement = await ctx.db.get(tx.agreementId);
    if (
      !agreement ||
      !["awaiting_signatures", "partially_signed"].includes(agreement.status)
    )
      return null;
    // A suspended release stops new outbound mail; the stage waits and monitoring raises it.
    const frozen = await ctx.db.get(tx.frozenPreparationId);
    const parties = frozen ? parseFrozen(frozen).participants : [];
    const blockers = await releaseBlockers(ctx, tx.tenantId, {
      category: agreement.category,
      recipients: (args.emails as MailDraft[]).map(
        (mail) =>
          parties.find((p) => p.key === mail.participantKey)?.email ?? "",
      ),
    });
    const alertKey = `stage:${tx._id}:${args.stage}`;
    if (blockers.length) {
      await appendSigningEvent(
        ctx,
        agreement,
        undefined,
        "stage_activation_blocked",
        {
          transactionId: tx._id,
          stage: args.stage,
        },
      );
      await raiseAlert(ctx, {
        key: alertKey,
        kind: "stage_blocked",
        severity: "critical",
        tenantId: tx.tenantId,
        agreementId: agreement._id,
        message: `Stage ${args.stage} invitations are held: signing release is blocked`,
      });
      return null;
    }
    await resolveAlert(ctx, alertKey);
    for (const mail of args.emails as MailDraft[]) {
      const invite = await ctx.db
        .query("signingInvitations")
        .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
        .take(21)
        .then((rows) =>
          rows.find((row) => row.participantKey === mail.participantKey),
        );
      if (
        !invite ||
        invite.status !== "waiting" ||
        invite.version !== mail.invitationVersion
      )
        continue;
      await ctx.db.patch(invite._id, {
        status: "active",
        lastEmailAt: Date.now(),
      });
      await insertDelivery(ctx, (await ctx.db.get(invite._id))!, mail);
      await appendSigningEvent(
        ctx,
        agreement,
        undefined,
        "stage_invitation_activated",
        {
          transactionId: tx._id,
          invitationId: invite._id,
          version: invite.version,
          stage: args.stage,
        },
      );
    }
    return null;
  },
});
/** Later-stage links derive from the nonces fixed at issue; delivery keys make retries idempotent. */
export const activateStage = internalAction({
  args: { transactionId: v.id("signingTransactions"), stage: v.number() },
  handler: async (ctx, args) => {
    const info: {
      tx: Doc<"signingTransactions">;
      invitations: { invite: Doc<"signingInvitations">; party: FrozenParty }[];
    } | null = await ctx.runQuery(internal.signerPortal.stageContext, args);
    if (!info?.invitations.length) return null;
    const emails: MailDraft[] = [];
    for (const { invite, party } of info.invitations) {
      const credential = await regenerateInvitation({
        keyId: invite.keyId,
        reference: info.tx.reference,
        preparationHash: info.tx.preparationHash,
        participantKey: party.key,
        version: invite.version,
        nonce: invite.nonce,
      });
      const mail = await makeEmail({
        kind: "invitation",
        participantKey: party.key,
        version: invite.version,
        recipient: party.email,
        companyName: info.tx.companyName,
        title: info.tx.title,
        expiresAt: Math.min(invite.expiresAt, info.tx.expiresAt),
        credential,
      });
      emails.push({
        ...mail,
        requestKey: `stage:${invite._id}:${invite.version}:${args.stage}`,
      });
    }
    await ctx.runMutation(internal.signerPortal.commitStage, {
      ...args,
      emails,
    });
    return null;
  },
});
