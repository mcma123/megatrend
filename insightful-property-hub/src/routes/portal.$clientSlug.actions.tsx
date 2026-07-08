import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  CalendarRange,
  CheckCircle2,
  Clock3,
  FileUp,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Search,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getClientBySlug, properties } from "@/lib/mock-data";

type ActionPriority = "High" | "Medium" | "Low";
type ActionStatus = "Open" | "In progress" | "Waiting on Megatrend" | "Waiting on client" | "Completed" | "Overdue";
type RequestedBy = "Megatrend" | "System" | "Client";
type ActionTab = "Open" | "In progress" | "Waiting on Megatrend" | "Completed" | "All";

type ClientAction = {
  id: string;
  title: string;
  propertyId: string;
  dueDate: string;
  priority: ActionPriority;
  assignedTo: string;
  status: ActionStatus;
  requestedBy: RequestedBy;
  ctaLabel: string;
  description: string;
  relatedItem: string;
  comments: Array<{ id: string; author: string; time: string; text: string }>;
};

const demoActions: ClientAction[] = [
  {
    id: "action-1",
    title: "Upload latest utility invoice",
    propertyId: "p1",
    dueDate: "2026-07-15",
    priority: "High",
    assignedTo: "Finance user",
    status: "Open",
    requestedBy: "Megatrend",
    ctaLabel: "Upload document",
    description: "Megatrend needs the latest utility invoice to reconcile the current billing cycle and update the property operating cost record.",
    relatedItem: "June Utility Statement.pdf",
    comments: [
      { id: "c1", author: "Jared van Niekerk", time: "Today 09:10", text: "Please upload the latest utility invoice so we can close the consumption variance review." },
      { id: "c2", author: "System", time: "Yesterday 16:45", text: "Latest billing cycle is missing from the document register for this property." },
    ],
  },
  {
    id: "action-2",
    title: "Confirm renewal decision",
    propertyId: "p1",
    dueDate: "2026-06-30",
    priority: "High",
    assignedTo: "Property manager",
    status: "In progress",
    requestedBy: "Megatrend",
    ctaLabel: "Review lease",
    description: "The renewal window is active. Megatrend needs confirmation on whether the current lease should be renewed, renegotiated, or replaced with an alternatives search.",
    relatedItem: "Lease detail | DHL Linbro Park DC",
    comments: [
      { id: "c3", author: "Megatrend", time: "2026-07-06 11:20", text: "Market options have been prepared. Waiting for internal client direction on renewal strategy." },
      { id: "c4", author: "Thandi Mokoena", time: "2026-07-05 14:02", text: "Reviewing with the operations team before we confirm next steps." },
    ],
  },
  {
    id: "action-3",
    title: "Review extracted lease fields",
    propertyId: "p1",
    dueDate: "2026-07-05",
    priority: "Medium",
    assignedTo: "Admin",
    status: "Open",
    requestedBy: "System",
    ctaLabel: "Review fields",
    description: "Several extracted lease values need client confirmation before Megatrend publishes them into the approved lease intelligence record.",
    relatedItem: "AI extracted lease fields",
    comments: [
      { id: "c5", author: "System", time: "2026-07-05 08:30", text: "Deposit and escalation references have confidence below the publish threshold." },
    ],
  },
  {
    id: "action-4",
    title: "Provide missing signed annexure",
    propertyId: "p1",
    dueDate: "2026-07-10",
    priority: "Medium",
    assignedTo: "Admin",
    status: "Open",
    requestedBy: "Megatrend",
    ctaLabel: "Upload document",
    description: "The lease contract references a signed annexure that is not present in the current document set. Uploading it will complete the lease record and reduce document review risk.",
    relatedItem: "DHL Linbro Park Lease Agreement.pdf",
    comments: [
      { id: "c6", author: "Jared van Niekerk", time: "2026-07-07 10:05", text: "The lease is usable, but the missing annexure limits what we can publish with confidence." },
    ],
  },
  {
    id: "action-5",
    title: "Review property options report",
    propertyId: "p1",
    dueDate: "2026-07-20",
    priority: "Low",
    assignedTo: "Property manager",
    status: "Waiting on client",
    requestedBy: "Megatrend",
    ctaLabel: "View report",
    description: "Comparable logistics options have been identified in the same region. Review the report so Megatrend can refine the shortlist if a relocation strategy is needed.",
    relatedItem: "Linbro logistics options report",
    comments: [
      { id: "c7", author: "Megatrend", time: "2026-07-03 15:16", text: "Shortlist published for client review. Awaiting feedback before requesting landlord engagement." },
    ],
  },
  {
    id: "action-6",
    title: "Reply to quote clarifications",
    propertyId: "p1",
    dueDate: "2026-07-12",
    priority: "Low",
    assignedTo: "Finance user",
    status: "Waiting on Megatrend",
    requestedBy: "Client",
    ctaLabel: "Reply",
    description: "Megatrend is preparing a response to the submitted quote request. Use this thread to clarify scope or supporting assumptions.",
    relatedItem: "Quote request | utilities optimisation",
    comments: [
      { id: "c8", author: "Client", time: "2026-07-07 09:44", text: "Please confirm whether the options include utility capex assumptions." },
      { id: "c9", author: "Megatrend", time: "2026-07-07 10:01", text: "We are updating the quote pack and will revert with the revised scope." },
    ],
  },
  {
    id: "action-7",
    title: "Approve July billing pack",
    propertyId: "p1",
    dueDate: "2026-07-03",
    priority: "High",
    assignedTo: "Finance user",
    status: "Overdue",
    requestedBy: "System",
    ctaLabel: "Review fields",
    description: "The July billing pack is still pending approval. The extracted amounts are ready, but the final review has not been completed.",
    relatedItem: "July billing pack",
    comments: [
      { id: "c10", author: "System", time: "2026-07-04 07:00", text: "This action moved into overdue because the due date passed without completion." },
    ],
  },
  {
    id: "action-8",
    title: "Publish reviewed lease schedule",
    propertyId: "p1",
    dueDate: "2026-07-02",
    priority: "Medium",
    assignedTo: "Admin",
    status: "Completed",
    requestedBy: "Megatrend",
    ctaLabel: "View related item",
    description: "Lease schedule reviewed and published into the client-visible record.",
    relatedItem: "Lease schedule",
    comments: [
      { id: "c11", author: "Megatrend", time: "2026-07-02 16:40", text: "Published after final account manager approval." },
    ],
  },
  {
    id: "action-9",
    title: "Confirm property contact list",
    propertyId: "p1",
    dueDate: "2026-07-01",
    priority: "Low",
    assignedTo: "Admin",
    status: "Completed",
    requestedBy: "Client",
    ctaLabel: "View related item",
    description: "Contact list updated for escalation and document approval workflows.",
    relatedItem: "Client team directory",
    comments: [
      { id: "c12", author: "Client", time: "2026-07-01 12:18", text: "Updated finance and legal approvers for this property." },
    ],
  },
];

export const Route = createFileRoute("/portal/$clientSlug/actions")({
  loader: ({ params }) => {
    const client = getClientBySlug(params.clientSlug);
    if (!client) throw notFound();
    return { client };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `Actions | ${loaderData?.client.name ?? "Client"} portal | Megatrend` },
      {
        name: "description",
        content: `Track open requests, document tasks, lease decisions, and Megatrend follow-ups for ${loaderData?.client.name ?? "your portfolio"}.`,
      },
    ],
  }),
  component: ClientActionsPage,
});

function ClientActionsPage() {
  const { client } = Route.useLoaderData();
  const propertyOptions = properties
    .filter((property) => property.clientId === client.id)
    .map((property) => ({ id: property.id, name: property.name }));

  const [activeTab, setActiveTab] = useState<ActionTab>("Open");
  const [query, setQuery] = useState("");
  const [propertyFilter, setPropertyFilter] = useState<"All" | string>("All");
  const [priorityFilter, setPriorityFilter] = useState<"All" | ActionPriority>("All");
  const [requestedByFilter, setRequestedByFilter] = useState<"All" | RequestedBy>("All");
  const [dueDateFilter] = useState("Due date");

  const filteredActions = useMemo(() => {
    return demoActions.filter((action) => {
      const normalizedQuery = query.trim().toLowerCase();
      const propertyName = getPropertyName(action.propertyId, propertyOptions).toLowerCase();
      const matchesQuery =
        normalizedQuery.length === 0 ||
        action.title.toLowerCase().includes(normalizedQuery) ||
        action.relatedItem.toLowerCase().includes(normalizedQuery) ||
        propertyName.includes(normalizedQuery);
      const matchesProperty = propertyFilter === "All" || action.propertyId === propertyFilter;
      const matchesPriority = priorityFilter === "All" || action.priority === priorityFilter;
      const matchesRequestedBy = requestedByFilter === "All" || action.requestedBy === requestedByFilter;
      const matchesTab = matchesActionTab(action.status, activeTab);

      return matchesQuery && matchesProperty && matchesPriority && matchesRequestedBy && matchesTab;
    });
  }, [activeTab, priorityFilter, propertyFilter, propertyOptions, query, requestedByFilter]);

  const [selectedActionId, setSelectedActionId] = useState<string>(demoActions[0]?.id ?? "");

  useEffect(() => {
    if (filteredActions.length === 0) {
      setSelectedActionId("");
      return;
    }

    if (!filteredActions.some((action) => action.id === selectedActionId)) {
      setSelectedActionId(filteredActions[0].id);
    }
  }, [filteredActions, selectedActionId]);

  const selectedAction = filteredActions.find((action) => action.id === selectedActionId) ?? filteredActions[0] ?? null;

  const summary = {
    open: demoActions.filter((action) => ["Open", "In progress", "Waiting on client", "Waiting on Megatrend", "Overdue"].includes(action.status)).length,
    dueThisWeek: demoActions.filter((action) => action.status !== "Completed" && action.dueDate >= "2026-07-08" && action.dueDate <= "2026-07-15").length,
    overdue: demoActions.filter((action) => action.status === "Overdue").length,
    completedThisMonth: demoActions.filter((action) => action.status === "Completed" && action.dueDate.startsWith("2026-07")).length,
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <PageHeader
        eyebrow="Client portal | Actions"
        title="Actions"
        description="Track open requests, document tasks, lease decisions, and Megatrend follow-ups."
        actions={
          <>
            <Button>
              <ListChecks className="h-4 w-4" /> Create request
            </Button>
            <Button variant="outline">
              <MessageSquare className="h-4 w-4" /> Ask Megatrend
            </Button>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Open actions" value={summary.open} detail="Requests that still need a client or Megatrend next step." />
        <SummaryCard label="Due this week" value={summary.dueThisWeek} detail="Time-sensitive items that should be cleared in the next seven days." />
        <SummaryCard label="Overdue" value={summary.overdue} detail="Items that have moved past their target date and need attention." />
        <SummaryCard label="Completed this month" value={summary.completedThisMonth} detail="Closed actions already resolved by your team or Megatrend." />
      </section>

      <Card className="surface-elevated mt-6 p-4">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ActionTab)}>
          <TabsList className="h-auto flex-wrap justify-start gap-2 bg-transparent p-0">
            {(["Open", "In progress", "Waiting on Megatrend", "Completed", "All"] as ActionTab[]).map((tab) => (
              <TabsTrigger key={tab} value={tab} className="rounded-full border border-border bg-card px-4 py-2 text-xs uppercase tracking-[0.14em] data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search actions"
              className="pl-9"
            />
          </div>
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
          <FilterSelect
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value as "All" | ActionPriority)}
            options={["All", "High", "Medium", "Low"]}
            ariaLabel="Filter by priority"
          />
          <FilterSelect
            value={requestedByFilter}
            onChange={(event) => setRequestedByFilter(event.target.value as "All" | RequestedBy)}
            options={["All", "Megatrend", "System", "Client"]}
            ariaLabel="Filter by requested by"
          />
          <Button variant="outline" className="justify-start xl:min-w-[10rem]">
            <CalendarRange className="h-4 w-4" /> {dueDateFilter}
          </Button>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_22rem]">
        <section>
          <Card className="surface-elevated overflow-hidden">
            <div className="border-b border-border px-5 py-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="font-display text-xl">Action centre</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This is where clients can see exactly what Megatrend or the system needs next, without chasing separate email threads.
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  Showing {filteredActions.length} of {demoActions.length} actions
                </div>
              </div>
            </div>

            {filteredActions.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        <th className="px-5 py-3">Action title</th>
                        <th className="px-3 py-3">Related property</th>
                        <th className="px-3 py-3">Due date</th>
                        <th className="px-3 py-3">Priority</th>
                        <th className="px-3 py-3">Assigned to</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Requested by</th>
                        <th className="px-5 py-3 text-right">CTA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredActions.map((action) => (
                        <tr
                          key={action.id}
                          className={`cursor-pointer border-b border-border/60 align-top hover:bg-accent/20 ${selectedAction?.id === action.id ? "bg-accent/15" : ""}`}
                          onClick={() => setSelectedActionId(action.id)}
                        >
                          <td className="px-5 py-4">
                            <div className="font-medium text-foreground">{action.title}</div>
                            <div className="mt-1 max-w-md text-xs text-muted-foreground">{action.description}</div>
                          </td>
                          <td className="px-3 py-4 text-muted-foreground">{getPropertyName(action.propertyId, propertyOptions)}</td>
                          <td className="px-3 py-4 font-mono text-xs text-muted-foreground">{action.dueDate}</td>
                          <td className="px-3 py-4"><PriorityBadge priority={action.priority} /></td>
                          <td className="px-3 py-4 text-muted-foreground">{action.assignedTo}</td>
                          <td className="px-3 py-4"><StatusBadge status={action.status} /></td>
                          <td className="px-3 py-4 text-muted-foreground">{action.requestedBy}</td>
                          <td className="px-5 py-4 text-right">
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                              {action.ctaLabel}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 p-4 lg:hidden">
                  {filteredActions.map((action) => (
                    <Card
                      key={action.id}
                      className={`border p-4 shadow-none ${selectedAction?.id === action.id ? "border-primary/40 bg-primary/5" : "border-border/70 bg-card/60"}`}
                      onClick={() => setSelectedActionId(action.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{action.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{getPropertyName(action.propertyId, propertyOptions)}</div>
                        </div>
                        <PriorityBadge priority={action.priority} />
                      </div>
                      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <Metadata label="Due date" value={action.dueDate} />
                        <Metadata label="Assigned to" value={action.assignedTo} />
                        <Metadata label="Status" value={action.status} />
                        <Metadata label="Requested by" value={action.requestedBy} />
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">{action.description}</p>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <StatusBadge status={action.status} />
                        <Button size="sm">{action.ctaLabel}</Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </Card>
        </section>

        <aside className="space-y-4">
          {selectedAction ? (
            <>
              <Card className="surface-elevated p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Action detail</div>
                    <h2 className="mt-2 font-display text-lg">{selectedAction.title}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">{selectedAction.description}</p>
                  </div>
                  <StatusBadge status={selectedAction.status} />
                </div>
                <div className="mt-4 grid gap-3 text-sm">
                  <DetailRow label="Related property" value={getPropertyName(selectedAction.propertyId, propertyOptions)} />
                  <DetailRow label="Related lease/document/insight" value={selectedAction.relatedItem} />
                  <DetailRow label="Due date" value={selectedAction.dueDate} />
                  <DetailRow label="Priority" value={selectedAction.priority} />
                  <DetailRow label="Requested by" value={selectedAction.requestedBy} />
                  <DetailRow label="Assigned to" value={selectedAction.assignedTo} />
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button size="sm">
                    <Upload className="h-3.5 w-3.5" /> Upload document
                  </Button>
                  <Button variant="outline" size="sm">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Mark complete
                  </Button>
                  <Button variant="outline" size="sm">
                    <MessageSquare className="h-3.5 w-3.5" /> Reply
                  </Button>
                  <Button variant="ghost" size="sm">
                    <FileUp className="h-3.5 w-3.5" /> View related item
                  </Button>
                </div>
              </Card>

              <Card className="surface-elevated p-5">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Comments and activity</div>
                <div className="mt-4 space-y-3">
                  {selectedAction.comments.map((comment) => (
                    <div key={comment.id} className="rounded-md border border-border/70 bg-card/50 p-3">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>{comment.author}</span>
                        <span>{comment.time}</span>
                      </div>
                      <p className="mt-2 text-sm text-foreground">{comment.text}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : null}

          <Card className="surface-elevated p-5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Operational context</div>
            <h2 className="mt-2 font-display text-lg">What needs your attention next</h2>
            <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
              <li className="rounded-md border border-border/70 bg-card/50 p-3">
                Actions requested by Megatrend usually unlock lease, quote, or document workflows that cannot proceed without client input.
              </li>
              <li className="rounded-md border border-border/70 bg-card/50 p-3">
                System-generated actions explain where extraction, publishing, or validation has paused after a document upload.
              </li>
              <li className="rounded-md border border-border/70 bg-card/50 p-3">
                Client-created requests keep follow-ups in one visible workspace instead of fragmenting them across email threads.
              </li>
            </ul>
          </Card>
        </aside>
      </div>
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

function PriorityBadge({ priority }: { priority: ActionPriority }) {
  const classes = {
    High: "border-warning/50 bg-warning/10 text-warning",
    Medium: "border-primary/25 bg-primary/8 text-primary",
    Low: "border-border bg-accent/40 text-muted-foreground",
  } satisfies Record<ActionPriority, string>;

  return <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${classes[priority]}`}>{priority}</span>;
}

function StatusBadge({ status }: { status: ActionStatus }) {
  const classes = {
    Open: "border-primary/25 bg-primary/8 text-primary",
    "In progress": "border-primary/25 bg-primary/8 text-primary",
    "Waiting on Megatrend": "border-border bg-accent/40 text-muted-foreground",
    "Waiting on client": "border-warning/40 bg-warning/10 text-warning",
    Completed: "border-success/40 bg-success/10 text-success",
    Overdue: "border-destructive/40 bg-destructive/10 text-destructive",
  } satisfies Record<ActionStatus, string>;

  return <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${classes[status]}`}>{status}</span>;
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full border border-dashed border-border bg-accent/30">
        <Clock3 className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mt-5 font-display text-2xl">No open actions.</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        When Megatrend needs something from your team, it will appear here.
      </p>
    </div>
  );
}

function getPropertyName(propertyId: string, propertyOptions: Array<{ id: string; name: string }>) {
  return propertyOptions.find((property) => property.id === propertyId)?.name ?? "Unassigned property";
}

function matchesActionTab(status: ActionStatus, tab: ActionTab) {
  if (tab === "All") return true;
  if (tab === "Open") return status === "Open" || status === "Waiting on client" || status === "Overdue";
  return status === tab;
}
