import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";

const DEFAULT_PER_MINUTE = 10;
const DEFAULT_DAILY_CAP = 200;

function limitFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Reserve one voice request (transcription or assistant turn) for the caller.
 * Called by the portal server before it contacts OpenRouter or Mastra; throws
 * a user-facing ConvexError when the per-minute or daily limit is reached.
 */
export const consume = mutation({
  args: { kind: v.union(v.literal("transcribe"), v.literal("assistant")) },
  returns: v.object({ remainingToday: v.number() }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in to use voice input.");

    const perMinute = limitFromEnv(process.env.VOICE_RATE_LIMIT_PER_MINUTE, DEFAULT_PER_MINUTE);
    const dailyCap = limitFromEnv(process.env.VOICE_DAILY_CAP, DEFAULT_DAILY_CAP);
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const minuteBucket = Math.floor(now / 60_000);

    const row = await ctx.db
      .query("voiceUsage")
      .withIndex("by_userId_and_day", (q) => q.eq("userId", userId).eq("day", day))
      .unique();

    if (!row) {
      await ctx.db.insert("voiceUsage", {
        userId,
        day,
        dayCount: 1,
        minuteBucket,
        minuteCount: 1,
        updatedAt: now,
      });
      return { remainingToday: dailyCap - 1 };
    }

    if (row.dayCount >= dailyCap) {
      throw new ConvexError("Daily voice limit reached. Try again tomorrow.");
    }
    const minuteCount = row.minuteBucket === minuteBucket ? row.minuteCount : 0;
    if (minuteCount >= perMinute) {
      throw new ConvexError("Too many voice requests. Wait a moment and try again.");
    }
    await ctx.db.patch(row._id, {
      dayCount: row.dayCount + 1,
      minuteBucket,
      minuteCount: minuteCount + 1,
      updatedAt: now,
    });
    return { remainingToday: dailyCap - row.dayCount - 1 };
  },
});
