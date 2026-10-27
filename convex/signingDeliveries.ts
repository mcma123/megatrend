import { ConvexError, v } from "convex/values";
import {
  deploymentReleaseMode,
  releaseBlockers,
  releaseRecord,
} from "./lib/signingRelease";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { parseFrozen, validInvitation } from "./lib/signingInvitations";
import { signingFileAccess } from "./lib/signingFileAccess";
import { requireSigningWriter } from "./signing";
import { appendSigningEvent } from "./lib/signingAudit";
import { signingHash } from "./lib/signing";
const active = new Set(["queued", "submitting", "running", "unknown"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function emailRemote(
  path: string,
  body?: unknown,
): Promise<unknown> {
  const base = new URL(
    env.SIGNING_WINDMILL_BASE_URL ?? "https://unconfigured.invalid",
  );
  if (
    !env.SIGNING_WINDMILL_BASE_URL ||
    !env.WINDMILL_SIGNING_EMAIL_TOKEN ||
    !env.WINDMILL_WORKSPACE ||
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Signing email service unconfigured");
  const url = `${base.origin}${base.pathname.replace(/\/$/, "")}/api/w/${encodeURIComponent(env.WINDMILL_WORKSPACE)}/${path.startsWith("/get/") ? "jobs_u" : "jobs"}${path}`;
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${env.WINDMILL_SIGNING_EMAIL_TOKEN}`,
      "Content-Type": "application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error("Signing mail service unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty service response");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 256_000) throw new Error("Service response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.length;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
export const context = internalQuery({
  args: { deliveryId: v.id("signingDeliveries") },
  handler: async (ctx, args) => ctx.db.get(args.deliveryId),
});
export const purgePayload = internalMutation({
  args: { deliveryId: v.id("signingDeliveries") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (row && row.payloadExpiresAt <= Date.now())
      await ctx.db.patch(row._id, { sealed: undefined });
    return null;
  },
});
export const claim = internalMutation({
  args: { deliveryId: v.id("signingDeliveries"), jobId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row || row.status !== "queued") return null;
    const invite = await ctx.db.get(row.invitationId),
      access = await validInvitation(ctx, invite);
    let eligible = !!access;
    if (invite && (row.kind === "decline" || row.kind === "completion")) {
      const agreement = await ctx.db.get(row.agreementId),
        tx = await ctx.db.get(row.transactionId),
        frozen = await ctx.db.get(invite.frozenPreparationId),
        tenant = await ctx.db.get(row.tenantId);
      eligible = !!(
        agreement &&
        tx &&
        frozen &&
        tenant?.status === "active" &&
        invite.status !== "revoked" &&
        agreement.tenantId === row.tenantId &&
        agreement.signingTransactionId === tx._id &&
        tx.agreementId === agreement._id &&
        tx.tenantId === row.tenantId &&
        invite.transactionId === tx._id &&
        frozen._id === tx.frozenPreparationId &&
        frozen.preparationHash === tx.preparationHash &&
        (await signingHash(JSON.parse(frozen.snapshot))) ===
          tx.preparationHash &&
        (row.kind === "decline"
          ? agreement.status === "declined" && tx.status === "declined"
          : agreement.status === "completed" && tx.status === "completed")
      );
    }
    // Send-time release check: mail queued before a suspension or allowlist change is suppressed.
    // Verification codes for already-invited participants stop only on a deployment-wide off or a
    // company suspension, so an invited participant can otherwise still verify and finish.
    if (eligible && invite) {
      const agreement = await ctx.db.get(row.agreementId);
      const frozen = await ctx.db.get(invite.frozenPreparationId);
      const email =
        (frozen ? parseFrozen(frozen).participants : []).find(
          (p) => p.key === invite.participantKey,
        )?.email ?? "";
      if (row.kind === "otp") {
        const release = await releaseRecord(ctx, row.tenantId);
        eligible = deploymentReleaseMode() !== "off" && !release?.suspendedAt;
      } else
        eligible =
          (
            await releaseBlockers(ctx, row.tenantId, {
              category: agreement?.category,
              recipients: [email],
            })
          ).length === 0;
    }
    if (
      !row.sealed ||
      row.payloadExpiresAt <= Date.now() ||
      !invite ||
      invite.version !== row.invitationVersion ||
      !eligible
    ) {
      await ctx.db.patch(row._id, {
        status: "suppressed",
        sealed: undefined,
        error: "Access changed or delivery expired",
      });
      return null;
    }
    await ctx.db.patch(row._id, { status: "submitting", jobId: args.jobId });
    await ctx.scheduler.runAfter(15_000, internal.signingDeliveries.poll, {
      deliveryId: row._id,
    });
    return row;
  },
});
export const mark = internalMutation({
  args: {
    deliveryId: v.id("signingDeliveries"),
    jobId: v.string(),
    pollAgain: v.boolean(),
    running: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row || row.jobId !== args.jobId || !active.has(row.status))
      return null;
    const checks = row.checks + 1;
    await ctx.db.patch(row._id, {
      status: args.running ? "running" : "unknown",
      checks,
      error: args.running
        ? undefined
        : "Delivery unresolved; reconcile without sending again",
    });
    if (args.pollAgain && checks < 120)
      await ctx.scheduler.runAfter(
        checks < 30 ? 10_000 : 30_000,
        internal.signingDeliveries.poll,
        { deliveryId: row._id },
      );
    return null;
  },
});
export const finish = internalMutation({
  args: {
    deliveryId: v.id("signingDeliveries"),
    jobId: v.string(),
    outcome: v.union(
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("unknown"),
    ),
    providerMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row || row.jobId !== args.jobId || !active.has(row.status))
      return null;
    if (args.outcome === "accepted") {
      if (!args.providerMessageId || !uuid.test(args.providerMessageId))
        throw new Error("Invalid provider identity");
      const other = await ctx.db
        .query("signingDeliveries")
        .withIndex("by_providerMessageId", (q) =>
          q.eq("providerMessageId", args.providerMessageId),
        )
        .first();
      if (
        (other && other._id !== row._id) ||
        (row.providerMessageId &&
          row.providerMessageId !== args.providerMessageId)
      ) {
        await ctx.db.patch(row._id, {
          status: "unknown",
          error: "Provider identity conflict requires investigation",
        });
        return null;
      }
      await ctx.db.patch(row._id, {
        status: "accepted",
        providerMessageId: args.providerMessageId,
        acceptedAt: row.acceptedAt ?? Date.now(),
        sealed: undefined,
        error: undefined,
      });
      const agreement = await ctx.db.get(row.agreementId);
      if (agreement)
        await appendSigningEvent(
          ctx,
          agreement,
          undefined,
          "email_provider_accepted",
          {
            deliveryId: row._id,
            providerMessageId: args.providerMessageId,
            kind: row.kind,
          },
          { actorKind: "provider" },
        );
    } else
      await ctx.db.patch(row._id, {
        status: args.outcome,
        error:
          args.outcome === "unknown"
            ? "Provider acceptance unresolved; do not send again"
            : "Provider rejected the request or preflight checks failed",
        ...(args.outcome === "rejected" ? { sealed: undefined } : {}),
      });
    return null;
  },
});
export const submit = internalAction({
  args: { deliveryId: v.id("signingDeliveries") },
  handler: async (ctx, args): Promise<null> => {
    const jobId = crypto.randomUUID(),
      row: Doc<"signingDeliveries"> | null = await ctx.runMutation(
        internal.signingDeliveries.claim,
        { ...args, jobId },
      );
    if (!row) return null;
    if (
      !env.SIGNING_WINDMILL_BASE_URL ||
      !env.WINDMILL_SIGNING_EMAIL_TOKEN ||
      !env.WINDMILL_WORKSPACE
    ) {
      await ctx.runMutation(internal.signingDeliveries.finish, {
        ...args,
        jobId,
        outcome: "rejected",
      });
      return null;
    }
    try {
      const result = await emailRemote(
        `/run/p/f/signing/deliver_email?job_id=${jobId}`,
        {
          operation: "send",
          delivery_id: row.deliveryKey,
          kind: row.kind,
          payload_digest: row.payloadDigest,
          sealed: row.sealed,
        },
      );
      if (result !== jobId) throw new Error("Unconfirmed delivery job");
    } catch {
      await ctx.runMutation(internal.signingDeliveries.mark, {
        ...args,
        jobId,
        pollAgain: false,
      });
    }
    return null;
  },
});
export const poll = internalAction({
  args: { deliveryId: v.id("signingDeliveries") },
  handler: async (ctx, args): Promise<null> => {
    const row: Doc<"signingDeliveries"> | null = await ctx.runQuery(
      internal.signingDeliveries.context,
      args,
    );
    if (!row?.jobId || !active.has(row.status)) return null;
    const jobId = row.jobId;
    try {
      const job = (await emailRemote(`/get/${jobId}`)) as {
        id?: string;
        script_path?: string;
        success?: boolean;
        args?: {
          operation?: string;
          delivery_id?: string;
          kind?: string;
          payload_digest?: string;
        };
        result?: { status?: string; providerMessageId?: string };
      };
      if (
        job.id !== jobId ||
        job.script_path !== "f/signing/deliver_email" ||
        job.args?.operation !== "send" ||
        job.args.delivery_id !== row.deliveryKey ||
        job.args.kind !== row.kind ||
        job.args.payload_digest !== row.payloadDigest
      )
        throw new Error("Unconfirmed job context");
      if (typeof job.success !== "boolean") {
        await ctx.runMutation(internal.signingDeliveries.mark, {
          ...args,
          jobId,
          pollAgain: true,
          running: true,
        });
        return null;
      }
      const outcome =
        job.success &&
        job.result?.status === "accepted" &&
        uuid.test(job.result.providerMessageId ?? "")
          ? "accepted"
          : job.success && job.result?.status === "rejected"
            ? "rejected"
            : "unknown";
      await ctx.runMutation(internal.signingDeliveries.finish, {
        ...args,
        jobId,
        outcome,
        ...(outcome === "accepted"
          ? { providerMessageId: job.result!.providerMessageId }
          : {}),
      });
    } catch {
      await ctx.runMutation(internal.signingDeliveries.mark, {
        ...args,
        jobId,
        pollAgain: true,
      });
    }
    return null;
  },
});
export const observe = internalMutation({
  args: {
    deliveryId: v.id("signingDeliveries"),
    providerMessageId: v.string(),
    event: v.string(),
    observedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row || row.providerMessageId !== args.providerMessageId) return null;
    await ctx.db.patch(row._id, {
      providerObservedStatus: args.event,
      providerObservedAt: args.observedAt,
    });
    return null;
  },
});
export const lookup = internalAction({
  args: { deliveryId: v.id("signingDeliveries") },
  handler: async (ctx, args): Promise<null> => {
    const row: Doc<"signingDeliveries"> | null = await ctx.runQuery(
      internal.signingDeliveries.context,
      args,
    );
    if (!row?.providerMessageId) return null;
    try {
      const result = (await emailRemote(
        "/run_wait_result/p/f/signing/deliver_email",
        {
          operation: "lookup",
          delivery_id: row.deliveryKey,
          kind: row.kind,
          payload_digest: row.payloadDigest,
          provider_id: row.providerMessageId,
        },
      )) as Record<string, unknown>;
      if (
        result.status === "observed" &&
        result.providerMessageId === row.providerMessageId &&
        typeof result.event === "string" &&
        typeof result.observedAt === "number" &&
        Math.abs(Date.now() - result.observedAt) < 60_000
      )
        await ctx.runMutation(internal.signingDeliveries.observe, {
          ...args,
          providerMessageId: row.providerMessageId,
          event: result.event,
          observedAt: result.observedAt,
        });
    } catch {
      /* Receipt remains unresolved; lookup never sends. */
    }
    return null;
  },
});
export const reconcile = mutation({
  args: { deliveryId: v.id("signingDeliveries") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row) throw new ConvexError("Delivery not found");
    await signingFileAccess(ctx, row.agreementId);
    await requireSigningWriter(ctx, row.tenantId);
    if (Date.now() - (row.lastReconciledAt ?? 0) < 30_000)
      throw new ConvexError("Delivery is already being checked");
    await ctx.db.patch(row._id, { lastReconciledAt: Date.now() });
    if (row.jobId && active.has(row.status))
      await ctx.scheduler.runAfter(0, internal.signingDeliveries.poll, args);
    if (row.providerMessageId)
      await ctx.scheduler.runAfter(0, internal.signingDeliveries.lookup, args);
    return null;
  },
});
