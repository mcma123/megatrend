import { QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

// Turns audit events into one-line activity entries for dashboards.

const VERBS: Record<string, string> = {
  "tenant.created": "Client workspace created",
  "client.updated": "Client profile updated",
  "property.created": "Property added",
  "property.updated": "Property updated",
  "property.archived": "Property archived",
  "lease.created": "Lease added",
  "lease.updated": "Lease updated",
  "lease.archived": "Lease archived",
  "lease.created_from_document": "Lease created from approved document",
  "lease.updated_from_document": "Lease verified from document",
  "document.uploaded": "Document uploaded",
  "document.processed": "Document processed",
  "document.processing_failed": "Document processing failed",
  "document.approved": "Document review completed",
  "document.deleted": "Document deleted",
  "document.deletion_requested": "Client asked to delete a document",
  "insight.drafted": "Insight drafted",
  "insight.published": "Insight published",
  "insight.withdrawn": "Insight withdrawn",
  "action.requested": "Client request received",
  "action.created": "Task created",
  "action.completed": "Task completed",
  "action.comment_added": "Reply on task",
  "anomaly.detected": "Anomaly detected",
  "anomaly.resolved": "Anomaly resolved",
  "invoice.recorded": "Invoice recorded",
  "membership.invited": "Team member invited",
  "membership.invitation_accepted": "Invitation accepted",
};

const SHOWN = new Set(Object.keys(VERBS));

async function targetLabel(ctx: QueryCtx, event: Doc<"auditEvents">) {
  try {
    switch (event.targetType) {
      case "document":
        return (await ctx.db.get(event.targetId as Id<"documents">))?.filename ?? null;
      case "property":
        return (await ctx.db.get(event.targetId as Id<"properties">))?.name ?? null;
      case "lease": {
        const lease = await ctx.db.get(event.targetId as Id<"leases">);
        return lease ? ((await ctx.db.get(lease.propertyId))?.name ?? null) : null;
      }
      case "insight":
        return (await ctx.db.get(event.targetId as Id<"insights">))?.title ?? null;
      case "action":
        return (await ctx.db.get(event.targetId as Id<"actions">))?.title ?? null;
      case "anomaly":
        return (await ctx.db.get(event.targetId as Id<"anomalies">))?.supplier ?? null;
      case "invoice":
        return (await ctx.db.get(event.targetId as Id<"invoices">))?.supplier ?? null;
      default:
        return null;
    }
  } catch {
    // Target ids from another table type (or deleted) simply have no label.
    return null;
  }
}

export async function recentActivity(ctx: QueryCtx, tenantIds: Id<"tenants">[], limit = 15) {
  const events: Doc<"auditEvents">[] = [];
  for (const tenantId of tenantIds) {
    const latest = await ctx.db
      .query("auditEvents")
      .withIndex("by_tenantId_and_occurredAt", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(40);
    events.push(...latest.filter((event) => SHOWN.has(event.eventType)));
  }
  events.sort((a, b) => b.occurredAt - a.occurredAt);

  const rows = [];
  for (const event of events.slice(0, limit)) {
    const actor = event.actorId ? await ctx.db.get(event.actorId) : null;
    const label = await targetLabel(ctx, event);
    rows.push({
      id: event._id,
      tenantId: event.tenantId,
      eventType: event.eventType,
      text: label ? `${VERBS[event.eventType]}: ${label}` : VERBS[event.eventType],
      actorName: event.actorType === "system" ? "System" : (actor?.name ?? actor?.email ?? null),
      occurredAt: event.occurredAt,
    });
  }
  return rows;
}
