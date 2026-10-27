/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  signingTotp,
  encryptMfa,
  decryptMfa,
  mfaKey,
} from "./lib/signingMfaCrypto";
const modules = import.meta.glob("./**/*.ts");

async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T12:00:01Z"));
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", "admin@mfa.test");
  vi.stubEnv(
    "SIGNING_MFA_KEYS_JSON",
    JSON.stringify({ test: "11".repeat(32) }),
  );
  vi.stubEnv("SIGNING_MFA_ACTIVE_KEY_ID", "test");
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "admin@mfa.test" });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 3_600_000,
    });
    const otherSessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 3_600_000,
    });
    const tenantId = await ctx.db.insert("tenants", {
      slug: "mfa",
      displayName: "MFA test",
      status: "active",
      primaryRegion: "ZA",
      createdAt: Date.now(),
      createdBy: userId,
    });
    return { userId, sessionId, otherSessionId, tenantId };
  });
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: `${ids.userId}|${ids.sessionId}` }),
    other: t.withIdentity({ subject: `${ids.userId}|${ids.otherSessionId}` }),
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("MFA encrypts enrollment, validates a real TOTP, and binds the grant to one live session", async () => {
  const { t, admin, other, userId, sessionId } = await setup();
  const enrollment = await admin.action(api.signingMfa.beginEnrollment, {});
  const row = await t.run((ctx) =>
    ctx.db
      .query("signingMfa")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique(),
  );
  expect(row?.encryptedSecret).not.toContain(enrollment.secret);
  expect((await admin.query(api.signingMfaState.status, {})).recent).toBe(
    false,
  );
  const code = signingTotp(enrollment.secret).generate({
    timestamp: Date.now(),
  });
  expect(await admin.action(api.signingMfa.verify, { code })).toMatchObject({
    ok: true,
  });
  expect((await admin.query(api.signingMfaState.status, {})).recent).toBe(true);
  expect((await other.query(api.signingMfaState.status, {})).recent).toBe(
    false,
  );
  await t.run((ctx) => ctx.db.delete(sessionId));
  await expect(admin.query(api.signingMfaState.status, {})).rejects.toThrow(
    /session/,
  );
});

test("failed attempts commit, lockout survives enrollment replacement, and unverified sessions cannot write", async () => {
  const { admin, tenantId } = await setup();
  const enrollment = await admin.action(api.signingMfa.beginEnrollment, {});
  for (let n = 0; n < 5; n++) {
    vi.setSystemTime(Date.now() + 1100);
    expect(
      (await admin.action(api.signingMfa.verify, { code: "not-a-code" })).ok,
    ).toBe(false);
  }
  await admin.action(api.signingMfa.beginEnrollment, {});
  expect(
    (
      await admin.action(api.signingMfa.verify, {
        code: signingTotp(enrollment.secret).generate(),
      })
    ).error,
  ).toMatch(/Too many/);
  await expect(
    admin.mutation(api.signing.createDraft, {
      tenantId,
      requestId: "requires-stepup",
      draft: {
        title: "Draft",
        category: "general_contract",
        notes: "",
        participants: [],
      },
    }),
  ).rejects.toThrow(/authenticator/);
});

test("a successful MFA grant expires after five minutes and cannot authorise a later write", async () => {
  const { admin, tenantId } = await setup();
  const enrollment = await admin.action(api.signingMfa.beginEnrollment, {});
  expect(
    (
      await admin.action(api.signingMfa.verify, {
        code: signingTotp(enrollment.secret).generate(),
      })
    ).ok,
  ).toBe(true);
  vi.setSystemTime(Date.now() + 300001);
  expect((await admin.query(api.signingMfaState.status, {})).recent).toBe(
    false,
  );
  await expect(
    admin.mutation(api.signing.createDraft, {
      tenantId,
      requestId: "expired-mfa-grant",
      draft: {
        title: "Draft",
        category: "general_contract",
        notes: "",
        participants: [],
      },
    }),
  ).rejects.toThrow(/authenticator/);
});

test("codes cannot be replayed; recovery is one-time; expiry and reset invalidate old grants", async () => {
  const { admin, other } = await setup();
  const enrollment = await admin.action(api.signingMfa.beginEnrollment, {});
  const code = signingTotp(enrollment.secret).generate();
  expect((await admin.action(api.signingMfa.verify, { code })).ok).toBe(true);
  vi.setSystemTime(Date.now() + 1100);
  expect((await other.action(api.signingMfa.verify, { code })).ok).toBe(false);
  vi.setSystemTime(Date.now() + 1100);
  expect(
    (
      await other.action(api.signingMfa.verify, {
        code: enrollment.recoveryCodes[0],
      })
    ).ok,
  ).toBe(true);
  vi.setSystemTime(Date.now() + 1100);
  expect(
    (
      await admin.action(api.signingMfa.verify, {
        code: enrollment.recoveryCodes[0],
      })
    ).ok,
  ).toBe(false);
  expect(
    (await admin.query(api.signingMfaState.status, {})).recoveryCodesRemaining,
  ).toBe(7);
  await other.action(api.signingMfa.reset, {});
  expect((await admin.query(api.signingMfaState.status, {})).recent).toBe(
    false,
  );
  await admin.action(api.signingMfa.beginEnrollment, {});
  expect((await other.query(api.signingMfaState.status, {})).recent).toBe(
    false,
  );
  vi.setSystemTime(Date.now() + 601_000);
  expect((await admin.action(api.signingMfa.verify, { code })).error).toMatch(
    /expired/,
  );
});

test("stale verification claims cannot enable a replaced credential", async () => {
  const { admin } = await setup();
  await admin.action(api.signingMfa.beginEnrollment, {});
  const claim = await admin.mutation(
    internal.signingMfaState.claimVerification,
    { claimId: "test-claim" },
  );
  if (!claim.ok) throw new Error("Expected claim");
  await admin.action(api.signingMfa.beginEnrollment, {});
  expect(
    (
      await admin.mutation(internal.signingMfaState.finishVerification, {
        claimId: "test-claim",
        credentialVersion: claim.credential.credentialVersion,
        acceptedStep: Math.floor(Date.now() / 30000),
      })
    ).ok,
  ).toBe(false);
});

test("AES-GCM rejects altered ciphertext, wrong users and missing key configuration", () => {
  const key = mfaKey(JSON.stringify({ test: "ab".repeat(32) }), "test");
  const sealed = encryptMfa("TESTSECRET", key, "user-one");
  expect(decryptMfa(sealed, key, "user-one")).toBe("TESTSECRET");
  expect(() => decryptMfa(sealed, key, "user-two")).toThrow(
    /could not be read/,
  );
  const changed = Buffer.from(sealed, "base64");
  changed[30] ^= 1;
  expect(() => decryptMfa(changed.toString("base64"), key, "user-one")).toThrow(
    /could not be read/,
  );
  expect(() => mfaKey(undefined, undefined)).toThrow(/not configured/);
});

test("signing TOTP configuration matches the RFC 6238 SHA-1 test vector", () => {
  const totp = signingTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  expect(totp.generate({ timestamp: 59000 })).toBe("287082");
});
