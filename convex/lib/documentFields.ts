import { ConvexError } from "convex/values";
import { Doc } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";

type ReadCtx = QueryCtx | MutationCtx;
const REVIEWABLE = new Set([
  "extraction_complete",
  "review_required",
  "approved",
]);
// Processing currently accepts at most 100 fields. Allow larger legacy catalogues,
// but never silently truncate a review or a record update.
const MAX_CURRENT_FIELDS = 1000;

export function fieldBelongsToCurrentExtraction(
  document: Doc<"documents">,
  field: Doc<"extractedFields">,
) {
  return (
    !document.deletedAt &&
    !document.replacedByDocumentId &&
    REVIEWABLE.has(document.status) &&
    field.documentId === document._id &&
    field.tenantId === document.tenantId &&
    field.state !== "superseded" &&
    (field.attemptId
      ? field.attemptId === document.activeAttemptId
      : !!document.windmillJobId &&
        field.windmillJobId === document.windmillJobId)
  );
}

export async function currentFieldQuery(
  ctx: ReadCtx,
  document: Doc<"documents">,
) {
  if (document.activeAttemptId) {
    const owned = () =>
      ctx.db
        .query("extractedFields")
        .withIndex("by_documentId_and_attemptId", (q) =>
          q
            .eq("documentId", document._id)
            .eq("attemptId", document.activeAttemptId),
        );
    // Phase 1 completions have a document attempt but untagged fields. Fall back
    // only when no tagged fields exist, and only to the exact current job.
    if (await owned().first()) return owned();
  }
  return ctx.db
    .query("extractedFields")
    .withIndex("by_documentId_and_windmillJobId", (q) =>
      q
        .eq("documentId", document._id)
        .eq("windmillJobId", document.windmillJobId ?? ""),
    );
}

export async function isCurrentField(
  ctx: ReadCtx,
  document: Doc<"documents">,
  field: Doc<"extractedFields">,
) {
  if (!fieldBelongsToCurrentExtraction(document, field)) return false;
  if (document.activeAttemptId && !field.attemptId) {
    const tagged = await ctx.db
      .query("extractedFields")
      .withIndex("by_documentId_and_attemptId", (q) =>
        q
          .eq("documentId", document._id)
          .eq("attemptId", document.activeAttemptId),
      )
      .first();
    return tagged === null;
  }
  return true;
}

export async function readCurrentFields(
  ctx: ReadCtx,
  document: Doc<"documents">,
) {
  if (
    document.deletedAt ||
    document.replacedByDocumentId ||
    !REVIEWABLE.has(document.status)
  )
    return [];
  const rows = await (
    await currentFieldQuery(ctx, document)
  ).take(MAX_CURRENT_FIELDS + 1);
  if (rows.length > MAX_CURRENT_FIELDS) {
    throw new ConvexError(
      "This extraction exceeds the supported review size; contact your processing operator. Fields have not been truncated.",
    );
  }
  return rows.filter((field) =>
    fieldBelongsToCurrentExtraction(document, field),
  );
}
