import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  env,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { canonicalJson } from "./lib/signing";
import { requireSigningMfa } from "./lib/signingSecurity";
import type { Doc } from "./_generated/dataModel";

async function remote(
  operation: "put" | "latest",
  payload: Record<string, unknown>,
): Promise<unknown> {
  if (!env.SIGNING_WINDMILL_BASE_URL)
    throw new ConvexError("Signing checkpoint service is not configured");
  const base = new URL(
    env.SIGNING_WINDMILL_BASE_URL ?? "https://unconfigured.invalid",
  );
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !env.WINDMILL_SIGNING_TOKEN ||
    !env.WINDMILL_WORKSPACE
  )
    throw new ConvexError("Signing checkpoint service is not configured");
  const response = await fetch(
    `${base.origin}${base.pathname.replace(/\/$/, "")}/api/w/${encodeURIComponent(env.WINDMILL_WORKSPACE)}/jobs/run_wait_result/p/f/signing/audit_checkpoint`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
      headers: {
        Authorization: `Bearer ${env.WINDMILL_SIGNING_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operation,
        tenant_id: payload.tenantId,
        agreement_id: payload.agreementId,
        payload,
      }),
    },
  );
  if (!response.ok)
    throw new ConvexError(
      "Signing checkpoint service failed; reconcile before retrying",
    );
  const text = await response.text();
  if (text.length > 65_536)
    throw new ConvexError("Checkpoint response exceeded its limit");
  return JSON.parse(text);
}

function receipt(value: unknown): {
  payload: Record<string, unknown>;
  objectVersion: string;
  retainUntil: number;
} {
  if (!value || typeof value !== "object")
    throw new ConvexError("Invalid checkpoint receipt");
  const row = value as Record<string, unknown>;
  if (
    !row.payload ||
    typeof row.payload !== "object" ||
    typeof row.objectVersion !== "string" ||
    !row.objectVersion ||
    row.objectVersion.length > 2000 ||
    typeof row.retainUntil !== "number" ||
    !Number.isFinite(row.retainUntil) ||
    row.retainUntil <= Date.now()
  )
    throw new ConvexError("Invalid protected checkpoint receipt");
  return {
    payload: row.payload as Record<string, unknown>,
    objectVersion: row.objectVersion,
    retainUntil: row.retainUntil,
  };
}

export const claim = internalMutation({
  args: { checkpointId: v.id("signingCheckpoints") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.checkpointId);
    if (
      !row ||
      row.status === "stored" ||
      row.attempts >= 5 ||
      (row.status === "running" && (row.claimExpiresAt ?? 0) > Date.now())
    )
      return null;
    await ctx.db.patch(row._id, {
      status: "running",
      attempts: row.attempts + 1,
      claimExpiresAt: Date.now() + 60_000,
      error: undefined,
    });
    return { ...row, attempts: row.attempts + 1 };
  },
});

export const finish = internalMutation({
  args: {
    checkpointId: v.id("signingCheckpoints"),
    attempt: v.number(),
    objectVersion: v.optional(v.string()),
    retainUntil: v.optional(v.number()),
    failed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.checkpointId);
    if (!row || row.status !== "running" || row.attempts !== args.attempt)
      return null;
    if (
      !args.failed &&
      (!args.objectVersion ||
        !args.retainUntil ||
        args.retainUntil <= Date.now())
    )
      throw new ConvexError("Invalid checkpoint completion");
    await ctx.db.patch(
      row._id,
      args.failed
        ? {
            status: "failed",
            error:
              "Checkpoint service failed. Restore configuration, then reconcile or retry",
            claimExpiresAt: undefined,
          }
        : {
            status: "stored",
            objectVersion: args.objectVersion,
            retainUntil: args.retainUntil,
            error: undefined,
            claimExpiresAt: undefined,
          },
    );
    return null;
  },
});

export const process = internalAction({
  args: { checkpointId: v.id("signingCheckpoints") },
  handler: async (ctx, args): Promise<null> => {
    const row: Doc<"signingCheckpoints"> | null = await ctx.runMutation(
      internal.signingCheckpoints.claim,
      args,
    );
    if (!row) return null;
    try {
      const payload: Record<string, unknown> = JSON.parse(row.snapshot);
      if (
        payload.contractVersion !== 1 ||
        payload.tenantId !== row.tenantId ||
        payload.agreementId !== row.agreementId ||
        payload.sequence !== row.sequence ||
        payload.headHash !== row.headHash ||
        canonicalJson(payload) !== row.snapshot
      ) {
        throw new Error(
          "Checkpoint identity does not match its transactional outbox row",
        );
      }
      const stored = receipt(await remote("put", payload));
      if (canonicalJson(stored.payload) !== row.snapshot)
        throw new Error("Checkpoint mismatch");
      await ctx.runMutation(internal.signingCheckpoints.finish, {
        checkpointId: row._id,
        attempt: row.attempts,
        failed: false,
        objectVersion: stored.objectVersion,
        retainUntil: stored.retainUntil,
      });
    } catch {
      await ctx.runMutation(internal.signingCheckpoints.finish, {
        checkpointId: row._id,
        attempt: row.attempts,
        failed: true,
      });
    }
    return null;
  },
});

export const retry = mutation({
  args: { checkpointId: v.id("signingCheckpoints") },
  handler: async (ctx, args) => {
    await requireSigningMfa(ctx);
    const row = await ctx.db.get(args.checkpointId);
    if (!row) throw new ConvexError("Checkpoint not found");
    await ctx.runQuery(api.signing.get, { agreementId: row.agreementId });
    if (row.status === "stored") return null;
    if (row.attempts >= 5)
      throw new ConvexError(
        "Checkpoint requires operator review after five attempts",
      );
    if (row.status === "running" && (row.claimExpiresAt ?? 0) > Date.now())
      throw new ConvexError("Checkpoint is still being processed");
    await ctx.scheduler.runAfter(0, internal.signingCheckpoints.process, args);
    return null;
  },
});

export const descriptor = internalQuery({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    await requireSigningMfa(ctx);
    const data: {
      agreement: Doc<"signingAgreements">;
      revision: Doc<"signingRevisions">;
    } = await ctx.runQuery(api.signing.get, args);
    return {
      contractVersion: 1,
      tenantId: data.agreement.tenantId,
      agreementId: data.agreement._id,
      sequence: data.agreement.eventCount,
      headHash: data.agreement.lastEventHash!,
      revision: data.agreement.revision,
      contentHash: data.revision.contentHash,
    };
  },
});

export const matchAnchor = internalQuery({
  args: {
    agreementId: v.id("signingAgreements"),
    sequence: v.number(),
    headHash: v.string(),
    revision: v.number(),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSigningMfa(ctx);
    const agreement = await ctx.db.get(args.agreementId);
    if (!agreement || agreement.eventCount < args.sequence) return false;
    const event = await ctx.db
      .query("signingEvents")
      .withIndex("by_agreementId_and_sequence", (q) =>
        q.eq("agreementId", args.agreementId).eq("sequence", args.sequence),
      )
      .unique();
    const revision = await ctx.db
      .query("signingRevisions")
      .withIndex("by_agreementId_and_revision", (q) =>
        q.eq("agreementId", args.agreementId).eq("revision", args.revision),
      )
      .unique();
    return (
      event?.eventHash === args.headHash &&
      revision?.contentHash === args.contentHash
    );
  },
});

export const verify = action({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: string;
    independentlyAnchored: boolean;
    anchoredSequence?: number;
  }> => {
    const payload: Record<string, unknown> = await ctx.runQuery(
      internal.signingCheckpoints.descriptor,
      args,
    );
    const consistency: { status: string } = await ctx.runQuery(
      api.signing.verifyAudit,
      args,
    );
    if (consistency.status !== "consistent_unanchored")
      return { status: consistency.status, independentlyAnchored: false };
    const value = await remote("latest", payload);
    if (!value) return { status: "unanchored", independentlyAnchored: false };
    const anchor = receipt(value);
    const a = anchor.payload;
    if (
      a.tenantId !== payload.tenantId ||
      a.agreementId !== args.agreementId ||
      a.contractVersion !== 1 ||
      !Number.isSafeInteger(a.sequence) ||
      !Number.isSafeInteger(a.revision) ||
      typeof a.headHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(a.headHash) ||
      typeof a.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(a.contentHash)
    )
      throw new ConvexError("Invalid independent checkpoint identity");
    const matches: boolean = await ctx.runQuery(
      internal.signingCheckpoints.matchAnchor,
      {
        agreementId: args.agreementId,
        sequence: a.sequence as number,
        headHash: a.headHash,
        revision: a.revision as number,
        contentHash: a.contentHash,
      },
    );
    if (!matches)
      return {
        status: "rollback_or_tampering_detected",
        independentlyAnchored: false,
      };
    return {
      status: a.sequence === payload.sequence ? "anchored" : "anchored_prefix",
      independentlyAnchored: true,
      anchoredSequence: a.sequence as number,
    };
  },
});
