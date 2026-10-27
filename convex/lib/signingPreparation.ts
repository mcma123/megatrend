import { z } from "zod";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

export const MAX_SIGNING_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_SIGNING_INPUT_BYTES = 75 * 1024 * 1024;
export const MAX_SIGNING_OUTPUT_BYTES = 50 * 1024 * 1024;
export const MAX_SIGNING_FILES = 10;
export const MAX_SIGNING_PAGES = 200;
export const PREPARATION_RENDERER = "pypdf-flat-v1";
export const fileRole = v.union(v.literal("primary"), v.literal("annexure"));
export const preparationStatus = v.union(
  v.literal("queued"),
  v.literal("submitting"),
  v.literal("running"),
  v.literal("submission_unknown"),
  v.literal("failed"),
  v.literal("ready"),
  v.literal("superseded"),
);
export const ACTIVE_PREPARATION = new Set([
  "queued",
  "submitting",
  "running",
  "submission_unknown",
]);
export const preparationErrors = [
  "not_configured",
  "transfer_failed",
  "malware_detected",
  "scanner_unavailable",
  "invalid_pdf",
  "encrypted_pdf",
  "signed_pdf",
  "unsupported_pdf",
  "unsupported_file",
  "limit_exceeded",
  "source_changed",
  "storage_failed",
  "preparation_failed",
  "result_invalid",
] as const;
export type PreparationError = (typeof preparationErrors)[number];
export const preparationError = v.union(
  ...preparationErrors.map((code) => v.literal(code)),
);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const version = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => value !== "null" && !/[\r\n]/.test(value));
const box = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const pageSchema = z
  .object({
    pageIndex: z.number().int().min(0).max(199),
    sourceFileId: identity,
    sourcePageIndex: z.number().int().min(0).max(199),
    mediaBox: box,
    cropBox: box,
    rotation: z.union([
      z.literal(0),
      z.literal(90),
      z.literal(180),
      z.literal(270),
    ]),
    userUnit: z.number().finite().positive().max(10),
    widthPt: z.number().finite().positive().max(14400),
    heightPt: z.number().finite().positive().max(14400),
  })
  .strict();
export const sourceSchema = z
  .object({
    fileId: identity,
    uploadId: identity,
    sourceVersion: version,
    sizeBytes: z.number().int().positive().max(MAX_SIGNING_FILE_BYTES),
    sha256: hash,
    role: z.enum(["primary", "annexure"]),
    pageStartIndex: z.number().int().min(0).max(199),
    pageCount: z.number().int().positive().max(200),
    scanEngine: z.literal("ClamAV"),
    scanVersion: z.string().min(1).max(160),
    scannedAt: z.number().int().positive(),
  })
  .strict();
export const manifestSchema = z
  .object({
    contractVersion: z.literal(1),
    tenantId: identity,
    agreementId: identity,
    attemptId: identity,
    inputDigest: hash,
    rendererVersion: z.string().startsWith(`${PREPARATION_RENDERER}:`).max(100),
    pdfHash: hash,
    sizeBytes: z.number().int().positive().max(MAX_SIGNING_OUTPUT_BYTES),
    sources: z.array(sourceSchema).min(1).max(10),
    pages: z.array(pageSchema).min(1).max(200),
    outputScan: z
      .object({
        engine: z.literal("ClamAV"),
        version: z.string().min(1).max(160),
        scannedAt: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export const bundleResultSchema = z
  .object({
    status: z.literal("ready"),
    manifest: manifestSchema,
    manifestHash: hash,
    artifactKey: z.string().min(1).max(500),
    storageVersion: version,
    manifestKey: z.string().min(1).max(500),
    manifestVersion: version,
    retainUntil: z.number().int().positive(),
  })
  .strict();
export type BundleResult = z.infer<typeof bundleResultSchema>;
export type PageGeometry = z.infer<typeof pageSchema>;
export type SourceReport = z.infer<typeof sourceSchema>;
export const pageGeometry = v.object({
  pageIndex: v.number(),
  sourceFileId: v.string(),
  sourcePageIndex: v.number(),
  mediaBox: v.array(v.number()),
  cropBox: v.array(v.number()),
  rotation: v.number(),
  userUnit: v.number(),
  widthPt: v.number(),
  heightPt: v.number(),
});
export const sourceReport = v.object({
  fileId: v.string(),
  uploadId: v.string(),
  sourceVersion: v.string(),
  sizeBytes: v.number(),
  sha256: v.string(),
  role: fileRole,
  pageStartIndex: v.number(),
  pageCount: v.number(),
  scanEngine: v.literal("ClamAV"),
  scanVersion: v.string(),
  scannedAt: v.number(),
});
export type PreparedInputFile = {
  fileId: Id<"signingFiles">;
  uploadId: Id<"signingUploads">;
  sourceVersion: string;
  sizeBytes: number;
  role: "primary" | "annexure";
};
export function preparedPrefix(
  tenantId: string,
  agreementId: string,
  attemptId: string,
) {
  return `prepared/${tenantId}/${agreementId}/${attemptId}`;
}
export const PREPARATION_MESSAGES: Record<PreparationError, string> = {
  not_configured: "Private signing storage or scanning is not configured.",
  transfer_failed:
    "The private file transfer failed. Please retry after checking the service.",
  malware_detected:
    "A file was blocked by malware scanning. Remove it and upload a safe replacement.",
  scanner_unavailable:
    "The malware scanner is unavailable or out of date. Files remain quarantined.",
  invalid_pdf: "A file is not a valid supported PDF.",
  encrypted_pdf:
    "Password-protected PDFs are not accepted. Upload an unencrypted copy.",
  signed_pdf:
    "This PDF contains an existing digital signature. Upload an unsigned source for a new signing transaction.",
  unsupported_pdf:
    "Export a flat PDF without interactive forms, layers, attachments or dynamic content, then upload it again.",
  limit_exceeded:
    "The document bundle exceeds its file, page, size or processing limit.",
  source_changed:
    "A selected source version could not be verified. Upload the file again.",
  storage_failed:
    "Protected document storage could not be verified. No bundle was released.",
  preparation_failed: "PDF preparation failed. Files remain quarantined.",
  result_invalid:
    "The preparation result could not be verified. No bundle was released.",
  unsupported_file:
    "The file is not a PDF, JPEG or PNG matching its declared type.",
};
