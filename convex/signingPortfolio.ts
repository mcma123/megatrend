import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getAgreement,
  currentRevision,
  requireSigningReader,
  requireSigningWriter,
} from "./signing";
import { appendSigningEvent } from "./lib/signingAudit";
import { boundedText, canonicalJson, signingHash } from "./lib/signing";
import {
  applicationMode,
  downstreamPlan,
  leaseTerms,
  portfolioContext,
  validatePortfolioContext,
} from "./lib/signingPortfolio";
import {
  computeSchedule,
  moneyToCents,
  parseIsoDate,
  percentToBasisPoints,
  type ScheduleInput,
} from "./lib/signingTemplates";
import { notify, staffRecipients } from "./lib/notifications";
import { isLiveLease } from "./lib/portfolio";
import { requireStaff } from "./lib/auth";

function cleanTerms(input: Doc<"signingApplications">["terms"]) {
  const start = parseIsoDate(input.startDate, "Start date"),
    end = parseIsoDate(input.endDate, "End date");
  if (end <= start) throw new ConvexError("End date must follow start date");
  const rent = moneyToCents(input.monthlyRent, "Rent"),
    deposit = moneyToCents(input.deposit, "Deposit");
  percentToBasisPoints(String(input.escalationPercent), "Escalation", 5000);
  if (
    rent > BigInt(Number.MAX_SAFE_INTEGER) ||
    deposit > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new ConvexError("Amount exceeds the supported range");
  if (
    !Number.isFinite(input.escalationPercent) ||
    input.escalationPercent < 0 ||
    input.escalationPercent > 50 ||
    !Number.isInteger(input.noticePeriodMonths) ||
    input.noticePeriodMonths < 0 ||
    input.noticePeriodMonths > 120
  )
    throw new ConvexError("Invalid escalation or notice period");
  return {
    ...input,
    monthlyRent: (Number(rent) / 100).toFixed(2),
    deposit: (Number(deposit) / 100).toFixed(2),
  };
}

const reviewArgs = {
  agreementId: v.id("signingAgreements"),
  mode: applicationMode,
  targetLeaseId: v.optional(v.id("leases")),
  context: portfolioContext,
  terms: leaseTerms,
  plan: downstreamPlan,
  reason: v.string(),
};

export const catalog = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, { tenantId }) => {
    await requireSigningReader(ctx, tenantId);
    // Explicit truncation rather than silently treating picker limits as a complete register.
    const parties = await ctx.db
      .query("portfolioParties")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
      .take(501);
    const units = await ctx.db
      .query("portfolioUnits")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
      .take(501);
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
      .take(501);
    const leases = await ctx.db
      .query("leases")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
      .take(501);
    return {
      parties: parties.slice(0, 500),
      units: units.slice(0, 500),
      properties: properties.filter((p) => !p.archivedAt).slice(0, 500),
      leases: leases.filter((l) => !l.archivedAt).slice(0, 500),
      truncated: [parties, units, properties, leases].some(
        (a) => a.length > 500,
      ),
    };
  },
});
export const addParty = mutation({
  args: {
    tenantId: v.id("tenants"),
    kind: v.union(v.literal("owner"), v.literal("renter")),
    name: v.string(),
    reference: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireSigningWriter(ctx, args.tenantId);
    const name = boundedText(args.name, "Name", 200),
      reference = boundedText(args.reference, "Reference", 300);
    const existing = await ctx.db
      .query("portfolioParties")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .take(501);
    if (existing.length > 500)
      throw new ConvexError("Party register exceeds the interactive limit");
    const same = existing.find(
      (p) => p.reference === reference && p.kind === args.kind,
    );
    if (same) {
      if (same.name !== name)
        throw new ConvexError("Reference already belongs to a different party");
      return same._id;
    }
    return await ctx.db.insert("portfolioParties", {
      ...args,
      name,
      reference,
      createdAt: Date.now(),
      createdBy: user._id,
    });
  },
});
export const addUnit = mutation({
  args: { propertyId: v.id("properties"), name: v.string() },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.archivedAt)
      throw new ConvexError("Property not found");
    const user = await requireSigningWriter(ctx, property.tenantId);
    const name = boundedText(args.name, "Unit name", 200);
    const units = await ctx.db
      .query("portfolioUnits")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", property.tenantId))
      .take(501);
    if (units.length > 500)
      throw new ConvexError("Unit register exceeds the interactive limit");
    const same = units.find(
      (u) => u.propertyId === args.propertyId && u.name === name,
    );
    return (
      same?._id ??
      (await ctx.db.insert("portfolioUnits", {
        tenantId: property.tenantId,
        propertyId: args.propertyId,
        name,
        createdAt: Date.now(),
        createdBy: user._id,
      }))
    );
  },
});

async function review(
  ctx: QueryCtx | MutationCtx,
  args: {
    agreementId: Id<"signingAgreements">;
    mode: "create" | "amend" | "renew";
    targetLeaseId?: Id<"leases">;
    context: Doc<"signingApplications">["context"];
    terms: Doc<"signingApplications">["terms"];
    plan: Doc<"signingApplications">["plan"];
    reason: string;
  },
) {
  const agreement = await getAgreement(ctx, args.agreementId);
  const completion = agreement.completionId
    ? await ctx.db.get(agreement.completionId)
    : null;
  if (
    agreement.status !== "completed" ||
    !completion ||
    completion.agreementId !== agreement._id ||
    completion.tenantId !== agreement.tenantId
  )
    throw new ConvexError("A verified completed agreement is required");
  const revision = await currentRevision(ctx, agreement);
  const participants = await ctx.db
    .query("signingParticipants")
    .withIndex("by_revisionId", (q) => q.eq("revisionId", revision._id))
    .take(21);
  await validatePortfolioContext(
    ctx,
    agreement.tenantId,
    revision.propertyId,
    args.context,
    participants.map((p) => p.key),
  );
  if (
    revision.portfolioContext &&
    canonicalJson(revision.portfolioContext) !== canonicalJson(args.context)
  )
    throw new ConvexError(
      "Use the portfolio relationships frozen in this agreement",
    );
  const target = args.targetLeaseId
    ? await ctx.db.get(args.targetLeaseId)
    : null;
  if (
    args.mode === "create"
      ? !!args.targetLeaseId
      : !target ||
        target.archivedAt ||
        target.tenantId !== agreement.tenantId ||
        target.propertyId !== revision.propertyId
  )
    throw new ConvexError(
      "Choose an existing lease for an amendment or renewal, and no target for a new lease",
    );
  if (revision.leaseId && revision.leaseId !== args.targetLeaseId)
    throw new ConvexError("Use the lease linked to the signed agreement");
  if (
    target?.portfolioContext &&
    (target.portfolioContext.unitId !== args.context.unitId ||
      target.portfolioContext.ownerId !== args.context.ownerId ||
      target.portfolioContext.renterId !== args.context.renterId)
  )
    throw new ConvexError(
      "Lease parties and unit differ; create a separately reviewed lease",
    );
  const terms = cleanTerms(args.terms);
  if (
    args.mode === "renew" &&
    target &&
    (target.successorLeaseId || terms.startDate <= target.endDate)
  )
    throw new ConvexError(
      "Renewal must follow the predecessor and it must have no successor",
    );
  if (args.plan.payments.length > 24)
    throw new ConvexError(
      "At most 24 approved payment requests per application",
    );
  const plan = {
    ...args.plan,
    payments: args.plan.payments.map((p) => {
      const amount = moneyToCents(p.amount, "Payment");
      if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
        throw new ConvexError(
          "Payment must be positive and within the supported range",
        );
      parseIsoDate(p.dueDate, "Payment due date");
      return {
        purpose: boundedText(p.purpose, "Payment purpose", 200),
        amount: (Number(amount) / 100).toFixed(2),
        dueDate: p.dueDate,
      };
    }),
  };
  if (plan.moveInDueDate)
    parseIsoDate(plan.moveInDueDate, "Move-in task due date");
  const reason = boundedText(args.reason, "Review reason/reference", 1000);
  const snapshot = {
    agreementId: agreement._id,
    completionId: completion._id,
    pdfHash: completion.pdfHash,
    revisionId: revision._id,
    mode: args.mode,
    context: args.context,
    terms,
    plan,
    reason,
    before: target ?? null,
  };
  return {
    agreement,
    revision,
    completion,
    target,
    snapshot,
    reviewHash: await signingHash(snapshot),
  };
}
export const preview = query({
  args: reviewArgs,
  handler: async (ctx, args) => {
    const result = await review(ctx, args);
    return {
      ...result.snapshot,
      reviewHash: result.reviewHash,
      provenance:
        "Staff reviewed against completed PDF; no OCR or automatic lease application",
    };
  },
});
export const reviewFeedback = query({
  args: reviewArgs,
  handler: async (ctx, args) => {
    // Authenticate outside the validation catch; access errors must still fail closed.
    await getAgreement(ctx, args.agreementId);
    try {
      const result = await review(ctx, args);
      return {
        error: null,
        preview: {
          ...result.snapshot,
          reviewHash: result.reviewHash,
          provenance:
            "Staff reviewed against completed PDF; no OCR or automatic lease application",
        },
      };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return {
        error:
          typeof error.data === "string"
            ? error.data
            : "Review validation failed",
        preview: null,
      };
    }
  },
});

export const apply = mutation({
  args: { ...reviewArgs, expectedReviewHash: v.string() },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const user = await requireSigningWriter(ctx, agreement.tenantId);
    const { expectedReviewHash: _expectedReviewHash, ...requestPayload } = args;
    const requestHash = await signingHash(requestPayload);
    const existing = await ctx.db
      .query("signingApplications")
      .withIndex("by_agreementId", (q) => q.eq("agreementId", agreement._id))
      .unique();
    if (existing) {
      if (
        existing.reviewHash !== args.expectedReviewHash ||
        existing.requestHash !== requestHash
      )
        throw new ConvexError(
          "This completion was already applied with a different review",
        );
      return { applicationId: existing._id, leaseId: existing.leaseId };
    }
    const { revision, completion, target, snapshot, reviewHash } = await review(
      ctx,
      args,
    );
    if (reviewHash !== args.expectedReviewHash)
      throw new ConvexError(
        "Review changed. Preview and confirm the current terms again",
      );
    const now = Date.now(),
      terms = snapshot.terms;
    const values = {
      startDate: terms.startDate,
      endDate: terms.endDate,
      monthlyRental: Number(moneyToCents(terms.monthlyRent, "Rent")) / 100,
      depositCents: Number(moneyToCents(terms.deposit, "Deposit")),
      escalationPercent: terms.escalationPercent,
      noticePeriodMonths: terms.noticePeriodMonths,
      portfolioContext: args.context,
      signingRenewalReminders: snapshot.plan.renewalReminders,
      updatedAt: now,
      updatedBy: user._id,
    };
    const leaseId =
      args.mode === "amend" && target
        ? target._id
        : await ctx.db.insert("leases", {
            tenantId: agreement.tenantId,
            propertyId: revision.propertyId!,
            ...values,
            status: "pending",
            createdAt: now,
            createdBy: user._id,
            ...(args.mode === "renew" && target
              ? { predecessorLeaseId: target._id }
              : {}),
          });
    const applicationId = await ctx.db.insert("signingApplications", {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      completionId: completion._id,
      mode: args.mode,
      context: args.context,
      terms,
      plan: snapshot.plan,
      leaseId,
      ...(target
        ? { predecessorId: target._id, before: canonicalJson(target) }
        : {}),
      reviewHash,
      requestHash,
      reason: snapshot.reason,
      approvedAt: now,
      approvedBy: user._id,
    });
    await ctx.db.patch(leaseId, {
      ...values,
      signingApplicationId: applicationId,
    });
    if (args.mode === "renew" && target)
      await ctx.db.patch(target._id, {
        successorLeaseId: leaseId,
        updatedAt: now,
        updatedBy: user._id,
      });
    for (const [index, payment] of snapshot.plan.payments.entries()) {
      const id = await ctx.db.insert("signingPayments", {
        tenantId: agreement.tenantId,
        applicationId,
        leaseId,
        purpose: payment.purpose,
        amountCents: Number(moneyToCents(payment.amount, "Payment")),
        currency: "ZAR",
        dueDate: payment.dueDate,
        approvedAt: now,
        approvedBy: user._id,
      });
      await receipt(
        ctx,
        agreement.tenantId,
        `application:${applicationId}:payment:${index}`,
        reviewHash,
        id,
      );
    }
    if (snapshot.plan.moveInDueDate) {
      const id = await task(
        ctx,
        agreement,
        `application:${applicationId}:move-in`,
        "Prepare move-in (occupation requires separate authorisation)",
        snapshot.plan.moveInDueDate,
      );
      await receipt(
        ctx,
        agreement.tenantId,
        `application:${applicationId}:move-in`,
        reviewHash,
        id,
      );
    }
    await receipt(
      ctx,
      agreement.tenantId,
      `completion:${completion._id}:apply`,
      reviewHash,
      applicationId,
    );
    await appendSigningEvent(ctx, agreement, user._id, "portfolio_applied", {
      applicationId,
      leaseId,
      reviewHash,
      mode: args.mode,
    });
    return { applicationId, leaseId };
  },
});

async function receipt(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  key: string,
  fingerprint: string,
  resultId: string,
) {
  await ctx.db.insert("signingEffects", {
    tenantId,
    key,
    fingerprint,
    resultId,
    createdAt: Date.now(),
  });
}
async function task(
  ctx: MutationCtx,
  agreement: Doc<"signingAgreements">,
  autoKey: string,
  title: string,
  dueDate?: string,
) {
  return await ctx.db.insert("actions", {
    tenantId: agreement.tenantId,
    propertyId: agreement.propertyId,
    title,
    description:
      "Review the agreement in the private signing workspace. Signing does not activate a lease or authorise occupation.",
    source: "automation",
    autoKey,
    status: "open",
    priority: "high",
    visibleToClient: false,
    dueDate,
    requestedByPrincipal: "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}
/** Atomic with completion publication. Permanent receipt survives task closure and retention. */
export async function completionEffects(
  ctx: MutationCtx,
  agreement: Doc<"signingAgreements">,
  completionId: Id<"signingCompletions">,
) {
  const key = `completion:${completionId}:review`;
  if (
    await ctx.db
      .query("signingEffects")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique()
  )
    return;
  const id = await task(
    ctx,
    agreement,
    key,
    "Review completed agreement for portfolio application",
  );
  await notify(ctx, {
    tenantId: agreement.tenantId,
    recipients: await staffRecipients(ctx, agreement.tenantId),
    kind: "signing.portfolio_review",
    title: "Completed agreement awaiting portfolio review",
    link: "/agreements",
  });
  await receipt(ctx, agreement.tenantId, key, completionId, id);
}

export const state = query({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const application = await ctx.db
      .query("signingApplications")
      .withIndex("by_agreementId", (q) => q.eq("agreementId", agreement._id))
      .unique();
    const lease = application ? await ctx.db.get(application.leaseId) : null;
    const payments = application
      ? await ctx.db
          .query("signingPayments")
          .withIndex("by_applicationId", (q) =>
            q.eq("applicationId", application._id),
          )
          .take(24)
      : [];
    const decisions = lease
      ? await ctx.db
          .query("signingLeaseDecisions")
          .withIndex("by_leaseId", (q) => q.eq("leaseId", lease._id))
          .take(100)
      : [];
    return {
      application,
      lease,
      payments,
      signed: agreement.status === "completed",
      active: lease ? isLiveLease(lease) : false,
      occupationAuthorised: decisions.some((d) => d.kind === "occupation"),
      decisions,
    };
  },
});
export const suggestedTerms = query({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const generations = await ctx.db
      .query("signingGenerations")
      .withIndex("by_agreementId", (q) => q.eq("agreementId", agreement._id))
      .order("desc")
      .take(51);
    for (const generation of generations) {
      if (
        generation.status !== "attached" ||
        generation.revisionId !== agreement.currentRevisionId ||
        !generation.fileId
      )
        continue;
      const file = await ctx.db.get(generation.fileId);
      if (!file?.active) continue;
      const inputs = JSON.parse(generation.inputs) as {
        schedule: ScheduleInput | null;
      };
      if (
        (await signingHash(JSON.parse(generation.inputs))) !==
        generation.inputHash
      )
        throw new ConvexError("Generation integrity check failed");
      if (!inputs.schedule) return null;
      const schedule = computeSchedule(inputs.schedule);
      return {
        generationId: generation._id,
        inputHash: generation.inputHash,
        terms: {
          startDate: inputs.schedule.startDate,
          endDate: schedule.endDate,
          monthlyRent: inputs.schedule.monthlyRent,
          deposit: inputs.schedule.deposit,
          escalationPercent: Number(inputs.schedule.escalationPercent),
          noticePeriodMonths: 0,
        },
      };
    }
    return null;
  },
});
export const recordPayment = mutation({
  args: { paymentId: v.id("signingPayments"), reference: v.string() },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new ConvexError("Payment request not found");
    const user = await requireSigningWriter(ctx, payment.tenantId);
    const reference = boundedText(
      args.reference,
      "Payment evidence/reference",
      500,
    );
    if (payment.paidAt) {
      if (payment.paymentReference !== reference)
        throw new ConvexError(
          "Payment already recorded with different evidence",
        );
      return payment._id;
    }
    const application = await ctx.db.get(payment.applicationId);
    if (!application) throw new ConvexError("Application not found");
    const agreement = await getAgreement(ctx, application.agreementId);
    await ctx.db.patch(payment._id, {
      paidAt: Date.now(),
      paidBy: user._id,
      paymentReference: reference,
    });
    await appendSigningEvent(ctx, agreement, user._id, "payment_recorded", {
      paymentId: payment._id,
      reference,
    });
    return payment._id;
  },
});
export const decideLease = mutation({
  args: {
    leaseId: v.id("leases"),
    applicationId: v.id("signingApplications"),
    kind: v.union(v.literal("activate"), v.literal("occupation")),
    reason: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const lease = await ctx.db.get(args.leaseId);
    if (!lease?.signingApplicationId || lease.archivedAt)
      throw new ConvexError("Signing-managed lease not found");
    const user = await requireSigningWriter(ctx, lease.tenantId);
    if (lease.signingApplicationId !== args.applicationId)
      throw new ConvexError(
        "Lease application changed. Open the current reviewed agreement before approving",
      );
    const application = await ctx.db.get(lease.signingApplicationId);
    if (!application) throw new ConvexError("Application not found");
    const agreement = await getAgreement(ctx, application.agreementId);
    if (
      agreement.status !== "completed" ||
      ["terminated", "expired", "renewed"].includes(lease.status)
    )
      throw new ConvexError(
        "An applicable completed agreement and current lease are required",
      );
    const reason = boundedText(args.reason, "Approval reason/reference", 1000),
      requestId = boundedText(args.requestId, "Request ID", 128);
    const key = `lease:${lease._id}:${args.kind}:${requestId}`,
      fingerprint = await signingHash({
        kind: args.kind,
        reason,
        applicationId: args.applicationId,
      });
    const previous = await ctx.db
      .query("signingEffects")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new ConvexError(
          "Request ID already used for a different approval",
        );
      return previous.resultId;
    }
    if (args.kind === "activate") {
      if (lease.status !== "pending")
        throw new ConvexError("Only pending leases can be activated here");
      let checked = 0;
      for await (const other of ctx.db
        .query("leases")
        .withIndex("by_propertyId", (q) =>
          q.eq("propertyId", lease.propertyId),
        )) {
        if (++checked > 500)
          throw new ConvexError(
            "Property lease history exceeds the activation review limit",
          );
        if (
          other._id !== lease._id &&
          other.portfolioContext?.unitId === lease.portfolioContext?.unitId &&
          isLiveLease(other) &&
          other.startDate <= lease.endDate &&
          other.endDate >= lease.startDate
        )
          throw new ConvexError(
            "This unit already has an overlapping active lease. Review it before activation",
          );
      }
      if (lease.predecessorLeaseId) {
        const predecessor = await ctx.db.get(lease.predecessorLeaseId);
        if (
          !predecessor ||
          predecessor.tenantId !== lease.tenantId ||
          predecessor.successorLeaseId !== lease._id ||
          predecessor.endDate >= lease.startDate
        )
          throw new ConvexError(
            "Renewal predecessor changed. Review the relationship",
          );
        await ctx.db.patch(predecessor._id, {
          status: "renewed",
          updatedAt: Date.now(),
          updatedBy: user._id,
        });
      }
      await ctx.db.patch(lease._id, {
        status: "active",
        updatedAt: Date.now(),
        updatedBy: user._id,
      });
    } else {
      const decisions = await ctx.db
        .query("signingLeaseDecisions")
        .withIndex("by_leaseId", (q) => q.eq("leaseId", lease._id))
        .take(100);
      if (decisions.some((d) => d.kind === "occupation"))
        throw new ConvexError("Occupation already authorised");
    }
    const id = await ctx.db.insert("signingLeaseDecisions", {
      tenantId: lease.tenantId,
      leaseId: lease._id,
      applicationId: application._id,
      kind: args.kind,
      reason,
      requestId,
      approvedAt: Date.now(),
      approvedBy: user._id,
    });
    await receipt(ctx, lease.tenantId, key, fingerprint, id);
    await appendSigningEvent(
      ctx,
      agreement,
      user._id,
      `lease_${args.kind}_approved`,
      { decisionId: id, leaseId: lease._id, reason },
    );
    return id;
  },
});
