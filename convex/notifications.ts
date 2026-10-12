import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireCurrentUser } from "./lib/auth";

/** The signed-in user's latest notifications (unread first is up to the UI). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const items = await ctx.db
      .query("notifications")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(30);
    return {
      items,
      unread: items.filter((item) => !item.readAt).length,
    };
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.userId !== user._id) {
      throw new ConvexError("Notification not found");
    }
    if (!notification.readAt) {
      await ctx.db.patch(notification._id, { readAt: Date.now() });
    }
    return null;
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const items = await ctx.db
      .query("notifications")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(100);
    const now = Date.now();
    for (const item of items) {
      if (!item.readAt) await ctx.db.patch(item._id, { readAt: now });
    }
    return null;
  },
});
