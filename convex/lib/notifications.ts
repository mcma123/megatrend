import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { normalizeEmail } from "./auth";

/** Staff who should hear about a client's activity: its staff members plus platform admins. */
export async function staffRecipients(ctx: MutationCtx, tenantId: Id<"tenants">) {
  const recipients = new Set<Id<"users">>();
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", tenantId).eq("status", "active"))
    .take(200);
  for (const membership of memberships) {
    if (membership.principalType === "staff" && membership.roleKey !== "read_only_staff") {
      recipients.add(membership.userId);
    }
  }
  const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter((entry): entry is string => entry !== null);
  for (const email of adminEmails) {
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .take(5);
    for (const user of users) recipients.add(user._id);
  }
  return recipients;
}

/** Client users of a tenant (active client memberships). */
export async function clientRecipients(ctx: MutationCtx, tenantId: Id<"tenants">) {
  const recipients = new Set<Id<"users">>();
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", tenantId).eq("status", "active"))
    .take(200);
  for (const membership of memberships) {
    if (membership.principalType === "client") recipients.add(membership.userId);
  }
  return recipients;
}

export async function notify(
  ctx: MutationCtx,
  args: {
    recipients: Iterable<Id<"users">>;
    /** The user who caused the event never notifies themselves. */
    excludeUserId?: Id<"users">;
    tenantId?: Id<"tenants">;
    kind: string;
    title: string;
    body?: string;
    link?: string;
  },
) {
  const now = Date.now();
  const sent = new Set<Id<"users">>();
  for (const userId of args.recipients) {
    if (userId === args.excludeUserId || sent.has(userId)) continue;
    sent.add(userId);
    await ctx.db.insert("notifications", {
      userId,
      tenantId: args.tenantId,
      kind: args.kind,
      title: args.title.slice(0, 200),
      body: args.body?.slice(0, 500),
      link: args.link,
      createdAt: now,
    });
  }
  return sent.size;
}

export async function tenantSlug(ctx: MutationCtx, tenantId: Id<"tenants">) {
  return (await ctx.db.get(tenantId))?.slug ?? "";
}
