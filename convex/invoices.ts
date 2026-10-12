import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx } from "./_generated/server";
import { appendAuditEvent } from "./lib/audit";
import { closeAutoAction } from "./lib/autoActions";
import {
  listStaffTenants,
  requireStaff,
  requireTenantAccess,
  requireTenantWriter,
} from "./lib/auth";
import { clientRecipients, notify, tenantSlug } from "./lib/notifications";
import { getClientLabel, optionalText } from "./lib/portfolio";
import { anomalyStatus } from "./validators";

// Invoice records (from approved invoice / utility documents) and their anomalies.
// Clients see their invoices, but only the anomalies staff chose to share.

async function tenantIdsFor(ctx: QueryCtx, tenantId?: Id<"tenants">) {
  if (tenantId) {
    const access = await requireTenantAccess(ctx, tenantId);
    return { tenantIds: [tenantId], clientView: access.principalType === "client" };
  }
  const staff = await requireStaff(ctx);
  return { tenantIds: (await listStaffTenants(ctx, staff)).map((tenant) => tenant._id), clientView: false };
}

async function anomalyRow(ctx: QueryCtx, anomaly: Doc<"anomalies">) {
  const property = anomaly.propertyId ? await ctx.db.get(anomaly.propertyId) : null;
  const document = await ctx.db.get(anomaly.documentId);
  return {
    ...anomaly,
    client: await getClientLabel(ctx, anomaly.tenantId),
    property: property ? { propertyId: property._id, name: property.name } : null,
    document: document && !document.deletedAt ? { documentId: document._id, filename: document.filename } : null,
  };
}

export const list = query({
  args: { tenantId: v.optional(v.id("tenants")) },
  handler: async (ctx, args) => {
    const { tenantIds, clientView } = await tenantIdsFor(ctx, args.tenantId);
    const rows = [];
    for (const tenantId of tenantIds) {
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
        .order("desc")
        .take(300);
      for (const invoice of invoices) {
        const property = invoice.propertyId ? await ctx.db.get(invoice.propertyId) : null;
        const anomalies = (
          await ctx.db
            .query("anomalies")
            .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
            .take(10)
        ).filter((anomaly) => !clientView || anomaly.sharedWithClient);
        rows.push({
          ...invoice,
          client: await getClientLabel(ctx, invoice.tenantId),
          property: property ? { propertyId: property._id, name: property.name } : null,
          delta: invoice.baseline ? (invoice.amount - invoice.baseline) / invoice.baseline : null,
          anomalies: anomalies.map((anomaly) => ({
            anomalyId: anomaly._id,
            kind: anomaly.kind,
            severity: anomaly.severity,
            status: anomaly.status,
          })),
        });
      }
    }
    return rows.sort((a, b) => b.periodDate.localeCompare(a.periodDate));
  },
});

export const listAnomalies = query({
  args: { tenantId: v.optional(v.id("tenants")), status: v.optional(anomalyStatus) },
  handler: async (ctx, args) => {
    const { tenantIds, clientView } = await tenantIdsFor(ctx, args.tenantId);
    const rows = [];
    for (const tenantId of tenantIds) {
      const anomalies = args.status
        ? await ctx.db
            .query("anomalies")
            .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", tenantId).eq("status", args.status!))
            .order("desc")
            .take(200)
        : await ctx.db
            .query("anomalies")
            .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
            .order("desc")
            .take(200);
      for (const anomaly of anomalies) {
        if (clientView && !anomaly.sharedWithClient) continue;
        rows.push(await anomalyRow(ctx, anomaly));
      }
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const setAnomalyStatus = mutation({
  args: { anomalyId: v.id("anomalies"), status: anomalyStatus, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const anomaly = await ctx.db.get(args.anomalyId);
    if (!anomaly) throw new ConvexError("Anomaly not found");
    const access = await requireTenantWriter(ctx, anomaly.tenantId);
    const now = Date.now();
    const closed = args.status === "resolved" || args.status === "dismissed";
    const note = optionalText(args.note)?.slice(0, 500);
    await ctx.db.patch(anomaly._id, {
      status: args.status,
      note: note ?? anomaly.note,
      resolvedBy: closed ? access.user._id : undefined,
      resolvedAt: closed ? now : undefined,
      updatedAt: now,
    });
    if (closed) {
      await closeAutoAction(ctx, `anomaly:${anomaly._id}`);
    }
    await appendAuditEvent(ctx, {
      tenantId: anomaly.tenantId,
      eventType: `anomaly.${args.status}`,
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "anomaly",
      targetId: anomaly._id,
      correlationId: `document:${anomaly.documentId}`,
      sourceSystem: "convex",
      occurredAt: now,
      reason: note,
      payloadBefore: JSON.stringify({ status: anomaly.status }),
      payloadAfter: JSON.stringify({ status: args.status }),
    });
    return { anomalyId: anomaly._id };
  },
});

/** Share (or stop sharing) an anomaly alert with the client portal. */
export const setAnomalyShared = mutation({
  args: { anomalyId: v.id("anomalies"), shared: v.boolean() },
  handler: async (ctx, args) => {
    const anomaly = await ctx.db.get(args.anomalyId);
    if (!anomaly) throw new ConvexError("Anomaly not found");
    const access = await requireTenantWriter(ctx, anomaly.tenantId);
    const now = Date.now();
    await ctx.db.patch(anomaly._id, { sharedWithClient: args.shared, updatedAt: now });
    await appendAuditEvent(ctx, {
      tenantId: anomaly.tenantId,
      eventType: args.shared ? "anomaly.shared_with_client" : "anomaly.unshared",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "anomaly",
      targetId: anomaly._id,
      correlationId: `document:${anomaly.documentId}`,
      sourceSystem: "convex",
      occurredAt: now,
    });
    if (args.shared && !anomaly.sharedWithClient) {
      const slug = await tenantSlug(ctx, anomaly.tenantId);
      await notify(ctx, {
        recipients: await clientRecipients(ctx, anomaly.tenantId),
        tenantId: anomaly.tenantId,
        kind: "anomaly.shared",
        title: `Cost alert: ${anomaly.supplier}`,
        body: anomaly.cause,
        link: `/portal/${slug}`,
      });
    }
    return { anomalyId: anomaly._id };
  },
});
