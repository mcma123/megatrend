import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  signingFileAccess,
  assertPreparationIdle,
} from "./lib/signingFileAccess";
import { appendSigningEvent } from "./lib/signingAudit";
import { canonicalJson, signingHash } from "./lib/signing";
import {
  ACTIVE_PREPARATION,
  bundleResultSchema,
  MAX_SIGNING_FILES,
  MAX_SIGNING_INPUT_BYTES,
  preparationError,
  preparationErrors,
  preparedPrefix,
  type BundleResult,
  type PreparationError,
  type PreparedInputFile,
} from "./lib/signingPreparation";
import {
  documentsConfigured,
  workerBase,
  workerRequest,
} from "./lib/signingWorker";

export async function validatePreparedResult(
  attempt: Doc<"signingPreparations">,
  value: unknown,
): Promise<BundleResult> {
  const result = bundleResultSchema.parse(value);
  const manifest = result.manifest;
  const snapshot = JSON.parse(attempt.snapshot) as {
    files: PreparedInputFile[];
  };
  if ((await signingHash(snapshot)) !== attempt.inputDigest)
    throw new Error("Preparation snapshot was modified");
  const prefix = preparedPrefix(
    attempt.tenantId,
    attempt.agreementId,
    attempt._id,
  );
  if (
    manifest.tenantId !== attempt.tenantId ||
    manifest.agreementId !== attempt.agreementId ||
    manifest.attemptId !== attempt._id ||
    manifest.inputDigest !== attempt.inputDigest ||
    result.manifestHash !== (await signingHash(manifest)) ||
    result.artifactKey !== `${prefix}/bundle.pdf` ||
    result.manifestKey !== `${prefix}/manifest.json` ||
    result.retainUntil <= Date.now() ||
    manifest.sources.length !== snapshot.files.length
  )
    throw new Error("Prepared bundle identity mismatch");
  let offset = 0;
  for (const [index, source] of manifest.sources.entries()) {
    const expected = snapshot.files[index];
    if (
      !expected ||
      source.fileId !== expected.fileId ||
      source.uploadId !== expected.uploadId ||
      source.role !== expected.role ||
      source.sourceVersion !== expected.sourceVersion ||
      source.sizeBytes !== expected.sizeBytes ||
      source.pageStartIndex !== offset ||
      source.scannedAt > Date.now() + 60_000 ||
      source.scannedAt < attempt.createdAt - 60_000
    )
      throw new Error("Prepared source mismatch");
    for (let i = 0; i < source.pageCount; i++) {
      const page = manifest.pages[offset + i];
      if (
        !page ||
        page.pageIndex !== offset + i ||
        page.sourceFileId !== source.fileId ||
        page.sourcePageIndex !== i ||
        page.cropBox[0] < page.mediaBox[0] ||
        page.cropBox[1] < page.mediaBox[1] ||
        page.cropBox[2] > page.mediaBox[2] ||
        page.cropBox[3] > page.mediaBox[3] ||
        Math.abs(
          page.widthPt - (page.cropBox[2] - page.cropBox[0]) * page.userUnit,
        ) > 0.001 ||
        Math.abs(
          page.heightPt - (page.cropBox[3] - page.cropBox[1]) * page.userUnit,
        ) > 0.001
      )
        throw new Error("Prepared page mismatch");
    }
    offset += source.pageCount;
  }
  if (
    offset !== manifest.pages.length ||
    manifest.outputScan.scannedAt > Date.now() + 60_000 ||
    manifest.outputScan.scannedAt < attempt.createdAt - 60_000
  )
    throw new Error("Prepared output mismatch");
  return result;
}

export const request = mutation({
  args: {
    agreementId: v.id("signingAgreements"),
    expectedRevision: v.number(),
    expectedFileRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const { agreement, user } = await signingFileAccess(
      ctx,
      args.agreementId,
      true,
    );
    await assertPreparationIdle(ctx, agreement);
    if (!documentsConfigured())
      throw new ConvexError(
        "Configure private PDF storage and scanning before preparing documents",
      );
    if (
      agreement.revision !== args.expectedRevision ||
      (agreement.fileRevision ?? 0) !== args.expectedFileRevision ||
      !agreement.currentRevisionId
    )
      throw new ConvexError("Draft or files changed. Reload before preparing");
    const files = (
      await ctx.db
        .query("signingFiles")
        .withIndex("by_agreementId_and_active", (q) =>
          q.eq("agreementId", agreement._id).eq("active", true),
        )
        .collect()
    ).sort((a, b) => a.position - b.position);
    if (
      !files.length ||
      files.length > MAX_SIGNING_FILES ||
      files[0].role !== "primary" ||
      files.filter((f) => f.role === "primary").length !== 1 ||
      files.reduce((sum, f) => sum + f.sizeBytes, 0) > MAX_SIGNING_INPUT_BYTES
    )
      throw new ConvexError(
        "Add one primary PDF and ordered annexures, up to 75 MB total",
      );
    const revision = await ctx.db.get(agreement.currentRevisionId);
    if (!revision) throw new ConvexError("Draft revision not found");
    const selected = files.map((f) => ({
      fileId: f._id,
      uploadId: f.uploadId,
      sourceVersion: f.sourceVersion,
      sizeBytes: f.sizeBytes,
      role: f.role,
    }));
    const snapshot = {
      contractVersion: 1,
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      revisionId: revision._id,
      contentHash: revision.contentHash,
      fileRevision: args.expectedFileRevision,
      files: selected,
      filenames: files.map((f) => f.filename),
    };
    const attemptId = await ctx.db.insert("signingPreparations", {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      revisionId: revision._id,
      fileRevision: args.expectedFileRevision,
      inputDigest: await signingHash(snapshot),
      snapshot: canonicalJson(snapshot),
      status: "queued",
      createdAt: Date.now(),
      createdBy: user._id,
      checks: 0,
    });
    await ctx.db.patch(agreement._id, {
      bundleAttemptId: attemptId,
      currentBundleId: undefined,
      currentLayoutId: undefined,
      frozenPreparationId: undefined,
    });
    await appendSigningEvent(
      ctx,
      agreement,
      user._id,
      "pdf_preparation_requested",
      {
        attemptId,
        fileRevision: args.expectedFileRevision,
        fileIds: files.map((f) => f._id),
      },
    );
    await ctx.scheduler.runAfter(0, internal.signingPreparations.submit, {
      attemptId,
    });
    return attemptId;
  },
});

export const context = internalQuery({
  args: { attemptId: v.id("signingPreparations") },
  handler: async (ctx, args) => await ctx.db.get(args.attemptId),
});
export const claim = internalMutation({
  args: { attemptId: v.id("signingPreparations"), jobId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attemptId);
    if (!row || row.status !== "queued") return null;
    // Reserve the remote job ID and a recovery poll before making a network request.
    await ctx.db.patch(row._id, { status: "submitting", jobId: args.jobId });
    await ctx.scheduler.runAfter(15_000, internal.signingPreparations.poll, {
      attemptId: row._id,
    });
    return row;
  },
});
export const mark = internalMutation({
  args: {
    attemptId: v.id("signingPreparations"),
    jobId: v.string(),
    state: v.union(v.literal("running"), v.literal("submission_unknown")),
    countCheck: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attemptId);
    if (!row || row.jobId !== args.jobId || !ACTIVE_PREPARATION.has(row.status))
      return null;
    const checks = row.checks + (args.countCheck ? 1 : 0);
    await ctx.db.patch(row._id, {
      status: args.state,
      checks,
      waitingTimedOut: Date.now() - row.createdAt > 300_000,
    });
    // No new owner is allowed while submission is ambiguous. Stop automatic polling after ~1 hour.
    if (args.countCheck && checks < 120)
      await ctx.scheduler.runAfter(
        checks < 30 ? 10_000 : 30_000,
        internal.signingPreparations.poll,
        { attemptId: row._id },
      );
    return null;
  },
});
export const finish = internalMutation({
  args: {
    attemptId: v.id("signingPreparations"),
    jobId: v.string(),
    error: v.optional(preparationError),
    result: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attemptId);
    if (!row || row.jobId !== args.jobId || !ACTIVE_PREPARATION.has(row.status))
      return null;
    const agreement = await ctx.db.get(row.agreementId);
    if (
      !agreement ||
      agreement.bundleAttemptId !== row._id ||
      agreement.currentRevisionId !== row.revisionId ||
      (agreement.fileRevision ?? 0) !== row.fileRevision ||
      agreement.status !== "draft"
    ) {
      await ctx.db.patch(row._id, { status: "superseded" });
      return null;
    }
    let result: BundleResult | undefined;
    let error = args.error;
    if (!error) {
      try {
        result = await validatePreparedResult(row, args.result);
      } catch {
        error = "result_invalid";
      }
    }
    if (error || !result) {
      await ctx.db.patch(row._id, {
        status: "failed",
        error: error ?? "result_invalid",
      });
      await appendSigningEvent(
        ctx,
        agreement,
        row.createdBy,
        "pdf_preparation_blocked",
        { attemptId: row._id, error: error ?? "result_invalid" },
      );
      return null;
    }
    const m = result.manifest;
    const bundleId = await ctx.db.insert("signingBundles", {
      tenantId: row.tenantId,
      agreementId: row.agreementId,
      revisionId: row.revisionId,
      manifestHash: result.manifestHash,
      pdfHash: m.pdfHash,
      artifactKey: result.artifactKey,
      storageVersion: result.storageVersion,
      validatedAt: Date.now(),
      scanReference: `${m.outputScan.version};${m.outputScan.scannedAt}`,
      rendererVersion: m.rendererVersion,
      attemptId: row._id,
      fileRevision: row.fileRevision,
      inputDigest: row.inputDigest,
      manifestKey: result.manifestKey,
      manifestVersion: result.manifestVersion,
      retainUntil: result.retainUntil,
      sizeBytes: m.sizeBytes,
      pages: m.pages,
      sources: m.sources,
    });
    await ctx.db.patch(row._id, { status: "ready", bundleId });
    await ctx.db.patch(agreement._id, {
      currentBundleId: bundleId,
      updatedAt: Date.now(),
    });
    await appendSigningEvent(
      ctx,
      agreement,
      row.createdBy,
      "pdf_bundle_prepared",
      {
        attemptId: row._id,
        bundleId,
        pdfHash: m.pdfHash,
        manifestHash: result.manifestHash,
        fileRevision: row.fileRevision,
        pageCount: m.pages.length,
      },
    );
    return bundleId;
  },
});

export const submit = internalAction({
  args: { attemptId: v.id("signingPreparations") },
  handler: async (ctx, args): Promise<null> => {
    const jobId = crypto.randomUUID();
    const row: Doc<"signingPreparations"> | null = await ctx.runMutation(
      internal.signingPreparations.claim,
      { ...args, jobId },
    );
    if (!row) return null;
    try {
      workerBase();
    } catch {
      await ctx.runMutation(internal.signingPreparations.finish, {
        ...args,
        jobId,
        error: "not_configured",
      });
      return null;
    }
    const snapshot = JSON.parse(row.snapshot) as { files: PreparedInputFile[] };
    try {
      const response = await workerRequest(
        `/run/p/f/signing/prepare_bundle?job_id=${encodeURIComponent(jobId)}`,
        {
          operation: "prepare",
          tenant_id: row.tenantId,
          agreement_id: row.agreementId,
          payload: {
            attemptId: row._id,
            inputDigest: row.inputDigest,
            files: snapshot.files,
          },
        },
      );
      if (response !== jobId) throw new Error("Unconfirmed job identity");
      await ctx.runMutation(internal.signingPreparations.mark, {
        ...args,
        jobId,
        state: "running",
        countCheck: false,
      });
    } catch {
      await ctx.runMutation(internal.signingPreparations.mark, {
        ...args,
        jobId,
        state: "submission_unknown",
        countCheck: false,
      });
    }
    return null;
  },
});
export const poll = internalAction({
  args: { attemptId: v.id("signingPreparations") },
  handler: async (ctx, args): Promise<null> => {
    const row: Doc<"signingPreparations"> | null = await ctx.runQuery(
      internal.signingPreparations.context,
      args,
    );
    if (!row?.jobId || !ACTIVE_PREPARATION.has(row.status)) return null;
    const jobId = row.jobId;
    try {
      const value = await workerRequest(`/get/${encodeURIComponent(jobId)}`);
      if (!value || typeof value !== "object") throw new Error("Invalid job");
      const job = value as Record<string, unknown>;
      const jobArgs = job.args as
        | {
            operation?: string;
            tenant_id?: string;
            agreement_id?: string;
            payload?: { attemptId?: string; inputDigest?: string };
          }
        | undefined;
      if (
        job.id !== jobId ||
        job.script_path !== "f/signing/prepare_bundle" ||
        jobArgs?.operation !== "prepare" ||
        jobArgs.tenant_id !== row.tenantId ||
        jobArgs.agreement_id !== row.agreementId ||
        jobArgs.payload?.attemptId !== row._id ||
        jobArgs.payload.inputDigest !== row.inputDigest
      )
        throw new Error("Job ownership mismatch");
      if (typeof job.success === "boolean") {
        const result = job.result as Record<string, unknown> | undefined;
        const error: PreparationError | undefined = job.success
          ? result?.status === "blocked"
            ? preparationErrors.includes(result.error as PreparationError)
              ? (result.error as PreparationError)
              : "preparation_failed"
            : undefined
          : "preparation_failed";
        await ctx.runMutation(internal.signingPreparations.finish, {
          ...args,
          jobId,
          ...(error ? { error } : { result }),
        });
        return null;
      }
      await ctx.runMutation(internal.signingPreparations.mark, {
        ...args,
        jobId,
        state: "running",
        countCheck: true,
      });
    } catch {
      await ctx.runMutation(internal.signingPreparations.mark, {
        ...args,
        jobId,
        state: "submission_unknown",
        countCheck: true,
      });
    }
    return null;
  },
});
export const reconcile = mutation({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const { agreement } = await signingFileAccess(ctx, args.agreementId, true);
    const row = agreement.bundleAttemptId
      ? await ctx.db.get(agreement.bundleAttemptId)
      : null;
    if (!row || !ACTIVE_PREPARATION.has(row.status))
      throw new ConvexError("No unresolved preparation job");
    if (row.checks < 120 && Date.now() - row.createdAt < 300_000)
      throw new ConvexError(
        "Preparation is already being checked. Please wait",
      );
    await ctx.scheduler.runAfter(
      0,
      row.status === "queued"
        ? internal.signingPreparations.submit
        : internal.signingPreparations.poll,
      { attemptId: row._id },
    );
    return null;
  },
});
