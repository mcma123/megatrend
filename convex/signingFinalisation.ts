import { ConvexError, v } from "convex/values";
import { completionEffects } from "./signingPortfolio";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { appendSigningEvent } from "./lib/signingAudit";
import { assertSigningTransition } from "./lib/signing";
import {
  ACTIVE_FINALISATION,
  FINALISATION_MESSAGES,
  finalisationError,
  finalisationErrors,
  RETRY_DELAYS,
  RETRYABLE,
  startFinalisation,
  validateFinalResult,
  type FinalisationError,
} from "./lib/signingFinalisation";
import {
  finaliseConfigured,
  secureUrl,
  workerBase,
  workerRequest,
} from "./lib/signingWorker";
import { getAgreement, requireSigningWriter } from "./signing";

const SCRIPT = "f/signing/finalise_agreement";

export const context = internalQuery({
  args: { attemptId: v.id("signingFinalisations") },
  handler: async (ctx, args) => await ctx.db.get(args.attemptId),
});
/** Marks referenced by accepted submissions, sent to the worker which re-checks each hash. */
export const markPayload = internalQuery({
  args: { attemptId: v.id("signingFinalisations") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attemptId);
    if (!row) return [];
    const evidence = JSON.parse(row.evidence) as {
      submissions: { submissionId: Id<"signingSubmissions"> }[];
      marks: { hash: string; kind: "signature" | "initials" }[];
    };
    const marks: {
      hash: string;
      kind: "signature" | "initials";
      png: string;
    }[] = [];
    for (const submission of evidence.submissions) {
      const stored = await ctx.db.get(submission.submissionId);
      if (!stored) continue;
      for (const ref of evidence.marks) {
        const mark = await ctx.db
          .query("signingMarks")
          .withIndex("by_invitationId_and_imageHash", (q) =>
            q.eq("invitationId", stored.invitationId).eq("imageHash", ref.hash),
          )
          .first();
        if (
          mark &&
          mark.kind === ref.kind &&
          !marks.some((m) => m.hash === ref.hash)
        )
          marks.push({ hash: mark.imageHash, kind: mark.kind, png: mark.png });
      }
    }
    return marks;
  },
});
export const claim = internalMutation({
  args: { attemptId: v.id("signingFinalisations"), jobId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attemptId);
    if (!row || row.status !== "queued") return null;
    // Reserve the remote job identity and a recovery poll before any network request.
    await ctx.db.patch(row._id, { status: "submitting", jobId: args.jobId });
    await ctx.scheduler.runAfter(20_000, internal.signingFinalisation.poll, {
      attemptId: row._id,
    });
    return row;
  },
});
export const mark = internalMutation({
  args: {
    attemptId: v.id("signingFinalisations"),
    jobId: v.string(),
    state: v.union(v.literal("running"), v.literal("submission_unknown")),
    countCheck: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attemptId);
    if (
      !row ||
      row.jobId !== args.jobId ||
      !ACTIVE_FINALISATION.has(row.status)
    )
      return null;
    const checks = row.checks + (args.countCheck ? 1 : 0);
    await ctx.db.patch(row._id, { status: args.state, checks });
    // Ambiguous jobs keep ownership; automatic checks stop after about an hour.
    if (args.countCheck && checks < 120)
      await ctx.scheduler.runAfter(
        checks < 30 ? 10_000 : 30_000,
        internal.signingFinalisation.poll,
        { attemptId: row._id },
      );
    return null;
  },
});
export const finish = internalMutation({
  args: {
    attemptId: v.id("signingFinalisations"),
    jobId: v.string(),
    error: v.optional(finalisationError),
    result: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attemptId);
    if (
      !row ||
      row.jobId !== args.jobId ||
      !ACTIVE_FINALISATION.has(row.status)
    )
      return null;
    const agreement = await ctx.db.get(row.agreementId);
    // Only the current attempt of a still-finalising agreement may publish.
    if (
      !agreement ||
      agreement.finalisationAttemptId !== row._id ||
      agreement.status !== "finalising" ||
      agreement.completionId
    ) {
      await ctx.db.patch(row._id, { status: "superseded" });
      return null;
    }
    const evidence = JSON.parse(row.evidence) as { pages: unknown[] };
    let error: FinalisationError | undefined = args.error;
    let result;
    if (!error) {
      try {
        result = validateFinalResult(row, args.result, evidence.pages.length);
      } catch {
        error = "result_invalid";
      }
    }
    if (error || !result) {
      const code = error ?? "result_invalid";
      await ctx.db.patch(row._id, { status: "failed", error: code });
      await appendSigningEvent(
        ctx,
        agreement,
        undefined,
        "finalisation_failed",
        {
          attemptId: row._id,
          attempt: row.attempt,
          error: code,
        },
      );
      const delay = RETRY_DELAYS[row.attempt - 1];
      if (RETRYABLE.has(code) && delay !== undefined)
        await ctx.scheduler.runAfter(
          delay,
          internal.signingFinalisation.autoRetry,
          {
            agreementId: agreement._id,
            afterAttemptId: row._id,
          },
        );
      return null;
    }
    const tx = await ctx.db.get(row.transactionId);
    assertSigningTransition(agreement.status, "completed", {
      allSigned: tx?.status === "signed",
      artifactsVerified: true,
    });
    const now = Date.now();
    const completionId = await ctx.db.insert("signingCompletions", {
      tenantId: row.tenantId,
      agreementId: row.agreementId,
      transactionId: row.transactionId,
      finalisationId: row._id,
      evidenceHash: result.evidenceHash,
      evidenceKey: result.evidenceKey,
      evidenceVersion: result.evidenceVersion,
      pdfKey: result.pdfKey,
      pdfVersion: result.pdfVersion,
      pdfHash: result.pdfHash,
      sizeBytes: result.sizeBytes,
      pageCount: result.pageCount,
      certificatePageCount: result.certificatePageCount,
      recordKey: result.recordKey,
      recordVersion: result.recordVersion,
      recordHash: result.recordHash,
      retainUntil: result.retainUntil,
      validation: JSON.stringify(result.validation),
      sealedAt: result.sealedAt,
      completedAt: now,
    });
    await ctx.db.patch(row._id, { status: "completed", completionId });
    await ctx.db.patch(row.transactionId, { status: "completed" });
    await ctx.db.patch(agreement._id, {
      status: "completed",
      completionId,
      updatedAt: now,
    });
    await appendSigningEvent(ctx, agreement, undefined, "agreement_completed", {
      attemptId: row._id,
      completionId,
      pdfHash: result.pdfHash,
      evidenceHash: result.evidenceHash,
      recordHash: result.recordHash,
      sealedAt: result.sealedAt,
      signerCertificateSha256: result.validation.signerCertificateSha256,
    });
    await completionEffects(ctx, agreement, completionId);
    return completionId;
  },
});

export const submit = internalAction({
  args: { attemptId: v.id("signingFinalisations") },
  handler: async (ctx, args): Promise<null> => {
    const jobId = crypto.randomUUID();
    const row: Doc<"signingFinalisations"> | null = await ctx.runMutation(
      internal.signingFinalisation.claim,
      { ...args, jobId },
    );
    if (!row) return null;
    try {
      workerBase("finalise");
    } catch {
      await ctx.runMutation(internal.signingFinalisation.finish, {
        ...args,
        jobId,
        error: "not_configured",
      });
      return null;
    }
    const marks: { hash: string; kind: string; png: string }[] =
      await ctx.runQuery(internal.signingFinalisation.markPayload, args);
    try {
      const response = await workerRequest(
        `/run/p/${SCRIPT}?job_id=${encodeURIComponent(jobId)}`,
        {
          operation: "finalise",
          tenant_id: row.tenantId,
          agreement_id: row.agreementId,
          payload: {
            attemptId: row._id,
            inputDigest: row.inputDigest,
            evidence: JSON.parse(row.evidence),
            marks,
          },
        },
        "finalise",
      );
      if (response !== jobId) throw new Error("Unconfirmed job identity");
      await ctx.runMutation(internal.signingFinalisation.mark, {
        ...args,
        jobId,
        state: "running",
        countCheck: false,
      });
    } catch {
      await ctx.runMutation(internal.signingFinalisation.mark, {
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
  args: { attemptId: v.id("signingFinalisations") },
  handler: async (ctx, args): Promise<null> => {
    const row: Doc<"signingFinalisations"> | null = await ctx.runQuery(
      internal.signingFinalisation.context,
      args,
    );
    if (!row?.jobId || !ACTIVE_FINALISATION.has(row.status)) return null;
    const jobId = row.jobId;
    try {
      const value = await workerRequest(
        `/get/${encodeURIComponent(jobId)}`,
        undefined,
        "finalise",
      );
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
        job.script_path !== SCRIPT ||
        jobArgs?.operation !== "finalise" ||
        jobArgs.tenant_id !== row.tenantId ||
        jobArgs.agreement_id !== row.agreementId ||
        jobArgs.payload?.attemptId !== row._id ||
        jobArgs.payload.inputDigest !== row.inputDigest
      )
        throw new Error("Job ownership mismatch");
      if (typeof job.success === "boolean") {
        const result = job.result as Record<string, unknown> | undefined;
        const error: FinalisationError | undefined = job.success
          ? result?.status === "blocked"
            ? finalisationErrors.includes(result.error as FinalisationError)
              ? (result.error as FinalisationError)
              : "finalisation_failed"
            : undefined
          : "finalisation_failed";
        await ctx.runMutation(internal.signingFinalisation.finish, {
          ...args,
          jobId,
          ...(error ? { error } : { result }),
        });
        return null;
      }
      await ctx.runMutation(internal.signingFinalisation.mark, {
        ...args,
        jobId,
        state: "running",
        countCheck: true,
      });
    } catch {
      await ctx.runMutation(internal.signingFinalisation.mark, {
        ...args,
        jobId,
        state: "submission_unknown",
        countCheck: true,
      });
    }
    return null;
  },
});

/** Called when the last stage completes; failures leave the agreement Finalising for staff. */
export const begin = internalMutation({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    try {
      await startFinalisation(ctx, args.agreementId);
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
    }
    return null;
  },
});
export const autoRetry = internalMutation({
  args: {
    agreementId: v.id("signingAgreements"),
    afterAttemptId: v.id("signingFinalisations"),
  },
  handler: async (ctx, args) => {
    const agreement = await ctx.db.get(args.agreementId);
    const prior = await ctx.db.get(args.afterAttemptId);
    if (
      !agreement ||
      agreement.status !== "finalising" ||
      agreement.finalisationAttemptId !== args.afterAttemptId ||
      prior?.status !== "failed"
    )
      return null;
    await startFinalisation(ctx, agreement._id);
    return null;
  },
});

export const status = query({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const attempts = await ctx.db
      .query("signingFinalisations")
      .withIndex("by_agreementId", (q) => q.eq("agreementId", agreement._id))
      .order("desc")
      .take(10);
    const completion = agreement.completionId
      ? await ctx.db.get(agreement.completionId)
      : null;
    const current = attempts.find(
      (a) => a._id === agreement.finalisationAttemptId,
    );
    return {
      agreementStatus: agreement.status,
      configured: finaliseConfigured(),
      canRetry:
        agreement.status === "finalising" &&
        !completion &&
        (!current || current.status === "failed"),
      canReconcile: Boolean(current && ACTIVE_FINALISATION.has(current.status)),
      attempts: attempts.map((a) => ({
        id: a._id,
        attempt: a.attempt,
        status: a.status,
        error: a.error,
        message: a.error ? FINALISATION_MESSAGES[a.error] : null,
        createdAt: a.createdAt,
        checks: a.checks,
        evidenceHash: a.inputDigest,
        automatic: !a.requestedBy,
      })),
      completion: completion
        ? {
            id: completion._id,
            pdfHash: completion.pdfHash,
            evidenceHash: completion.evidenceHash,
            recordHash: completion.recordHash,
            sizeBytes: completion.sizeBytes,
            pageCount: completion.pageCount,
            certificatePageCount: completion.certificatePageCount,
            sealedAt: completion.sealedAt,
            completedAt: completion.completedAt,
            retainUntil: completion.retainUntil,
            validation: JSON.parse(completion.validation) as Record<
              string,
              unknown
            >,
          }
        : null,
    };
  },
});
export const retry = mutation({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const user = await requireSigningWriter(ctx, agreement.tenantId);
    if (!finaliseConfigured())
      throw new ConvexError(FINALISATION_MESSAGES.not_configured);
    return await startFinalisation(ctx, agreement._id, user._id);
  },
});
export const reconcile = mutation({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    await requireSigningWriter(ctx, agreement.tenantId);
    const row = agreement.finalisationAttemptId
      ? await ctx.db.get(agreement.finalisationAttemptId)
      : null;
    if (!row || !ACTIVE_FINALISATION.has(row.status))
      throw new ConvexError("No unresolved finalisation job");
    if (row.checks < 120 && Date.now() - row.createdAt < 300_000)
      throw new ConvexError(
        "Finalisation is already being checked. Please wait",
      );
    // Checks the reserved job only; never submits a second job for the same attempt.
    await ctx.scheduler.runAfter(
      0,
      row.status === "queued"
        ? internal.signingFinalisation.submit
        : internal.signingFinalisation.poll,
      { attemptId: row._id },
    );
    return null;
  },
});

export const completionContext = internalQuery({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const completion = agreement.completionId
      ? await ctx.db.get(agreement.completionId)
      : null;
    if (!completion || agreement.status !== "completed")
      throw new ConvexError(
        "The agreement has no published completed document",
      );
    return completion;
  },
});
export async function completedDownload(completion: Doc<"signingCompletions">) {
  const result = (await workerRequest(
    `/run_wait_result/p/${SCRIPT}`,
    {
      operation: "download",
      tenant_id: completion.tenantId,
      agreement_id: completion.agreementId,
      payload: {
        attemptId: completion.finalisationId,
        pdfVersion: completion.pdfVersion,
        pdfHash: completion.pdfHash,
      },
    },
    "finalise",
  )) as Record<string, unknown>;
  if (
    result?.status !== "download" ||
    typeof result.expiresAt !== "number" ||
    result.expiresAt <= Date.now() ||
    result.expiresAt > Date.now() + 65_000
  )
    throw new ConvexError(
      "The signed document is temporarily unavailable. Retry",
    );
  return {
    url: secureUrl(result.url),
    expiresAt: result.expiresAt,
    pdfHash: completion.pdfHash,
  };
}
/** Company staff download; the browser verifies the SHA-256 before saving. */
export const getSignedUrl = action({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; expiresAt: number; pdfHash: string }> => {
    const completion: Doc<"signingCompletions"> = await ctx.runQuery(
      internal.signingFinalisation.completionContext,
      args,
    );
    return await completedDownload(completion);
  },
});
/** Independent re-check of retained artifacts against the published record. Read-only. */
export const verify = action({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const completion: Doc<"signingCompletions"> = await ctx.runQuery(
      internal.signingFinalisation.completionContext,
      args,
    );
    let report: Record<string, unknown>;
    try {
      report = (await workerRequest(
        `/run_wait_result/p/${SCRIPT}`,
        {
          operation: "verify",
          tenant_id: completion.tenantId,
          agreement_id: completion.agreementId,
          payload: {
            attemptId: completion.finalisationId,
            pdfVersion: completion.pdfVersion,
            pdfHash: completion.pdfHash,
            evidenceVersion: completion.evidenceVersion,
            evidenceHash: completion.evidenceHash,
            recordVersion: completion.recordVersion,
            recordHash: completion.recordHash,
          },
        },
        "finalise",
      )) as Record<string, unknown>;
    } catch {
      throw new ConvexError("Verification service unavailable. Retry later");
    }
    const checks = (report?.checks ?? {}) as Record<string, unknown>;
    const validation = report?.validation as Record<string, unknown> | null;
    const expected = JSON.parse(completion.validation) as Record<
      string,
      unknown
    >;
    const sameSeal =
      validation?.signerCertificateSha256 ===
        expected.signerCertificateSha256 &&
      validation?.timestamp === expected.timestamp;
    const passed =
      report?.status === "verified" &&
      ["recordHash", "pdfHash", "evidenceHash", "binding", "seal"].every(
        (key) => checks[key] === true,
      ) &&
      sameSeal;
    return {
      passed,
      checkedAt: Date.now(),
      checks: {
        recordHash: checks.recordHash === true,
        pdfHash: checks.pdfHash === true,
        evidenceHash: checks.evidenceHash === true,
        binding: checks.binding === true,
        seal: checks.seal === true && sameSeal,
      },
      timestamp:
        typeof validation?.timestamp === "number" ? validation.timestamp : null,
      signerSubject:
        typeof validation?.signerSubject === "string"
          ? validation.signerSubject
          : null,
    };
  },
});
