import { mutation, query } from "./_generated/server";
import { appendAuditEvent } from "./lib/audit";
import { requireIdentity } from "./lib/auth";

export const syncCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    const normalizedEmail = identity.email?.trim().toLowerCase();
    const profileFields = {
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      ...(identity.name ? { name: identity.name } : {}),
      ...(identity.pictureUrl ? { avatarUrl: identity.pictureUrl } : {}),
      lastSeenAt: Date.now(),
    };

    const userId = existing
      ? existing._id
      : await ctx.db.insert("users", {
          tokenIdentifier: identity.tokenIdentifier,
          ...profileFields,
        });

    if (existing) {
      await ctx.db.patch(existing._id, profileFields);
    }

    if (normalizedEmail) {
      const invitations = await ctx.db
        .query("membershipInvitations")
        .withIndex("by_email_and_status", (q) => q.eq("email", normalizedEmail).eq("status", "pending"))
        .take(25);

      for (const invitation of invitations) {
        const existingMembership = await ctx.db
          .query("memberships")
          .withIndex("by_tenantId_and_userId", (q) => q.eq("tenantId", invitation.tenantId).eq("userId", userId))
          .unique();

        if (!existingMembership) {
          await ctx.db.insert("memberships", {
            tenantId: invitation.tenantId,
            organizationId: invitation.organizationId,
            userId,
            principalType: invitation.principalType,
            roleKey: invitation.roleKey,
            status: "active",
            createdAt: Date.now(),
            createdBy: invitation.invitedBy,
          });
        }

        await ctx.db.patch(invitation._id, {
          status: "accepted",
          acceptedAt: Date.now(),
          updatedAt: Date.now(),
          fulfilledByUserId: userId,
        });

        await appendAuditEvent(ctx, {
          tenantId: invitation.tenantId,
          eventType: "membership.invitation_accepted",
          actorType: "client_user",
          actorId: userId,
          targetType: "membership_invitation",
          targetId: invitation._id,
          correlationId: `membership-invitation:${invitation._id}`,
          sourceSystem: "portal",
          occurredAt: Date.now(),
          payloadAfter: JSON.stringify({
            email: normalizedEmail,
            roleKey: invitation.roleKey,
          }),
        });
      }
    }

    return userId;
  },
});

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    return await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
  },
});
