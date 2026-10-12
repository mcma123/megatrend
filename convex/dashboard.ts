import { query } from "./_generated/server";
import { v } from "convex/values";
import { recentActivity } from "./lib/activity";
import { listStaffTenants, requireStaff, requireTenantAccess } from "./lib/auth";
import { getClientLabel, isLiveLease } from "./lib/portfolio";

const OPEN_ACTION = new Set(["open", "in_progress", "waiting_on_client", "waiting_on_cyphersoft", "waiting_on_landlord"]);
const PROCESSING = new Set(["uploaded", "queued_for_ocr", "ocr_complete"]);

function monthsUntil(isoDate: string, now: number) {
  return (Date.parse(`${isoDate}T00:00:00Z`) - now) / (1000 * 60 * 60 * 24 * 30.44);
}

/** Staff home: portfolio KPIs, renewal alerts, latest documents and tasks, activity feed. */
export const staffOverview = query({
  args: {},
  handler: async (ctx) => {
    const staff = await requireStaff(ctx);
    const tenants = await listStaffTenants(ctx, staff);
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);

    let activeClients = 0;
    let properties = 0;
    let liveLeases = 0;
    let annualRental = 0;
    let openTasks = 0;
    let overdueTasks = 0;
    let documentsTotal = 0;
    let documentsNeedReview = 0;
    let documentsProcessing = 0;
    let openAnomalies = 0;
    let criticalAnomalies = 0;
    let publishedInsights = 0;
    let draftInsights = 0;
    const renewals = [];
    const latestDocuments = [];
    const latestTasks = [];

    for (const tenant of tenants) {
      if (tenant.status === "active") activeClients += 1;
      const client = await getClientLabel(ctx, tenant._id);

      const tenantProperties = await ctx.db
        .query("properties")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .take(500);
      const propertyNames = new Map(tenantProperties.map((property) => [property._id, property.name]));
      properties += tenantProperties.filter((property) => !property.archivedAt).length;

      const leases = await ctx.db
        .query("leases")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .take(500);
      for (const lease of leases) {
        if (!isLiveLease(lease)) continue;
        liveLeases += 1;
        annualRental += lease.monthlyRental * 12;
        const months = monthsUntil(lease.endDate, now);
        if (months <= 18) {
          renewals.push({
            leaseId: lease._id,
            client,
            propertyName: propertyNames.get(lease.propertyId) ?? "Property",
            endDate: lease.endDate,
            monthsLeft: Math.round(months),
            status: lease.status,
          });
        }
      }

      const actions = await ctx.db
        .query("actions")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .order("desc")
        .take(300);
      for (const action of actions) {
        if (!OPEN_ACTION.has(action.status)) continue;
        openTasks += 1;
        if (action.dueDate && action.dueDate < today) overdueTasks += 1;
        latestTasks.push({
          actionId: action._id,
          title: action.title,
          client,
          status: action.status,
          dueDate: action.dueDate ?? null,
          overdue: Boolean(action.dueDate && action.dueDate < today),
          createdAt: action.createdAt,
        });
      }

      const documents = await ctx.db
        .query("documents")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .order("desc")
        .take(300);
      for (const document of documents) {
        if (document.deletedAt || document.replacedByDocumentId) continue;
        documentsTotal += 1;
        if (document.status === "review_required" || document.status === "extraction_complete") documentsNeedReview += 1;
        if (PROCESSING.has(document.status)) documentsProcessing += 1;
        latestDocuments.push({
          documentId: document._id,
          filename: document.filename,
          client,
          status: document.status,
          documentType: document.documentType ?? document.declaredType ?? null,
          createdAt: document.createdAt,
        });
      }

      const anomalies = await ctx.db
        .query("anomalies")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .take(300);
      for (const anomaly of anomalies) {
        if (anomaly.status !== "open" && anomaly.status !== "investigating") continue;
        openAnomalies += 1;
        if (anomaly.severity === "critical" || anomaly.severity === "high") criticalAnomalies += 1;
      }

      const insights = await ctx.db
        .query("insights")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .take(300);
      publishedInsights += insights.filter((insight) => insight.status === "published").length;
      draftInsights += insights.filter((insight) => insight.status === "draft" || insight.status === "under_review").length;
    }

    return {
      kpis: {
        activeClients,
        totalClients: tenants.length,
        properties,
        liveLeases,
        renewingWithin18Months: renewals.length,
        annualRental,
        openTasks,
        overdueTasks,
        documentsTotal,
        documentsNeedReview,
        documentsProcessing,
        openAnomalies,
        criticalAnomalies,
        publishedInsights,
        draftInsights,
      },
      renewals: renewals.sort((a, b) => a.endDate.localeCompare(b.endDate)).slice(0, 8),
      latestDocuments: latestDocuments.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
      latestTasks: latestTasks
        .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
        .slice(0, 5),
      activity: await recentActivity(ctx, tenants.map((tenant) => tenant._id)),
    };
  },
});

/** Activity feed for one client (staff and that client's users). */
export const clientActivity = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const access = await requireTenantAccess(ctx, args.tenantId);
    const rows = await recentActivity(ctx, [args.tenantId], 25);
    if (access.principalType === "staff") return rows.slice(0, 10);
    // Clients don't see internal workflow events.
    const clientVisible = new Set([
      "property.created",
      "lease.created",
      "lease.updated_from_document",
      "lease.created_from_document",
      "document.uploaded",
      "document.approved",
      "insight.published",
      "action.requested",
      "action.completed",
      "membership.invitation_accepted",
    ]);
    return rows.filter((row) => clientVisible.has(row.eventType)).slice(0, 10);
  },
});
