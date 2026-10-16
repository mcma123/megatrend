import { DocumentLink } from "@/components/documents/document-link";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { FileText, Pencil, Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EMPTY_INSIGHT,
  InsightEditorDialog,
  type InsightDraftValues,
} from "@/components/insights/insight-editor-dialog";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { errorMessage } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import {
  INSIGHT_CATEGORY_LABELS,
  INSIGHT_STATUS_LABELS,
  PRIORITY_CLASSES,
  PRIORITY_LABELS,
  timeAgo,
  type InsightStatus,
} from "@/lib/workflow";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/_app/insights")({
  head: () => ({ meta: [{ title: "Insights · Cyphersoft OS" }] }),
  component: InsightsPage,
});

type Tab = "all" | InsightStatus;

function InsightsPage() {
  const insights = useQuery(api.insights.list, {});
  const setStatus = useMutation(api.insights.setStatus);
  const [tab, setTab] = useState<Tab>("all");
  const [editor, setEditor] = useState<InsightDraftValues | null>(null);

  const rows = (insights ?? []).filter((insight) => tab === "all" || insight.status === tab);
  const count = (status: InsightStatus) =>
    (insights ?? []).filter((insight) => insight.status === status).length;

  const move = async (insightId: Id<"insights">, status: InsightStatus, askNote = false) => {
    let note: string | undefined;
    if (askNote) {
      const answer = window.prompt("Note for the author (optional)");
      if (answer === null) return;
      note = answer || undefined;
    }
    try {
      await setStatus({ insightId, status, note });
      toast.success(
        status === "published"
          ? "Published to the client portal"
          : `Moved to ${INSIGHT_STATUS_LABELS[status].toLowerCase()}`,
      );
    } catch (moveError) {
      toast.error(errorMessage(moveError));
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Internal · Insights"
        title="Curate before it reaches the client."
        description="Draft insights by hand or with AI from approved data, review them, then publish. Clients only ever see published insights, each linked to its evidence."
        actions={
          <Button onClick={() => setEditor({ ...EMPTY_INSIGHT })}>
            <Plus className="h-4 w-4" /> New insight
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="draft">
            Drafts{count("draft") ? ` (${count("draft")})` : ""}
          </TabsTrigger>
          <TabsTrigger value="under_review">
            Under review{count("under_review") ? ` (${count("under_review")})` : ""}
          </TabsTrigger>
          <TabsTrigger value="published">Published</TabsTrigger>
          <TabsTrigger value="rejected">Sent back</TabsTrigger>
        </TabsList>
      </Tabs>

      {insights === undefined ? (
        <LoadingState label="Loading insights…" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No insights here"
          description="Approve a document's fields, then use “Draft insight with AI” on the document or lease page — or write one yourself."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((insight) => (
            <Card key={insight._id} className="surface-elevated flex flex-col p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="tag-pill">{INSIGHT_STATUS_LABELS[insight.status]}</span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5",
                    PRIORITY_CLASSES[insight.priority],
                  )}
                >
                  {PRIORITY_LABELS[insight.priority]}
                </span>
                <span className="text-muted-foreground">
                  {INSIGHT_CATEGORY_LABELS[insight.category]}
                </span>
                {insight.draftedBy === "ai" ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Sparkles className="h-3 w-3" /> AI draft
                  </span>
                ) : insight.draftedBy === "system" ? (
                  <span className="text-muted-foreground">Auto-generated</span>
                ) : null}
                <span className="ml-auto text-muted-foreground">{timeAgo(insight.updatedAt)}</span>
              </div>
              <h3 className="mt-3 font-display text-lg">{insight.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                <Link
                  to="/clients/$id"
                  params={{ id: insight.client.slug }}
                  className="hover:text-primary"
                >
                  {insight.client.name}
                </Link>
                {insight.property ? ` · ${insight.property.name}` : ""}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{insight.body}</p>
              {insight.recommendedAction ? (
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">Recommended: </span>
                  {insight.recommendedAction}
                </p>
              ) : null}
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {insight.documents.map((document) => (
                  <DocumentLink
                    key={document.documentId}
                    documentId={document.documentId}
                    className="flex items-center gap-1 hover:text-primary"
                  >
                    <FileText className="h-3 w-3" /> {document.filename}
                  </DocumentLink>
                ))}
                {insight.documents.length === 0 && !insight.leaseId ? (
                  <p className="text-warning">No evidence linked yet</p>
                ) : null}
                {insight.reviewNote ? <p>Review note: {insight.reviewNote}</p> : null}
                {insight.status === "published" && insight.reviewerName ? (
                  <p>Published by {insight.reviewerName}</p>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                {insight.status !== "published" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEditor({
                        insightId: insight._id,
                        tenantId: insight.tenantId,
                        title: insight.title,
                        body: insight.body,
                        recommendedAction: insight.recommendedAction ?? "",
                        category: insight.category,
                        priority: insight.priority,
                        propertyId: insight.propertyId,
                        leaseId: insight.leaseId,
                        documentIds: insight.documentIds,
                        draftedBy: insight.draftedBy,
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                ) : null}
                {insight.status === "draft" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void move(insight._id, "under_review")}
                  >
                    Submit for review
                  </Button>
                ) : null}
                {insight.status === "draft" || insight.status === "under_review" ? (
                  <>
                    <Button size="sm" onClick={() => void move(insight._id, "published")}>
                      Publish
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void move(insight._id, "rejected", true)}
                    >
                      Send back
                    </Button>
                  </>
                ) : null}
                {insight.status === "rejected" || insight.status === "withdrawn" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void move(insight._id, "draft")}
                  >
                    Back to draft
                  </Button>
                ) : null}
                {insight.status === "published" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void move(insight._id, "withdrawn", true)}
                  >
                    Withdraw
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editor ? (
        <InsightEditorDialog
          open
          onOpenChange={(open) => !open && setEditor(null)}
          initial={editor}
        />
      ) : null}
    </div>
  );
}
