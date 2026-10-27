import { v, ConvexError } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  env,
} from "./_generated/server";
import { signingSession, requireSigningMfa } from "./lib/signingSecurity";

export const forAction = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { user, sessionId } = await signingSession(ctx);
    const credential = await ctx.db
      .query("signingMfa")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    return {
      userId: user._id,
      email: user.email ?? "Administrator",
      sessionId,
      credential,
    };
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    const { user, sessionId } = await signingSession(ctx);
    const credential = await ctx.db
      .query("signingMfa")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    const grant = await ctx.db
      .query("signingMfaGrants")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    const recent = Boolean(
      credential?.enabled &&
      credential.lockedUntil <= Date.now() &&
      grant?.userId === user._id &&
      grant?.credentialVersion === credential.credentialVersion &&
      grant.expiresAt > Date.now(),
    );
    return {
      configured: Boolean(
        env.SIGNING_MFA_KEYS_JSON && env.SIGNING_MFA_ACTIVE_KEY_ID,
      ),
      enrolled: credential?.enabled ?? false,
      recent,
      expiresAt: recent ? grant!.expiresAt : null,
      recoveryCodesRemaining: credential?.enabled
        ? credential.recoveryHashes.length
        : 0,
    };
  },
});

export const storeEnrollment = internalMutation({
  args: {
    expectedVersion: v.union(v.string(), v.null()),
    credentialVersion: v.string(),
    keyId: v.string(),
    encryptedSecret: v.string(),
    recoveryHashes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await signingSession(ctx);
    const previous = await ctx.db
      .query("signingMfa")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (
      previous?.enabled ||
      (previous?.credentialVersion ?? null) !== args.expectedVersion
    )
      throw new ConvexError(
        "Authenticator setup changed. Reload and try again",
      );
    // Replacing an unconfirmed enrollment cannot reset brute-force counters.
    const data = {
      userId: user._id,
      credentialVersion: args.credentialVersion,
      keyId: args.keyId,
      encryptedSecret: args.encryptedSecret,
      recoveryHashes: args.recoveryHashes,
      enabled: false,
      enrollmentExpiresAt: Date.now() + 600_000,
      failedAttempts: previous?.failedAttempts ?? 0,
      lockedUntil: previous?.lockedUntil ?? 0,
      lastAttemptAt: previous?.lastAttemptAt ?? 0,
    };
    if (previous) await ctx.db.replace(previous._id, data);
    else await ctx.db.insert("signingMfa", data);
    await ctx.db.insert("signingSecurityEvents", {
      userId: user._id,
      eventType: "mfa_enrollment_started",
      occurredAt: Date.now(),
    });
    return null;
  },
});

export const claimVerification = internalMutation({
  args: { claimId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await signingSession(ctx);
    const row = await ctx.db
      .query("signingMfa")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    const now = Date.now();
    if (!row || (!row.enabled && row.enrollmentExpiresAt <= now))
      return {
        ok: false as const,
        error: "Authenticator setup expired. Start setup again",
      };
    if (
      row.lockedUntil > now ||
      now - row.lastAttemptAt < 1000 ||
      (row.claimExpiresAt ?? 0) > now
    )
      return {
        ok: false as const,
        error: "Too many attempts. Wait before trying again",
      };
    await ctx.db.patch(row._id, {
      claimId: args.claimId,
      claimExpiresAt: now + 30_000,
      lastAttemptAt: now,
    });
    return { ok: true as const, credential: row };
  },
});

export const finishVerification = internalMutation({
  args: {
    claimId: v.string(),
    credentialVersion: v.string(),
    acceptedStep: v.optional(v.number()),
    recoveryHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, sessionId } = await signingSession(ctx);
    const row = await ctx.db
      .query("signingMfa")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    const now = Date.now();
    if (
      !row ||
      row.credentialVersion !== args.credentialVersion ||
      row.claimId !== args.claimId ||
      (row.claimExpiresAt ?? 0) <= now
    )
      return { ok: false, error: "Verification expired. Try again" };
    const stepOk =
      args.acceptedStep !== undefined &&
      Number.isSafeInteger(args.acceptedStep) &&
      args.acceptedStep > (row.lastAcceptedStep ?? -1);
    const recoveryOk =
      row.enabled &&
      args.recoveryHash !== undefined &&
      row.recoveryHashes.includes(args.recoveryHash);
    if (
      (!row.enabled && row.enrollmentExpiresAt <= now) ||
      (!stepOk && !recoveryOk)
    ) {
      const failures = row.failedAttempts + 1;
      await ctx.db.patch(row._id, {
        failedAttempts: failures,
        lockedUntil: failures >= 5 ? now + 900_000 : 0,
        claimId: undefined,
        claimExpiresAt: undefined,
      });
      await ctx.db.insert("signingSecurityEvents", {
        userId: user._id,
        eventType: "mfa_verification_failed",
        occurredAt: now,
      });
      // Return instead of throwing so failed-attempt accounting is committed.
      return { ok: false, error: "Invalid or already used authenticator code" };
    }
    await ctx.db.patch(row._id, {
      enabled: true,
      failedAttempts: 0,
      lockedUntil: 0,
      claimId: undefined,
      claimExpiresAt: undefined,
      ...(stepOk ? { lastAcceptedStep: args.acceptedStep } : {}),
      recoveryHashes: recoveryOk
        ? row.recoveryHashes.filter((hash) => hash !== args.recoveryHash)
        : row.recoveryHashes,
    });
    const grant = await ctx.db
      .query("signingMfaGrants")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    const data = {
      userId: user._id,
      sessionId,
      credentialVersion: row.credentialVersion,
      expiresAt: now + 300_000,
    };
    if (grant) await ctx.db.replace(grant._id, data);
    else await ctx.db.insert("signingMfaGrants", data);
    await ctx.db.insert("signingSecurityEvents", {
      userId: user._id,
      eventType: !row.enabled
        ? "mfa_enabled"
        : recoveryOk
          ? "mfa_recovery_used"
          : "mfa_verified",
      occurredAt: now,
    });
    return { ok: true, error: null };
  },
});

export const resetEnrollment = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireSigningMfa(ctx);
    const row = await ctx.db
      .query("signingMfa")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (row) await ctx.db.delete(row._id);
    // Old grants cannot match the next randomly generated credentialVersion.
    await ctx.db.insert("signingSecurityEvents", {
      userId: user._id,
      eventType: "mfa_reset",
      occurredAt: Date.now(),
    });
    return null;
  },
});
