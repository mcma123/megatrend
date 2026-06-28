import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Map as MapIcon, List } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { properties, formatZAR, getClient } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/properties")({
  head: () => ({ meta: [{ title: "Properties · Megatrend OS" }, { name: "description", content: "Every property occupied, reviewed, sourced or proposed for our clients." }] }),
  component: PropertiesPage,
});

function PropertiesPage() {
  const [view, setView] = useState<"table" | "map">("table");
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="External + Internal · Portfolio"
        title="Properties under review."
        description="Client-occupied, off-market sourcing, shortlisted opportunities — one searchable inventory."
        actions={
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            <Button size="sm" variant={view === "table" ? "default" : "ghost"} onClick={() => setView("table")}><List className="h-3.5 w-3.5" /> Table</Button>
            <Button size="sm" variant={view === "map" ? "default" : "ghost"} onClick={() => setView("map")}><MapIcon className="h-3.5 w-3.5" /> Map</Button>
          </div>
        }
      />
      {view === "table" ? (
        <Card className="surface-elevated overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="py-3 pr-3">Property</th><th className="py-3 pr-3">Location</th>
                <th className="py-3 pr-3">Type</th><th className="py-3 pr-3 text-right">Size</th>
                <th className="py-3 pr-3 text-right">R/sqm</th><th className="py-3 pr-3 text-right">Monthly</th>
                <th className="py-3 pr-3">Client</th><th className="py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-accent/30">
                  <td className="py-3 pr-3"><Link to="/properties/$id" params={{ id: p.id }} className="font-medium hover:text-primary">{p.name}</Link></td>
                  <td className="py-3 pr-3 text-muted-foreground">{p.suburb}, {p.city}</td>
                  <td className="py-3 pr-3">{p.type}</td>
                  <td className="py-3 pr-3 text-right font-mono">{p.sizeSqm.toLocaleString()}</td>
                  <td className="py-3 pr-3 text-right font-mono">R{p.rentalPerSqm}</td>
                  <td className="py-3 pr-3 text-right font-mono">{formatZAR(p.monthlyRental)}</td>
                  <td className="py-3 pr-3 text-muted-foreground">{p.clientId ? getClient(p.clientId)?.name : "—"}</td>
                  <td className="py-3"><span className="tag-pill">{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card className="surface-elevated grid-bg relative flex h-[520px] items-center justify-center overflow-hidden p-0">
          <div className="absolute inset-0">
            {properties.map((p, i) => (
              <div key={p.id} className="absolute" style={{ left: `${(i * 13 + 12) % 80 + 5}%`, top: `${(i * 19 + 8) % 70 + 10}%` }}>
                <div className="group relative">
                  <div className="h-3 w-3 rounded-full bg-primary ring-4 ring-primary/20 animate-pulse" />
                  <div className="invisible absolute left-5 top-0 z-10 w-48 rounded-md border border-border bg-card p-2 text-xs shadow-lg group-hover:visible">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-muted-foreground">{p.suburb} · {p.type}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="relative z-10 text-center">
            <div className="font-display text-2xl">Map view</div>
            <div className="text-xs text-muted-foreground">Mock plot · live tiles arrive with backend</div>
          </div>
        </Card>
      )}
    </div>
  );
}
