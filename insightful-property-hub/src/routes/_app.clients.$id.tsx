import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, Mail, User, Building2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clients, leases, properties, documents, tasks, getClient, getProperty, formatZAR, monthsUntil } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/clients/$id")({
  loader: ({ params }) => {
    const client = getClient(params.id);
    if (!client) throw notFound();
    return { client };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.client.name ?? "Client"} · Megatrend OS` },
      { name: "description", content: `Portfolio, leases and documents for ${loaderData?.client.name}.` },
    ],
  }),
  notFoundComponent: () => <div className="p-8">Client not found.</div>,
  component: ClientDetail,
});

function ClientDetail() {
  const { client } = Route.useLoaderData();
  const clientLeases = leases.filter((l) => l.clientId === client.id);
  const clientProps = properties.filter((p) => p.clientId === client.id);
  const clientDocs = documents.filter((d) => d.clientId === client.id);
  const clientTasks = tasks.filter((t) => t.clientId === client.id);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-2">
        <Link to="/clients" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> All clients
        </Link>
      </div>
      <PageHeader
        eyebrow={`Client · ${client.type}`}
        title={client.name}
        description={`${client.industry} · client since ${client.since} · managed by ${client.consultant}`}
        actions={<Button asChild variant="outline"><Link to="/portal/$clientSlug" params={{ clientSlug: client.slug }}>View client portal</Link></Button>}
      />

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Annual rental", value: formatZAR(client.annualRental) },
          { label: "Active leases", value: clientLeases.length },
          { label: "Properties", value: clientProps.length },
          { label: "Renewals ≤18mo", value: clientLeases.filter(l => monthsUntil(l.end) <= 18).length },
        ].map((s) => (
          <Card key={s.label} className="surface-elevated p-4">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{s.label}</div>
            <div className="mt-2 font-display text-2xl">{s.value}</div>
          </Card>
        ))}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Sidebar list of all clients */}
        <Card className="surface-elevated h-fit p-3">
          <div className="px-2 pb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Active clients</div>
          <ul className="space-y-0.5">
            {clients.map((c) => (
              <li key={c.id}>
                <Link
                  to="/clients/$id" params={{ id: c.id }}
                  className={`block rounded-md px-2 py-2 text-sm transition-colors ${c.id === client.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.leases} leases · {formatZAR(c.annualRental)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        {/* Main */}
        <div>
          <Card className="surface-elevated mb-4 p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div><div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Main contact</div>
                <div className="mt-1 flex items-center gap-2 text-sm"><User className="h-3.5 w-3.5 text-muted-foreground" /> {client.contact}</div></div>
              <div><div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Email</div>
                <div className="mt-1 flex items-center gap-2 text-sm"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> {client.email}</div></div>
              <div><div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Account owner</div>
                <div className="mt-1 text-sm">{client.consultant}</div></div>
            </div>
          </Card>

          <Tabs defaultValue="portfolio">
            <TabsList>
              <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
              <TabsTrigger value="leases">Leases</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>
            <TabsContent value="portfolio">
              <Card className="surface-elevated p-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="py-2 pr-3">Property</th><th className="py-2 pr-3">City / suburb</th>
                      <th className="py-2 pr-3">Type</th><th className="py-2 pr-3 text-right">Size</th>
                      <th className="py-2 pr-3 text-right">Rental</th><th className="py-2">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientProps.map((p) => (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-accent/30">
                        <td className="py-2 pr-3"><Link to="/properties/$id" params={{ id: p.id }} className="font-medium hover:text-primary">{p.name}</Link></td>
                        <td className="py-2 pr-3 text-muted-foreground">{p.city} · {p.suburb}</td>
                        <td className="py-2 pr-3">{p.type}</td>
                        <td className="py-2 pr-3 text-right font-mono">{p.sizeSqm.toLocaleString()}</td>
                        <td className="py-2 pr-3 text-right font-mono">{formatZAR(p.monthlyRental)}</td>
                        <td className="py-2 font-mono text-xs">{p.expiry}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </TabsContent>
            <TabsContent value="leases">
              <Card className="surface-elevated p-4">
                <ul className="divide-y divide-border">
                  {clientLeases.map((l) => {
                    const p = getProperty(l.propertyId)!;
                    return (
                      <li key={l.id} className="flex items-center justify-between py-3">
                        <div>
                          <Link to="/leases/$id" params={{ id: l.id }} className="font-medium hover:text-primary"><Building2 className="inline h-3.5 w-3.5" /> {p.name}</Link>
                          <div className="text-xs text-muted-foreground">{l.start} → {l.end} · {l.escalation}</div>
                        </div>
                        <span className="tag-pill">{l.status}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </TabsContent>
            <TabsContent value="documents">
              <Card className="surface-elevated p-4">
                <ul className="divide-y divide-border">
                  {clientDocs.map((d) => (
                    <li key={d.id} className="flex items-center justify-between py-3">
                      <div>
                        <Link to="/documents/$id" params={{ id: d.id }} className="font-medium hover:text-primary">{d.name}</Link>
                        <div className="text-xs text-muted-foreground">{d.type} · confidence {Math.round(d.confidence * 100)}%</div>
                      </div>
                      <span className="tag-pill">{d.status}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </TabsContent>
            <TabsContent value="actions">
              <Card className="surface-elevated p-4">
                <ul className="divide-y divide-border">
                  {clientTasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between py-3">
                      <div>
                        <div className="font-medium">{t.title}</div>
                        <div className="text-xs text-muted-foreground">{t.assignee} · due {t.due}</div>
                      </div>
                      <span className="tag-pill">{t.status}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
