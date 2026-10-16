import { DocumentLink } from "@/components/documents/document-link";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  FileText,
  Inbox,
  Lightbulb,
  ListChecks,
  ScrollText,
  Sparkles,
  TrendingUp,
  Users,
  Workflow,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { DOCUMENT_TYPE_LABELS } from "@/lib/documents";
import { formatDate, formatZAR } from "@/lib/portfolio";
import { ACTION_STATUS_LABELS, timeAgo } from "@/lib/workflow";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard · Cyphersoft OS" },
      {
        name: "description",
        content: "Live overview of clients, leases, documents, tasks and anomalies.",
      },
    ],
  }),
  component: Dashboard,
});

const BUCKETS = [
  {
    tag: "Review",
    title: "Documents & insights awaiting a decision",
    desc: "Approve extracted fields, apply them to leases and publish insights to clients.",
    href: "/review",
    icon: Inbox,
  },
  {
    tag: "Portfolio",
    title: "Clients, leases & document intelligence",
    desc: "Every lease, addendum, invoice and statement as structured, searchable data.",
    href: "/clients",
    icon: Users,
  },
  {
    tag: "Work",
    title: "Tasks & client requests",
    desc: "Client requests, document follow-ups and anomaly investigations in one board.",
    href: "/tasks",
    icon: Workflow,
  },
] as const;

function Dashboard() {
  const overview = useQuery(api.dashboard.staffOverview);

  if (overview === undefined) {
    return <LoadingState label="Loading dashboard…" />;
  }
  const { kpis } = overview;

  const cards = [
    {
      label: "Active clients",
      value: kpis.activeClients,
      icon: Users,
      sub: `${kpis.totalClients} total`,
      href: "/clients",
    },
    {
      label: "Live leases",
      value: kpis.liveLeases,
      icon: ScrollText,
      sub: `${kpis.renewingWithin18Months} renewing ≤18mo`,
      href: "/leases",
    },
    {
      label: "Annual rental managed",
      value: formatZAR(kpis.annualRental),
      icon: TrendingUp,
      sub: "live leases",
      href: "/reports",
    },
    {
      label: "Open tasks",
      value: kpis.openTasks,
      icon: ListChecks,
      sub: `${kpis.overdueTasks} overdue`,
      href: "/tasks",
    },
    {
      label: "Documents",
      value: kpis.documentsTotal,
      icon: FileText,
      sub: `${kpis.documentsNeedReview} need review · ${kpis.documentsProcessing} processing`,
      href: "/documents",
    },
    {
      label: "Open anomalies",
      value: kpis.openAnomalies,
      icon: AlertTriangle,
      sub: `${kpis.criticalAnomalies} high or critical`,
      href: "/invoices",
    },
    {
      label: "Published insights",
      value: kpis.publishedInsights,
      icon: Lightbulb,
      sub: `${kpis.draftInsights} in draft or review`,
      href: "/insights",
    },
    {
      label: "Properties tracked",
      value: kpis.properties,
      icon: Building2,
      sub: "across clients",
      href: "/properties",
    },
  ] as const;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="01 · Overview"
        title="The operating system for Cyphersoft."
        description="Clients, leases, documents, tasks and anomalies — live from the platform."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/search">
                <Sparkles className="h-4 w-4" /> Search
              </Link>
            </Button>
            <Button asChild>
              <Link to="/review">
                Review inbox <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((k) => (
          <Link key={k.label} to={k.href} className="group">
            <Card className="surface-elevated h-full p-4 transition-colors group-hover:border-primary/40">
              <div className="flex items-start justify-between">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {k.label}
                </div>
                <k.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="mt-3 font-display text-2xl font-medium md:text-3xl">{k.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{k.sub}</div>
            </Card>
          </Link>
        ))}
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-3">
        {BUCKETS.map((b) => (
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

      <section className="mt-10 grid gap-4 lg:grid-cols-3">
        <Card className="surface-elevated p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg">Recent activity</h3>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              from the audit log
            </span>
          </div>
          {overview.activity.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No activity yet" />
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {overview.activity.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-3">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0 flex-1 text-sm">
                    {a.text}
                    {a.actorName ? (
                      <span className="text-muted-foreground"> · {a.actorName}</span>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">
                    {timeAgo(a.occurredAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Renewal alerts</h3>
          {overview.renewals.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No live leases end in the next 18 months.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {overview.renewals.map((renewal) => (
                <li key={renewal.leaseId}>
                  <Link
                    to="/leases/$id"
                    params={{ id: renewal.leaseId }}
                    className="block rounded-md border border-border bg-card/50 p-3 transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{renewal.client.name}</span>
                      <span
                        className={`font-mono text-xs ${renewal.monthsLeft <= 6 ? "text-destructive" : "text-primary"}`}
                      >
                        {renewal.monthsLeft < 0 ? "ended" : `${renewal.monthsLeft} mo`}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {renewal.propertyName} · ends {formatDate(renewal.endDate)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Latest documents</h3>
          {overview.latestDocuments.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No documents uploaded yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {overview.latestDocuments.map((d) => (
                <li key={d.documentId} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <DocumentLink
                      documentId={d.documentId}
                      className="block truncate font-medium hover:text-primary"
                    >
                      {d.filename}
                    </DocumentLink>
                    <div className="text-xs text-muted-foreground">
                      {d.client.name}
                      {d.documentType ? ` · ${DOCUMENT_TYPE_LABELS[d.documentType]}` : ""} ·{" "}
                      {timeAgo(d.createdAt)}
                    </div>
                  </div>
                  <DocumentStatusBadge status={d.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Open tasks</h3>
          {overview.latestTasks.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No open tasks.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {overview.latestTasks.map((t) => (
                <li key={t.actionId} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <Link to="/tasks" className="block truncate font-medium hover:text-primary">
                      {t.title}
                    </Link>
                    <div
                      className={`text-xs ${t.overdue ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {t.client.name}
                      {t.dueDate
                        ? ` · ${t.overdue ? "overdue" : "due"} ${formatDate(t.dueDate)}`
                        : ""}
                    </div>
                  </div>
                  <span className="tag-pill">{ACTION_STATUS_LABELS[t.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
