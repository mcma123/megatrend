import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { signingFileAccess } from "./lib/signingFileAccess";
import { requireSigningMfa } from "./lib/signingSecurity";
import {
  createIssuedTransaction,
  insertDelivery,
  hasUnresolvedDelivery,
  parseFrozen,
  REMINDER_INTERVAL,
  validInvitation,
  type MailDraft,
} from "./lib/signingInvitations";
import { assertRelease, releaseBlockers } from "./lib/signingRelease";
import { requireSigningWriter } from "./signing";
import { credentialHash } from "./lib/signingAccessCrypto";
import {
  accessKeys,
  makeEmail,
  regenerateInvitation,
} from "./signingEmailPayloads";
import { appendSigningEvent } from "./lib/signingAudit";
import { boundedText } from "./lib/signing";
type InviteContext = {
  agreement: Doc<"signingAgreements">;
  frozen: Doc<"signingFrozenPreparations">;
  actorId: Doc<"users">["_id"];
  companyName: string;
};

export const replayIssue = internalQuery({
  args: {
    agreementId: v.id("signingAgreements"),
    frozenId: v.id("signingFrozenPreparations"),
    requestId: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { agreement, user } = await signingFileAccess(ctx, args.agreementId);
    await requireSigningMfa(ctx);
    const prior = await ctx.db
      .query("signingTransactions")
      .withIndex("by_agreementId", (q) => q.eq("agreementId", agreement._id))
      .unique();
    if (!prior) return null;
    if (
      prior.requestId !== args.requestId ||
      prior.createdBy !== user._id ||
      prior.expiresAt !== args.expiresAt ||
      prior.frozenPreparationId !== args.frozenId
    )
      throw new ConvexError(
        "This agreement already has a different signing transaction",
      );
    return prior._id;
  },
});

export const context = internalQuery({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const { agreement, user } = await signingFileAccess(ctx, args.agreementId);
    await requireSigningWriter(ctx, agreement.tenantId);
    const review: {
      approvalCurrent: boolean;
      decision: Doc<"signingApprovalDecisions"> | null;
    } = await ctx.runQuery(api.signing.get, args);
    const frozen = agreement.frozenPreparationId
      ? await ctx.db.get(agreement.frozenPreparationId)
      : null;
    const company = await ctx.db.get(agreement.tenantId);
    if (
      !company ||
      company.status !== "active" ||
      !frozen ||
      !review.approvalCurrent ||
      review.decision?.decision !== "approved" ||
      agreement.status !== "ready_to_send"
    )
      throw new ConvexError(
        "Current frozen approval in an active company is required",
      );
    await assertRelease(ctx, agreement.tenantId, {
      category: agreement.category,
      recipients: parseFrozen(frozen).participants.map((p) => p.email),
    });
    return {
      agreement,
      frozen,
      actorId: user._id,
      companyName: company.displayName,
    };
  },
});
export const commitIssue = internalMutation({
  args: {
    agreementId: v.id("signingAgreements"),
    frozenId: v.id("signingFrozenPreparations"),
    requestId: v.string(),
    reference: v.string(),
    expiresAt: v.number(),
    keyId: v.string(),
    nonces: v.array(v.string()),
    tokenHashes: v.array(v.string()),
    emails: v.any(),
  },
  handler: async (ctx, args): Promise<Doc<"signingTransactions">["_id"]> => {
    const prior: Doc<"signingTransactions">["_id"] | null = await ctx.runQuery(
      internal.signingInvitations.replayIssue,
      {
        agreementId: args.agreementId,
        frozenId: args.frozenId,
        requestId: args.requestId,
        expiresAt: args.expiresAt,
      },
    );
    if (prior) return prior;
    const context: {
      agreement: Doc<"signingAgreements">;
      frozen: Doc<"signingFrozenPreparations">;
      actorId: Doc<"users">["_id"];
      companyName: string;
    } = await ctx.runQuery(internal.signingInvitations.context, {
      agreementId: args.agreementId,
    });
    if (context.frozen._id !== args.frozenId)
      throw new ConvexError("Frozen preparation changed");
    return createIssuedTransaction(ctx, {
      ...context,
      ...args,
      emails: args.emails as MailDraft[],
    });
  },
});
export const send = action({
  args: {
    agreementId: v.id("signingAgreements"),
    frozenId: v.id("signingFrozenPreparations"),
    requestId: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args): Promise<Doc<"signingTransactions">["_id"]> => {
    const prior: Doc<"signingTransactions">["_id"] | null = await ctx.runQuery(
      internal.signingInvitations.replayIssue,
      args,
    );
    if (prior) return prior;
    const info: InviteContext = await ctx.runQuery(
      internal.signingInvitations.context,
      { agreementId: args.agreementId },
    );
    if (
      !/^[A-Za-z0-9_-]{8,100}$/.test(args.requestId) ||
      info.frozen._id !== args.frozenId
    )
      throw new ConvexError(
        "Review the current frozen preparation before sending",
      );
    const ring = accessKeys(),
      reference = crypto.randomUUID(),
      parties = parseFrozen(info.frozen).participants,
      nonces = parties.map(() => crypto.randomUUID());
    const tokens = await Promise.all(
      parties.map((party, index) =>
        regenerateInvitation({
          keyId: ring.active,
          reference,
          preparationHash: info.frozen.preparationHash,
          participantKey: party.key,
          version: 1,
          nonce: nonces[index],
        }),
      ),
    );
    const emails = await Promise.all(
      parties.map((party, index) =>
        makeEmail({
          kind: "invitation",
          participantKey: party.key,
          version: 1,
          recipient: party.email,
          companyName: info.companyName,
          title: info.agreement.title,
          expiresAt: args.expiresAt,
          credential: tokens[index],
        }),
      ),
    );
    return ctx.runMutation(internal.signingInvitations.commitIssue, {
      ...args,
      reference,
      keyId: ring.active,
      nonces,
      tokenHashes: await Promise.all(
        tokens.map((token) => credentialHash("invitation", token)),
      ),
      emails,
    });
  },
});

export const reissueContext = internalQuery({
  args: { invitationId: v.id("signingInvitations") },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.invitationId);
    if (!invite) throw new ConvexError("Invitation not found");
    const { agreement } = await signingFileAccess(ctx, invite.agreementId);
    await requireSigningWriter(ctx, agreement.tenantId);
    const tx = await ctx.db.get(invite.transactionId),
      frozen = await ctx.db.get(invite.frozenPreparationId);
    if (
      !tx ||
      tx.status !== "active" ||
      tx.expiresAt <= Date.now() ||
      invite.expiresAt <= Date.now() ||
      !frozen ||
      invite.status === "completed" ||
      !(await validInvitation(ctx, { ...invite, status: "active" }))
    )
      throw new ConvexError(
        "Transaction is unavailable; expired agreements require an authorized extension",
      );
    const party = parseFrozen(frozen).participants.find(
      (p) => p.key === invite.participantKey,
    );
    if (
      !party ||
      party.responsibility === "copy" ||
      (party.responsibility !== "viewer" && party.stage !== tx.currentStage)
    )
      throw new ConvexError("Participant is not currently eligible");
    await assertRelease(ctx, agreement.tenantId, {
      category: agreement.category,
      recipients: [party.email],
    });
    return { invite, tx, party };
  },
});
export const commitReissue = internalMutation({
  args: {
    invitationId: v.id("signingInvitations"),
    expectedVersion: v.number(),
    nonce: v.string(),
    keyId: v.string(),
    tokenHash: v.string(),
    reason: v.string(),
    mail: v.any(),
  },
  handler: async (ctx, args) => {
    const info: {
      invite: Doc<"signingInvitations">;
      tx: Doc<"signingTransactions">;
    } = await ctx.runQuery(internal.signingInvitations.reissueContext, {
      invitationId: args.invitationId,
    });
    if (info.invite.version !== args.expectedVersion)
      throw new ConvexError("Invitation changed before reissue");
    const { agreement, user } = await signingFileAccess(
      ctx,
      info.invite.agreementId,
    );
    const reason = boundedText(args.reason, "Reissue reason", 1000);
    await ctx.db.patch(info.invite._id, {
      version: info.invite.version + 1,
      nonce: args.nonce,
      keyId: args.keyId,
      tokenHash: args.tokenHash,
      status: "active",
      revokedAt: undefined,
      revocationReason: undefined,
      verifiedAt: undefined,
      lastEmailAt: Date.now(),
      failedAttempts: 0,
      lockedUntil: 0,
    });
    const invite = (await ctx.db.get(info.invite._id))!;
    const deliveryId = await insertDelivery(
      ctx,
      invite,
      args.mail as MailDraft,
    );
    await appendSigningEvent(ctx, agreement, user._id, "invitation_reissued", {
      invitationId: invite._id,
      previousVersion: info.invite.version,
      version: invite.version,
      reason,
      deliveryId,
    });
    return { version: invite.version, deliveryId };
  },
});
export const reissue = action({
  args: {
    invitationId: v.id("signingInvitations"),
    expectedVersion: v.number(),
    reason: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    version: number;
    deliveryId: Doc<"signingDeliveries">["_id"];
  }> => {
    const info: {
      invite: Doc<"signingInvitations">;
      tx: Doc<"signingTransactions">;
      party: { key: string; email: string };
    } = await ctx.runQuery(internal.signingInvitations.reissueContext, {
      invitationId: args.invitationId,
    });
    const ring = accessKeys(),
      nonce = crypto.randomUUID(),
      version = info.invite.version + 1;
    const credential = await regenerateInvitation({
      keyId: ring.active,
      reference: info.tx.reference,
      preparationHash: info.tx.preparationHash,
      participantKey: info.invite.participantKey,
      version,
      nonce,
    });
    const mail = await makeEmail({
      kind: "correction",
      participantKey: info.party.key,
      version,
      recipient: info.party.email,
      companyName: info.tx.companyName,
      title: info.tx.title,
      expiresAt: info.invite.expiresAt,
      credential,
    });
    return ctx.runMutation(internal.signingInvitations.commitReissue, {
      ...args,
      nonce,
      keyId: ring.active,
      tokenHash: await credentialHash("invitation", credential),
      mail,
    });
  },
});

export const invitationContext = internalQuery({
  args: { invitationId: v.id("signingInvitations") },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.invitationId);
    if (!invite) throw new ConvexError("Invitation not found");
    const { user } = await signingFileAccess(ctx, invite.agreementId);
    await requireSigningWriter(ctx, invite.tenantId);
    const access = await validInvitation(ctx, invite);
    if (
      !access ||
      !["signer", "approver"].includes(access.party.responsibility)
    )
      throw new ConvexError(
        "Only an outstanding signer or approver can be reminded",
      );
    await assertRelease(ctx, invite.tenantId, {
      category: access.agreement.category,
      recipients: [access.party.email],
    });
    return { invite, ...access, actorId: user._id };
  },
});
export const queueReminder = internalMutation({
  args: {
    invitationId: v.id("signingInvitations"),
    requestId: v.string(),
    mail: v.any(),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.invitationId);
    if (!invite) throw new ConvexError("Invitation not found");
    const { agreement, user } = await signingFileAccess(
      ctx,
      invite.agreementId,
    );
    await requireSigningWriter(ctx, agreement.tenantId);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(args.requestId))
      throw new ConvexError("Invalid reminder request");
    const requestKey = `${invite.transactionId}:${user._id}:${args.requestId}`;
    const prior = await ctx.db
      .query("signingDeliveries")
      .withIndex("by_requestKey", (q) => q.eq("requestKey", requestKey))
      .unique();
    if (prior) {
      if (
        prior.invitationId !== invite._id ||
        prior.invitationVersion !== invite.version ||
        prior.kind !== "reminder"
      )
        throw new ConvexError("Reminder request already used");
      return prior._id;
    }
    const access = await validInvitation(ctx, invite);
    if (
      !access ||
      !["signer", "approver"].includes(access.party.responsibility) ||
      Date.now() - invite.lastEmailAt < REMINDER_INTERVAL
    )
      throw new ConvexError(
        "Only outstanding participants who have not been emailed in the last 24 hours can be reminded",
      );
    await assertRelease(ctx, agreement.tenantId, {
      category: agreement.category,
      recipients: [access.party.email],
    });
    if (await hasUnresolvedDelivery(ctx, invite._id))
      throw new ConvexError(
        "Reconcile the outstanding delivery before sending another message",
      );
    const deliveryId = await insertDelivery(ctx, invite, {
      ...(args.mail as MailDraft),
      requestKey,
    });
    await ctx.db.patch(invite._id, { lastEmailAt: Date.now() });
    await appendSigningEvent(
      ctx,
      agreement,
      user._id,
      "invitation_reminder_requested",
      { invitationId: invite._id, deliveryId },
    );
    return deliveryId;
  },
});
export const remind = action({
  args: { invitationId: v.id("signingInvitations"), requestId: v.string() },
  handler: async (ctx, args): Promise<Doc<"signingDeliveries">["_id"]> => {
    const info: {
      invite: Doc<"signingInvitations">;
      tx: Doc<"signingTransactions">;
      party: { key: string; email: string };
    } = await ctx.runQuery(internal.signingInvitations.invitationContext, {
      invitationId: args.invitationId,
    });
    const credential = await regenerateInvitation({
      ...info.invite,
      reference: info.tx.reference,
      preparationHash: info.tx.preparationHash,
    });
    const mail = await makeEmail({
      kind: "reminder",
      participantKey: info.party.key,
      version: info.invite.version,
      recipient: info.party.email,
      companyName: info.tx.companyName,
      title: info.tx.title,
      expiresAt: info.invite.expiresAt,
      credential,
    });
    return ctx.runMutation(internal.signingInvitations.queueReminder, {
      ...args,
      mail,
    });
  },
});
export const revoke = mutation({
  args: {
    invitationId: v.id("signingInvitations"),
    expectedVersion: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.invitationId);
    if (!invite) throw new ConvexError("Invitation not found");
    const { agreement, user } = await signingFileAccess(
      ctx,
      invite.agreementId,
    );
    await requireSigningWriter(ctx, agreement.tenantId);
    if (
      invite.version !== args.expectedVersion ||
      invite.status === "completed"
    )
      throw new ConvexError(
        "Invitation changed or participant already completed their action",
      );
    if (invite.status === "revoked") return null;
    const reason = boundedText(args.reason, "Revocation reason", 1000);
    await ctx.db.patch(invite._id, {
      status: "revoked",
      revokedAt: Date.now(),
      revocationReason: reason,
    });
    await appendSigningEvent(ctx, agreement, user._id, "invitation_revoked", {
      invitationId: invite._id,
      version: invite.version,
      reason,
    });
    return null;
  },
});
export const list = query({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const { agreement } = await signingFileAccess(ctx, args.agreementId);
    const tx = agreement.signingTransactionId
      ? await ctx.db.get(agreement.signingTransactionId)
      : null;
    const frozenId = tx?.frozenPreparationId ?? agreement.frozenPreparationId;
    const frozen = frozenId ? await ctx.db.get(frozenId) : null,
      parties = frozen ? parseFrozen(frozen).participants : [];
    const blockers = await releaseBlockers(ctx, agreement.tenantId, {
      category: agreement.category,
      recipients: parties.map((p) => p.email),
    });
    if (
      !tx ||
      tx.tenantId !== agreement.tenantId ||
      tx.agreementId !== agreement._id
    )
      return {
        canSend: blockers.length === 0 && agreement.status === "ready_to_send",
        releaseBlockers: blockers,
        frozenPreparationId:
          agreement.status === "ready_to_send"
            ? (agreement.frozenPreparationId ?? null)
            : null,
        transaction: null,
        invitations: [],
      };
    const invitations = await ctx.db
      .query("signingInvitations")
      .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
      .take(21);
    const eligible = async (invite: Doc<"signingInvitations">) => {
      const access = await validInvitation(ctx, invite);
      return Boolean(
        access &&
        ["signer", "approver"].includes(access.party.responsibility) &&
        Date.now() - invite.lastEmailAt >= REMINDER_INTERVAL &&
        !(await hasUnresolvedDelivery(ctx, invite._id)),
      );
    };
    return {
      canSend: blockers.length === 0,
      releaseBlockers: blockers,
      frozenPreparationId: null,
      transaction: {
        id: tx._id,
        reference: tx.reference,
        status: tx.status,
        expiresAt: tx.expiresAt,
        currentStage: tx.currentStage,
      },
      invitations: await Promise.all(
        invitations.map(async (invite) => ({
          id: invite._id,
          version: invite.version,
          status: invite.status,
          participantKey: invite.participantKey,
          name:
            parties.find((p) => p.key === invite.participantKey)?.name ??
            "Participant",
          verifiedAt: invite.verifiedAt,
          expiresAt: invite.expiresAt,
          completedAt: invite.completedAt,
          reminderEligible: await eligible(invite),
          lastEmailAt: invite.lastEmailAt,
          outcomes: (
            await ctx.db
              .query("signingSubmissions")
              .withIndex("by_invitationId", (q) =>
                q.eq("invitationId", invite._id),
              )
              .order("desc")
              .take(5)
          ).map((row) => ({
            intent: row.intent,
            acceptedAt: row.acceptedAt,
            submissionHash: row.submissionHash,
            reason: (JSON.parse(row.evidence) as { reason?: string }).reason,
          })),
          deliveries: (
            await ctx.db
              .query("signingDeliveries")
              .withIndex("by_invitationId", (q) =>
                q.eq("invitationId", invite._id),
              )
              .order("desc")
              .take(10)
          ).map((d) => ({
            id: d._id,
            kind: d.kind,
            status: d.status,
            createdAt: d.createdAt,
            acceptedAt: d.acceptedAt,
            deliveredAt: d.deliveredAt,
            bouncedAt: d.bouncedAt,
            complainedAt: d.complainedAt,
            providerObservedStatus: d.providerObservedStatus,
            providerObservedAt: d.providerObservedAt,
            error: d.error,
          })),
        })),
      ),
    };
  },
});
