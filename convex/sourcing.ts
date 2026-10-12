import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import {
  requireTenantAccess,
  requireTenantWriter,
  isReadOnlyRole,
} from "./lib/auth";
import { appendAuditEvent } from "./lib/audit";
import {
  normalizeCandidates,
  sourcingInputSchema,
  sourcingResultSchema,
} from "./lib/sourcing";

const briefArgs = { briefId: v.id("sourcingBriefs") };

export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    requestId: v.string(),
    propertyType: v.string(),
    location: v.string(),
    sizeSqm: v.number(),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireTenantWriter(ctx, args.tenantId);
    if (isReadOnlyRole(access.roleKey))
      throw new ConvexError(
        "Your role can view searches but cannot create them.",
      );
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant || tenant.status !== "active")
      throw new ConvexError("Choose an active client.");
    const parsed = sourcingInputSchema.safeParse(args);
    if (!parsed.success)
      throw new ConvexError(
        "Choose a property type, location and size between 500 and 25,000 sqm. Notes must be under 2,000 characters.",
      );
    if (!/^[\w-]{8,100}$/.test(args.requestId))
      throw new ConvexError("Invalid search request.");
    const existing = await ctx.db
      .query("sourcingBriefs")
      .withIndex("by_tenantId_and_requestId", (q) =>
        q.eq("tenantId", args.tenantId).eq("requestId", args.requestId),
      )
      .unique();
    if (existing) {
      if (
        existing.createdBy !== access.user._id ||
        Object.entries(parsed.data).some(
          ([key, value]) => existing[key as keyof typeof parsed.data] !== value,
        )
      ) {
        throw new ConvexError("This request already belongs to another brief.");
      }
      return existing._id;
    }
    const createdAt = Date.now();
    const briefId = await ctx.db.insert("sourcingBriefs", {
      ...parsed.data,
      tenantId: args.tenantId,
      requestId: args.requestId,
      createdBy: access.user._id,
      status: "queued",
      createdAt,
      warnings: [],
    });
    await ctx.scheduler.runAfter(0, internal.sourcing.runResearch, { briefId });
    // A worker crash must not leave a saved search permanently running.
    await ctx.scheduler.runAfter(6 * 60_000, internal.sourcing.expire, {
      briefId,
    });
    await appendAuditEvent(ctx, {
      tenantId: args.tenantId,
      eventType: "sourcing.created",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "sourcingBrief",
      targetId: briefId,
      correlationId: `sourcing:${briefId}`,
      sourceSystem: "convex",
      occurredAt: createdAt,
    });
    return briefId;
  },
});

export const list = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const access = await requireTenantAccess(ctx, args.tenantId);
    if (access.principalType !== "staff")
      throw new ConvexError("Cyphersoft staff access required");
    const briefs = await ctx.db
      .query("sourcingBriefs")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(20);
    return { briefs, canCreate: !isReadOnlyRole(access.roleKey) };
  },
});

export const get = query({
  args: briefArgs,
  handler: async (ctx, { briefId }) => {
    const brief = await ctx.db.get(briefId);
    if (!brief) return null;
    const access = await requireTenantAccess(ctx, brief.tenantId);
    if (access.principalType !== "staff")
      throw new ConvexError("Cyphersoft staff access required");
    const candidates = await ctx.db
      .query("propertyCandidates")
      .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
      .take(6);
    return {
      ...brief,
      candidates: candidates.sort((a, b) => b.matchScore - a.matchScore),
    };
  },
});

export const claim = internalMutation({
  args: briefArgs,
  handler: async (ctx, { briefId }) => {
    const brief = await ctx.db.get(briefId);
    if (!brief || brief.status !== "queued") return null;
    await ctx.db.patch(briefId, { status: "running", startedAt: Date.now() });
    return brief;
  },
});

export const finish = internalMutation({
  args: { ...briefArgs, result: v.any() },
  handler: async (ctx, { briefId, result }) => {
    const brief = await ctx.db.get(briefId);
    if (!brief || brief.status !== "running") return;
    const parsed = sourcingResultSchema.safeParse(result);
    if (!parsed.success) throw new Error("Invalid sourcing result contract");
    const candidates = normalizeCandidates(
      brief.propertyType,
      parsed.data.candidates,
    );
    for (const candidate of candidates) {
      await ctx.db.insert("propertyCandidates", {
        ...candidate,
        tenantId: brief.tenantId,
        briefId,
      });
    }
    await ctx.db.patch(briefId, {
      status: "completed",
      completedAt: Date.now(),
      warnings: parsed.data.warnings,
    });
    await appendAuditEvent(ctx, {
      tenantId: brief.tenantId,
      eventType: "sourcing.completed",
      actorType: "system",
      targetType: "sourcingBrief",
      targetId: briefId,
      correlationId: `sourcing:${briefId}`,
      sourceSystem: "mastra",
      occurredAt: Date.now(),
      payloadAfter: JSON.stringify({ candidateCount: candidates.length }),
    });
  },
});

export const fail = internalMutation({
  args: { ...briefArgs, error: v.string() },
  handler: async (ctx, { briefId, error }) => {
    const brief = await ctx.db.get(briefId);
    if (!brief || !["queued", "running"].includes(brief.status)) return;
    await ctx.db.patch(briefId, {
      status: "failed",
      completedAt: Date.now(),
      error: error.slice(0, 500),
    });
  },
});

export const expire = internalMutation({
  args: briefArgs,
  handler: async (ctx, { briefId }) => {
    const brief = await ctx.db.get(briefId);
    if (!brief || !["queued", "running"].includes(brief.status)) return;
    await ctx.db.patch(briefId, {
      status: "failed",
      completedAt: Date.now(),
      error: "The search timed out. Generate a new brief to try again.",
    });
  },
});

export const runResearch = internalAction({
  args: briefArgs,
  handler: async (ctx, { briefId }): Promise<void> => {
    const brief: Doc<"sourcingBriefs"> | null = await ctx.runMutation(
      internal.sourcing.claim,
      { briefId },
    );
    if (!brief) return;
    const url = process.env.MASTRA_SOURCING_URL;
    const token = process.env.MASTRA_SOURCING_SERVICE_TOKEN;
    if (!url || !token) {
      await ctx.runMutation(internal.sourcing.fail, {
        briefId,
        error:
          "Property research is not configured. Set MASTRA_SOURCING_URL and MASTRA_SOURCING_SERVICE_TOKEN on the Convex deployment.",
      });
      return;
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(sourcingInputSchema.parse(brief)),
        signal: AbortSignal.timeout(270_000),
      });
      if (!response.ok) {
        const error =
          response.status === 401 || response.status === 503
            ? "The property research service configuration needs attention. Ask an administrator to check its URL and service token."
            : "The property research service could not complete the search. Generate a new brief to try again.";
        await ctx.runMutation(internal.sourcing.fail, { briefId, error });
        return;
      }
      const result = sourcingResultSchema.parse(await response.json());
      await ctx.runMutation(internal.sourcing.finish, { briefId, result });
    } catch {
      await ctx.runMutation(internal.sourcing.fail, {
        briefId,
        error:
          "Property research was unavailable, timed out, or returned an invalid result. Generate a new brief to try again.",
      });
    }
  },
});
