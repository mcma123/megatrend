import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { normalizeEmail } from "./auth";
import { notify } from "./notifications";

export type AlertInput = {
  key: string;
  kind: string;
  severity: "warning" | "critical";
  tenantId?: Id<"tenants">;
  agreementId?: Id<"signingAgreements">;
  /** Codes and counts only: never names, emails, document text or credentials. */
  message: string;
};

async function platformAdmins(ctx: MutationCtx) {
  const ids = new Set<Id<"users">>();
  for (const entry of (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",")) {
    const email = normalizeEmail(entry);
    if (!email) continue;
    for (const user of await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .take(5))
      ids.add(user._id);
  }
  return ids;
}

/** Opens or refreshes an alert; platform administrators are notified when it first opens. */
export async function raiseAlert(ctx: MutationCtx, alert: AlertInput) {
  const now = Date.now();
  const existing = await ctx.db
    .query("signingAlerts")
    .withIndex("by_key", (q) => q.eq("key", alert.key))
    .unique();
  if (existing?.status === "open") {
    await ctx.db.patch(existing._id, {
      lastSeenAt: now,
      message: alert.message.slice(0, 300),
      severity: alert.severity,
    });
    return false;
  }
  const row = {
    ...alert,
    message: alert.message.slice(0, 300),
    status: "open" as const,
    firstSeenAt: now,
    lastSeenAt: now,
    notifiedAt: now,
  };
  if (existing) await ctx.db.replace(existing._id, row);
  else await ctx.db.insert("signingAlerts", row);
  await notify(ctx, {
    recipients: await platformAdmins(ctx),
    kind: "signing_alert",
    title: `Signing ${alert.severity}: ${alert.kind.replaceAll("_", " ")}`,
    body: alert.message,
    link: "/agreements",
  });
  return true;
}
export async function resolveAlert(ctx: MutationCtx, key: string) {
  const existing = await ctx.db
    .query("signingAlerts")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (existing?.status === "open")
    await ctx.db.patch(existing._id, {
      status: "resolved",
      resolvedAt: Date.now(),
    });
}
