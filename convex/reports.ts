import { query } from "./_generated/server";
import { listStaffTenants, requireStaff } from "./lib/auth";
import { isLiveLease } from "./lib/portfolio";
import { readCurrentFields } from "./lib/documentFields";

/** Portfolio analytics plus system-usage measures for the ROI calculator. */
export const portfolio = query({
  args: {},
  handler: async (ctx) => {
    const staff = await requireStaff(ctx);
    const tenants = await listStaffTenants(ctx, staff);
    const now = Date.now();
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

    const byRegion = new Map<string, number>();
    const byYear = new Map<string, { count: number; annualRental: number }>();
    const byType = new Map<string, number>();
    let annualRental = 0;
    let liveLeases = 0;
    let documentsProcessed = 0;
    let documentsLast30Days = 0;
    let fieldsExtracted = 0;
    let fieldsApproved = 0;
    let fieldsCorrected = 0;
    const processingSeconds: number[] = [];
    let anomaliesFound = 0;
    let anomalyExcess = 0;

    for (const tenant of tenants) {
      const properties = await ctx.db
        .query("properties")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .take(500);
      const propertyById = new Map(
        properties.map((property) => [property._id, property]),
      );

      const leases = await ctx.db
        .query("leases")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .take(500);
      for (const lease of leases) {
        if (!isLiveLease(lease)) continue;
        liveLeases += 1;
        const yearly = lease.monthlyRental * 12;
        annualRental += yearly;
        const property = propertyById.get(lease.propertyId);
        const region = property?.province || property?.city || "Unspecified";
        byRegion.set(region, (byRegion.get(region) ?? 0) + yearly);
        if (property)
          byType.set(
            property.propertyType,
            (byType.get(property.propertyType) ?? 0) + yearly,
          );
        const year = lease.endDate.slice(0, 4);
        const entry = byYear.get(year) ?? { count: 0, annualRental: 0 };
        byYear.set(year, {
          count: entry.count + 1,
          annualRental: entry.annualRental + yearly,
        });
      }

      const documents = await ctx.db
        .query("documents")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .take(1000);
      for (const document of documents) {
        if (
          document.deletedAt ||
          document.replacedByDocumentId ||
          !document.processedAt
        )
          continue;
        documentsProcessed += 1;
        if (document.createdAt >= monthAgo) documentsLast30Days += 1;
        if (document.processingStartedAt) {
          processingSeconds.push(
            (document.processedAt - document.processingStartedAt) / 1000,
          );
        }
        const fields = await readCurrentFields(ctx, document);
        for (const field of fields) {
          if (field.state === "superseded") continue;
          fieldsExtracted += 1;
          if (field.state === "approved") {
            fieldsApproved += 1;
            if (field.originalValue !== undefined) fieldsCorrected += 1;
          }
        }
      }

      const anomalies = await ctx.db
        .query("anomalies")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .take(500);
      for (const anomaly of anomalies) {
        if (anomaly.status === "dismissed") continue;
        anomaliesFound += 1;
        if (anomaly.kind === "cost_spike" && anomaly.baseline !== undefined) {
          anomalyExcess += Math.max(0, anomaly.amount - anomaly.baseline);
        }
      }
    }

    const sortedSeconds = [...processingSeconds].sort((a, b) => a - b);
    return {
      totals: {
        clients: tenants.length,
        liveLeases,
        annualRental,
        documentsProcessed,
        documentsLast30Days,
        fieldsExtracted,
        fieldsApproved,
        fieldsCorrected,
        medianProcessingSeconds: sortedSeconds.length
          ? sortedSeconds[Math.floor(sortedSeconds.length / 2)]
          : null,
        anomaliesFound,
        anomalyExcess,
      },
      byRegion: [...byRegion.entries()]
        .map(([region, value]) => ({ region, annualRental: value }))
        .sort((a, b) => b.annualRental - a.annualRental),
      byPropertyType: [...byType.entries()]
        .map(([type, value]) => ({ type, annualRental: value }))
        .sort((a, b) => b.annualRental - a.annualRental),
      renewalsByYear: [...byYear.entries()]
        .map(([year, value]) => ({ year, ...value }))
        .sort((a, b) => a.year.localeCompare(b.year)),
    };
  },
});
