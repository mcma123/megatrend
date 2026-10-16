/** Preview rendering is independent of OCR and extraction. Bump when conversion changes. */
export const PREVIEW_VERSION = 1;
export const PREVIEW_BUDGET_MS = 5 * 60_000;
export const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;

export function previewKind(contentType: string, filename: string) {
  const type = contentType.split(";")[0].toLowerCase();
  const extension = filename.toLowerCase().split(".").pop();
  if (type === "application/pdf" || extension === "pdf") return "pdf" as const;
  if (["png", "jpg", "jpeg", "webp"].includes(extension ?? ""))
    return "image" as const;
  if (
    ["doc", "docx", "xls", "xlsx", "pptx", "tif", "tiff"].includes(
      extension ?? "",
    )
  )
    return "converted" as const;
  if (["txt", "csv", "md", "html"].includes(extension ?? ""))
    return "text" as const;
  return "unsupported" as const;
}
