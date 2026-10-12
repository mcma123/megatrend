import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  CalendarRange,
  ChevronRight,
  FileText,
  MapPin,
  Receipt,
  Sparkles,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { DocumentList } from "@/components/documents/document-list";
import { DocumentUploadDialog } from "@/components/documents/document-upload-dialog";
import { useOpenDocument } from "@/lib/use-document-upload";
import { usePortal } from "@/lib/portal-context";
import {
  PROPERTY_TYPE_LABELS,
  RENEWAL_STEPS,
  daysUntil,
  describeLeaseStatus,
  formatDate,
  formatTimeToExpiry,
  formatZAR,
  isLiveLease,
  renewalStepDate,
} from "@/lib/portfolio";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/portal/$clientSlug/properties/$propertyId")({
  head: () => ({ meta: [{ title: "Property | Client portal | Cyphersoft" }] }),
  component: PropertyDetailPage,
});

function PropertyDetailPage() {
  const { client, viewer } = usePortal();
  const { propertyId } = Route.useParams();
  const property = useQuery(api.properties.get, { propertyId: propertyId as Id<"properties"> });
  const documents = useQuery(api.documents.list, {
    tenantId: client.tenantId,
    propertyId: propertyId as Id<"properties">,
  });
  const openDocument = useOpenDocument();
  const canUpload = viewer.roleKey !== "executive_viewer" && viewer.roleKey !== "read_only_staff";

  if (property === undefined) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <LoadingState label="Loading property…" />
      </main>
    );
  }
  // A property from another client's workspace is treated as not found.
  if (property === null || property.tenantId !== client.tenantId) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <EmptyState
          title="Property not found"
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

  const lease = property.leases.find(isLiveLease) ?? property.leases[0] ?? null;
  const costPerSqm =
    lease && property.sizeSqm ? Math.round(lease.monthlyRental / property.sizeSqm) : null;

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
        <span className="text-foreground">{property.name}</span>
      </div>
      <PageHeader
        eyebrow={PROPERTY_TYPE_LABELS[property.propertyType]}
        title={property.name}
        description={[property.addressLine, property.suburb, property.city]
          .filter(Boolean)
          .join(", ")}
        actions={
          lease ? (
            <Button asChild>
              <Link
                to="/portal/$clientSlug/properties/$propertyId/lease"
                params={{ clientSlug: client.slug, propertyId: property._id }}
              >
                Lease detail <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : null
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Monthly rental"
          value={lease ? formatZAR(lease.monthlyRental) : "—"}
          icon={<Receipt className="h-4 w-4 text-primary" />}
        />
        <Stat
          label="Annual rental"
          value={lease ? formatZAR(lease.monthlyRental * 12) : "—"}
          icon={<Receipt className="h-4 w-4 text-primary" />}
        />
        <Stat
          label="Cost per m²"
          value={costPerSqm !== null ? `R${costPerSqm}` : "—"}
          icon={<MapPin className="h-4 w-4 text-primary" />}
        />
        <Stat
          label="Time to expiry"
          value={lease && isLiveLease(lease) ? formatTimeToExpiry(lease.endDate) : "—"}
          icon={<CalendarRange className="h-4 w-4 text-primary" />}
        />
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="surface-elevated p-6 lg:col-span-2">
          <h3 className="font-display text-lg">Property</h3>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <Info
              label="Size"
              value={
                property.sizeSqm !== undefined ? `${property.sizeSqm.toLocaleString()} m²` : "—"
              }
            />
            <Info label="Landlord" value={property.landlord ?? "—"} />
            <Info label="Province" value={property.province ?? "—"} />
            <Info label="Account manager" value={client.accountManagerName ?? "—"} />
          </dl>
          {property.features.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {property.features.map((feature) => (
                <span
                  key={feature}
                  className="rounded-full border border-border bg-background px-3 py-1 text-xs"
                >
                  {feature}
                </span>
              ))}
            </div>
          ) : null}
        </Card>

        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Lease</h3>
          {lease ? (
            <dl className="mt-3 space-y-3 text-sm">
              <Info
                label="Term"
                value={`${formatDate(lease.startDate)} → ${formatDate(lease.endDate)}`}
              />
              <Info label="Status" value={describeLeaseStatus(lease)} />
              <Info
                label="Escalation"
                value={
                  lease.escalationPercent !== undefined
                    ? `${lease.escalationPercent}% per year`
                    : "—"
                }
              />
              <Info
                label="Notice period"
                value={
                  lease.noticePeriodMonths !== undefined
                    ? `${lease.noticePeriodMonths} months`
                    : "—"
                }
              />
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No lease is recorded for this property yet.
            </p>
          )}
        </Card>
      </div>

      {lease && isLiveLease(lease) ? (
        <Card className="surface-elevated mt-6 p-6">
          <h3 className="font-display text-lg">Renewal plan</h3>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">
            {RENEWAL_STEPS.map((step) => {
              const date = renewalStepDate(lease.endDate, step.daysBefore);
              const reached = daysUntil(date) <= 0;
              return (
                <li
                  key={step.daysBefore}
                  className={`rounded-md border p-3 ${reached ? "border-primary/40 bg-primary/5" : "border-border"}`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-primary">T-{step.daysBefore}</span>
                    <span className="text-muted-foreground">{formatDate(date)}</span>
                  </div>
                  <div className="mt-1 text-sm font-medium">{step.title}</div>
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card className="surface-elevated p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="inline-flex items-center gap-2 font-display text-lg">
              <FileText className="h-4 w-4 text-primary" /> Linked documents
            </h3>
            {canUpload ? (
              <DocumentUploadDialog
                tenantId={client.tenantId}
                propertyId={property._id}
                title={`Upload for ${property.name}`}
                trigger={
                  <Button size="sm" variant="outline">
                    <Upload className="h-3.5 w-3.5" /> Upload
                  </Button>
                }
              />
            ) : null}
          </div>
          <div className="mt-3">
            {documents === undefined ? (
              <LoadingState />
            ) : documents.length === 0 ? (
              <EmptyState
                title="No documents yet"
                description="Documents for this property will appear here once uploaded."
              />
            ) : (
              <DocumentList documents={documents} audience="client" onOpen={openDocument} />
            )}
          </div>
        </Card>
        <Card className="surface-elevated p-6">
          <h3 className="inline-flex items-center gap-2 font-display text-lg">
            <Sparkles className="h-4 w-4 text-primary" /> Insights
          </h3>
          <div className="mt-3">
            <EmptyState
              title="No insights yet"
              description="Reviewed insights from your Cyphersoft team will appear here."
            />
          </div>
        </Card>
      </div>
    </main>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="surface-elevated p-5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
        {icon}
      </div>
      <div className="mt-2 font-display text-2xl">{value}</div>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}
