import type { Doc } from "../../../convex/_generated/dataModel";
import { daysUntil } from "@/lib/portfolio";

export type ActionStatus = Doc<"actions">["status"];
export type Priority = Doc<"actions">["priority"];
export type InsightStatus = Doc<"insights">["status"];
export type InsightCategory = Doc<"insights">["category"];

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_client: "Waiting on client",
  waiting_on_cyphersoft: "Waiting on Cyphersoft",
  waiting_on_landlord: "Waiting on landlord",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** How clients read the same statuses. */
export const CLIENT_ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_client: "Waiting on you",
  waiting_on_cyphersoft: "With Cyphersoft",
  waiting_on_landlord: "Waiting on landlord",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const PRIORITY_CLASSES: Record<Priority, string> = {
  low: "border-border text-muted-foreground",
  medium: "border-primary/30 text-primary",
  high: "border-warning/40 text-warning",
  critical: "border-destructive/40 text-destructive",
};

export const OPEN_ACTION_STATUSES: ActionStatus[] = [
  "open",
  "in_progress",
  "waiting_on_client",
  "waiting_on_cyphersoft",
  "waiting_on_landlord",
];

export function isOpenAction(status: ActionStatus) {
  return OPEN_ACTION_STATUSES.includes(status);
}

export function isOverdue(action: { status: ActionStatus; dueDate?: string }) {
  return Boolean(action.dueDate && isOpenAction(action.status) && daysUntil(action.dueDate) < 0);
}

export function isDueThisWeek(action: { status: ActionStatus; dueDate?: string }) {
  if (!action.dueDate || !isOpenAction(action.status)) return false;
  const days = daysUntil(action.dueDate);
  return days >= 0 && days <= 7;
}

export const INSIGHT_STATUS_LABELS: Record<InsightStatus, string> = {
  draft: "Draft",
  under_review: "Under review",
  published: "Published",
  rejected: "Sent back",
  withdrawn: "Withdrawn",
};

export const INSIGHT_CATEGORY_LABELS: Record<InsightCategory, string> = {
  renewal: "Renewal",
  cost: "Cost",
  document: "Document",
  market: "Market",
  risk: "Risk",
  other: "Other",
};

export function timeAgo(ms: number) {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
