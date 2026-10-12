import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { appendAuditEvent } from "./lib/audit";
import {
  getTenantAccess,
  listStaffTenants,
  requirePlatformAdmin,
  requireStaff,
  requireTenantWriter,
} from "./lib/auth";
import { isLiveLease, optionalText, requireText } from "./lib/portfolio";
import { createClientInvitation, provisionClientTenant } from "./lib/provisioning";
import { clientRelationshipStatus, clientType } from "./validators";

const profileArgs = {
  industry: v.optional(v.string()),
  clientType: v.optional(clientType),
  relationshipStatus: v.optional(clientRelationshipStatus),
  accountManagerName: v.optional(v.string()),
  clientSince: v.optional(v.string()),
};

/** Staff client list with portfolio totals and portal access counts. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const staff = await requireStaff(ctx);
    const tenants = await listStaffTenants(ctx, staff);

    const rows = [];
    for (const tenant of tenants) {
      const organizations = await ctx.db
        .query("organizations")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .take(1);
      const organization = organizations[0] ?? null;

      const leases = await ctx.db
        .query("leases")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .take(500);
      const liveLeases = leases.filter(isLiveLease);

      const properties = await ctx.db
        .query("properties")
        .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
        .take(500);

      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", tenant._id).eq("status", "active"))
        .take(200);
      const invitations = await ctx.db
        .query("membershipInvitations")
        .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", tenant._id).eq("status", "pending"))
        .take(100);

      rows.push({
        tenantId: tenant._id,
        slug: tenant.slug,
        name: organization?.name ?? tenant.displayName,
        tenantStatus: tenant.status,
        industry: organization?.industry ?? null,
        clientType: organization?.clientType ?? null,
        relationshipStatus: organization?.relationshipStatus ?? null,
        accountManagerName: organization?.accountManagerName ?? null,
        contactName: organization?.primaryContactName ?? null,
        contactEmail: organization?.primaryContactEmail ?? null,
        clientSince: organization?.clientSince ?? null,
        propertyCount: properties.filter((property) => !property.archivedAt).length,
        leaseCount: liveLeases.length,
        annualRental: liveLeases.reduce((total, lease) => total + lease.monthlyRental * 12, 0),
        clientMemberCount: memberships.filter((membership) => membership.principalType === "client").length,
        pendingInviteCount: invitations.length,
        createdAt: tenant.createdAt,
      });
    }

    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** One client workspace, for staff or for that client's own users. */
export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug.trim().toLowerCase()))
      .unique();
    if (!tenant) {
      return null;
    }
    const access = await getTenantAccess(ctx, tenant._id);
    if (!access) {
      return null;
    }
    const organizations = await ctx.db
      .query("organizations")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
      .take(1);
    const organization = organizations[0] ?? null;
    const settings = tenant.settingsId ? await ctx.db.get(tenant.settingsId) : null;

    return {
      tenantId: tenant._id,
      organizationId: organization?._id ?? null,
      slug: tenant.slug,
      name: organization?.name ?? tenant.displayName,
      tenantStatus: tenant.status,
      industry: organization?.industry ?? null,
      clientType: organization?.clientType ?? null,
      relationshipStatus: organization?.relationshipStatus ?? null,
      accountManagerName: organization?.accountManagerName ?? null,
      contactName: organization?.primaryContactName ?? null,
      contactEmail: organization?.primaryContactEmail ?? null,
      clientSince: organization?.clientSince ?? null,
      renewalHorizonDays: settings?.renewalHorizonDays ?? 180,
      canEdit: access.principalType === "staff" && access.roleKey !== "read_only_staff",
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    primaryContactName: v.string(),
    primaryContactEmail: v.string(),
    primaryRegion: v.optional(v.string()),
    inviteContactAsAdmin: v.boolean(),
    ...profileArgs,
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    const { tenantId, organizationId, slug } = await provisionClientTenant(ctx, actor, {
      slug: args.slug,
      displayName: args.name,
      primaryRegion: args.primaryRegion ?? "za",
      primaryContactName: requireText(args.primaryContactName, "Primary contact name"),
      primaryContactEmail: args.primaryContactEmail,
      profile: {
        industry: optionalText(args.industry),
        clientType: args.clientType,
        relationshipStatus: args.relationshipStatus ?? "active",
        accountManagerName: optionalText(args.accountManagerName),
        clientSince: optionalText(args.clientSince),
      },
    });

    let invitedEmail: string | null = null;
    if (args.inviteContactAsAdmin) {
      const invitation = await createClientInvitation(ctx, {
        tenantId,
        organizationId,
        email: args.primaryContactEmail,
        fullName: args.primaryContactName,
        roleKey: "client_admin",
        invitedBy: actor._id,
        actorType: "staff_user",
      });
      invitedEmail = invitation.email;
    }

    return { tenantId, slug, invitedEmail };
  },
});

export const update = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.string(),
    primaryContactName: v.string(),
    primaryContactEmail: v.string(),
    ...profileArgs,
  },
  handler: async (ctx, args) => {
    const access = await requireTenantWriter(ctx, args.tenantId);
    const organizations = await ctx.db
      .query("organizations")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .take(1);
    const organization = organizations[0];
    if (!organization) {
      throw new ConvexError("Client organization not found");
    }

    const name = requireText(args.name, "Client name");
    const email = args.primaryContactEmail.trim().toLowerCase();
    if (!email) {
      throw new ConvexError("Primary contact email is required");
    }
    const now = Date.now();
    const next = {
      name,
      primaryContactName: requireText(args.primaryContactName, "Primary contact name"),
      primaryContactEmail: email,
      industry: optionalText(args.industry),
      clientType: args.clientType,
      relationshipStatus: args.relationshipStatus,
      accountManagerName: optionalText(args.accountManagerName),
      clientSince: optionalText(args.clientSince),
      updatedAt: now,
    };
    await ctx.db.patch(organization._id, next);
    await ctx.db.patch(args.tenantId, { displayName: name });

    await appendAuditEvent(ctx, {
      tenantId: args.tenantId,
      eventType: "client.updated",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "organization",
      targetId: organization._id,
      correlationId: `organization:${organization._id}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadBefore: JSON.stringify({ name: organization.name }),
      payloadAfter: JSON.stringify(next),
    });

    return { organizationId: organization._id };
  },
});
