import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Users, ScrollText, AlertTriangle, FileText, Compass, Receipt,
  TrendingUp, ArrowUpRight, Sparkles, Workflow, Building2, ListChecks,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  clients, leases, properties, documents, tasks, invoices, briefs, recentActivity,
  formatZAR, monthsUntil,
} from "@/lib/mock-data";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard · Megatrend OS" },
      { name: "description", content: "Live overview of clients, leases, sourcing, automation and document intelligence." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const activeClients = clients.filter((c) => c.status === "Active").length;
  const upcomingRenewals = leases.filter((l) => {
    const m = monthsUntil(l.end);
    return m <= 18 && m >= 0;
  }).length;
  const openTasks = tasks.filter((t) => t.status !== "Completed").length;
  const totalRental = clients.reduce((s, c) => s + c.annualRental, 0);
  const anomalies = invoices.filter((i) => i.severity === "High" || i.severity === "Critical").length;

  const kpis = [
    { label: "Active clients", value: activeClients, icon: Users, sub: `${clients.length} total` },
    { label: "Active leases", value: leases.length, icon: ScrollText, sub: `${upcomingRenewals} renewing ≤18mo` },
    { label: "Annual rental managed", value: formatZAR(totalRental), icon: TrendingUp, sub: "across portfolio" },
    { label: "Open action items", value: openTasks, icon: ListChecks, sub: `${tasks.filter(t=>t.status==="Overdue").length} overdue` },
    { label: "Documents processed", value: documents.length, icon: FileText, sub: `${documents.filter(d=>d.status==="Needs review").length} need review` },
    { label: "Anomalies flagged", value: anomalies, icon: AlertTriangle, sub: "high or critical" },
    { label: "Briefs in progress", value: briefs.length, icon: Compass, sub: `${briefs.filter(b=>b.status==="Generated").length} generated` },
    { label: "Properties tracked", value: properties.length, icon: Building2, sub: "client + market" },
  ];

  const buckets = [
    {
      tag: "Bucket 01 · External",
      title: "Sourcing & market intelligence",
      desc: "Type a brief, get a ranked options pack in under a minute. Replaces a 3-hour manual cycle.",
      href: "/sourcing",
      icon: Compass,
    },
    {
      tag: "Bucket 02 · Internal",
      title: "Clients, leases & document intelligence",
      desc: "Every lease, addendum, invoice and memo turned into structured, searchable data.",
      href: "/clients",
      icon: Users,
    },
    {
      tag: "Bucket 03 · Automation",
      title: "Event-driven workflows",
      desc: "Renewal timelines, anomaly checks, client comms — running on a T-180 → T-7 cadence.",
      href: "/automations",
      icon: Workflow,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="01 · Overview"
        title="The operating system for Megatrend."
        description="Spreadsheets, folder trees and manual options packs — replaced by one cohesive surface for clients, leases, sourcing, documents and automation."
        actions={
          <>
            <Button variant="outline" asChild><Link to="/search"><Sparkles className="h-4 w-4" /> Ask anything</Link></Button>
            <Button asChild><Link to="/sourcing">New brief <ArrowUpRight className="h-4 w-4" /></Link></Button>
          </>
        }
      />

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="surface-elevated p-4">
            <div className="flex items-start justify-between">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k.label}</div>
              <k.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-3 font-display text-2xl md:text-3xl font-medium">{k.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{k.sub}</div>
          </Card>
        ))}
      </section>

      {/* Buckets */}
      <section className="mt-10 grid gap-4 md:grid-cols-3">
        {buckets.map((b) => (
          <Link key={b.tag} to={b.href} className="group">
            <Card className="surface-elevated h-full p-6 transition-all group-hover:-translate-y-0.5 group-hover:border-primary/50">
              <div className="flex items-center justify-between">
                <span className="tag-pill">{b.tag}</span>
                <b.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="mt-6 font-display text-2xl font-medium leading-tight">{b.title}</h3>
              <p className="mt-3 text-sm text-muted-foreground">{b.desc}</p>
              <div className="mt-6 inline-flex items-center gap-1 text-xs font-medium text-primary">
                Open <ArrowUpRight className="h-3.5 w-3.5" />
              </div>
            </Card>
          </Link>
        ))}
      </section>

      {/* Two-col: activity & alerts */}
      <section className="mt-10 grid gap-4 lg:grid-cols-3">
        <Card className="surface-elevated p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg">Recent activity</h3>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">live feed</span>
          </div>
          <ul className="mt-4 divide-y divide-border">
            {recentActivity.map((a, i) => (
              <li key={i} className="flex items-start gap-3 py-3">
                <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <div className="flex-1 text-sm">{a.text}</div>
                <div className="text-xs text-muted-foreground">{a.t}</div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Renewal alerts</h3>
          <ul className="mt-4 space-y-3">
            {leases
              .filter((l) => monthsUntil(l.end) <= 18)
              .map((l) => {
                const p = properties.find((p) => p.id === l.propertyId)!;
                const c = clients.find((c) => c.id === l.clientId)!;
                const months = monthsUntil(l.end);
                return (
                  <li key={l.id} className="rounded-md border border-border bg-card/50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{c.name}</span>
                      <span className="font-mono text-xs text-primary">T-{months}mo</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{p.name} · {p.suburb}</div>
                  </li>
                );
              })}
          </ul>
        </Card>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Document processing</h3>
          <ul className="mt-4 space-y-2">
            {documents.slice(0, 5).map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">{d.type} · uploaded {d.uploaded}</div>
                </div>
                <span className={`tag-pill ${d.status === "Needs review" ? "!text-warning !border-warning/40 !bg-warning/10" : ""}`}>
                  {d.status}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Client actions</h3>
          <ul className="mt-4 space-y-2">
            {tasks.slice(0, 5).map((t) => (
              <li key={t.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{t.title}</div>
                  <div className="text-xs text-muted-foreground">{t.assignee} · due {t.due}</div>
                </div>
                <span className={`tag-pill ${t.status === "Overdue" ? "!text-destructive !border-destructive/40 !bg-destructive/10" : ""}`}>
                  {t.status}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
