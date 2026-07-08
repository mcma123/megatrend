import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { appendAuditEvent } from "./lib/audit";
import { requireCurrentUser, requireTeamManager } from "./lib/auth";
import { clientRoleKey } from "./validators";

export const getPortalTeamWorkspace = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!tenant) {
      return null;
    }

    const currentMembership = await requireTeamManager(ctx, tenant._id);
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
      .take(1);

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
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
      .take(100);

    return {
      tenantId: tenant._id,
      tenantSlug: tenant.slug,
      organizationId: organization[0]?._id ?? null,
      currentRoleKey: currentMembership.roleKey,
      canManageTeam: true,
      members,
      invitations: invitations
        .filter((invitation) => invitation.status === "pending")
        .map((invitation) => ({
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
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!tenant) {
      throw new Error("Tenant not found");
    }

    await requireTeamManager(ctx, tenant._id);

    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant._id))
      .take(1);

    if (!organization[0]) {
      throw new Error("Organization is not provisioned for this tenant");
    }

    const normalizedEmail = args.email.trim().toLowerCase();
    const existingInvitation = await ctx.db
      .query("membershipInvitations")
      .withIndex("by_email_and_status", (q) => q.eq("email", normalizedEmail).eq("status", "pending"))
      .take(25);

    if (existingInvitation.some((invitation) => invitation.tenantId === tenant._id)) {
      throw new Error("A pending invitation already exists for this email");
    }

    const now = Date.now();
    const invitationId = await ctx.db.insert("membershipInvitations", {
      tenantId: tenant._id,
      organizationId: organization[0]._id,
      email: normalizedEmail,
      fullName: args.fullName?.trim() || undefined,
      principalType: "client",
      roleKey: args.roleKey,
      status: "pending",
      invitedBy: actor._id,
      providerHint: "oidc",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 1000 * 60 * 60 * 24 * 7,
    });

    await appendAuditEvent(ctx, {
      tenantId: tenant._id,
      eventType: "membership.invited",
      actorType: "staff_user",
      actorId: actor._id,
      targetType: "membership_invitation",
      targetId: invitationId,
      correlationId: `membership-invitation:${invitationId}`,
      sourceSystem: "portal",
      occurredAt: now,
      payloadAfter: JSON.stringify({
        email: normalizedEmail,
        roleKey: args.roleKey,
      }),
    });

    return {
      invitationId,
      inviteTarget: normalizedEmail,
      providerHint: "oidc",
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
      throw new Error("Membership not found");
    }

    await requireTeamManager(ctx, membership.tenantId);

    const now = Date.now();
    await ctx.db.patch(args.membershipId, {
      status: "revoked",
      revokedAt: now,
      revokedBy: actor._id,
    });

    await appendAuditEvent(ctx, {
      tenantId: membership.tenantId,
      eventType: "organization.membership_removed",
      actorType: "staff_user",
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
