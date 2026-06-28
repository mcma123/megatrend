import { createFileRoute, notFound } from "@tanstack/react-router";
import { Building2, Receipt, FileText, Bell, Upload, MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getClientBySlug, leases, properties, documents, tasks, invoices,
  formatZAR, monthsUntil,
} from "@/lib/mock-data";

export const Route = createFileRoute("/portal/$clientSlug/")({
  loader: ({ params }) => {
    const client = getClientBySlug(params.clientSlug);
    if (!client) throw notFound();
    return { client };
  },
  component: PortalDashboard,
});

function PortalDashboard() {
  const { client } = Route.useLoaderData();
  const clientLeases = leases.filter((l) => l.clientId === client.id);
  const clientProps = properties.filter((p) => p.clientId === client.id);
  const renewing = clientLeases.filter((l) => monthsUntil(l.end) <= 18);
  const clientTasks = tasks.filter((t) => t.clientId === client.id);
  const clientDocs = documents.filter((d) => d.clientId === client.id);
  const clientAnomalies = invoices.filter((i) => i.clientId === client.id && (i.severity === "High" || i.severity === "Critical"));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        eyebrow={`Welcome back, ${client.contact.split(" ")[0]}`}
        title="Your portfolio, live."
        description={`Managed by ${client.consultant}. Everything is current as of today.`}
        actions={
          <>
            <Button variant="outline"><Upload className="h-4 w-4" /> Upload invoice</Button>
            <Button><MessageSquare className="h-4 w-4" /> Request quote</Button>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { l: "Active leases", v: clientLeases.length, icon: Building2 },
          { l: "Annual rental", v: formatZAR(client.annualRental), icon: Receipt },
          { l: "Renewing ≤18mo", v: renewing.length, icon: Bell },
          { l: "Open actions", v: clientTasks.filter(t => t.status !== "Completed").length, icon: FileText },
        ].map((s) => (
          <Card key={s.l} className="surface-elevated p-5">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{s.l}</div>
              <s.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 font-display text-2xl">{s.v}</div>
          </Card>
        ))}
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card className="surface-elevated p-6 lg:col-span-2">
          <h3 className="font-display text-lg">Your properties</h3>
          <table className="mt-4 w-full text-sm">
            <thead><tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="py-2 pr-2">Property</th><th className="py-2 pr-2">Type</th>
              <th className="py-2 pr-2 text-right">Size</th><th className="py-2 pr-2 text-right">Monthly</th><th className="py-2">Expiry</th>
            </tr></thead>
            <tbody>
              {clientProps.map((p) => (
                <tr key={p.id} className="border-b border-border/50">
                  <td className="py-2 pr-2 font-medium">{p.name}</td>
                  <td className="py-2 pr-2 text-muted-foreground">{p.type}</td>
                  <td className="py-2 pr-2 text-right font-mono">{p.sizeSqm.toLocaleString()}</td>
                  <td className="py-2 pr-2 text-right font-mono">{formatZAR(p.monthlyRental)}</td>
                  <td className="py-2 font-mono text-xs">{p.expiry}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Renewal timeline</h3>
          <ul className="mt-4 space-y-3">
            {renewing.map((l) => {
              const p = properties.find((p) => p.id === l.propertyId)!;
              return (
                <li key={l.id} className="rounded-md border border-border bg-card/50 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span className="font-mono text-xs text-primary">T-{monthsUntil(l.end)}mo</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{l.status}</div>
                </li>
              );
            })}
            {renewing.length === 0 && <li className="text-sm text-muted-foreground">Nothing renewing in the next 18 months.</li>}
          </ul>
        </Card>
      </div>

      {clientAnomalies.length > 0 && (
        <Card className="surface-elevated mt-6 border-warning/40 bg-warning/5 p-5">
          <h3 className="font-display text-lg text-warning">Anomaly alerts</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {clientAnomalies.map((i) => (
              <li key={i.id}>{i.supplier} · {i.month} — <span className="font-mono">+{Math.round(i.delta * 100)}%</span> vs baseline. <span className="text-muted-foreground">{i.cause}</span></li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Your action items</h3>
          <ul className="mt-3 divide-y divide-border">
            {clientTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                <div><div className="font-medium">{t.title}</div><div className="text-xs text-muted-foreground">due {t.due}</div></div>
                <span className="tag-pill">{t.status}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Documents</h3>
          <ul className="mt-3 divide-y divide-border">
            {clientDocs.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                <div><div className="font-medium">{d.name}</div><div className="text-xs text-muted-foreground">{d.type} · {d.uploaded}</div></div>
                <span className="tag-pill">{d.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </main>
  );
}
