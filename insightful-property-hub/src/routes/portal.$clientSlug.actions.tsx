import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { ListChecks, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionDetailDialog } from "@/components/actions/action-detail-dialog";
import {
  ActionFormDialog,
  EMPTY_ACTION,
  type ActionFormValues,
} from "@/components/actions/action-form-dialog";
import { EmptyState, LoadingState, NativeSelect } from "@/components/portfolio/form-fields";
import { usePortal } from "@/lib/portal-context";
import { formatDate } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import {
  CLIENT_ACTION_STATUS_LABELS,
  PRIORITY_CLASSES,
  PRIORITY_LABELS,
  isDueThisWeek,
  isOpenAction,
  isOverdue,
} from "@/lib/workflow";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/portal/$clientSlug/actions")({
  head: () => ({ meta: [{ title: "Actions | Client portal | Cyphersoft" }] }),
  component: ClientActionsPage,
});

type Tab = "open" | "waiting" | "completed" | "all";

function ClientActionsPage() {
  const { client, viewer } = usePortal();
  const actions = useQuery(api.actions.list, { tenantId: client.tenantId });
  const properties = useQuery(api.properties.list, { tenantId: client.tenantId }) ?? [];
  const [tab, setTab] = useState<Tab>("open");
  const [query, setQuery] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [selected, setSelected] = useState<Id<"actions"> | null>(null);
  const [form, setForm] = useState<ActionFormValues | null>(null);
  const canAct = viewer.roleKey !== "executive_viewer" && viewer.roleKey !== "read_only_staff";

  const rows = useMemo(() => actions ?? [], [actions]);
  const summary = {
    open: rows.filter((action) => isOpenAction(action.status)).length,
    waiting: rows.filter((action) => action.status === "waiting_on_client").length,
    dueThisWeek: rows.filter(isDueThisWeek).length,
    overdue: rows.filter(isOverdue).length,
  };

  const filtered = rows.filter((action) => {
    const q = query.trim().toLowerCase();
    const matchesTab =
      tab === "all"
        ? action.status !== "cancelled"
        : tab === "open"
          ? isOpenAction(action.status)
          : tab === "waiting"
            ? action.status === "waiting_on_client"
            : action.status === "completed";
    return (
      matchesTab &&
      (propertyFilter === "all" || action.property?.propertyId === propertyFilter) &&
      (!q ||
        action.title.toLowerCase().includes(q) ||
        (action.description ?? "").toLowerCase().includes(q))
    );
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <PageHeader
        eyebrow="Client portal | Actions"
        title="Actions"
        description="Requests to Cyphersoft and the things we need from you, in one place. Reply, attach documents and mark items complete."
        actions={
          canAct ? (
            <Button
              onClick={() =>
                setForm({ ...EMPTY_ACTION, tenantId: client.tenantId, visibleToClient: true })
              }
            >
              <ListChecks className="h-4 w-4" /> New request
            </Button>
          ) : null
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Open actions" value={summary.open} detail="Requests still in progress" />
        <Summary
          label="Waiting on you"
          value={summary.waiting}
          detail="Cyphersoft needs your input"
        />
        <Summary label="Due this week" value={summary.dueThisWeek} detail="Based on due dates" />
        <Summary
          label="Overdue"
          value={summary.overdue}
          detail="Past their due date"
          danger={summary.overdue > 0}
        />
      </section>

      <Card className="surface-elevated mt-6 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
            <TabsList>
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="waiting">
                Waiting on you{summary.waiting ? ` (${summary.waiting})` : ""}
              </TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search actions…"
                className="pl-9"
              />
            </div>
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
        </div>

        <div className="mt-4">
          {actions === undefined ? (
            <LoadingState label="Loading actions…" />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={rows.length === 0 ? "No actions yet" : "Nothing in this view"}
              description="When Cyphersoft needs something from your team, or you send a request, it appears here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((action) => (
                <li key={action._id}>
                  <button
                    type="button"
                    onClick={() => setSelected(action._id)}
                    className="flex w-full flex-col gap-2 py-3 text-left transition-colors hover:bg-accent/20 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{action.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {[
                          action.property?.name,
                          action.source === "client_request" ? "Your request" : "From Cyphersoft",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {action.dueDate ? (
                        <span
                          className={
                            isOverdue(action)
                              ? "font-medium text-destructive"
                              : "text-muted-foreground"
                          }
                        >
                          {isOverdue(action) ? "Overdue · " : "Due "}
                          {formatDate(action.dueDate)}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5",
                          PRIORITY_CLASSES[action.priority],
                        )}
                      >
                        {PRIORITY_LABELS[action.priority]}
                      </span>
                      <span className="tag-pill">{CLIENT_ACTION_STATUS_LABELS[action.status]}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <ActionDetailDialog actionId={selected} audience="client" onClose={() => setSelected(null)} />
      {form ? (
        <ActionFormDialog
          open
          audience="client"
          initial={form}
          onOpenChange={(open) => !open && setForm(null)}
        />
      ) : null}
    </main>
  );
}

function Summary({
  label,
  value,
  detail,
  danger,
}: {
  label: string;
  value: number;
  detail: string;
  danger?: boolean;
}) {
  return (
    <Card className="surface-elevated p-5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={cn("mt-2 font-display text-2xl", danger && "text-destructive")}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </Card>
  );
}
