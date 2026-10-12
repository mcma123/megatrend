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
  assertNonNegative,
  getClientLabel,
  getCurrentLeaseForProperty,
  optionalText,
  requireText,
} from "./lib/portfolio";
import { propertyStatus, propertyType } from "./validators";

const propertyFields = {
  name: v.string(),
  addressLine: v.string(),
  suburb: v.optional(v.string()),
  city: v.string(),
  province: v.optional(v.string()),
  propertyType,
  status: propertyStatus,
  sizeSqm: v.optional(v.number()),
  rentalPerSqm: v.optional(v.number()),
  landlord: v.optional(v.string()),
  features: v.array(v.string()),
  notes: v.optional(v.string()),
};

type PropertyInput = {
  name: string;
  addressLine: string;
  suburb?: string;
  city: string;
  province?: string;
  propertyType: Doc<"properties">["propertyType"];
  status: Doc<"properties">["status"];
  sizeSqm?: number;
  rentalPerSqm?: number;
  landlord?: string;
  features: string[];
  notes?: string;
};

function cleanPropertyInput(input: PropertyInput) {
  assertNonNegative(input.sizeSqm, "Size");
  assertNonNegative(input.rentalPerSqm, "Rental per m²");
  return {
    name: requireText(input.name, "Property name"),
    addressLine: requireText(input.addressLine, "Address"),
    suburb: optionalText(input.suburb),
    city: requireText(input.city, "City"),
    province: optionalText(input.province),
    propertyType: input.propertyType,
    status: input.status,
    sizeSqm: input.sizeSqm,
    rentalPerSqm: input.rentalPerSqm,
    landlord: optionalText(input.landlord),
    features: input.features.map((feature) => feature.trim()).filter(Boolean).slice(0, 30),
    notes: optionalText(input.notes),
  };
}

async function toPropertyRow(ctx: QueryCtx, property: Doc<"properties">) {
  const lease = await getCurrentLeaseForProperty(ctx, property._id);
  const client = await getClientLabel(ctx, property.tenantId);
  return {
    ...property,
    client,
    currentLease: lease
      ? {
          leaseId: lease._id,
          monthlyRental: lease.monthlyRental,
          endDate: lease.endDate,
          status: lease.status,
        }
      : null,
  };
}

/** Properties for one client (staff or that client's users) or, for staff, all clients. */
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
      const properties = await ctx.db
        .query("properties")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
        .take(500);
      for (const property of properties) {
        if (!property.archivedAt) {
          rows.push(await toPropertyRow(ctx, property));
        }
      }
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const get = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.archivedAt) {
      return null;
    }
    const access = await getTenantAccess(ctx, property.tenantId);
    if (!access) {
      return null;
    }
    const leases = await ctx.db
      .query("leases")
      .withIndex("by_propertyId", (q) => q.eq("propertyId", property._id))
      .take(50);
    const row = await toPropertyRow(ctx, property);
    return {
      ...row,
      leases: leases
        .filter((lease) => !lease.archivedAt)
        .sort((a, b) => b.endDate.localeCompare(a.endDate)),
      canEdit: access.principalType === "staff" && access.roleKey !== "read_only_staff",
    };
  },
});

export const create = mutation({
  args: { tenantId: v.id("tenants"), ...propertyFields },
  handler: async (ctx, args) => {
    const { tenantId, ...input } = args;
    const access = await requireTenantWriter(ctx, tenantId);
    const fields = cleanPropertyInput(input);
    const now = Date.now();
    const propertyId = await ctx.db.insert("properties", {
      tenantId,
      ...fields,
      createdAt: now,
      createdBy: access.user._id,
      updatedAt: now,
      updatedBy: access.user._id,
    });

    await appendAuditEvent(ctx, {
      tenantId,
      eventType: "property.created",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "property",
      targetId: propertyId,
      correlationId: `property:${propertyId}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadAfter: JSON.stringify(fields),
    });
    return { propertyId };
  },
});

export const update = mutation({
  args: { propertyId: v.id("properties"), ...propertyFields },
  handler: async (ctx, args) => {
    const { propertyId, ...input } = args;
    const property = await ctx.db.get(propertyId);
    if (!property || property.archivedAt) {
      throw new ConvexError("Property not found");
    }
    const access = await requireTenantWriter(ctx, property.tenantId);
    const fields = cleanPropertyInput(input);
    const now = Date.now();
    await ctx.db.patch(propertyId, { ...fields, updatedAt: now, updatedBy: access.user._id });

    await appendAuditEvent(ctx, {
      tenantId: property.tenantId,
      eventType: "property.updated",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "property",
      targetId: propertyId,
      correlationId: `property:${propertyId}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadBefore: JSON.stringify({ name: property.name, status: property.status }),
      payloadAfter: JSON.stringify(fields),
    });
    return { propertyId };
  },
});

export const archive = mutation({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.archivedAt) {
      throw new ConvexError("Property not found");
    }
    const access = await requireTenantWriter(ctx, property.tenantId);
    const now = Date.now();
    await ctx.db.patch(args.propertyId, { archivedAt: now, updatedAt: now, updatedBy: access.user._id });

    await appendAuditEvent(ctx, {
      tenantId: property.tenantId,
      eventType: "property.archived",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "property",
      targetId: args.propertyId,
      correlationId: `property:${args.propertyId}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadBefore: JSON.stringify({ name: property.name }),
    });
    return { propertyId: args.propertyId };
  },
});
