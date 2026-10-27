import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { appendSigningEvent } from "./lib/signingAudit";
export const findKey = internalQuery({
  args: { deliveryKey: v.string(), providerMessageId: v.string() },
  handler: async (ctx, args) => {
    const byKey = await ctx.db
      .query("signingDeliveries")
      .withIndex("by_deliveryKey", (q) => q.eq("deliveryKey", args.deliveryKey))
      .unique();
    const byId = await ctx.db
      .query("signingDeliveries")
      .withIndex("by_providerMessageId", (q) =>
        q.eq("providerMessageId", args.providerMessageId),
      )
      .unique();
    return byKey ?? byId;
  },
});
export const record = internalMutation({
  args: {
    eventId: v.string(),
    bodyHash: v.string(),
    providerMessageId: v.string(),
    deliveryKey: v.string(),
    eventType: v.string(),
    occurredAt: v.number(),
    from: v.string(),
    recipientHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("signingDeliveryEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existing)
      return existing.bodyHash === args.bodyHash &&
        existing.outcome === "matched"
        ? 200
        : 409;
    const byKey = await ctx.db
      .query("signingDeliveries")
      .withIndex("by_deliveryKey", (q) => q.eq("deliveryKey", args.deliveryKey))
      .unique();
    const byId = await ctx.db
      .query("signingDeliveries")
      .withIndex("by_providerMessageId", (q) =>
        q.eq("providerMessageId", args.providerMessageId),
      )
      .unique();
    const row = byKey ?? byId;
    const match =
      row &&
      row.deliveryKey === args.deliveryKey &&
      (!row.providerMessageId ||
        row.providerMessageId === args.providerMessageId) &&
      (!byId || byId._id === row._id) &&
      row.expectedFrom.toLowerCase() === args.from.toLowerCase() &&
      row.recipientHash === args.recipientHash &&
      Number.isFinite(args.occurredAt) &&
      args.occurredAt >= row.createdAt - 60_000 &&
      args.occurredAt <= Date.now() + 5 * 60_000;
    const eventId = await ctx.db.insert("signingDeliveryEvents", {
      eventId: args.eventId,
      bodyHash: args.bodyHash,
      providerMessageId: args.providerMessageId,
      ...(row ? { deliveryId: row._id } : {}),
      eventType: args.eventType,
      occurredAt: Number.isFinite(args.occurredAt) ? args.occurredAt : 0,
      receivedAt: Date.now(),
      outcome: match ? "matched" : "identity_conflict",
    });
    if (!match) return 409;
    const property: Record<string, keyof Doc<"signingDeliveries">> = {
      "email.sent": "sentAt",
      "email.delivered": "deliveredAt",
      "email.bounced": "bouncedAt",
      "email.complained": "complainedAt",
      "email.failed": "failedAt",
      "email.suppressed": "failedAt",
      "email.delivery_delayed": "delayedAt",
    };
    const field = property[args.eventType];
    const failure = [
      "email.bounced",
      "email.failed",
      "email.suppressed",
      "email.complained",
    ].includes(args.eventType);
    await ctx.db.patch(row._id, {
      status: failure || row.status === "failed" ? "failed" : "accepted",
      providerMessageId: args.providerMessageId,
      acceptedAt: row.acceptedAt ?? Date.now(),
      sealed: undefined,
      error: undefined,
      ...(field
        ? {
            [field]: Math.min(
              (row[field] as number | undefined) ?? Infinity,
              args.occurredAt,
            ),
          }
        : {}),
    });
    const agreement = await ctx.db.get(row.agreementId);
    if (agreement)
      await appendSigningEvent(
        ctx,
        agreement,
        undefined,
        "email_delivery_event",
        {
          deliveryEventId: eventId,
          eventType: args.eventType,
          deliveryId: row._id,
          bodyHash: args.bodyHash,
          providerMessageId: args.providerMessageId,
        },
        { actorKind: "provider" },
      );
    return 200;
  },
});
