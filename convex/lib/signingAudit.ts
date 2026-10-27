import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { env, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { appendAuditEvent } from "./audit";
import { canonicalJson, signingHash } from "./signing";

export function signingEventEnvelope(
  event: Pick<
    Doc<"signingEvents">,
    | "agreementId"
    | "tenantId"
    | "sequence"
    | "eventType"
    | "actorId"
    | "actorKind"
    | "participantKey"
    | "occurredAt"
    | "revision"
    | "payload"
    | "previousHash"
  >,
) {
  return {
    contractVersion: 1,
    agreementId: event.agreementId,
    tenantId: event.tenantId,
    sequence: event.sequence,
    eventType: event.eventType,
    actorId: event.actorId,
    ...(event.actorKind
      ? { actorKind: event.actorKind, participantKey: event.participantKey }
      : {}),
    occurredAt: event.occurredAt,
    revision: event.revision,
    payload: event.payload,
    previousHash: event.previousHash ?? null,
  };
}

/** The head and event append share the same transaction as the business change. */
export async function appendSigningEvent(
  ctx: MutationCtx,
  agreement: Doc<"signingAgreements">,
  actorId: Id<"users"> | undefined,
  eventType: string,
  details: Record<string, unknown>,
  external?: { actorKind: "provider" | "signer"; participantKey?: string },
) {
  const head = await ctx.db.get(agreement._id);
  if (!head) throw new ConvexError("Agreement not found");
  const event = {
    agreementId: head._id,
    tenantId: head.tenantId,
    sequence: head.eventCount + 1,
    eventType,
    actorId,
    ...external,
    occurredAt: Date.now(),
    revision: head.revision,
    payload: canonicalJson(details),
    ...(head.lastEventHash ? { previousHash: head.lastEventHash } : {}),
  };
  const eventHash = await signingHash(signingEventEnvelope(event));
  await ctx.db.insert("signingEvents", { ...event, eventHash });
  await ctx.db.patch(head._id, {
    eventCount: event.sequence,
    lastEventHash: eventHash,
  });
  const revision = head.currentRevisionId
    ? await ctx.db.get(head.currentRevisionId)
    : null;
  if (!revision)
    throw new ConvexError("Cannot checkpoint a missing agreement revision");
  const checkpointId = await ctx.db.insert("signingCheckpoints", {
    tenantId: head.tenantId,
    agreementId: head._id,
    sequence: event.sequence,
    headHash: eventHash,
    snapshot: canonicalJson({
      contractVersion: 1,
      tenantId: head.tenantId,
      agreementId: head._id,
      sequence: event.sequence,
      headHash: eventHash,
      revision: head.revision,
      contentHash: revision.contentHash,
    }),
    status: "pending",
    attempts: 0,
  });
  if (env.WINDMILL_SIGNING_TOKEN && env.SIGNING_WINDMILL_BASE_URL) {
    await ctx.scheduler.runAfter(0, internal.signingCheckpoints.process, {
      checkpointId,
    });
  }
  // Keep shared audit compatibility without putting participant PII in general dashboards.
  await appendAuditEvent(ctx, {
    tenantId: head.tenantId,
    eventType: `signing.${eventType}`,
    actorType: actorId ? "staff_user" : "system",
    actorId,
    targetType: "signing_agreement",
    targetId: head._id,
    correlationId: head._id,
    sourceSystem: "convex",
    occurredAt: event.occurredAt,
    payloadAfter: canonicalJson({ revision: head.revision, eventHash }),
  });
}
