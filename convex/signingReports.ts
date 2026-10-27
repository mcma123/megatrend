import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { action, query } from "./_generated/server";
import { api } from "./_generated/api";
import { requireSigningReader } from "./signing";
import { parseFrozen } from "./lib/signingInvitations";

const filters = { tenantId: v.id("tenants"), from: v.number(), to: v.number() };
export type ReportTotals = {
  agreements: number;
  completed: number;
  outstanding: number;
  verified: number;
  providerAccepted: number;
  delivered: number;
  failed: number;
  unresolved: number;
  turnaroundMs: number[];
};
export const page = query({
  args: { ...filters, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireSigningReader(ctx, args.tenantId);
    if (
      !Number.isFinite(args.from) ||
      !Number.isFinite(args.to) ||
      args.to < args.from
    )
      throw new ConvexError("Invalid report dates");
    const result = await ctx.db
      .query("signingAgreements")
      .withIndex("by_tenantId_and_createdAt", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .gte("createdAt", args.from)
          .lte("createdAt", args.to),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, 25),
      });
    const totals: ReportTotals = {
      agreements: 0,
      completed: 0,
      outstanding: 0,
      verified: 0,
      providerAccepted: 0,
      delivered: 0,
      failed: 0,
      unresolved: 0,
      turnaroundMs: [],
    };
    for (const agreement of result.page) {
      // Cohort: agreements created in the selected interval; outcomes are current at query time.
      if (agreement.createdAt < args.from || agreement.createdAt > args.to)
        continue;
      totals.agreements++;
      const tx = agreement.signingTransactionId
        ? await ctx.db.get(agreement.signingTransactionId)
        : null;
      const completion = agreement.completionId
        ? await ctx.db.get(agreement.completionId)
        : null;
      if (agreement.status === "completed" && completion) {
        totals.completed++;
        if (tx)
          totals.turnaroundMs.push(
            Math.max(0, completion.completedAt - tx.createdAt),
          );
      }
      if (!tx) continue;
      const frozen = await ctx.db.get(tx.frozenPreparationId);
      const required = frozen
        ? parseFrozen(frozen).participants.filter(
            (p) =>
              p.responsibility === "signer" || p.responsibility === "approver",
          )
        : [];
      const invites = await ctx.db
        .query("signingInvitations")
        .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
        .take(21);
      const open = ["awaiting_signatures", "partially_signed"].includes(
        agreement.status,
      );
      for (const participant of required) {
        const invite = invites.find(
          (i) => i.participantKey === participant.key,
        );
        if (open && invite?.status !== "completed") totals.outstanding++;
        if (invite?.verifiedAt) totals.verified++;
      }
      for (const invite of invites) {
        let count = 0;
        for await (const delivery of ctx.db
          .query("signingDeliveries")
          .withIndex("by_invitationId", (q) =>
            q.eq("invitationId", invite._id),
          )) {
          if (++count > 500)
            throw new ConvexError(
              "Delivery history exceeds the per-page reporting limit",
            );
          if (delivery.acceptedAt) totals.providerAccepted++;
          if (delivery.deliveredAt) totals.delivered++;
          if (
            delivery.failedAt ||
            delivery.bouncedAt ||
            delivery.complainedAt ||
            delivery.status === "rejected" ||
            delivery.status === "failed"
          )
            totals.failed++;
          if (
            ["queued", "submitting", "running", "unknown"].includes(
              delivery.status,
            )
          )
            totals.unresolved++;
        }
      }
    }
    return {
      totals,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
export const run = action({
  args: filters,
  handler: async (
    ctx,
    args,
  ): Promise<
    Omit<ReportTotals, "turnaroundMs"> & {
      medianTurnaroundMs: number | null;
      generatedAt: number;
      cohort: string;
    }
  > => {
    const all: ReportTotals = {
      agreements: 0,
      completed: 0,
      outstanding: 0,
      verified: 0,
      providerAccepted: 0,
      delivered: 0,
      failed: 0,
      unresolved: 0,
      turnaroundMs: [],
    };
    let cursor: string | null = null;
    for (let page = 0; page < 400; page++) {
      const result: {
        totals: ReportTotals;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(api.signingReports.page, {
        ...args,
        paginationOpts: { cursor, numItems: 25 },
      });
      for (const key of [
        "agreements",
        "completed",
        "outstanding",
        "verified",
        "providerAccepted",
        "delivered",
        "failed",
        "unresolved",
      ] as const)
        all[key] += result.totals[key];
      all.turnaroundMs.push(...result.totals.turnaroundMs);
      if (result.isDone) {
        const { turnaroundMs, ...counts } = all;
        turnaroundMs.sort((a, b) => a - b);
        const mid = Math.floor(turnaroundMs.length / 2);
        return {
          ...counts,
          medianTurnaroundMs: !turnaroundMs.length
            ? null
            : turnaroundMs.length % 2
              ? turnaroundMs[mid]
              : (turnaroundMs[mid - 1] + turnaroundMs[mid]) / 2,
          generatedAt: Date.now(),
          cohort:
            "Created in selected date range; current outcomes, read across pages",
        };
      }
      cursor = result.continueCursor;
    }
    throw new ConvexError(
      "Report exceeds 10,000 agreements; no partial totals returned",
    );
  },
});
