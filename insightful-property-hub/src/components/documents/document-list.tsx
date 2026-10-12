import { Link } from "@tanstack/react-router";
import { ExternalLink, FileText } from "lucide-react";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import {
  DOCUMENT_TYPE_LABELS,
  formatTimestamp,
  type DocumentStatus,
  type DocumentType,
} from "@/lib/documents";
import type { Id } from "../../../../convex/_generated/dataModel";

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
 * Compact document list. Staff rows link to the document page; client rows open the file
 * (through `onOpen`, which fetches a fresh signed URL).
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
  const shown = limit ? documents.slice(0, limit) : documents;
  return (
    <ul className="divide-y divide-border">
      {shown.map((document) => {
        const type = document.documentType ?? document.declaredType;
        return (
          <li key={document._id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div className="min-w-0">
              {audience === "staff" ? (
                <Link
                  to="/documents/$id"
                  params={{ id: document._id }}
                  className="inline-flex max-w-full items-center gap-2 font-medium hover:text-primary"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{document.filename}</span>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen?.(document._id)}
                  className="inline-flex max-w-full items-center gap-2 text-left font-medium hover:text-primary"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{document.filename}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
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
            <DocumentStatusBadge status={document.status} audience={audience} />
          </li>
        );
      })}
    </ul>
  );
}
