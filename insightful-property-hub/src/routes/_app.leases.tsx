import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { LeaseFormDialog } from "@/components/portfolio/lease-form-dialog";
import {
  describeLeaseStatus,
  formatDate,
  formatTimeToExpiry,
  formatZAR,
  isLiveLease,
  monthsUntil,
} from "@/lib/portfolio";
import { useVoiceCommands } from "@/lib/voice/command-registry";
import { validateNewFormSearch } from "@/lib/voice/new-form-search";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/_app/leases")({
  validateSearch: validateNewFormSearch,
  head: () => ({
    meta: [
      { title: "Leases · Cyphersoft OS" },
      { name: "description", content: "Track every lease from start to renewal." },
    ],
  }),
  component: LeasesPage,
});

type LeaseFilter = "all" | "expiring" | "renewals";

function LeasesPage() {
  const leases = useQuery(api.leases.list, {});
  const navigate = useNavigate();
  const [filter, setFilter] = useState<LeaseFilter>("all");
  useVoiceCommands("leases.list", {
    "leases.filter": {
      run: ({ filter: next }) => {
        setFilter(String(next) as LeaseFilter);
        return `Showing ${String(next)} leases.`;
      },
    },
  });
  const filtered = (leases ?? []).filter((l) =>
    filter === "all"
      ? true
      : filter === "expiring"
        ? isLiveLease(l) && monthsUntil(l.endDate) <= 12
        : l.status === "renewal_in_progress" ||
          l.status === "client_decision_pending" ||
          describeLeaseStatus(l) === "Renewal window open" ||
          describeLeaseStatus(l) === "Expiring soon",
  );

  const search = Route.useSearch();
  const setCreateOpen = (open: boolean) =>
    void navigate({ to: "/leases", search: open ? { new: "1" } : {}, replace: !open });
  const addButton = (
    <LeaseFormDialog
      open={search.new === "1"}
      onOpenChange={setCreateOpen}
      trigger={
        <Button>
          <Plus className="h-4 w-4" /> New lease
        </Button>
      }
      onSaved={(leaseId) => void navigate({ to: "/leases/$id", params: { id: leaseId } })}
    />
  );
  const emptyAddButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus className="h-4 w-4" /> New lease
    </Button>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Internal · Leases"
        title="Every lease, every clause."
        description="Live status across the portfolio — from active to renewal window to renewed."
        actions={addButton}
      />
      <Tabs value={filter} onValueChange={(v) => setFilter(v as LeaseFilter)} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">All leases</TabsTrigger>
          <TabsTrigger value="expiring">Expiring ≤12mo</TabsTrigger>
          <TabsTrigger value="renewals">Renewal pipeline</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="surface-elevated overflow-x-auto p-4">
        {leases === undefined ? (
          <LoadingState label="Loading leases…" />
        ) : leases.length === 0 ? (
          <EmptyState
            title="No leases yet"
            description="Add a lease to one of your clients' properties."
            action={emptyAddButton}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No leases match this view" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="py-3 pr-3">Property</th>
                <th className="py-3 pr-3">Client</th>
                <th className="py-3 pr-3">Term</th>
                <th className="py-3 pr-3">Escalation</th>
                <th className="py-3 pr-3 text-right">Monthly</th>
                <th className="py-3 pr-3">Time to expiry</th>
                <th className="py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l._id} className="border-b border-border/50 hover:bg-accent/30">
                  <td className="py-3 pr-3">
                    <Link
                      to="/leases/$id"
                      params={{ id: l._id }}
                      className="font-medium hover:text-primary"
                    >
                      {l.property?.name ?? "Property"}
                    </Link>
                  </td>
                  <td className="py-3 pr-3 text-muted-foreground">{l.client.name}</td>
                  <td className="py-3 pr-3 font-mono text-xs">
                    {formatDate(l.startDate)} → {formatDate(l.endDate)}
                  </td>
                  <td className="py-3 pr-3">
                    {l.escalationPercent !== undefined ? `${l.escalationPercent}%` : "—"}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono">{formatZAR(l.monthlyRental)}</td>
                  <td className="py-3 pr-3 font-mono text-xs text-primary">
                    {isLiveLease(l) ? formatTimeToExpiry(l.endDate) : "—"}
                  </td>
                  <td className="py-3">
                    <span className="tag-pill">{describeLeaseStatus(l)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
