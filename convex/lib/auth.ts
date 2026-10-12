import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
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

export function normalizeEmail(email: string | undefined | null) {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function isPlatformAdminEmail(email: string | undefined | null) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }
  const allowList = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter((entry): entry is string => entry !== null);
  return allowList.includes(normalized);
}

export async function getCurrentUser(ctx: AuthCtx): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return null;
  }
  return await ctx.db.get(userId);
}

export async function requireCurrentUser(ctx: AuthCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new Error("Authenticated user is not provisioned");
  }
  return user;
}

export async function requirePlatformAdmin(ctx: AuthCtx): Promise<Doc<"users">> {
  const user = await requireCurrentUser(ctx);
  if (!isPlatformAdminEmail(user.email)) {
    throw new ConvexError("Platform administrator access required");
  }
  return user;
}

// A user can end up with several rows for one tenant (re-invites, staff + client);
// pick the active one instead of assuming uniqueness.
export async function findActiveMembership(
  ctx: AuthCtx,
  tenantId: Id<"tenants">,
  userId: Id<"users">,
): Promise<Doc<"memberships"> | null> {
  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_tenantId_and_userId", (q) => q.eq("tenantId", tenantId).eq("userId", userId))
    .take(10);
  const active = rows.filter((row) => row.status === "active");
  return active.find((row) => row.principalType === "staff") ?? active[0] ?? null;
}

export async function requireActiveMembership(
  ctx: AuthCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"memberships">> {
  const user = await requireCurrentUser(ctx);
  const membership = await findActiveMembership(ctx, tenantId, user._id);
  if (!membership) {
    throw new ConvexError("You do not have access to this workspace");
  }
  return membership;
}

export type TenantAccess = {
  user: Doc<"users">;
  membership: Doc<"memberships"> | null;
  isPlatformAdmin: boolean;
  principalType: "staff" | "client";
  roleKey: string;
};

/** Platform admins reach every tenant; everyone else needs an active membership. */
export async function getTenantAccess(
  ctx: AuthCtx,
  tenantId: Id<"tenants">,
): Promise<TenantAccess | null> {
  const user = await getCurrentUser(ctx);
  if (!user) {
    return null;
  }
  const membership = await findActiveMembership(ctx, tenantId, user._id);
  if (isPlatformAdminEmail(user.email)) {
    return { user, membership, isPlatformAdmin: true, principalType: "staff", roleKey: "platform_admin" };
  }
  if (!membership) {
    return null;
  }
  return {
    user,
    membership,
    isPlatformAdmin: false,
    principalType: membership.principalType,
    roleKey: membership.roleKey,
  };
}

export async function requireTenantAccess(ctx: AuthCtx, tenantId: Id<"tenants">) {
  const access = await getTenantAccess(ctx, tenantId);
  if (!access) {
    throw new ConvexError("You do not have access to this workspace");
  }
  return access;
}

/** Portfolio records (clients, properties, leases) are edited by staff only. */
export async function requireTenantWriter(ctx: AuthCtx, tenantId: Id<"tenants">) {
  const access = await requireTenantAccess(ctx, tenantId);
  if (access.principalType !== "staff" || access.roleKey === "read_only_staff") {
    throw new ConvexError("Only Cyphersoft staff can change portfolio records");
  }
  return access;
}

const READ_ONLY_ROLE_KEYS = new Set(["read_only_staff", "executive_viewer"]);

/** Uploading documents: any active member except read-only roles. */
export async function requireTenantUploader(ctx: AuthCtx, tenantId: Id<"tenants">) {
  const access = await requireTenantAccess(ctx, tenantId);
  if (READ_ONLY_ROLE_KEYS.has(access.roleKey)) {
    throw new ConvexError("Your role can view documents but not upload them");
  }
  return access;
}

export function isReadOnlyRole(roleKey: string) {
  return READ_ONLY_ROLE_KEYS.has(roleKey);
}

export async function requireTenantAdministrator(ctx: AuthCtx, tenantId: Id<"tenants">) {
  const access = await requireTenantAccess(ctx, tenantId);
  if (!TENANT_ADMIN_ROLE_KEYS.has(access.roleKey)) {
    throw new ConvexError("Tenant administrator access required");
  }
  return access;
}

export async function requireTeamManager(ctx: AuthCtx, tenantId: Id<"tenants">) {
  const access = await requireTenantAccess(ctx, tenantId);
  if (!TEAM_MANAGER_ROLE_KEYS.has(access.roleKey)) {
    throw new ConvexError("Team management access required");
  }
  return access;
}

export function actorTypeFor(access: { principalType: "staff" | "client" }) {
  return access.principalType === "staff" ? ("staff_user" as const) : ("client_user" as const);
}

export type StaffContext = {
  user: Doc<"users">;
  isPlatformAdmin: boolean;
  staffTenantIds: Id<"tenants">[];
};

/** Staff = platform admin, or anyone with an active staff membership in some tenant. */
export async function getStaffContext(ctx: AuthCtx): Promise<StaffContext | null> {
  const user = await getCurrentUser(ctx);
  if (!user) {
    return null;
  }
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .take(200);
  const staffTenantIds = memberships
    .filter((row) => row.status === "active" && row.principalType === "staff")
    .map((row) => row.tenantId);
  const isPlatformAdmin = isPlatformAdminEmail(user.email);
  if (!isPlatformAdmin && staffTenantIds.length === 0) {
    return null;
  }
  return { user, isPlatformAdmin, staffTenantIds };
}

export async function requireStaff(ctx: AuthCtx): Promise<StaffContext> {
  const staff = await getStaffContext(ctx);
  if (!staff) {
    throw new ConvexError("Cyphersoft staff access required");
  }
  return staff;
}

/** Tenants a staff user can work in: all of them for platform admins. */
export async function listStaffTenants(ctx: AuthCtx, staff: StaffContext) {
  if (staff.isPlatformAdmin) {
    return await ctx.db.query("tenants").take(200);
  }
  const tenants: Doc<"tenants">[] = [];
  for (const tenantId of new Set(staff.staffTenantIds)) {
    const tenant = await ctx.db.get(tenantId);
    if (tenant) {
      tenants.push(tenant);
    }
  }
  return tenants;
}
