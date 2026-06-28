import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles, ArrowRight, Download } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { suggestedQueries, leases, clients, getProperty, getClient, formatZAR, monthsUntil } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/search")({
  head: () => ({ meta: [{ title: "Ask anything · Megatrend OS" }, { name: "description", content: "Natural-language search across leases, clients, invoices and documents." }] }),
  component: SearchPage,
});

function SearchPage() {
  const [q, setQ] = useState("Show all DHL leases expiring in 18 months");
  const ran = q.length > 0;

  const dhl = clients.find((c) => c.slug === "dhl-logistics-sa");
  const results = leases.filter((l) => l.clientId === dhl?.id && monthsUntil(l.end) <= 18);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Internal · Search"
        title="Ask anything."
        description="Natural-language portfolio search across leases, clients, documents and invoices."
      />
      <Card className="surface-elevated p-2">
        <div className="flex items-center gap-2 px-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything…" className="h-12 border-0 bg-transparent text-base shadow-none focus-visible:ring-0" />
          <Button>Ask <ArrowRight className="h-4 w-4" /></Button>
        </div>
      </Card>

      <div className="mt-4 flex flex-wrap gap-2">
        {suggestedQueries.map((s) => (
          <button key={s} onClick={() => setQ(s)} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:border-primary hover:text-primary">{s}</button>
        ))}
      </div>

      {ran && (
        <>
          <Card className="surface-elevated mt-6 border-primary/30 bg-accent/30 p-5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-primary">AI insight</div>
            <p className="mt-1 text-sm">
              {dhl?.name} has <strong>{results.length} leases</strong> expiring within 18 months, representing{" "}
              <strong>{formatZAR(results.reduce((s, l) => s + l.monthlyRental * 12, 0))}</strong> in annual rental.
              Renewal workflows are already running on each.
            </p>
          </Card>
          <Card className="surface-elevated mt-4 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg">Results · {results.length}</h3>
              <Button variant="outline" size="sm"><Download className="h-3.5 w-3.5" /> Export CSV</Button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-2 pr-3">Property</th><th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Expiry</th><th className="py-2 pr-3 text-right">Monthly</th><th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((l) => {
                  const p = getProperty(l.propertyId)!;
                  return (
                    <tr key={l.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-medium">{p.name}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{getClient(l.clientId)?.name}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{l.end}</td>
                      <td className="py-2 pr-3 text-right font-mono">{formatZAR(l.monthlyRental)}</td>
                      <td className="py-2"><span className="tag-pill">{l.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-3 text-xs text-muted-foreground">Sources · leases.csv · DHL portfolio · document_index</div>
          </Card>
        </>
      )}
    </div>
  );
}
