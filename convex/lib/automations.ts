import { MutationCtx, QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { appendAuditEvent } from "./audit";
import { isoDateFromNow, upsertAutoAction } from "./autoActions";
import { clientRecipients, notify, staffRecipients } from "./notifications";
import { isLiveLease } from "./portfolio";

export type AutomationKey = Doc<"automations">["key"];
export type RunMode = Doc<"automationRuns">["mode"];

export const AUTOMATIONS: Array<{
  key: AutomationKey;
  name: string;
  category: "Renewal" | "Client" | "Anomaly";
  trigger: string;
  description: string;
}> = [
  {
    key: "renewal_cadence",
    name: "Lease renewal cadence",
    category: "Renewal",
    trigger: "Daily at 07:00 (SAST) · T-180 → T-7 days before lease end",
    description:
      "Opens the renewal window at T-180 (client action, staff + client notification, draft insight), then creates the briefing-pack, client-review, comparables, invoice cross-check and final-recommendation steps.",
  },
  {
    key: "overdue_reminders",
    name: "Overdue action reminders",
    category: "Client",
    trigger: "Daily at 07:15 (SAST)",
    description:
      "Reminds the client about actions waiting on them that are past their due date, at most once a week per action.",
  },
  {
    key: "invoice_anomaly_check",
    name: "Invoice anomaly check",
    category: "Anomaly",
    trigger: "When an invoice or utility statement review is completed",
    description:
      "Compares each approved invoice with the supplier's rolling baseline for the property and flags spikes and possible duplicates.",
  },
];

export const RENEWAL_STEPS: Array<{
  daysBefore: number;
  title: string;
  visibleToClient: boolean;
  status: Doc<"actions">["status"];
  priority: Doc<"actions">["priority"];
  dueInDays: number;
  notifyClient: boolean;
  draftInsight: boolean;
  description: (propertyName: string, endDate: string) => string;
}> = [
  {
    daysBefore: 180,
    title: "Renewal window open",
    visibleToClient: true,
    status: "waiting_on_client",
    priority: "high",
    dueInDays: 30,
    notifyClient: true,
    draftInsight: true,
    description: (property, end) =>
      `The lease for ${property} ends on ${end}. Cyphersoft is preparing renewal options — please tell us your plans for this site (renew, renegotiate or relocate).`,
  },
  {
    daysBefore: 150,
    title: "Prepare renewal briefing pack",
    visibleToClient: false,
    status: "open",
    priority: "high",
    dueInDays: 14,
    notifyClient: false,
    draftInsight: false,
    description: (property) => `Market context, current rental vs comparables and scenarios for ${property}.`,
  },
  {
    daysBefore: 120,
    title: "Review briefing pack with client",
    visibleToClient: false,
    status: "open",
    priority: "high",
    dueInDays: 14,
    notifyClient: false,
    draftInsight: false,
    description: (property) => `Walk the client through the renewal briefing pack for ${property}.`,
  },
  {
    daysBefore: 90,
    title: "Refresh market comparables",
    visibleToClient: false,
    status: "open",
    priority: "medium",
    dueInDays: 14,
    notifyClient: false,
    draftInsight: false,
    description: (property) => `Re-run sourcing across listed and off-market inventory near ${property}.`,
  },
  {
    daysBefore: 30,
    title: "Invoice cross-check before negotiation",
    visibleToClient: false,
    status: "open",
    priority: "medium",
    dueInDays: 7,
    notifyClient: false,
    draftInsight: false,
    description: (property) => `Review the invoice trend and anomalies for ${property} before negotiating.`,
  },
  {
    daysBefore: 7,
    title: "Final renewal recommendation",
    visibleToClient: true,
    status: "waiting_on_client",
    priority: "critical",
    dueInDays: 5,
    notifyClient: true,
    draftInsight: false,
    description: (property, end) =>
      `The lease for ${property} ends on ${end}. Please confirm your decision on Cyphersoft's final recommendation.`,
  },
];

const DAY_MS = 86_400_000;

function daysUntil(isoDate: string, now: number) {
  const today = Date.parse(new Date(now).toISOString().slice(0, 10));
  return Math.round((Date.parse(isoDate) - today) / DAY_MS);
}

export async function getAutomationRow(ctx: QueryCtx, key: AutomationKey) {
  return (
    await ctx.db
      .query("automations")
      .withIndex("by_key", (q) => q.eq("key", key))
      .take(1)
  )[0];
}

/** Automations are enabled unless a staff member switched them off. */
export async function isAutomationEnabled(ctx: QueryCtx, key: AutomationKey) {
  return (await getAutomationRow(ctx, key))?.enabled ?? true;
}

type RunItem = { tenantId?: Id<"tenants">; label: string; detail: string };

export async function recordRun(
  ctx: MutationCtx,
  args: {
    key: AutomationKey;
    mode: RunMode;
    startedAt: number;
    triggeredBy?: Id<"users">;
    summary: string;
    stats: Record<string, number>;
    items: RunItem[];
    error?: string;
  },
) {
  const now = Date.now();
  const status = args.error ? "failed" : "succeeded";
  const runId = await ctx.db.insert("automationRuns", {
    automationKey: args.key,
    mode: args.mode,
    status,
    startedAt: args.startedAt,
    finishedAt: now,
    triggeredBy: args.triggeredBy,
    summary: args.summary.slice(0, 500),
    stats: args.stats,
    items: args.items.slice(0, 50).map((item) => ({ ...item, label: item.label.slice(0, 200), detail: item.detail.slice(0, 300) })),
    error: args.error,
  });
  if (args.mode !== "dry_run") {
    const row = await getAutomationRow(ctx, args.key);
    if (row) {
      await ctx.db.patch(row._id, { runCount: row.runCount + 1, lastRunAt: now, lastRunStatus: status, updatedAt: now });
    } else {
      await ctx.db.insert("automations", {
        key: args.key,
        enabled: true,
        runCount: 1,
        lastRunAt: now,
        lastRunStatus: status,
        updatedAt: now,
      });
    }
  }
  return runId;
}

// --- Renewal cadence --------------------------------------------------------

type PlannedStep = {
  tenant: Doc<"tenants">;
  lease: Doc<"leases">;
  propertyName: string;
  step: (typeof RENEWAL_STEPS)[number];
  action: "fire" | "skip";
  daysLeft: number;
};

/** Which renewal steps are due now. Only the latest reached step fires; older unhandled ones are skipped. */
export async function planRenewalCadence(ctx: QueryCtx, now: number) {
  const tenants = await ctx.db.query("tenants").take(500);
  const planned: PlannedStep[] = [];
  let leasesChecked = 0;
  for (const tenant of tenants) {
    if (tenant.status !== "active") continue;
    const leases = await ctx.db
      .query("leases")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
      .take(500);
    for (const lease of leases) {
      if (!isLiveLease(lease)) continue;
      leasesChecked += 1;
      const daysLeft = daysUntil(lease.endDate, now);
      if (daysLeft < 0) continue;
      const reached = RENEWAL_STEPS.filter((step) => daysLeft <= step.daysBefore);
      if (reached.length === 0) continue;
      const handled = new Set(
        (
          await ctx.db
            .query("renewalMilestones")
            .withIndex("by_leaseId", (q) => q.eq("leaseId", lease._id))
            .take(50)
        )
          .filter((milestone) => milestone.leaseEndDate === lease.endDate)
          .map((milestone) => milestone.daysBefore),
      );
      const latest = reached[reached.length - 1];
      const property = await ctx.db.get(lease.propertyId);
      for (const step of reached) {
        if (handled.has(step.daysBefore)) continue;
        planned.push({
          tenant,
          lease,
          propertyName: property?.name ?? "the property",
          step,
          action: step === latest ? "fire" : "skip",
          daysLeft,
        });
      }
    }
  }
  return { planned, leasesChecked };
}

function formatEnd(isoDate: string) {
  return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

export async function runRenewalCadence(ctx: MutationCtx, mode: RunMode, triggeredBy?: Id<"users">) {
  const startedAt = Date.now();
  const { planned, leasesChecked } = await planRenewalCadence(ctx, startedAt);
  const fired = planned.filter((item) => item.action === "fire");
  const items: RunItem[] = planned.map((item) => ({
    tenantId: item.tenant._id,
    label: `${item.action === "fire" ? "T-" + item.step.daysBefore : "Skip T-" + item.step.daysBefore} · ${item.propertyName}`,
    detail: `${item.step.title}; ${item.daysLeft} days to lease end (${item.lease.endDate})`,
  }));

  const stats: Record<string, number> = {
    leasesChecked,
    stepsFired: 0,
    stepsSkipped: planned.length - fired.length,
    actionsCreated: 0,
    notificationsSent: 0,
    insightsDrafted: 0,
  };

  if (mode === "dry_run") {
    stats.stepsFired = fired.length;
    const runId = await recordRun(ctx, {
      key: "renewal_cadence",
      mode,
      startedAt,
      triggeredBy,
      summary: `Dry run: ${fired.length} step${fired.length === 1 ? "" : "s"} would fire across ${leasesChecked} live lease${leasesChecked === 1 ? "" : "s"}.`,
      stats,
      items,
    });
    return { runId, stats };
  }

  const runItems: RunItem[] = [];
  const pendingMilestones: Array<Omit<Doc<"renewalMilestones">, "_id" | "_creationTime" | "runId">> = [];
  for (const item of planned) {
    const endLabel = formatEnd(item.lease.endDate);
    if (item.action === "skip") {
      pendingMilestones.push({
        tenantId: item.tenant._id,
        leaseId: item.lease._id,
        leaseEndDate: item.lease.endDate,
        daysBefore: item.step.daysBefore,
        status: "skipped",
        createdAt: Date.now(),
      });
      continue;
    }
    const { actionId, created } = await upsertAutoAction(ctx, {
      tenantId: item.tenant._id,
      autoKey: `renewal:${item.lease._id}:${item.lease.endDate}:${item.step.daysBefore}`,
      title: `${item.step.title}: ${item.propertyName}`,
      description: item.step.description(item.propertyName, endLabel),
      propertyId: item.lease.propertyId,
      status: item.step.status,
      priority: item.step.priority,
      visibleToClient: item.step.visibleToClient,
      dueDate: isoDateFromNow(item.step.dueInDays),
      source: "automation",
    });
    if (created) stats.actionsCreated += 1;

    let insightId: Id<"insights"> | undefined;
    if (item.step.draftInsight) {
      const now = Date.now();
      insightId = await ctx.db.insert("insights", {
        tenantId: item.tenant._id,
        propertyId: item.lease.propertyId,
        leaseId: item.lease._id,
        documentIds: item.lease.sourceDocumentId ? [item.lease.sourceDocumentId] : [],
        title: `Renewal window open for ${item.propertyName}`,
        body: `The lease for ${item.propertyName} ends on ${endLabel}, ${item.daysLeft} days from today. This is the time to decide whether to renew, renegotiate or relocate; Cyphersoft is preparing a briefing pack with market comparables.`,
        recommendedAction: "Share your plans for this site so we can prepare the right options.",
        category: "renewal",
        priority: item.daysLeft <= 90 ? "critical" : "high",
        status: "draft",
        draftedBy: "system",
        createdBy: item.tenant.createdBy,
        createdAt: now,
        updatedAt: now,
      });
      stats.insightsDrafted += 1;
    }

    const staffSent = await notify(ctx, {
      recipients: await staffRecipients(ctx, item.tenant._id),
      tenantId: item.tenant._id,
      kind: "renewal.step",
      title: `T-${item.step.daysBefore} ${item.step.title}: ${item.propertyName}`,
      body: `Lease ends ${endLabel}.`,
      link: `/leases/${item.lease._id}`,
    });
    stats.notificationsSent += staffSent;
    if (item.step.notifyClient) {
      stats.notificationsSent += await notify(ctx, {
        recipients: await clientRecipients(ctx, item.tenant._id),
        tenantId: item.tenant._id,
        kind: "renewal.step",
        title: `${item.step.title}: ${item.propertyName}`,
        body: `Your lease ends on ${endLabel}.`,
        link: `/portal/${item.tenant.slug}/actions`,
      });
    }
    stats.stepsFired += 1;
    pendingMilestones.push({
      tenantId: item.tenant._id,
      leaseId: item.lease._id,
      leaseEndDate: item.lease.endDate,
      daysBefore: item.step.daysBefore,
      status: "fired",
      actionId,
      insightId,
      createdAt: Date.now(),
    });
    runItems.push({
      tenantId: item.tenant._id,
      label: `T-${item.step.daysBefore} · ${item.propertyName}`,
      detail: `${item.step.title}; lease ends ${item.lease.endDate}`,
    });
    await appendAuditEvent(ctx, {
      tenantId: item.tenant._id,
      eventType: "automation.renewal_step",
      actorType: "system",
      targetType: "lease",
      targetId: item.lease._id,
      correlationId: `lease:${item.lease._id}`,
      sourceSystem: "convex",
      occurredAt: Date.now(),
      payloadAfter: JSON.stringify({ daysBefore: item.step.daysBefore, actionId }),
    });
  }

  const runId = await recordRun(ctx, {
    key: "renewal_cadence",
    mode,
    startedAt,
    triggeredBy,
    summary:
      stats.stepsFired === 0
        ? `No renewal steps due across ${leasesChecked} live lease${leasesChecked === 1 ? "" : "s"}.`
        : `${stats.stepsFired} renewal step${stats.stepsFired === 1 ? "" : "s"} fired across ${leasesChecked} live lease${leasesChecked === 1 ? "" : "s"}.`,
    stats,
    items: [...runItems, ...items.filter((item) => item.label.startsWith("Skip"))],
  });
  for (const milestone of pendingMilestones) {
    await ctx.db.insert("renewalMilestones", { ...milestone, runId });
  }
  return { runId, stats };
}

// --- Overdue reminders ------------------------------------------------------

const REMINDER_INTERVAL_MS = 6 * DAY_MS;

export async function runOverdueReminders(ctx: MutationCtx, mode: RunMode, triggeredBy?: Id<"users">) {
  const startedAt = Date.now();
  const today = new Date(startedAt).toISOString().slice(0, 10);
  const tenants = await ctx.db.query("tenants").take(500);
  const items: RunItem[] = [];
  const stats: Record<string, number> = { actionsChecked: 0, remindersSent: 0, notificationsSent: 0 };

  for (const tenant of tenants) {
    if (tenant.status !== "active") continue;
    const waiting = await ctx.db
      .query("actions")
      .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", tenant._id).eq("status", "waiting_on_client"))
      .take(300);
    for (const action of waiting) {
      if (!action.visibleToClient || !action.dueDate) continue;
      stats.actionsChecked += 1;
      if (action.dueDate >= today) continue;
      if (action.lastReminderAt && startedAt - action.lastReminderAt < REMINDER_INTERVAL_MS) continue;
      items.push({ tenantId: tenant._id, label: action.title, detail: `Overdue since ${action.dueDate}` });
      stats.remindersSent += 1;
      if (mode === "dry_run") continue;
      stats.notificationsSent += await notify(ctx, {
        recipients: await clientRecipients(ctx, tenant._id),
        tenantId: tenant._id,
        kind: "action.overdue_reminder",
        title: `Reminder: ${action.title}`,
        body: `This was due on ${action.dueDate}. Reply or upload what's needed so Cyphersoft can continue.`,
        link: `/portal/${tenant.slug}/actions`,
      });
      await ctx.db.patch(action._id, { lastReminderAt: startedAt });
    }
  }

  const runId = await recordRun(ctx, {
    key: "overdue_reminders",
    mode,
    startedAt,
    triggeredBy,
    summary:
      mode === "dry_run"
        ? `Dry run: ${stats.remindersSent} reminder${stats.remindersSent === 1 ? "" : "s"} would be sent.`
        : `${stats.remindersSent} reminder${stats.remindersSent === 1 ? "" : "s"} sent for overdue client actions.`,
    stats,
    items,
  });
  return { runId, stats };
}
