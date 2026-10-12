import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { appendAuditEvent } from "./lib/audit";
import { requireCurrentUser, requirePlatformAdmin, requireTenantAdministrator } from "./lib/auth";
import { seedRoles } from "./lib/provisioning";
import { exportType, roleScope } from "./validators";

export const seedRoleCatalog = mutation({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    return await seedRoles(ctx);
  },
});

// CLI/bootstrap entry point: `npx convex run admin:seedRoleCatalogInternal`.
export const seedRoleCatalogInternal = internalMutation({
  args: {},
  handler: async (ctx) => await seedRoles(ctx),
});

export const listRoles = query({
  args: {
    scope: v.optional(roleScope),
  },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);

    if (args.scope) {
      return await ctx.db
        .query("roles")
        .withIndex("by_scope", (q) => q.eq("scope", args.scope!))
        .take(25);
    }

    return await ctx.db.query("roles").take(25);
  },
});

export const requestExportJob = mutation({
  args: {
    tenantId: v.id("tenants"),
    exportType,
  },
  handler: async (ctx, args) => {
    const actor = await requireCurrentUser(ctx);
    await requireTenantAdministrator(ctx, args.tenantId);
    const now = Date.now();

    const exportJobId = await ctx.db.insert("exportJobs", {
      tenantId: args.tenantId,
      requestedBy: actor._id,
      exportType: args.exportType,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    await appendAuditEvent(ctx, {
      tenantId: args.tenantId,
      eventType: "export.requested",
      actorType: "staff_user",
      actorId: actor._id,
      targetType: "export_job",
      targetId: exportJobId,
      correlationId: `export:${exportJobId}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadAfter: JSON.stringify(args),
    });

    return { exportJobId };
  },
});

export const listExportJobs = query({
  args: {
    tenantId: v.id("tenants"),
  },
  handler: async (ctx, args) => {
    await requireTenantAdministrator(ctx, args.tenantId);
    return await ctx.db
      .query("exportJobs")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(50);
  },
});
