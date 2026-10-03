import { MutationCtx, QueryCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { appendAuditEvent } from "./audit";

export async function hasPendingInvitation(ctx: QueryCtx | MutationCtx, email: string) {
  const now = Date.now();
  const invitations = await ctx.db
    .query("membershipInvitations")
    .withIndex("by_email_and_status", (q) => q.eq("email", email).eq("status", "pending"))
    .take(25);
  return invitations.some((invitation) => !invitation.expiresAt || invitation.expiresAt > now);
}

export async function acceptPendingInvitations(
  ctx: MutationCtx,
  userId: Id<"users">,
  email: string,
) {
  const now = Date.now();
  const invitations = await ctx.db
    .query("membershipInvitations")
    .withIndex("by_email_and_status", (q) => q.eq("email", email).eq("status", "pending"))
    .take(25);

  for (const invitation of invitations) {
    if (invitation.expiresAt && invitation.expiresAt <= now) {
      await ctx.db.patch(invitation._id, { status: "expired", updatedAt: now });
      continue;
    }

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
        createdAt: now,
        createdBy: invitation.invitedBy,
      });
    }

    await ctx.db.patch(invitation._id, {
      status: "accepted",
      acceptedAt: now,
      updatedAt: now,
      fulfilledByUserId: userId,
    });

    await appendAuditEvent(ctx, {
      tenantId: invitation.tenantId,
      eventType: "membership.invitation_accepted",
      actorType: invitation.principalType === "staff" ? "staff_user" : "client_user",
      actorId: userId,
      targetType: "membership_invitation",
      targetId: invitation._id,
      correlationId: `membership-invitation:${invitation._id}`,
      sourceSystem: "portal",
      occurredAt: now,
      payloadAfter: JSON.stringify({
        email,
        roleKey: invitation.roleKey,
      }),
    });
  }
}
