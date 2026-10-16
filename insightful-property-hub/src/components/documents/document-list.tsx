import { DocumentLink } from "@/components/documents/document-link";
import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import {
  DOCUMENT_TYPE_LABELS,
  formatTimestamp,
  type DocumentStatus,
  type DocumentType,
} from "@/lib/documents";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useDocumentViewer } from "@/lib/document-viewer-context";

export type DocumentListItem = {
  _id: Id<"documents">;
  filename: string;
  status: DocumentStatus;
  documentType?: DocumentType;
  declaredType?: DocumentType;
  createdAt: number;
  property: { propertyId: Id<"properties">; name: string } | null;
};

/**
 * Compact document list. Filenames open the shared viewer for staff and clients.
 */
export function DocumentList({
  documents,
  audience,
  onOpen,
  limit,
}: {
  documents: DocumentListItem[];
  audience: "staff" | "client";
  onOpen?: (documentId: Id<"documents">) => void;
  limit?: number;
}) {
  const openDocument = useDocumentViewer();
  const shown = limit ? documents.slice(0, limit) : documents;
  return (
    <ul className="divide-y divide-border">
      {shown.map((document) => {
        const type = document.documentType ?? document.declaredType;
        return (
          <li key={document._id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div className="min-w-0">
              {audience === "staff" ? (
                <DocumentLink
                  documentId={document._id}
                  className="inline-flex max-w-full items-center gap-2 font-medium hover:text-primary"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{document.filename}</span>
                </DocumentLink>
              ) : (
                <button
                  type="button"
                  onClick={() => (onOpen ?? openDocument)(document._id)}
                  className="inline-flex max-w-full items-center gap-2 text-left font-medium hover:text-primary"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{document.filename}</span>
                </button>
              )}
              <div className="pl-6 text-xs text-muted-foreground">
                {[
                  type ? DOCUMENT_TYPE_LABELS[type] : null,
                  document.property?.name,
                  formatTimestamp(document.createdAt),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {audience === "staff" ? (
                <Link
                  to="/documents/$id"
                  params={{ id: document._id }}
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  Details / review
                </Link>
              ) : null}
              <DocumentStatusBadge status={document.status} audience={audience} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
