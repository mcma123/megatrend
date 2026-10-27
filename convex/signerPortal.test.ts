/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { deflateSync } from "node:zlib";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { canonicalJson, signingHash } from "./lib/signing";
import { createIssuedTransaction } from "./lib/signingInvitations";
import {
  credentialHash,
  invitationCredential,
  openEmail,
} from "./lib/signingAccessCrypto";
import { makeEmail } from "./signingEmailPayloads";
import { signingEventEnvelope } from "./lib/signingAudit";

const modules = import.meta.glob("./**/*.ts");
const master = "34".repeat(32),
  service = "synthetic-portal-token-".repeat(3),
  adminEmail = "portal-admin@example.test",
  pdfHash = "a".repeat(64);
const parties = [
  {
    key: "tenant",
    name: "Thandi Tenant",
    email: "tenant@example.test",
    role: "Tenant",
    responsibility: "signer" as const,
    stage: 1,
  },
  {
    key: "cotenant",
    name: "Co Tenant",
    email: "cotenant@example.test",
    role: "Co-tenant",
    responsibility: "signer" as const,
    stage: 1,
  },
  {
    key: "owner",
    name: "Olu Owner",
    email: "owner@example.test",
    role: "Owner",
    responsibility: "signer" as const,
    stage: 2,
  },
  {
    key: "viewer",
    name: "Vera Viewer",
    email: "viewer@example.test",
    role: "Agent",
    responsibility: "viewer" as const,
    stage: 1,
  },
];
const page = {
  pageIndex: 0,
  sourceFileId: "file",
  sourcePageIndex: 0,
  mediaBox: [0, 0, 595, 842],
  cropBox: [0, 0, 595, 842],
  rotation: 0,
  userUnit: 1,
  widthPt: 595,
  heightPt: 842,
};
const rect = (y: number) => ({
  pageIndex: 0,
  x: 0.1,
  y,
  width: 0.3,
  height: 0.05,
});
const fields = [
  {
    key: "t-sig",
    type: "signature",
    label: "Tenant signature",
    participantKey: "tenant",
    ...rect(0.1),
    required: true,
    readOnly: false,
  },
  {
    key: "t-ini-1",
    type: "initials",
    label: "Initials 1",
    participantKey: "tenant",
    ...rect(0.2),
    required: true,
    readOnly: false,
  },
  {
    key: "t-ini-2",
    type: "initials",
    label: "Initials 2",
    participantKey: "tenant",
    ...rect(0.3),
    required: true,
    readOnly: false,
  },
  {
    key: "t-units",
    type: "number",
    label: "Occupants",
    participantKey: "tenant",
    ...rect(0.4),
    required: true,
    readOnly: false,
    min: 1,
    max: 6,
    decimals: 0,
  },
  {
    key: "t-ack",
    type: "checkbox",
    label: "House rules",
    participantKey: "tenant",
    ...rect(0.5),
    required: true,
    readOnly: false,
  },
  {
    key: "t-note",
    type: "text",
    label: "Note",
    participantKey: "tenant",
    ...rect(0.55),
    required: false,
    readOnly: false,
    minLength: 0,
    maxLength: 20,
  },
  {
    key: "t-date",
    type: "signing_date",
    label: "Date",
    participantKey: "tenant",
    ...rect(0.6),
    required: true,
    readOnly: true,
  },
  {
    key: "t-name",
    type: "full_name",
    label: "Name",
    participantKey: "tenant",
    ...rect(0.65),
    required: true,
    readOnly: true,
    minLength: 1,
    maxLength: 160,
  },
  {
    key: "rent",
    type: "text",
    label: "Monthly rent",
    participantKey: "tenant",
    ...rect(0.7),
    required: true,
    readOnly: true,
    fixedValue: "R 12 000",
  },
  {
    key: "c-sig",
    type: "signature",
    label: "Co-tenant signature",
    participantKey: "cotenant",
    ...rect(0.8),
    required: true,
    readOnly: false,
  },
  {
    key: "o-sig",
    type: "signature",
    label: "Owner signature",
    participantKey: "owner",
    ...rect(0.9),
    required: true,
    readOnly: false,
  },
];

function chunk(type: string, data: Uint8Array) {
  const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let k = 0; k < 8; k++)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc);
  return out;
}
function png(
  options: {
    text?: boolean;
    seed?: number;
    width?: number;
    badCrc?: boolean;
  } = {},
) {
  const width = options.width ?? 32,
    height = 16;
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (1 + width * 4)).map(
    (_, i) => (i * (options.seed ?? 7)) % 251,
  );
  for (let row = 0; row < height; row++) raw[row * (1 + width * 4)] = 0;
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    ...(options.text
      ? [chunk("tEXt", new TextEncoder().encode("Comment\0private gps"))]
      : []),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  if (options.badCrc) parts[2][parts[2].length - 1] ^= 1;
  const bytes = Uint8Array.from(parts.flatMap((p) => [...p]));
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}

/** Synthetic service configuration; values are placeholders and never reach a network. */
function configureServices() {
  vi.stubEnv("SIGNING_WINDMILL_BASE_URL", "https://windmill.example.test");
  vi.stubEnv("WINDMILL_WORKSPACE", "w");
  vi.stubEnv("WINDMILL_SIGNING_EMAIL_TOKEN", "email-token");
  vi.stubEnv("WINDMILL_SIGNING_DOCUMENTS_TOKEN", "documents-token");
  vi.stubEnv("WINDMILL_SIGNING_FINALISE_TOKEN", "finalise-token");
  vi.stubEnv("WINDMILL_SIGNING_TOKEN", "checkpoint-token");
  vi.stubEnv("RESEND_SIGNING_WEBHOOK_SECRET", "whsec_synthetic");
}
/** An issued transaction implies an approved release, so the default fixture models a pilot. */
async function fixture(
  options: { release?: boolean; extraFields?: Record<string, unknown>[] } = {},
) {
  const released = options.release ?? true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:05:00Z"));
  if (released) {
    configureServices();
    vi.stubEnv("SIGNING_RELEASE_MODE", "pilot");
  }
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", adminEmail);
  vi.stubEnv("SIGNING_ACCESS_KEYS_JSON", JSON.stringify({ test: master }));
  vi.stubEnv("SIGNING_ACCESS_ACTIVE_KEY_ID", "test");
  vi.stubEnv("SIGNING_PORTAL_SERVICE_TOKEN", service);
  vi.stubEnv("SIGNING_PORTAL_ORIGIN", "https://portal.example.test");
  vi.stubEnv("SIGNING_SENDER_ADDRESS", "Company <sign@example.test>");
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
      displayName: "Synthetic Company",
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
      consentVersion: "consent-2026-10",
      allowedCategories: ["commercial_lease"],
      approvalRequired: true,
      updatedAt: Date.now(),
      updatedBy: userId,
    });
    if (released)
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
    return { userId, sessionId, tenantId };
  });
  const admin = t.withIdentity({ subject: `${ids.userId}|${ids.sessionId}` });
  const { agreementId } = await admin.mutation(api.signing.createDraft, {
    tenantId: ids.tenantId,
    requestId: "portal-fixture-draft",
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
  const txId = await t.run(async (ctx) => {
    const agreement = (await ctx.db.get(agreementId))!;
    const bundleId = await ctx.db.insert("signingBundles", {
      tenantId: ids.tenantId,
      agreementId,
      revisionId: agreement.currentRevisionId!,
      manifestHash: "m".repeat(64),
      pdfHash,
      artifactKey: "prepared/x/bundle.pdf",
      storageVersion: "pdf-v1",
      validatedAt: Date.now(),
      scanReference: "scan",
      rendererVersion: "1",
      attemptId: ctx.db.normalizeId(
        "signingPreparations",
        "999999signingPreparations",
      )!,
      manifestVersion: "manifest-v1",
      retainUntil: Date.now() + 365 * 86400_000,
      pages: [page],
    });
    const snapshot = {
      participants: parties,
      fields: [...fields, ...(options.extraFields ?? [])],
      pages: [page],
      pdfHash,
      bundleId,
      storageVersion: "pdf-v1",
      manifestVersion: "manifest-v1",
      manifestHash: "m".repeat(64),
      contentHash: "fixture-content",
      policyRevision: 1,
      consentVersion: "consent-2026-10",
      policy: {
        privacyNoticeReference: "privacy-1",
        consentVersion: "consent-2026-10",
        signerContact: "leases@example.test",
      },
    };
    const preparationHash = await signingHash(snapshot);
    const frozenId = await ctx.db.insert("signingFrozenPreparations", {
      tenantId: ids.tenantId,
      agreementId,
      revisionId: agreement.currentRevisionId!,
      bundleId,
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
          companyName: "Synthetic Company",
          title: "Synthetic lease",
          expiresAt,
          credential: tokens[i],
        }),
      ),
    );
    // Fixtures call the unregistered business helper; public issuance remains release-gated.
    return createIssuedTransaction(ctx, {
      agreement: (await ctx.db.get(agreementId))!,
      frozen: (await ctx.db.get(frozenId))!,
      actorId: ids.userId,
      reference,
      requestId: "portal-issued-fixture",
      expiresAt,
      companyName: "Synthetic Company",
      keyId: "test",
      nonces,
      tokenHashes: await Promise.all(
        tokens.map((raw) => credentialHash("invitation", raw)),
      ),
      emails,
    });
  });
  const preparationHash = (await t.run((ctx) => ctx.db.get(txId)))!
    .preparationHash;
  let network = 0;
  const call = async (
    operation: string,
    credential = "",
    extra: Record<string, unknown> = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- synthetic HTTP responses
  ): Promise<Record<string, any> & { status: number }> => {
    const response = await t.fetch("/signing/access", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${service}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operation,
        credential,
        network: `net-${network++}`,
        ...extra,
      }),
    });
    return {
      status: response.status,
      ...((await response.json()) as Record<string, any>),
    };
  };
  /** Establishes a verified session through the real HTTP exchange/OTP path. */
  const token = (key: string) =>
    invitationCredential(
      master,
      reference,
      preparationHash,
      key,
      1,
      nonces[parties.findIndex((p) => p.key === key)],
    );
  async function session(key: string) {
    const raw = await token(key);
    const exchanged = await call("exchange", raw);
    expect(exchanged.ok).toBe(true);
    const challenge = exchanged.challengeCredential as string;
    expect((await call("request_code", challenge)).ok).toBe(true);
    const info = await t.query(internal.signingAccessState.challenge, {
      challengeHash: await credentialHash("challenge", challenge),
    });
    const delivery = (await t.run((ctx) =>
      ctx.db.get(info!.challenge.deliveryId!),
    ))!;
    const { code } = (await openEmail(
      master,
      delivery.deliveryKey,
      "otp",
      delivery.sealed!,
    )) as { code: string };
    const verified = await call("verify_code", challenge, { code });
    expect(verified.ok).toBe(true);
    return verified.sessionCredential as string;
  }
  const portal = async (credential: string) =>
    (await call("portal", credential)).portal;
  async function prepared(credential: string) {
    const p = await portal(credential);
    expect(
      (
        await call("consent", credential, {
          consentHash: p.consent.consentHash,
        })
      ).ok,
    ).toBe(true);
    const sig = await call("adopt_mark", credential, {
      kind: "signature",
      method: "drawn",
      image: png(),
    });
    const needsInitials = p.fields.some(
      (field: any) => field.own && field.type === "initials",
    );
    const ini = needsInitials
      ? await call("adopt_mark", credential, {
          kind: "initials",
          method: "typed",
          typedText: "TT",
          image: png({ seed: 11 }),
        })
      : null;
    expect(sig.ok && (!ini || ini.ok)).toBe(true);
    return {
      portal: p,
      sig: sig.mark.hash as string,
      ini: (ini?.mark.hash ?? "") as string,
    };
  }
  const submit = (
    credential: string,
    p: any,
    revision: number,
    extra: Record<string, unknown> = {},
  ) =>
    call("submit", credential, {
      requestKey: crypto.randomUUID(),
      expectedDraftRevision: revision,
      preparationHash: p.document.preparationHash,
      pdfHash: p.document.pdfHash,
      consentHash: p.consent.consentHash,
      ...extra,
    });
  const count = (table: "signingSubmissions" | "signingEvents") =>
    t.run(async (ctx) => (await ctx.db.query(table).collect()).length);
  return {
    ...ids,
    t,
    admin,
    agreementId,
    txId,
    call,
    token,
    session,
    portal,
    prepared,
    submit,
    count,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("signer portal context", () => {
  test("shows own interactive fields and locked approved terms without credentials", async () => {
    const f = await fixture();
    const credential = await f.session("tenant");
    const response = await f.call("portal", credential);
    const p = response.portal;
    expect(p).toMatchObject({
      mode: "active",
      company: { name: "Synthetic Company", contact: "leases@example.test" },
      participant: {
        name: "Thandi Tenant",
        role: "Tenant",
        responsibility: "signer",
      },
      progress: { completed: 0, total: 3 },
      consent: {
        required: true,
        accepted: false,
        policyVersion: "consent-2026-10",
      },
      document: { available: true, pdfHash },
    });
    const byKey = Object.fromEntries(
      p.fields.map((field: any) => [field.key, field]),
    );
    expect(byKey["t-sig"]).toMatchObject({ own: true, editable: true });
    expect(byKey["rent"]).toMatchObject({
      own: true,
      editable: false,
      value: "R 12 000",
    });
    expect(byKey["t-name"]).toMatchObject({
      editable: false,
      value: "Thandi Tenant",
    });
    expect(byKey["c-sig"]).toBeUndefined();
    const dump = JSON.stringify(response);
    for (const secret of [
      "tokenHash",
      "nonce",
      "sealed",
      "owner@example.test",
      "cotenant@example.test",
    ])
      expect(dump).not.toContain(secret);
    const viewer = await f.portal(await f.session("viewer"));
    expect(viewer.consent.required).toBe(false);
    expect(viewer.fields.every((field: any) => !field.editable)).toBe(true);
    expect((await f.call("portal", "not-a-session")).ok).toBe(false);
  });
  test("document links are bound to the frozen bundle and never exposed without a session", async () => {
    const f = await fixture();
    vi.stubEnv("SIGNING_WINDMILL_BASE_URL", "https://windmill.example.test");
    vi.stubEnv("WINDMILL_WORKSPACE", "w");
    vi.stubEnv("WINDMILL_SIGNING_DOCUMENTS_TOKEN", "worker-token");
    const sent: any[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({
        status: "download",
        url: "https://storage.example.test/x?sig=1",
        expiresAt: Date.now() + 60_000,
      });
    });
    const credential = await f.session("tenant");
    expect(await f.call("document", credential)).toMatchObject({
      ok: true,
      pdfHash,
      url: "https://storage.example.test/x?sig=1",
    });
    expect(sent.at(-1)).toMatchObject({
      body: {
        operation: "download",
        payload: {
          pdfHash,
          storageVersion: "pdf-v1",
          manifestVersion: "manifest-v1",
        },
      },
    });
    expect((await f.call("document", "bad")).ok).toBe(false);
    const bundle = (await f.t.run((ctx) =>
      ctx.db.query("signingBundles").first(),
    ))!;
    await f.t.run((ctx) =>
      ctx.db.patch(bundle._id, { storageVersion: "pdf-v2" }),
    );
    expect((await f.call("document", credential)).ok).toBe(false);
  });
});

describe("opening, drafting and adopting never sign", () => {
  test("consent first; saves, marks and reloads create no submission or status change", async () => {
    const f = await fixture();
    const credential = await f.session("tenant");
    const p = await f.portal(credential);
    const early = await f.call("save_draft", credential, {
      expectedRevision: 0,
      values: { "t-note": "x" },
    });
    expect(early).toMatchObject({
      ok: false,
      error: "Accept the electronic signing consent first",
    });
    const { sig, ini } = await f.prepared(credential);
    const saved = await f.call("save_draft", credential, {
      expectedRevision: 0,
      values: { "t-sig": sig, "t-ini-1": ini, "t-units": "2" },
    });
    expect(saved).toMatchObject({ ok: true, draft: { revision: 1 } });
    const resumed = await f.portal(credential);
    expect(resumed.consent.accepted).toBe(true);
    expect(resumed.draft).toMatchObject({
      revision: 1,
      values: { "t-sig": sig, "t-units": "2" },
    });
    expect(resumed.marks.map((m: any) => m.kind).sort()).toEqual([
      "initials",
      "signature",
    ]);
    expect(await f.count("signingSubmissions")).toBe(0);
    expect((await f.t.run((ctx) => ctx.db.get(f.agreementId)))?.status).toBe(
      "awaiting_signatures",
    );
    const events = await f.t.run((ctx) =>
      ctx.db.query("signingEvents").collect(),
    );
    expect(events.map((e) => e.eventType)).not.toContain("participant_signed");
    expect(events.at(-1)).toMatchObject({
      eventType: "participant_consented",
      actorKind: "signer",
    });
    expect(p.consent.consentHash).toBe(resumed.consent.consentHash);
  });
  test("stale revisions return a conflict instead of overwriting another window", async () => {
    const f = await fixture();
    const credential = await f.session("tenant");
    await f.prepared(credential);
    expect(
      (
        await f.call("save_draft", credential, {
          expectedRevision: 0,
          values: { "t-note": "first" },
        })
      ).ok,
    ).toBe(true);
    const stale = await f.call("save_draft", credential, {
      expectedRevision: 0,
      values: { "t-note": "second" },
    });
    expect(stale).toMatchObject({
      ok: false,
      status: 409,
      conflict: { revision: 1, values: { "t-note": "first" } },
    });
  });
  test("drafts reject locked, foreign, unknown-mark and mixed-mark entries", async () => {
    const f = await fixture();
    const credential = await f.session("tenant");
    const { sig, ini: first } = await f.prepared(credential);
    for (const values of [
      { rent: "R 1" },
      { "t-date": "2020-01-01" },
      { "c-sig": sig },
      { "t-sig": "f".repeat(64) },
      { "t-ini-1": sig },
    ])
      expect(
        (
          await f.call("save_draft", credential, {
            expectedRevision: 0,
            values,
          })
        ).ok,
      ).toBe(false);
    const other = (
      await f.call("adopt_mark", credential, {
        kind: "initials",
        method: "drawn",
        image: png({ seed: 13 }),
      })
    ).mark.hash;
    const mixed = await f.call("save_draft", credential, {
      expectedRevision: 0,
      values: { "t-ini-1": first, "t-ini-2": other },
    });
    expect(mixed).toMatchObject({
      ok: false,
      error: "Use the same adopted initials for every initials field",
    });
  });
  test("signature images are rebuilt without metadata and malformed images are rejected", async () => {
    const f = await fixture();
    const credential = await f.session("tenant");
    await f.prepared(credential);
    const clean = await f.call("adopt_mark", credential, {
      kind: "signature",
      method: "uploaded",
      image: png({ text: true, seed: 3 }),
    });
    expect(clean.ok).toBe(true);
    const stored = atob(clean.mark.image.split(",")[1]);
    expect(stored).not.toContain("tEXt");
    expect(stored).not.toContain("private gps");
    for (const image of [
      png({ badCrc: true }),
      png({ width: 5000 }),
      "data:image/png;base64,AAAA",
      "<svg/>",
    ])
      expect(
        (
          await f.call("adopt_mark", credential, {
            kind: "signature",
            method: "uploaded",
            image,
          })
        ).ok,
      ).toBe(false);
    const viewer = await f.session("viewer");
    expect(
      (
        await f.call("adopt_mark", viewer, {
          kind: "signature",
          method: "drawn",
          image: png(),
        })
      ).ok,
    ).toBe(false);
  });
});

describe("immutable submission", () => {
  async function complete(
    f: Awaited<ReturnType<typeof fixture>>,
    credential: string,
  ) {
    const { sig, ini, portal } = await f.prepared(credential);
    const saved = await f.call("save_draft", credential, {
      expectedRevision: 0,
      values: {
        "t-sig": sig,
        "t-ini-1": ini,
        "t-ini-2": ini,
        "t-units": "2",
        "t-ack": "true",
      },
    });
    return { portal, revision: saved.draft.revision as number, sig };
  }
  test("server checks consent, fields, version and reviewed draft before accepting", async () => {
    const f = await fixture();
    const credential = await f.session("tenant");
    const { portal, sig, ini } = { ...(await f.prepared(credential)) };
    await f.call("save_draft", credential, {
      expectedRevision: 0,
      values: { "t-sig": sig, "t-units": "9" },
    });
    const invalid = await f.submit(credential, portal, 1);
    expect(invalid.ok).toBe(false);
    expect(invalid.problems).toEqual(
      expect.arrayContaining([
        "Initials 1 is required",
        "Occupants must be a valid number within its limits",
        "House rules must be checked",
      ]),
    );
    await f.call("save_draft", credential, {
      expectedRevision: 1,
      values: {
        "t-sig": sig,
        "t-ini-1": ini,
        "t-ini-2": ini,
        "t-units": "2",
        "t-ack": "true",
      },
    });
    expect((await f.submit(credential, portal, 1)).conflict).toMatchObject({
      revision: 2,
    });
    expect(
      (
        await f.submit(credential, portal, 2, {
          preparationHash: "0".repeat(64),
        })
      ).error,
    ).toContain("version changed");
    expect(
      (await f.submit(credential, portal, 2, { pdfHash: "0".repeat(64) }))
        .error,
    ).toContain("version changed");
    expect(
      (await f.submit(credential, portal, 2, { consentHash: "0".repeat(64) }))
        .ok,
    ).toBe(false);
    expect(await f.count("signingSubmissions")).toBe(0);
    const accepted = await f.submit(credential, portal, 2);
    expect(accepted).toMatchObject({
      ok: true,
      duplicate: false,
      receipt: { intent: "sign" },
    });
    const row = (await f.t.run((ctx) =>
      ctx.db.query("signingSubmissions").first(),
    ))!;
    const evidence = JSON.parse(row.evidence);
    expect(await signingHash(evidence)).toBe(row.submissionHash);
    const values = Object.fromEntries(
      evidence.values.map((v: any) => [v.key, v]),
    );
    expect(values.rent).toMatchObject({
      value: "R 12 000",
      source: "approved",
    });
    expect(values["t-name"]).toMatchObject({
      value: "Thandi Tenant",
      source: "approved",
    });
    expect(values["t-date"]).toMatchObject({
      value: "2026-10-26",
      source: "server",
    });
    expect(values["t-sig"]).toMatchObject({ value: "applied", markHash: sig });
    expect(evidence).toMatchObject({
      intent: "sign",
      explicitIntent: "finish_and_sign",
      authentication: { method: "email_otp" },
      consent: {
        platformVersion: "cyphersoft-signer-consent-v1",
        policyVersion: "consent-2026-10",
      },
      presented: { pdfHash },
      participant: { key: "tenant", role: "Tenant" },
    });
    // The draft is consumed and later edits cannot alter the accepted record.
    expect(
      (
        await f.call("save_draft", credential, {
          expectedRevision: 0,
          values: {},
        })
      ).ok,
    ).toBe(false);
    expect((await f.portal(credential)).mode).toBe("completed");
    const events = await f.t.run((ctx) =>
      ctx.db.query("signingEvents").collect(),
    );
    for (const event of events)
      expect(await signingHash(signingEventEnvelope(event))).toBe(
        event.eventHash,
      );
    expect(
      events.find((e) => e.eventType === "participant_signed")?.payload,
    ).not.toContain("tenant@example.test");
  });
  test("double clicks and retries create exactly one accepted submission and event", async () => {
    const f = await fixture();
    const credential = await f.session("tenant");
    const { portal, revision } = await complete(f, credential);
    const requestKey = crypto.randomUUID();
    const [a, b] = await Promise.all([
      f.submit(credential, portal, revision, { requestKey }),
      f.submit(credential, portal, revision, { requestKey }),
    ]);
    const c = await f.submit(credential, portal, revision);
    expect([a, b, c].every((r) => r.ok)).toBe(true);
    expect(new Set([a, b, c].map((r) => r.receipt.submissionHash)).size).toBe(
      1,
    );
    expect(await f.count("signingSubmissions")).toBe(1);
    const events = await f.t.run((ctx) =>
      ctx.db.query("signingEvents").collect(),
    );
    expect(
      events.filter((e) => e.eventType === "participant_signed"),
    ).toHaveLength(1);
  });
  test("parallel signers complete a stage, the next stage is invited, then finalising starts", async () => {
    const f = await fixture();
    const tenant = await f.session("tenant"),
      cotenant = await f.session("cotenant");
    const { portal, revision } = await complete(f, tenant);
    const co = await f.prepared(cotenant);
    const coSaved = await f.call("save_draft", cotenant, {
      expectedRevision: 0,
      values: { "c-sig": co.sig },
    });
    const [first, second] = await Promise.all([
      f.submit(tenant, portal, revision),
      f.submit(cotenant, co.portal, coSaved.draft.revision),
    ]);
    expect(first.ok && second.ok).toBe(true);
    const tx = (await f.t.run((ctx) => ctx.db.get(f.txId)))!;
    expect(tx.currentStage).toBe(2);
    expect((await f.t.run((ctx) => ctx.db.get(f.agreementId)))?.status).toBe(
      "partially_signed",
    );
    await f.t.action(internal.signerPortal.activateStage, {
      transactionId: f.txId,
      stage: 2,
    });
    await f.t.action(internal.signerPortal.activateStage, {
      transactionId: f.txId,
      stage: 2,
    });
    const owner = await f.t.run(async (ctx) =>
      (await ctx.db.query("signingInvitations").collect()).find(
        (i) => i.participantKey === "owner",
      ),
    );
    expect(owner?.status).toBe("active");
    const ownerMail = await f.t.run(async (ctx) =>
      (await ctx.db.query("signingDeliveries").collect()).filter(
        (d) => d.invitationId === owner!._id && d.kind === "invitation",
      ),
    );
    expect(ownerMail).toHaveLength(1);
    const ownerSession = await f.session("owner");
    const o = await f.prepared(ownerSession);
    const saved = await f.call("save_draft", ownerSession, {
      expectedRevision: 0,
      values: { "o-sig": o.sig },
    });
    expect(
      (await f.submit(ownerSession, o.portal, saved.draft.revision)).ok,
    ).toBe(true);
    expect((await f.t.run((ctx) => ctx.db.get(f.agreementId)))?.status).toBe(
      "finalising",
    );
    expect((await f.t.run((ctx) => ctx.db.get(f.txId)))?.status).toBe("signed");
    expect((await f.portal(tenant)).submission.intent).toBe("sign");
  });
  test("later-stage signers cannot act before their stage", async () => {
    const f = await fixture();
    expect((await f.call("exchange", await f.token("owner"))).ok).toBe(false);
    expect((await f.call("exchange", await f.token("tenant"))).ok).toBe(true);
  });
});

describe("decline and correction", () => {
  test("decline ends the agreement once and closes other participants' access", async () => {
    const f = await fixture();
    const tenant = await f.session("tenant"),
      cotenant = await f.session("cotenant");
    expect(
      (
        await f.call("decline", tenant, {
          requestKey: crypto.randomUUID(),
          reason: "",
        })
      ).ok,
    ).toBe(false);
    const requestKey = crypto.randomUUID();
    const declined = await f.call("decline", tenant, {
      requestKey,
      reason: "Rent is incorrect",
    });
    expect(declined).toMatchObject({
      ok: true,
      receipt: { intent: "decline" },
    });
    expect(
      (
        await f.call("decline", tenant, {
          requestKey,
          reason: "Rent is incorrect",
        })
      ).duplicate,
    ).toBe(true);
    expect((await f.t.run((ctx) => ctx.db.get(f.agreementId)))?.status).toBe(
      "declined",
    );
    expect((await f.t.run((ctx) => ctx.db.get(f.txId)))?.status).toBe(
      "declined",
    );
    expect((await f.portal(cotenant)).mode).toBe("closed");
    expect(
      (
        await f.call("save_draft", cotenant, {
          expectedRevision: 0,
          values: {},
        })
      ).ok,
    ).toBe(false);
    const ledger = await f.admin.query(api.signingInvitations.list, {
      agreementId: f.agreementId,
    });
    expect(
      ledger.invitations.find((i) => i.participantKey === "tenant")
        ?.outcomes[0],
    ).toMatchObject({
      intent: "decline",
      reason: "Rent is incorrect",
    });
  });
  test("a correction request pauses signing without completing or declining", async () => {
    const f = await fixture();
    const tenant = await f.session("tenant"),
      cotenant = await f.session("cotenant");
    const requestKey = crypto.randomUUID();
    expect(
      (
        await f.call("request_correction", tenant, {
          requestKey,
          reason: "Wrong unit number",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await f.call("request_correction", tenant, {
          requestKey,
          reason: "Wrong unit number",
        })
      ).duplicate,
    ).toBe(true);
    expect((await f.t.run((ctx) => ctx.db.get(f.txId)))?.status).toBe("paused");
    expect((await f.t.run((ctx) => ctx.db.get(f.agreementId)))?.status).toBe(
      "awaiting_signatures",
    );
    expect((await f.portal(tenant)).mode).toBe("paused");
    expect((await f.portal(cotenant)).agreement.paused).toBe(true);
    const co = await f.portal(cotenant);
    expect((await f.submit(cotenant, co, 0)).ok).toBe(false);
    expect(await f.count("signingSubmissions")).toBe(1);
  });
  test("expired sessions and revoked invitations fail closed", async () => {
    const f = await fixture();
    const tenant = await f.session("tenant");
    const { portal, sig, ini } = await f.prepared(tenant);
    const values = {
      "t-sig": sig,
      "t-ini-1": ini,
      "t-ini-2": ini,
      "t-units": "2",
      "t-ack": "true",
    };
    await f.call("save_draft", tenant, { expectedRevision: 0, values });
    const invite = await f.t.run(async (ctx) =>
      (await ctx.db.query("signingInvitations").collect()).find(
        (i) => i.participantKey === "tenant",
      )!,
    );
    await f.admin.mutation(api.signingInvitations.revoke, {
      invitationId: invite._id as Id<"signingInvitations">,
      expectedVersion: 1,
      reason: "Compromised mailbox",
    });
    expect((await f.submit(tenant, portal, 1)).ok).toBe(false);
    expect((await f.call("portal", tenant)).ok).toBe(false);
    const g = await fixture();
    const other = await g.session("tenant");
    const prepared = await g.prepared(other);
    await g.call("save_draft", other, {
      expectedRevision: 0,
      values: {
        ...values,
        "t-sig": prepared.sig,
        "t-ini-1": prepared.ini,
        "t-ini-2": prepared.ini,
      },
    });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect((await g.submit(other, prepared.portal, 1)).ok).toBe(false);
    expect(await f.count("signingSubmissions")).toBe(0);
    expect(await g.count("signingSubmissions")).toBe(0);
  });
});

describe("finalisation", () => {
  /** All three signers finish through the real portal path; the agreement is then Finalising. */
  async function allSigned() {
    const f = await fixture();
    const tenant = await f.session("tenant"),
      cotenant = await f.session("cotenant");
    const t = await f.prepared(tenant);
    const tSaved = await f.call("save_draft", tenant, {
      expectedRevision: 0,
      values: {
        "t-sig": t.sig,
        "t-ini-1": t.ini,
        "t-ini-2": t.ini,
        "t-units": "2",
        "t-ack": "true",
      },
    });
    expect((await f.submit(tenant, t.portal, tSaved.draft.revision)).ok).toBe(
      true,
    );
    const co = await f.prepared(cotenant);
    const coSaved = await f.call("save_draft", cotenant, {
      expectedRevision: 0,
      values: { "c-sig": co.sig },
    });
    expect(
      (await f.submit(cotenant, co.portal, coSaved.draft.revision)).ok,
    ).toBe(true);
    await f.t.action(internal.signerPortal.activateStage, {
      transactionId: f.txId,
      stage: 2,
    });
    const owner = await f.session("owner");
    const o = await f.prepared(owner);
    const oSaved = await f.call("save_draft", owner, {
      expectedRevision: 0,
      values: { "o-sig": o.sig },
    });
    expect((await f.submit(owner, o.portal, oSaved.draft.revision)).ok).toBe(
      true,
    );
    expect((await f.t.run((ctx) => ctx.db.get(f.agreementId)))?.status).toBe(
      "finalising",
    );
    return { ...f, tenant, owner };
  }
  type Signed = Awaited<ReturnType<typeof allSigned>>;
  const attempts = (f: Signed) =>
    f.t.run((ctx) => ctx.db.query("signingFinalisations").collect());
  function result(
    row: {
      _id: string;
      tenantId: string;
      agreementId: string;
      inputDigest: string;
      createdAt: number;
    },
    overrides: Record<string, unknown> = {},
  ) {
    const prefix = `completed/${row.tenantId}/${row.agreementId}/${row._id}`;
    return {
      status: "completed",
      contractVersion: 1,
      tenantId: row.tenantId,
      agreementId: row.agreementId,
      attemptId: row._id,
      renderer: "cyphersoft-final-v1",
      evidenceHash: row.inputDigest,
      evidenceVersion: "evidence-v1",
      pdfHash: "b".repeat(64),
      pdfVersion: "pdf-v1",
      sizeBytes: 12345,
      pageCount: 2,
      certificatePageCount: 1,
      sourcePdfHash: pdfHash,
      sealedAt: row.createdAt + 1000,
      validation: {
        intact: true,
        valid: true,
        trusted: true,
        revoked: false,
        coverage: "ENTIRE_REVISION",
        modificationLevel: "LTA_UPDATES",
        certified: true,
        docmdp: "NO_CHANGES",
        signerSubject: "Common Name: Synthetic Platform Seal",
        signerCertificateSha256: "d".repeat(64),
        signerNotAfter: row.createdAt + 365 * 86400_000,
        timestamp: row.createdAt + 1000,
        tsaSubject: "Common Name: Synthetic TSA",
        dssCertificates: 4,
        dssCrls: 2,
        dssOcsps: 0,
        level: "PAdES-B-LT",
      },
      pdfKey: `${prefix}/signed.pdf`,
      evidenceKey: `${prefix}/evidence.json`,
      recordKey: `${prefix}/record.json`,
      recordVersion: "record-v1",
      recordHash: "a".repeat(64),
      retainUntil: Date.now() + 3650 * 86400_000,
      ...overrides,
    };
  }
  async function claimed(f: Signed) {
    await f.t.mutation(internal.signingFinalisation.begin, {
      agreementId: f.agreementId,
    });
    const [row] = (await attempts(f)).slice(-1);
    const jobId = crypto.randomUUID();
    await f.t.mutation(internal.signingFinalisation.claim, {
      attemptId: row._id,
      jobId,
    });
    return { row, jobId };
  }
  function configure() {
    vi.stubEnv("SIGNING_WINDMILL_BASE_URL", "https://windmill.example.test");
    vi.stubEnv("WINDMILL_WORKSPACE", "w");
    vi.stubEnv("WINDMILL_SIGNING_FINALISE_TOKEN", "finalise-token");
  }

  test("the evidence manifest binds every intact submission, mark and audit head", async () => {
    const f = await allSigned();
    await f.t.mutation(internal.signingFinalisation.begin, {
      agreementId: f.agreementId,
    });
    const [row] = await attempts(f);
    expect(row).toMatchObject({ status: "queued", attempt: 1 });
    const evidence = JSON.parse(row.evidence);
    expect(await signingHash(evidence)).toBe(row.inputDigest);
    expect(canonicalJson(evidence)).toBe(row.evidence);
    expect(evidence).toMatchObject({
      attemptId: row._id,
      bundle: { pdfHash, storageVersion: "pdf-v1" },
      approval: { consentVersion: "consent-2026-10" },
    });
    expect(
      evidence.submissions
        .map((s: { participantKey: string }) => s.participantKey)
        .sort(),
    ).toEqual(["cotenant", "owner", "tenant"]);
    expect(evidence.marks.length).toBeGreaterThanOrEqual(4);
    expect(evidence.audit.eventSequence).toBeGreaterThan(5);
    const agreement = (await f.t.run((ctx) => ctx.db.get(f.agreementId)))!;
    expect(agreement.finalisationAttemptId).toBe(row._id);
    const marks = await f.t.query(internal.signingFinalisation.markPayload, {
      attemptId: row._id,
    });
    expect(marks.map((m) => m.hash).sort()).toEqual(
      [...new Set(evidence.marks.map((m: { hash: string }) => m.hash))].sort(),
    );
    // A second claim while one is unresolved is refused.
    await f.t.mutation(internal.signingFinalisation.begin, {
      agreementId: f.agreementId,
    });
    expect(await attempts(f)).toHaveLength(1);
  });

  test("a verified result completes once; repeated or late results never publish twice", async () => {
    const f = await allSigned();
    const { row, jobId } = await claimed(f);
    const completionId = await f.t.mutation(
      internal.signingFinalisation.finish,
      { attemptId: row._id, jobId, result: result(row) },
    );
    expect(completionId).toBeTruthy();
    expect(
      await f.t.mutation(internal.signingFinalisation.finish, {
        attemptId: row._id,
        jobId,
        result: result(row),
      }),
    ).toBeNull();
    const agreement = (await f.t.run((ctx) => ctx.db.get(f.agreementId)))!;
    expect(agreement).toMatchObject({ status: "completed", completionId });
    expect((await f.t.run((ctx) => ctx.db.get(f.txId)))?.status).toBe(
      "completed",
    );
    expect(
      await f.t.run((ctx) => ctx.db.query("signingCompletions").collect()),
    ).toHaveLength(1);
    const events = await f.t.run((ctx) =>
      ctx.db.query("signingEvents").collect(),
    );
    expect(
      events.filter((e) => e.eventType === "agreement_completed"),
    ).toHaveLength(1);
    for (const event of events)
      expect(await signingHash(signingEventEnvelope(event))).toBe(
        event.eventHash,
      );
    const status = await f.admin.query(api.signingFinalisation.status, {
      agreementId: f.agreementId,
    });
    expect(status.completion).toMatchObject({
      pdfHash: "b".repeat(64),
      validation: { level: "PAdES-B-LT" },
    });
    expect(status.canRetry).toBe(false);
    configure();
    await expect(
      f.admin.mutation(api.signingFinalisation.retry, {
        agreementId: f.agreementId,
      }),
    ).rejects.toThrow();
  });

  test("invalid results fail closed and keep the agreement Finalising", async () => {
    const cases: Record<string, unknown>[] = [
      { evidenceHash: "0".repeat(64) },
      { pdfKey: "completed/other/signed.pdf" },
      { pageCount: 9 },
      { sourcePdfHash: "0".repeat(64) },
      { retainUntil: 1 },
      { validation: { level: "PAdES-B-B" } },
      { validation: { trusted: false } },
    ];
    for (const overrides of cases) {
      const f = await allSigned();
      const { row, jobId } = await claimed(f);
      const base = result(row);
      const value =
        "validation" in overrides
          ? {
              ...base,
              validation: {
                ...base.validation,
                ...(overrides.validation as object),
              },
            }
          : { ...base, ...overrides };
      await f.t.mutation(internal.signingFinalisation.finish, {
        attemptId: row._id,
        jobId,
        result: value,
      });
      expect(await f.t.run((ctx) => ctx.db.get(row._id))).toMatchObject({
        status: "failed",
        error: "result_invalid",
      });
      expect((await f.t.run((ctx) => ctx.db.get(f.agreementId)))?.status).toBe(
        "finalising",
      );
    }
  });

  test("transient failures retry automatically; only confirmed failure allows a new attempt", async () => {
    const f = await allSigned();
    configure();
    const { row, jobId } = await claimed(f);
    await expect(
      f.admin.mutation(api.signingFinalisation.retry, {
        agreementId: f.agreementId,
      }),
    ).rejects.toThrow();
    await f.t.mutation(internal.signingFinalisation.finish, {
      attemptId: row._id,
      jobId,
      error: "timestamp_unavailable",
    });
    const scheduled = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled.some((s) => s.name.includes("autoRetry"))).toBe(true);
    await f.t.mutation(internal.signingFinalisation.autoRetry, {
      agreementId: f.agreementId,
      afterAttemptId: row._id,
    });
    const [, second] = await attempts(f);
    expect(second).toMatchObject({ attempt: 2, status: "queued" });
    // Attempt identity is part of the evidence, so each attempt has its own digest and prefix.
    expect(second.inputDigest).not.toBe(row.inputDigest);
    // A late result for the failed first attempt is ignored.
    expect(
      await f.t.mutation(internal.signingFinalisation.finish, {
        attemptId: row._id,
        jobId,
        result: result(row),
      }),
    ).toBeNull();
    expect((await f.t.run((ctx) => ctx.db.get(f.agreementId)))?.status).toBe(
      "finalising",
    );
    // Configuration faults never retry on their own.
    const secondJob = crypto.randomUUID();
    await f.t.mutation(internal.signingFinalisation.claim, {
      attemptId: second._id,
      jobId: secondJob,
    });
    await f.t.mutation(internal.signingFinalisation.finish, {
      attemptId: second._id,
      jobId: secondJob,
      error: "certificate_unavailable",
    });
    const after = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(after.filter((s) => s.name.includes("autoRetry"))).toHaveLength(1);
    expect(
      await f.admin.mutation(api.signingFinalisation.retry, {
        agreementId: f.agreementId,
      }),
    ).toBeTruthy();
    expect(await attempts(f)).toHaveLength(3);
    await expect(
      f.t
        .withIdentity({ subject: "outsider" })
        .query(api.signingFinalisation.status, { agreementId: f.agreementId }),
    ).rejects.toThrow();
  });

  test("tampered submission evidence prevents finalisation", async () => {
    const f = await allSigned();
    await f.t.run(async (ctx) => {
      const row = (await ctx.db.query("signingSubmissions").first())!;
      await ctx.db.patch(row._id, {
        evidence: row.evidence.replace("Thandi", "Mallory"),
      });
    });
    await f.t.mutation(internal.signingFinalisation.begin, {
      agreementId: f.agreementId,
    });
    expect(await attempts(f)).toHaveLength(0);
    expect((await f.t.run((ctx) => ctx.db.get(f.agreementId)))?.status).toBe(
      "finalising",
    );
  });

  test("finished signers can refresh, re-verify and download only the verified sealed copy", async () => {
    const f = await allSigned();
    expect((await f.call("session", f.tenant)).ok).toBe(true);
    expect((await f.portal(f.tenant)).finalising).toBe(true);
    expect((await f.call("final_document", f.tenant)).ok).toBe(false);
    const { row, jobId } = await claimed(f);
    await f.t.mutation(internal.signingFinalisation.finish, {
      attemptId: row._id,
      jobId,
      result: result(row),
    });
    // Days later, past the original deadline, the participant verifies their mailbox again.
    vi.setSystemTime(Date.now() + 2 * 86400_000);
    expect((await f.call("portal", f.tenant)).ok).toBe(false);
    const fresh = await f.session("tenant");
    expect((await f.portal(fresh)).completion).toMatchObject({
      pdfHash: "b".repeat(64),
    });
    configure();
    const sent: { url: string; body: Record<string, unknown>; auth: string }[] =
      [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({
        url,
        body: JSON.parse(String(init.body)),
        auth: (init.headers as Record<string, string>).Authorization,
      });
      return Response.json({
        status: "download",
        url: "https://storage.example.test/signed?sig=1",
        expiresAt: Date.now() + 60_000,
      });
    });
    expect(await f.call("final_document", fresh)).toMatchObject({
      ok: true,
      pdfHash: "b".repeat(64),
    });
    expect(sent.at(-1)).toMatchObject({
      auth: "Bearer finalise-token",
      body: {
        operation: "download",
        payload: {
          attemptId: row._id,
          pdfVersion: "pdf-v1",
          pdfHash: "b".repeat(64),
        },
      },
    });
    expect(sent.at(-1)!.url).toContain("/f/signing/finalise_agreement");
    const staff = await f.admin.action(api.signingFinalisation.getSignedUrl, {
      agreementId: f.agreementId,
    });
    expect(staff.pdfHash).toBe("b".repeat(64));
    // Viewers never completed an action, so they cannot re-enter or receive the sealed copy.
    expect((await f.call("exchange", await f.token("viewer"))).ok).toBe(false);
  });

  test("verification passes only when every retained artifact and the seal match", async () => {
    const f = await allSigned();
    const { row, jobId } = await claimed(f);
    await f.t.mutation(internal.signingFinalisation.finish, {
      attemptId: row._id,
      jobId,
      result: result(row),
    });
    configure();
    const checks = {
      recordHash: true,
      pdfHash: true,
      evidenceHash: true,
      binding: true,
      seal: true,
    };
    const validation = {
      signerCertificateSha256: "d".repeat(64),
      timestamp: row.createdAt + 1000,
      signerSubject: "Seal",
    };
    let report: Record<string, unknown> = {
      status: "verified",
      checks,
      validation,
    };
    vi.stubGlobal("fetch", async () => Response.json(report));
    const verify = () =>
      f.admin.action(api.signingFinalisation.verify, {
        agreementId: f.agreementId,
      });
    expect((await verify()).passed).toBe(true);
    report = {
      status: "failed",
      checks: { ...checks, pdfHash: false, seal: false },
      validation: null,
    };
    expect(await verify()).toMatchObject({
      passed: false,
      checks: { pdfHash: false, seal: false },
    });
    report = {
      status: "verified",
      checks,
      validation: { ...validation, signerCertificateSha256: "0".repeat(64) },
    };
    expect((await verify()).passed).toBe(false);
  });
});

describe("release, exceptions and operations", () => {
  type F = Awaited<ReturnType<typeof fixture>>;
  /** Keeps the administrator's live session and five-minute MFA grant valid after time travel. */
  async function refreshAdmin(f: F) {
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.sessionId, {
        expirationTime: Date.now() + 3_600_000,
      });
      const grant = await ctx.db
        .query("signingMfaGrants")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", f.sessionId))
        .unique();
      await ctx.db.patch(grant!._id, { expiresAt: Date.now() + 300_000 });
    });
  }
  const agreementOf = (f: F) => f.t.run((ctx) => ctx.db.get(f.agreementId));
  const txOf = (f: F) => f.t.run((ctx) => ctx.db.get(f.txId));
  const invites = (f: F) =>
    f.t.run((ctx) => ctx.db.query("signingInvitations").collect());
  async function signTenant(f: F, credential: string) {
    const { sig, ini, portal } = await f.prepared(credential);
    const saved = await f.call("save_draft", credential, {
      expectedRevision: 0,
      values: {
        "t-sig": sig,
        "t-ini-1": ini,
        "t-ini-2": ini,
        "t-units": "2",
        "t-ack": "true",
      },
    });
    expect((await f.submit(credential, portal, saved.draft.revision)).ok).toBe(
      true,
    );
  }

  test("external sending needs the deployment key, a company release and allowlisted pilot recipients", async () => {
    const f = await fixture({ release: false });
    const ledger = await f.admin.query(api.signingInvitations.list, {
      agreementId: f.agreementId,
    });
    expect(ledger.canSend).toBe(false);
    expect(ledger.releaseBlockers).toContain(
      "Signing release is switched off for this deployment",
    );
    configureServices();
    vi.stubEnv("SIGNING_RELEASE_MODE", "pilot");
    const record = (
      mode: "pilot" | "live",
      pilotRecipients: string[],
      expectedRevision: number,
    ) =>
      f.admin.mutation(api.signingRelease.record, {
        tenantId: f.tenantId,
        expectedRevision,
        mode,
        pilotRecipients,
        legalSignOffReference: "legal-signoff-synthetic",
        acceptanceReference: "acceptance-synthetic",
      });
    await expect(record("pilot", [], 0)).rejects.toThrow("at least one");
    await expect(record("pilot", ["not an address"], 0)).rejects.toThrow(
      "Pilot recipients",
    );
    await record("pilot", ["tenant@example.test", "@other.test"], 0);
    let blockers = (
      await f.admin.query(api.signingInvitations.list, {
        agreementId: f.agreementId,
      })
    ).releaseBlockers;
    expect(blockers).toEqual([
      "3 participant addresses are outside the pilot allowlist",
    ]);
    await record("pilot", ["@EXAMPLE.test"], 1);
    expect(
      (
        await f.admin.query(api.signingInvitations.list, {
          agreementId: f.agreementId,
        })
      ).canSend,
    ).toBe(true);
    await record("live", ["@example.test"], 2);
    blockers = (
      await f.admin.query(api.signingInvitations.list, {
        agreementId: f.agreementId,
      })
    ).releaseBlockers;
    expect(blockers).toContain("This deployment only permits pilot releases");
    vi.stubEnv("SIGNING_RELEASE_MODE", "live");
    expect(
      (await f.admin.query(api.signingRelease.get, { tenantId: f.tenantId }))
        .blockers,
    ).toEqual([]);
    await f.admin.mutation(api.signingRelease.suspend, {
      tenantId: f.tenantId,
      reason: "Incident drill",
    });
    expect(
      (await f.admin.query(api.signingRelease.get, { tenantId: f.tenantId }))
        .blockers,
    ).toContain("Signing release is suspended for this company");
    vi.stubEnv("SIGNING_RELEASE_MODE", "on");
    expect(
      (await f.admin.query(api.signingRelease.get, { tenantId: f.tenantId }))
        .deploymentMode,
    ).toBe("off");
    await expect(
      f.t
        .withIdentity({ subject: "outsider" })
        .mutation(api.signingRelease.suspend, {
          tenantId: f.tenantId,
          reason: "x",
        }),
    ).rejects.toThrow();
  });

  test("a suspended release holds the next stage, raises an alert and resumes explicitly", async () => {
    const f = await fixture();
    await signTenant(f, await f.session("tenant"));
    const co = await f.session("cotenant");
    const prepared = await f.prepared(co);
    const saved = await f.call("save_draft", co, {
      expectedRevision: 0,
      values: { "c-sig": prepared.sig },
    });
    await f.admin.mutation(api.signingRelease.suspend, {
      tenantId: f.tenantId,
      reason: "Provider incident",
    });
    expect((await f.submit(co, prepared.portal, saved.draft.revision)).ok).toBe(
      true,
    );
    await f.t.action(internal.signerPortal.activateStage, {
      transactionId: f.txId,
      stage: 2,
    });
    expect(
      (await invites(f)).find((i) => i.participantKey === "owner")?.status,
    ).toBe("waiting");
    const alerts = await f.admin.query(api.signingOperations.alerts, {});
    expect(alerts).toEqual([
      expect.objectContaining({ kind: "stage_blocked", severity: "critical" }),
    ]);
    expect(JSON.stringify(alerts)).not.toContain("@example.test");
    const notices = await f.t.run((ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(notices.some((n) => n.kind === "signing_alert")).toBe(true);
    expect(
      (
        await f.admin.query(api.signingExceptions.status, {
          agreementId: f.agreementId,
        })
      ).canResumeStage,
    ).toBe(true);
    await f.admin.mutation(api.signingRelease.record, {
      tenantId: f.tenantId,
      expectedRevision: 2,
      mode: "pilot",
      pilotRecipients: ["@example.test"],
      legalSignOffReference: "legal-signoff-synthetic",
      acceptanceReference: "acceptance-synthetic-2",
    });
    await f.admin.mutation(api.signingExceptions.resumeStage, {
      agreementId: f.agreementId,
    });
    await f.t.action(internal.signerPortal.activateStage, {
      transactionId: f.txId,
      stage: 2,
    });
    expect(
      (await invites(f)).find((i) => i.participantKey === "owner")?.status,
    ).toBe("active");
    expect(await f.admin.query(api.signingOperations.alerts, {})).toEqual([]);
  });

  test("reminders reach only outstanding current-stage signers, at most once a day", async () => {
    const f = await fixture();
    await expect(
      f.admin.action(api.signingExceptions.remindOutstanding, {
        agreementId: f.agreementId,
        requestId: "remind-too-soon",
      }),
    ).resolves.toEqual({ queued: 0, skipped: 0 });
    await f.admin.mutation(api.signingExceptions.extendDeadline, {
      agreementId: f.agreementId,
      expiresAt: Date.now() + 10 * 86400_000,
      reason: "More time requested",
    });
    await signTenant(f, await f.session("tenant"));
    vi.setSystemTime(Date.now() + 25 * 3600_000);
    await refreshAdmin(f);
    // Earlier messages must be resolved before another can be sent.
    await f.t.run(async (ctx) => {
      for (const d of await ctx.db.query("signingDeliveries").collect())
        await ctx.db.patch(d._id, { status: "accepted" });
    });
    const ledger = await f.admin.query(api.signingInvitations.list, {
      agreementId: f.agreementId,
    });
    expect(
      ledger.invitations
        .filter((i) => i.reminderEligible)
        .map((i) => i.participantKey),
    ).toEqual(["cotenant"]);
    expect(
      await f.admin.action(api.signingExceptions.remindOutstanding, {
        agreementId: f.agreementId,
        requestId: "remind-day-two",
      }),
    ).toEqual({ queued: 1, skipped: 0 });
    const reminders = await f.t.run(async (ctx) =>
      (await ctx.db.query("signingDeliveries").collect()).filter(
        (d) => d.kind === "reminder",
      ),
    );
    expect(reminders.map((d) => d.participantKey)).toEqual(["cotenant"]);
    expect(
      await f.admin.action(api.signingExceptions.remindOutstanding, {
        agreementId: f.agreementId,
        requestId: "remind-again",
      }),
    ).toEqual({ queued: 0, skipped: 0 });
  });

  test("voiding an issued agreement revokes access but keeps accepted evidence", async () => {
    const f = await fixture();
    const tenant = await f.session("tenant");
    await signTenant(f, tenant);
    const cotenant = await f.session("cotenant");
    await expect(
      f.t
        .withIdentity({ subject: "outsider" })
        .mutation(api.signingExceptions.voidIssued, {
          agreementId: f.agreementId,
          reason: "x",
        }),
    ).rejects.toThrow();
    await f.admin.mutation(api.signingExceptions.voidIssued, {
      agreementId: f.agreementId,
      reason: "Wrong property",
    });
    await f.admin.mutation(api.signingExceptions.voidIssued, {
      agreementId: f.agreementId,
      reason: "Wrong property",
    });
    expect(await agreementOf(f)).toMatchObject({
      status: "voided",
      voidReason: "Wrong property",
    });
    expect((await txOf(f))?.status).toBe("voided");
    const rows = await invites(f);
    expect(rows.find((i) => i.participantKey === "tenant")?.status).toBe(
      "completed",
    );
    expect(rows.find((i) => i.participantKey === "cotenant")?.status).toBe(
      "revoked",
    );
    expect((await f.call("portal", cotenant)).ok).toBe(false);
    expect(await f.count("signingSubmissions")).toBe(1);
    const events = await f.t.run((ctx) =>
      ctx.db.query("signingEvents").collect(),
    );
    expect(
      events.filter((e) => e.eventType === "agreement_voided"),
    ).toHaveLength(1);
    for (const event of events)
      expect(await signingHash(signingEventEnvelope(event))).toBe(
        event.eventHash,
      );
  });

  test("deadline extension is bounded and expiry is scheduled, never silent", async () => {
    const f = await fixture();
    const extend = (expiresAt: number) =>
      f.admin.mutation(api.signingExceptions.extendDeadline, {
        agreementId: f.agreementId,
        expiresAt,
        reason: "Requested",
      });
    await expect(extend(Date.now() + 31 * 86400_000)).rejects.toThrow(
      "30 days",
    );
    await expect(extend(Date.now() + 3600_000)).rejects.toThrow(
      "later deadline",
    );
    const later = Date.now() + 3 * 86400_000;
    await extend(later);
    expect((await txOf(f))?.expiresAt).toBe(later);
    expect(
      (await invites(f))
        .filter((i) => i.status !== "completed")
        .every((i) => i.expiresAt === later),
    ).toBe(true);
    vi.setSystemTime(later + 1000);
    expect(await f.t.mutation(internal.signingExceptions.expireDue, {})).toBe(
      1,
    );
    expect((await agreementOf(f))?.status).toBe("expired");
    expect((await txOf(f))?.status).toBe("expired");
    expect(await f.t.mutation(internal.signingExceptions.expireDue, {})).toBe(
      0,
    );
  });

  test("a correction can resume unchanged or be replaced by a new draft that preserves history", async () => {
    const f = await fixture();
    const tenant = await f.session("tenant");
    await signTenant(f, tenant);
    const co = await f.session("cotenant");
    await f.call("request_correction", co, {
      requestKey: crypto.randomUUID(),
      reason: "Spelling of my name",
    });
    expect((await txOf(f))?.status).toBe("paused");
    await f.admin.mutation(api.signingExceptions.resumeAfterCorrection, {
      agreementId: f.agreementId,
      reason: "No change needed",
    });
    expect((await txOf(f))?.status).toBe("active");
    expect((await f.portal(co)).mode).toBe("active");
    const replacementId = await f.admin.mutation(
      api.signingExceptions.replace,
      {
        agreementId: f.agreementId,
        reason: "Name corrected",
      },
    );
    expect(
      await f.admin.mutation(api.signingExceptions.replace, {
        agreementId: f.agreementId,
        reason: "again",
      }),
    ).toBe(replacementId);
    expect(await agreementOf(f)).toMatchObject({
      status: "superseded",
      replacedByAgreementId: replacementId,
    });
    expect((await txOf(f))?.status).toBe("voided");
    expect((await f.call("portal", co)).ok).toBe(false);
    const replacement = await f.admin.query(api.signing.get, {
      agreementId: replacementId,
    });
    expect(replacement.agreement).toMatchObject({
      status: "draft",
      replacesAgreementId: f.agreementId,
    });
    expect(replacement.participants.map((p: { key: string }) => p.key)).toEqual(
      parties.map((p) => p.key),
    );
    expect(await f.count("signingSubmissions")).toBe(2);
  });

  test("legal holds are exclusive and released with a reason", async () => {
    const f = await fixture();
    const holdId = await f.admin.mutation(api.signingExceptions.placeHold, {
      agreementId: f.agreementId,
      reason: "Dispute",
    });
    await expect(
      f.admin.mutation(api.signingExceptions.placeHold, {
        agreementId: f.agreementId,
        reason: "Again",
      }),
    ).rejects.toThrow("already has an active legal hold");
    await f.admin.mutation(api.signingExceptions.releaseHold, {
      holdId,
      reason: "Resolved",
    });
    const status = await f.admin.query(api.signingExceptions.status, {
      agreementId: f.agreementId,
    });
    expect(status.holds[0]).toMatchObject({
      reason: "Dispute",
      releaseReason: "Resolved",
    });
  });

  test("monitoring opens PII-free alerts for stuck work and resolves them when cleared", async () => {
    const f = await fixture();
    const delivery = await f.t.run(
      async (ctx) => (await ctx.db.query("signingDeliveries").first())!,
    );
    await f.t.run((ctx) => ctx.db.patch(delivery._id, { status: "unknown" }));
    await f.t.mutation(internal.signingOperations.scan, {});
    let alerts = await f.admin.query(api.signingOperations.alerts, {});
    expect(alerts.map((a) => a.kind).sort()).toEqual([
      "deadline_soon",
      "delivery_unresolved",
    ]);
    expect(JSON.stringify(alerts)).not.toMatch(/@example\.test|Thandi|Tenant/);
    const tracked = await f.admin.query(api.signing.list, {
      tenantId: f.tenantId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(tracked.page[0].tracking).toMatchObject({
      openAlerts: 2,
      critical: true,
      completed: 0,
      total: 3,
    });
    await f.t.run((ctx) => ctx.db.patch(delivery._id, { status: "accepted" }));
    await f.t.mutation(internal.signingOperations.scan, {});
    alerts = await f.admin.query(api.signingOperations.alerts, {});
    expect(alerts.map((a) => a.kind)).toEqual(["deadline_soon"]);
    const notices = await f.t.run((ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(notices.filter((n) => n.kind === "signing_alert")).toHaveLength(2);
    await expect(
      f.t
        .withIdentity({ subject: "outsider" })
        .query(api.signingOperations.alerts, {}),
    ).rejects.toThrow();
  });

  test("retention purges transient signer data after the period unless a legal hold applies", async () => {
    const f = await fixture();
    const tenant = await f.session("tenant");
    const { sig } = await f.prepared(tenant);
    await f.call("adopt_mark", tenant, {
      kind: "signature",
      method: "drawn",
      image: png({ seed: 21 }),
    });
    await f.call("save_draft", tenant, {
      expectedRevision: 0,
      values: { "t-sig": sig },
    });
    await f.call("decline", tenant, {
      requestKey: crypto.randomUUID(),
      reason: "Not proceeding",
    });
    const count = (
      table:
        | "signingDrafts"
        | "signingMarks"
        | "signingAccessChallenges"
        | "signingConsents",
    ) => f.t.run(async (ctx) => (await ctx.db.query(table).collect()).length);
    expect(await count("signingDrafts")).toBe(1);
    const holdId = await f.admin.mutation(api.signingExceptions.placeHold, {
      agreementId: f.agreementId,
      reason: "Claim",
    });
    vi.setSystemTime(Date.now() + 91 * 86400_000);
    expect(
      await f.t.mutation(internal.signingOperations.purgeTransient, {}),
    ).toBe(0);
    expect(await count("signingDrafts")).toBe(1);
    await refreshAdmin(f);
    await f.admin.mutation(api.signingExceptions.releaseHold, {
      holdId,
      reason: "Settled",
    });
    expect(
      await f.t.mutation(internal.signingOperations.purgeTransient, {}),
    ).toBe(1);
    expect(await count("signingDrafts")).toBe(0);
    expect(await count("signingMarks")).toBe(0);
    expect(await count("signingAccessChallenges")).toBe(0);
    expect(await count("signingConsents")).toBe(1);
    expect(await f.count("signingSubmissions")).toBe(1);
    expect((await agreementOf(f))?.transientPurgedAt).toBeTruthy();
    expect(
      await f.t.mutation(internal.signingOperations.purgeTransient, {}),
    ).toBe(0);
  });
});

describe("advanced participant workflows", () => {
  const proofField = {
    key: "t-proof",
    type: "attachment",
    label: "Proof of address",
    participantKey: "tenant",
    ...rect(0.75),
    required: true,
    readOnly: false,
    purpose: "proof_of_address",
  };
  /** Synthetic worker: echoes bound quarantine forms and reports scan results without storage. */
  function stubWorker(scan: (payload: any) => Record<string, unknown>) {
    const calls: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push(body);
        const { operation, tenant_id, agreement_id, payload } = body;
        const result =
          operation === "attachment_upload"
            ? {
                status: "upload",
                url: "https://storage.example.test/quarantine",
                fields: {
                  key: `attachments-quarantine/${tenant_id}/${agreement_id}/${payload.attachmentId}`,
                  "Content-Type": payload.contentType,
                },
              }
            : operation === "attachment_scan"
              ? scan(payload)
              : {
                  status: "download",
                  url: "https://storage.example.test/retained",
                  expiresAt: Date.now() + 60_000,
                };
        return new Response(JSON.stringify(result), { status: 200 });
      }),
    );
    return calls;
  }
  const clean = (sha256: string) => () => ({
    status: "clean",
    sha256,
    storageVersion: "v1",
    retainUntil: Date.now() + 365 * 86400_000,
    scanEngine: "ClamAV",
    scanVersion: "1.4/27000",
    scannedAt: Date.now(),
  });

  test("in-person sessions record the staff check but still need the participant's mailbox code", async () => {
    const f = await fixture();
    await expect(
      f.admin.action(api.signingInPerson.start, {
        agreementId: f.agreementId,
        participantKey: "tenant",
        documentType: "sa_id",
        documentEnding: "1-2-3-4-5",
        attested: true,
      }),
    ).rejects.toThrow("last 2–4 characters");
    await expect(
      f.admin.action(api.signingInPerson.start, {
        agreementId: f.agreementId,
        participantKey: "viewer",
        documentType: "passport",
        documentEnding: "AB12",
        attested: true,
      }),
    ).rejects.toThrow("no active invitation");
    const first = await f.admin.action(api.signingInPerson.start, {
      agreementId: f.agreementId,
      participantKey: "tenant",
      documentType: "sa_id",
      documentEnding: "0871",
      attested: true,
    });
    const kiosk = await f.admin.action(api.signingInPerson.start, {
      agreementId: f.agreementId,
      participantKey: "tenant",
      documentType: "sa_id",
      documentEnding: "0871",
      attested: true,
    });
    expect(kiosk.expiresAt - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    // A newer check replaces the unused one; each kiosk link works once.
    expect((await f.call("kiosk_exchange", first.credential)).ok).toBe(false);
    const exchanged = await f.call("kiosk_exchange", kiosk.credential);
    expect(exchanged).toMatchObject({
      ok: true,
      recipient: expect.stringContaining("***"),
    });
    expect((await f.call("kiosk_exchange", kiosk.credential)).ok).toBe(false);
    const challenge = exchanged.challengeCredential as string;
    // Staff never receive the code: it is sealed into a delivery to the participant's own address.
    expect(
      (await f.call("verify_code", challenge, { code: "00000000" })).ok,
    ).toBe(false);
    expect((await f.call("request_code", challenge)).ok).toBe(true);
    const info = await f.t.query(internal.signingAccessState.challenge, {
      challengeHash: await credentialHash("challenge", challenge),
    });
    const delivery = (await f.t.run((ctx) =>
      ctx.db.get(info!.challenge.deliveryId!),
    ))!;
    const mail = (await openEmail(
      master,
      delivery.deliveryKey,
      "otp",
      delivery.sealed!,
    )) as {
      code: string;
      to: string[];
    };
    expect(JSON.stringify(mail)).toContain("tenant@example.test");
    const verified = await f.call("verify_code", challenge, {
      code: mail.code,
    });
    expect(verified.ok).toBe(true);
    const credential = verified.sessionCredential as string;
    expect((await f.call("session", credential)).authMethod).toBe(
      "in_person_email_otp",
    );
    const { sig, ini, portal } = await f.prepared(credential);
    const saved = await f.call("save_draft", credential, {
      expectedRevision: 0,
      values: {
        "t-sig": sig,
        "t-ini-1": ini,
        "t-ini-2": ini,
        "t-units": "2",
        "t-ack": "true",
      },
    });
    expect((await f.submit(credential, portal, saved.draft.revision)).ok).toBe(
      true,
    );
    const row = (await f.t.run((ctx) =>
      ctx.db.query("signingSubmissions").first(),
    ))!;
    const evidence = JSON.parse(row.evidence);
    expect(evidence.authentication).toMatchObject({
      method: "in_person_email_otp",
      inPerson: {
        documentType: "sa_id",
        documentEnding: "0871",
        checkedBy: f.userId,
      },
    });
    const events = await f.t.run((ctx) =>
      ctx.db.query("signingEvents").collect(),
    );
    const prepared = events.find(
      (e) => e.eventType === "in_person_session_prepared",
    );
    expect(prepared?.payload).toContain("sa_id");
    expect(prepared?.payload).not.toContain("0871");
  });

  test("supporting documents are scanned before use and opened by staff only with a logged reason", async () => {
    const f = await fixture({ extraFields: [proofField] });
    const credential = await f.session("tenant");
    const { sig, ini, portal } = await f.prepared(credential);
    const digest = "d".repeat(64);
    const calls = stubWorker(clean(digest));
    const form = await f.call("attachment_form", credential, {
      fieldKey: "t-proof",
      filename: "../proof<script>.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
    });
    expect(form).toMatchObject({
      ok: true,
      url: "https://storage.example.test/quarantine",
    });
    for (const bad of [
      { fieldKey: "t-note", contentType: "application/pdf", sizeBytes: 10 },
      { fieldKey: "t-proof", contentType: "text/html", sizeBytes: 10 },
      {
        fieldKey: "t-proof",
        contentType: "image/png",
        sizeBytes: 11 * 1024 * 1024,
      },
    ])
      expect(
        (await f.call("attachment_form", credential, { filename: "x", ...bad }))
          .ok,
      ).toBe(false);
    // An unscanned upload cannot be placed in the field.
    expect(
      (
        await f.call("save_draft", credential, {
          expectedRevision: 0,
          values: { "t-proof": digest },
        })
      ).ok,
    ).toBe(false);
    const done = await f.call("attachment_complete", credential, {
      attachmentId: form.attachmentId,
    });
    expect(done).toMatchObject({
      ok: true,
      sha256: digest,
      filename: ".._proof_script_.pdf",
    });
    expect(calls.map((c) => c.operation)).toEqual([
      "attachment_upload",
      "attachment_scan",
    ]);
    const saved = await f.call("save_draft", credential, {
      expectedRevision: 0,
      values: {
        "t-sig": sig,
        "t-ini-1": ini,
        "t-ini-2": ini,
        "t-units": "2",
        "t-ack": "true",
        "t-proof": digest,
      },
    });
    expect(saved.ok).toBe(true);
    expect((await f.submit(credential, portal, saved.draft.revision)).ok).toBe(
      true,
    );
    const row = (await f.t.run((ctx) =>
      ctx.db.query("signingSubmissions").first(),
    ))!;
    expect(JSON.parse(row.evidence).values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "t-proof", attachmentHash: digest }),
      ]),
    );
    const attachmentId = form.attachmentId as Id<"signingAttachments">;
    await expect(
      f.admin.action(api.signingAttachments.open, {
        attachmentId,
        reason: "look",
      }),
    ).rejects.toThrow("at least 10 characters");
    const link = await f.admin.action(api.signingAttachments.open, {
      attachmentId,
      reason: "Verify proof of address for lease vetting",
    });
    expect(link.url).toBe("https://storage.example.test/retained");
    const accessed = (
      await f.t.run((ctx) => ctx.db.query("signingEvents").collect())
    ).filter((e) => e.eventType === "supporting_document_accessed");
    expect(accessed).toHaveLength(1);
    expect(accessed[0].payload).toContain("Verify proof of address");
    expect(accessed[0].actorId).toBe(f.userId);
  });

  test("malware and mislabelled files are rejected; scanner outages stay retryable", async () => {
    const f = await fixture({ extraFields: [proofField] });
    const credential = await f.session("tenant");
    await f.prepared(credential);
    let outcome: Record<string, unknown> = {
      status: "blocked",
      error: "scanner_unavailable",
    };
    stubWorker(() => outcome);
    const form = await f.call("attachment_form", credential, {
      fieldKey: "t-proof",
      filename: "proof.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
    });
    const retry = await f.call("attachment_complete", credential, {
      attachmentId: form.attachmentId,
    });
    expect(retry).toMatchObject({ ok: false, status: 503 });
    const pending = await f.t.run((ctx) =>
      ctx.db.query("signingAttachments").first(),
    );
    expect(pending?.status).toBe("pending");
    outcome = { status: "blocked", error: "malware_detected" };
    expect(
      (
        await f.call("attachment_complete", credential, {
          attachmentId: form.attachmentId,
        })
      ).ok,
    ).toBe(false);
    const rejected = await f.t.run((ctx) =>
      ctx.db.query("signingAttachments").first(),
    );
    expect(rejected?.status).toBe("rejected");
    await expect(
      f.admin.action(api.signingAttachments.open, {
        attachmentId: rejected!._id,
        reason: "Trying to open a rejected upload",
      }),
    ).rejects.toThrow("Only scanned, accepted");
    const list = await f.admin.query(api.signingAttachments.list, {
      agreementId: f.agreementId,
    });
    expect(list[0]).toMatchObject({
      status: "rejected",
      purpose: "proof_of_address",
    });
    expect(list[0]).not.toHaveProperty("storageVersion");
  });
});
