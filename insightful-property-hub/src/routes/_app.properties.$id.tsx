import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Archive, ArrowLeft, Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { LeaseFormDialog } from "@/components/portfolio/lease-form-dialog";
import { PropertyFormDialog } from "@/components/portfolio/property-form-dialog";
import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  describeLeaseStatus,
  errorMessage,
  formatDate,
  formatZAR,
} from "@/lib/portfolio";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/_app/properties/$id")({
  head: () => ({ meta: [{ title: "Property · Cyphersoft OS" }] }),
  component: PropertyDetail,
});

function PropertyDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const property = useQuery(api.properties.get, { propertyId: id as Id<"properties"> });
  const archiveProperty = useMutation(api.properties.archive);
  const [archiving, setArchiving] = useState(false);

  if (property === undefined) {
    return <LoadingState label="Loading property…" />;
  }
  if (property === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Property not found"
          description="It may have been archived, or you don't have access to it."
          action={
            <Button asChild variant="outline">
              <Link to="/properties">All properties</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const lease = property.currentLease;
  const onArchive = async () => {
    if (
      !window.confirm(
        `Archive ${property.name}? It will disappear from lists and the client portal.`,
      )
    )
      return;
    setArchiving(true);
    try {
      await archiveProperty({ propertyId: property._id });
      toast.success("Property archived");
      void navigate({ to: "/properties" });
    } catch (archiveError) {
      toast.error(errorMessage(archiveError));
      setArchiving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        to="/properties"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Properties
      </Link>
      <PageHeader
        eyebrow={PROPERTY_TYPE_LABELS[property.propertyType]}
        title={property.name}
        description={[property.addressLine, property.suburb, property.city, property.province]
          .filter(Boolean)
          .join(", ")}
        actions={
          property.canEdit ? (
            <>
              <PropertyFormDialog
                property={property}
                trigger={
                  <Button variant="outline">
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                }
              />
              <Button variant="outline" onClick={() => void onArchive()} disabled={archiving}>
                <Archive className="h-4 w-4" /> Archive
              </Button>
            </>
          ) : null
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            l: "Size",
            v: property.sizeSqm !== undefined ? `${property.sizeSqm.toLocaleString()} sqm` : "—",
          },
          {
            l: "Rental",
            v: property.rentalPerSqm !== undefined ? `R${property.rentalPerSqm}/sqm` : "—",
          },
          { l: "Monthly", v: lease ? formatZAR(lease.monthlyRental) : "—" },
          { l: "Landlord", v: property.landlord ?? "—" },
          { l: "Lease expiry", v: lease ? formatDate(lease.endDate) : "—" },
          { l: "Status", v: PROPERTY_STATUS_LABELS[property.status] },
        ].map((s) => (
          <Card key={s.l} className="surface-elevated p-4">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {s.l}
            </div>
            <div className="mt-2 font-display text-xl">{s.v}</div>
          </Card>
        ))}
      </div>

      <Card className="surface-elevated mt-6 p-6">
        <h3 className="font-display text-lg">Features</h3>
        {property.features.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {property.features.map((f) => (
              <span
                key={f}
                className="rounded-full border border-border bg-background px-3 py-1 text-xs"
              >
                {f}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No features recorded.</p>
        )}
        {property.notes ? (
          <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{property.notes}</p>
        ) : null}
      </Card>

      <Card className="surface-elevated mt-6 p-6">
        <h3 className="font-display text-lg">Linked client</h3>
        <div className="mt-2">
          <Link
            to="/clients/$id"
            params={{ id: property.client.slug }}
            className="font-medium hover:text-primary"
          >
            {property.client.name}
          </Link>
        </div>
      </Card>

      <Card className="surface-elevated mt-6 p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-lg">Leases</h3>
          {property.canEdit ? (
            <LeaseFormDialog
              propertyId={property._id}
              trigger={
                <Button size="sm">
                  <Plus className="h-4 w-4" /> Add lease
                </Button>
              }
            />
          ) : null}
        </div>
        {property.leases.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No lease recorded for this property" />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {property.leases.map((l) => (
              <li key={l._id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <Link
                    to="/leases/$id"
                    params={{ id: l._id }}
                    className="font-medium hover:text-primary"
                  >
                    {formatDate(l.startDate)} → {formatDate(l.endDate)}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {formatZAR(l.monthlyRental)} / month
                    {l.escalationPercent !== undefined
                      ? ` · ${l.escalationPercent}% escalation`
                      : ""}
                    {l.noticePeriodMonths !== undefined
                      ? ` · ${l.noticePeriodMonths} months notice`
                      : ""}
                  </div>
                </div>
                <span className="tag-pill">{describeLeaseStatus(l)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
