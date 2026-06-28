import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { leases, getProperty, getClient, formatZAR, monthsUntil } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/leases")({
  head: () => ({ meta: [{ title: "Leases · Megatrend OS" }, { name: "description", content: "Track every lease from start to renewal." }] }),
  component: LeasesPage,
});

function LeasesPage() {
  const [filter, setFilter] = useState<"all" | "expiring" | "renewals">("all");
  const filtered = leases.filter((l) =>
    filter === "all" ? true :
    filter === "expiring" ? monthsUntil(l.end) <= 12 :
    l.status === "Renewal window open" || l.status === "Renewal in progress"
  );
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Internal · Leases"
        title="Every lease, every clause."
        description="Live status across the portfolio — from active to renewal window to renewed."
      />
      <Tabs value={filter} onValueChange={(v) => setFilter(v as any)} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">All leases</TabsTrigger>
          <TabsTrigger value="expiring">Expiring ≤12mo</TabsTrigger>
          <TabsTrigger value="renewals">Renewal pipeline</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="surface-elevated overflow-x-auto p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="py-3 pr-3">Property</th><th className="py-3 pr-3">Client</th>
              <th className="py-3 pr-3">Term</th><th className="py-3 pr-3">Escalation</th>
              <th className="py-3 pr-3 text-right">Monthly</th><th className="py-3 pr-3">Time to expiry</th><th className="py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => {
              const p = getProperty(l.propertyId)!;
              const c = getClient(l.clientId)!;
              const months = monthsUntil(l.end);
              return (
                <tr key={l.id} className="border-b border-border/50 hover:bg-accent/30">
                  <td className="py-3 pr-3"><Link to="/leases/$id" params={{ id: l.id }} className="font-medium hover:text-primary">{p.name}</Link></td>
                  <td className="py-3 pr-3 text-muted-foreground">{c.name}</td>
                  <td className="py-3 pr-3 font-mono text-xs">{l.start} → {l.end}</td>
                  <td className="py-3 pr-3">{l.escalation}</td>
                  <td className="py-3 pr-3 text-right font-mono">{formatZAR(l.monthlyRental)}</td>
                  <td className="py-3 pr-3 font-mono text-xs text-primary">T-{months}mo</td>
                  <td className="py-3"><span className="tag-pill">{l.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
