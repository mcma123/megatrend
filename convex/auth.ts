import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { MutationCtx } from "./_generated/server";
import { isPlatformAdminEmail, normalizeEmail } from "./lib/auth";
import { acceptPendingInvitations, hasPendingInvitation } from "./lib/invitations";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = normalizeEmail(params.email as string | undefined);
        if (!email) {
          throw new Error("Email is required");
        }
        const name = typeof params.name === "string" ? params.name.trim() : "";
        return {
          email,
          ...(name ? { name } : {}),
        };
      },
    }),
  ],
  callbacks: {
    // Sign-up is invite-only: an account can only be created for a platform admin email
    // (PLATFORM_ADMIN_EMAILS) or an email with a pending, unexpired membership invitation.
    async createOrUpdateUser(genericCtx, args) {
      const ctx = genericCtx as unknown as MutationCtx;
      if (args.existingUserId) {
        return args.existingUserId;
      }

      const email = normalizeEmail(args.profile.email);
      if (!email) {
        throw new Error("Email is required");
      }

      const allowed = isPlatformAdminEmail(email) || (await hasPendingInvitation(ctx, email));
      if (!allowed) {
        throw new ConvexError("This email has not been invited to Cyphersoft");
      }

      const name = typeof args.profile.name === "string" ? args.profile.name : undefined;
      const userId = await ctx.db.insert("users", {
        email,
        ...(name ? { name } : {}),
        lastSeenAt: Date.now(),
      });

      await acceptPendingInvitations(ctx, userId, email);
      return userId;
    },
  },
});
