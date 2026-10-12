import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAuditEvent } from "./lib/audit";
import {
  actorTypeFor,
  getTenantAccess,
  isReadOnlyRole,
  listStaffTenants,
  requireStaff,
  requireTenantAccess,
  requireTenantUploader,
  type TenantAccess,
} from "./lib/auth";
import { notify, staffRecipients } from "./lib/notifications";
import { getClientLabel } from "./lib/portfolio";
import { documentSource, documentStatus, documentType } from "./validators";
import {
  currentFieldQuery,
  fieldBelongsToCurrentExtraction,
  readCurrentFields,
} from "./lib/documentFields";
import { paginationOptsValidator } from "convex/server";
import { clientStageMessage, STAGE_NAMES } from "./lib/processingStages";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Formats Docling can convert.
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/webp",
  "text/csv",
  "text/plain",
  "text/html",
  "text/markdown",
]);

type FileMetadata = {
  _id: Id<"_storage">;
  _creationTime: number;
  contentType?: string;
  sha256: string;
  size: number;
};

function guessContentType(filename: string, reported?: string) {
  if (reported && reported !== "application/octet-stream") {
    return reported.split(";")[0].trim().toLowerCase();
  }
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  const byExtension: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    tif: "image/tiff",
    tiff: "image/tiff",
    webp: "image/webp",
    csv: "text/csv",
    txt: "text/plain",
    md: "text/markdown",
    html: "text/html",
  };
  return byExtension[extension] ?? reported ?? "application/octet-stream";
}

function canManage(access: TenantAccess) {
  return !isReadOnlyRole(access.roleKey);
}

async function toDocumentRow(
  ctx: QueryCtx,
  document: Doc<"documents">,
  isStaff = false,
) {
  const property = document.propertyId
    ? await ctx.db.get(document.propertyId)
    : null;
  const uploader = await ctx.db.get(document.uploadedBy);
  const attempts = await Promise.all(
    [document.activeAttemptId, document.activeRecoveryAttemptId].map((id) =>
      id ? ctx.db.get(id) : null,
    ),
  );
  const active =
    document.processingRemoteUnresolved ||
    attempts.some(
      (a) =>
        a &&
        ["claimed", "submitting", "submission_unknown", "running"].includes(
          a.state,
        ),
    );
  const held =
    document.processingRemoteUnresolved ||
    attempts.some(
      (a) =>
        a &&
        ["claimed", "submitting", "submission_unknown", "running"].includes(
          a.state,
        ) &&
        (a.timedOut || a.state === "submission_unknown"),
    );
  const stageSummary = document.processingStages
    ? STAGE_NAMES.map((name) => {
        const stage = document.processingStages![name];
        return {
          name,
          status: stage.status,
          message: clientStageMessage(name, stage),
          error: isStaff ? stage.error : undefined,
          errorKind: isStaff ? stage.errorKind : undefined,
          startedAt: stage.startedAt,
          completedAt: stage.completedAt,
          reused: stage.reused ?? false,
          canRetry:
            isStaff &&
            !active &&
            ["failed", "partial"].includes(stage.status) &&
            (stage.retryable ||
              stage.status === "partial" ||
              stage.errorKind === "configuration") &&
            (name === "parse" || !!document.parsedJsonKey),
        };
      })
    : [];
  const clientMessage = held
    ? "Processing is taking longer than expected. Your team is checking the existing job; please do not upload a duplicate."
    : document.status === "processing_failed"
      ? "Your team needs to check this document. You can view the original, replace the file, or ask your team for help."
      : document.status === "uploaded" && document.statusMessage
        ? "Your file is safely stored. Automatic processing is unavailable; please contact your team."
        : document.processingIncomplete
          ? "Some of the document could not be read. Your team will check the original before using its details."
          : stageSummary.find((stage) => stage.name === "knowledge")?.message;
  return {
    ...document,
    statusMessage: isStaff ? document.statusMessage : clientMessage,
    processingStages: isStaff ? document.processingStages : undefined,
    processingWarnings: isStaff
      ? document.processingWarnings
      : document.processingIncomplete
        ? ["Your team needs to check incomplete source coverage."]
        : [],
    parsedJsonKey: isStaff ? document.parsedJsonKey : undefined,
    okfBundleRoot: isStaff ? document.okfBundleRoot : undefined,
    stageSummary,
    processingActive: active,
    processingHeld: held,
    canRetryProcessing: !active && document.status === "processing_failed",
    client: await getClientLabel(ctx, document.tenantId),
    property: property
      ? { propertyId: property._id, name: property.name }
      : null,
    uploaderName: uploader?.name ?? uploader?.email ?? "Unknown",
  };
}

function isVisible(document: Doc<"documents">) {
  return !document.deletedAt && !document.replacedByDocumentId;
}

type InsertResult =
  | { documentId: Id<"documents">; error: null }
  | { documentId: null; error: string };

/**
 * Validates an uploaded file and inserts its document record, then queues processing.
 * Rejections return an error instead of throwing: a throw would roll back the storage
 * delete and leave the rejected file orphaned.
 */
async function insertDocument(
  ctx: MutationCtx,
  access: TenantAccess,
  args: {
    tenantId: Id<"tenants">;
    storageId: Id<"_storage">;
    filename: string;
    declaredType?: Doc<"documents">["declaredType"];
    propertyId?: Id<"properties">;
    source: Doc<"documents">["source"];
    replacesDocumentId?: Id<"documents">;
  },
): Promise<InsertResult> {
  const metadata: FileMetadata | null = await ctx.db.system.get(
    "_storage",
    args.storageId,
  );
  if (!metadata) {
    return {
      documentId: null,
      error: "The uploaded file could not be found. Please upload it again.",
    };
  }
  const filename = args.filename.trim().slice(0, 200) || "document";
  const contentType = guessContentType(filename, metadata.contentType);
  let rejection: string | null = null;
  if (metadata.size > MAX_UPLOAD_BYTES) {
    rejection = "Files must be 25 MB or smaller";
  } else if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    rejection =
      "Unsupported file type. Upload a PDF, Word, Excel, image, or text file.";
  } else if (args.propertyId) {
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.tenantId !== args.tenantId) {
      rejection = "That property doesn't belong to this client";
    }
  }
  if (rejection) {
    await ctx.storage.delete(args.storageId);
    return { documentId: null, error: rejection };
  }

  const now = Date.now();
  const documentId = await ctx.db.insert("documents", {
    tenantId: args.tenantId,
    propertyId: args.propertyId,
    filename,
    contentType,
    sizeBytes: metadata.size,
    storageId: args.storageId,
    source: args.source,
    declaredType: args.declaredType,
    status: "uploaded",
    uploadedBy: access.user._id,
    uploaderPrincipal: access.principalType,
    processingAttempts: 0,
    missingFields: [],
    replacesDocumentId: args.replacesDocumentId,
    createdAt: now,
    updatedAt: now,
  });

  await appendAuditEvent(ctx, {
    tenantId: args.tenantId,
    eventType: "document.uploaded",
    actorType: actorTypeFor(access),
    actorId: access.user._id,
    targetType: "document",
    targetId: documentId,
    correlationId: `document:${documentId}`,
    sourceSystem: access.principalType === "client" ? "portal" : "convex",
    occurredAt: now,
    payloadAfter: JSON.stringify({
      filename,
      contentType,
      size: metadata.size,
      source: args.source,
    }),
  });

  if (access.principalType === "client") {
    await notify(ctx, {
      recipients: await staffRecipients(ctx, args.tenantId),
      excludeUserId: access.user._id,
      tenantId: args.tenantId,
      kind: "document.uploaded",
      title: `New client upload: ${filename}`,
      link: `/documents/${documentId}`,
    });
  }

  await ctx.scheduler.runAfter(0, internal.processing.start, { documentId });
  return { documentId, error: null };
}

export const generateUploadUrl = mutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireTenantUploader(ctx, args.tenantId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    storageId: v.id("_storage"),
    filename: v.string(),
    declaredType: v.optional(documentType),
    propertyId: v.optional(v.id("properties")),
    source: documentSource,
  },
  handler: async (ctx, args) => {
    const access = await requireTenantUploader(ctx, args.tenantId);
    return await insertDocument(ctx, access, args);
  },
});

/** Upload a new version; the old record is hidden and linked to the new one. */
export const replace = mutation({
  args: {
    documentId: v.id("documents"),
    storageId: v.id("_storage"),
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.documentId);
    if (!existing || !isVisible(existing)) {
      throw new ConvexError("Document not found");
    }
    const access = await requireTenantUploader(ctx, existing.tenantId);
    const result = await insertDocument(ctx, access, {
      tenantId: existing.tenantId,
      storageId: args.storageId,
      filename: args.filename,
      declaredType: existing.declaredType ?? existing.documentType,
      propertyId: existing.propertyId,
      source: "upload",
      replacesDocumentId: existing._id,
    });
    if (result.documentId) {
      await ctx.db.patch(existing._id, {
        replacedByDocumentId: result.documentId,
        updatedAt: Date.now(),
      });
    }
    return result;
  },
});

export const list = query({
  args: {
    tenantId: v.optional(v.id("tenants")),
    propertyId: v.optional(v.id("properties")),
    status: v.optional(documentStatus),
  },
  handler: async (ctx, args) => {
    let tenantIds: Id<"tenants">[];
    let isStaff = true;
    if (args.tenantId) {
      const access = await requireTenantAccess(ctx, args.tenantId);
      isStaff = access.principalType === "staff";
      tenantIds = [args.tenantId];
    } else {
      const staff = await requireStaff(ctx);
      tenantIds = (await listStaffTenants(ctx, staff)).map(
        (tenant) => tenant._id,
      );
    }

    const rows = [];
    for (const tenantId of tenantIds) {
      const documents = args.status
        ? await ctx.db
            .query("documents")
            .withIndex("by_tenantId_and_status", (q) =>
              q.eq("tenantId", tenantId).eq("status", args.status!),
            )
            .order("desc")
            .take(200)
        : await ctx.db
            .query("documents")
            .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
            .order("desc")
            .take(200);
      for (const document of documents) {
        if (!isVisible(document)) continue;
        if (args.propertyId && document.propertyId !== args.propertyId)
          continue;
        rows.push(await toDocumentRow(ctx, document, isStaff));
      }
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const get = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.deletedAt) {
      return null;
    }
    const access = await getTenantAccess(ctx, document.tenantId);
    if (!access) {
      return null;
    }
    const fields = await readCurrentFields(ctx, document);
    return {
      ...(await toDocumentRow(ctx, document, access.principalType === "staff")),
      fileUrl: await ctx.storage.getUrl(document.storageId),
      fields,
      canManage: canManage(access),
      isStaff: access.principalType === "staff",
    };
  },
});

/** Paged access for larger catalogues. Cursors cannot be reused after reprocessing. */
export const listFields = query({
  args: {
    documentId: v.id("documents"),
    attemptId: v.optional(v.id("processingAttempts")),
    jobId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.deletedAt || document.replacedByDocumentId)
      throw new ConvexError("Document not found");
    await requireTenantAccess(ctx, document.tenantId);
    if (
      document.activeAttemptId !== args.attemptId ||
      document.windmillJobId !== args.jobId
    )
      throw new ConvexError(
        "Processing changed; reload the document before continuing",
      );
    const result = await (
      await currentFieldQuery(ctx, document)
    ).paginate({
      ...args.paginationOpts,
      numItems: Math.min(100, Math.max(1, args.paginationOpts.numItems)),
    });
    return {
      ...result,
      page: result.page.filter((field) =>
        fieldBelongsToCurrentExtraction(document, field),
      ),
    };
  },
});

/** Signed download URL (short-lived) for viewing the original file. */
export const getFileUrl = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.deletedAt) {
      return null;
    }
    const access = await getTenantAccess(ctx, document.tenantId);
    if (!access) {
      return null;
    }
    return await ctx.storage.getUrl(document.storageId);
  },
});

/** Run processing again (retry after a failure, or staff re-process). */
export const reprocess = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || !isVisible(document)) {
      throw new ConvexError("Document not found");
    }
    const access = await requireTenantUploader(ctx, document.tenantId);
    if (document.processingRemoteUnresolved)
      throw new ConvexError(
        "The existing remote job is unresolved. Ask your team to check it before retrying.",
      );
    if (
      access.principalType === "client" &&
      document.status !== "processing_failed"
    ) {
      throw new ConvexError("Only failed documents can be retried");
    }
    for (const attemptId of [
      document.activeAttemptId,
      document.activeRecoveryAttemptId,
    ]) {
      const attempt = attemptId ? await ctx.db.get(attemptId) : null;
      if (
        attempt &&
        ["claimed", "submitting", "submission_unknown", "running"].includes(
          attempt.state,
        )
      ) {
        throw new ConvexError(
          "This processing attempt is still active or awaiting submission reconciliation",
        );
      }
    }
    if (
      document.status === "queued_for_ocr" ||
      document.status === "ocr_complete"
    ) {
      throw new ConvexError("This document is already being processed");
    }
    const now = Date.now();
    await ctx.db.patch(document._id, {
      status: "uploaded",
      statusMessage: undefined,
      windmillJobId: undefined,
      updatedAt: now,
    });
    await appendAuditEvent(ctx, {
      tenantId: document.tenantId,
      eventType: "document.reprocess_requested",
      actorType: actorTypeFor(access),
      actorId: access.user._id,
      targetType: "document",
      targetId: document._id,
      correlationId: `document:${document._id}`,
      sourceSystem: "convex",
      occurredAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.processing.start, {
      documentId: document._id,
    });
    return { documentId: document._id };
  },
});

/** Clients ask for removal; staff delete directly (soft delete, file kept for retention). */
export const requestDeletion = mutation({
  args: { documentId: v.id("documents"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || !isVisible(document)) {
      throw new ConvexError("Document not found");
    }
    const access = await requireTenantUploader(ctx, document.tenantId);
    const now = Date.now();
    const reason = args.reason?.trim().slice(0, 500) || undefined;

    if (access.principalType === "staff") {
      await ctx.db.patch(document._id, {
        deletedAt: now,
        deletedBy: access.user._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(document._id, {
        deletionRequestedAt: now,
        deletionRequestedBy: access.user._id,
        deletionReason: reason,
        updatedAt: now,
      });
    }

    await appendAuditEvent(ctx, {
      tenantId: document.tenantId,
      eventType:
        access.principalType === "staff"
          ? "document.deleted"
          : "document.deletion_requested",
      actorType: actorTypeFor(access),
      actorId: access.user._id,
      targetType: "document",
      targetId: document._id,
      correlationId: `document:${document._id}`,
      sourceSystem: access.principalType === "staff" ? "convex" : "portal",
      occurredAt: now,
      reason,
      payloadBefore: JSON.stringify({ filename: document.filename }),
    });
    return { deleted: access.principalType === "staff" };
  },
});

/** Staff: link a document to a property and/or correct its type. */
export const updateDetails = mutation({
  args: {
    documentId: v.id("documents"),
    propertyId: v.optional(v.id("properties")),
    documentType: v.optional(documentType),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || !isVisible(document)) {
      throw new ConvexError("Document not found");
    }
    const access = await requireTenantAccess(ctx, document.tenantId);
    if (access.principalType !== "staff" || isReadOnlyRole(access.roleKey)) {
      throw new ConvexError(
        "Only Cyphersoft staff can change document details",
      );
    }
    if (args.propertyId) {
      const property = await ctx.db.get(args.propertyId);
      if (!property || property.tenantId !== document.tenantId) {
        throw new ConvexError("That property doesn't belong to this client");
      }
    }
    const now = Date.now();
    await ctx.db.patch(document._id, {
      propertyId: args.propertyId,
      documentType: args.documentType ?? document.documentType,
      updatedAt: now,
    });
    await appendAuditEvent(ctx, {
      tenantId: document.tenantId,
      eventType: "document.details_updated",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "document",
      targetId: document._id,
      correlationId: `document:${document._id}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadBefore: JSON.stringify({
        propertyId: document.propertyId,
        documentType: document.documentType,
      }),
      payloadAfter: JSON.stringify({
        propertyId: args.propertyId,
        documentType: args.documentType,
      }),
    });
    return { documentId: document._id };
  },
});
