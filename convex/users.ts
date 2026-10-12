import { mutation, query } from "./_generated/server";
import {
  getCurrentUser,
  getStaffContext,
  isPlatformAdminEmail,
  normalizeEmail,
  requireCurrentUser,
} from "./lib/auth";
import { acceptPendingInvitations } from "./lib/invitations";

// Called by the client after sign-in: refreshes lastSeenAt and accepts any invitations
// issued to this email after the account was created.
export const syncCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    await ctx.db.patch(user._id, { lastSeenAt: Date.now() });

    const email = normalizeEmail(user.email);
    if (email) {
      await acceptPendingInvitations(ctx, user._id, email);
    }

    return user._id;
  },
});

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return null;
    }

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .take(50);

    // Client portals this user can open (active client memberships).
    const portals: Array<{ slug: string; name: string; roleKey: string }> = [];
    const seen = new Set<string>();
    for (const membership of memberships) {
      if (membership.status !== "active" || membership.principalType !== "client") {
        continue;
      }
      if (seen.has(membership.tenantId)) {
        continue;
      }
      seen.add(membership.tenantId);
      const tenant = await ctx.db.get(membership.tenantId);
      if (tenant && tenant.status === "active") {
        portals.push({ slug: tenant.slug, name: tenant.displayName, roleKey: membership.roleKey });
      }
    }

    const staff = await getStaffContext(ctx);
    return {
      _id: user._id,
      email: user.email ?? null,
      name: user.name ?? null,
      isPlatformAdmin: isPlatformAdminEmail(user.email),
      isStaff: staff !== null,
      portals,
    };
  },
});
