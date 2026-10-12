import {
  internalAction,
  internalMutation,
  internalQuery,
  MutationCtx,
  QueryCtx,
  mutation,
} from "./_generated/server";
import { env } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { appendAuditEvent } from "./lib/audit";
import { isoDateFromNow, upsertAutoAction } from "./lib/autoActions";
import { notify, staffRecipients, tenantSlug } from "./lib/notifications";
import { requireTenantWriter } from "./lib/auth";
import { processingStageName } from "./validators";
import {
  errorDetails,
  initialStages,
  resultStages,
  STAGE_NAMES,
  StageName,
  Stages,
} from "./lib/processingStages";

// Document processing: Convex starts the Windmill flow f/docling/process_document_for_app
// for each upload, polls the job until it finishes, and stores the result.

const FLOW_PATH = "f/docling/process_document_for_app";
const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS = 90; // ~15 minutes
const CLAIM_RECOVERY_MS = 60_000;
const ACTIVE_ATTEMPT_STATES = new Set([
  "claimed",
  "submitting",
  "submission_unknown",
  "running",
]);
const attemptArg = v.optional(v.id("processingAttempts"));
const FIELD_KINDS = new Set(["text", "date", "number"]);
const DOCUMENT_TYPES = new Set([
  "lease",
  "invoice",
  "utility_statement",
  "addendum",
  "correspondence",
  "offer",
  "other",
]);

function windmillConfig() {
  const baseUrl = env.WINDMILL_BASE_URL?.replace(/\/+$/, "");
  const workspace = env.WINDMILL_WORKSPACE;
  const token = env.WINDMILL_PROCESSING_TOKEN;
  if (!baseUrl || !workspace || !token) {
    return null;
  }
  return { baseUrl, workspace, token };
}

async function runFlow(
  config: NonNullable<ReturnType<typeof windmillConfig>>,
  args: Record<string, unknown>,
  reservedJobId?: string,
): Promise<string> {
  const suffix = reservedJobId
    ? `?job_id=${encodeURIComponent(reservedJobId)}`
    : "";
  const response = await fetch(
    `${config.baseUrl}/api/w/${config.workspace}/jobs/run/f/${FLOW_PATH}${suffix}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = (await response.text()).trim();
  if (!response.ok) {
    throw new SubmissionError(
      response.status,
      `Windmill refused the job (${response.status})`,
    );
  }
  const jobId = text.replace(/^"|"$/g, "");
  if (!jobId || (reservedJobId && jobId !== reservedJobId)) {
    throw new Error(
      "Windmill did not confirm the reserved job ID; reconciliation is required",
    );
  }
  return jobId;
}

class SubmissionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type WindmillJob = {
  type?: string;
  success?: boolean;
  result?: unknown;
  args?: Record<string, unknown>;
  script_path?: string;
  flow_status?: { modules?: Array<{ id?: string; type?: string }> };
};

async function getJob(
  config: NonNullable<ReturnType<typeof windmillConfig>>,
  jobId: string,
) {
  const response = await fetch(
    `${config.baseUrl}/api/w/${config.workspace}/jobs_u/get/${jobId}`,
    {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new SubmissionError(
      response.status,
      `Windmill job lookup failed (${response.status})`,
    );
  }
  return (await response.json()) as WindmillJob;
}

function describeFailure(result: unknown) {
  if (result && typeof result === "object" && "error" in result) {
    const error = (result as { error?: { message?: string; name?: string } })
      .error;
    if (error?.message) return error.message.slice(0, 400);
  }
  return "Processing failed in Windmill";
}

function failedStages(
  stages: Stages,
  target: StageName | undefined,
  message: string,
): Stages {
  const now = Date.now();
  const name =
    target ??
    STAGE_NAMES.find((n) => stages[n].status === "running") ??
    STAGE_NAMES.find((n) => stages[n].status === "pending") ??
    "parse";
  const next = {
    ...stages,
    [name]: {
      ...stages[name],
      status: "failed" as const,
      ...errorDetails(message),
      completedAt: now,
      updatedAt: now,
    },
  };
  if (name === "parse")
    for (const downstream of ["knowledge", "extract"] as const)
      next[downstream] = {
        ...next[downstream],
        status: "skipped",
        retryable: false,
        completedAt: now,
        updatedAt: now,
      };
  return next;
}

// --- Internal reads/writes -------------------------------------------------

async function ownsUpdate(
  ctx: QueryCtx | MutationCtx,
  document: Doc<"documents"> | null,
  attemptId: Id<"processingAttempts"> | undefined,
  jobId?: string,
) {
  if (!document || document.deletedAt || document.replacedByDocumentId)
    return false;
  if (document.activeAttemptId || document.activeRecoveryAttemptId) {
    if (
      !attemptId ||
      (document.activeAttemptId !== attemptId &&
        document.activeRecoveryAttemptId !== attemptId)
    )
      return false;
    const attempt = await ctx.db.get(attemptId);
    if (!attempt || !ACTIVE_ATTEMPT_STATES.has(attempt.state)) return false;
    if (
      attempt.retryStage === "knowledge" &&
      (document.activeRecoveryAttemptId !== attemptId ||
        document.activeAttemptId !== attempt.sourceAttemptId)
    )
      return false;
    if (
      jobId &&
      (attempt.submissionJobId !== jobId ||
        (attempt.windmillJobId && attempt.windmillJobId !== jobId))
    )
      return false;
    return true;
  }
  // Old scheduled jobs can finish only on records that have not adopted attempts.
  return !attemptId && !!jobId && document.windmillJobId === jobId;
}

export const claim = internalMutation({
  args: { documentId: v.id("documents"), submissionJobId: v.string() },
  handler: async (ctx, args): Promise<Id<"processingAttempts"> | null> => {
    const document = await ctx.db.get(args.documentId);
    if (
      !document ||
      document.deletedAt ||
      document.replacedByDocumentId ||
      document.processingRemoteUnresolved ||
      document.status !== "uploaded"
    )
      return null;
    if (document.activeAttemptId) {
      const previous = await ctx.db.get(document.activeAttemptId);
      if (previous && ACTIVE_ATTEMPT_STATES.has(previous.state)) return null;
    }
    if (document.activeRecoveryAttemptId) {
      const recovery = await ctx.db.get(document.activeRecoveryAttemptId);
      if (recovery && ACTIVE_ATTEMPT_STATES.has(recovery.state)) return null;
    }
    const now = Date.now();
    const attemptId = await ctx.db.insert("processingAttempts", {
      documentId: document._id,
      tenantId: document.tenantId,
      submissionJobId: args.submissionJobId,
      state: "claimed",
      claimedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(document._id, {
      activeAttemptId: attemptId,
      activeRecoveryAttemptId: undefined,
      processingStages: initialStages(attemptId, now),
      status: "queued_for_ocr",
      windmillJobId: undefined,
      processingAttempts: document.processingAttempts + 1,
      processingStartedAt: now,
      processedAt: undefined,
      reviewedAt: undefined,
      reviewedBy: undefined,
      processingIncomplete: undefined,
      processingWarnings: undefined,
      processingContractVersion: undefined,
      incompleteAcknowledgedAt: undefined,
      incompleteAcknowledgedBy: undefined,
      incompleteAcknowledgementReason: undefined,
      statusMessage: "Preparing document processing",
      updatedAt: now,
    });
    // Survives the action dying before/after submission or job attachment.
    await ctx.scheduler.runAfter(
      CLAIM_RECOVERY_MS,
      internal.processing.recoverSubmission,
      {
        documentId: document._id,
        attemptId,
        check: 1,
      },
    );
    return attemptId;
  },
});

/** Staff recovery claims atomically; the caller cannot select arbitrary artifact keys. */
export const retryStage = mutation({
  args: {
    documentId: v.id("documents"),
    stage: processingStageName,
    attemptId: attemptArg,
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.deletedAt || document.replacedByDocumentId)
      throw new ConvexError("Document not found");
    const access = await requireTenantWriter(ctx, document.tenantId);
    if (document.activeAttemptId !== args.attemptId)
      throw new ConvexError("Processing changed; reload before retrying");
    if (!windmillConfig())
      throw new ConvexError(
        "Automatic processing is unavailable. Ask your administrator to configure the processing connection; your original is safely stored.",
      );
    if (document.processingRemoteUnresolved)
      throw new ConvexError(
        "The existing remote job is unresolved. Check it before retrying.",
      );
    for (const id of [
      document.activeAttemptId,
      document.activeRecoveryAttemptId,
    ]) {
      const active = id ? await ctx.db.get(id) : null;
      if (active && ACTIVE_ATTEMPT_STATES.has(active.state))
        throw new ConvexError(
          "An attempt is still active. Reconcile the existing job before retrying.",
        );
    }
    const stages = document.processingStages;
    const stage = stages?.[args.stage];
    if (!stage || !["failed", "partial"].includes(stage.status))
      throw new ConvexError("This stage is not awaiting recovery");
    if (
      stage.status === "failed" &&
      !stage.retryable &&
      stage.errorKind !== "configuration"
    )
      throw new ConvexError(
        "Correct the source or processing configuration before retrying this stage",
      );
    if (
      args.stage !== "parse" &&
      (!document.parsedJsonKey ||
        !stages?.parse.artifactKey ||
        !["succeeded", "partial"].includes(stages.parse.status))
    )
      throw new ConvexError(
        "No usable parsed source remains. Retry document reading first.",
      );
    if (
      args.stage !== "parse" &&
      (stages?.parse.artifactKey !== document.parsedJsonKey ||
        (stages?.parse.artifactBucket &&
          stages.parse.artifactBucket !== "parsedinjson"))
    )
      throw new ConvexError(
        "The saved source reference is inconsistent. Retry document reading first.",
      );
    const now = Date.now();
    const attemptId = await ctx.db.insert("processingAttempts", {
      documentId: document._id,
      tenantId: document.tenantId,
      submissionJobId: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
        /[xy]/g,
        (c) => {
          const n = Math.floor(Math.random() * 16);
          return (c === "x" ? n : (n & 3) | 8).toString(16);
        },
      ),
      state: "claimed",
      claimedAt: now,
      updatedAt: now,
      retryStage: args.stage,
      sourceAttemptId: document.activeAttemptId,
      reuseParsedJsonKey:
        args.stage === "parse" ? undefined : document.parsedJsonKey,
      reuseParsedJsonBucket:
        args.stage === "parse"
          ? undefined
          : (stages?.parse.artifactBucket ?? "parsedinjson"),
      reuseKnowledgeStage:
        args.stage === "extract" ? stages?.knowledge : undefined,
    });
    const next = { ...stages } as Stages;
    const pending = initialStages(attemptId, now);
    if (args.stage === "knowledge") {
      next.knowledge = pending.knowledge;
      await ctx.db.patch(document._id, {
        activeRecoveryAttemptId: attemptId,
        processingStages: next,
        updatedAt: now,
      });
    } else {
      if (args.stage === "extract") {
        pending.parse = {
          ...stages!.parse,
          attemptId,
          sourceAttemptId: document.activeAttemptId,
          reused: true,
          updatedAt: now,
        };
        pending.knowledge = {
          ...stages!.knowledge,
          sourceAttemptId:
            stages!.knowledge.attemptId ?? document.activeAttemptId,
          reused: true,
          updatedAt: now,
        };
      }
      await ctx.db.patch(document._id, {
        activeAttemptId: attemptId,
        activeRecoveryAttemptId: undefined,
        processingStages: pending,
        status: "queued_for_ocr",
        windmillJobId: undefined,
        processingAttempts: document.processingAttempts + 1,
        processingStartedAt: now,
        processedAt: undefined,
        reviewedAt: undefined,
        reviewedBy: undefined,
        processingIncomplete: undefined,
        processingWarnings: undefined,
        incompleteAcknowledgedAt: undefined,
        incompleteAcknowledgedBy: undefined,
        incompleteAcknowledgementReason: undefined,
        statusMessage:
          args.stage === "extract"
            ? "Retrying extraction from the saved source"
            : "Retrying document reading",
        updatedAt: now,
      });
    }
    await ctx.scheduler.runAfter(0, internal.processing.start, {
      documentId: document._id,
      attemptId,
    });
    await ctx.scheduler.runAfter(
      CLAIM_RECOVERY_MS,
      internal.processing.recoverSubmission,
      { documentId: document._id, attemptId, check: 1 },
    );
    await appendAuditEvent(ctx, {
      tenantId: document.tenantId,
      eventType: "document.stage_retry_requested",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "document",
      targetId: document._id,
      correlationId: `document:${document._id}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadAfter: JSON.stringify({
        stage: args.stage,
        attemptId,
        sourceAttemptId: document.activeAttemptId ?? null,
        reusedParsedJsonKey:
          args.stage === "parse" ? null : document.parsedJsonKey,
      }),
    });
    return { attemptId };
  },
});

export const beginSubmission = internalMutation({
  args: {
    documentId: v.id("documents"),
    attemptId: v.id("processingAttempts"),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!(await ownsUpdate(ctx, document, args.attemptId))) return false;
    const attempt = await ctx.db.get(args.attemptId);
    if (attempt?.state !== "claimed") return false;
    await ctx.db.patch(args.attemptId, {
      state: "submitting",
      submittedAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (document?.processingStages && attempt) {
      const name =
        attempt.retryStage === "knowledge"
          ? "knowledge"
          : attempt.retryStage === "extract"
            ? "extract"
            : "parse";
      await ctx.db.patch(document._id, {
        processingStages: {
          ...document.processingStages,
          [name]: {
            ...document.processingStages[name],
            status: "running",
            startedAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      });
    }
    return true;
  },
});

export const getAttempt = internalQuery({
  args: {
    documentId: v.id("documents"),
    attemptId: v.id("processingAttempts"),
  },
  handler: async (ctx, args): Promise<Doc<"processingAttempts"> | null> => {
    const document = await ctx.db.get(args.documentId);
    if (!(await ownsUpdate(ctx, document, args.attemptId))) return null;
    return await ctx.db.get(args.attemptId);
  },
});

export const markSubmissionUnknown = internalMutation({
  args: {
    documentId: v.id("documents"),
    attemptId: v.id("processingAttempts"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!(await ownsUpdate(ctx, document, args.attemptId))) return;
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.state === "running") return;
    await ctx.db.patch(args.attemptId, {
      state: "submission_unknown",
      error: args.message.slice(0, 500),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(args.documentId, {
      statusMessage:
        attempt.retryStage === "knowledge"
          ? document?.statusMessage
          : args.message.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});

export const abandonClaim = internalMutation({
  args: {
    documentId: v.id("documents"),
    attemptId: v.id("processingAttempts"),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!(await ownsUpdate(ctx, document, args.attemptId))) return;
    const attempt = await ctx.db.get(args.attemptId);
    if (
      !attempt ||
      attempt.state !== "claimed" ||
      Date.now() - attempt.claimedAt < CLAIM_RECOVERY_MS
    )
      return;
    await ctx.db.patch(args.attemptId, {
      state: "abandoned",
      completedAt: Date.now(),
      updatedAt: Date.now(),
      error: "Submission never started",
    });
    await ctx.db.patch(args.documentId, {
      ...(attempt.retryStage === "knowledge"
        ? {}
        : { status: "processing_failed" as const }),
      ...(document?.processingStages
        ? {
            processingStages: failedStages(
              document.processingStages,
              attempt.retryStage,
              "Submission never started",
            ),
          }
        : {}),
      statusMessage: "Processing did not start. Retry this document.",
      updatedAt: Date.now(),
    });
  },
});

export const getForProcessing = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.deletedAt || document.replacedByDocumentId) {
      return null;
    }
    const tenant = await ctx.db.get(document.tenantId);
    if (!tenant) return null;
    return {
      document,
      tenantSlug: tenant.slug,
      fileUrl: await ctx.storage.getUrl(document.storageId),
    };
  },
});

export const markQueued = internalMutation({
  args: {
    documentId: v.id("documents"),
    jobId: v.string(),
    attemptId: attemptArg,
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.deletedAt || document.replacedByDocumentId)
      return false;
    const recovery = args.attemptId ? await ctx.db.get(args.attemptId) : null;
    if (recovery?.retryStage === "knowledge") {
      if (
        !(await ownsUpdate(ctx, document, args.attemptId, args.jobId)) ||
        recovery.state === "running"
      )
        return false;
      await ctx.db.patch(recovery._id, {
        state: "running",
        windmillJobId: args.jobId,
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(POLL_INTERVAL_MS, internal.processing.poll, {
        documentId: document._id,
        jobId: args.jobId,
        attemptId: recovery._id,
        attempt: 1,
      });
      return true;
    }
    if (document.activeAttemptId) {
      if (!(await ownsUpdate(ctx, document, args.attemptId, args.jobId)))
        return false;
      const attempt = await ctx.db.get(document.activeAttemptId);
      if (!attempt || attempt.state === "running") return false;
      await ctx.db.patch(document.activeAttemptId, {
        state: "running",
        windmillJobId: args.jobId,
        updatedAt: Date.now(),
      });
    } else if (
      args.attemptId ||
      document.status !== "uploaded" ||
      document.windmillJobId ||
      document.processingAttempts !== 0
    )
      return false;
    const now = Date.now();
    await ctx.db.patch(args.documentId, {
      status: "queued_for_ocr",
      statusMessage: undefined,
      windmillJobId: args.jobId,
      processingAttempts:
        document.processingAttempts + (document.activeAttemptId ? 0 : 1),
      processingStartedAt: now,
      updatedAt: now,
    });
    // Attach + first poll in one transaction; recovery cannot create a second poll chain.
    await ctx.scheduler.runAfter(POLL_INTERVAL_MS, internal.processing.poll, {
      documentId: args.documentId,
      jobId: args.jobId,
      ...(args.attemptId ? { attemptId: args.attemptId } : {}),
      attempt: 1,
    });
    return true;
  },
});

export const markOcrComplete = internalMutation({
  args: {
    documentId: v.id("documents"),
    jobId: v.string(),
    attemptId: attemptArg,
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (
      !(await ownsUpdate(ctx, document, args.attemptId, args.jobId)) ||
      document?.windmillJobId !== args.jobId ||
      document.status !== "queued_for_ocr"
    )
      return;
    await ctx.db.patch(args.documentId, {
      status: "ocr_complete",
      updatedAt: Date.now(),
    });
  },
});

export const markFailed = internalMutation({
  args: {
    documentId: v.id("documents"),
    jobId: v.optional(v.string()),
    attemptId: attemptArg,
    message: v.string(),
    stage: v.optional(processingStageName),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (
      !document ||
      !(await ownsUpdate(ctx, document, args.attemptId, args.jobId))
    )
      return;
    if (
      !document.activeAttemptId &&
      !["uploaded", "queued_for_ocr", "ocr_complete"].includes(
        document.status,
      ) &&
      !document.processingRemoteUnresolved
    )
      return;
    const now = Date.now();
    const owned = args.attemptId ? await ctx.db.get(args.attemptId) : null;
    if (args.attemptId)
      await ctx.db.patch(args.attemptId, {
        state: "failed",
        completedAt: now,
        updatedAt: now,
        error: args.message.slice(0, 500),
      });
    await ctx.db.patch(args.documentId, {
      processingRemoteUnresolved: false,
      ...(owned?.retryStage === "knowledge"
        ? {}
        : { status: "processing_failed" as const }),
      ...(document.processingStages
        ? {
            processingStages: failedStages(
              document.processingStages,
              args.stage ?? owned?.retryStage,
              args.message,
            ),
          }
        : {}),
      statusMessage:
        owned?.retryStage === "knowledge"
          ? document.statusMessage
          : args.message.slice(0, 500),
      updatedAt: now,
    });
    const slug = await tenantSlug(ctx, document.tenantId);
    await notify(ctx, {
      recipients: [document.uploadedBy],
      tenantId: document.tenantId,
      kind: "document.processing_failed",
      title: `Couldn't process ${document.filename}`,
      body: "Processing needs attention. Your original is safely stored; your team can check the source and retry the failed stage.",
      link:
        document.uploaderPrincipal === "client"
          ? `/portal/${slug}/documents`
          : `/documents/${document._id}`,
    });
    await appendAuditEvent(ctx, {
      tenantId: document.tenantId,
      eventType: "document.processing_failed",
      actorType: "system",
      targetType: "document",
      targetId: document._id,
      correlationId: `document:${document._id}`,
      sourceSystem: "windmill",
      occurredAt: now,
      reason: args.message.slice(0, 500),
    });
  },
});

export const markNotConfigured = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (
      !document ||
      document.deletedAt ||
      document.replacedByDocumentId ||
      document.status !== "uploaded"
    )
      return;
    if (document.activeAttemptId) {
      const attempt = await ctx.db.get(document.activeAttemptId);
      if (attempt && ACTIVE_ATTEMPT_STATES.has(attempt.state)) return;
    }
    await ctx.db.patch(args.documentId, {
      statusMessage:
        "Automatic processing is not configured yet; the file is stored safely.",
      updatedAt: Date.now(),
    });
  },
});

export const updateStageProgress = internalMutation({
  args: {
    documentId: v.id("documents"),
    attemptId: attemptArg,
    jobId: v.string(),
    modules: v.array(
      v.object({ id: v.optional(v.string()), type: v.optional(v.string()) }),
    ),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (
      !document?.processingStages ||
      !(await ownsUpdate(ctx, document, args.attemptId, args.jobId))
    )
      return;
    const attempt = args.attemptId ? await ctx.db.get(args.attemptId) : null;
    const next = { ...document.processingStages };
    let changed = false;
    for (const module of args.modules.slice(0, 4)) {
      const name = module.id === "okf" ? "knowledge" : module.id;
      if (
        !STAGE_NAMES.includes(name as StageName) ||
        (attempt?.retryStage === "knowledge" && name !== "knowledge") ||
        (attempt?.retryStage === "extract" && name !== "extract")
      )
        continue;
      const stage = next[name as StageName];
      const status =
        module.type === "Success"
          ? "succeeded"
          : module.type === "Failure"
            ? "failed"
            : module.type === "InProgress"
              ? "running"
              : undefined;
      if (status && stage.status !== status) {
        next[name as StageName] = {
          ...stage,
          status,
          startedAt: stage.startedAt ?? Date.now(),
          ...(status === "succeeded" || status === "failed"
            ? { completedAt: Date.now() }
            : {}),
          updatedAt: Date.now(),
        };
        changed = true;
      }
    }
    if (changed) await ctx.db.patch(document._id, { processingStages: next });
  },
});

export const markTimedOut = internalMutation({
  args: {
    documentId: v.id("documents"),
    jobId: v.string(),
    attemptId: attemptArg,
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (
      !document ||
      !(await ownsUpdate(ctx, document, args.attemptId, args.jobId))
    )
      return;
    const attempt = args.attemptId ? await ctx.db.get(args.attemptId) : null;
    if (attempt?.timedOut) return;
    if (attempt)
      await ctx.db.patch(attempt._id, {
        timedOut: true,
        error:
          "Local waiting period ended; remote execution remains unresolved",
        updatedAt: Date.now(),
      });
    const stages = document.processingStages
      ? { ...document.processingStages }
      : initialStages(undefined, Date.now());
    if (stages) {
      const name =
        attempt?.retryStage === "knowledge"
          ? "knowledge"
          : (STAGE_NAMES.find((n) => stages[n].status === "running") ??
            "parse");
      stages[name] = {
        ...stages[name],
        error:
          "Waiting period ended; reconcile the existing remote job before retrying.",
        errorKind: "timeout",
        retryable: false,
        updatedAt: Date.now(),
      };
    }
    await ctx.db.patch(document._id, {
      ...(attempt?.retryStage === "knowledge"
        ? {}
        : { status: "processing_failed" as const }),
      processingStages: stages,
      processingRemoteUnresolved: !args.attemptId,
      statusMessage:
        "Processing is taking longer than expected. Remote work may continue; your team must check the existing job before retrying.",
      updatedAt: Date.now(),
    });
  },
});

export const reconcile = mutation({
  args: {
    documentId: v.id("documents"),
    attemptId: attemptArg,
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.deletedAt || document.replacedByDocumentId)
      throw new ConvexError("Document not found");
    await requireTenantWriter(ctx, document.tenantId);
    if (
      !args.attemptId &&
      document.processingRemoteUnresolved &&
      document.windmillJobId
    ) {
      if (!windmillConfig())
        throw new ConvexError(
          "Restore the processing connection before checking the existing job",
        );
      await ctx.scheduler.runAfter(0, internal.processing.poll, {
        documentId: document._id,
        jobId: document.windmillJobId,
        attempt: MAX_POLLS,
      });
      return null;
    }
    if (!(await ownsUpdate(ctx, document, args.attemptId)))
      throw new ConvexError("Processing changed; reload the document");
    const attempt = (await ctx.db.get(args.attemptId!))!;
    if (!windmillConfig())
      throw new ConvexError(
        "Restore the processing connection before checking the existing job",
      );
    if (attempt.state === "running")
      await ctx.scheduler.runAfter(0, internal.processing.poll, {
        ...args,
        jobId: attempt.submissionJobId,
        attempt: MAX_POLLS,
      });
    else
      await ctx.scheduler.runAfter(0, internal.processing.recoverSubmission, {
        documentId: document._id,
        attemptId: attempt._id,
        check: 1,
      });
    return null;
  },
});

type ExtractedFieldInput = {
  key: string;
  label: string;
  kind: "text" | "date" | "number";
  value: string;
  confidence: number;
  evidence?: string;
  page?: number;
};

function readFields(raw: unknown): ExtractedFieldInput[] {
  if (!Array.isArray(raw)) return [];
  const fields: ExtractedFieldInput[] = [];
  for (const item of raw.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const field = item as Record<string, unknown>;
    if (typeof field.key !== "string" || typeof field.value !== "string")
      continue;
    const kind =
      typeof field.kind === "string" && FIELD_KINDS.has(field.kind)
        ? field.kind
        : "text";
    const confidence =
      typeof field.confidence === "number" && Number.isFinite(field.confidence)
        ? Math.max(0, Math.min(1, field.confidence))
        : 0;
    fields.push({
      key: field.key.slice(0, 80),
      label:
        typeof field.label === "string" ? field.label.slice(0, 120) : field.key,
      kind: kind as ExtractedFieldInput["kind"],
      value: field.value.slice(0, 1000),
      confidence,
      evidence:
        typeof field.evidence === "string"
          ? field.evidence.slice(0, 300)
          : undefined,
      page:
        typeof field.page === "number" &&
        Number.isFinite(field.page) &&
        field.page > 0
          ? Math.floor(field.page)
          : undefined,
    });
  }
  return fields;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readCompleteness(
  result: Record<string, unknown>,
  extraction: Record<string, unknown>,
  fieldCount: number,
) {
  const warnings: string[] = [];
  if (
    !Array.isArray(extraction.fields) ||
    extraction.fields.length !== fieldCount
  ) {
    warnings.push(
      "Extraction returned invalid or excessive fields; source coverage needs checking.",
    );
  }
  const truncated = extraction.truncated === true;
  if (truncated)
    warnings.push(
      "Only part of the source text was extracted; check the unprocessed remainder.",
    );
  if (
    result.docling_status !== undefined &&
    !["success", "SUCCESS"].includes(String(result.docling_status))
  ) {
    warnings.push(
      "Docling did not report complete parsing; check the original document.",
    );
  }
  const stages = record(result.stages);
  const stageMetadata: Record<string, { status: string; error?: string }> = {};
  for (const name of ["parse", "knowledge", "extract"]) {
    const stage = record(stages[name]);
    const status =
      typeof stage.status === "string" &&
      ["succeeded", "failed", "partial", "skipped", "unknown"].includes(
        stage.status,
      )
        ? stage.status
        : "unknown";
    stageMetadata[name] = {
      status,
      ...(typeof stage.error === "string"
        ? { error: stage.error.slice(0, 500) }
        : {}),
    };
    if (
      name !== "knowledge" &&
      result.contract_version !== undefined &&
      status !== "succeeded"
    ) {
      warnings.push(
        `${name === "parse" ? "Parsing" : "Extraction"} coverage is incomplete or unknown.`,
      );
    }
  }
  const coverage = record(result.completeness);
  const totalSections = coverage.total_sections;
  const completedSections = coverage.completed_sections;
  if (result.contract_version !== undefined) {
    if (result.contract_version !== 1)
      warnings.push(
        "Unsupported processing result version; review the original source.",
      );
    if (
      coverage.complete !== true ||
      (typeof coverage.failed_sections === "number" &&
        coverage.failed_sections > 0)
    ) {
      warnings.push(
        "The processing result does not confirm complete source coverage.",
      );
    }
    if (totalSections !== undefined || completedSections !== undefined) {
      if (
        typeof totalSections !== "number" ||
        typeof completedSections !== "number" ||
        !Number.isInteger(totalSections) ||
        totalSections < 1 ||
        completedSections !== totalSections
      ) {
        warnings.push(
          "Some source sections are missing from extraction coverage.",
        );
      }
    }
  }
  // Missing classification or an unusable extraction object is never a normal result.
  if (
    !DOCUMENT_TYPES.has(String(extraction.document_type)) ||
    fieldCount === 0
  ) {
    warnings.push("The extraction result is missing usable classified fields.");
  }
  return {
    incomplete: warnings.length > 0,
    warnings: [...new Set(warnings)],
    metadata: {
      stages: stageMetadata,
      completeness: {
        complete: warnings.length === 0,
        truncated,
        totalSections:
          typeof totalSections === "number" && Number.isFinite(totalSections)
            ? totalSections
            : null,
        completedSections:
          typeof completedSections === "number" &&
          Number.isFinite(completedSections)
            ? completedSections
            : null,
      },
      provenance: {
        pageCount:
          typeof result.page_count === "number" &&
          Number.isFinite(result.page_count)
            ? result.page_count
            : null,
        pageCountSource:
          typeof record(result.provenance).page_count_source === "string"
            ? String(record(result.provenance).page_count_source).slice(0, 80)
            : "unknown",
        fieldPagesVerified:
          record(result.provenance).field_pages_verified === true,
      },
      artifacts: {
        parsedJsonKey:
          typeof result.parsed_json_key === "string"
            ? result.parsed_json_key.slice(0, 1000)
            : null,
        okfBundleRoot:
          typeof result.okf_bundle_root === "string"
            ? result.okf_bundle_root.slice(0, 1000)
            : null,
      },
    },
  };
}

export const applyResult = internalMutation({
  args: {
    documentId: v.id("documents"),
    jobId: v.string(),
    attemptId: attemptArg,
    result: v.any(),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    const recoveryAttempt = args.attemptId
      ? await ctx.db.get(args.attemptId)
      : null;
    if (recoveryAttempt?.retryStage === "knowledge") {
      if (
        !document ||
        !(await ownsUpdate(ctx, document, args.attemptId, args.jobId))
      )
        return;
      const result = record(args.result);
      const valid =
        result.contract_version === 1 && result.attempt_id === args.attemptId;
      const incoming = resultStages(
        valid ? result : {},
        args.attemptId,
        document.processingStages,
      );
      const knowledge = incoming.knowledge;
      if (!valid)
        Object.assign(knowledge, {
          status: "failed",
          error: "Invalid recovery result identity",
          errorKind: "invalid_input",
          retryable: false,
        });
      await ctx.db.patch(recoveryAttempt._id, {
        state: "completed",
        completedAt: Date.now(),
        updatedAt: Date.now(),
        resultVersion: valid ? 1 : undefined,
        error: knowledge.error,
        resultMetadata: { stages: { knowledge } },
      });
      if (document.processingStages)
        await ctx.db.patch(document._id, {
          processingStages: { ...document.processingStages, knowledge },
          okfBundleRoot:
            knowledge.status === "succeeded"
              ? knowledge.artifactKey
              : document.okfBundleRoot,
          updatedAt: Date.now(),
        });
      await appendAuditEvent(ctx, {
        tenantId: document.tenantId,
        eventType: "document.knowledge_recovered",
        actorType: "system",
        targetType: "document",
        targetId: document._id,
        correlationId: `document:${document._id}`,
        sourceSystem: "windmill",
        occurredAt: Date.now(),
        payloadAfter: JSON.stringify({
          attemptId: args.attemptId,
          status: knowledge.status,
        }),
      });
      return;
    }
    if (
      !document ||
      !(await ownsUpdate(ctx, document, args.attemptId, args.jobId)) ||
      document.windmillJobId !== args.jobId ||
      (!["queued_for_ocr", "ocr_complete"].includes(document.status) &&
        !recoveryAttempt?.timedOut &&
        !document.processingRemoteUnresolved)
    )
      return;

    const incoming = record(args.result);
    const wrongIdentity =
      incoming.contract_version !== undefined &&
      args.attemptId &&
      incoming.attempt_id !== args.attemptId;
    // Do not copy text or artifact references from a result naming another attempt.
    const result: Record<string, unknown> = wrongIdentity
      ? { contract_version: incoming.contract_version }
      : incoming;
    const extraction = wrongIdentity ? {} : record(result.extraction);
    const fields = readFields(extraction.fields);
    const completeness = readCompleteness(result, extraction, fields.length);
    if (args.attemptId && result.contract_version === undefined) {
      completeness.incomplete = true;
      completeness.metadata.completeness.complete = false;
      completeness.warnings.push(
        "Legacy processing output did not confirm attempt identity or full source coverage.",
      );
    }
    if (wrongIdentity) {
      completeness.incomplete = true;
      completeness.metadata.completeness.complete = false;
      completeness.warnings.push(
        "Result attempt identity did not match; extracted fields were not accepted.",
      );
    }
    const classified =
      typeof extraction.document_type === "string" &&
      DOCUMENT_TYPES.has(extraction.document_type)
        ? (extraction.document_type as Doc<"documents">["documentType"])
        : undefined;
    const missingFields = Array.isArray(extraction.missing_fields)
      ? extraction.missing_fields
          .filter((key): key is string => typeof key === "string")
          .slice(0, 30)
      : [];
    const typeConfidence =
      typeof extraction.type_confidence === "number" &&
      Number.isFinite(extraction.type_confidence)
        ? Math.max(0, Math.min(1, extraction.type_confidence))
        : undefined;

    const tenant = await ctx.db.get(document.tenantId);
    const settings = tenant?.settingsId
      ? await ctx.db.get(tenant.settingsId)
      : null;
    const threshold = (settings?.publishConfidenceThreshold ?? 90) / 100;

    // Attempt ownership selects current fields without rewriting review history.
    const now = Date.now();
    const outcomes = resultStages(
      result,
      args.attemptId,
      document.processingStages,
    );
    if (recoveryAttempt?.reuseParsedJsonKey)
      outcomes.parse = {
        ...outcomes.parse,
        reused: true,
        sourceAttemptId: recoveryAttempt.sourceAttemptId,
      };
    if (
      recoveryAttempt?.retryStage === "extract" &&
      recoveryAttempt.reuseKnowledgeStage
    )
      outcomes.knowledge = {
        ...recoveryAttempt.reuseKnowledgeStage,
        reused: true,
        updatedAt: now,
      };
    const rawStages = record(result.stages);
    const failedStage =
      record(rawStages.parse).status === "failed"
        ? "parse"
        : record(rawStages.extract).status === "failed"
          ? "extract"
          : undefined;
    if (failedStage && fields.length === 0) {
      await ctx.db.patch(document._id, {
        status: "processing_failed",
        processingRemoteUnresolved: false,
        processingStages: outcomes,
        statusMessage: `${failedStage === "parse" ? "Document reading" : "Field extraction"} failed. Check the stage details and retry after correcting its cause.`,
        processingIncomplete: true,
        processingWarnings: completeness.warnings,
        parsedJsonKey:
          typeof result.parsed_json_key === "string"
            ? result.parsed_json_key.slice(0, 1000)
            : undefined,
        okfBundleRoot:
          typeof result.okf_bundle_root === "string"
            ? result.okf_bundle_root.slice(0, 1000)
            : undefined,
        processedAt: now,
        updatedAt: now,
      });
      if (args.attemptId)
        await ctx.db.patch(args.attemptId, {
          state: "completed",
          completedAt: now,
          updatedAt: now,
          incomplete: true,
          resultVersion:
            typeof result.contract_version === "number"
              ? result.contract_version
              : undefined,
          resultMetadata: completeness.metadata,
          warnings: completeness.warnings,
        });
      await notify(ctx, {
        recipients: await staffRecipients(ctx, document.tenantId),
        tenantId: document.tenantId,
        kind: "document.processing_failed",
        title: `Stage failed: ${document.filename}`,
        body: "Check the recorded stage outcome and retry the failed work.",
        link: `/documents/${document._id}`,
      });
      await appendAuditEvent(ctx, {
        tenantId: document.tenantId,
        eventType: "document.stage_failed",
        actorType: "system",
        targetType: "document",
        targetId: document._id,
        correlationId: `document:${document._id}`,
        sourceSystem: "windmill",
        occurredAt: now,
        reason: failedStage,
      });
      return;
    }
    let lowConfidence = 0;
    for (const field of fields) {
      const needsReview = field.confidence < threshold;
      if (needsReview) lowConfidence += 1;
      await ctx.db.insert("extractedFields", {
        tenantId: document.tenantId,
        documentId: document._id,
        attemptId: args.attemptId,
        ...field,
        state: needsReview ? "low_confidence_review" : "detected",
        windmillJobId: args.jobId,
        createdAt: now,
      });
    }

    const needsReview =
      completeness.incomplete ||
      lowConfidence > 0 ||
      missingFields.length > 0 ||
      (typeConfidence !== undefined && typeConfidence < threshold) ||
      fields.length === 0;
    const reasons = [
      ...completeness.warnings,
      fields.length === 0 ? "no fields could be extracted" : null,
      lowConfidence > 0
        ? `${lowConfidence} low-confidence field${lowConfidence === 1 ? "" : "s"}`
        : null,
      missingFields.length > 0 ? `missing ${missingFields.join(", ")}` : null,
    ].filter(Boolean);

    await ctx.db.patch(document._id, {
      status: needsReview ? "review_required" : "extraction_complete",
      processingRemoteUnresolved: false,
      statusMessage: needsReview
        ? `Needs review: ${reasons.join("; ")}`
        : undefined,
      processingIncomplete: completeness.incomplete,
      processingStages: outcomes,
      processingWarnings: completeness.warnings,
      processingContractVersion:
        typeof result.contract_version === "number"
          ? result.contract_version
          : undefined,
      incompleteAcknowledgedAt: undefined,
      incompleteAcknowledgedBy: undefined,
      incompleteAcknowledgementReason: undefined,
      documentType: classified ?? document.declaredType,
      typeConfidence,
      summary:
        typeof extraction.summary === "string"
          ? extraction.summary.slice(0, 500)
          : undefined,
      missingFields,
      parsedJsonKey:
        typeof result.parsed_json_key === "string"
          ? result.parsed_json_key
          : undefined,
      okfBundleRoot:
        recoveryAttempt?.retryStage === "extract"
          ? recoveryAttempt.reuseKnowledgeStage?.artifactKey
          : typeof result.okf_bundle_root === "string"
            ? result.okf_bundle_root
            : undefined,
      pageCount:
        typeof result.page_count === "number" &&
        Number.isInteger(result.page_count) &&
        result.page_count > 0
          ? result.page_count
          : undefined,
      ocrConfidence:
        typeof result.docling_confidence === "number" &&
        Number.isFinite(result.docling_confidence)
          ? Math.max(0, Math.min(1, result.docling_confidence))
          : undefined,
      textPreview:
        typeof result.text_preview === "string"
          ? result.text_preview.slice(0, 1500)
          : undefined,
      processedAt: now,
      updatedAt: now,
    });
    if (args.attemptId)
      await ctx.db.patch(args.attemptId, {
        state: "completed",
        completedAt: now,
        updatedAt: now,
        incomplete: completeness.incomplete,
        warnings: completeness.warnings,
        resultVersion:
          typeof result.contract_version === "number"
            ? result.contract_version
            : undefined,
        resultMetadata: completeness.metadata,
      });

    // Follow-ups: ask the client for missing details; give staff a review task.
    if (missingFields.length > 0) {
      const readable = missingFields
        .map((key) => key.replace(/_/g, " "))
        .join(", ");
      await upsertAutoAction(ctx, {
        tenantId: document.tenantId,
        autoKey: `document:${document._id}:missing`,
        title: `Missing details in ${document.filename}`,
        description: `We couldn't find: ${readable}. Please upload a complete copy or reply with the details.`,
        propertyId: document.propertyId,
        documentId: document._id,
        status: "waiting_on_client",
        priority: "high",
        visibleToClient: true,
        dueDate: isoDateFromNow(7),
      });
    }
    if (needsReview) {
      const review = await upsertAutoAction(ctx, {
        tenantId: document.tenantId,
        autoKey: `document:${document._id}:review`,
        title: `Review extracted fields: ${document.filename}`,
        description: `Needs review: ${reasons.join("; ")}`,
        propertyId: document.propertyId,
        documentId: document._id,
        status: "open",
        priority: missingFields.length > 0 ? "high" : "medium",
        visibleToClient: false,
        dueDate: isoDateFromNow(2),
      });
      if (review.created) {
        await notify(ctx, {
          recipients: await staffRecipients(ctx, document.tenantId),
          tenantId: document.tenantId,
          kind: "document.review_required",
          title: `Needs review: ${document.filename}`,
          body: reasons.join("; "),
          link: `/documents/${document._id}`,
        });
      }
    } else {
      await notify(ctx, {
        recipients: await staffRecipients(ctx, document.tenantId),
        tenantId: document.tenantId,
        kind: "document.processed",
        title: `Processed: ${document.filename}`,
        body: "All fields extracted with high confidence; ready to approve.",
        link: `/documents/${document._id}`,
      });
    }

    await appendAuditEvent(ctx, {
      tenantId: document.tenantId,
      eventType: "document.processed",
      actorType: "system",
      targetType: "document",
      targetId: document._id,
      correlationId: `document:${document._id}`,
      sourceSystem: "windmill",
      occurredAt: now,
      payloadAfter: JSON.stringify({
        documentType: classified,
        fields: fields.length,
        lowConfidence,
        missingFields,
        windmillJobId: args.jobId,
      }),
    });
  },
});

// --- Actions ---------------------------------------------------------------

export const start = internalAction({
  args: { documentId: v.id("documents"), attemptId: attemptArg },
  handler: async (ctx, args) => {
    const config = windmillConfig();
    if (!config) {
      if (args.attemptId) {
        await ctx.runMutation(internal.processing.markFailed, {
          documentId: args.documentId,
          attemptId: args.attemptId,
          message:
            "Processing connection is not configured; ask your administrator to restore it.",
        });
        return null;
      }
      await ctx.runMutation(internal.processing.markNotConfigured, {
        documentId: args.documentId,
      });
      return null;
    }
    const attemptId: Id<"processingAttempts"> | null =
      args.attemptId ??
      (await ctx.runMutation(internal.processing.claim, {
        documentId: args.documentId,
        submissionJobId: crypto.randomUUID(),
      }));
    if (!attemptId) return null;
    const target = await ctx.runQuery(internal.processing.getForProcessing, {
      documentId: args.documentId,
    });
    const ownedAttempt: Doc<"processingAttempts"> | null = await ctx.runQuery(
      internal.processing.getAttempt,
      { ...args, attemptId },
    );
    if (!ownedAttempt) return null;
    if (!target || (!target.fileUrl && !ownedAttempt.reuseParsedJsonKey)) {
      await ctx.runMutation(internal.processing.markFailed, {
        ...args,
        attemptId,
        message: "The original file is unavailable",
      });
      return null;
    }
    if (
      !(await ctx.runMutation(internal.processing.beginSubmission, {
        ...args,
        attemptId,
      }))
    )
      return null;
    try {
      const jobId = await runFlow(
        config,
        {
          file_url: target.fileUrl ?? "",
          filename: target.document.filename,
          tenant_slug: target.tenantSlug,
          document_id: target.document._id,
          attempt_id: attemptId,
          document_type_hint: target.document.declaredType ?? null,
          do_ocr: true,
          retry_stage: ownedAttempt.retryStage ?? null,
          parsed_json_key: ownedAttempt.reuseParsedJsonKey ?? null,
          parsed_json_bucket:
            ownedAttempt.reuseParsedJsonBucket ?? "parsedinjson",
          reused_knowledge: ownedAttempt.reuseKnowledgeStage
            ? {
                status: ownedAttempt.reuseKnowledgeStage.status,
                bundle_root:
                  ownedAttempt.reuseKnowledgeStage.artifactKey ?? null,
                error: ownedAttempt.reuseKnowledgeStage.error ?? null,
              }
            : null,
        },
        ownedAttempt.submissionJobId,
      );
      await ctx.runMutation(internal.processing.markQueued, {
        ...args,
        attemptId,
        jobId,
      });
    } catch (error) {
      // A 400 can mean the reserved ID already exists; 5xx/network failures are ambiguous.
      const rejected =
        error instanceof SubmissionError &&
        [401, 403, 404, 422].includes(error.status);
      const message = rejected
        ? error.message
        : "Submission could not be confirmed. Checking the reserved job before allowing another attempt.";
      if (rejected)
        await ctx.runMutation(internal.processing.markFailed, {
          ...args,
          attemptId,
          message,
        });
      else
        await ctx.runMutation(internal.processing.markSubmissionUnknown, {
          ...args,
          attemptId,
          message,
        });
    }
    return null;
  },
});

export const recoverSubmission = internalAction({
  args: {
    documentId: v.id("documents"),
    attemptId: v.id("processingAttempts"),
    check: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    const attempt: Doc<"processingAttempts"> | null = await ctx.runQuery(
      internal.processing.getAttempt,
      { documentId: args.documentId, attemptId: args.attemptId },
    );
    if (!attempt || attempt.state === "running") return null;
    if (attempt.state === "claimed") {
      await ctx.runMutation(internal.processing.abandonClaim, {
        documentId: args.documentId,
        attemptId: args.attemptId,
      });
      return null;
    }
    const config = windmillConfig();
    if (config) {
      try {
        const job = await getJob(config, attempt.submissionJobId);
        // Never attach a collision belonging to another flow or attempt.
        if (
          job.script_path === FLOW_PATH &&
          job.args?.attempt_id === args.attemptId
        ) {
          await ctx.runMutation(internal.processing.markQueued, {
            documentId: args.documentId,
            attemptId: args.attemptId,
            jobId: attempt.submissionJobId,
          });
          return null;
        }
      } catch {
        /* A lookup failure cannot prove that no remote job was accepted. */
      }
    }
    await ctx.runMutation(internal.processing.markSubmissionUnknown, {
      documentId: args.documentId,
      attemptId: args.attemptId,
      message:
        args.check >= MAX_POLLS
          ? "Submission remains unconfirmed. Staff must reconcile the reserved Windmill job before retrying; remote execution may still exist."
          : "Checking an unconfirmed submission. Another processing attempt is blocked until the reserved job is reconciled.",
    });
    if (args.check < MAX_POLLS)
      await ctx.scheduler.runAfter(
        POLL_INTERVAL_MS,
        internal.processing.recoverSubmission,
        { ...args, check: args.check + 1 },
      );
    return null;
  },
});

export const poll = internalAction({
  args: {
    documentId: v.id("documents"),
    jobId: v.string(),
    attemptId: attemptArg,
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      args.attemptId &&
      !(await ctx.runQuery(internal.processing.getAttempt, {
        documentId: args.documentId,
        attemptId: args.attemptId,
      }))
    )
      return null;
    const config = windmillConfig();
    if (!config) {
      await ctx.runMutation(internal.processing.markTimedOut, {
        documentId: args.documentId,
        jobId: args.jobId,
        attemptId: args.attemptId,
      });
      return null;
    }
    let job: WindmillJob | null = null;
    try {
      job = await getJob(config, args.jobId);
    } catch {
      /* Keep ownership when a lookup fails. */
    }
    if (job?.flow_status?.modules)
      await ctx.runMutation(internal.processing.updateStageProgress, {
        documentId: args.documentId,
        jobId: args.jobId,
        attemptId: args.attemptId,
        modules: job.flow_status.modules.map((m) => ({
          id: m.id,
          type: m.type,
        })),
      });
    if (job?.type === "CompletedJob") {
      if (job.success)
        await ctx.runMutation(internal.processing.applyResult, {
          documentId: args.documentId,
          jobId: args.jobId,
          attemptId: args.attemptId,
          result: job.result ?? null,
        });
      else {
        const failed = job.flow_status?.modules?.find(
          (m) => m.type === "Failure",
        )?.id;
        const stage =
          failed === "okf"
            ? "knowledge"
            : failed === "extract"
              ? "extract"
              : failed === "parse"
                ? "parse"
                : undefined;
        await ctx.runMutation(internal.processing.markFailed, {
          documentId: args.documentId,
          jobId: args.jobId,
          attemptId: args.attemptId,
          message: describeFailure(job.result),
          stage,
        });
      }
      return null;
    }
    if (job?.flow_status?.modules?.[0]?.type === "Success")
      await ctx.runMutation(internal.processing.markOcrComplete, {
        documentId: args.documentId,
        jobId: args.jobId,
        attemptId: args.attemptId,
      });
    if (args.attempt >= MAX_POLLS) {
      await ctx.runMutation(internal.processing.markTimedOut, {
        documentId: args.documentId,
        jobId: args.jobId,
        attemptId: args.attemptId,
      });
      // Four hours of slower reconciliation; unresolved work remains held after that.
      if (args.attempt < MAX_POLLS + 240)
        await ctx.scheduler.runAfter(60_000, internal.processing.poll, {
          ...args,
          attempt: args.attempt + 1,
        });
      return null;
    }
    await ctx.scheduler.runAfter(POLL_INTERVAL_MS, internal.processing.poll, {
      ...args,
      attempt: args.attempt + 1,
    });
    return null;
  },
});

/** Operator check (`npx convex run processing:checkConnection`): runs the flow on a URL without touching the database. */
export const checkConnection = internalAction({
  args: {
    fileUrl: v.string(),
    filename: v.string(),
    viaConvexStorage: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const config = windmillConfig();
    if (!config) {
      return {
        ok: false,
        error:
          "WINDMILL_BASE_URL / WINDMILL_WORKSPACE / WINDMILL_PROCESSING_TOKEN are not set",
      };
    }
    // Optionally route the file through Convex storage, exactly like a real upload.
    let fileUrl = args.fileUrl;
    let tempStorageId: Id<"_storage"> | null = null;
    if (args.viaConvexStorage) {
      const blob = await (await fetch(args.fileUrl)).blob();
      tempStorageId = await ctx.storage.store(blob);
      fileUrl = (await ctx.storage.getUrl(tempStorageId)) ?? args.fileUrl;
    }
    try {
      return await waitForCheck(config, fileUrl, args.filename);
    } finally {
      if (tempStorageId) await ctx.storage.delete(tempStorageId);
    }
  },
});

async function waitForCheck(
  config: NonNullable<ReturnType<typeof windmillConfig>>,
  fileUrl: string,
  filename: string,
) {
  const jobId = await runFlow(config, {
    file_url: fileUrl,
    filename,
    tenant_slug: "selftest",
    document_id: `check-${Date.now()}`,
    do_ocr: false,
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const job = await getJob(config, jobId);
    if (job.type === "CompletedJob") {
      const result = (job.result ?? {}) as {
        extraction?: { document_type?: string; fields?: unknown[] };
      };
      return {
        ok: job.success === true,
        jobId,
        documentType: result.extraction?.document_type ?? null,
        fieldCount: Array.isArray(result.extraction?.fields)
          ? result.extraction.fields.length
          : 0,
        error: job.success ? null : describeFailure(job.result),
      };
    }
  }
  return { ok: false, jobId, error: "Timed out waiting for the job" };
}
