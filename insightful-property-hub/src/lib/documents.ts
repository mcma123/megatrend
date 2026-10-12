import type { Doc } from "../../../convex/_generated/dataModel";

export type DocumentType = NonNullable<Doc<"documents">["documentType"]>;
export type DocumentStatus = Doc<"documents">["status"];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  lease: "Lease",
  invoice: "Invoice",
  utility_statement: "Utility statement",
  addendum: "Addendum",
  correspondence: "Correspondence",
  offer: "Offer",
  other: "Other",
};

/** Staff-facing pipeline labels. */
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  uploaded: "Uploaded",
  queued_for_ocr: "Reading document",
  ocr_complete: "Extracting fields",
  extraction_complete: "Processed",
  review_required: "Needs review",
  approved: "Approved",
  processing_failed: "Failed",
};

/** Client-facing labels: internal review states read as "with Cyphersoft". */
export const CLIENT_DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  uploaded: "Uploaded",
  queued_for_ocr: "Processing",
  ocr_complete: "Processing",
  extraction_complete: "Under review",
  review_required: "Under review",
  approved: "Published",
  processing_failed: "Failed",
};

export const PROCESSING_STATUSES: DocumentStatus[] = ["uploaded", "queued_for_ocr", "ocr_complete"];

export function isProcessing(status: DocumentStatus) {
  return PROCESSING_STATUSES.includes(status);
}

/** Progress for the processing queue (0-100). */
export function processingProgress(status: DocumentStatus) {
  switch (status) {
    case "uploaded":
      return 15;
    case "queued_for_ocr":
      return 40;
    case "ocr_complete":
      return 75;
    default:
      return 100;
  }
}

export function statusTone(
  status: DocumentStatus,
): "default" | "warning" | "danger" | "success" | "muted" {
  if (status === "processing_failed") return "danger";
  if (status === "review_required") return "warning";
  if (status === "approved" || status === "extraction_complete") return "success";
  if (isProcessing(status)) return "default";
  return "muted";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTimestamp(ms: number) {
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ACCEPTED_UPLOAD_TYPES =
  ".pdf,.doc,.docx,.xls,.xlsx,.pptx,.png,.jpg,.jpeg,.tif,.tiff,.webp,.csv,.txt,.md,.html";

/** Client-side pre-check; the server validates again from the stored file. */
export function precheckFile(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is larger than 25 MB`;
  }
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (!ACCEPTED_UPLOAD_TYPES.split(",").includes(`.${extension}`)) {
    return `${file.name}: unsupported file type`;
  }
  return null;
}
