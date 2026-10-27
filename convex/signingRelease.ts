import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { appendAuditEvent } from "./lib/audit";
import {
  requirePlatformAdmin,
  requireStaff,
  requireTenantAccess,
} from "./lib/auth";
import type { QueryCtx } from "./_generated/server";

async function isPlatformAdmin(ctx: QueryCtx) {
  try {
    await requirePlatformAdmin(ctx);
    return true;
  } catch {
    return false;
  }
}
import { boundedText, canonicalJson, checkedRevision } from "./lib/signing";
import {
  deploymentReleaseMode,
  MAX_PILOT_RECIPIENTS,
  normalizePilotRecipient,
  releaseBlockers,
  releaseMode,
  releaseRecord,
} from "./lib/signingRelease";
import { requireSigningWriter } from "./signing";

/** Company staff can see whether and why external sending is blocked. */
export const get = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const access = await requireTenantAccess(ctx, args.tenantId);
    if (access.principalType !== "staff")
      throw new ConvexError("Signing records require company staff access");
    const record = await releaseRecord(ctx, args.tenantId);
    return {
      deploymentMode: deploymentReleaseMode(),
      record: record
        ? {
            revision: record.revision,
            mode: record.mode,
            // Addresses are personal data: only platform administrators see the list.
            pilotRecipients: (await isPlatformAdmin(ctx))
              ? record.pilotRecipients
              : [],
            pilotRecipientCount: record.pilotRecipients.length,
            legalSignOffReference: record.legalSignOffReference,
            acceptanceReference: record.acceptanceReference,
            recordedAt: record.recordedAt,
            suspendedAt: record.suspendedAt ?? null,
            suspensionReason: record.suspensionReason ?? null,
          }
        : null,
      // Recipient-independent blockers; pilot allowlists are checked per agreement.
      blockers: await releaseBlockers(ctx, args.tenantId),
    };
  },
});

async function audit(
  ctx: Parameters<typeof appendAuditEvent>[0],
  tenantId: Id<"tenants">,
  actorId: Id<"users">,
  eventType: string,
  payload: unknown,
  reason?: string,
) {
  await appendAuditEvent(ctx, {
    tenantId,
    eventType,
    actorType: "staff_user",
    actorId,
    targetType: "signing_release",
    targetId: tenantId,
    correlationId: `${tenantId}:${eventType}:${Date.now()}`,
    sourceSystem: "convex",
    occurredAt: Date.now(),
    payloadAfter: canonicalJson(payload),
    ...(reason ? { reason } : {}),
  });
}

/**
 * Records the company's release approval. Attestation references point to real evidence;
 * recording them never proves legal validity or service health on its own.
 */
export const record = mutation({
  args: {
    tenantId: v.id("tenants"),
    expectedRevision: v.number(),
    mode: releaseMode,
    pilotRecipients: v.array(v.string()),
    legalSignOffReference: v.string(),
    acceptanceReference: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireSigningWriter(ctx, args.tenantId);
    const prior = await releaseRecord(ctx, args.tenantId);
    if ((prior?.revision ?? 0) !== checkedRevision(args.expectedRevision))
      throw new ConvexError("Release settings changed. Reload before saving");
    if (args.pilotRecipients.length > MAX_PILOT_RECIPIENTS)
      throw new ConvexError(
        `At most ${MAX_PILOT_RECIPIENTS} pilot recipients are allowed`,
      );
    const pilotRecipients = [
      ...new Set(args.pilotRecipients.map(normalizePilotRecipient)),
    ].sort();
    if (args.mode === "pilot" && !pilotRecipients.length)
      throw new ConvexError("A pilot needs at least one allowlisted recipient");
    const row = {
      tenantId: args.tenantId,
      revision: (prior?.revision ?? 0) + 1,
      mode: args.mode,
      pilotRecipients,
      legalSignOffReference: boundedText(
        args.legalSignOffReference,
        "Legal sign-off reference",
        500,
      ),
      acceptanceReference: boundedText(
        args.acceptanceReference,
        "Acceptance evidence reference",
        500,
      ),
      recordedAt: Date.now(),
      recordedBy: user._id,
    };
    // Recording again lifts a suspension explicitly, with a new revision.
    if (prior) await ctx.db.replace(prior._id, row);
    else await ctx.db.insert("signingReleases", row);
    await audit(ctx, args.tenantId, user._id, "signing.release_recorded", {
      revision: row.revision,
      mode: row.mode,
      pilotRecipientCount: pilotRecipients.length,
    });
    return { revision: row.revision };
  },
});

/** Immediate stop for new outbound signing mail for one company. */
export const suspend = mutation({
  args: { tenantId: v.id("tenants"), reason: v.string() },
  handler: async (ctx, args) => {
    const user = await requireSigningWriter(ctx, args.tenantId);
    const prior = await releaseRecord(ctx, args.tenantId);
    if (!prior) throw new ConvexError("There is no release to suspend");
    if (prior.suspendedAt) return null;
    const reason = boundedText(args.reason, "Suspension reason", 1000);
    await ctx.db.patch(prior._id, {
      suspendedAt: Date.now(),
      suspendedBy: user._id,
      suspensionReason: reason,
      revision: prior.revision + 1,
    });
    await audit(
      ctx,
      args.tenantId,
      user._id,
      "signing.release_suspended",
      { revision: prior.revision + 1 },
      reason,
    );
    return null;
  },
});
