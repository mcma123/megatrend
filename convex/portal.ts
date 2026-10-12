import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { appendAuditEvent } from "./lib/audit";
import {
  actorTypeFor,
  getTenantAccess,
  requireCurrentUser,
  requireTeamManager,
} from "./lib/auth";
import { createClientInvitation } from "./lib/provisioning";
import { QueryCtx } from "./_generated/server";
import { clientRoleKey } from "./validators";

const TEAM_MANAGER_ROLE_KEYS = new Set(["platform_admin", "tenant_admin", "client_admin"]);

async function getTenantBySlug(ctx: QueryCtx, slug: string) {
  return await ctx.db
    .query("tenants")
    .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
    .unique();
}

async function getPrimaryOrganization(ctx: QueryCtx, tenant: Doc<"tenants">) {
  const organizations = await ctx.db
    .query("organizations")
    .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
    .take(1);
  return organizations[0] ?? null;
}

/**
 * Resolves a portal slug to its client workspace and checks the viewer's access.
 * Returns a status instead of throwing so the portal can render a friendly state.
 */
export const getPortalContext = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const tenant = await getTenantBySlug(ctx, args.slug);
    if (!tenant) {
      return { status: "not_found" as const };
    }
    const access = await getTenantAccess(ctx, tenant._id);
    if (!access) {
      return { status: "forbidden" as const };
    }
    const organization = await getPrimaryOrganization(ctx, tenant);
    return {
      status: "ok" as const,
      client: {
        tenantId: tenant._id,
        organizationId: organization?._id ?? null,
        slug: tenant.slug,
        name: organization?.name ?? tenant.displayName,
        contactName: organization?.primaryContactName ?? null,
        contactEmail: organization?.primaryContactEmail ?? null,
        accountManagerName: organization?.accountManagerName ?? null,
      },
      viewer: {
        principalType: access.principalType,
        roleKey: access.roleKey,
        isPlatformAdmin: access.isPlatformAdmin,
        canManageTeam: TEAM_MANAGER_ROLE_KEYS.has(access.roleKey),
      },
    };
  },
});

export const getPortalTeamWorkspace = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const tenant = await getTenantBySlug(ctx, args.slug);
    if (!tenant) {
      return null;
    }

    const access = await getTenantAccess(ctx, tenant._id);
    if (!access || !TEAM_MANAGER_ROLE_KEYS.has(access.roleKey)) {
      return {
        tenantId: tenant._id,
        tenantSlug: tenant.slug,
        organizationId: null,
        currentUserId: access?.user._id ?? null,
        currentRoleKey: access?.roleKey ?? null,
        canManageTeam: false,
        members: [],
        invitations: [],
      };
    }

    const organization = await getPrimaryOrganization(ctx, tenant);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
      .take(100);

    const members = [] as Array<{
      membershipId: string;
      userId: string;
      fullName: string | null;
      email: string | null;
      roleKey: string;
      principalType: string;
      status: string;
      createdAt: number;
    }>;

    for (const membership of memberships) {
      if (membership.status !== "active") {
        continue;
      }
      const user = await ctx.db.get(membership.userId);
      members.push({
        membershipId: membership._id,
        userId: membership.userId,
        fullName: user?.name ?? null,
        email: user?.email ?? null,
        roleKey: membership.roleKey,
        principalType: membership.principalType,
        status: membership.status,
        createdAt: membership.createdAt,
      });
    }

    const invitations = await ctx.db
      .query("membershipInvitations")
      .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", tenant._id).eq("status", "pending"))
      .take(100);

    return {
      tenantId: tenant._id,
      tenantSlug: tenant.slug,
      organizationId: organization?._id ?? null,
      currentUserId: access.user._id,
      currentRoleKey: access.roleKey,
      canManageTeam: true,
      members,
      invitations: invitations.map((invitation) => ({
        invitationId: invitation._id,
        email: invitation.email,
        fullName: invitation.fullName ?? null,
        roleKey: invitation.roleKey,
        status: invitation.status,
        providerHint: invitation.providerHint ?? null,
        createdAt: invitation.createdAt,
        expiresAt: invitation.expiresAt ?? null,
      })),
    };
  },
});

export const invitePortalMember = mutation({
  args: {
    slug: v.string(),
    email: v.string(),
    fullName: v.optional(v.string()),
    roleKey: clientRoleKey,
  },
  handler: async (ctx, args) => {
    const actor = await requireCurrentUser(ctx);
    const tenant = await getTenantBySlug(ctx, args.slug);
    if (!tenant) {
      throw new ConvexError("Client workspace not found");
    }

    const access = await requireTeamManager(ctx, tenant._id);
    const organization = await getPrimaryOrganization(ctx, tenant);
    if (!organization) {
      throw new ConvexError("Organization is not provisioned for this client");
    }

    const { invitationId, email } = await createClientInvitation(ctx, {
      tenantId: tenant._id,
      organizationId: organization._id,
      email: args.email,
      fullName: args.fullName,
      roleKey: args.roleKey,
      invitedBy: actor._id,
      actorType: actorTypeFor(access),
    });

    return {
      invitationId,
      inviteTarget: email,
      providerHint: "password",
    };
  },
});

export const revokePortalMember = mutation({
  args: {
    membershipId: v.id("memberships"),
  },
  handler: async (ctx, args) => {
    const actor = await requireCurrentUser(ctx);
    const membership = await ctx.db.get(args.membershipId);

    if (!membership) {
      throw new ConvexError("Membership not found");
    }
    if (membership.userId === actor._id) {
      throw new ConvexError("You cannot remove your own access");
    }

    const access = await requireTeamManager(ctx, membership.tenantId);
    // Client admins manage client users only; staff access is managed by Cyphersoft.
    if (access.principalType === "client" && membership.principalType !== "client") {
      throw new ConvexError("Only Cyphersoft staff can remove staff access");
    }

    const now = Date.now();
    await ctx.db.patch(args.membershipId, {
      status: "revoked",
      revokedAt: now,
      revokedBy: actor._id,
    });

    await appendAuditEvent(ctx, {
      tenantId: membership.tenantId,
      eventType: "organization.membership_removed",
      actorType: actorTypeFor(access),
      actorId: actor._id,
      targetType: "membership",
      targetId: args.membershipId,
      correlationId: `membership:${args.membershipId}`,
      sourceSystem: "portal",
      occurredAt: now,
      payloadBefore: JSON.stringify({
        userId: membership.userId,
        roleKey: membership.roleKey,
        status: membership.status,
      }),
      payloadAfter: JSON.stringify({
        status: "revoked",
      }),
    });

    return { membershipId: args.membershipId };
  },
});
