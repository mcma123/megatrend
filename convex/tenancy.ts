import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { appendAuditEvent } from "./lib/audit";
import { requireActiveMembership, requireCurrentUser, requireIdentity } from "./lib/auth";
import { principalType, roleKey } from "./validators";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const user = await requireCurrentUser(ctx);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .take(25);

    return {
      identity: {
        tokenIdentifier: identity.tokenIdentifier,
        email: identity.email ?? null,
        name: identity.name ?? null,
      },
      user,
      memberships,
    };
  },
});

export const listTenantMemberships = query({
  args: {
    tenantId: v.id("tenants"),
  },
  handler: async (ctx, args) => {
    await requireActiveMembership(ctx, args.tenantId);
    return await ctx.db
      .query("memberships")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .take(100);
  },
});

export const provisionTenant = mutation({
  args: {
    slug: v.string(),
    displayName: v.string(),
    primaryRegion: v.string(),
    organizationName: v.string(),
    organizationSlug: v.string(),
    primaryContactName: v.string(),
    primaryContactEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireCurrentUser(ctx);
    const now = Date.now();

    const tenantId = await ctx.db.insert("tenants", {
      slug: args.slug,
      displayName: args.displayName,
      status: "active",
      primaryRegion: args.primaryRegion,
      createdAt: now,
      createdBy: actor._id,
    });

    const settingsId = await ctx.db.insert("tenantSettings", {
      tenantId,
      renewalHorizonDays: 180,
      publishConfidenceThreshold: 90,
      retentionPolicyKey: "default-7y",
      defaultDocumentRegion: args.primaryRegion,
      updatedAt: now,
      updatedBy: actor._id,
    });

    await ctx.db.patch(tenantId, { settingsId });

    const organizationId = await ctx.db.insert("organizations", {
      tenantId,
      name: args.organizationName,
      slug: args.organizationSlug,
      status: "active",
      primaryContactName: args.primaryContactName,
      primaryContactEmail: args.primaryContactEmail,
      createdAt: now,
      createdBy: actor._id,
    });

    await ctx.db.insert("memberships", {
      tenantId,
      organizationId,
      userId: actor._id,
      principalType: "staff",
      roleKey: "platform_admin",
      status: "active",
      createdAt: now,
      createdBy: actor._id,
    });

    await appendAuditEvent(ctx, {
      tenantId,
      eventType: "tenant.created",
      actorType: "staff_user",
      actorId: actor._id,
      targetType: "tenant",
      targetId: tenantId,
      correlationId: `tenant:${tenantId}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadAfter: JSON.stringify({
        slug: args.slug,
        displayName: args.displayName,
        organizationId,
      }),
    });

    return { tenantId, organizationId, settingsId };
  },
});

export const addMembership = mutation({
  args: {
    tenantId: v.id("tenants"),
    organizationId: v.optional(v.id("organizations")),
    userId: v.id("users"),
    principalType,
    roleKey,
  },
  handler: async (ctx, args) => {
    const actor = await requireCurrentUser(ctx);
    const actorMembership = await requireActiveMembership(ctx, args.tenantId);
    if (![
      "platform_admin",
      "tenant_admin",
    ].includes(actorMembership.roleKey)) {
      throw new Error("Insufficient permissions");
    }

    const now = Date.now();
    const membershipId = await ctx.db.insert("memberships", {
      ...args,
      status: "active",
      createdAt: now,
      createdBy: actor._id,
    });

    await appendAuditEvent(ctx, {
      tenantId: args.tenantId,
      eventType: "organization.membership_added",
      actorType: "staff_user",
      actorId: actor._id,
      targetType: "membership",
      targetId: membershipId,
      correlationId: `membership:${membershipId}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadAfter: JSON.stringify(args),
    });

    return { membershipId };
  },
});
