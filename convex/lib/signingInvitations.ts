import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { appendSigningEvent } from "./signingAudit";
import { assertSigningTransition, signingHash } from "./signing";
import { sha256Text } from "./signingAccessCrypto";

// External sending is governed by `lib/signingRelease.ts` (deployment key + company release record).
export const REMINDER_INTERVAL = 24 * 3600_000;
export const emailKind = v.union(
  v.literal("invitation"),
  v.literal("reminder"),
  v.literal("correction"),
  v.literal("decline"),
  v.literal("completion"),
  v.literal("otp"),
);
export type EmailKind =
  "invitation" | "reminder" | "correction" | "decline" | "completion" | "otp";
export const deliveryStatus = v.union(
  v.literal("queued"),
  v.literal("submitting"),
  v.literal("running"),
  v.literal("unknown"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("suppressed"),
  v.literal("failed"),
);
export const invitationStatus = v.union(
  v.literal("waiting"),
  v.literal("active"),
  v.literal("revoked"),
  v.literal("completed"),
);
export const OTP_LIFETIME = 10 * 60_000,
  CHALLENGE_LIFETIME = 15 * 60_000,
  SESSION_LIFETIME = 30 * 60_000;
export const DELIVERY_LABELS: Record<
  Doc<"signingDeliveries">["status"],
  string
> = {
  queued: "Queued",
  submitting: "Submitting",
  running: "Sending",
  unknown: "Delivery unresolved",
  accepted: "Provider accepted",
  rejected: "Provider rejected",
  suppressed: "Not sent",
  failed: "Bounced or failed",
};
export type FrozenParty = {
  key: string;
  name: string;
  email: string;
  role: string;
  responsibility: "signer" | "approver" | "viewer" | "copy";
  stage: number;
  witnessFor?: string;
  phone?: string;
  notifyVia?: "email" | "sms" | "whatsapp";
  whatsappOptInReference?: string;
};
export type FrozenAccess = {
  participants: FrozenParty[];
  preparationHash?: string;
  contentHash: string;
  policyRevision: number;
  consentVersion: string;
};
export function parseFrozen(frozen: Doc<"signingFrozenPreparations">) {
  return JSON.parse(frozen.snapshot) as FrozenAccess;
}
export function maskedEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}***@${domain.slice(0, 1)}***${domain.includes(".") ? domain.slice(domain.lastIndexOf(".")) : ""}`;
}
export async function validInvitation(
  ctx: QueryCtx | MutationCtx,
  invite: Doc<"signingInvitations"> | null,
  now = Date.now(),
) {
  if (!invite || invite.status !== "active" || invite.expiresAt <= now)
    return null;
  const tx = await ctx.db.get(invite.transactionId),
    agreement = await ctx.db.get(invite.agreementId);
  if (
    !tx ||
    tx.status !== "active" ||
    tx.expiresAt <= now ||
    tx.frozenPreparationId !== invite.frozenPreparationId ||
    tx.tenantId !== invite.tenantId ||
    tx.agreementId !== invite.agreementId ||
    !agreement ||
    agreement.signingTransactionId !== tx._id ||
    agreement.tenantId !== tx.tenantId ||
    !["awaiting_signatures", "partially_signed"].includes(agreement.status) ||
    agreement.frozenPreparationId !== tx.frozenPreparationId
  )
    return null;
  const tenant = await ctx.db.get(tx.tenantId),
    frozen = await ctx.db.get(tx.frozenPreparationId);
  if (
    !tenant ||
    tenant.status !== "active" ||
    !frozen ||
    frozen.tenantId !== tx.tenantId ||
    frozen.agreementId !== agreement._id ||
    frozen.preparationHash !== tx.preparationHash ||
    (await signingHash(JSON.parse(frozen.snapshot))) !== tx.preparationHash
  )
    return null;
  const party = parseFrozen(frozen).participants.find(
    (p) => p.key === invite.participantKey,
  );
  if (
    !party ||
    party.responsibility === "copy" ||
    (party.responsibility !== "viewer" && party.stage !== tx.currentStage)
  )
    return null;
  return {
    tx,
    agreement,
    frozen,
    party,
    accessUntil: Math.min(invite.expiresAt, tx.expiresAt),
    readOnly: false as const,
  };
}
export const COMPLETED_ACCESS_WINDOW = 14 * 86400_000;
/**
 * Read-only access after a participant finished (to see the receipt and, once sealed, download
 * the completed copy) or while a correction request pauses signing. Never permits writes.
 */
export async function readOnlyInvitation(
  ctx: QueryCtx | MutationCtx,
  invite: Doc<"signingInvitations"> | null,
  now = Date.now(),
) {
  if (!invite || invite.status === "revoked" || invite.status === "waiting")
    return null;
  const tx = await ctx.db.get(invite.transactionId);
  const agreement = tx ? await ctx.db.get(tx.agreementId) : null;
  const frozen = tx ? await ctx.db.get(tx.frozenPreparationId) : null;
  const tenant = tx ? await ctx.db.get(tx.tenantId) : null;
  const completion = agreement?.completionId
    ? await ctx.db.get(agreement.completionId)
    : null;
  const finished =
    invite.status === "completed" &&
    tx?.status !== "voided" &&
    tx?.status !== "expired";
  const paused = invite.status === "active" && tx?.status === "paused";
  if (
    !tx ||
    !agreement ||
    !frozen ||
    !tenant ||
    tenant.status !== "active" ||
    (!finished && !paused) ||
    tx.frozenPreparationId !== invite.frozenPreparationId ||
    agreement.signingTransactionId !== tx._id ||
    frozen.preparationHash !== tx.preparationHash ||
    (await signingHash(JSON.parse(frozen.snapshot))) !== tx.preparationHash
  )
    return null;
  const party = parseFrozen(frozen).participants.find(
    (p) => p.key === invite.participantKey,
  );
  const accessUntil = completion
    ? Math.max(
        invite.expiresAt,
        completion.completedAt + COMPLETED_ACCESS_WINDOW,
      )
    : invite.expiresAt;
  if (!party || party.responsibility === "copy" || accessUntil <= now)
    return null;
  return { tx, agreement, frozen, party, accessUntil, readOnly: true as const };
}
export async function accessibleInvitation(
  ctx: QueryCtx | MutationCtx,
  invite: Doc<"signingInvitations"> | null,
) {
  return (
    (await validInvitation(ctx, invite)) ??
    (await readOnlyInvitation(ctx, invite))
  );
}
export async function validSession(
  ctx: QueryCtx | MutationCtx,
  tokenHash: string,
) {
  const session = await ctx.db
    .query("signingSignerSessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (
    !session ||
    session.revokedAt !== undefined ||
    session.expiresAt <= Date.now()
  )
    return null;
  const invite = await ctx.db.get(session.invitationId),
    access = await accessibleInvitation(ctx, invite);
  if (
    !access ||
    !invite ||
    session.invitationVersion !== invite.version ||
    session.preparationHash !== access.tx.preparationHash ||
    session.transactionId !== access.tx._id ||
    session.participantKey !== invite.participantKey
  )
    return null;
  return { session, invite, ...access };
}
export async function consumeRate(
  ctx: MutationCtx,
  key: string,
  limit: number,
  windowMs: number,
) {
  const slot = Math.floor(Date.now() / windowMs),
    fullKey = `${key}:${slot}`;
  const current = await ctx.db
    .query("signingAccessRates")
    .withIndex("by_key", (q) => q.eq("key", fullKey))
    .unique();
  if (current && current.count >= limit) return false;
  if (current) await ctx.db.patch(current._id, { count: current.count + 1 });
  else {
    const expiresAt = (slot + 1) * windowMs;
    const rateId = await ctx.db.insert("signingAccessRates", {
      key: fullKey,
      count: 1,
      expiresAt,
    });
    await ctx.scheduler.runAfter(
      expiresAt - Date.now() + 60_000,
      internal.signingAccessState.pruneRate,
      { rateId },
    );
  }
  return true;
}
export type MailDraft = {
  deliveryKey: string;
  requestKey?: string;
  participantKey: string;
  kind: EmailKind;
  sealed: string;
  keyId: string;
  recipientHash: string;
  expectedFrom: string;
  payloadExpiresAt: number;
  invitationVersion: number;
};
export async function hasUnresolvedDelivery(
  ctx: QueryCtx | MutationCtx,
  invitationId: Id<"signingInvitations">,
) {
  const statuses = ["queued", "submitting", "running", "unknown"] as const;
  const rows = await Promise.all(
    statuses.map((status) =>
      ctx.db
        .query("signingDeliveries")
        .withIndex("by_invitationId_and_status", (q) =>
          q.eq("invitationId", invitationId).eq("status", status),
        )
        .first(),
    ),
  );
  return rows.some(Boolean);
}
export async function insertDelivery(
  ctx: MutationCtx,
  invite: Doc<"signingInvitations">,
  draft: MailDraft,
) {
  if (
    draft.invitationVersion !== invite.version ||
    draft.participantKey !== invite.participantKey
  )
    throw new ConvexError("Invitation changed before delivery was queued");
  if (draft.requestKey) {
    const prior = await ctx.db
      .query("signingDeliveries")
      .withIndex("by_requestKey", (q) => q.eq("requestKey", draft.requestKey))
      .unique();
    if (prior) {
      if (
        prior.invitationId !== invite._id ||
        prior.invitationVersion !== invite.version ||
        prior.kind !== draft.kind
      )
        throw new ConvexError(
          "Mail request was already used for another purpose",
        );
      return prior._id;
    }
  }
  const existing = await ctx.db
    .query("signingDeliveries")
    .withIndex("by_deliveryKey", (q) => q.eq("deliveryKey", draft.deliveryKey))
    .unique();
  if (existing) {
    if (
      existing.invitationId !== invite._id ||
      existing.invitationVersion !== invite.version ||
      existing.kind !== draft.kind ||
      existing.payloadDigest !== (await sha256Text(draft.sealed))
    )
      throw new ConvexError(
        "Delivery identity already used for another payload",
      );
    return existing._id;
  }
  const deliveryId = await ctx.db.insert("signingDeliveries", {
    ...draft,
    payloadDigest: await sha256Text(draft.sealed),
    tenantId: invite.tenantId,
    agreementId: invite.agreementId,
    transactionId: invite.transactionId,
    invitationId: invite._id,
    status: "queued",
    createdAt: Date.now(),
    checks: 0,
  });
  await ctx.scheduler.runAfter(0, internal.signingDeliveries.submit, {
    deliveryId,
  });
  await ctx.scheduler.runAfter(
    Math.max(0, draft.payloadExpiresAt - Date.now()) + 60_000,
    internal.signingDeliveries.purgePayload,
    { deliveryId },
  );
  return deliveryId;
}
/** Unregistered business helper: production entry points must validate MFA, frozen approval and release first. */
export async function createIssuedTransaction(
  ctx: MutationCtx,
  args: {
    agreement: Doc<"signingAgreements">;
    frozen: Doc<"signingFrozenPreparations">;
    actorId: Id<"users">;
    reference: string;
    requestId: string;
    expiresAt: number;
    companyName: string;
    nonces: string[];
    keyId: string;
    tokenHashes: string[];
    emails: MailDraft[];
  },
) {
  const { agreement, frozen } = args;
  if (
    agreement.status !== "ready_to_send" ||
    agreement.frozenPreparationId !== frozen._id ||
    frozen.agreementId !== agreement._id ||
    frozen.tenantId !== agreement.tenantId ||
    (await signingHash(JSON.parse(frozen.snapshot))) !==
      frozen.preparationHash ||
    args.expiresAt <= Date.now() ||
    args.expiresAt > Date.now() + 30 * 86400_000
  )
    throw new ConvexError(
      "A current approved frozen preparation and valid deadline are required",
    );
  const parties = parseFrozen(frozen).participants;
  if (
    !parties.length ||
    parties.length > 20 ||
    parties.length !== args.nonces.length ||
    parties.length !== args.tokenHashes.length
  )
    throw new ConvexError("Invalid invitation participants");
  const prior = await ctx.db
    .query("signingTransactions")
    .withIndex("by_agreementId", (q) => q.eq("agreementId", agreement._id))
    .unique();
  if (prior) {
    if (
      prior.requestId !== args.requestId ||
      prior.createdBy !== args.actorId ||
      prior.expiresAt !== args.expiresAt ||
      prior.frozenPreparationId !== frozen._id
    )
      throw new ConvexError("This agreement already has a signing transaction");
    return prior._id;
  }
  const actors = parties.filter(
    (p) => p.responsibility === "signer" || p.responsibility === "approver",
  );
  if (!actors.length)
    throw new ConvexError("A signing participant is required");
  const currentStage = Math.min(...actors.map((p) => p.stage));
  const transactionId = await ctx.db.insert("signingTransactions", {
    tenantId: agreement.tenantId,
    agreementId: agreement._id,
    frozenPreparationId: frozen._id,
    preparationHash: frozen.preparationHash,
    reference: args.reference,
    requestId: args.requestId,
    status: "active",
    currentStage,
    expiresAt: args.expiresAt,
    companyName: args.companyName,
    title: agreement.title,
    createdAt: Date.now(),
    createdBy: args.actorId,
  });
  for (const [index, party] of parties.entries()) {
    const active =
      party.responsibility === "viewer" ||
      (party.responsibility !== "copy" && party.stage === currentStage);
    const invitationId = await ctx.db.insert("signingInvitations", {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      transactionId,
      frozenPreparationId: frozen._id,
      participantKey: party.key,
      version: 1,
      nonce: args.nonces[index],
      keyId: args.keyId,
      tokenHash: args.tokenHashes[index],
      status: active ? "active" : "waiting",
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
      failedAttempts: 0,
      lockedUntil: 0,
      lastEmailAt: active ? Date.now() : 0,
    });
    if (active) {
      const mail = args.emails.find((e) => e.participantKey === party.key);
      if (!mail) throw new ConvexError("Missing invitation delivery");
      await insertDelivery(ctx, (await ctx.db.get(invitationId))!, mail);
    }
  }
  assertSigningTransition(agreement.status, "awaiting_signatures", {
    approved: true,
    frozen: true,
    canIssue: true,
  });
  await ctx.db.patch(agreement._id, {
    status: "awaiting_signatures",
    signingTransactionId: transactionId,
    updatedAt: Date.now(),
    updatedBy: args.actorId,
  });
  await appendSigningEvent(
    ctx,
    agreement,
    args.actorId,
    "invitations_released",
    {
      transactionId,
      reference: args.reference,
      preparationHash: frozen.preparationHash,
      expiresAt: args.expiresAt,
      currentStage,
    },
  );
  return transactionId;
}
