import { ConvexError, v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { boundedText } from "./lib/signing";
import { appendSigningEvent } from "./lib/signingAudit";
import { signingFileAccess } from "./lib/signingFileAccess";
import { secureUrl, shortWorker } from "./lib/signingWorker";
import { getAgreement, requireSigningWriter } from "./signing";

/** Metadata only. Supporting documents are never OCR'd or passed to assistants. */
export const list = query({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const { agreement } = await signingFileAccess(ctx, args.agreementId);
    const rows = await ctx.db
      .query("signingAttachments")
      .withIndex("by_agreementId", (q) => q.eq("agreementId", agreement._id))
      .order("desc")
      .take(100);
    return rows.map((row) => ({
      id: row._id,
      participantKey: row.participantKey,
      fieldKey: row.fieldKey,
      purpose: row.purpose,
      filename: row.filename,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      status: row.status,
      createdAt: row.createdAt,
      sha256: row.sha256,
      scannedAt: row.scannedAt,
    }));
  },
});

/** Staff access needs signing authority, recent MFA and a stated reason; the access is audited first. */
export const authorize = internalMutation({
  args: { attachmentId: v.id("signingAttachments"), reason: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attachmentId);
    if (!row) throw new ConvexError("Supporting document not found");
    const agreement = await getAgreement(ctx, row.agreementId);
    const user = await requireSigningWriter(ctx, agreement.tenantId);
    if (
      row.tenantId !== agreement.tenantId ||
      row.status !== "clean" ||
      !row.sha256
    )
      throw new ConvexError(
        "Only scanned, accepted supporting documents can be opened",
      );
    if (!row.retainUntil || row.retainUntil <= Date.now())
      throw new ConvexError(
        "This supporting document is past its retention period",
      );
    const reason = boundedText(args.reason, "Access reason", 500);
    if (reason.length < 10)
      throw new ConvexError(
        "Describe why you need this document (at least 10 characters)",
      );
    await appendSigningEvent(
      ctx,
      agreement,
      user._id,
      "supporting_document_accessed",
      {
        attachmentId: row._id,
        participantKey: row.participantKey,
        purpose: row.purpose,
        reason,
      },
    );
    return row;
  },
});

export const open = action({
  args: { attachmentId: v.id("signingAttachments"), reason: v.string() },
  handler: async (ctx, args): Promise<{ url: string; expiresAt: number }> => {
    const row: Doc<"signingAttachments"> = await ctx.runMutation(
      internal.signingAttachments.authorize,
      args,
    );
    const result = await shortWorker(
      "attachment_download",
      row.tenantId,
      row.agreementId,
      {
        attachmentId: row._id,
        contentType: row.contentType,
        storageVersion: row.storageVersion,
        sha256: row.sha256,
      },
    );
    if (
      result.status !== "download" ||
      typeof result.expiresAt !== "number" ||
      result.expiresAt <= Date.now() ||
      result.expiresAt > Date.now() + 65_000
    )
      throw new ConvexError("The document link could not be prepared. Retry");
    return { url: secureUrl(result.url), expiresAt: result.expiresAt };
  },
});
