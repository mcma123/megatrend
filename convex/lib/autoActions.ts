import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

const OPEN_STATUSES = new Set(["open", "in_progress", "waiting_on_client", "waiting_on_cyphersoft", "waiting_on_landlord"]);

/**
 * Creates an automatic action once per `autoKey` (e.g. "document:<id>:missing"); if an open one
 * exists it is refreshed instead, so re-processing never duplicates actions.
 */
export async function upsertAutoAction(
  ctx: MutationCtx,
  args: {
    tenantId: Id<"tenants">;
    autoKey: string;
    title: string;
    description?: string;
    propertyId?: Id<"properties">;
    documentId?: Id<"documents">;
    status: Doc<"actions">["status"];
    priority: Doc<"actions">["priority"];
    visibleToClient: boolean;
    dueDate?: string;
    source?: Doc<"actions">["source"];
  },
) {
  const now = Date.now();
  const existing = await ctx.db
    .query("actions")
    .withIndex("by_autoKey", (q) => q.eq("autoKey", args.autoKey))
    .take(5);
  const open = existing.find((action) => OPEN_STATUSES.has(action.status));
  if (open) {
    await ctx.db.patch(open._id, {
      title: args.title,
      description: args.description,
      updatedAt: now,
    });
    return { actionId: open._id, created: false };
  }
  const actionId = await ctx.db.insert("actions", {
    tenantId: args.tenantId,
    title: args.title,
    description: args.description,
    propertyId: args.propertyId,
    documentId: args.documentId,
    status: args.status,
    priority: args.priority,
    dueDate: args.dueDate,
    source: args.source ?? "document_flag",
    visibleToClient: args.visibleToClient,
    autoKey: args.autoKey,
    requestedByPrincipal: "system",
    createdAt: now,
    updatedAt: now,
  });
  return { actionId, created: true };
}

/** Completes any open automatic action with this key (e.g. once the document is approved). */
export async function closeAutoAction(ctx: MutationCtx, autoKey: string) {
  const existing = await ctx.db
    .query("actions")
    .withIndex("by_autoKey", (q) => q.eq("autoKey", autoKey))
    .take(5);
  const now = Date.now();
  for (const action of existing) {
    if (OPEN_STATUSES.has(action.status)) {
      await ctx.db.patch(action._id, { status: "completed", completedAt: now, updatedAt: now });
    }
  }
}

/** ISO date `days` from today. */
export function isoDateFromNow(days: number) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}
