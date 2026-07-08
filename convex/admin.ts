import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { appendAuditEvent } from "./lib/audit";
import { requireCurrentUser, requireTenantAdministrator } from "./lib/auth";
import { exportType, roleScope } from "./validators";

const defaultRoles = [
  {
    key: "platform_admin",
    scope: "staff",
    label: "Platform Admin",
    description: "Global administration, tenancy setup, and policy control.",
  },
  {
    key: "tenant_admin",
    scope: "staff",
    label: "Tenant Admin",
    description: "Tenant-scoped governance, memberships, and settings.",
  },
  {
    key: "account_manager",
    scope: "staff",
    label: "Account Manager",
    description: "Portfolio review, publication, and client relationship work.",
  },
  {
    key: "operations_analyst",
    scope: "staff",
    label: "Operations Analyst",
    description: "Document triage, extraction review, and workflow operations.",
  },
  {
    key: "finance_reviewer",
    scope: "staff",
    label: "Finance Reviewer",
    description: "Invoice, utility, and financial anomaly review.",
  },
  {
    key: "read_only_staff",
    scope: "staff",
    label: "Read Only Staff",
    description: "Inspection access without mutation rights.",
  },
  {
    key: "client_admin",
    scope: "client",
    label: "Client Admin",
    description: "Team membership, portal access, and client governance.",
  },
  {
    key: "property_manager",
    scope: "client",
    label: "Property Manager",
    description: "Property operations, renewals, and action handling.",
  },
  {
    key: "finance_user",
    scope: "client",
    label: "Finance User",
    description: "Invoice, utility, and payment review access.",
  },
  {
    key: "legal_reviewer",
    scope: "client",
    label: "Legal Reviewer",
    description: "Lease and obligations review access.",
  },
  {
    key: "executive_viewer",
    scope: "client",
    label: "Executive Viewer",
    description: "Read-only executive portfolio and insight access.",
  },
] as const;

export const seedRoleCatalog = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    let inserted = 0;

    for (const role of defaultRoles) {
      const existing = await ctx.db
        .query("roles")
        .withIndex("by_key", (q) => q.eq("key", role.key))
        .unique();

      if (existing) {
        continue;
      }

      await ctx.db.insert("roles", {
        ...role,
        isSystem: true,
      });
      inserted += 1;
    }

    return {
      inserted,
      total: defaultRoles.length,
    };
  },
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
