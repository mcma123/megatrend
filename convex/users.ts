import { mutation, query } from "./_generated/server";
import { getCurrentUser, isPlatformAdminEmail, normalizeEmail, requireCurrentUser } from "./lib/auth";
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
    return {
      _id: user._id,
      email: user.email ?? null,
      name: user.name ?? null,
      isPlatformAdmin: isPlatformAdminEmail(user.email),
    };
  },
});
