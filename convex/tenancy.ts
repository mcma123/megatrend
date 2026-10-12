import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { appendAuditEvent } from "./lib/audit";
import {
  actorTypeFor,
  findActiveMembership,
  requireActiveMembership,
  requireCurrentUser,
  requireIdentity,
  requirePlatformAdmin,
  requireTenantAdministrator,
} from "./lib/auth";
import { provisionClientTenant } from "./lib/provisioning";
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
    const actor = await requirePlatformAdmin(ctx);
    const { tenantId, organizationId, settingsId } = await provisionClientTenant(ctx, actor, {
      slug: args.slug,
      displayName: args.displayName,
      primaryRegion: args.primaryRegion,
      primaryContactName: args.primaryContactName,
      primaryContactEmail: args.primaryContactEmail,
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
    const access = await requireTenantAdministrator(ctx, args.tenantId);

    // One active membership per user and tenant; duplicates break access checks.
    const existing = await findActiveMembership(ctx, args.tenantId, args.userId);
    if (existing) {
      throw new ConvexError("This user already has an active membership in this workspace");
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
      actorType: actorTypeFor(access),
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
