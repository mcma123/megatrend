import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { appendSigningEvent } from "./lib/signingAudit";
import {
  assertSigningTransition,
  boundedText,
  partyContent,
  type SigningStatus,
} from "./lib/signing";
import {
  hasUnresolvedDelivery,
  parseFrozen,
  REMINDER_INTERVAL,
  validInvitation,
} from "./lib/signingInvitations";
import { makeEmail, regenerateInvitation } from "./signingEmailPayloads";
import {
  currentRevision,
  getAgreement,
  requireSigningWriter,
  saveRevision,
  validateLinks,
} from "./signing";

const ISSUED: SigningStatus[] = ["awaiting_signatures", "partially_signed"];
const MAX_EXTENSION = 30 * 86400_000;

async function operator(
  ctx: MutationCtx,
  agreementId: Id<"signingAgreements">,
) {
  const agreement = await getAgreement(ctx, agreementId);
  const user = await requireSigningWriter(ctx, agreement.tenantId);
  return { agreement, user };
}
async function transactionOf(
  ctx: MutationCtx,
  agreement: Doc<"signingAgreements">,
) {
  const tx = agreement.signingTransactionId
    ? await ctx.db.get(agreement.signingTransactionId)
    : null;
  if (
    tx &&
    (tx.agreementId !== agreement._id || tx.tenantId !== agreement.tenantId)
  )
    throw new ConvexError("Signing transaction integrity check failed");
  return tx;
}
/** Revokes every unfinished invitation and live session. Submissions and evidence are untouched. */
async function revokeAccess(
  ctx: MutationCtx,
  tx: Doc<"signingTransactions">,
  reason: string,
) {
  const invites = await ctx.db
    .query("signingInvitations")
    .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
    .take(21);
  let revoked = 0;
  for (const invite of invites) {
    if (invite.status !== "completed" && invite.status !== "revoked") {
      await ctx.db.patch(invite._id, {
        status: "revoked",
        revokedAt: Date.now(),
        revocationReason: reason,
      });
      revoked += 1;
    }
    const sessions = await ctx.db
      .query("signingSignerSessions")
      .withIndex("by_invitationId", (q) => q.eq("invitationId", invite._id))
      .take(100);
    for (const session of sessions)
      if (session.revokedAt === undefined)
        await ctx.db.patch(session._id, { revokedAt: Date.now() });
  }
  return revoked;
}

/** Cancels an approved or issued agreement. Earlier submissions remain as immutable evidence. */
export const voidIssued = mutation({
  args: { agreementId: v.id("signingAgreements"), reason: v.string() },
  handler: async (ctx, args) => {
    const { agreement, user } = await operator(ctx, args.agreementId);
    const reason = boundedText(args.reason, "Cancellation reason", 1000);
    if (agreement.status === "voided") return null;
    if (
      agreement.status !== "ready_to_send" &&
      !ISSUED.includes(agreement.status)
    )
      throw new ConvexError(
        "Only approved or issued agreements awaiting signatures can be cancelled here",
      );
    assertSigningTransition(agreement.status, "voided");
    const tx = await transactionOf(ctx, agreement);
    const revoked = tx ? await revokeAccess(ctx, tx, "Agreement cancelled") : 0;
    if (tx) await ctx.db.patch(tx._id, { status: "voided" });
    await ctx.db.patch(agreement._id, {
      status: "voided",
      voidReason: reason,
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
    await appendSigningEvent(ctx, agreement, user._id, "agreement_voided", {
      reason,
      transactionId: tx?._id ?? null,
      revokedInvitations: revoked,
    });
    return null;
  },
});

export const extendDeadline = mutation({
  args: {
    agreementId: v.id("signingAgreements"),
    expiresAt: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { agreement, user } = await operator(ctx, args.agreementId);
    const reason = boundedText(args.reason, "Extension reason", 1000);
    const tx = await transactionOf(ctx, agreement);
    if (
      !tx ||
      !ISSUED.includes(agreement.status) ||
      !["active", "paused"].includes(tx.status)
    )
      throw new ConvexError("Only an open signing transaction can be extended");
    if (
      !Number.isSafeInteger(args.expiresAt) ||
      args.expiresAt <= Math.max(tx.expiresAt, Date.now()) ||
      args.expiresAt > Date.now() + MAX_EXTENSION
    )
      throw new ConvexError("Choose a later deadline within the next 30 days");
    const invites = await ctx.db
      .query("signingInvitations")
      .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
      .take(21);
    for (const invite of invites)
      if (invite.status === "active" || invite.status === "waiting")
        await ctx.db.patch(invite._id, { expiresAt: args.expiresAt });
    await ctx.db.patch(tx._id, { expiresAt: args.expiresAt });
    await appendSigningEvent(ctx, agreement, user._id, "deadline_extended", {
      transactionId: tx._id,
      previous: tx.expiresAt,
      expiresAt: args.expiresAt,
      reason,
    });
    return null;
  },
});

/** Resumes after review of a correction request decided that no document change is needed. */
export const resumeAfterCorrection = mutation({
  args: { agreementId: v.id("signingAgreements"), reason: v.string() },
  handler: async (ctx, args) => {
    const { agreement, user } = await operator(ctx, args.agreementId);
    const reason = boundedText(args.reason, "Resumption reason", 1000);
    const tx = await transactionOf(ctx, agreement);
    if (!tx || tx.status !== "paused" || !ISSUED.includes(agreement.status))
      throw new ConvexError("Only a paused signing transaction can be resumed");
    if (tx.expiresAt <= Date.now())
      throw new ConvexError(
        "The deadline has passed. Replace the agreement instead",
      );
    await ctx.db.patch(tx._id, { status: "active" });
    await appendSigningEvent(ctx, agreement, user._id, "signing_resumed", {
      transactionId: tx._id,
      reason,
    });
    return null;
  },
});

const REPLACEABLE: SigningStatus[] = [
  "ready_to_send",
  "awaiting_signatures",
  "partially_signed",
  "declined",
  "expired",
  "voided",
];
/**
 * Creates a new editable draft from the current terms and participants. Open agreements become
 * Superseded with access revoked; terminal ones keep their status. Nothing is edited in place.
 */
export const replace = mutation({
  args: { agreementId: v.id("signingAgreements"), reason: v.string() },
  handler: async (ctx, args) => {
    const { agreement, user } = await operator(ctx, args.agreementId);
    if (agreement.replacedByAgreementId) return agreement.replacedByAgreementId;
    const reason = boundedText(args.reason, "Replacement reason", 1000);
    if (!REPLACEABLE.includes(agreement.status))
      throw new ConvexError(
        "Edit drafts directly; agreements awaiting approval, finalising or completed cannot be replaced here",
      );
    const revision = await currentRevision(ctx, agreement);
    const participants = await ctx.db
      .query("signingParticipants")
      .withIndex("by_revisionId", (q) => q.eq("revisionId", revision._id))
      .take(21);
    participants.sort((a, b) => a.position - b.position);
    const draft = {
      title: revision.title,
      category: revision.category,
      ...(revision.propertyId ? { propertyId: revision.propertyId } : {}),
      ...(revision.leaseId ? { leaseId: revision.leaseId } : {}),
      notes: revision.notes,
      ...(revision.portfolioContext
        ? { portfolioContext: revision.portfolioContext }
        : {}),
      ...(revision.signatureMethod
        ? { signatureMethod: revision.signatureMethod }
        : {}),
      participants: participants.map(partyContent),
    };
    await validateLinks(ctx, agreement.tenantId, draft);
    const now = Date.now();
    const replacementId = await ctx.db.insert("signingAgreements", {
      tenantId: agreement.tenantId,
      title: draft.title,
      category: draft.category,
      status: "draft",
      revision: 0,
      createdAt: now,
      createdBy: user._id,
      updatedAt: now,
      updatedBy: user._id,
      eventCount: 0,
      replacesAgreementId: agreement._id,
    });
    const replacement = (await ctx.db.get(replacementId))!;
    const saved = await saveRevision(ctx, replacement, user._id, draft);
    await appendSigningEvent(
      ctx,
      replacement,
      user._id,
      "draft_created_as_replacement",
      {
        replacesAgreementId: agreement._id,
        contentHash: saved.contentHash,
        reason,
      },
    );
    const tx = await transactionOf(ctx, agreement);
    const open =
      agreement.status === "ready_to_send" || ISSUED.includes(agreement.status);
    if (open) {
      assertSigningTransition(agreement.status, "superseded");
      if (tx) {
        await revokeAccess(ctx, tx, "Agreement replaced");
        await ctx.db.patch(tx._id, { status: "voided" });
      }
    }
    await ctx.db.patch(agreement._id, {
      replacedByAgreementId: replacementId,
      ...(open ? { status: "superseded" as const } : {}),
      updatedAt: now,
      updatedBy: user._id,
    });
    await appendSigningEvent(ctx, agreement, user._id, "agreement_replaced", {
      replacementId,
      reason,
      superseded: open,
    });
    return replacementId;
  },
});

/** Re-sends activation of waiting next-stage invitations after a release suspension is lifted. */
export const resumeStage = mutation({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const { agreement, user } = await operator(ctx, args.agreementId);
    const tx = await transactionOf(ctx, agreement);
    if (!tx || tx.status !== "active" || !ISSUED.includes(agreement.status))
      throw new ConvexError(
        "Only an active signing transaction can be resumed",
      );
    await ctx.scheduler.runAfter(0, internal.signerPortal.activateStage, {
      transactionId: tx._id,
      stage: tx.currentStage,
    });
    await appendSigningEvent(
      ctx,
      agreement,
      user._id,
      "stage_activation_requested",
      {
        transactionId: tx._id,
        stage: tx.currentStage,
      },
    );
    return null;
  },
});

export const outstanding = internalQuery({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    await requireSigningWriter(ctx, agreement.tenantId);
    const tx = agreement.signingTransactionId
      ? await ctx.db.get(agreement.signingTransactionId)
      : null;
    if (!tx) return [];
    const invites = await ctx.db
      .query("signingInvitations")
      .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
      .take(21);
    const due = [];
    for (const invite of invites) {
      const access = await validInvitation(ctx, invite);
      if (
        access &&
        ["signer", "approver"].includes(access.party.responsibility) &&
        Date.now() - invite.lastEmailAt >= REMINDER_INTERVAL &&
        !(await hasUnresolvedDelivery(ctx, invite._id))
      )
        due.push({ invite, tx, party: access.party });
    }
    return due;
  },
});
/** Reminds only outstanding signers/approvers of the current stage not emailed in 24 hours. */
export const remindOutstanding = action({
  args: { agreementId: v.id("signingAgreements"), requestId: v.string() },
  handler: async (ctx, args): Promise<{ queued: number; skipped: number }> => {
    if (!/^[A-Za-z0-9_-]{8,90}$/.test(args.requestId))
      throw new ConvexError("Invalid reminder request");
    const due: {
      invite: Doc<"signingInvitations">;
      tx: Doc<"signingTransactions">;
      party: { key: string; email: string };
    }[] = await ctx.runQuery(internal.signingExceptions.outstanding, {
      agreementId: args.agreementId,
    });
    let queued = 0,
      skipped = 0;
    for (const { invite, tx, party } of due) {
      try {
        const credential = await regenerateInvitation({
          ...invite,
          reference: tx.reference,
          preparationHash: tx.preparationHash,
        });
        const mail = await makeEmail({
          kind: "reminder",
          participantKey: party.key,
          version: invite.version,
          recipient: party.email,
          companyName: tx.companyName,
          title: tx.title,
          expiresAt: invite.expiresAt,
          credential,
        });
        await ctx.runMutation(internal.signingInvitations.queueReminder, {
          invitationId: invite._id,
          requestId: `${args.requestId}-${invite.participantKey.slice(0, 8)}`,
          mail,
        });
        queued += 1;
      } catch {
        skipped += 1;
      }
    }
    return { queued, skipped };
  },
});

/** Scheduled: expired open transactions become Expired. Earlier submissions remain evidence. */
export const expireDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let processed = 0;
    for (const status of ["active", "paused"] as const) {
      const due = await ctx.db
        .query("signingTransactions")
        .withIndex("by_status_and_expiresAt", (q) =>
          q.eq("status", status).lte("expiresAt", now),
        )
        .take(50);
      for (const tx of due) {
        processed += 1;
        await ctx.db.patch(tx._id, { status: "expired" });
        const agreement = await ctx.db.get(tx.agreementId);
        if (
          agreement &&
          ISSUED.includes(agreement.status) &&
          agreement.signingTransactionId === tx._id
        ) {
          assertSigningTransition(agreement.status, "expired");
          await ctx.db.patch(agreement._id, {
            status: "expired",
            updatedAt: now,
          });
          await appendSigningEvent(
            ctx,
            agreement,
            undefined,
            "agreement_expired",
            {
              transactionId: tx._id,
              expiresAt: tx.expiresAt,
            },
          );
        }
      }
    }
    if (processed >= 50)
      await ctx.scheduler.runAfter(0, internal.signingExceptions.expireDue, {});
    return processed;
  },
});

export const placeHold = mutation({
  args: { agreementId: v.id("signingAgreements"), reason: v.string() },
  handler: async (ctx, args) => {
    const { agreement, user } = await operator(ctx, args.agreementId);
    const reason = boundedText(args.reason, "Legal hold reason", 1000);
    const holds = await ctx.db
      .query("signingLegalHolds")
      .withIndex("by_agreementId", (q) => q.eq("agreementId", agreement._id))
      .take(50);
    if (holds.some((hold) => hold.releasedAt === undefined))
      throw new ConvexError("This agreement already has an active legal hold");
    const holdId = await ctx.db.insert("signingLegalHolds", {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      reason,
      placedAt: Date.now(),
      placedBy: user._id,
    });
    await appendSigningEvent(ctx, agreement, user._id, "legal_hold_placed", {
      holdId,
      reason,
    });
    return holdId;
  },
});
export const releaseHold = mutation({
  args: { holdId: v.id("signingLegalHolds"), reason: v.string() },
  handler: async (ctx, args) => {
    const hold = await ctx.db.get(args.holdId);
    if (!hold) throw new ConvexError("Legal hold not found");
    const { agreement, user } = await operator(ctx, hold.agreementId);
    if (hold.releasedAt !== undefined) return null;
    const reason = boundedText(args.reason, "Release reason", 1000);
    await ctx.db.patch(hold._id, {
      releasedAt: Date.now(),
      releasedBy: user._id,
      releaseReason: reason,
    });
    await appendSigningEvent(ctx, agreement, user._id, "legal_hold_released", {
      holdId: hold._id,
      reason,
    });
    return null;
  },
});

/** Which exception actions are possible now; the mutations re-check everything. */
export const status = query({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const tx = agreement.signingTransactionId
      ? await ctx.db.get(agreement.signingTransactionId)
      : null;
    const holds = await ctx.db
      .query("signingLegalHolds")
      .withIndex("by_agreementId", (q) => q.eq("agreementId", agreement._id))
      .order("desc")
      .take(10);
    const issued = ISSUED.includes(agreement.status);
    let waitingStage = false;
    if (tx && tx.status === "active") {
      const frozen = await ctx.db.get(tx.frozenPreparationId);
      const parties = frozen ? parseFrozen(frozen).participants : [];
      const invites = await ctx.db
        .query("signingInvitations")
        .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
        .take(21);
      waitingStage = invites.some(
        (i) =>
          i.status === "waiting" &&
          parties.some(
            (p) => p.key === i.participantKey && p.stage === tx.currentStage,
          ),
      );
    }
    return {
      status: agreement.status,
      transaction: tx
        ? {
            status: tx.status,
            expiresAt: tx.expiresAt,
            currentStage: tx.currentStage,
          }
        : null,
      canVoid: agreement.status === "ready_to_send" || issued,
      canExtend: Boolean(
        tx && issued && ["active", "paused"].includes(tx.status),
      ),
      canResume: Boolean(tx && issued && tx.status === "paused"),
      canResumeStage: Boolean(tx && issued && waitingStage),
      canReplace:
        REPLACEABLE.includes(agreement.status) &&
        !agreement.replacedByAgreementId,
      replacesAgreementId: agreement.replacesAgreementId ?? null,
      replacedByAgreementId: agreement.replacedByAgreementId ?? null,
      holds: holds.map((hold) => ({
        id: hold._id,
        reason: hold.reason,
        placedAt: hold.placedAt,
        releasedAt: hold.releasedAt ?? null,
        releaseReason: hold.releaseReason ?? null,
      })),
    };
  },
});
