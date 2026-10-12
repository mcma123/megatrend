import { ConvexError } from "convex/values";
import { QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

const LIVE_LEASE_STATUSES = new Set(["active", "renewal_in_progress", "client_decision_pending"]);

/** Leases that still carry rent (not renewed, terminated, expired, or archived). */
export function isLiveLease(lease: Doc<"leases">) {
  return !lease.archivedAt && LIVE_LEASE_STATUSES.has(lease.status);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string, label: string) {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ConvexError(`${label} must be a valid date (YYYY-MM-DD)`);
  }
}

export function assertNonNegative(value: number | undefined, label: string) {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new ConvexError(`${label} must be zero or more`);
  }
}

export function requireText(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ConvexError(`${label} is required`);
  }
  return trimmed;
}

export function optionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function getClientLabel(ctx: QueryCtx, tenantId: Id<"tenants">) {
  const tenant = await ctx.db.get(tenantId);
  const organizations = await ctx.db
    .query("organizations")
    .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
    .take(1);
  return {
    tenantId,
    slug: tenant?.slug ?? "",
    name: organizations[0]?.name ?? tenant?.displayName ?? "Unknown client",
  };
}

/** The current rent-carrying lease for a property, if any (latest end date wins). */
export async function getCurrentLeaseForProperty(ctx: QueryCtx, propertyId: Id<"properties">) {
  const leases = await ctx.db
    .query("leases")
    .withIndex("by_propertyId", (q) => q.eq("propertyId", propertyId))
    .take(50);
  const live = leases.filter(isLiveLease).sort((a, b) => b.endDate.localeCompare(a.endDate));
  return live[0] ?? null;
}
