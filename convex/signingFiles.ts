import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  signingFileAccess,
  assertPreparationIdle,
} from "./lib/signingFileAccess";
import { appendSigningEvent } from "./lib/signingAudit";
import {
  fileRole,
  MAX_SIGNING_FILE_BYTES,
  MAX_SIGNING_FILES,
  ACTIVE_PREPARATION,
} from "./lib/signingPreparation";
import {
  documentsConfigured,
  secureUrl,
  shortWorker,
} from "./lib/signingWorker";

const activeFiles = (
  ctx: Parameters<typeof signingFileAccess>[0],
  agreementId: Doc<"signingAgreements">["_id"],
) =>
  ctx.db
    .query("signingFiles")
    .withIndex("by_agreementId_and_active", (q) =>
      q.eq("agreementId", agreementId).eq("active", true),
    )
    .collect();
function checkRevision(agreement: Doc<"signingAgreements">, expected: number) {
  if ((agreement.fileRevision ?? 0) !== expected)
    throw new ConvexError("Files changed. Reload before trying again");
}

export const reserveUpload = mutation({
  args: {
    agreementId: v.id("signingAgreements"),
    expectedRevision: v.number(),
    requestId: v.string(),
    filename: v.string(),
    role: fileRole,
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const { agreement, user } = await signingFileAccess(
      ctx,
      args.agreementId,
      true,
    );
    await assertPreparationIdle(ctx, agreement);
    if (agreement.revision !== args.expectedRevision)
      throw new ConvexError("Draft changed. Reload before uploading");
    if (
      !/^[A-Za-z0-9_-]{8,100}$/.test(args.requestId) ||
      !/\.pdf$/i.test(args.filename) ||
      args.filename.length > 180 ||
      /[\x00-\x1f\x7f/\\]/.test(args.filename) ||
      !Number.isSafeInteger(args.sizeBytes) ||
      args.sizeBytes < 1 ||
      args.sizeBytes > MAX_SIGNING_FILE_BYTES
    )
      throw new ConvexError("Choose a PDF up to 25 MB with a valid filename");
    const old = await ctx.db
      .query("signingUploads")
      .withIndex("by_agreementId_and_createdBy_and_requestId", (q) =>
        q
          .eq("agreementId", agreement._id)
          .eq("createdBy", user._id)
          .eq("requestId", args.requestId),
      )
      .unique();
    if (old) {
      if (
        old.filename !== args.filename ||
        old.expectedSize !== args.sizeBytes ||
        old.role !== args.role
      )
        throw new ConvexError(
          "Upload request was already used for another file",
        );
      return { uploadId: old._id, expiresAt: old.expiresAt };
    }
    const files = await activeFiles(ctx, agreement._id);
    if (
      files.length >= MAX_SIGNING_FILES ||
      (args.role === "primary" && files.some((f) => f.role === "primary"))
    )
      throw new ConvexError(
        "A bundle allows one primary PDF and up to nine annexures",
      );
    const pending = await ctx.db
      .query("signingUploads")
      .withIndex("by_agreementId_and_state", (q) =>
        q.eq("agreementId", agreement._id).eq("state", "pending"),
      )
      .order("desc")
      .take(100);
    if (pending.filter((row) => row.expiresAt > Date.now()).length >= 20)
      throw new ConvexError(
        "Too many pending uploads. Wait for existing tickets to expire",
      );
    const expiresAt = Date.now() + 300_000;
    const uploadId = await ctx.db.insert("signingUploads", {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      revisionId: agreement.currentRevisionId!,
      createdBy: user._id,
      requestId: args.requestId,
      filename: args.filename,
      role: args.role,
      expectedSize: args.sizeBytes,
      expiresAt,
      state: "pending",
    });
    return { uploadId, expiresAt };
  },
});

export const uploadContext = internalQuery({
  args: { uploadId: v.id("signingUploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload) throw new ConvexError("Upload not found");
    const { agreement, user } = await signingFileAccess(
      ctx,
      upload.agreementId,
      true,
    );
    await assertPreparationIdle(ctx, agreement);
    if (upload.createdBy !== user._id || upload.tenantId !== agreement.tenantId)
      throw new ConvexError("Upload access denied");
    if (
      upload.state !== "attached" &&
      (upload.expiresAt <= Date.now() ||
        upload.revisionId !== agreement.currentRevisionId)
    )
      throw new ConvexError(
        "Upload ticket expired or draft changed. Select the file again",
      );
    return upload;
  },
});
export const getUploadForm = action({
  args: { uploadId: v.id("signingUploads") },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; fields: Record<string, string> }> => {
    const upload: Doc<"signingUploads"> = await ctx.runQuery(
      internal.signingFiles.uploadContext,
      args,
    );
    if (upload.state === "attached")
      throw new ConvexError("File already attached");
    const result = await shortWorker(
      "upload",
      upload.tenantId,
      upload.agreementId,
      { uploadId: upload._id, sizeBytes: upload.expectedSize },
    );
    await ctx.runQuery(internal.signingFiles.uploadContext, args);
    if (
      result.status !== "upload" ||
      !result.fields ||
      typeof result.fields !== "object" ||
      Array.isArray(result.fields)
    )
      throw new ConvexError("Invalid upload form");
    const fields = result.fields as Record<string, string>;
    if (
      Object.keys(fields).length > 30 ||
      Object.entries(fields).some(
        ([k, value]) =>
          k.length > 200 || typeof value !== "string" || value.length > 20_000,
      )
    )
      throw new ConvexError("Invalid upload form");
    const key = `quarantine/${upload.tenantId}/${upload.agreementId}/${upload._id}.pdf`;
    if (fields.key !== key || fields["Content-Type"] !== "application/pdf")
      throw new ConvexError("Upload form identity mismatch");
    return { url: secureUrl(result.url), fields };
  },
});
export const attach = internalMutation({
  args: {
    uploadId: v.id("signingUploads"),
    sourceVersion: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args): Promise<Doc<"signingFiles">["_id"]> => {
    // Recheck the original caller's current permissions after the network request.
    const upload: Doc<"signingUploads"> = await ctx.runQuery(
      internal.signingFiles.uploadContext,
      { uploadId: args.uploadId },
    );
    if (upload.state === "attached") return upload.fileId!;
    if (
      !args.sourceVersion ||
      args.sourceVersion === "null" ||
      args.sourceVersion.length > 1024 ||
      /[\r\n]/.test(args.sourceVersion) ||
      args.sizeBytes !== upload.expectedSize
    )
      throw new ConvexError("Upload version could not be verified");
    const { agreement, user } = await signingFileAccess(
      ctx,
      upload.agreementId,
      true,
    );
    const files = await activeFiles(ctx, agreement._id);
    if (
      files.length >= MAX_SIGNING_FILES ||
      (upload.role === "primary" && files.some((f) => f.role === "primary"))
    )
      throw new ConvexError(
        "Remove the existing primary PDF or excess annexures first",
      );
    const fileId = await ctx.db.insert("signingFiles", {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      uploadId: upload._id,
      filename: upload.filename,
      role: upload.role,
      sizeBytes: args.sizeBytes,
      sourceVersion: args.sourceVersion,
      position:
        upload.role === "primary"
          ? -1
          : Math.max(0, ...files.map((f) => f.position)) + 1,
      active: true,
      createdAt: Date.now(),
      createdBy: user._id,
    });
    await ctx.db.patch(upload._id, { state: "attached", fileId });
    await ctx.db.patch(agreement._id, {
      fileRevision: (agreement.fileRevision ?? 0) + 1,
      currentBundleId: undefined,
      currentLayoutId: undefined,
      frozenPreparationId: undefined,
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
    await appendSigningEvent(ctx, agreement, user._id, "pdf_quarantined", {
      fileId,
      uploadId: upload._id,
      sizeBytes: args.sizeBytes,
      role: upload.role,
    });
    return fileId;
  },
});
export const completeUpload = action({
  args: { uploadId: v.id("signingUploads") },
  handler: async (ctx, args): Promise<Doc<"signingFiles">["_id"]> => {
    const upload: Doc<"signingUploads"> = await ctx.runQuery(
      internal.signingFiles.uploadContext,
      args,
    );
    if (upload.fileId) return upload.fileId;
    const result = await shortWorker(
      "stat",
      upload.tenantId,
      upload.agreementId,
      { uploadId: upload._id, sizeBytes: upload.expectedSize },
    );
    if (
      result.status !== "quarantined" ||
      typeof result.sourceVersion !== "string" ||
      result.sizeBytes !== upload.expectedSize
    )
      throw new ConvexError("File upload could not be verified");
    return await ctx.runMutation(internal.signingFiles.attach, {
      ...args,
      sourceVersion: result.sourceVersion,
      sizeBytes: upload.expectedSize,
    });
  },
});

export const changeFiles = mutation({
  args: {
    agreementId: v.id("signingAgreements"),
    expectedFileRevision: v.number(),
    orderedFileIds: v.array(v.id("signingFiles")),
    removeFileId: v.optional(v.id("signingFiles")),
  },
  handler: async (ctx, args) => {
    const { agreement, user } = await signingFileAccess(
      ctx,
      args.agreementId,
      true,
    );
    await assertPreparationIdle(ctx, agreement);
    checkRevision(agreement, args.expectedFileRevision);
    const files = await activeFiles(ctx, agreement._id);
    if (args.removeFileId && !files.some((f) => f._id === args.removeFileId))
      throw new ConvexError("File not found");
    const remaining = files.filter((f) => f._id !== args.removeFileId);
    if (
      new Set(args.orderedFileIds).size !== remaining.length ||
      args.orderedFileIds.length !== remaining.length ||
      args.orderedFileIds.some((id) => !remaining.some((f) => f._id === id)) ||
      remaining.some(
        (f) => f.role === "primary" && args.orderedFileIds[0] !== f._id,
      )
    )
      throw new ConvexError(
        "Provide the complete file order, with the primary PDF first",
      );
    if (args.removeFileId)
      await ctx.db.patch(args.removeFileId, { active: false });
    for (const [position, id] of args.orderedFileIds.entries())
      await ctx.db.patch(id, { position });
    await ctx.db.patch(agreement._id, {
      fileRevision: (agreement.fileRevision ?? 0) + 1,
      currentBundleId: undefined,
      currentLayoutId: undefined,
      frozenPreparationId: undefined,
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
    await appendSigningEvent(ctx, agreement, user._id, "bundle_files_changed", {
      orderedFileIds: args.orderedFileIds,
      ...(args.removeFileId ? { removedFileId: args.removeFileId } : {}),
    });
    return null;
  },
});

export const list = query({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const { agreement } = await signingFileAccess(ctx, args.agreementId);
    const files = (await activeFiles(ctx, agreement._id)).sort(
      (a, b) => a.position - b.position,
    );
    const attempt = agreement.bundleAttemptId
      ? await ctx.db.get(agreement.bundleAttemptId)
      : null;
    const storedBundle = agreement.currentBundleId
      ? await ctx.db.get(agreement.currentBundleId)
      : null;
    const bundle =
      storedBundle &&
      storedBundle.tenantId === agreement.tenantId &&
      storedBundle.agreementId === agreement._id &&
      storedBundle.revisionId === agreement.currentRevisionId &&
      storedBundle.fileRevision === (agreement.fileRevision ?? 0) &&
      (storedBundle.retainUntil ?? 0) > Date.now()
        ? storedBundle
        : null;
    return {
      files: files.map((f) => ({
        id: f._id,
        filename: f.filename,
        role: f.role,
        sizeBytes: f.sizeBytes,
      })),
      fileRevision: agreement.fileRevision ?? 0,
      configured: documentsConfigured(),
      busy: Boolean(attempt && ACTIVE_PREPARATION.has(attempt.status)),
      attempt: attempt
        ? {
            id: attempt._id,
            status: attempt.status,
            error: attempt.error,
            waitingTimedOut: attempt.waitingTimedOut,
          }
        : null,
      bundle: bundle
        ? {
            id: bundle._id,
            pdfHash: bundle.pdfHash,
            manifestHash: bundle.manifestHash,
            pageCount: bundle.pages?.length ?? 0,
            sizeBytes: bundle.sizeBytes,
            validatedAt: bundle.validatedAt,
          }
        : null,
    };
  },
});
export const downloadContext = internalQuery({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const { agreement } = await signingFileAccess(ctx, args.agreementId);
    const bundle = agreement.currentBundleId
      ? await ctx.db.get(agreement.currentBundleId)
      : null;
    if (
      !bundle ||
      bundle.tenantId !== agreement.tenantId ||
      bundle.agreementId !== agreement._id ||
      bundle.revisionId !== agreement.currentRevisionId ||
      bundle.fileRevision !== (agreement.fileRevision ?? 0) ||
      !bundle.attemptId ||
      !bundle.manifestVersion ||
      !bundle.retainUntil ||
      bundle.retainUntil <= Date.now()
    )
      throw new ConvexError(
        "Prepare and validate the current PDF bundle first",
      );
    return bundle;
  },
});
export const getPreparedUrl = action({
  args: {
    agreementId: v.id("signingAgreements"),
    expectedBundleId: v.optional(v.id("signingBundles")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; expiresAt: number; pdfHash: string }> => {
    const bundle: Doc<"signingBundles"> = await ctx.runQuery(
      internal.signingFiles.downloadContext,
      { agreementId: args.agreementId },
    );
    if (args.expectedBundleId && bundle._id !== args.expectedBundleId)
      throw new ConvexError("Prepared PDF changed. Reload before viewing");
    const result = await shortWorker(
      "download",
      bundle.tenantId,
      bundle.agreementId,
      {
        attemptId: bundle.attemptId,
        manifestVersion: bundle.manifestVersion,
        manifestHash: bundle.manifestHash,
        storageVersion: bundle.storageVersion,
        pdfHash: bundle.pdfHash,
      },
    );
    const current: Doc<"signingBundles"> = await ctx.runQuery(
      internal.signingFiles.downloadContext,
      { agreementId: args.agreementId },
    );
    if (
      current._id !== bundle._id ||
      result.status !== "download" ||
      typeof result.expiresAt !== "number" ||
      result.expiresAt <= Date.now() ||
      result.expiresAt > Date.now() + 65_000
    )
      throw new ConvexError("Prepared file changed or link expired. Retry");
    return {
      url: secureUrl(result.url),
      expiresAt: result.expiresAt,
      pdfHash: bundle.pdfHash,
    };
  },
});
