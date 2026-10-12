import { internalMutation, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { listStaffTenants, requirePlatformAdmin, requireStaff } from "./lib/auth";
import {
  AUTOMATIONS,
  RENEWAL_STEPS,
  getAutomationRow,
  runOverdueReminders,
  runRenewalCadence,
  type AutomationKey,
  type RunMode,
} from "./lib/automations";
import { getClientLabel, isLiveLease } from "./lib/portfolio";
import { automationKey } from "./validators";

// Platform automations. Definitions live in lib/automations.ts; this module exposes their
// settings, run history, manual/dry runs, and the entry point for the daily crons (crons.ts).

const SCHEDULED: AutomationKey[] = ["renewal_cadence", "overdue_reminders"];

async function execute(ctx: MutationCtx, key: AutomationKey, mode: RunMode, triggeredBy?: Id<"users">) {
  if (key === "renewal_cadence") return await runRenewalCadence(ctx, mode, triggeredBy);
  if (key === "overdue_reminders") return await runOverdueReminders(ctx, mode, triggeredBy);
  throw new ConvexError("This automation runs on events and can't be started manually");
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const rows = [];
    for (const definition of AUTOMATIONS) {
      const row = await getAutomationRow(ctx, definition.key);
      const lastRuns = await ctx.db
        .query("automationRuns")
        .withIndex("by_automationKey_and_startedAt", (q) => q.eq("automationKey", definition.key))
        .order("desc")
        .take(1);
      rows.push({
        ...definition,
        enabled: row?.enabled ?? true,
        runCount: row?.runCount ?? 0,
        lastRunAt: row?.lastRunAt ?? null,
        lastRunStatus: row?.lastRunStatus ?? null,
        lastRunSummary: lastRuns[0]?.summary ?? null,
        canRunManually: SCHEDULED.includes(definition.key),
      });
    }
    return rows;
  },
});

export const get = query({
  args: { key: automationKey },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const definition = AUTOMATIONS.find((item) => item.key === args.key);
    if (!definition) return null;
    const row = await getAutomationRow(ctx, args.key);
    const runs = await ctx.db
      .query("automationRuns")
      .withIndex("by_automationKey_and_startedAt", (q) => q.eq("automationKey", args.key))
      .order("desc")
      .take(30);
    const runsWithActor = [];
    for (const run of runs) {
      const actor = run.triggeredBy ? await ctx.db.get(run.triggeredBy) : null;
      runsWithActor.push({ ...run, triggeredByName: actor?.name ?? actor?.email ?? null });
    }

    // Upcoming renewal steps for the next 120 days (renewal cadence only).
    const upcoming = [];
    if (args.key === "renewal_cadence") {
      const now = Date.now();
      const today = Date.parse(new Date(now).toISOString().slice(0, 10));
      for (const tenant of await listStaffTenants(ctx, staff)) {
        const client = await getClientLabel(ctx, tenant._id);
        const leases = await ctx.db
          .query("leases")
          .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
          .take(500);
        for (const lease of leases) {
          if (!isLiveLease(lease)) continue;
          const end = Date.parse(lease.endDate);
          const property = await ctx.db.get(lease.propertyId);
          for (const step of RENEWAL_STEPS) {
            const due = end - step.daysBefore * 86_400_000;
            const inDays = Math.round((due - today) / 86_400_000);
            if (inDays > 0 && inDays <= 120) {
              upcoming.push({
                leaseId: lease._id,
                client,
                propertyName: property?.name ?? "Property",
                daysBefore: step.daysBefore,
                title: step.title,
                dueDate: new Date(due).toISOString().slice(0, 10),
                inDays,
              });
            }
          }
        }
      }
      upcoming.sort((a, b) => a.inDays - b.inDays);
    }

    return {
      ...definition,
      enabled: row?.enabled ?? true,
      runCount: row?.runCount ?? 0,
      lastRunAt: row?.lastRunAt ?? null,
      canRunManually: SCHEDULED.includes(args.key),
      canManage: staff.isPlatformAdmin,
      steps: args.key === "renewal_cadence" ? RENEWAL_STEPS.map(({ daysBefore, title, visibleToClient }) => ({ daysBefore, title, visibleToClient })) : [],
      runs: runsWithActor,
      upcoming: upcoming.slice(0, 40),
    };
  },
});

/** Platform automations affect every client, so only platform admins switch them on/off. */
export const setEnabled = mutation({
  args: { key: automationKey, enabled: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    const now = Date.now();
    const row = await getAutomationRow(ctx, args.key);
    if (row) {
      await ctx.db.patch(row._id, { enabled: args.enabled, updatedAt: now, updatedBy: actor._id });
    } else {
      await ctx.db.insert("automations", {
        key: args.key,
        enabled: args.enabled,
        runCount: 0,
        updatedAt: now,
        updatedBy: actor._id,
      });
    }
    // Platform-level setting (not tenant data): `updatedBy`/`updatedAt` on the row record the change.
    return { key: args.key, enabled: args.enabled };
  },
});

/** Dry run: shows what would happen now without creating actions or notifications. */
export const simulate = mutation({
  args: { key: automationKey },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const result = await execute(ctx, args.key, "dry_run", staff.user._id);
    return result;
  },
});

export const runNow = mutation({
  args: { key: automationKey },
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    const row = await getAutomationRow(ctx, args.key);
    if (row && !row.enabled) throw new ConvexError("Enable the automation before running it");
    return await execute(ctx, args.key, "manual", actor._id);
  },
});

/** Cron entry point (crons.ts). Skips disabled automations. */
export const runScheduled = internalMutation({
  args: { key: automationKey },
  handler: async (ctx, args) => {
    const row = await getAutomationRow(ctx, args.key);
    if (row && !row.enabled) return null;
    await execute(ctx, args.key, "scheduled");
    return null;
  },
});

/** Renewal steps already handled for a lease (fired or skipped), for the lease timeline. */
export const leaseMilestones = query({
  args: { leaseId: v.id("leases") },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const lease = await ctx.db.get(args.leaseId);
    if (!lease) return [];
    const milestones = await ctx.db
      .query("renewalMilestones")
      .withIndex("by_leaseId", (q) => q.eq("leaseId", args.leaseId))
      .take(50);
    return milestones
      .filter((milestone) => milestone.leaseEndDate === lease.endDate)
      .map((milestone) => ({
        daysBefore: milestone.daysBefore,
        status: milestone.status,
        actionId: milestone.actionId ?? null,
        createdAt: milestone.createdAt,
      }));
  },
});
