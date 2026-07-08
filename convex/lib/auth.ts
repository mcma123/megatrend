import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

type AuthCtx = QueryCtx | MutationCtx;

const TENANT_ADMIN_ROLE_KEYS = new Set(["platform_admin", "tenant_admin"]);
const TEAM_MANAGER_ROLE_KEYS = new Set(["platform_admin", "tenant_admin", "client_admin"]);

export async function requireIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }
  return identity;
}

export async function getCurrentUser(ctx: AuthCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireCurrentUser(ctx: AuthCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new Error("Authenticated user is not provisioned");
  }
  return user;
}

export async function requireActiveMembership(
  ctx: AuthCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"memberships">> {
  const user = await requireCurrentUser(ctx);
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_tenantId_and_userId", (q) => q.eq("tenantId", tenantId).eq("userId", user._id))
    .unique();
  if (!membership || membership.status !== "active") {
    throw new Error("Active membership required");
  }
  return membership;
}

export async function requireTenantAdministrator(
  ctx: AuthCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"memberships">> {
  const membership = await requireActiveMembership(ctx, tenantId);
  if (!TENANT_ADMIN_ROLE_KEYS.has(membership.roleKey)) {
    throw new Error("Tenant administrator access required");
  }
  return membership;
}

export async function requireTeamManager(
  ctx: AuthCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"memberships">> {
  const membership = await requireActiveMembership(ctx, tenantId);
  if (!TEAM_MANAGER_ROLE_KEYS.has(membership.roleKey)) {
    throw new Error("Team management access required");
  }
  return membership;
}
