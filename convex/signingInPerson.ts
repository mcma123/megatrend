import { ConvexError, v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { identityDocument } from "./lib/signing";
import { credentialHash, secretToken } from "./lib/signingAccessCrypto";
import { appendSigningEvent } from "./lib/signingAudit";
import { validInvitation } from "./lib/signingInvitations";
import { getAgreement, requireSigningWriter } from "./signing";

export const IN_PERSON_LIFETIME = 15 * 60_000;

/**
 * Staff record an identity check and receive a single-use kiosk link for that participant.
 * The kiosk still sends the one-time code to the participant's own mailbox, so staff cannot
 * act for the participant; the check is bound into the participant's signing evidence.
 */
export const start = action({
  args: {
    agreementId: v.id("signingAgreements"),
    participantKey: v.string(),
    documentType: identityDocument,
    documentEnding: v.string(),
    attested: v.literal(true),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ credential: string; expiresAt: number }> => {
    const credential = secretToken();
    const expiresAt: number = await ctx.runMutation(
      internal.signingInPerson.commitStart,
      {
        ...args,
        tokenHash: await credentialHash("in_person", credential),
      },
    );
    return { credential, expiresAt };
  },
});

export const commitStart = internalMutation({
  args: {
    agreementId: v.id("signingAgreements"),
    participantKey: v.string(),
    documentType: identityDocument,
    documentEnding: v.string(),
    attested: v.literal(true),
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const user = await requireSigningWriter(ctx, agreement.tenantId);
    const ending = args.documentEnding.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,4}$/.test(ending))
      throw new ConvexError(
        "Record only the last 2–4 characters of the identity document",
      );
    if (!agreement.signingTransactionId)
      throw new ConvexError(
        "Only issued agreements can start an in-person session",
      );
    const invites = await ctx.db
      .query("signingInvitations")
      .withIndex("by_transactionId", (q) =>
        q.eq("transactionId", agreement.signingTransactionId!),
      )
      .take(21);
    const invite = invites.find(
      (row) =>
        row.participantKey === args.participantKey && row.status === "active",
    );
    const access = await validInvitation(ctx, invite ?? null);
    if (
      !invite ||
      !access ||
      access.agreement._id !== agreement._id ||
      !["signer", "approver"].includes(access.party.responsibility)
    )
      throw new ConvexError(
        "This participant has no active invitation in the current signing stage",
      );
    if (invite.lockedUntil > Date.now())
      throw new ConvexError(
        "Verification is locked for this participant. Try again later",
      );
    // One live kiosk link per invitation; a new check replaces any unused one.
    const prior = await ctx.db
      .query("signingInPersonChecks")
      .withIndex("by_invitationId", (q) => q.eq("invitationId", invite._id))
      .take(50);
    for (const row of prior)
      if (row.usedAt === undefined && row.revokedAt === undefined)
        await ctx.db.patch(row._id, { revokedAt: Date.now() });
    const expiresAt = Math.min(
      Date.now() + IN_PERSON_LIFETIME,
      invite.expiresAt,
    );
    const checkId = await ctx.db.insert("signingInPersonChecks", {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      transactionId: invite.transactionId,
      invitationId: invite._id,
      invitationVersion: invite.version,
      participantKey: invite.participantKey,
      tokenHash: args.tokenHash,
      expiresAt,
      staffUserId: user._id,
      documentType: args.documentType,
      documentEnding: ending,
      createdAt: Date.now(),
    });
    await appendSigningEvent(
      ctx,
      agreement,
      user._id,
      "in_person_session_prepared",
      {
        checkId,
        participantKey: invite.participantKey,
        invitationVersion: invite.version,
        documentType: args.documentType,
      },
    );
    return expiresAt;
  },
});
