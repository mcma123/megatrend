import { useMemo, useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  CalendarRange,
  FileSearch,
  Lightbulb,
  MessageSquare,
  Receipt,
  Search,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getClientBySlug, properties } from "@/lib/mock-data";

type InsightPriority = "High" | "Medium" | "Low";
type InsightType = "Renewal" | "Rental anomaly" | "Utility anomaly" | "Cost forecast" | "Document issue" | "Property opportunity";

type ClientInsight = {
  id: string;
  title: string;
  type: InsightType;
  priority: InsightPriority;
  confidence: string;
  propertyId: string;
  publishedDate: string;
  note: string;
  source: string;
  reviewLabel: string;
  cta: string;
  narrative: string;
  publishedBy: string;
  recommendedAction: string;
};

const demoInsights: ClientInsight[] = [
  {
    id: "insight-1",
    title: "DHL Linbro Park DC renewal window opens in 2 months.",
    type: "Renewal",
    priority: "High",
    confidence: "95%",
    propertyId: "p1",
    publishedDate: "2026-07-05",
    note: "We should align on renewal options before the August negotiation window closes.",
    source: "DHL Linbro Park Lease Agreement.pdf · Page 4",
    reviewLabel: "Published by your account manager",
    cta: "Request quote",
    narrative: "Megatrend has reviewed the active lease timeline and confirmed that the renewal window for DHL Linbro Park DC is approaching. The current expiry and notice milestones suggest that market testing and landlord engagement should begin now.",
    publishedBy: "Jared van Niekerk",
    recommendedAction: "Request a renewal quote and review regional comparables.",
  },
  {
    id: "insight-2",
    title: "Monthly rental increased above expected escalation.",
    type: "Rental anomaly",
    priority: "Medium",
    confidence: "88%",
    propertyId: "p1",
    publishedDate: "2026-07-03",
    note: "The uplift exceeds the normal annual step-up we expected from the approved lease schedule.",
    source: "Rental Invoice May 2026.pdf · Line item check",
    reviewLabel: "Reviewed by Megatrend",
    cta: "View lease",
    narrative: "A reviewed comparison between the lease schedule and the latest invoiced amount shows that the monthly rental is above the expected escalation path. This may be due to a billing adjustment or an unlinked addendum.",
    publishedBy: "Jared van Niekerk",
    recommendedAction: "Compare the invoice against the lease escalation clause and any recent addenda.",
  },
  {
    id: "insight-3",
    title: "Electricity usage changed sharply compared to prior months.",
    type: "Utility anomaly",
    priority: "Medium",
    confidence: "82%",
    propertyId: "p1",
    publishedDate: "2026-07-02",
    note: "Usage movement is material enough to investigate before the next billing cycle closes.",
    source: "June Utility Statement.pdf · Consumption trend",
    reviewLabel: "Reviewed by Megatrend",
    cta: "View source document",
    narrative: "Utility consumption has moved sharply relative to the trailing monthly trend. The source utility statement was reviewed and the variance looks operational rather than a simple reading-format change.",
    publishedBy: "Ops Intelligence Desk",
    recommendedAction: "Open the source statement and confirm equipment or occupancy changes with site operations.",
  },
  {
    id: "insight-4",
    title: "Projected annual utility cost is trending upward.",
    type: "Cost forecast",
    priority: "Medium",
    confidence: "79%",
    propertyId: "p5",
    publishedDate: "2026-07-01",
    note: "The current spend trend implies budget pressure if consumption normalisation does not happen soon.",
    source: "Airport Industria Utility Reconciliation.pdf · Forecast model",
    reviewLabel: "Published by your account manager",
    cta: "Ask Megatrend",
    narrative: "Megatrend reviewed the current utility run-rate and forward cost forecast for this site. Based on the recent billing pattern, annualised cost exposure is moving above the expected operating budget envelope.",
    publishedBy: "Reza Patel",
    recommendedAction: "Ask Megatrend for a cost-mitigation plan and budget outlook.",
  },
  {
    id: "insight-5",
    title: "Lease contract appears to be missing a signed annexure.",
    type: "Document issue",
    priority: "High",
    confidence: "73%",
    propertyId: "p1",
    publishedDate: "2026-06-29",
    note: "We have enough evidence to flag the gap, but not enough to treat the annexure as definitively absent without client confirmation.",
    source: "DHL Linbro Park Lease Agreement.pdf · Annexure reference",
    reviewLabel: "Reviewed by Megatrend",
    cta: "Upload missing document",
    narrative: "The reviewed lease package refers to a signed annexure that is not present in the linked contract set. The clause references appear valid, but the supporting document has not been uploaded into the portal package yet.",
    publishedBy: "Jared van Niekerk",
    recommendedAction: "Upload the missing annexure so lease intelligence can be finalised.",
  },
  {
    id: "insight-6",
    title: "Comparable logistics properties are available in the same region.",
    type: "Property opportunity",
    priority: "Low",
    confidence: "86%",
    propertyId: "p1",
    publishedDate: "2026-06-27",
    note: "We have reviewed nearby comparables that could strengthen your renewal position.",
    source: "Megatrend sourcing brief · Linbro Park set",
    reviewLabel: "Published by your account manager",
    cta: "Request quote",
    narrative: "Megatrend has reviewed nearby logistics opportunities in the same region and found comparable options that may be relevant for negotiation leverage or relocation planning.",
    publishedBy: "Jared van Niekerk",
    recommendedAction: "Request a market quote pack for the comparable properties.",
  },
];

export const Route = createFileRoute("/portal/$clientSlug/insights")({
  loader: ({ params }) => {
    const client = getClientBySlug(params.clientSlug);
    if (!client) throw notFound();
    return { client };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `Insights | ${loaderData?.client.name ?? "Client"} portal | Megatrend` },
      {
        name: "description",
        content: `Curated lease, rental, document, and property intelligence for ${loaderData?.client.name ?? "your portfolio"}.`,
      },
    ],
  }),
  component: ClientInsightsPage,
});

function ClientInsightsPage() {
  const { client } = Route.useLoaderData();
  const clientProperties = properties.filter((property) => property.clientId === client.id);
  const propertyOptions = clientProperties.map((property) => ({ id: property.id, name: property.name }));
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"All" | InsightPriority>("All");
  const [typeFilter, setTypeFilter] = useState<"All" | InsightType>("All");
  const [propertyFilter, setPropertyFilter] = useState<"All" | string>("All");
  const [selectedInsightId, setSelectedInsightId] = useState<string>(demoInsights[0]?.id ?? "");

  const filteredInsights = useMemo(() => {
    return demoInsights.filter((insight) => {
      const propertyName = getPropertyName(insight.propertyId, propertyOptions);
      const matchesQuery =
        query.trim().length === 0 ||
        insight.title.toLowerCase().includes(query.toLowerCase()) ||
        insight.note.toLowerCase().includes(query.toLowerCase()) ||
        propertyName.toLowerCase().includes(query.toLowerCase());
      const matchesPriority = priorityFilter === "All" || insight.priority === priorityFilter;
      const matchesType = typeFilter === "All" || insight.type === typeFilter;
      const matchesProperty = propertyFilter === "All" || insight.propertyId === propertyFilter;

      return matchesQuery && matchesPriority && matchesType && matchesProperty;
    });
  }, [priorityFilter, propertyFilter, propertyOptions, query, typeFilter]);

  const selectedInsight =
    filteredInsights.find((insight) => insight.id === selectedInsightId) ?? filteredInsights[0] ?? null;

  const summary = {
    highPriority: demoInsights.filter((insight) => insight.priority === "High").length,
    renewalAlerts: demoInsights.filter((insight) => insight.type === "Renewal").length,
    documentIssues: demoInsights.filter((insight) => insight.type === "Document issue").length,
    newThisMonth: demoInsights.filter((insight) => insight.publishedDate.startsWith("2026-07")).length,
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <PageHeader
        eyebrow="Client portal | Insights"
        title="Insights"
        description="Curated lease, rental, document, and property intelligence from your Megatrend team."
        actions={
          <>
            <Button variant="outline">
              <Receipt className="h-4 w-4" /> Request quote
            </Button>
            <Button>
              <Sparkles className="h-4 w-4" /> Ask Megatrend
            </Button>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="High priority" value={summary.highPriority} detail="Reviewed items that need immediate attention." />
        <SummaryCard label="Renewal alerts" value={summary.renewalAlerts} detail="Lease timing and market timing signals." />
        <SummaryCard label="Document issues" value={summary.documentIssues} detail="Approved gaps or inconsistencies in source documents." />
        <SummaryCard label="New this month" value={summary.newThisMonth} detail="Fresh intelligence published by your Megatrend team." />
      </section>

      <Card className="surface-elevated mt-6 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search insights"
              className="pl-9"
            />
          </div>
          <FilterSelect
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value as "All" | InsightPriority)}
            options={["All", "High", "Medium", "Low"]}
            ariaLabel="Filter by priority"
          />
          <FilterSelect
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as "All" | InsightType)}
            options={["All", "Renewal", "Rental anomaly", "Utility anomaly", "Cost forecast", "Document issue", "Property opportunity"]}
            ariaLabel="Filter by type"
          />
          <select
            value={propertyFilter}
            onChange={(event) => setPropertyFilter(event.target.value)}
            aria-label="Filter by property"
            className="h-9 min-w-[12rem] rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
          >
            <option value="All">All properties</option>
            {propertyOptions.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
          <Button variant="outline" className="justify-start xl:min-w-[11rem]">
            <CalendarRange className="h-4 w-4" /> Date filter
          </Button>
        </div>
      </Card>

      {filteredInsights.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_22rem]">
          <section>
            <div className="grid gap-4 lg:grid-cols-2">
              {filteredInsights.map((insight) => {
                const isSelected = selectedInsight?.id === insight.id;
                return (
                  <Card
                    key={insight.id}
                    className={`surface-elevated cursor-pointer p-5 transition-colors ${isSelected ? "border-primary/40 bg-primary/5" : "hover:bg-accent/20"}`}
                    onClick={() => setSelectedInsightId(insight.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{insight.type}</div>
                        <h3 className="mt-2 font-display text-xl leading-tight">{insight.title}</h3>
                      </div>
                      <span className={`rounded-md border px-2.5 py-1 text-xs font-medium ${priorityClass(insight.priority)}`}>{insight.priority}</span>
                    </div>
                    <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <MetaItem label="Confidence" value={insight.confidence} mono />
                      <MetaItem label="Related property" value={getPropertyName(insight.propertyId, propertyOptions)} />
                      <MetaItem label="Published date" value={insight.publishedDate} mono />
                      <MetaItem label="Review" value={insight.reviewLabel} />
                    </div>
                    <div className="mt-4 rounded-md border border-border/70 bg-card/50 p-3 text-sm text-muted-foreground">
                      {insight.note}
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div className="text-xs text-muted-foreground">
                        Source: <span className="text-foreground">{insight.source}</span>
                      </div>
                      <Button variant="outline" size="sm">
                        {insight.cta}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>

          <aside className="space-y-4">
            {selectedInsight && (
              <Card className="surface-elevated p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Insight detail</div>
                    <h2 className="mt-2 font-display text-xl">{selectedInsight.title}</h2>
                  </div>
                  <span className={`rounded-md border px-2.5 py-1 text-xs font-medium ${priorityClass(selectedInsight.priority)}`}>{selectedInsight.priority}</span>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">{selectedInsight.narrative}</p>
                <div className="mt-5 grid gap-4 text-sm">
                  <MetaItem label="Confidence score" value={selectedInsight.confidence} mono />
                  <MetaItem label="Related property" value={getPropertyName(selectedInsight.propertyId, propertyOptions)} />
                  <MetaItem label="Source document" value={selectedInsight.source} />
                  <MetaItem label="Account manager note" value={selectedInsight.note} />
                  <MetaItem label="Published by" value={selectedInsight.publishedBy} />
                  <MetaItem label="Published date" value={selectedInsight.publishedDate} mono />
                  <MetaItem label="Recommended next action" value={selectedInsight.recommendedAction} />
                </div>
                <div className="mt-5 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
                  {selectedInsight.reviewLabel}
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="outline">
                    <FileSearch className="h-4 w-4" /> Source document
                  </Button>
                  <Button>{selectedInsight.cta}</Button>
                  <Button variant="ghost">
                    <MessageSquare className="h-4 w-4" /> Ask Megatrend
                  </Button>
                </div>
              </Card>
            )}

            <Card className="surface-elevated border-warning/30 bg-warning/5 p-5">
              <div className="flex items-start gap-3">
                <Lightbulb className="mt-0.5 h-5 w-5 text-warning" />
                <div>
                  <h3 className="font-display text-lg text-warning">Trusted business intelligence</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Insights here are curated by Megatrend before publication. Raw AI output is not shown directly to clients.
                  </p>
                </div>
              </div>
            </Card>
          </aside>
        </div>
      )}
    </main>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <Card className="surface-elevated p-5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-3 font-display text-3xl">{value}</div>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </Card>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  options: string[];
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      onChange={onChange}
      aria-label={ariaLabel}
      className="h-9 min-w-[10rem] rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option === "All" ? `All ${ariaLabel.replace("Filter by ", "")}` : option}
        </option>
      ))}
    </select>
  );
}

function MetaItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`mt-1 ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="surface-elevated mt-6 px-6 py-16 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-dashed border-border bg-accent/30">
        <Lightbulb className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mt-5 font-display text-2xl">No insights published yet.</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Insights will appear here after your documents are processed and reviewed by Megatrend.
      </p>
    </Card>
  );
}

function getPropertyName(propertyId: string, propertyOptions: Array<{ id: string; name: string }>) {
  return propertyOptions.find((property) => property.id === propertyId)?.name ?? "Unassigned property";
}

function priorityClass(priority: InsightPriority) {
  if (priority === "High") return "border-warning/40 bg-warning/10 text-warning";
  if (priority === "Medium") return "border-primary/30 bg-primary/10 text-primary";
  return "border-border bg-card text-muted-foreground";
}
