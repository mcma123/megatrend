import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clients, formatZAR } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/clients")({
  head: () => ({ meta: [{ title: "Clients · Megatrend OS" }, { name: "description", content: "Client portfolio CRM for tenant-rep advisory." }] }),
  component: ClientsPage,
});

function ClientsPage() {
  const [q, setQ] = useState("");
  const filtered = clients.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Internal · Clients"
        title="Every client. Every lease. One profile."
        description="DHL, MTN, Pioneer, Absa and the rest — with annual exposure, leases, consultants and documents in one place."
        actions={<Button><Plus className="h-4 w-4" /> New client</Button>}
      />
      <Card className="surface-elevated p-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="pl-9" />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="py-3 pr-4">Client</th>
                <th className="py-3 pr-4">Industry</th>
                <th className="py-3 pr-4">Type</th>
                <th className="py-3 pr-4">Consultant</th>
                <th className="py-3 pr-4 text-right">Leases</th>
                <th className="py-3 pr-4 text-right">Annual rental</th>
                <th className="py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-border/50 transition-colors hover:bg-accent/30">
                  <td className="py-3 pr-4">
                    <Link to="/clients/$id" params={{ id: c.id }} className="font-medium hover:text-primary">{c.name}</Link>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">{c.industry}</td>
                  <td className="py-3 pr-4"><span className="tag-pill">{c.type}</span></td>
                  <td className="py-3 pr-4 text-muted-foreground">{c.consultant}</td>
                  <td className="py-3 pr-4 text-right font-mono">{c.leases}</td>
                  <td className="py-3 pr-4 text-right font-mono">{formatZAR(c.annualRental)}</td>
                  <td className="py-3"><span className={`tag-pill ${c.status === "Active" ? "" : "!text-muted-foreground !border-border"}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
