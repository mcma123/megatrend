import { ConvexError } from "convex/values";
import type { Doc } from "../../../convex/_generated/dataModel";

export type PropertyType = Doc<"properties">["propertyType"];
export type PropertyStatus = Doc<"properties">["status"];
export type LeaseStatus = Doc<"leases">["status"];
export type ClientType = NonNullable<Doc<"organizations">["clientType"]>;
export type RelationshipStatus = NonNullable<Doc<"organizations">["relationshipStatus"]>;

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  office: "Office",
  logistics: "Logistics",
  warehouse: "Warehouse",
  retail: "Retail",
  distribution: "Distribution",
  industrial: "Industrial",
  other: "Other",
};

export const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
  active: "Active",
  proposed: "Proposed",
  shortlisted: "Shortlisted",
  rejected: "Rejected",
  expired: "Expired",
};

export const LEASE_STATUS_LABELS: Record<LeaseStatus, string> = {
  active: "Active",
  renewal_in_progress: "Renewal in progress",
  client_decision_pending: "Client decision pending",
  renewed: "Renewed",
  terminated: "Terminated",
  expired: "Expired",
};

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  managed: "Managed",
  tenant_rep: "Tenant-rep",
};

export const RELATIONSHIP_STATUS_LABELS: Record<RelationshipStatus, string> = {
  active: "Active",
  prospect: "Prospect",
  dormant: "Dormant",
};

export const formatZAR = (value: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(value);

export const formatNumber = (value: number) => new Intl.NumberFormat("en-ZA").format(value);

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

const DAY_MS = 1000 * 60 * 60 * 24;

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function daysUntil(iso: string) {
  const target = new Date(`${iso}T00:00:00`).getTime();
  return Math.round((target - startOfToday()) / DAY_MS);
}

export function monthsUntil(iso: string) {
  return Math.round(daysUntil(iso) / 30.44);
}

export function termMonths(startIso: string, endIso: string) {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  return Math.max(
    0,
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()),
  );
}

export function formatTimeToExpiry(iso: string) {
  const days = daysUntil(iso);
  if (days < 0) return "Ended";
  if (days < 60) return `${days} days`;
  return `${monthsUntil(iso)} months`;
}

/** Display state: the stored status plus date-derived "expiring" states for live leases. */
export function describeLeaseStatus(
  lease: { status: LeaseStatus; endDate: string },
  renewalHorizonDays = 180,
) {
  if (lease.status !== "active") {
    return LEASE_STATUS_LABELS[lease.status];
  }
  const days = daysUntil(lease.endDate);
  if (days < 0) return "Past end date";
  if (days <= 90) return "Expiring soon";
  if (days <= renewalHorizonDays) return "Renewal window open";
  return "Active";
}

export function isLiveLease(lease: { status: LeaseStatus }) {
  return (
    lease.status === "active" ||
    lease.status === "renewal_in_progress" ||
    lease.status === "client_decision_pending"
  );
}

/** Renewal cadence, as days before the lease end date. */
export const RENEWAL_STEPS = [
  {
    daysBefore: 180,
    title: "Renewal window open",
    detail: "Client action and notifications; draft renewal insight for staff.",
  },
  {
    daysBefore: 150,
    title: "Prepare renewal briefing pack",
    detail: "Market context, current rental vs comparables, scenarios.",
  },
  {
    daysBefore: 120,
    title: "Review briefing pack with client",
    detail: "Walk the client through the options.",
  },
  {
    daysBefore: 90,
    title: "Refresh market comparables",
    detail: "Re-run sourcing across listed and off-market inventory.",
  },
  {
    daysBefore: 30,
    title: "Invoice cross-check before negotiation",
    detail: "Review the invoice trend and anomalies.",
  },
  {
    daysBefore: 7,
    title: "Final renewal recommendation",
    detail: "Client confirms their decision.",
  },
] as const;

export function renewalStepDate(endIso: string, daysBefore: number) {
  const end = new Date(`${endIso}T00:00:00`);
  end.setDate(end.getDate() - daysBefore);
  const month = String(end.getMonth() + 1).padStart(2, "0");
  const day = String(end.getDate()).padStart(2, "0");
  return `${end.getFullYear()}-${month}-${day}`;
}

/** Message to show for a failed Convex call (ConvexError data reaches the client in prod). */
export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  if (error instanceof ConvexError) {
    return typeof error.data === "string" ? error.data : fallback;
  }
  if (error instanceof Error && error.message && !error.message.includes("Server Error")) {
    return error.message.replace(/^\[CONVEX [^\]]+\]\s*/, "").replace(/^Uncaught Error:\s*/, "");
  }
  return fallback;
}

export function parseOptionalNumber(value: string) {
  const trimmed = value.trim().replace(/[\s,]/g, "");
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}
