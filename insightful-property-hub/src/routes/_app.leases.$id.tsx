import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { leases, getProperty, getClient, formatZAR, monthsUntil, renewalSteps } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/leases/$id")({
  loader: ({ params }) => {
    const lease = leases.find((l) => l.id === params.id);
    if (!lease) throw notFound();
    return { lease };
  },
  notFoundComponent: () => <div className="p-8">Lease not found.</div>,
  component: LeaseDetail,
});

function LeaseDetail() {
  const { lease } = Route.useLoaderData();
  const p = getProperty(lease.propertyId)!;
  const c = getClient(lease.clientId)!;
  const months = monthsUntil(lease.end);
  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/leases" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Leases</Link>
      <PageHeader
        eyebrow={`${c.name} · ${p.suburb}`} title={p.name}
        description={`${lease.start} → ${lease.end} · ${lease.consultant}`}
        actions={<><Button variant="outline">Renew</Button><Button>Open briefing pack</Button></>}
      />
      <div className="grid gap-3 md:grid-cols-4">
        {[
          { l: "Monthly", v: formatZAR(lease.monthlyRental) },
          { l: "Annual", v: formatZAR(lease.monthlyRental * 12) },
          { l: "Time to expiry", v: `${months} months` },
          { l: "Status", v: lease.status },
        ].map((s) => (
          <Card key={s.l} className="surface-elevated p-4">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{s.l}</div>
            <div className="mt-2 font-display text-xl">{s.v}</div>
          </Card>
        ))}
      </div>
      <Card className="surface-elevated mt-6 p-6">
        <h3 className="font-display text-lg">Critical clauses</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Escalation</dt><dd className="font-mono text-sm">{lease.escalation}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Notice period</dt><dd className="font-mono text-sm">{lease.noticePeriod}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Break clause</dt><dd className="font-mono text-sm">{lease.breakClause}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Term</dt><dd className="font-mono text-sm">{lease.termMonths} months</dd></div>
        </dl>
      </Card>
      <Card className="surface-elevated mt-6 p-6">
        <h3 className="font-display text-lg">Renewal timeline</h3>
        <ol className="mt-4 space-y-3">
          {renewalSteps.map((s, i) => (
            <li key={s.offset} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className={`grid h-8 w-8 place-items-center rounded-full border ${i <= 1 ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>
                  <span className="font-mono text-[10px]">{s.offset}</span>
                </div>
                {i < renewalSteps.length - 1 && <div className="my-1 h-6 w-px bg-border" />}
              </div>
              <div className="pb-2">
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-xs text-muted-foreground">{s.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
