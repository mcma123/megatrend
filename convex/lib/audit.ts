import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

type AppendAuditEventArgs = {
  tenantId: Id<"tenants">;
  eventType: string;
  actorType: "staff_user" | "client_user" | "system";
  actorId?: Id<"users">;
  targetType: string;
  targetId: string;
  correlationId: string;
  sourceSystem: "convex" | "windmill" | "mastra" | "portal" | "megatrend_os";
  occurredAt: number;
  payloadBefore?: string;
  payloadAfter?: string;
  reason?: string;
};

async function sha256(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function appendAuditEvent(ctx: MutationCtx, args: AppendAuditEventArgs) {
  const chain = await ctx.db
    .query("auditChains")
    .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
    .unique();

  const prevHash = chain?.lastHash;
  const serializedEvent = JSON.stringify({
    tenantId: args.tenantId,
    eventType: args.eventType,
    actorType: args.actorType,
    actorId: args.actorId ?? null,
    targetType: args.targetType,
    targetId: args.targetId,
    correlationId: args.correlationId,
    sourceSystem: args.sourceSystem,
    occurredAt: args.occurredAt,
    payloadBefore: args.payloadBefore ?? null,
    payloadAfter: args.payloadAfter ?? null,
    reason: args.reason ?? null,
    prevHash: prevHash ?? null,
  });
  const eventHash = await sha256(serializedEvent);

  const eventId = await ctx.db.insert("auditEvents", {
    ...args,
    prevHash,
    eventHash,
  });

  if (chain) {
    await ctx.db.patch(chain._id, {
      lastEventId: eventId,
      lastHash: eventHash,
      updatedAt: args.occurredAt,
    });
  } else {
    await ctx.db.insert("auditChains", {
      tenantId: args.tenantId,
      lastEventId: eventId,
      lastHash: eventHash,
      updatedAt: args.occurredAt,
    });
  }

  return { eventId, eventHash };
}
