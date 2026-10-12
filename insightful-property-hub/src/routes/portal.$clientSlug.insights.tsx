import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { FileText, MessageSquare, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, LoadingState, NativeSelect } from "@/components/portfolio/form-fields";
import { usePortal } from "@/lib/portal-context";
import { errorMessage } from "@/lib/portfolio";
import { useOpenDocument } from "@/lib/use-document-upload";
import { cn } from "@/lib/utils";
import {
  INSIGHT_CATEGORY_LABELS,
  PRIORITY_CLASSES,
  PRIORITY_LABELS,
  type InsightCategory,
} from "@/lib/workflow";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/portal/$clientSlug/insights")({
  head: () => ({ meta: [{ title: "Insights | Client portal | Cyphersoft" }] }),
  component: ClientInsightsPage,
});

function ClientInsightsPage() {
  const { client, viewer } = usePortal();
  const insights = useQuery(api.insights.list, { tenantId: client.tenantId });
  const properties = useQuery(api.properties.list, { tenantId: client.tenantId }) ?? [];
  const createAction = useMutation(api.actions.create);
  const openDocument = useOpenDocument();
  const [category, setCategory] = useState<InsightCategory | "all">("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const canAsk = viewer.roleKey !== "executive_viewer" && viewer.roleKey !== "read_only_staff";

  const rows = (insights ?? []).filter(
    (insight) =>
      (category === "all" || insight.category === category) &&
      (propertyFilter === "all" || insight.property?.propertyId === propertyFilter),
  );
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

  const ask = async (title: string, propertyId?: string) => {
    const question = window.prompt(`What would you like to ask about "${title}"?`);
    if (!question) return;
    try {
      await createAction({
        tenantId: client.tenantId,
        title: `Question: ${title}`.slice(0, 200),
        description: question,
        propertyId: propertyId as never,
      });
      toast.success("Sent to your Cyphersoft team. Track the reply under Actions.");
    } catch (askError) {
      toast.error(errorMessage(askError));
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <PageHeader
        eyebrow="Client portal | Insights"
        title="Insights"
        description="Curated lease, cost and document intelligence from your Cyphersoft team. Every insight is reviewed by a person and linked to its source."
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <Summary
          label="Published insights"
          value={insights === undefined ? "—" : String(insights.length)}
        />
        <Summary
          label="High priority"
          value={
            insights === undefined
              ? "—"
              : String(
                  insights.filter((i) => i.priority === "high" || i.priority === "critical").length,
                )
          }
        />
        <Summary
          label="New this month"
          value={
            insights === undefined
              ? "—"
              : String(insights.filter((i) => (i.publishedAt ?? 0) >= startOfMonth).length)
          }
        />
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <NativeSelect
          className="w-auto"
          value={category}
          onChange={(e) => setCategory(e.target.value as InsightCategory | "all")}
          aria-label="Category"
        >
          <option value="all">All categories</option>
          {Object.entries(INSIGHT_CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          className="w-auto"
          value={propertyFilter}
          onChange={(e) => setPropertyFilter(e.target.value)}
          aria-label="Property"
        >
          <option value="all">All properties</option>
          {properties.map((property) => (
            <option key={property._id} value={property._id}>
              {property.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="mt-4">
        {insights === undefined ? (
          <LoadingState label="Loading insights…" />
        ) : rows.length === 0 ? (
          <EmptyState
            title={insights.length === 0 ? "No insights yet" : "No insights match these filters"}
            description="Insights appear here after your documents are processed and reviewed by Cyphersoft."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {rows.map((insight) => (
              <Card key={insight._id} className="surface-elevated flex flex-col p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5",
                      PRIORITY_CLASSES[insight.priority],
                    )}
                  >
                    {PRIORITY_LABELS[insight.priority]} priority
                  </span>
                  <span className="text-muted-foreground">
                    {INSIGHT_CATEGORY_LABELS[insight.category]}
                  </span>
                  {insight.property ? (
                    <span className="text-muted-foreground">· {insight.property.name}</span>
                  ) : null}
                </div>
                <h3 className="mt-3 font-display text-lg">{insight.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm">{insight.body}</p>
                {insight.recommendedAction ? (
                  <p className="mt-3 rounded-md bg-primary/5 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Recommended: </span>
                    {insight.recommendedAction}
                  </p>
                ) : null}
                <div className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-success" />
                  Reviewed by Cyphersoft
                  {insight.publishedAt
                    ? ` · ${new Date(insight.publishedAt).toLocaleDateString("en-ZA")}`
                    : ""}
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                  {insight.documents.map((document) => (
                    <Button
                      key={document.documentId}
                      size="sm"
                      variant="outline"
                      onClick={() => void openDocument(document.documentId)}
                    >
                      <FileText className="h-3.5 w-3.5" /> Source: {document.filename}
                    </Button>
                  ))}
                  {canAsk ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void ask(insight.title, insight.property?.propertyId)}
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> Ask Cyphersoft
                    </Button>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <Card className="surface-elevated p-5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-2xl">{value}</div>
    </Card>
  );
}
