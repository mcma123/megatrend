import { internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePlatformAdmin } from "./lib/auth";
import { appendSigningEvent } from "./lib/signingAudit";
import { raiseAlert, type AlertInput } from "./lib/signingAlerts";
import { ACTIVE_FINALISATION, RETRYABLE } from "./lib/signingFinalisation";
import { ACTIVE_PREPARATION } from "./lib/signingPreparation";

const HOUR = 3600_000;
// Kinds owned by the periodic scan; they resolve automatically once no longer observed.
const SCAN_KINDS = new Set([
  "preparation_stuck",
  "finalisation_stuck",
  "finalisation_failed",
  "finalising_overdue",
  "delivery_unresolved",
  "delivery_rejected",
  "delivery_stuck",
  "checkpoint_failed",
  "checkpoint_pending",
  "deadline_soon",
]);
export const DEFAULT_TRANSIENT_RETENTION_DAYS = 90;

/** Periodic, bounded detection of stuck or ambiguous work. Messages carry codes only. */
export const scan = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const found: AlertInput[] = [];
    for (const status of ACTIVE_PREPARATION) {
      for (const row of await ctx.db
        .query("signingPreparations")
        .withIndex("by_status", (q) =>
          q.eq("status", status as Doc<"signingPreparations">["status"]),
        )
        .take(100))
        if (now - row.createdAt > HOUR)
          found.push({
            key: `preparation:${row._id}`,
            kind: "preparation_stuck",
            severity: status === "submission_unknown" ? "critical" : "warning",
            tenantId: row.tenantId,
            agreementId: row.agreementId,
            message: `PDF preparation ${status} for over an hour; reconcile the existing job`,
          });
    }
    for (const status of ACTIVE_FINALISATION) {
      for (const row of await ctx.db
        .query("signingFinalisations")
        .withIndex("by_status", (q) =>
          q.eq("status", status as Doc<"signingFinalisations">["status"]),
        )
        .take(100))
        if (now - row.createdAt > HOUR)
          found.push({
            key: `finalisation:${row._id}`,
            kind: "finalisation_stuck",
            severity: "critical",
            tenantId: row.tenantId,
            agreementId: row.agreementId,
            message: `Finalisation attempt ${row.attempt} ${status} for over an hour; check the existing job`,
          });
    }
    for (const agreement of await ctx.db
      .query("signingAgreements")
      .withIndex("by_status", (q) => q.eq("status", "finalising"))
      .take(100)) {
      const attempt = agreement.finalisationAttemptId
        ? await ctx.db.get(agreement.finalisationAttemptId)
        : null;
      if (
        attempt?.status === "failed" &&
        (!attempt.error ||
          !RETRYABLE.has(attempt.error) ||
          attempt.attempt >= 4)
      )
        found.push({
          key: `finalisation-failed:${agreement._id}`,
          kind: "finalisation_failed",
          severity: "critical",
          tenantId: agreement.tenantId,
          agreementId: agreement._id,
          message: `Finalisation needs staff action (${attempt.error ?? "unknown"})`,
        });
      if (now - agreement.updatedAt > 24 * HOUR)
        found.push({
          key: `finalising:${agreement._id}`,
          kind: "finalising_overdue",
          severity: "critical",
          tenantId: agreement.tenantId,
          agreementId: agreement._id,
          message:
            "All participants finished over 24 hours ago but the agreement is not completed",
        });
    }
    const deliveryChecks: [
      Doc<"signingDeliveries">["status"],
      string,
      "warning" | "critical",
      number,
    ][] = [
      ["unknown", "delivery_unresolved", "critical", 0],
      ["rejected", "delivery_rejected", "warning", 0],
      ["failed", "delivery_rejected", "warning", 0],
      ["queued", "delivery_stuck", "warning", 30 * 60_000],
      ["submitting", "delivery_stuck", "warning", 30 * 60_000],
      ["running", "delivery_stuck", "warning", 30 * 60_000],
    ];
    for (const [status, kind, severity, age] of deliveryChecks)
      for (const row of await ctx.db
        .query("signingDeliveries")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(100))
        if (
          now - row.createdAt >= age &&
          (status !== "rejected" || now - row.createdAt < 7 * 24 * HOUR)
        )
          found.push({
            key: `delivery:${row._id}`,
            kind,
            severity,
            tenantId: row.tenantId,
            agreementId: row.agreementId,
            message: `${row.kind} email ${status}${row.error ? ` (${row.error.slice(0, 60)})` : ""}`,
          });
    if (process.env.WINDMILL_SIGNING_TOKEN) {
      for (const status of ["failed", "pending"] as const)
        for (const row of await ctx.db
          .query("signingCheckpoints")
          .withIndex("by_status", (q) => q.eq("status", status))
          .take(100))
          if (status === "failed" || now - row._creationTime > HOUR)
            found.push({
              key: `checkpoint:${row._id}`,
              kind:
                status === "failed"
                  ? "checkpoint_failed"
                  : "checkpoint_pending",
              severity: "warning",
              tenantId: row.tenantId,
              agreementId: row.agreementId,
              message: `Independent audit checkpoint ${status} at event ${row.sequence}`,
            });
    }
    for (const tx of await ctx.db
      .query("signingTransactions")
      .withIndex("by_status_and_expiresAt", (q) =>
        q
          .eq("status", "active")
          .gt("expiresAt", now)
          .lte("expiresAt", now + 48 * HOUR),
      )
      .take(100))
      found.push({
        key: `deadline:${tx._id}`,
        kind: "deadline_soon",
        severity: "warning",
        tenantId: tx.tenantId,
        agreementId: tx.agreementId,
        message:
          "Signing deadline within 48 hours with participants outstanding",
      });
    const seen = new Set<string>();
    let opened = 0;
    for (const alert of found) {
      if (seen.has(alert.key)) continue;
      seen.add(alert.key);
      if (await raiseAlert(ctx, alert)) opened += 1;
    }
    for (const alert of await ctx.db
      .query("signingAlerts")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(500))
      if (SCAN_KINDS.has(alert.kind) && !seen.has(alert.key))
        await ctx.db.patch(alert._id, { status: "resolved", resolvedAt: now });
    return { observed: seen.size, opened };
  },
});

/** Platform administrators only: open alerts and recent resolutions. */
export const alerts = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const open = await ctx.db
      .query("signingAlerts")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(100);
    const tenants = new Map<Id<"tenants">, string>();
    for (const alert of open)
      if (alert.tenantId && !tenants.has(alert.tenantId))
        tenants.set(
          alert.tenantId,
          (await ctx.db.get(alert.tenantId))?.displayName ?? "Company",
        );
    return open.map((alert) => ({
      id: alert._id,
      kind: alert.kind,
      severity: alert.severity,
      message: alert.message,
      company: alert.tenantId ? (tenants.get(alert.tenantId) ?? null) : null,
      tenantId: alert.tenantId ?? null,
      agreementId: alert.agreementId ?? null,
      firstSeenAt: alert.firstSeenAt,
      lastSeenAt: alert.lastSeenAt,
    }));
  },
});

const TERMINAL = [
  "completed",
  "declined",
  "expired",
  "voided",
  "superseded",
] as const;
/**
 * Retention: after the company's transient-retention period, unfinished drafts, unused adopted
 * marks and OTP challenges are deleted. Submissions, consents, events, sessions, delivery
 * facts and finalised evidence are retained. Active legal holds block purging.
 */
export const purgeTransient = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let purged = 0;
    for (const status of TERMINAL) {
      const candidates = await ctx.db
        .query("signingAgreements")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(200);
      for (const agreement of candidates) {
        if (
          agreement.transientPurgedAt ||
          !agreement.signingTransactionId ||
          purged >= 25
        )
          continue;
        const policy = await ctx.db
          .query("signingPolicies")
          .withIndex("by_tenantId", (q) => q.eq("tenantId", agreement.tenantId))
          .unique();
        const days =
          policy?.transientRetentionDays ?? DEFAULT_TRANSIENT_RETENTION_DAYS;
        if (now - agreement.updatedAt < days * 24 * HOUR) continue;
        const holds = await ctx.db
          .query("signingLegalHolds")
          .withIndex("by_agreementId", (q) =>
            q.eq("agreementId", agreement._id),
          )
          .take(50);
        if (holds.some((hold) => hold.releasedAt === undefined)) continue;
        const txId = agreement.signingTransactionId;
        const referenced = new Set<string>();
        for (const submission of await ctx.db
          .query("signingSubmissions")
          .withIndex("by_transactionId", (q) => q.eq("transactionId", txId))
          .take(200))
          for (const mark of (
            JSON.parse(submission.evidence) as { marks?: { hash: string }[] }
          ).marks ?? [])
            referenced.add(mark.hash);
        const counts = { drafts: 0, marks: 0, challenges: 0 };
        for (const invite of await ctx.db
          .query("signingInvitations")
          .withIndex("by_transactionId", (q) => q.eq("transactionId", txId))
          .take(21)) {
          for (const draft of await ctx.db
            .query("signingDrafts")
            .withIndex("by_invitationId_and_invitationVersion", (q) =>
              q.eq("invitationId", invite._id),
            )
            .take(50)) {
            await ctx.db.delete(draft._id);
            counts.drafts += 1;
          }
          for (const mark of await ctx.db
            .query("signingMarks")
            .withIndex("by_invitationId_and_kind", (q) =>
              q.eq("invitationId", invite._id),
            )
            .take(100))
            if (!referenced.has(mark.imageHash)) {
              await ctx.db.delete(mark._id);
              counts.marks += 1;
            }
          for (const challenge of await ctx.db
            .query("signingAccessChallenges")
            .withIndex("by_invitationId", (q) =>
              q.eq("invitationId", invite._id),
            )
            .take(200)) {
            await ctx.db.delete(challenge._id);
            counts.challenges += 1;
          }
        }
        await ctx.db.patch(agreement._id, { transientPurgedAt: now });
        await appendSigningEvent(
          ctx,
          agreement,
          undefined,
          "transient_data_purged",
          {
            retentionDays: days,
            ...counts,
          },
        );
        purged += 1;
      }
    }
    if (purged >= 25)
      await ctx.scheduler.runAfter(
        0,
        internal.signingOperations.purgeTransient,
        {},
      );
    return purged;
  },
});
