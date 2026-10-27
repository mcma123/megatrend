import { paginationOptsValidator } from "convex/server";
import { validatePortfolioContext } from "./lib/signingPortfolio";
import { releaseBlockers } from "./lib/signingRelease";
import { parseFrozen } from "./lib/signingInvitations";
import { ConvexError, v } from "convex/values";
import { assertPreparationIdle } from "./lib/signingFileAccess";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  env,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { appendAuditEvent } from "./lib/audit";
import {
  requirePlatformAdmin,
  requireStaff,
  requireTenantAccess,
  requireTenantWriter,
} from "./lib/auth";
import {
  assertDraftEditable,
  assertSigningTransition,
  boundedText,
  canonicalJson,
  checkedRevision,
  draftInput,
  IMPLEMENTATION_BLOCKERS,
  normalizeDraft,
  ORDINARY_SIGNING_CATEGORIES,
  partyContent,
  policyBlockers,
  signingCategory,
  signingHash,
  signingStatus,
  type SigningDraft,
} from "./lib/signing";
import { appendSigningEvent, signingEventEnvelope } from "./lib/signingAudit";
import { requireSigningMfa } from "./lib/signingSecurity";
import { api } from "./_generated/api";
import { preparationState } from "./lib/signingFields";

type ApprovalBinding = Omit<
  Doc<"signingApprovals">,
  "_id" | "_creationTime" | "bindingHash"
>;
async function approvalBindingHash(approval: ApprovalBinding) {
  const {
    tenantId,
    agreementId,
    revisionId,
    contentHash,
    bundleId,
    manifestHash,
    pdfHash,
    artifactKey,
    storageVersion,
    policyRevision,
    policyHash,
    requestedBy,
    requestedAt,
    eventSequence,
    layoutId,
    layoutHash,
    preparationHash,
  } = approval;
  return await signingHash({
    tenantId,
    agreementId,
    revisionId,
    contentHash,
    bundleId,
    manifestHash,
    pdfHash,
    artifactKey,
    storageVersion,
    policyRevision,
    policyHash,
    requestedBy,
    requestedAt,
    eventSequence,
    layoutId,
    layoutHash,
    preparationHash,
  });
}
async function approvalIntact(
  ctx: QueryCtx | MutationCtx,
  approval: Doc<"signingApprovals">,
): Promise<boolean> {
  if (approval.bindingHash !== (await approvalBindingHash(approval)))
    return false;
  const event = await ctx.db
    .query("signingEvents")
    .withIndex("by_agreementId_and_sequence", (q) =>
      q
        .eq("agreementId", approval.agreementId)
        .eq("sequence", approval.eventSequence),
    )
    .unique();
  if (
    !event ||
    event.eventType !== "approval_requested" ||
    event.actorId !== approval.requestedBy ||
    event.tenantId !== approval.tenantId ||
    event.eventHash !== (await signingHash(signingEventEnvelope(event)))
  )
    return false;
  try {
    const details = JSON.parse(event.payload) as Record<string, unknown>;
    return (
      details.approvalId === approval._id &&
      details.bindingHash === approval.bindingHash
    );
  } catch {
    return false;
  }
}

async function frozenIntact(
  ctx: QueryCtx | MutationCtx,
  agreement: Doc<"signingAgreements">,
  frozen: Doc<"signingFrozenPreparations"> | null,
  approval: Doc<"signingApprovals">,
  decision: Doc<"signingApprovalDecisions">,
  preparationHash: string | null,
) {
  if (
    !frozen ||
    frozen.tenantId !== agreement.tenantId ||
    frozen.agreementId !== agreement._id ||
    frozen.revisionId !== agreement.currentRevisionId ||
    frozen.bundleId !== approval.bundleId ||
    frozen.layoutId !== approval.layoutId ||
    frozen.approvalId !== approval._id ||
    frozen.decisionId !== decision._id ||
    frozen.createdBy !== decision.decidedBy ||
    frozen.createdAt !== decision.decidedAt ||
    frozen.policyRevision !== approval.policyRevision ||
    frozen.preparationHash !== preparationHash
  )
    return false;
  try {
    if ((await signingHash(JSON.parse(frozen.snapshot))) !== preparationHash)
      return false;
    const event = await ctx.db
      .query("signingEvents")
      .withIndex("by_agreementId_and_sequence", (q) =>
        q.eq("agreementId", agreement._id).eq("sequence", frozen.eventSequence),
      )
      .unique();
    if (
      !event ||
      event.eventType !== "approval_approved" ||
      event.actorId !== decision.decidedBy ||
      event.tenantId !== agreement.tenantId ||
      event.eventHash !== (await signingHash(signingEventEnvelope(event)))
    )
      return false;
    const details = JSON.parse(event.payload) as Record<string, unknown>;
    return (
      details.reason === decision.reason &&
      details.decidedAt === decision.decidedAt &&
      details.frozenPreparationId === frozen._id &&
      details.preparationHash === preparationHash &&
      details.decisionId === decision._id &&
      details.approvalId === approval._id
    );
  } catch {
    return false;
  }
}

export async function requireSigningReader(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
) {
  await requireStaff(ctx);
  const access = await requireTenantAccess(ctx, tenantId);
  if (access.principalType !== "staff")
    throw new ConvexError("Signing records require company staff access");
  const tenant = await ctx.db.get(tenantId);
  if (!tenant) throw new ConvexError("Company not found");
  return tenant;
}

export async function requireSigningWriter(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
) {
  const user = await requirePlatformAdmin(ctx);
  await requireTenantWriter(ctx, tenantId);
  const tenant = await ctx.db.get(tenantId);
  if (!tenant || tenant.status !== "active")
    throw new ConvexError("An active company is required");
  await requireSigningMfa(ctx);
  return user;
}

export async function getAgreement(
  ctx: QueryCtx | MutationCtx,
  agreementId: Id<"signingAgreements">,
) {
  // Authenticate before lookup, so anonymous callers cannot probe identifiers.
  await requireStaff(ctx);
  const agreement = await ctx.db.get(agreementId);
  if (!agreement) throw new ConvexError("Agreement not found");
  await requireSigningReader(ctx, agreement.tenantId);
  return agreement;
}

export async function validateLinks(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  draft: SigningDraft,
) {
  if (draft.portfolioContext)
    await validatePortfolioContext(
      ctx,
      tenantId,
      draft.propertyId,
      draft.portfolioContext,
      draft.participants.map((p) => p.key),
    );
  if (draft.propertyId) {
    const property = await ctx.db.get(draft.propertyId);
    if (
      !property ||
      property.tenantId !== tenantId ||
      property.archivedAt !== undefined
    ) {
      throw new ConvexError(
        "Select an active property belonging to this company",
      );
    }
  }
  if (draft.leaseId) {
    const lease = await ctx.db.get(draft.leaseId);
    if (
      !lease ||
      lease.tenantId !== tenantId ||
      lease.archivedAt !== undefined ||
      !draft.propertyId ||
      lease.propertyId !== draft.propertyId
    ) {
      throw new ConvexError(
        "Select a lease for this company's selected property",
      );
    }
  }
}

export async function currentRevision(
  ctx: QueryCtx | MutationCtx,
  agreement: Doc<"signingAgreements">,
) {
  const revision = agreement.currentRevisionId
    ? await ctx.db.get(agreement.currentRevisionId)
    : null;
  if (
    !revision ||
    revision.agreementId !== agreement._id ||
    revision.tenantId !== agreement.tenantId ||
    revision.revision !== agreement.revision
  ) {
    throw new ConvexError("Agreement revision is unavailable; contact support");
  }
  return revision;
}

export async function saveRevision(
  ctx: MutationCtx,
  agreement: Doc<"signingAgreements">,
  userId: Id<"users">,
  draft: SigningDraft,
) {
  const revision = agreement.revision + 1;
  const { participants, ...content } = draft;
  const contentHash = await signingHash({
    contractVersion: 1,
    tenantId: agreement.tenantId,
    ...draft,
  });
  const now = Date.now();
  const revisionId = await ctx.db.insert("signingRevisions", {
    agreementId: agreement._id,
    tenantId: agreement.tenantId,
    revision,
    ...content,
    contentHash,
    participantCount: participants.length,
    createdAt: now,
    createdBy: userId,
  });
  for (const [position, participant] of participants.entries()) {
    await ctx.db.insert("signingParticipants", {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      revisionId,
      position,
      ...participant,
    });
  }
  await ctx.db.patch(agreement._id, {
    title: draft.title,
    category: draft.category,
    propertyId: draft.propertyId,
    leaseId: draft.leaseId,
    revision,
    currentRevisionId: revisionId,
    updatedAt: now,
    updatedBy: userId,
    approvalId: undefined,
    approvalPolicyRevision: undefined,
    currentBundleId: undefined,
    currentLayoutId: undefined,
    frozenPreparationId: undefined,
  });
  return { agreementId: agreement._id, revisionId, revision, contentHash };
}

async function replayRequest(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  actorId: Id<"users">,
  requestId: string,
  fingerprint: string,
) {
  const previous = await ctx.db
    .query("signingRequests")
    .withIndex("by_tenantId_and_actorId_and_requestId", (q) =>
      q
        .eq("tenantId", tenantId)
        .eq("actorId", actorId)
        .eq("requestId", requestId),
    )
    .unique();
  if (!previous) return null;
  if (previous.fingerprint !== fingerprint)
    throw new ConvexError(
      "This request ID was already used for different agreement changes",
    );
  return {
    agreementId: previous.agreementId,
    revisionId: previous.revisionId,
    revision: previous.revision,
  };
}

function normalizedRequestId(value: string) {
  const id = boundedText(value, "Request ID", 128);
  if (id.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(id))
    throw new ConvexError(
      "Use a unique request ID of 8–128 letters, numbers, hyphens or underscores",
    );
  return id;
}

export const createDraft = mutation({
  args: { tenantId: v.id("tenants"), requestId: v.string(), draft: draftInput },
  handler: async (ctx, args) => {
    const user = await requireSigningWriter(ctx, args.tenantId);
    const draft = normalizeDraft(args.draft);
    const requestId = normalizedRequestId(args.requestId);
    const fingerprint = await signingHash({
      operation: "create",
      tenantId: args.tenantId,
      draft,
    });
    const replay = await replayRequest(
      ctx,
      args.tenantId,
      user._id,
      requestId,
      fingerprint,
    );
    if (replay) return replay;
    await validateLinks(ctx, args.tenantId, draft);
    const now = Date.now();
    const agreementId = await ctx.db.insert("signingAgreements", {
      tenantId: args.tenantId,
      title: draft.title,
      category: draft.category,
      status: "draft",
      revision: 0,
      createdAt: now,
      createdBy: user._id,
      updatedAt: now,
      updatedBy: user._id,
      eventCount: 0,
    });
    const agreement = (await ctx.db.get(agreementId))!;
    const saved = await saveRevision(ctx, agreement, user._id, draft);
    await appendSigningEvent(ctx, agreement, user._id, "draft_created", {
      contentHash: saved.contentHash,
    });
    await ctx.db.insert("signingRequests", {
      tenantId: args.tenantId,
      actorId: user._id,
      requestId,
      fingerprint,
      agreementId,
      revisionId: saved.revisionId,
      revision: saved.revision,
      createdAt: now,
    });
    return {
      agreementId,
      revisionId: saved.revisionId,
      revision: saved.revision,
    };
  },
});

export const updateDraft = mutation({
  args: {
    agreementId: v.id("signingAgreements"),
    expectedRevision: v.number(),
    requestId: v.string(),
    draft: draftInput,
  },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const user = await requireSigningWriter(ctx, agreement.tenantId);
    const draft = normalizeDraft(args.draft);
    const requestId = normalizedRequestId(args.requestId);
    const expectedRevision = checkedRevision(args.expectedRevision);
    const fingerprint = await signingHash({
      operation: "update",
      agreementId: agreement._id,
      expectedRevision,
      draft,
    });
    const replay = await replayRequest(
      ctx,
      agreement.tenantId,
      user._id,
      requestId,
      fingerprint,
    );
    if (replay) return replay;
    assertDraftEditable(agreement.status);
    await assertPreparationIdle(ctx, agreement);
    if (agreement.revision !== expectedRevision)
      throw new ConvexError("This agreement changed. Reload it before saving");
    await validateLinks(ctx, agreement.tenantId, draft);
    const saved = await saveRevision(ctx, agreement, user._id, draft);
    await appendSigningEvent(ctx, agreement, user._id, "draft_updated", {
      contentHash: saved.contentHash,
    });
    await ctx.db.insert("signingRequests", {
      tenantId: agreement.tenantId,
      actorId: user._id,
      requestId,
      fingerprint,
      agreementId: saved.agreementId,
      revisionId: saved.revisionId,
      revision: saved.revision,
      createdAt: Date.now(),
    });
    return {
      agreementId: saved.agreementId,
      revisionId: saved.revisionId,
      revision: saved.revision,
    };
  },
});

export const voidDraft = mutation({
  args: {
    agreementId: v.id("signingAgreements"),
    expectedRevision: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const user = await requireSigningWriter(ctx, agreement.tenantId);
    const reason = boundedText(args.reason, "Cancellation reason", 1000);
    if (agreement.revision !== checkedRevision(args.expectedRevision))
      throw new ConvexError(
        "This agreement changed. Reload it before cancelling",
      );
    if (agreement.status === "voided" && agreement.voidReason === reason)
      return null;
    // Issued cancellation belongs to Phase 7 and must revoke sessions/invitations too.
    assertDraftEditable(agreement.status);
    await ctx.db.patch(agreement._id, {
      status: "voided",
      voidReason: reason,
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
    await appendSigningEvent(ctx, agreement, user._id, "draft_voided", {
      reason,
    });
    return null;
  },
});

/** Tracking facts for dashboards: progress counts and deadlines only, never participant PII. */
async function trackingFor(ctx: QueryCtx, agreement: Doc<"signingAgreements">) {
  const tx = agreement.signingTransactionId
    ? await ctx.db.get(agreement.signingTransactionId)
    : null;
  const alerts = await ctx.db
    .query("signingAlerts")
    .withIndex("by_agreementId_and_status", (q) =>
      q.eq("agreementId", agreement._id).eq("status", "open"),
    )
    .take(20);
  if (!tx)
    return {
      transactionStatus: null,
      currentStage: null,
      expiresAt: null,
      completed: 0,
      total: 0,
      openAlerts: alerts.length,
      critical: alerts.some((a) => a.severity === "critical"),
    };
  const frozen = await ctx.db.get(tx.frozenPreparationId);
  const actors = frozen
    ? parseFrozen(frozen).participants.filter(
        (p) => p.responsibility === "signer" || p.responsibility === "approver",
      )
    : [];
  const invites = await ctx.db
    .query("signingInvitations")
    .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
    .take(21);
  const done = new Set(
    invites
      .filter((i) => i.status === "completed")
      .map((i) => i.participantKey),
  );
  return {
    transactionStatus: tx.status,
    currentStage: tx.currentStage,
    expiresAt: tx.expiresAt,
    completed: actors.filter((p) => done.has(p.key)).length,
    total: actors.length,
    openAlerts: alerts.length,
    critical: alerts.some((a) => a.severity === "critical"),
  };
}

export const list = query({
  args: {
    tenantId: v.id("tenants"),
    status: v.optional(signingStatus),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireSigningReader(ctx, args.tenantId);
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(100, Math.max(1, args.paginationOpts.numItems)),
    };
    const result = args.status
      ? await ctx.db
          .query("signingAgreements")
          .withIndex("by_tenantId_and_status", (q) =>
            q.eq("tenantId", args.tenantId).eq("status", args.status!),
          )
          .order("desc")
          .paginate(paginationOpts)
      : await ctx.db
          .query("signingAgreements")
          .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
          .order("desc")
          .paginate(paginationOpts);
    const policy = await ctx.db
      .query("signingPolicies")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (agreement) => ({
          ...agreement,
          approvalStale: Boolean(
            agreement.approvalId &&
            agreement.approvalPolicyRevision !== policy?.revision,
          ),
          tracking: await trackingFor(ctx, agreement),
        })),
      ),
    };
  },
});

export const get = query({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const revision = await currentRevision(ctx, agreement);
    const participants = await ctx.db
      .query("signingParticipants")
      .withIndex("by_revisionId", (q) => q.eq("revisionId", revision._id))
      .take(21);
    participants.sort((a, b) => a.position - b.position);
    if (
      participants.length !== revision.participantCount ||
      participants.length > 20 ||
      participants.some(
        (p, index) =>
          p.position !== index ||
          p.tenantId !== agreement.tenantId ||
          p.agreementId !== agreement._id,
      )
    ) {
      throw new ConvexError(
        "Agreement participants are inconsistent; contact support",
      );
    }
    const contentHash = await signingHash({
      contractVersion: 1,
      tenantId: agreement.tenantId,
      title: revision.title,
      category: revision.category,
      propertyId: revision.propertyId,
      leaseId: revision.leaseId,
      notes: revision.notes,
      signatureMethod: revision.signatureMethod,
      portfolioContext: revision.portfolioContext,
      participants: participants.map(partyContent),
    });
    if (contentHash !== revision.contentHash) {
      throw new ConvexError(
        "Agreement content integrity check failed; contact support",
      );
    }
    const policy = await ctx.db
      .query("signingPolicies")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", agreement.tenantId))
      .unique();
    const approval = agreement.approvalId
      ? await ctx.db.get(agreement.approvalId)
      : null;
    const decision = approval
      ? await ctx.db
          .query("signingApprovalDecisions")
          .withIndex("by_approvalId", (q) => q.eq("approvalId", approval._id))
          .unique()
      : null;
    const bundle = approval ? await ctx.db.get(approval.bundleId) : null;
    const preparation = await preparationState(
      ctx,
      agreement,
      bundle,
      revision,
      participants,
      policy,
    );
    const frozen = agreement.frozenPreparationId
      ? await ctx.db.get(agreement.frozenPreparationId)
      : null;
    const approvalCurrent = Boolean(
      approval &&
      (await approvalIntact(ctx, approval)) &&
      policy &&
      bundle &&
      preparation.blockers.length === 0 &&
      preparation.layout?._id === approval.layoutId &&
      preparation.layout?.layoutHash === approval.layoutHash &&
      preparation.preparationHash === approval.preparationHash &&
      (decision?.decision === "approved"
        ? await frozenIntact(
            ctx,
            agreement,
            frozen,
            approval,
            decision,
            preparation.preparationHash,
          )
        : decision?.decision === "rejected"
          ? agreement.status === "draft"
          : agreement.status === "awaiting_approval") &&
      bundle._id === agreement.currentBundleId &&
      bundle.fileRevision === (agreement.fileRevision ?? 0) &&
      (bundle.retainUntil ?? 0) > Date.now() &&
      bundle.revisionId === revision._id &&
      bundle.manifestHash === approval.manifestHash &&
      bundle.pdfHash === approval.pdfHash &&
      bundle.artifactKey === approval.artifactKey &&
      bundle.storageVersion === approval.storageVersion &&
      approval.revisionId === revision._id &&
      approval.contentHash === revision.contentHash &&
      approval.policyRevision === policy.revision &&
      approval.policyHash === (await signingHash(policy)),
    );
    const checkpoints = await ctx.db
      .query("signingCheckpoints")
      .withIndex("by_agreementId_and_sequence", (q) =>
        q.eq("agreementId", agreement._id),
      )
      .order("desc")
      .take(1);
    const checkpoint = checkpoints[0];
    return {
      agreement,
      revision,
      participants,
      approval,
      decision,
      approvalCurrent,
      frozenPreparation: frozen
        ? {
            id: frozen._id,
            preparationHash: frozen.preparationHash,
            createdAt: frozen.createdAt,
          }
        : null,
      checkpointConfigured: Boolean(
        env.SIGNING_WINDMILL_BASE_URL &&
        env.WINDMILL_SIGNING_TOKEN &&
        env.WINDMILL_WORKSPACE,
      ),
      checkpoint: checkpoint
        ? {
            id: checkpoint._id,
            sequence: checkpoint.sequence,
            status: checkpoint.status,
            attempts: checkpoint.attempts,
            error: checkpoint.error ?? null,
            retainUntil: checkpoint.retainUntil ?? null,
          }
        : null,
    };
  },
});

export const revisions = query({
  args: {
    agreementId: v.id("signingAgreements"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await getAgreement(ctx, args.agreementId);
    return await ctx.db
      .query("signingRevisions")
      .withIndex("by_agreementId_and_revision", (q) =>
        q.eq("agreementId", args.agreementId),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(50, Math.max(1, args.paginationOpts.numItems)),
      });
  },
});

export const events = query({
  args: {
    agreementId: v.id("signingAgreements"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await getAgreement(ctx, args.agreementId);
    return await ctx.db
      .query("signingEvents")
      .withIndex("by_agreementId_and_sequence", (q) =>
        q.eq("agreementId", args.agreementId),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(100, Math.max(1, args.paginationOpts.numItems)),
      });
  },
});

/** Policy references are administrator attestations, never an automated legal opinion. */
export const recordPolicy = mutation({
  args: {
    tenantId: v.id("tenants"),
    expectedRevision: v.number(),
    legalReviewReference: v.string(),
    privacyNoticeReference: v.string(),
    retentionPolicyReference: v.string(),
    consentVersion: v.string(),
    allowedCategories: v.array(signingCategory),
    approvalRequired: v.boolean(),
    allowSelfApproval: v.optional(v.boolean()),
    signerContact: v.optional(v.string()),
    transientRetentionDays: v.optional(v.number()),
    witnessingReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireSigningWriter(ctx, args.tenantId);
    if (
      args.transientRetentionDays !== undefined &&
      (!Number.isInteger(args.transientRetentionDays) ||
        args.transientRetentionDays < 30 ||
        args.transientRetentionDays > 3650)
    )
      throw new ConvexError("Transient retention must be 30 to 3650 days");
    const previous = await ctx.db
      .query("signingPolicies")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    if ((previous?.revision ?? 0) !== checkedRevision(args.expectedRevision))
      throw new ConvexError("Signing policy changed. Reload it before saving");
    if (
      args.allowedCategories.length > ORDINARY_SIGNING_CATEGORIES.length ||
      args.allowedCategories.some(
        (category) => !ORDINARY_SIGNING_CATEGORIES.includes(category),
      )
    ) {
      throw new ConvexError(
        "Unsupported signing categories cannot be approved through this module",
      );
    }
    const policy = {
      tenantId: args.tenantId,
      jurisdiction: "ZA" as const,
      revision: (previous?.revision ?? 0) + 1,
      legalReviewReference: boundedText(
        args.legalReviewReference,
        "Legal review reference",
        500,
        true,
      ),
      privacyNoticeReference: boundedText(
        args.privacyNoticeReference,
        "Privacy notice reference",
        500,
        true,
      ),
      retentionPolicyReference: boundedText(
        args.retentionPolicyReference,
        "Retention policy reference",
        500,
        true,
      ),
      consentVersion: boundedText(
        args.consentVersion,
        "Consent version",
        100,
        true,
      ),
      allowedCategories: [...new Set(args.allowedCategories)].sort(),
      approvalRequired: args.approvalRequired,
      allowSelfApproval: args.allowSelfApproval ?? false,
      // Shown to signers from the frozen snapshot; absent keeps earlier policy hashes unchanged.
      ...(args.signerContact?.trim()
        ? {
            signerContact: boundedText(
              args.signerContact,
              "Signer contact details",
              300,
            ),
          }
        : {}),
      ...(args.transientRetentionDays !== undefined
        ? { transientRetentionDays: args.transientRetentionDays }
        : {}),
      // Legal approval reference for witnessing; witnessed agreements cannot be approved without it.
      ...(args.witnessingReference?.trim()
        ? {
            witnessingReference: boundedText(
              args.witnessingReference,
              "Witnessing approval reference",
              500,
            ),
          }
        : {}),
      updatedAt: Date.now(),
      updatedBy: user._id,
    };
    if (previous) await ctx.db.replace(previous._id, policy);
    else await ctx.db.insert("signingPolicies", policy);
    await appendAuditEvent(ctx, {
      tenantId: args.tenantId,
      eventType: "signing.policy_recorded",
      actorType: "staff_user",
      actorId: user._id,
      targetType: "signing_policy",
      targetId: args.tenantId,
      correlationId: `${args.tenantId}:${policy.revision}`,
      sourceSystem: "convex",
      occurredAt: policy.updatedAt,
      payloadBefore: previous ? canonicalJson(previous) : undefined,
      payloadAfter: canonicalJson(policy),
    });
    return { revision: policy.revision };
  },
});

export const requestApproval = mutation({
  args: {
    agreementId: v.id("signingAgreements"),
    expectedRevision: v.number(),
    expectedPreparationHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const user = await requireSigningWriter(ctx, agreement.tenantId);
    if (agreement.revision !== checkedRevision(args.expectedRevision))
      throw new ConvexError(
        "Agreement changed. Reload before requesting approval",
      );
    assertDraftEditable(agreement.status);
    const data: {
      revision: Doc<"signingRevisions">;
      participants: Doc<"signingParticipants">[];
    } = await ctx.runQuery(api.signing.get, { agreementId: agreement._id });
    const policy = await ctx.db
      .query("signingPolicies")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", agreement.tenantId))
      .unique();
    const blockers = policyBlockers(policy, agreement.category);
    if (blockers.length || !policy) throw new ConvexError(blockers.join("; "));
    if (!data.participants.some((p) => p.responsibility === "signer"))
      throw new ConvexError("Add at least one signer");
    await assertPreparationIdle(ctx, agreement);
    const bundle = agreement.currentBundleId
      ? await ctx.db.get(agreement.currentBundleId)
      : null;
    if (
      !bundle ||
      bundle.revisionId !== data.revision._id ||
      bundle.fileRevision !== (agreement.fileRevision ?? 0) ||
      !bundle.attemptId ||
      (bundle.retainUntil ?? 0) <= Date.now() ||
      !bundle.manifestVersion ||
      !bundle.inputDigest ||
      !bundle.pages?.length ||
      !bundle.sources?.length ||
      bundle.tenantId !== agreement.tenantId ||
      bundle.agreementId !== agreement._id ||
      !bundle.scanReference ||
      !bundle.rendererVersion ||
      !bundle.storageVersion ||
      bundle.storageVersion === "null" ||
      !bundle.artifactKey ||
      bundle.validatedAt <= 0 ||
      !/^[a-f0-9]{64}$/.test(bundle.manifestHash) ||
      !/^[a-f0-9]{64}$/.test(bundle.pdfHash)
    )
      throw new ConvexError(
        "Prepare and validate the current immutable PDF bundle before requesting approval",
      );
    const preparation = await preparationState(
      ctx,
      agreement,
      bundle,
      data.revision,
      data.participants,
      policy,
    );
    if (
      !preparation.layout ||
      !preparation.preparationHash ||
      preparation.blockers.length
    )
      throw new ConvexError(preparation.blockers.join("; "));
    if (args.expectedPreparationHash !== preparation.preparationHash)
      throw new ConvexError(
        "Preparation changed or was not reviewed. Review the current PDF, fields and participants before requesting approval",
      );
    assertSigningTransition(agreement.status, "awaiting_approval", {
      frozen: true,
    });
    const binding: ApprovalBinding = {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      revisionId: data.revision._id,
      contentHash: data.revision.contentHash,
      bundleId: bundle._id,
      manifestHash: bundle.manifestHash,
      pdfHash: bundle.pdfHash,
      artifactKey: bundle.artifactKey,
      storageVersion: bundle.storageVersion,
      policyRevision: policy.revision,
      policyHash: await signingHash(policy),
      requestedBy: user._id,
      requestedAt: Date.now(),
      eventSequence: agreement.eventCount + 1,
      layoutId: preparation.layout._id,
      layoutHash: preparation.layout.layoutHash,
      preparationHash: preparation.preparationHash,
    };
    const bindingHash = await approvalBindingHash(binding);
    const approvalId = await ctx.db.insert("signingApprovals", {
      ...binding,
      bindingHash,
    });
    await ctx.db.patch(agreement._id, {
      status: "awaiting_approval",
      approvalId,
      approvalPolicyRevision: policy.revision,
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
    await appendSigningEvent(ctx, agreement, user._id, "approval_requested", {
      approvalId,
      contentHash: data.revision.contentHash,
      manifestHash: bundle.manifestHash,
      policyRevision: policy.revision,
      policyHash: binding.policyHash,
      pdfHash: bundle.pdfHash,
      bindingHash,
      preparationHash: preparation.preparationHash,
    });
    return { approvalId };
  },
});

export const decideApproval = mutation({
  args: {
    agreementId: v.id("signingAgreements"),
    approvalId: v.id("signingApprovals"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const user = await requireSigningWriter(ctx, agreement.tenantId);
    if (
      agreement.status !== "awaiting_approval" ||
      agreement.approvalId !== args.approvalId
    )
      throw new ConvexError("This approval is no longer pending");
    const approval = await ctx.db.get(args.approvalId);
    const policy = await ctx.db
      .query("signingPolicies")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", agreement.tenantId))
      .unique();
    const revision = await currentRevision(ctx, agreement);
    const bundle = approval ? await ctx.db.get(approval.bundleId) : null;
    const data: { participants: Doc<"signingParticipants">[] } =
      await ctx.runQuery(api.signing.get, { agreementId: agreement._id });
    const preparation = await preparationState(
      ctx,
      agreement,
      bundle,
      revision,
      data.participants,
      policy,
    );
    if (
      !approval ||
      !preparation.layout ||
      preparation.blockers.length > 0 ||
      preparation.layout._id !== approval.layoutId ||
      preparation.layout.layoutHash !== approval.layoutHash ||
      preparation.preparationHash !== approval.preparationHash ||
      !(await approvalIntact(ctx, approval)) ||
      !policy ||
      approval.agreementId !== agreement._id ||
      approval.tenantId !== agreement.tenantId ||
      approval.revisionId !== revision._id ||
      approval.contentHash !== revision.contentHash ||
      approval.policyRevision !== policy.revision ||
      approval.policyHash !== (await signingHash(policy)) ||
      !bundle ||
      bundle._id !== agreement.currentBundleId ||
      bundle.fileRevision !== (agreement.fileRevision ?? 0) ||
      (bundle.retainUntil ?? 0) <= Date.now() ||
      bundle.revisionId !== revision._id ||
      bundle.manifestHash !== approval.manifestHash ||
      bundle.pdfHash !== approval.pdfHash ||
      bundle.artifactKey !== approval.artifactKey ||
      bundle.storageVersion !== approval.storageVersion
    )
      throw new ConvexError(
        "Document or policy changed. Return to draft and request fresh approval",
      );
    if (
      args.decision === "approved" &&
      approval.requestedBy === user._id &&
      !policy.allowSelfApproval
    )
      throw new ConvexError(
        "Another authorised administrator must approve this agreement",
      );
    const existing = await ctx.db
      .query("signingApprovalDecisions")
      .withIndex("by_approvalId", (q) => q.eq("approvalId", approval._id))
      .unique();
    if (existing) throw new ConvexError("This approval already has a decision");
    const reason = boundedText(args.reason, "Approval decision reason", 1000);
    const next = args.decision === "approved" ? "ready_to_send" : "draft";
    assertSigningTransition(agreement.status, next, {
      frozen: true,
      approved: args.decision === "approved",
    });
    const decidedAt = Date.now();
    const decisionId = await ctx.db.insert("signingApprovalDecisions", {
      approvalId: approval._id,
      decision: args.decision,
      reason,
      decidedBy: user._id,
      decidedAt,
    });
    await ctx.db.patch(agreement._id, {
      status: next,
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
    let frozenPreparationId: Id<"signingFrozenPreparations"> | undefined;
    if (args.decision === "approved") {
      if (
        !preparation.layout ||
        !preparation.snapshot ||
        !preparation.preparationHash
      )
        throw new ConvexError("Validated preparation is required");
      frozenPreparationId = await ctx.db.insert("signingFrozenPreparations", {
        eventSequence: agreement.eventCount + 1,
        tenantId: agreement.tenantId,
        agreementId: agreement._id,
        revisionId: revision._id,
        bundleId: bundle._id,
        layoutId: preparation.layout._id,
        approvalId: approval._id,
        decisionId,
        policyRevision: policy.revision,
        preparationHash: preparation.preparationHash,
        snapshot: preparation.snapshot,
        createdAt: decidedAt,
        createdBy: user._id,
      });
      await ctx.db.patch(agreement._id, { frozenPreparationId });
    }
    await appendSigningEvent(
      ctx,
      agreement,
      user._id,
      `approval_${args.decision}`,
      {
        approvalId: approval._id,
        reason,
        decisionId,
        decidedAt,
        preparationHash: preparation.preparationHash,
        ...(frozenPreparationId ? { frozenPreparationId } : {}),
      },
    );
    return null;
  },
});

export const returnToDraft = mutation({
  args: {
    agreementId: v.id("signingAgreements"),
    expectedRevision: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const user = await requireSigningWriter(ctx, agreement.tenantId);
    if (agreement.revision !== checkedRevision(args.expectedRevision))
      throw new ConvexError("Agreement changed. Reload before editing");
    assertSigningTransition(agreement.status, "draft");
    const reason = boundedText(args.reason, "Return-to-draft reason", 1000);
    const data: {
      revision: Doc<"signingRevisions">;
      participants: Doc<"signingParticipants">[];
    } = await ctx.runQuery(api.signing.get, { agreementId: agreement._id });
    const {
      title,
      category,
      propertyId,
      leaseId,
      notes,
      portfolioContext,
      signatureMethod,
    } = data.revision;
    const draft = normalizeDraft({
      title,
      category,
      propertyId,
      leaseId,
      notes,
      portfolioContext,
      signatureMethod,
      participants: data.participants.map(partyContent),
    });
    await saveRevision(ctx, agreement, user._id, draft);
    await ctx.db.patch(agreement._id, { status: "draft" });
    await appendSigningEvent(ctx, agreement, user._id, "approval_invalidated", {
      previousApprovalId: agreement.approvalId ?? null,
      reason,
    });
    return null;
  },
});

export const readiness = query({
  args: { tenantId: v.id("tenants"), category: v.optional(signingCategory) },
  handler: async (ctx, args) => {
    await requireSigningReader(ctx, args.tenantId);
    const policy = await ctx.db
      .query("signingPolicies")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    const release = await releaseBlockers(ctx, args.tenantId, {
      category: args.category,
    });
    return {
      available: release.length
        ? ("drafts_only" as const)
        : ("release" as const),
      // Recipient pilot allowlists are checked again for each agreement before sending.
      canIssue: release.length === 0,
      releaseBlockers: release,
      policy,
      policyBlockers: policyBlockers(policy, args.category),
      implementationBlockers: [...IMPLEMENTATION_BLOCKERS],
      operationalBlockers: [
        "Private PDF storage, scanner freshness and Linux worker isolation have not passed signing acceptance",
        "Email sender domain and delivery have not passed signing acceptance",
        "Signing certificate, timestamp service, protected storage and restoration have not passed acceptance",
      ],
    };
  },
});

/** DB consistency check only. A separate immutable checkpoint is still required. */
export const verifyAudit = query({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const rows = await ctx.db
      .query("signingEvents")
      .withIndex("by_agreementId_and_sequence", (q) =>
        q.eq("agreementId", agreement._id),
      )
      .take(1001);
    if (rows.length > 1000)
      return {
        status: "limit_exceeded" as const,
        independentlyAnchored: false,
        checkedEvents: 0,
      };
    let previousHash: string | undefined;
    let expectedSequence = 1;
    for (const event of rows) {
      if (
        event.tenantId !== agreement.tenantId ||
        event.sequence !== expectedSequence ||
        event.previousHash !== previousHash ||
        event.eventHash !== (await signingHash(signingEventEnvelope(event)))
      ) {
        return {
          status: "inconsistent" as const,
          independentlyAnchored: false,
          checkedEvents: expectedSequence - 1,
        };
      }
      previousHash = event.eventHash;
      expectedSequence++;
    }
    const consistent =
      rows.length === agreement.eventCount &&
      previousHash === agreement.lastEventHash;
    return {
      status: consistent
        ? ("consistent_unanchored" as const)
        : ("inconsistent" as const),
      independentlyAnchored: false,
      checkedEvents: rows.length,
    };
  },
});
