import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ChevronRight, ScrollText, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { DocumentList } from "@/components/documents/document-list";
import { DocumentLink } from "@/components/documents/document-link";
import { useOpenDocument } from "@/lib/use-document-upload";
import { usePortalClient } from "@/lib/portal-context";
import {
  describeLeaseStatus,
  formatDate,
  formatTimeToExpiry,
  formatZAR,
  isLiveLease,
  termMonths,
} from "@/lib/portfolio";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/portal/$clientSlug/properties/$propertyId/lease")({
  head: () => ({ meta: [{ title: "Lease detail | Client portal | Cyphersoft" }] }),
  component: LeaseDetailPage,
});

function LeaseDetailPage() {
  const client = usePortalClient();
  const { propertyId } = Route.useParams();
  const property = useQuery(api.properties.get, { propertyId: propertyId as Id<"properties"> });
  const currentLease = property
    ? (property.leases.find(isLiveLease) ?? property.leases[0] ?? null)
    : null;
  const lease = useQuery(api.leases.get, currentLease ? { leaseId: currentLease._id } : "skip");
  const propertyDocuments = useQuery(api.documents.list, {
    tenantId: client.tenantId,
    propertyId: propertyId as Id<"properties">,
  });
  const openDocument = useOpenDocument();
  const leaseDocuments = (propertyDocuments ?? []).filter(
    (document) =>
      (document.documentType ?? document.declaredType) === "lease" ||
      (document.documentType ?? document.declaredType) === "addendum",
  );

  if (property === undefined || (currentLease && lease === undefined)) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <LoadingState label="Loading lease…" />
      </main>
    );
  }
  if (property === null || property.tenantId !== client.tenantId || !lease) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <EmptyState
          title={property ? "No lease recorded for this property" : "Property not found"}
          action={
            <Button asChild variant="outline">
              <Link to="/portal/$clientSlug" params={{ clientSlug: client.slug }}>
                Back to portfolio
              </Link>
            </Button>
          }
        />
      </main>
    );
  }

  const costPerSqm = property.sizeSqm ? Math.round(lease.monthlyRental / property.sizeSqm) : null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
        <Link
          to="/portal/$clientSlug"
          params={{ clientSlug: client.slug }}
          className="hover:text-foreground"
        >
          Portfolio
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link
          to="/portal/$clientSlug/properties/$propertyId"
          params={{ clientSlug: client.slug, propertyId: property._id }}
          className="hover:text-foreground"
        >
          {property.name}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground">Lease</span>
      </div>
      <PageHeader
        eyebrow="Lease detail"
        title={property.name}
        description={`${formatDate(lease.startDate)} → ${formatDate(lease.endDate)} · ${describeLeaseStatus(lease, lease.renewalHorizonDays)}`}
      />
      {lease.sourceDocumentId ? (
        <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-success/40 bg-success/5 px-3 py-2 text-xs">
          <ShieldCheck className="h-4 w-4 text-success" />
          Human-approved: these terms were verified by Cyphersoft from{" "}
          <DocumentLink
            documentId={lease.sourceDocumentId}
            className="text-left underline hover:text-primary"
          >
            {(propertyDocuments ?? []).find((document) => document._id === lease.sourceDocumentId)
              ?.filename ?? "your lease document"}
          </DocumentLink>
          {lease.approvedAt ? ` on ${new Date(lease.approvedAt).toLocaleDateString("en-ZA")}` : ""}.
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Monthly rental", value: formatZAR(lease.monthlyRental) },
          { label: "Annual rental", value: formatZAR(lease.monthlyRental * 12) },
          { label: "Cost per m²", value: costPerSqm !== null ? `R${costPerSqm}` : "—" },
          {
            label: "Time to expiry",
            value: isLiveLease(lease) ? formatTimeToExpiry(lease.endDate) : "—",
          },
        ].map((stat) => (
          <Card key={stat.label} className="surface-elevated p-5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {stat.label}
            </div>
            <div className="mt-2 font-display text-2xl">{stat.value}</div>
          </Card>
        ))}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Commercial terms</h3>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <Info label="Tenant" value={client.name} />
            <Info
              label="Account manager"
              value={lease.accountManagerName ?? client.accountManagerName ?? "—"}
            />
            <Info label="Term" value={`${termMonths(lease.startDate, lease.endDate)} months`} />
            <Info
              label="Escalation"
              value={
                lease.escalationPercent !== undefined ? `${lease.escalationPercent}% per year` : "—"
              }
            />
            <Info
              label="Notice period"
              value={
                lease.noticePeriodMonths !== undefined ? `${lease.noticePeriodMonths} months` : "—"
              }
            />
            <Info label="Break clause" value={lease.breakClause ?? "—"} />
            <Info
              label="Renewal option"
              value={lease.renewalOption ?? "—"}
              className="sm:col-span-2"
            />
          </dl>
        </Card>
        <Card className="surface-elevated p-6">
          <h3 className="inline-flex items-center gap-2 font-display text-lg">
            <ScrollText className="h-4 w-4 text-primary" /> Key clauses
          </h3>
          {lease.clauses.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No clauses have been recorded yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {lease.clauses.map((clause) => (
                <li key={clause._id} className="py-3">
                  <div className="text-sm font-medium">{clause.title}</div>
                  <div className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {clause.detail}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="surface-elevated mt-6 p-6">
        <h3 className="font-display text-lg">Lease document</h3>
        <div className="mt-3">
          {leaseDocuments.length === 0 ? (
            <EmptyState
              title="No lease document uploaded yet"
              description="Upload the signed lease from the property page or Documents; it is linked here automatically."
            />
          ) : (
            <DocumentList documents={leaseDocuments} audience="client" onOpen={openDocument} />
          )}
        </div>
      </Card>
    </main>
  );
}

function Info({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}
