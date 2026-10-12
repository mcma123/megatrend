import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "convex/react";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { PropertyFormDialog } from "@/components/portfolio/property-form-dialog";
import { PROPERTY_STATUS_LABELS, PROPERTY_TYPE_LABELS, formatZAR } from "@/lib/portfolio";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/_app/properties")({
  head: () => ({
    meta: [
      { title: "Properties · Cyphersoft OS" },
      {
        name: "description",
        content: "Every property occupied, reviewed, sourced or proposed for our clients.",
      },
    ],
  }),
  component: PropertiesPage,
});

function PropertiesPage() {
  const properties = useQuery(api.properties.list, {});
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = (properties ?? []).filter(
    (p) =>
      !query ||
      [p.name, p.city, p.suburb ?? "", p.client.name].some((value) =>
        value.toLowerCase().includes(query),
      ),
  );

  const addButton = (
    <PropertyFormDialog
      trigger={
        <Button>
          <Plus className="h-4 w-4" /> New property
        </Button>
      }
      onSaved={(propertyId) => void navigate({ to: "/properties/$id", params: { id: propertyId } })}
    />
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="External + Internal · Portfolio"
        title="Properties under review."
        description="Client-occupied, sourced and shortlisted properties — one searchable inventory."
        actions={addButton}
      />
      <Card className="surface-elevated p-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search properties, cities, clients…"
            className="pl-9"
          />
        </div>
        <div className="mt-4 overflow-x-auto">
          {properties === undefined ? (
            <LoadingState label="Loading properties…" />
          ) : properties.length === 0 ? (
            <EmptyState
              title="No properties yet"
              description="Add a property for one of your clients."
              action={addButton}
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-3 pr-3">Property</th>
                  <th className="py-3 pr-3">Location</th>
                  <th className="py-3 pr-3">Type</th>
                  <th className="py-3 pr-3 text-right">Size</th>
                  <th className="py-3 pr-3 text-right">R/sqm</th>
                  <th className="py-3 pr-3 text-right">Monthly</th>
                  <th className="py-3 pr-3">Client</th>
                  <th className="py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p._id} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="py-3 pr-3">
                      <Link
                        to="/properties/$id"
                        params={{ id: p._id }}
                        className="font-medium hover:text-primary"
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">
                      {[p.suburb, p.city].filter(Boolean).join(", ")}
                    </td>
                    <td className="py-3 pr-3">{PROPERTY_TYPE_LABELS[p.propertyType]}</td>
                    <td className="py-3 pr-3 text-right font-mono">
                      {p.sizeSqm?.toLocaleString() ?? "—"}
                    </td>
                    <td className="py-3 pr-3 text-right font-mono">
                      {p.rentalPerSqm !== undefined ? `R${p.rentalPerSqm}` : "—"}
                    </td>
                    <td className="py-3 pr-3 text-right font-mono">
                      {p.currentLease ? formatZAR(p.currentLease.monthlyRental) : "—"}
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">
                      <Link
                        to="/clients/$id"
                        params={{ id: p.client.slug }}
                        className="hover:text-primary"
                      >
                        {p.client.name}
                      </Link>
                    </td>
                    <td className="py-3">
                      <span className="tag-pill">{PROPERTY_STATUS_LABELS[p.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
