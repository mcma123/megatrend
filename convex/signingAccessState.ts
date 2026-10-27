import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  consumeRate,
  accessibleInvitation,
  validInvitation,
  validSession,
  maskedEmail,
  insertDelivery,
  CHALLENGE_LIFETIME,
  OTP_LIFETIME,
  SESSION_LIFETIME,
  type MailDraft,
} from "./lib/signingInvitations";
import { constantEqual } from "./lib/signingAccessCrypto";
import { appendSigningEvent } from "./lib/signingAudit";

export const pruneRate = internalMutation({
  args: { rateId: v.id("signingAccessRates") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.rateId);
    if (row && row.expiresAt < Date.now()) await ctx.db.delete(row._id);
    return null;
  },
});
export const accessRate = internalMutation({
  args: { networkKey: v.string(), operation: v.string() },
  handler: async (ctx, args) =>
    consumeRate(
      ctx,
      `access:${args.operation}:${args.networkKey}`,
      30,
      15 * 60_000,
    ),
});
export const exchange = internalMutation({
  args: {
    invitationHash: v.string(),
    challengeHash: v.string(),
    keyId: v.string(),
    networkKey: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      !(await consumeRate(ctx, `exchange:${args.networkKey}`, 20, 15 * 60_000))
    )
      return {
        ok: false as const,
        error: "Please wait before trying access again",
      };
    const invite = await ctx.db
      .query("signingInvitations")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.invitationHash))
      .unique();
    const access = await accessibleInvitation(ctx, invite);
    if (!access || !invite || invite.lockedUntil > Date.now())
      return {
        ok: false as const,
        error:
          "This invitation is unavailable. Ask the company for a current link",
      };
    if (
      !(await consumeRate(
        ctx,
        `exchange-invite:${invite._id}`,
        10,
        15 * 60_000,
      ))
    )
      return {
        ok: false as const,
        error: "Please wait before trying access again",
      };
    const expiresAt = Math.min(
      Date.now() + CHALLENGE_LIFETIME,
      access.accessUntil,
    );
    await ctx.db.insert("signingAccessChallenges", {
      invitationId: invite._id,
      invitationVersion: invite.version,
      tokenHash: args.challengeHash,
      expiresAt,
      generation: 0,
      keyId: args.keyId,
      state: "pending",
      lastRequestedAt: 0,
      failedAttempts: 0,
    });
    return {
      ok: true as const,
      expiresAt,
      recipient: maskedEmail(access.party.email),
    };
  },
});
/** Kiosk start: a staff-prepared, single-use credential opens the same mailbox verification. */
export const kioskExchange = internalMutation({
  args: {
    kioskHash: v.string(),
    challengeHash: v.string(),
    keyId: v.string(),
    networkKey: v.string(),
  },
  handler: async (ctx, args) => {
    const unavailable = {
      ok: false as const,
      error:
        "This in-person session link is unavailable. Ask staff to start a new one",
    };
    if (
      !(await consumeRate(ctx, `exchange:${args.networkKey}`, 20, 15 * 60_000))
    )
      return {
        ok: false as const,
        error: "Please wait before trying access again",
      };
    const check = await ctx.db
      .query("signingInPersonChecks")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.kioskHash))
      .unique();
    if (
      !check ||
      check.usedAt !== undefined ||
      check.revokedAt !== undefined ||
      check.expiresAt <= Date.now()
    )
      return unavailable;
    const invite = await ctx.db.get(check.invitationId);
    const access = await validInvitation(ctx, invite);
    if (
      !invite ||
      !access ||
      invite.version !== check.invitationVersion ||
      invite.participantKey !== check.participantKey ||
      invite.lockedUntil > Date.now()
    )
      return unavailable;
    await ctx.db.patch(check._id, { usedAt: Date.now() });
    const expiresAt = Math.min(
      Date.now() + CHALLENGE_LIFETIME,
      invite.expiresAt,
    );
    await ctx.db.insert("signingAccessChallenges", {
      invitationId: invite._id,
      invitationVersion: invite.version,
      tokenHash: args.challengeHash,
      expiresAt,
      generation: 0,
      keyId: args.keyId,
      state: "pending",
      lastRequestedAt: 0,
      failedAttempts: 0,
      inPersonCheckId: check._id,
    });
    return {
      ok: true as const,
      expiresAt,
      recipient: maskedEmail(access.party.email),
    };
  },
});
export const challenge = internalQuery({
  args: { challengeHash: v.string() },
  handler: async (ctx, args) => {
    const challenge = await ctx.db
      .query("signingAccessChallenges")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.challengeHash))
      .unique();
    if (!challenge || challenge.expiresAt <= Date.now()) return null;
    const invite = await ctx.db.get(challenge.invitationId),
      access = await accessibleInvitation(ctx, invite);
    if (
      !invite ||
      !access ||
      invite.version !== challenge.invitationVersion ||
      invite.lockedUntil > Date.now()
    )
      return null;
    return { challenge, invite, tx: access.tx, party: access.party };
  },
});
export const requestCode = internalMutation({
  args: {
    challengeHash: v.string(),
    generation: v.number(),
    codeHash: v.string(),
    mail: v.any(),
    networkKey: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      !(await consumeRate(ctx, `otp-send:${args.networkKey}`, 10, 15 * 60_000))
    )
      return {
        ok: false as const,
        error: "Please wait before requesting another code",
      };
    const challenge = await ctx.db
      .query("signingAccessChallenges")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.challengeHash))
      .unique();
    const invite = challenge ? await ctx.db.get(challenge.invitationId) : null,
      access = await accessibleInvitation(ctx, invite);
    if (
      !challenge ||
      !invite ||
      !access ||
      challenge.state !== "pending" ||
      challenge.expiresAt <= Date.now() ||
      challenge.invitationVersion !== invite.version ||
      invite.lockedUntil > Date.now() ||
      challenge.generation !== args.generation
    )
      return {
        ok: false as const,
        error:
          "Verification is unavailable. Open the original invitation again",
      };
    if (
      Date.now() - Math.max(challenge.lastRequestedAt, invite.lastCodeAt ?? 0) <
      60_000
    )
      return {
        ok: false as const,
        error: "Wait one minute before requesting another code",
      };
    const prior = challenge.deliveryId
      ? await ctx.db.get(challenge.deliveryId)
      : null;
    if (
      prior &&
      ["queued", "submitting", "running", "unknown"].includes(prior.status)
    )
      return {
        ok: false as const,
        error:
          "The previous code delivery is still being checked. Please wait or contact the company",
      };
    if (!(await consumeRate(ctx, `otp-invite:${invite._id}`, 5, 60 * 60_000)))
      return {
        ok: false as const,
        error: "Code request limit reached. Try again later",
      };
    const mail = args.mail as MailDraft;
    if (
      mail.kind !== "otp" ||
      mail.participantKey !== invite.participantKey ||
      mail.invitationVersion !== invite.version
    )
      return { ok: false as const, error: "Verification delivery changed" };
    const deliveryId = await insertDelivery(ctx, invite, mail);
    const otpExpiresAt = Math.min(
      Date.now() + OTP_LIFETIME,
      challenge.expiresAt,
      access.accessUntil,
    );
    await ctx.db.patch(challenge._id, {
      generation: challenge.generation + 1,
      otpHash: args.codeHash,
      otpExpiresAt,
      lastRequestedAt: Date.now(),
      deliveryId,
    });
    await ctx.db.patch(invite._id, {
      lastCodeAt: Date.now(),
      ...(invite.lockedUntil > 0 && invite.lockedUntil <= Date.now()
        ? { lockedUntil: 0, failedAttempts: 0 }
        : {}),
    });
    return {
      ok: true as const,
      expiresAt: otpExpiresAt,
      retryAt: Date.now() + 60_000,
    };
  },
});
export const verifyCode = internalMutation({
  args: {
    challengeHash: v.string(),
    generation: v.number(),
    submittedHash: v.string(),
    sessionHash: v.string(),
    networkKey: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      !(await consumeRate(
        ctx,
        `otp-verify:${args.networkKey}`,
        30,
        15 * 60_000,
      ))
    )
      return {
        ok: false as const,
        error: "Verification attempt limit reached",
      };
    const challenge = await ctx.db
      .query("signingAccessChallenges")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.challengeHash))
      .unique();
    const invite = challenge ? await ctx.db.get(challenge.invitationId) : null,
      access = await accessibleInvitation(ctx, invite);
    if (
      !challenge ||
      !invite ||
      !access ||
      challenge.expiresAt <= Date.now() ||
      challenge.invitationVersion !== invite.version ||
      challenge.generation !== args.generation ||
      !challenge.otpHash ||
      (challenge.otpExpiresAt ?? 0) <= Date.now() ||
      invite.lockedUntil > Date.now() ||
      challenge.failedAttempts >= 5
    )
      return {
        ok: false as const,
        error:
          "The code is unavailable or expired. Open the invitation and request a new code",
      };
    if (!constantEqual(challenge.otpHash, args.submittedHash)) {
      const failed = invite.failedAttempts + 1;
      await ctx.db.patch(invite._id, {
        failedAttempts: failed,
        ...(failed >= 5 ? { lockedUntil: Date.now() + 15 * 60_000 } : {}),
      });
      await ctx.db.patch(challenge._id, {
        failedAttempts: challenge.failedAttempts + 1,
      });
      return {
        ok: false as const,
        error:
          failed >= 5
            ? "Verification locked. Wait fifteen minutes and reopen the invitation"
            : "The code is incorrect",
      };
    }
    if (challenge.state === "verified") {
      const existing =
        challenge.sessionHash === args.sessionHash
          ? await validSession(ctx, args.sessionHash)
          : null;
      return existing
        ? { ok: true as const, expiresAt: existing.session.expiresAt }
        : { ok: false as const, error: "This verification has already ended" };
    }
    const expiresAt = Math.min(
      Date.now() + SESSION_LIFETIME,
      access.accessUntil,
    );
    await ctx.db.insert("signingSignerSessions", {
      tokenHash: args.sessionHash,
      invitationId: invite._id,
      invitationVersion: invite.version,
      transactionId: access.tx._id,
      participantKey: invite.participantKey,
      preparationHash: access.tx.preparationHash,
      expiresAt,
      verifiedAt: Date.now(),
      authMethod: challenge.inPersonCheckId
        ? "in_person_email_otp"
        : "email_otp",
      ...(challenge.inPersonCheckId
        ? { inPersonCheckId: challenge.inPersonCheckId }
        : {}),
    });
    await ctx.db.patch(challenge._id, {
      state: "verified",
      verifiedAt: Date.now(),
      sessionHash: args.sessionHash,
    });
    await ctx.db.patch(invite._id, {
      verifiedAt: Date.now(),
      failedAttempts: 0,
      lockedUntil: 0,
    });
    await ctx.db.insert("signingAccessEvents", {
      transactionId: access.tx._id,
      invitationId: invite._id,
      eventType: "email_verified",
      occurredAt: Date.now(),
      invitationVersion: invite.version,
    });
    await appendSigningEvent(
      ctx,
      access.agreement,
      undefined,
      "participant_email_verified",
      {
        invitationId: invite._id,
        version: invite.version,
        transactionId: access.tx._id,
        ...(challenge.inPersonCheckId
          ? { inPersonCheckId: challenge.inPersonCheckId }
          : {}),
      },
      { actorKind: "signer", participantKey: invite.participantKey },
    );
    return { ok: true as const, expiresAt };
  },
});
export const session = internalQuery({
  args: { sessionHash: v.string() },
  handler: async (ctx, args) => {
    const access = await validSession(ctx, args.sessionHash);
    if (!access) return { ok: false as const };
    return {
      ok: true as const,
      expiresAt: access.session.expiresAt,
      companyName: access.tx.companyName,
      title: access.tx.title,
      role: access.party.role,
      responsibility: access.party.responsibility,
      reference: access.tx.reference,
      authMethod: access.session.authMethod,
    };
  },
});
export const logout = internalMutation({
  args: { sessionHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("signingSignerSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.sessionHash))
      .unique();
    if (row && row.revokedAt === undefined)
      await ctx.db.patch(row._id, { revokedAt: Date.now() });
    return { ok: true as const };
  },
});
