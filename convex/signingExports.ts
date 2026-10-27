import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireSigningReader, requireSigningWriter } from "./signing";
import { boundedText, canonicalJson, signingHash } from "./lib/signing";
import { appendAuditEvent } from "./lib/audit";
import { requireStaff } from "./lib/auth";
import { sha256Text } from "./lib/signingAccessCrypto";
import {
  documentsConfigured,
  secureUrl,
  workerRequest,
} from "./lib/signingWorker";

const SCRIPT = "f/signing/export_company";
type Artifact = {
  agreementId: string;
  kind:
    | "source"
    | "bundle"
    | "manifest"
    | "pdf"
    | "evidence"
    | "record"
    | "attachment";
  id: string;
  version: string;
  sha256: string;
  contentType?: string;
};
async function rows<T>(query: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const row of query) {
    if (result.length >= 2000)
      throw new ConvexError(
        "Export snapshot exceeds 2,000 records in one collection; no partial export created",
      );
    result.push(row);
  }
  return result;
}
/** One transactional snapshot. Explicit platform bounds; never silently drop historical rows. */
async function snapshot(ctx: MutationCtx, tenantId: Id<"tenants">) {
  const records: Record<string, unknown> = {
    company: await ctx.db.get(tenantId),
    capturedAt: Date.now(),
    contractVersion: 1,
  };
  records.parties = await rows(
    ctx.db
      .query("portfolioParties")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId)),
  );
  records.units = await rows(
    ctx.db
      .query("portfolioUnits")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId)),
  );
  records.properties = await rows(
    ctx.db
      .query("properties")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId)),
  );
  records.leases = await rows(
    ctx.db
      .query("leases")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId)),
  );
  records.applications = await rows(
    ctx.db
      .query("signingApplications")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId)),
  );
  records.payments = await rows(
    ctx.db
      .query("signingPayments")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId)),
  );
  records.effects = await rows(
    ctx.db
      .query("signingEffects")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId)),
  );
  const effectActions = [];
  for (const effect of records.effects as Doc<"signingEffects">[]) {
    if (!effect.key.endsWith(":review") && !effect.key.endsWith(":move-in"))
      continue;
    const id = ctx.db.normalizeId("actions", effect.resultId);
    if (id) {
      const action = await ctx.db.get(id);
      if (action && action.tenantId === tenantId) effectActions.push(action);
    }
  }
  records.actions = effectActions;
  records.policy = await ctx.db
    .query("signingPolicies")
    .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
    .unique();
  records.leaseClauses = await Promise.all(
    (records.leases as Doc<"leases">[]).map(async (lease) => ({
      leaseId: lease._id,
      clauses: await rows(
        ctx.db
          .query("leaseClauses")
          .withIndex("by_leaseId", (q) => q.eq("leaseId", lease._id)),
      ),
    })),
  );
  const agreements = await rows(
    ctx.db
      .query("signingAgreements")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId)),
  );
  const artifacts: Artifact[] = [],
    unavailable: { agreementId: string; fileId: string; reason: string }[] = [];
  records.agreements = await Promise.all(
    agreements.map(async (a) => {
      const revisions = await rows(
        ctx.db
          .query("signingRevisions")
          .withIndex("by_agreementId_and_revision", (q) =>
            q.eq("agreementId", a._id),
          ),
      );
      const history = [];
      const sourceIds = new Set<string>();
      for (const revision of revisions) {
        const participants = await rows(
          ctx.db
            .query("signingParticipants")
            .withIndex("by_revisionId", (q) =>
              q.eq("revisionId", revision._id),
            ),
        );
        const bundles = await rows(
          ctx.db
            .query("signingBundles")
            .withIndex("by_revisionId", (q) =>
              q.eq("revisionId", revision._id),
            ),
        );
        for (const bundle of bundles) {
          if (
            !bundle.attemptId ||
            !bundle.manifestVersion ||
            !bundle.manifestHash
          )
            throw new ConvexError(
              "Historical bundle lacks pinned export evidence",
            );
          artifacts.push({
            agreementId: a._id,
            kind: "bundle",
            id: bundle.attemptId,
            version: bundle.storageVersion,
            sha256: bundle.pdfHash,
          });
          artifacts.push({
            agreementId: a._id,
            kind: "manifest",
            id: bundle.attemptId,
            version: bundle.manifestVersion,
            sha256: bundle.manifestHash,
          });
          for (const source of bundle.sources ?? []) {
            if (!sourceIds.has(`${source.uploadId}:${source.sourceVersion}`)) {
              artifacts.push({
                agreementId: a._id,
                kind: "source",
                id: source.uploadId,
                version: source.sourceVersion,
                sha256: source.sha256,
              });
              sourceIds.add(`${source.uploadId}:${source.sourceVersion}`);
            }
          }
        }
        history.push({ revision, participants, bundles });
      }
      const files = await rows(
        ctx.db
          .query("signingFiles")
          .withIndex("by_agreementId_and_active", (q) =>
            q.eq("agreementId", a._id),
          ),
      );
      for (const file of files)
        if (!sourceIds.has(`${file.uploadId}:${file.sourceVersion}`))
          unavailable.push({
            agreementId: a._id,
            fileId: file._id,
            reason:
              "No validated retained source; unscanned quarantine excluded",
          });
      const attachments = await rows(
        ctx.db
          .query("signingAttachments")
          .withIndex("by_agreementId", (q) => q.eq("agreementId", a._id)),
      );
      for (const file of attachments)
        if (file.status === "clean" && file.storageVersion && file.sha256)
          artifacts.push({
            agreementId: a._id,
            kind: "attachment",
            id: file._id,
            version: file.storageVersion,
            sha256: file.sha256,
            contentType: file.contentType,
          });
      const completions = await rows(
        ctx.db
          .query("signingCompletions")
          .withIndex("by_agreementId", (q) => q.eq("agreementId", a._id)),
      );
      for (const c of completions)
        for (const kind of ["pdf", "evidence", "record"] as const)
          artifacts.push({
            agreementId: a._id,
            kind,
            id: c.finalisationId,
            version: c[`${kind}Version`],
            sha256: c[`${kind}Hash`],
          });
      const events = await rows(
        ctx.db
          .query("signingEvents")
          .withIndex("by_agreementId_and_sequence", (q) =>
            q.eq("agreementId", a._id),
          ),
      );
      const layouts = await rows(
        ctx.db
          .query("signingLayouts")
          .withIndex("by_agreementId", (q) => q.eq("agreementId", a._id)),
      );
      const preparations = await rows(
        ctx.db
          .query("signingFrozenPreparations")
          .withIndex("by_agreementId", (q) => q.eq("agreementId", a._id)),
      );
      const approvals = await rows(
        ctx.db
          .query("signingApprovals")
          .withIndex("by_agreementId", (q) => q.eq("agreementId", a._id)),
      );
      const approvalDecisions = await Promise.all(
        approvals.map(async (approval) => ({
          approvalId: approval._id,
          decisions: await rows(
            ctx.db
              .query("signingApprovalDecisions")
              .withIndex("by_approvalId", (q) =>
                q.eq("approvalId", approval._id),
              ),
          ),
        })),
      );
      const generations = await rows(
        ctx.db
          .query("signingGenerations")
          .withIndex("by_agreementId", (q) => q.eq("agreementId", a._id)),
      );
      const checkpoints = await rows(
        ctx.db
          .query("signingCheckpoints")
          .withIndex("by_agreementId_and_sequence", (q) =>
            q.eq("agreementId", a._id),
          ),
      );
      const holds = await rows(
        ctx.db
          .query("signingLegalHolds")
          .withIndex("by_agreementId", (q) => q.eq("agreementId", a._id)),
      );
      const application = await ctx.db
        .query("signingApplications")
        .withIndex("by_agreementId", (q) => q.eq("agreementId", a._id))
        .unique();
      const decisions = application
        ? await rows(
            ctx.db
              .query("signingLeaseDecisions")
              .withIndex("by_leaseId", (q) =>
                q.eq("leaseId", application.leaseId),
              ),
          )
        : [];
      const tx = a.signingTransactionId
        ? await ctx.db.get(a.signingTransactionId)
        : null;
      const frozen = tx ? await ctx.db.get(tx.frozenPreparationId) : null;
      // Frozen preparations/submissions contain evidence, not access-session credentials.
      const submissions = tx
        ? await rows(
            ctx.db
              .query("signingSubmissions")
              .withIndex("by_transactionId", (q) =>
                q.eq("transactionId", tx._id),
              ),
          )
        : [];
      const acceptedMarks = [];
      for (const submission of submissions) {
        const evidence = JSON.parse(submission.evidence) as {
          marks?: { hash: string }[];
        };
        for (const mark of evidence.marks ?? []) {
          const stored = (
            await rows(
              ctx.db
                .query("signingMarks")
                .withIndex("by_invitationId_and_imageHash", (q) =>
                  q
                    .eq("invitationId", submission.invitationId)
                    .eq("imageHash", mark.hash),
                ),
            )
          ).find(
            (m) =>
              m.invitationVersion === submission.invitationVersion &&
              m.transactionId === submission.transactionId &&
              m.participantKey === submission.participantKey,
          );
          if (stored) {
            if (
              (await sha256Text(`${stored.kind}:${stored.png}`)) !== mark.hash
            )
              throw new ConvexError(
                "Accepted signature image failed its integrity check",
              );
            acceptedMarks.push(stored);
          } else if (!a.transientPurgedAt)
            throw new ConvexError(
              "Accepted signature mark is missing from retained evidence",
            );
          else
            unavailable.push({
              agreementId: a._id,
              fileId: mark.hash,
              reason:
                "Transient signature image purged under retention; completed PDF/evidence retained",
            });
        }
      }
      const invites = tx
        ? await rows(
            ctx.db
              .query("signingInvitations")
              .withIndex("by_transactionId", (q) =>
                q.eq("transactionId", tx._id),
              ),
          )
        : [];
      const delivery = [];
      for (const invite of invites) {
        const deliveries = await rows(
          ctx.db
            .query("signingDeliveries")
            .withIndex("by_invitationId", (q) =>
              q.eq("invitationId", invite._id),
            ),
        );
        delivery.push({
          participantKey: invite.participantKey,
          status: invite.status,
          verifiedAt: invite.verifiedAt,
          completedAt: invite.completedAt,
          deliveries: deliveries.map((d) => ({
            id: d._id,
            kind: d.kind,
            status: d.status,
            createdAt: d.createdAt,
            acceptedAt: d.acceptedAt,
            deliveredAt: d.deliveredAt,
            failedAt: d.failedAt,
            bouncedAt: d.bouncedAt,
            complainedAt: d.complainedAt,
          })),
        });
      }
      return {
        agreement: a,
        transaction: tx
          ? {
              id: tx._id,
              reference: tx.reference,
              status: tx.status,
              createdAt: tx.createdAt,
              expiresAt: tx.expiresAt,
              currentStage: tx.currentStage,
              preparationHash: tx.preparationHash,
            }
          : null,
        history,
        files,
        attachments,
        completions,
        events,
        decisions,
        frozen,
        submissions,
        acceptedMarks,
        delivery,
        layouts,
        preparations,
        approvals,
        approvalDecisions,
        generations,
        checkpoints,
        holds,
      };
    }),
  );
  records.templates = await rows(
    ctx.db
      .query("signingTemplates")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId)),
  );
  records.clauses = await rows(
    ctx.db
      .query("signingClauses")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId)),
  );
  records.templateVersions = await Promise.all(
    (records.templates as Doc<"signingTemplates">[]).map(async (template) => ({
      templateId: template._id,
      versions: await rows(
        ctx.db
          .query("signingTemplateVersions")
          .withIndex("by_templateId_and_version", (q) =>
            q.eq("templateId", template._id),
          ),
      ),
    })),
  );
  records.clauseVersions = await Promise.all(
    (records.clauses as Doc<"signingClauses">[]).map(async (clause) => ({
      clauseId: clause._id,
      versions: await rows(
        ctx.db
          .query("signingClauseVersions")
          .withIndex("by_clauseId_and_version", (q) =>
            q.eq("clauseId", clause._id),
          ),
      ),
    })),
  );
  const result = { records, artifacts, unavailable };
  if (new TextEncoder().encode(canonicalJson(result)).length > 700_000)
    throw new ConvexError(
      "Export metadata exceeds the 700 KB snapshot limit; no partial export created",
    );
  return result;
}
export const request = mutation({
  args: {
    tenantId: v.id("tenants"),
    requestId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireSigningWriter(ctx, args.tenantId);
    const reason = boundedText(args.reason, "Export reason", 1000),
      requestId = boundedText(args.requestId, "Request ID", 128);
    const prior = await ctx.db
      .query("signingExports")
      .withIndex("by_tenantId_and_requestId", (q) =>
        q.eq("tenantId", args.tenantId).eq("requestId", requestId),
      )
      .unique();
    if (prior) {
      if (prior.reason !== reason || prior.createdBy !== user._id)
        throw new ConvexError("Request ID already used");
      return prior._id;
    }
    if (!documentsConfigured("export"))
      throw new ConvexError("Private export service is not configured");
    const data = await snapshot(ctx, args.tenantId),
      encoded = canonicalJson(data);
    const id = await ctx.db.insert("signingExports", {
      tenantId: args.tenantId,
      requestId,
      reason,
      createdBy: user._id,
      createdAt: Date.now(),
      snapshot: encoded,
      snapshotHash: await signingHash(data),
      jobId: crypto.randomUUID(),
      checks: 0,
      status: "queued",
    });
    await appendAuditEvent(ctx, {
      tenantId: args.tenantId,
      eventType: "signing.export_requested",
      actorType: "staff_user",
      actorId: user._id,
      targetType: "signing_export",
      targetId: id,
      correlationId: `export:${id}`,
      sourceSystem: "convex",
      occurredAt: Date.now(),
      reason,
    });
    await ctx.scheduler.runAfter(0, internal.signingExports.submit, {
      exportId: id,
    });
    return id;
  },
});
export const list = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireSigningReader(ctx, args.tenantId);
    const data = await ctx.db
      .query("signingExports")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(30);
    return data.map((e) => ({
      id: e._id,
      status: e.status,
      createdAt: e.createdAt,
      error: e.error,
      snapshotHash: e.snapshotHash,
    }));
  },
});
export const context = internalQuery({
  args: { exportId: v.id("signingExports") },
  handler: async (ctx, args) => await ctx.db.get(args.exportId),
});
export const claim = internalMutation({
  args: { exportId: v.id("signingExports") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.exportId);
    if (!row || row.status !== "queued") return null;
    await ctx.db.patch(row._id, { status: "unknown" });
    await ctx.scheduler.runAfter(15000, internal.signingExports.poll, {
      exportId: row._id,
    });
    return row;
  },
});
export const mark = internalMutation({
  args: {
    exportId: v.id("signingExports"),
    jobId: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("unknown"),
      v.literal("failed"),
      v.literal("ready"),
    ),
    volumes: v.optional(v.string()),
    error: v.optional(v.string()),
    schedule: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.exportId);
    if (
      !row ||
      row.jobId !== args.jobId ||
      ["ready", "failed"].includes(row.status)
    )
      return;
    if (args.status === "ready") {
      const volumes = JSON.parse(args.volumes ?? "[]") as {
        part: number;
        sha256: string;
        version: string;
        sizeBytes: number;
      }[];
      if (
        !volumes.length ||
        volumes.length > 100 ||
        volumes.some(
          (p, i) =>
            p.part !== i ||
            !/^[a-f0-9]{64}$/.test(p.sha256) ||
            typeof p.version !== "string" ||
            !p.version ||
            p.version === "null" ||
            !Number.isSafeInteger(p.sizeBytes) ||
            p.sizeBytes <= 0 ||
            p.sizeBytes > 55 * 1024 * 1024,
        )
      )
        throw new ConvexError("Invalid export receipt");
    }
    await ctx.db.patch(row._id, {
      status: args.status,
      checks: row.checks + 1,
      ...(args.volumes ? { volumes: args.volumes } : {}),
      ...(args.error ? { error: args.error } : {}),
    });
    if (
      args.schedule !== false &&
      ["running", "unknown"].includes(args.status) &&
      row.checks < 59
    )
      await ctx.scheduler.runAfter(15_000, internal.signingExports.poll, {
        exportId: row._id,
      });
  },
});
export const submit = internalAction({
  args: { exportId: v.id("signingExports") },
  handler: async (ctx, args) => {
    const row: Doc<"signingExports"> | null = await ctx.runMutation(
      internal.signingExports.claim,
      args,
    );
    if (!row) return;
    // Reserve ownership in Convex before the network call; an ambiguous POST is never repeated.
    try {
      const id = await workerRequest(
        `/run/p/${SCRIPT}?job_id=${encodeURIComponent(row.jobId)}`,
        {
          operation: "build",
          tenant_id: row.tenantId,
          export_id: row._id,
          snapshot_hash: row.snapshotHash,
          payload: JSON.parse(row.snapshot),
        },
        "export",
      );
      if (id !== row.jobId) throw new Error("Unconfirmed job");
      await ctx.runMutation(internal.signingExports.mark, {
        ...args,
        jobId: row.jobId,
        status: "running",
        schedule: false,
      });
    } catch {
      /* Already unknown and scheduled for read-only reconciliation. */
    }
  },
});
export const poll = internalAction({
  args: { exportId: v.id("signingExports") },
  handler: async (ctx, args) => {
    const row: Doc<"signingExports"> | null = await ctx.runQuery(
      internal.signingExports.context,
      args,
    );
    if (!row || !["running", "unknown"].includes(row.status)) return;
    try {
      const job = (await workerRequest(
        `/get/${encodeURIComponent(row.jobId)}`,
        undefined,
        "export",
      )) as {
        id: string;
        script_path: string;
        args: {
          operation: string;
          tenant_id: string;
          export_id: string;
          snapshot_hash: string;
        };
        success?: boolean;
        result?: { status: string; snapshotHash: string; volumes: unknown };
      };
      if (
        job.id !== row.jobId ||
        job.script_path !== SCRIPT ||
        job.args?.operation !== "build" ||
        job.args.tenant_id !== row.tenantId ||
        job.args.export_id !== row._id ||
        job.args.snapshot_hash !== row.snapshotHash
      )
        throw new Error("Ownership mismatch");
      if (typeof job.success === "boolean") {
        const ok =
          job.success &&
          job.result?.status === "ready" &&
          job.result.snapshotHash === row.snapshotHash;
        await ctx.runMutation(internal.signingExports.mark, {
          ...args,
          jobId: row.jobId,
          status: ok ? "ready" : "failed",
          ...(ok
            ? { volumes: canonicalJson(job.result!.volumes) }
            : { error: "export_failed" }),
        });
        return;
      }
    } catch {
      /* Unknown remains owned by this job. */
    }
    await ctx.runMutation(internal.signingExports.mark, {
      ...args,
      jobId: row.jobId,
      status: "unknown",
    });
  },
});
export const reconcile = mutation({
  args: { exportId: v.id("signingExports") },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const row = await ctx.db.get(args.exportId);
    if (!row) throw new ConvexError("Export not found");
    await requireSigningWriter(ctx, row.tenantId);
    if (!["running", "unknown"].includes(row.status) || row.checks < 60)
      throw new ConvexError("Export is already being checked or has finished");
    await ctx.scheduler.runAfter(0, internal.signingExports.poll, args);
  },
});
export const downloadContext = internalMutation({
  args: { exportId: v.id("signingExports") },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const row = await ctx.db.get(args.exportId);
    if (!row) throw new ConvexError("Export not found");
    const user = await requireSigningWriter(ctx, row.tenantId);
    if (row.status !== "ready") throw new ConvexError("Export is not ready");
    await appendAuditEvent(ctx, {
      tenantId: row.tenantId,
      eventType: "signing.export_download",
      actorType: "staff_user",
      actorId: user._id,
      targetType: "signing_export",
      targetId: row._id,
      correlationId: `export:${row._id}`,
      sourceSystem: "convex",
      occurredAt: Date.now(),
    });
    return row;
  },
});
export const download = action({
  args: { exportId: v.id("signingExports") },
  handler: async (
    ctx,
    args,
  ): Promise<
    { part: number; url: string; sha256: string; sizeBytes: number }[]
  > => {
    const row: Doc<"signingExports"> = await ctx.runMutation(
      internal.signingExports.downloadContext,
      args,
    );
    const result = (await workerRequest(
      `/run_wait_result/p/${SCRIPT}`,
      {
        operation: "download",
        tenant_id: row.tenantId,
        export_id: row._id,
        snapshot_hash: row.snapshotHash,
        payload: { volumes: JSON.parse(row.volumes!) },
      },
      "export",
    )) as {
      status: string;
      expiresAt: number;
      volumes: {
        part: number;
        url: string;
        sha256: string;
        sizeBytes: number;
      }[];
    };
    const expected = JSON.parse(row.volumes!) as {
      part: number;
      sha256: string;
      sizeBytes: number;
    }[];
    if (
      result.status !== "download" ||
      typeof result.expiresAt !== "number" ||
      !Number.isFinite(result.expiresAt) ||
      !Array.isArray(result.volumes) ||
      result.expiresAt <= Date.now() ||
      result.expiresAt > Date.now() + 65_000 ||
      result.volumes.length !== expected.length ||
      result.volumes.some(
        (v, i) =>
          v.part !== expected[i].part ||
          v.sha256 !== expected[i].sha256 ||
          v.sizeBytes !== expected[i].sizeBytes,
      )
    )
      throw new ConvexError("Export download verification failed");
    return result.volumes.map((p) => ({ ...p, url: secureUrl(p.url) }));
  },
});
