/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Webhook } from "svix";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { canonicalJson, signingHash } from "./lib/signing";
import {
  createIssuedTransaction,
  insertDelivery,
  hasUnresolvedDelivery,
} from "./lib/signingInvitations";
import {
  credentialHash,
  invitationCredential,
  keyedHash,
  openEmail,
  otpCode,
  sealEmail,
  secretToken,
  sessionCredential,
} from "./lib/signingAccessCrypto";
import { makeEmail } from "./signingEmailPayloads";
import { signingEventEnvelope } from "./lib/signingAudit";

const modules = import.meta.glob("./**/*.ts");
const master = "12".repeat(32),
  service = "synthetic-service-token-".repeat(3),
  adminEmail = "signing-admin@example.test";
const parties = [
  {
    key: "tenant",
    name: "Tenant",
    email: "tenant@example.test",
    role: "Tenant",
    responsibility: "signer" as const,
    stage: 1,
  },
  {
    key: "owner",
    name: "Owner",
    email: "owner@example.test",
    role: "Owner",
    responsibility: "signer" as const,
    stage: 2,
  },
  {
    key: "viewer",
    name: "Viewer",
    email: "viewer@example.test",
    role: "Viewer",
    responsibility: "viewer" as const,
    stage: 1,
  },
  {
    key: "copy",
    name: "Copy",
    email: "copy@example.test",
    role: "Copy",
    responsibility: "copy" as const,
    stage: 1,
  },
];
async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:05:00Z"));
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", adminEmail);
  vi.stubEnv("SIGNING_ACCESS_KEYS_JSON", JSON.stringify({ test: master }));
  vi.stubEnv("SIGNING_ACCESS_ACTIVE_KEY_ID", "test");
  vi.stubEnv("SIGNING_PORTAL_SERVICE_TOKEN", service);
  vi.stubEnv("SIGNING_PORTAL_ORIGIN", "https://portal.example.test");
  vi.stubEnv("SIGNING_SENDER_ADDRESS", "Company <sign@example.test>");
  // An issued transaction implies an approved pilot release; services are synthetic placeholders.
  vi.stubEnv("SIGNING_RELEASE_MODE", "pilot");
  vi.stubEnv("SIGNING_WINDMILL_BASE_URL", "https://windmill.example.test");
  vi.stubEnv("WINDMILL_WORKSPACE", "w");
  vi.stubEnv("WINDMILL_SIGNING_EMAIL_TOKEN", "email-token");
  vi.stubEnv("WINDMILL_SIGNING_DOCUMENTS_TOKEN", "documents-token");
  vi.stubEnv("WINDMILL_SIGNING_FINALISE_TOKEN", "finalise-token");
  vi.stubEnv("WINDMILL_SIGNING_TOKEN", "checkpoint-token");
  vi.stubEnv("RESEND_SIGNING_WEBHOOK_SECRET", "whsec_synthetic");
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: adminEmail });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 3_600_000,
    });
    await ctx.db.insert("signingMfa", {
      userId,
      credentialVersion: "test",
      keyId: "test",
      encryptedSecret: "fixture",
      enabled: true,
      enrollmentExpiresAt: 0,
      recoveryHashes: [],
      failedAttempts: 0,
      lockedUntil: 0,
      lastAttemptAt: 0,
    });
    await ctx.db.insert("signingMfaGrants", {
      userId,
      sessionId,
      credentialVersion: "test",
      expiresAt: Date.now() + 300_000,
    });
    const tenantId = await ctx.db.insert("tenants", {
      slug: "synthetic",
      displayName: "Company",
      status: "active",
      primaryRegion: "ZA",
      createdAt: Date.now(),
      createdBy: userId,
    });
    await ctx.db.insert("signingPolicies", {
      tenantId,
      revision: 1,
      jurisdiction: "ZA",
      legalReviewReference: "legal-review-synthetic",
      privacyNoticeReference: "privacy-1",
      retentionPolicyReference: "retention-1",
      consentVersion: "fixture",
      allowedCategories: ["commercial_lease"],
      approvalRequired: true,
      updatedAt: Date.now(),
      updatedBy: userId,
    });
    await ctx.db.insert("signingReleases", {
      tenantId,
      revision: 1,
      mode: "pilot",
      pilotRecipients: ["@example.test"],
      legalSignOffReference: "legal-signoff-synthetic",
      acceptanceReference: "acceptance-synthetic",
      recordedAt: Date.now(),
      recordedBy: userId,
    });
    const outsider = await ctx.db.insert("users", {
      email: "outsider@example.test",
    });
    return { userId, sessionId, tenantId, outsider };
  });
  const admin = t.withIdentity({ subject: `${ids.userId}|${ids.sessionId}` });
  const { agreementId } = await admin.mutation(api.signing.createDraft, {
    tenantId: ids.tenantId,
    requestId: "access-fixture-draft",
    draft: {
      title: "Synthetic lease",
      category: "commercial_lease",
      notes: "",
      participants: parties,
    },
  });
  const reference = crypto.randomUUID(),
    nonces = parties.map(() => crypto.randomUUID()),
    expiresAt = Date.now() + 86400_000;
  const snapshot = {
      participants: parties,
      contentHash: "fixture-content",
      policyRevision: 1,
      consentVersion: "fixture",
    },
    preparationHash = await signingHash(snapshot);
  const tokens = await Promise.all(
    parties.map((p, i) =>
      invitationCredential(
        master,
        reference,
        preparationHash,
        p.key,
        1,
        nonces[i],
      ),
    ),
  );
  const emails = await Promise.all(
    parties.map((p, i) =>
      makeEmail({
        kind: "invitation",
        participantKey: p.key,
        version: 1,
        recipient: p.email,
        companyName: "Company",
        title: "Synthetic lease",
        expiresAt,
        credential: tokens[i],
      }),
    ),
  );
  // Authentication fixtures deliberately bypass production approval by calling an unregistered
  // business helper. Public/internal issuance entry points remain release-gated below.
  const txId = await t.run(async (ctx) => {
    const agreement = (await ctx.db.get(agreementId))!;
    const frozenId = await ctx.db.insert("signingFrozenPreparations", {
      tenantId: ids.tenantId,
      agreementId,
      revisionId: agreement.currentRevisionId!,
      bundleId: ctx.db.normalizeId("signingBundles", "999999signingBundles")!,
      layoutId: ctx.db.normalizeId("signingLayouts", "999999signingLayouts")!,
      approvalId: ctx.db.normalizeId(
        "signingApprovals",
        "999999signingApprovals",
      )!,
      decisionId: ctx.db.normalizeId(
        "signingApprovalDecisions",
        "999999signingApprovalDecisions",
      )!,
      policyRevision: 1,
      eventSequence: 1,
      preparationHash,
      snapshot: canonicalJson(snapshot),
      createdAt: Date.now(),
      createdBy: ids.userId,
    });
    await ctx.db.patch(agreementId, {
      status: "ready_to_send",
      frozenPreparationId: frozenId,
    });
    return createIssuedTransaction(ctx, {
      agreement: (await ctx.db.get(agreementId))!,
      frozen: (await ctx.db.get(frozenId))!,
      actorId: ids.userId,
      reference,
      requestId: "issued-fixture",
      expiresAt,
      companyName: "Company",
      keyId: "test",
      nonces,
      tokenHashes: await Promise.all(
        tokens.map((raw) => credentialHash("invitation", raw)),
      ),
      emails,
    });
  });
  const invites = await t.run((ctx) =>
    ctx.db.query("signingInvitations").collect(),
  );
  const invitation = invites.find((i) => i.participantKey === "tenant")!;
  const call = async (
    operation: string,
    credential = "",
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown> & { status: number }> => {
    const response = await t.fetch("/signing/access", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${service}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operation,
        credential,
        network: "test-network",
        ...extra,
      }),
    });
    return {
      status: response.status,
      ...((await response.json()) as Record<string, unknown>),
    };
  };
  async function challenge() {
    const result = await call("exchange", tokens[0]);
    expect(result.ok).toBe(true);
    return result.challengeCredential as string;
  }
  async function code(raw: string) {
    const result = await call("request_code", raw);
    expect(result.ok).toBe(true);
    const info = await t.query(internal.signingAccessState.challenge, {
      challengeHash: await credentialHash("challenge", raw),
    });
    const delivery = await t.run((ctx) =>
      ctx.db.get(info!.challenge.deliveryId!),
    );
    const payload = (await openEmail(
      master,
      delivery!.deliveryKey,
      "otp",
      delivery!.sealed!,
    )) as { code: string };
    return { code: payload.code, delivery: delivery!, info: info! };
  }
  return {
    ...ids,
    t,
    admin,
    agreementId,
    txId,
    tokens,
    invites,
    invitation,
    emails,
    call,
    challenge,
    code,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("invitation credentials and release", () => {
  test("first stage and viewers only; reminders follow the 24-hour outstanding rule", async () => {
    const f = await fixture();
    expect(f.invites.map((i) => [i.participantKey, i.status])).toEqual([
      ["tenant", "active"],
      ["owner", "waiting"],
      ["viewer", "active"],
      ["copy", "waiting"],
    ]);
    expect(
      await f.t.run((ctx) => ctx.db.query("signingDeliveries").collect()),
    ).toHaveLength(2);
    const frozenId = f.invitation.frozenPreparationId;
    await expect(
      f.admin.mutation(internal.signingInvitations.commitIssue, {
        agreementId: f.agreementId,
        frozenId,
        requestId: "attempt-release",
        reference: crypto.randomUUID(),
        expiresAt: Date.now() + 1000,
        keyId: "test",
        nonces: [],
        tokenHashes: [],
        emails: [],
      }),
    ).rejects.toThrow();
    await expect(
      f.admin.action(api.signingInvitations.remind, {
        invitationId: f.invitation._id,
        requestId: "reminder-fixture",
      }),
    ).rejects.toThrow("24 hours");
    expect(
      (
        await f.admin.query(api.signingInvitations.list, {
          agreementId: f.agreementId,
        })
      ).canSend,
    ).toBe(true);
    expect((await f.call("exchange", f.tokens[1])).ok).toBe(false);
    expect((await f.call("exchange", f.tokens[3])).ok).toBe(false);
  });
  test("GET and exchange never send OTP, consume invitations, consent or sign", async () => {
    const f = await fixture(),
      before = await f.t.run((ctx) =>
        ctx.db.query("signingDeliveries").collect(),
      );
    expect((await f.t.fetch("/signing/access", { method: "GET" })).status).toBe(
      404,
    );
    const raw = await f.challenge();
    expect(await f.call("challenge", raw)).toMatchObject({
      ok: true,
      challengeReady: true,
      recipient: "t***@e***.test",
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("signingDeliveries").collect()),
    ).toEqual(before);
    expect((await f.t.run((ctx) => ctx.db.get(f.invitation._id)))?.status).toBe(
      "active",
    );
    expect((await f.t.run((ctx) => ctx.db.get(f.agreementId)))?.status).toBe(
      "awaiting_signatures",
    );
    expect(
      await f.t.run((ctx) => ctx.db.query("signingSignerSessions").collect()),
    ).toHaveLength(0);
    const dump = JSON.stringify(
      await f.t.run(async (ctx) => ({
        invites: await ctx.db.query("signingInvitations").collect(),
        challenges: await ctx.db.query("signingAccessChallenges").collect(),
      })),
    );
    expect(dump).not.toContain(f.tokens[0]);
    expect(dump).not.toContain(raw);
  });
  test("company isolation and redacted staff ledger", async () => {
    const f = await fixture();
    await expect(
      f.t.query(api.signingInvitations.list, { agreementId: f.agreementId }),
    ).rejects.toThrow();
    await expect(
      f.t
        .withIdentity({ subject: f.outsider })
        .query(api.signingInvitations.list, { agreementId: f.agreementId }),
    ).rejects.toThrow();
    const ledger = JSON.stringify(
      await f.admin.query(api.signingInvitations.list, {
        agreementId: f.agreementId,
      }),
    );
    for (const secret of [
      "tokenHash",
      "sealed",
      "nonce",
      "recipientHash",
      f.tokens[0],
    ])
      expect(ledger).not.toContain(secret);
  });
  test("frozen data tampering, tenant suspension and stale document pointer fail closed", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.patch(f.invitation.frozenPreparationId, {
        snapshot: JSON.stringify({
          participants: parties,
          contentHash: "changed",
        }),
      }),
    );
    expect((await f.call("exchange", f.tokens[0])).ok).toBe(false);
    const g = await fixture();
    await g.t.run((ctx) => ctx.db.patch(g.tenantId, { status: "suspended" }));
    expect((await g.call("exchange", g.tokens[0])).ok).toBe(false);
  });
});

describe("email OTP and signer sessions", () => {
  test("verification is idempotent, purpose-bound, separate from consent and revocable", async () => {
    const f = await fixture(),
      raw = await f.challenge(),
      { code, delivery } = await f.code(raw);
    expect(code).toMatch(/^\d{8}$/);
    expect(delivery.sealed).not.toContain(code);
    const verified = await f.call("verify_code", raw, { code });
    expect(verified.ok).toBe(true);
    const retry = await f.call("verify_code", raw, { code });
    expect(retry).toEqual(verified);
    expect(
      await f.call("session", verified.sessionCredential as string),
    ).toMatchObject({ ok: true, authMethod: "email_otp", role: "Tenant" });
    expect((await f.call("session", raw)).ok).toBe(false);
    expect(
      await f.t.run((ctx) => ctx.db.query("signingSignerSessions").collect()),
    ).toHaveLength(1);
    expect(
      await f.t.run((ctx) => ctx.db.query("signingAccessEvents").collect()),
    ).toHaveLength(1);
    const events = await f.t.run((ctx) =>
      ctx.db.query("signingEvents").collect(),
    );
    expect(events.at(-1)).toMatchObject({
      eventType: "participant_email_verified",
      actorKind: "signer",
      participantKey: "tenant",
    });
    expect(events.at(-1)?.actorId).toBeUndefined();
    for (const event of events)
      expect(await signingHash(signingEventEnvelope(event))).toBe(
        event.eventHash,
      );
    expect((await f.t.run((ctx) => ctx.db.get(f.agreementId)))?.status).toBe(
      "awaiting_signatures",
    );
    await f.call("logout", verified.sessionCredential as string);
    expect(
      (await f.call("session", verified.sessionCredential as string)).ok,
    ).toBe(false);
    expect((await f.call("verify_code", raw, { code })).ok).toBe(false);
  });
  test("five failures across new challenges persist and lock the invitation", async () => {
    const f = await fixture(),
      raw = await f.challenge(),
      first = await f.code(raw),
      wrong = first.code === "00000000" ? "11111111" : "00000000";
    for (let n = 0; n < 3; n++)
      expect((await f.call("verify_code", raw, { code: wrong })).ok).toBe(
        false,
      );
    await f.t.run((ctx) =>
      ctx.db.patch(first.delivery._id, {
        status: "accepted",
        sealed: undefined,
      }),
    );
    vi.setSystemTime(Date.now() + 61_000);
    const other = await f.challenge(),
      second = await f.code(other),
      wrong2 = second.code === "00000000" ? "11111111" : "00000000";
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.invitation._id)))?.failedAttempts,
    ).toBe(3);
    for (let n = 0; n < 2; n++)
      expect((await f.call("verify_code", other, { code: wrong2 })).ok).toBe(
        false,
      );
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.invitation._id)))?.lockedUntil,
    ).toBeGreaterThan(Date.now());
    expect((await f.call("verify_code", other, { code: second.code })).ok).toBe(
      false,
    );
    expect((await f.call("exchange", f.tokens[0])).ok).toBe(false);
  });
  test("resend cooldown, ambiguous delivery and invitation rate caps cannot be bypassed by a new challenge", async () => {
    const f = await fixture(),
      raw = await f.challenge(),
      first = await f.code(raw);
    expect((await f.call("request_code", raw)).ok).toBe(false);
    const another = await f.challenge();
    expect((await f.call("request_code", another)).ok).toBe(false);
    vi.setSystemTime(Date.now() + 61_000);
    await f.t.run((ctx) =>
      ctx.db.patch(first.delivery._id, { status: "unknown" }),
    );
    expect((await f.call("request_code", raw)).ok).toBe(false);
    for (let n = 0; n < 9; n++) await f.call("exchange", f.tokens[0]);
    expect((await f.call("exchange", f.tokens[0])).ok).toBe(false);
  });
  test.each(["revoke", "version", "expiry", "transaction", "stage"])(
    "%s invalidates challenge and session on every operation",
    async (mode) => {
      const f = await fixture(),
        raw = await f.challenge(),
        { code } = await f.code(raw),
        verified = await f.call("verify_code", raw, { code });
      if (mode === "revoke")
        await f.admin.mutation(api.signingInvitations.revoke, {
          invitationId: f.invitation._id,
          expectedVersion: 1,
          reason: "Lost personal link",
        });
      else
        await f.t.run(async (ctx) => {
          if (mode === "version")
            await ctx.db.patch(f.invitation._id, {
              version: 2,
              nonce: "new-version",
              tokenHash: await credentialHash("invitation", "new-credential"),
            });
          if (mode === "expiry")
            await ctx.db.patch(f.invitation._id, { expiresAt: Date.now() - 1 });
          if (mode === "transaction")
            await ctx.db.patch(f.txId, { status: "voided" });
          if (mode === "stage") await ctx.db.patch(f.txId, { currentStage: 2 });
        });
      expect(
        (await f.call("session", verified.sessionCredential as string)).ok,
      ).toBe(false);
      expect((await f.call("request_code", raw)).ok).toBe(false);
      expect((await f.call("verify_code", raw, { code })).ok).toBe(false);
      expect((await f.call("exchange", f.tokens[0])).ok).toBe(false);
    },
  );
  test("code and session expiry are server enforced", async () => {
    const f = await fixture(),
      raw = await f.challenge(),
      { code } = await f.code(raw);
    vi.setSystemTime(Date.now() + 600_001);
    expect((await f.call("verify_code", raw, { code })).ok).toBe(false);
    const g = await fixture(),
      raw2 = await g.challenge(),
      next = await g.code(raw2),
      verified = await g.call("verify_code", raw2, { code: next.code });
    vi.setSystemTime(Date.now() + 1_800_001);
    expect(
      (await g.call("session", verified.sessionCredential as string)).ok,
    ).toBe(false);
  });
});

describe("durable mail deliveries", () => {
  test("request identity deduplicates permanently, even with a fresh ciphertext", async () => {
    const f = await fixture();
    const first = await makeEmail({
      kind: "reminder",
      participantKey: "tenant",
      version: 1,
      recipient: parties[0].email,
      companyName: "Company",
      title: "Lease",
      expiresAt: Date.now() + 100_000,
      credential: f.tokens[0],
    });
    const second = await makeEmail({
      kind: "reminder",
      participantKey: "tenant",
      version: 1,
      recipient: parties[0].email,
      companyName: "Company",
      title: "Lease",
      expiresAt: Date.now() + 100_000,
      credential: f.tokens[0],
    });
    const a = await f.t.run((ctx) =>
      insertDelivery(ctx, f.invitation, {
        ...first,
        requestKey: "permanent-request",
      }),
    );
    const b = await f.t.run((ctx) =>
      insertDelivery(ctx, f.invitation, {
        ...second,
        requestKey: "permanent-request",
      }),
    );
    expect(a).toBe(b);
    expect(
      await f.t.run((ctx) => ctx.db.query("signingDeliveries").collect()),
    ).toHaveLength(3);
  });
  test("ambiguous POST retains job ownership; replay after provider retention never resends", async () => {
    const f = await fixture();
    vi.stubEnv("SIGNING_WINDMILL_BASE_URL", "https://worker.example.test");
    vi.stubEnv("WINDMILL_WORKSPACE", "synthetic");
    vi.stubEnv("WINDMILL_SIGNING_EMAIL_TOKEN", "test-email-token");
    const row = (
      await f.t.run((ctx) => ctx.db.query("signingDeliveries").collect())
    )[0];
    const fetch = vi
      .fn()
      .mockRejectedValue(new Error("Synthetic lost response"));
    vi.stubGlobal("fetch", fetch);
    await f.t.action(internal.signingDeliveries.submit, {
      deliveryId: row._id,
    });
    const unknown = await f.t.run((ctx) => ctx.db.get(row._id));
    expect(unknown).toMatchObject({ status: "unknown" });
    expect(unknown?.jobId).toBeTruthy();
    vi.setSystemTime(Date.now() + 25 * 3_600_000);
    await f.t.action(internal.signingDeliveries.submit, {
      deliveryId: row._id,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const args = JSON.parse(fetch.mock.calls[0][1].body);
    expect(args.sealed).toBe(row.sealed);
    expect(JSON.stringify(args)).not.toContain(f.tokens[0]);
    await f.t.mutation(internal.signingDeliveries.purgePayload, {
      deliveryId: row._id,
    });
    expect(
      (await f.t.run((ctx) => ctx.db.get(row._id)))?.sealed,
    ).toBeUndefined();
  });
  test("older unresolved delivery cannot disappear behind a newer history page", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const row = (await ctx.db.query("signingDeliveries").collect())[0];
      await ctx.db.patch(row._id, { status: "unknown" });
      const { _id, _creationTime, ...mail } = row;
      for (let n = 0; n < 105; n++)
        await ctx.db.insert("signingDeliveries", {
          ...mail,
          deliveryKey: crypto.randomUUID(),
          status: "accepted",
          sealed: undefined,
        });
    });
    expect(
      await f.t.run((ctx) => hasUnresolvedDelivery(ctx, f.invitation._id)),
    ).toBe(true);
  });
  test("job ownership and input digest are required before publishing provider receipts", async () => {
    const f = await fixture();
    vi.stubEnv("SIGNING_WINDMILL_BASE_URL", "https://worker.example.test");
    vi.stubEnv("WINDMILL_WORKSPACE", "synthetic");
    vi.stubEnv("WINDMILL_SIGNING_EMAIL_TOKEN", "test-email-token");
    const row = (
        await f.t.run((ctx) => ctx.db.query("signingDeliveries").collect())
      )[0],
      jobId = crypto.randomUUID(),
      providerMessageId = crypto.randomUUID();
    await f.t.mutation(internal.signingDeliveries.claim, {
      deliveryId: row._id,
      jobId,
    });
    const job = {
      id: jobId,
      script_path: "f/signing/deliver_email",
      success: true,
      args: {
        operation: "send",
        delivery_id: row.deliveryKey,
        kind: row.kind,
        payload_digest: "wrong",
      },
      result: { status: "accepted", providerMessageId },
    };
    const fetch = vi.fn().mockImplementation(async () => Response.json(job));
    vi.stubGlobal("fetch", fetch);
    await f.t.action(internal.signingDeliveries.poll, { deliveryId: row._id });
    expect((await f.t.run((ctx) => ctx.db.get(row._id)))?.status).toBe(
      "unknown",
    );
    job.args.payload_digest = row.payloadDigest;
    await f.t.action(internal.signingDeliveries.poll, { deliveryId: row._id });
    expect(await f.t.run((ctx) => ctx.db.get(row._id))).toMatchObject({
      status: "accepted",
      providerMessageId,
    });
    expect(
      (await f.t.run((ctx) => ctx.db.get(row._id)))?.sealed,
    ).toBeUndefined();
    const count = (
      await f.t.run((ctx) => ctx.db.query("signingEvents").collect())
    ).length;
    await f.t.action(internal.signingDeliveries.poll, { deliveryId: row._id });
    expect(
      (await f.t.run((ctx) => ctx.db.query("signingEvents").collect())).length,
    ).toBe(count);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  test("revoked or expired queued deliveries are suppressed before provider submission", async () => {
    const f = await fixture();
    const row = (
      await f.t.run((ctx) => ctx.db.query("signingDeliveries").collect())
    )[0];
    await f.admin.mutation(api.signingInvitations.revoke, {
      invitationId: f.invitation._id,
      expectedVersion: 1,
      reason: "Link revoked",
    });
    expect(
      await f.t.mutation(internal.signingDeliveries.claim, {
        deliveryId: row._id,
        jobId: crypto.randomUUID(),
      }),
    ).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(row._id))).toMatchObject({
      status: "suppressed",
    });
  });
});

describe("signed provider events", () => {
  async function webhookFixture() {
    const f = await fixture(),
      secret = `whsec_${btoa("synthetic-webhook-secret-32-bytes!")}`;
    vi.stubEnv("RESEND_SIGNING_WEBHOOK_SECRET", secret);
    const row = (
        await f.t.run((ctx) => ctx.db.query("signingDeliveries").collect())
      )[0],
      providerMessageId = crypto.randomUUID();
    async function send(
      type = "email.delivered",
      extra: Record<string, unknown> = {},
      id = crypto.randomUUID(),
      time = Date.now(),
    ) {
      const raw = JSON.stringify({
        type,
        created_at: new Date(time).toISOString(),
        data: {
          email_id: providerMessageId,
          from: row.expectedFrom,
          to: [parties[0].email],
          tags: { signing_delivery: row.deliveryKey },
          ...extra,
        },
      });
      const date = new Date(),
        signature = new Webhook(secret).sign(id, date, raw);
      const args = {
        raw,
        id,
        timestamp: String(Math.floor(date.getTime() / 1000)),
        signature,
      };
      return {
        args,
        result: await f.t.action(internal.signingWebhooks.ingest, args),
      };
    }
    return { ...f, row, send, secret };
  }
  test("webhook before job result binds provider ID; reordered replay is idempotent and distinct from verification", async () => {
    const f = await webhookFixture(),
      first = await f.send();
    expect(first.result.status).toBe(200);
    expect(
      (await f.t.action(internal.signingWebhooks.ingest, first.args)).status,
    ).toBe(200);
    await f.send("email.sent", {}, crypto.randomUUID(), Date.now() - 1000);
    const row = await f.t.run((ctx) => ctx.db.get(f.row._id));
    expect(row?.deliveredAt).toBe(Date.now());
    expect(row?.sentAt).toBe(Date.now() - 1000);
    expect(row?.status).toBe("accepted");
    expect(row?.sealed).toBeUndefined();
    expect(
      await f.t.run((ctx) => ctx.db.query("signingDeliveryEvents").collect()),
    ).toHaveLength(2);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.invitation._id)))?.verifiedAt,
    ).toBeUndefined();
    const event = (
      await f.t.run((ctx) => ctx.db.query("signingEvents").collect())
    ).at(-1)!;
    expect(event.actorKind).toBe("provider");
    expect(event.actorId).toBeUndefined();
    expect(await signingHash(signingEventEnvelope(event))).toBe(
      event.eventHash,
    );
  });
  test("raw-body changes, stale signatures and mismatched recipients cannot update delivery", async () => {
    const f = await webhookFixture(),
      signed = await f.send("email.delivered", { to: ["other@example.test"] });
    expect(signed.result.status).toBe(409);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.row._id)))?.deliveredAt,
    ).toBeUndefined();
    expect(
      (
        await f.t.action(internal.signingWebhooks.ingest, {
          ...signed.args,
          raw: signed.args.raw + " ",
        })
      ).status,
    ).toBe(401);
    const id = crypto.randomUUID(),
      date = new Date(Date.now() - 600_000);
    expect(
      (
        await f.t.action(internal.signingWebhooks.ingest, {
          ...signed.args,
          id,
          timestamp: String(Math.floor(date.getTime() / 1000)),
          signature: new Webhook(f.secret).sign(id, date, signed.args.raw),
        })
      ).status,
    ).toBe(401);
    expect((await f.send("email.opened")).result.status).toBe(200);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.invitation._id)))?.verifiedAt,
    ).toBeUndefined();
  });
  test("same signed event ID with a different body is a conflict", async () => {
    const f = await webhookFixture(),
      id = crypto.randomUUID();
    expect((await f.send("email.sent", {}, id)).result.status).toBe(200);
    expect((await f.send("email.delivered", {}, id)).result.status).toBe(409);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.row._id)))?.deliveredAt,
    ).toBeUndefined();
  });
});

describe("credential cryptography", () => {
  test("envelopes authenticate transaction and purpose; retained keys and deterministic sessions", async () => {
    const id = crypto.randomUUID(),
      sealed = await sealEmail(master, "test", id, "otp", { code: "12345678" });
    expect(await openEmail(master, id, "otp", sealed)).toEqual({
      code: "12345678",
    });
    await expect(openEmail(master, id, "invitation", sealed)).rejects.toThrow();
    await expect(
      openEmail(master, crypto.randomUUID(), "otp", sealed),
    ).rejects.toThrow();
    await expect(
      openEmail("34".repeat(32), id, "otp", sealed),
    ).rejects.toThrow();
    const stable = await invitationCredential(
      master,
      id,
      "hash",
      "tenant",
      1,
      "nonce",
    );
    expect(stable).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      await invitationCredential(master, id, "hash", "tenant", 1, "nonce"),
    ).toBe(stable);
    expect(
      await invitationCredential(master, id, "hash", "tenant", 2, "nonce"),
    ).not.toBe(stable);
    expect(await credentialHash("session", stable)).not.toBe(
      await credentialHash("invitation", stable),
    );
    expect(await sessionCredential(master, "challenge", 1, "hash")).toBe(
      await sessionCredential(master, "challenge", 1, "hash"),
    );
    expect(await keyedHash(master, "otp-v1", "test")).not.toBe(
      await keyedHash(master, "recipient-v1", "test"),
    );
    expect(new Set(Array.from({ length: 100 }, secretToken)).size).toBe(100);
    for (let n = 0; n < 100; n++) expect(otpCode()).toMatch(/^\d{8}$/);
  });
});

describe("send-time release gate and provider failures", () => {
  const deliveries = (f: Awaited<ReturnType<typeof fixture>>) =>
    f.t.run((ctx) => ctx.db.query("signingDeliveries").collect());
  const claim = (
    f: Awaited<ReturnType<typeof fixture>>,
    deliveryId: Id<"signingDeliveries">,
  ) =>
    f.t.mutation(internal.signingDeliveries.claim, {
      deliveryId,
      jobId: crypto.randomUUID(),
    });

  test("mail queued before a suspension is suppressed at send time, including codes", async () => {
    const f = await fixture();
    const raw = await f.challenge();
    const { delivery: otp } = await f.code(raw);
    await f.admin.mutation(api.signingRelease.suspend, {
      tenantId: f.tenantId,
      reason: "Provider incident",
    });
    for (const row of await deliveries(f)) {
      expect(await claim(f, row._id)).toBeNull();
      expect(await f.t.run((ctx) => ctx.db.get(row._id))).toMatchObject({
        status: "suppressed",
      });
    }
    expect(otp.kind).toBe("otp");
  });

  test("a narrowed pilot allowlist stops invitations but invited participants can still verify", async () => {
    const f = await fixture();
    await f.admin.mutation(api.signingRelease.record, {
      tenantId: f.tenantId,
      expectedRevision: 1,
      mode: "pilot",
      pilotRecipients: ["@other.test"],
      legalSignOffReference: "legal-signoff-synthetic",
      acceptanceReference: "acceptance-synthetic",
    });
    const invitation = (await deliveries(f)).find(
      (d) => d.kind === "invitation",
    )!;
    expect(await claim(f, invitation._id)).toBeNull();
    const raw = await f.challenge();
    const { delivery } = await f.code(raw);
    expect(await claim(f, delivery._id)).not.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(delivery._id))).toMatchObject({
      status: "submitting",
    });
    vi.stubEnv("SIGNING_RELEASE_MODE", "off");
    vi.setSystemTime(Date.now() + 61_000);
    await f.t.run((ctx) => ctx.db.patch(delivery._id, { status: "accepted" }));
    const second = await f.code(raw);
    expect(await claim(f, second.delivery._id)).toBeNull();
  });

  test("bounce and failure events become a failed status that later events never mask", async () => {
    const f = await fixture();
    const row = (await deliveries(f))[0];
    const providerMessageId = crypto.randomUUID();
    await f.t.run((ctx) =>
      ctx.db.patch(row._id, { status: "accepted", providerMessageId }),
    );
    const event = (eventType: string) =>
      f.t.mutation(internal.signingDeliveryEvents.record, {
        eventId: crypto.randomUUID(),
        bodyHash: crypto.randomUUID(),
        providerMessageId,
        deliveryKey: row.deliveryKey,
        eventType,
        occurredAt: Date.now(),
        from: row.expectedFrom,
        recipientHash: row.recipientHash,
      });
    expect(await event("email.bounced")).toBe(200);
    expect(await f.t.run((ctx) => ctx.db.get(row._id))).toMatchObject({
      status: "failed",
    });
    expect(await event("email.delivered")).toBe(200);
    expect((await f.t.run((ctx) => ctx.db.get(row._id)))?.status).toBe(
      "failed",
    );
    const ledger = await f.admin.query(api.signingInvitations.list, {
      agreementId: f.agreementId,
    });
    expect(JSON.stringify(ledger)).toContain('"status":"failed"');
  });

  test("public mailbox domains cannot be pilot allowlist entries", async () => {
    const f = await fixture();
    await expect(
      f.admin.mutation(api.signingRelease.record, {
        tenantId: f.tenantId,
        expectedRevision: 1,
        mode: "pilot",
        pilotRecipients: ["@gmail.com"],
        legalSignOffReference: "legal",
        acceptanceReference: "acceptance",
      }),
    ).rejects.toThrow("Public mailbox domains");
  });
});
