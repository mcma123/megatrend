import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getProperty, getClient, formatZAR, leases } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/properties/$id")({
  loader: ({ params }) => {
    const property = getProperty(params.id);
    if (!property) throw notFound();
    return { property };
  },
  notFoundComponent: () => <div className="p-8">Property not found.</div>,
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.property.name ?? "Property"} · Megatrend OS` }],
  }),
  component: PropertyDetail,
});

function PropertyDetail() {
  const { property } = Route.useLoaderData();
  const client = property.clientId ? getClient(property.clientId) : null;
  const lease = leases.find((l) => l.propertyId === property.id);
  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/properties" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Properties</Link>
      <PageHeader eyebrow={property.type} title={property.name} description={`${property.address}, ${property.suburb}, ${property.city}`}
        actions={<><Button variant="outline">Shortlist</Button><Button>Add to brief</Button></>} />
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { l: "Size", v: `${property.sizeSqm.toLocaleString()} sqm` },
          { l: "Rental", v: `R${property.rentalPerSqm}/sqm` },
          { l: "Monthly", v: formatZAR(property.monthlyRental) },
          { l: "Landlord", v: property.landlord },
          { l: "Expiry", v: property.expiry },
          { l: "Status", v: property.status },
        ].map((s) => (
          <Card key={s.l} className="surface-elevated p-4">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{s.l}</div>
            <div className="mt-2 font-display text-xl">{s.v}</div>
          </Card>
        ))}
      </div>
      <Card className="surface-elevated mt-6 p-6">
        <h3 className="font-display text-lg">Features</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {property.features.map((f: string) => <span key={f} className="rounded-full border border-border bg-background px-3 py-1 text-xs">{f}</span>)}
        </div>
      </Card>
      {client && (
        <Card className="surface-elevated mt-6 p-6">
          <h3 className="font-display text-lg">Linked client</h3>
          <div className="mt-2 flex items-center justify-between">
            <Link to="/clients/$id" params={{ id: client.id }} className="font-medium hover:text-primary">{client.name}</Link>
            <span className="text-sm text-muted-foreground">{client.industry}</span>
          </div>
        </Card>
      )}
      {lease && (
        <Card className="surface-elevated mt-6 p-6">
          <h3 className="font-display text-lg">Lease summary</h3>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
            <div><div className="text-muted-foreground">Term</div><div>{lease.start} → {lease.end}</div></div>
            <div><div className="text-muted-foreground">Escalation</div><div>{lease.escalation}</div></div>
            <div><div className="text-muted-foreground">Notice</div><div>{lease.noticePeriod}</div></div>
          </div>
        </Card>
      )}
    </div>
  );
}
