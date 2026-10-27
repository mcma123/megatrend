import { getAuthSessionId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { requirePlatformAdmin } from "./auth";

export async function signingSession(ctx: QueryCtx | MutationCtx) {
  const user = await requirePlatformAdmin(ctx);
  const sessionId = await getAuthSessionId(ctx);
  const session = sessionId ? await ctx.db.get(sessionId) : null;
  if (
    !session ||
    session.userId !== user._id ||
    session.expirationTime <= Date.now()
  ) {
    throw new ConvexError("A current signed-in session is required");
  }
  return { user, sessionId: session._id };
}

export async function requireSigningMfa(ctx: QueryCtx | MutationCtx) {
  const session = await signingSession(ctx);
  const credential = await ctx.db
    .query("signingMfa")
    .withIndex("by_userId", (q) => q.eq("userId", session.user._id))
    .unique();
  const grant = await ctx.db
    .query("signingMfaGrants")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", session.sessionId))
    .unique();
  if (
    !credential?.enabled ||
    credential.lockedUntil > Date.now() ||
    !grant ||
    grant.userId !== session.user._id ||
    grant.credentialVersion !== credential.credentialVersion ||
    grant.expiresAt <= Date.now()
  ) {
    throw new ConvexError(
      "Verify your signing authenticator before changing agreements",
    );
  }
  return session;
}
