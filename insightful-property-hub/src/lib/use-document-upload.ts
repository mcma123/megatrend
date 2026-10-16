import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useDocumentViewer } from "@/lib/document-viewer-context";
import { errorMessage } from "@/lib/portfolio";
import { precheckFile, type DocumentType } from "@/lib/documents";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export type UploadOptions = {
  tenantId: Id<"tenants">;
  declaredType?: DocumentType;
  propertyId?: Id<"properties">;
  source?: "upload" | "scanner";
};

export type UploadResult = { ok: true; documentId: Id<"documents"> } | { ok: false; error: string };

/**
 * Uploads a file to Convex storage and creates its document record (which queues processing).
 * Also used to replace an existing document with a new version.
 */
export function useDocumentUpload() {
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const createDocument = useMutation(api.documents.create);
  const replaceDocument = useMutation(api.documents.replace);

  const putFile = useCallback(
    async (tenantId: Id<"tenants">, file: Blob) => {
      const uploadUrl = await generateUploadUrl({ tenantId });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) {
        throw new Error("The file upload failed. Check your connection and try again.");
      }
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
      return storageId;
    },
    [generateUploadUrl],
  );

  const upload = useCallback(
    async (file: File, options: UploadOptions): Promise<UploadResult> => {
      const precheck = precheckFile(file);
      if (precheck) return { ok: false, error: precheck };
      try {
        const storageId = await putFile(options.tenantId, file);
        const result = await createDocument({
          tenantId: options.tenantId,
          storageId,
          filename: file.name,
          declaredType: options.declaredType,
          propertyId: options.propertyId,
          source: options.source ?? "upload",
        });
        return result.documentId
          ? { ok: true, documentId: result.documentId }
          : { ok: false, error: result.error ?? "Upload rejected" };
      } catch (uploadError) {
        return { ok: false, error: errorMessage(uploadError, "Upload failed") };
      }
    },
    [createDocument, putFile],
  );

  const replace = useCallback(
    async (
      file: File,
      documentId: Id<"documents">,
      tenantId: Id<"tenants">,
    ): Promise<UploadResult> => {
      const precheck = precheckFile(file);
      if (precheck) return { ok: false, error: precheck };
      try {
        const storageId = await putFile(tenantId, file);
        const result = await replaceDocument({ documentId, storageId, filename: file.name });
        return result.documentId
          ? { ok: true, documentId: result.documentId }
          : { ok: false, error: result.error ?? "Upload rejected" };
      } catch (uploadError) {
        return { ok: false, error: errorMessage(uploadError, "Upload failed") };
      }
    },
    [putFile, replaceDocument],
  );

  return { upload, replace };
}

/** Opens the shared in-app viewer without leaving the current module. */
export function useOpenDocument() {
  return useDocumentViewer();
}
