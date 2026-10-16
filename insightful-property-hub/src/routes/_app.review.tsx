import { DocumentLink } from "@/components/documents/document-link";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { AlertTriangle, FileText, Lightbulb } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { DOCUMENT_TYPE_LABELS, type DocumentStatus } from "@/lib/documents";
import { timeAgo } from "@/lib/workflow";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/_app/review")({
  head: () => ({ meta: [{ title: "Review inbox · Cyphersoft OS" }] }),
  component: ReviewInbox,
});

function ReviewInbox() {
  const queue = useQuery(api.review.queue);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Overview · Review inbox"
        title="What needs a human decision."
        description="Processed documents waiting for approval and insights waiting to be published, most urgent first: missing details, low-confidence fields, client uploads and age raise the priority."
      />
      <Card className="surface-elevated p-4">
        {queue === undefined ? (
          <LoadingState label="Loading review inbox…" />
        ) : queue.length === 0 ? (
          <EmptyState title="Inbox zero" description="Nothing is waiting for review right now." />
        ) : (
          <ul className="divide-y divide-border">
            {queue.map((item) => (
              <li
                key={`${item.kind}-${item.id}`}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  {item.kind === "document" ? (
                    <DocumentLink
                      documentId={item.id}
                      className="inline-flex max-w-full items-center gap-2 font-medium hover:text-primary"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{item.title}</span>
                    </DocumentLink>
                  ) : (
                    <Link
                      to="/insights"
                      className="inline-flex max-w-full items-center gap-2 font-medium hover:text-primary"
                    >
                      <Lightbulb className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{item.title}</span>
                    </Link>
                  )}
                  <div className="pl-6 text-xs text-muted-foreground">
                    {[
                      item.client.name,
                      item.kind === "insight"
                        ? "Insight to publish"
                        : item.documentType
                          ? DOCUMENT_TYPE_LABELS[item.documentType]
                          : null,
                      item.kind === "document" && item.pendingFields
                        ? `${item.pendingFields} field${item.pendingFields === 1 ? "" : "s"} to decide`
                        : null,
                      timeAgo(item.createdAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {item.missingFields.length > 0 || item.lowConfidenceFields > 0 ? (
                    <div className="mt-1 flex items-center gap-1 pl-6 text-xs text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {[
                        item.lowConfidenceFields
                          ? `${item.lowConfidenceFields} low confidence`
                          : null,
                        item.missingFields.length
                          ? `missing ${item.missingFields.map((key) => key.replace(/_/g, " ")).join(", ")}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 pl-6 sm:pl-0">
                  {item.kind === "document" ? (
                    <>
                      <Link
                        to="/documents/$id"
                        params={{ id: item.id }}
                        className="text-xs hover:text-primary"
                      >
                        Review details
                      </Link>
                      <DocumentStatusBadge status={item.status as DocumentStatus} />
                    </>
                  ) : (
                    <span className="tag-pill">Under review</span>
                  )}
                  <span className="font-mono text-xs text-muted-foreground" title="Urgency score">
                    {item.urgency}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
