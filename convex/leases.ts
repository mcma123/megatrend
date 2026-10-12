import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx } from "./_generated/server";
import { appendAuditEvent } from "./lib/audit";
import {
  getTenantAccess,
  listStaffTenants,
  requireStaff,
  requireTenantAccess,
  requireTenantWriter,
} from "./lib/auth";
import {
  assertIsoDate,
  assertNonNegative,
  getClientLabel,
  optionalText,
  requireText,
} from "./lib/portfolio";
import { leaseStatus } from "./validators";

const leaseFields = {
  startDate: v.string(),
  endDate: v.string(),
  monthlyRental: v.number(),
  escalationPercent: v.optional(v.number()),
  noticePeriodMonths: v.optional(v.number()),
  breakClause: v.optional(v.string()),
  renewalOption: v.optional(v.string()),
  accountManagerName: v.optional(v.string()),
  status: leaseStatus,
};

type LeaseInput = {
  startDate: string;
  endDate: string;
  monthlyRental: number;
  escalationPercent?: number;
  noticePeriodMonths?: number;
  breakClause?: string;
  renewalOption?: string;
  accountManagerName?: string;
  status: Doc<"leases">["status"];
};

function cleanLeaseInput(input: LeaseInput) {
  assertIsoDate(input.startDate, "Start date");
  assertIsoDate(input.endDate, "End date");
  if (input.endDate <= input.startDate) {
    throw new ConvexError("End date must be after the start date");
  }
  assertNonNegative(input.monthlyRental, "Monthly rental");
  assertNonNegative(input.escalationPercent, "Escalation");
  assertNonNegative(input.noticePeriodMonths, "Notice period");
  return {
    startDate: input.startDate,
    endDate: input.endDate,
    monthlyRental: input.monthlyRental,
    escalationPercent: input.escalationPercent,
    noticePeriodMonths: input.noticePeriodMonths,
    breakClause: optionalText(input.breakClause),
    renewalOption: optionalText(input.renewalOption),
    accountManagerName: optionalText(input.accountManagerName),
    status: input.status,
  };
}

async function toLeaseRow(ctx: QueryCtx, lease: Doc<"leases">) {
  const property = await ctx.db.get(lease.propertyId);
  const client = await getClientLabel(ctx, lease.tenantId);
  return {
    ...lease,
    client,
    property: property
      ? { propertyId: property._id, name: property.name, city: property.city, sizeSqm: property.sizeSqm ?? null }
      : null,
  };
}

/** Leases for one client (staff or that client's users) or, for staff, all clients. */
export const list = query({
  args: { tenantId: v.optional(v.id("tenants")) },
  handler: async (ctx, args) => {
    let tenantIds: Id<"tenants">[];
    if (args.tenantId) {
      await requireTenantAccess(ctx, args.tenantId);
      tenantIds = [args.tenantId];
    } else {
      const staff = await requireStaff(ctx);
      tenantIds = (await listStaffTenants(ctx, staff)).map((tenant) => tenant._id);
    }

    const rows = [];
    for (const tenantId of tenantIds) {
      const leases = await ctx.db
        .query("leases")
        .withIndex("by_tenantId_and_endDate", (q) => q.eq("tenantId", tenantId))
        .take(500);
      for (const lease of leases) {
        if (!lease.archivedAt) {
          rows.push(await toLeaseRow(ctx, lease));
        }
      }
    }
    return rows.sort((a, b) => a.endDate.localeCompare(b.endDate));
  },
});

export const get = query({
  args: { leaseId: v.id("leases") },
  handler: async (ctx, args) => {
    const lease = await ctx.db.get(args.leaseId);
    if (!lease || lease.archivedAt) {
      return null;
    }
    const access = await getTenantAccess(ctx, lease.tenantId);
    if (!access) {
      return null;
    }
    const clauses = await ctx.db
      .query("leaseClauses")
      .withIndex("by_leaseId", (q) => q.eq("leaseId", lease._id))
      .take(100);
    const tenant = await ctx.db.get(lease.tenantId);
    const settings = tenant?.settingsId ? await ctx.db.get(tenant.settingsId) : null;
    return {
      ...(await toLeaseRow(ctx, lease)),
      clauses,
      renewalHorizonDays: settings?.renewalHorizonDays ?? 180,
      canEdit: access.principalType === "staff" && access.roleKey !== "read_only_staff",
    };
  },
});

export const create = mutation({
  args: { propertyId: v.id("properties"), ...leaseFields },
  handler: async (ctx, args) => {
    const { propertyId, ...input } = args;
    const property = await ctx.db.get(propertyId);
    if (!property || property.archivedAt) {
      throw new ConvexError("Property not found");
    }
    const access = await requireTenantWriter(ctx, property.tenantId);
    const fields = cleanLeaseInput(input);
    const now = Date.now();
    const leaseId = await ctx.db.insert("leases", {
      tenantId: property.tenantId,
      propertyId,
      ...fields,
      createdAt: now,
      createdBy: access.user._id,
      updatedAt: now,
      updatedBy: access.user._id,
    });

    await appendAuditEvent(ctx, {
      tenantId: property.tenantId,
      eventType: "lease.created",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "lease",
      targetId: leaseId,
      correlationId: `lease:${leaseId}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadAfter: JSON.stringify({ propertyId, ...fields }),
    });
    return { leaseId };
  },
});

export const update = mutation({
  args: { leaseId: v.id("leases"), ...leaseFields },
  handler: async (ctx, args) => {
    const { leaseId, ...input } = args;
    const lease = await ctx.db.get(leaseId);
    if (!lease || lease.archivedAt) {
      throw new ConvexError("Lease not found");
    }
    const access = await requireTenantWriter(ctx, lease.tenantId);
    const fields = cleanLeaseInput(input);
    const now = Date.now();
    await ctx.db.patch(leaseId, { ...fields, updatedAt: now, updatedBy: access.user._id });

    await appendAuditEvent(ctx, {
      tenantId: lease.tenantId,
      eventType: "lease.updated",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "lease",
      targetId: leaseId,
      correlationId: `lease:${leaseId}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadBefore: JSON.stringify({
        endDate: lease.endDate,
        monthlyRental: lease.monthlyRental,
        status: lease.status,
      }),
      payloadAfter: JSON.stringify(fields),
    });
    return { leaseId };
  },
});

export const archive = mutation({
  args: { leaseId: v.id("leases") },
  handler: async (ctx, args) => {
    const lease = await ctx.db.get(args.leaseId);
    if (!lease || lease.archivedAt) {
      throw new ConvexError("Lease not found");
    }
    const access = await requireTenantWriter(ctx, lease.tenantId);
    const now = Date.now();
    await ctx.db.patch(args.leaseId, { archivedAt: now, updatedAt: now, updatedBy: access.user._id });

    await appendAuditEvent(ctx, {
      tenantId: lease.tenantId,
      eventType: "lease.archived",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "lease",
      targetId: args.leaseId,
      correlationId: `lease:${args.leaseId}`,
      sourceSystem: "convex",
      occurredAt: now,
    });
    return { leaseId: args.leaseId };
  },
});

export const addClause = mutation({
  args: { leaseId: v.id("leases"), title: v.string(), detail: v.string() },
  handler: async (ctx, args) => {
    const lease = await ctx.db.get(args.leaseId);
    if (!lease || lease.archivedAt) {
      throw new ConvexError("Lease not found");
    }
    const access = await requireTenantWriter(ctx, lease.tenantId);
    const now = Date.now();
    const clauseId = await ctx.db.insert("leaseClauses", {
      tenantId: lease.tenantId,
      leaseId: args.leaseId,
      title: requireText(args.title, "Clause title"),
      detail: requireText(args.detail, "Clause detail"),
      createdAt: now,
      createdBy: access.user._id,
    });

    await appendAuditEvent(ctx, {
      tenantId: lease.tenantId,
      eventType: "lease_clause.added",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "lease_clause",
      targetId: clauseId,
      correlationId: `lease:${args.leaseId}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadAfter: JSON.stringify({ title: args.title }),
    });
    return { clauseId };
  },
});

export const removeClause = mutation({
  args: { clauseId: v.id("leaseClauses") },
  handler: async (ctx, args) => {
    const clause = await ctx.db.get(args.clauseId);
    if (!clause) {
      throw new ConvexError("Clause not found");
    }
    const access = await requireTenantWriter(ctx, clause.tenantId);
    const now = Date.now();
    await ctx.db.delete(args.clauseId);

    await appendAuditEvent(ctx, {
      tenantId: clause.tenantId,
      eventType: "lease_clause.removed",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "lease_clause",
      targetId: args.clauseId,
      correlationId: `lease:${clause.leaseId}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadBefore: JSON.stringify({ title: clause.title, detail: clause.detail }),
    });
    return { clauseId: args.clauseId };
  },
});
