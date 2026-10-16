import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { getTenantAccess, requireTenantAccess } from "./lib/auth";
import {
  MAX_PREVIEW_BYTES,
  PREVIEW_BUDGET_MS,
  PREVIEW_VERSION,
  previewKind,
} from "./lib/documentPreview";

const previewArgs = { previewId: v.id("documentPreviews") };
const UNAVAILABLE =
  "This document is unavailable or you do not have access to it.";
const FAILED =
  "The preview could not be prepared. Retry, or download the original document.";
const TIMED_OUT =
  "Preparing the preview took too long. Retry, or download the original document.";

function config() {
  const base = process.env.WINDMILL_BASE_URL?.replace(/\/+$/, "");
  const workspace = process.env.WINDMILL_WORKSPACE;
  const token = process.env.WINDMILL_PREVIEW_TOKEN;
  return base && workspace && token
    ? { base: `${base}/api/w/${workspace}`, token }
    : null;
}

/** File-only access: never reads or returns extracted fields or processing errors. */
export const view = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const document = await ctx.db.get(documentId);
    if (!document || document.deletedAt) return null;
    const access = await getTenantAccess(ctx, document.tenantId);
    if (!access) return null;
    const preview = document.previewId
      ? await ctx.db.get(document.previewId)
      : null;
    const valid =
      preview?.sourceStorageId === document.storageId &&
      preview.rendererVersion === PREVIEW_VERSION;
    return {
      documentId,
      filename: document.filename,
      contentType: document.contentType,
      kind: previewKind(document.contentType, document.filename),
      originalUrl: await ctx.storage.getUrl(document.storageId),
      isStaff: access.principalType === "staff",
      previewStatus: valid ? preview.status : null,
      previewUrl:
        valid && preview.status === "ready" && preview.storageId
          ? await ctx.storage.getUrl(preview.storageId)
          : null,
      previewError: valid ? (preview.error ?? null) : null,
    };
  },
});

export const request = mutation({
  args: { documentId: v.id("documents"), retry: v.optional(v.boolean()) },
  handler: async (ctx, { documentId, retry }) => {
    const document = await ctx.db.get(documentId);
    if (!document || document.deletedAt) throw new ConvexError(UNAVAILABLE);
    await requireTenantAccess(ctx, document.tenantId);
    if (previewKind(document.contentType, document.filename) !== "converted")
      return null;
    const previous = document.previewId
      ? await ctx.db.get(document.previewId)
      : null;
    if (
      previous?.sourceStorageId === document.storageId &&
      previous.rendererVersion === PREVIEW_VERSION
    ) {
      const missingOutput =
        previous.status === "ready" &&
        (!previous.storageId || !(await ctx.db.system.get(previous.storageId)));
      if (!retry || (previous.status !== "failed" && !missingOutput))
        return previous._id;
    }
    const previewId = await ctx.db.insert("documentPreviews", {
      documentId,
      sourceStorageId: document.storageId,
      rendererVersion: PREVIEW_VERSION,
      status: "preparing",
      createdAt: Date.now(),
    });
    await ctx.db.patch(documentId, { previewId });
    await ctx.scheduler.runAfter(0, internal.documentPreviews.start, {
      previewId,
    });
    await ctx.scheduler.runAfter(
      PREVIEW_BUDGET_MS,
      internal.documentPreviews.fail,
      { previewId, timeout: true },
    );
    return previewId;
  },
});

export const work = internalQuery({
  args: previewArgs,
  handler: async (ctx, { previewId }) => {
    const preview = await ctx.db.get(previewId);
    if (!preview) return null;
    const document = await ctx.db.get(preview.documentId);
    return {
      preview,
      active: Boolean(
        document &&
        !document.deletedAt &&
        document.previewId === previewId &&
        document.storageId === preview.sourceStorageId &&
        preview.status === "preparing",
      ),
      filename: document?.filename ?? "document",
      fileUrl: await ctx.storage.getUrl(preview.sourceStorageId),
    };
  },
});

/** Reserves a remote job and polling before any network submission. */
export const prepare = internalMutation({
  args: { ...previewArgs, jobId: v.string() },
  handler: async (ctx, { previewId, jobId }) => {
    const preview = await ctx.db.get(previewId);
    if (!preview || preview.status !== "preparing" || preview.jobId)
      return null;
    const document = await ctx.db.get(preview.documentId);
    if (
      !document ||
      document.deletedAt ||
      document.previewId !== previewId ||
      document.storageId !== preview.sourceStorageId
    )
      return null;
    await ctx.db.patch(previewId, { jobId });
    await ctx.scheduler.runAfter(10_000, internal.documentPreviews.poll, {
      previewId,
      check: 0,
    });
    return await ctx.storage.generateUploadUrl();
  },
});

export const fail = internalMutation({
  args: {
    ...previewArgs,
    timeout: v.optional(v.boolean()),
    configuration: v.optional(v.boolean()),
  },
  handler: async (ctx, { previewId, timeout, configuration }) => {
    const preview = await ctx.db.get(previewId);
    if (!preview || preview.status !== "preparing") return;
    await ctx.db.patch(previewId, {
      status: "failed",
      error: configuration
        ? "Document preview conversion is not configured. Contact your administrator, or download the original."
        : timeout
          ? TIMED_OUT
          : FAILED,
    });
  },
});

export const complete = internalMutation({
  args: { ...previewArgs, storageId: v.id("_storage") },
  handler: async (ctx, { previewId, storageId }) => {
    const preview = await ctx.db.get(previewId);
    if (!preview) return;
    if (preview.status === "ready" && preview.storageId === storageId) return;
    // Never delete originals, even if a malformed remote result references one.
    if (storageId === preview.sourceStorageId) return;
    const document = await ctx.db.get(preview.documentId);
    const metadata = await ctx.db.system.get(storageId);
    const valid =
      metadata?.contentType === "application/pdf" &&
      metadata.size <= MAX_PREVIEW_BYTES;
    if (
      !document ||
      document.deletedAt ||
      document.previewId !== previewId ||
      document.storageId !== preview.sourceStorageId ||
      preview.status !== "preparing" ||
      Date.now() >= preview.createdAt + PREVIEW_BUDGET_MS ||
      !valid
    ) {
      if (metadata) await ctx.storage.delete(storageId);
      if (preview.status === "preparing")
        await ctx.db.patch(previewId, { status: "failed", error: FAILED });
      return;
    }
    await ctx.db.patch(previewId, {
      status: "ready",
      storageId,
      error: undefined,
    });
  },
});

export const start = internalAction({
  args: previewArgs,
  handler: async (ctx, args) => {
    const connection = config();
    if (!connection) {
      await ctx.runMutation(internal.documentPreviews.fail, {
        ...args,
        configuration: true,
      });
      return;
    }
    const target = await ctx.runQuery(internal.documentPreviews.work, args);
    if (!target?.active || !target.fileUrl) {
      await ctx.runMutation(internal.documentPreviews.fail, args);
      return;
    }
    const jobId = crypto.randomUUID();
    const uploadUrl: string | null = await ctx.runMutation(
      internal.documentPreviews.prepare,
      { ...args, jobId },
    );
    if (!uploadUrl) return;
    try {
      const response = await fetch(
        `${connection.base}/jobs/run/p/f/docling/render_document_preview?job_id=${jobId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${connection.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            file_url: target.fileUrl,
            filename: target.filename,
            upload_url: uploadUrl,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok && response.status >= 400 && response.status < 500) {
        await ctx.runMutation(internal.documentPreviews.fail, args);
      }
      // An uncertain submission is polled by its reserved ID; never resubmit blindly.
    } catch {
      /* The watchdog and reserved-job polling handle ambiguous submissions. */
    }
  },
});

export const poll = internalAction({
  args: { ...previewArgs, check: v.number() },
  handler: async (ctx, { previewId, check }) => {
    const target = await ctx.runQuery(internal.documentPreviews.work, {
      previewId,
    });
    const connection = config();
    if (
      !target?.preview.jobId ||
      !connection ||
      target.preview.status === "ready"
    )
      return;
    try {
      const response = await fetch(
        `${connection.base}/jobs_u/get/${target.preview.jobId}`,
        {
          headers: { Authorization: `Bearer ${connection.token}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (response.ok) {
        const job = (await response.json()) as {
          type?: string;
          success?: boolean;
          result?: { storage_id?: string };
        };
        if (job.type === "CompletedJob" || typeof job.success === "boolean") {
          if (job.success && job.result?.storage_id) {
            await ctx.runMutation(internal.documentPreviews.complete, {
              previewId,
              storageId: job.result.storage_id as Id<"_storage">,
            });
          } else
            await ctx.runMutation(internal.documentPreviews.fail, {
              previewId,
            });
          return;
        }
      }
    } catch {
      /* Retry boundedly; no raw provider errors are sent to viewers. */
    }
    // Continue collecting late outputs for cleanup after the UI deadline (up to one hour).
    if (check < 85)
      await ctx.scheduler.runAfter(
        check < 30 ? 10_000 : 60_000,
        internal.documentPreviews.poll,
        { previewId, check: check + 1 },
      );
  },
});

/** Operator-only production smoke test. Creates no application records and removes its files. */
export const checkConnection = internalAction({
  args: { filename: v.string(), inputBase64: v.string() },
  handler: async (ctx, { filename, inputBase64 }) => {
    const connection = config();
    if (!connection) throw new Error("Preview connection is not configured");
    const types: Record<string, string> = {
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      tif: "image/tiff",
      tiff: "image/tiff",
    };
    const contentType = types[filename.toLowerCase().split(".").pop() ?? ""];
    if (!contentType || inputBase64.length > 35_000_000)
      throw new Error("Unsupported fixture");
    const bytes = Uint8Array.from(atob(inputBase64), (character) =>
      character.charCodeAt(0),
    );
    const originalId = await ctx.storage.store(
      new Blob([bytes], { type: contentType }),
    );
    let outputId: Id<"_storage"> | undefined;
    try {
      const fileUrl = await ctx.storage.getUrl(originalId);
      const uploadUrl = await ctx.storage.generateUploadUrl();
      const jobId = crypto.randomUUID();
      const response = await fetch(
        `${connection.base}/jobs/run/p/f/docling/render_document_preview?job_id=${jobId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${connection.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            file_url: fileUrl,
            filename,
            upload_url: uploadUrl,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok)
        throw new Error(`Preview submission failed (${response.status})`);
      const deadline = Date.now() + PREVIEW_BUDGET_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const status = await fetch(`${connection.base}/jobs_u/get/${jobId}`, {
          headers: { Authorization: `Bearer ${connection.token}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!status.ok)
          throw new Error(
            `Preview polling failed (${status.status}); job ${jobId}`,
          );
        const job = (await status.json()) as {
          success?: boolean;
          result?: { storage_id?: string };
        };
        if (typeof job.success !== "boolean") continue;
        if (!job.success || !job.result?.storage_id)
          throw new Error(`Preview conversion failed; job ${jobId}`);
        outputId = job.result.storage_id as Id<"_storage">;
        const output = await ctx.storage.get(outputId);
        if (
          !output ||
          output.size > MAX_PREVIEW_BYTES ||
          (await output.slice(0, 5).text()) !== "%PDF-"
        ) {
          throw new Error(`Invalid PDF preview; job ${jobId}`);
        }
        return {
          ok: true,
          jobId,
          outputBytes: output.size,
          outputType: output.type,
        };
      }
      throw new Error(
        `Preview test timed out; inspect job ${jobId} for a late output`,
      );
    } finally {
      await ctx.storage.delete(originalId);
      if (outputId && outputId !== originalId)
        await ctx.storage.delete(outputId);
    }
  },
});
