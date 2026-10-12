import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  FileText,
  Receipt,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { DocumentList } from "@/components/documents/document-list";
import { DocumentUploadDialog } from "@/components/documents/document-upload-dialog";
import { useOpenDocument } from "@/lib/use-document-upload";
import { usePortal } from "@/lib/portal-context";
import { CLIENT_ACTION_STATUS_LABELS, isOpenAction, isOverdue, timeAgo } from "@/lib/workflow";
import {
  PROPERTY_TYPE_LABELS,
  describeLeaseStatus,
  formatDate,
  formatTimeToExpiry,
  formatZAR,
  isLiveLease,
  monthsUntil,
} from "@/lib/portfolio";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/portal/$clientSlug/")({
  component: PortalDashboard,
});

function PortalDashboard() {
  const { client, viewer } = usePortal();
  const properties = useQuery(api.properties.list, { tenantId: client.tenantId });
  const leases = useQuery(api.leases.list, { tenantId: client.tenantId });
  const documents = useQuery(api.documents.list, { tenantId: client.tenantId });
  const actions = useQuery(api.actions.list, { tenantId: client.tenantId });
  const allAnomalies = useQuery(api.invoices.listAnomalies, { tenantId: client.tenantId });
  const anomalies = allAnomalies?.filter((anomaly) => anomaly.status !== "dismissed").slice(0, 5);
  const activity = useQuery(api.dashboard.clientActivity, { tenantId: client.tenantId });
  const openActions = actions?.filter((action) => isOpenAction(action.status));
  const openDocument = useOpenDocument();
  const canUpload = viewer.roleKey !== "executive_viewer" && viewer.roleKey !== "read_only_staff";

  const liveLeases = (leases ?? []).filter(isLiveLease);
  const renewing = liveLeases.filter((lease) => monthsUntil(lease.endDate) <= 18);
  const annualRental = liveLeases.reduce((total, lease) => total + lease.monthlyRental * 12, 0);
  const firstName = viewer.fullName.split(" ")[0];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        eyebrow={`Welcome back, ${firstName}`}
        title="Your portfolio, live."
        description={
          client.accountManagerName
            ? `Managed by ${client.accountManagerName}. Figures come straight from your lease records.`
            : "Figures come straight from your lease records."
        }
        actions={
          canUpload ? (
            <>
              <DocumentUploadDialog
                tenantId={client.tenantId}
                defaultType="invoice"
                title="Upload invoice"
                trigger={
                  <Button variant="outline">
                    <Upload className="h-4 w-4" /> Upload invoice
                  </Button>
                }
              />
              <DocumentUploadDialog
                tenantId={client.tenantId}
                defaultType="lease"
                title="Upload contract"
                trigger={
                  <Button variant="outline">
                    <Upload className="h-4 w-4" /> Upload contract
                  </Button>
                }
              />
            </>
          ) : null
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Active leases"
          value={leases === undefined ? "—" : liveLeases.length}
          icon={<Building2 className="h-4 w-4 text-primary" />}
        />
        <Kpi
          label="Annual rental"
          value={leases === undefined ? "—" : formatZAR(annualRental)}
          icon={<Receipt className="h-4 w-4 text-primary" />}
        />
        <Kpi
          label="Renewing ≤18mo"
          value={leases === undefined ? "—" : renewing.length}
          icon={<Bell className="h-4 w-4 text-primary" />}
        />
        <Kpi
          label="Properties"
          value={properties === undefined ? "—" : properties.length}
          icon={<FileText className="h-4 w-4 text-primary" />}
        />
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card className="surface-elevated p-6 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-lg">Your properties</h3>
            <div className="text-xs text-muted-foreground">
              Select a property to open its detail page.
            </div>
          </div>
          {properties === undefined ? (
            <LoadingState />
          ) : properties.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No properties yet"
                description="Your Cyphersoft team will add your properties and leases here."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="py-2 pr-2">Property</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2 text-right">Size</th>
                    <th className="py-2 pr-2 text-right">Monthly</th>
                    <th className="py-2">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {properties.map((property) => (
                    <tr key={property._id} className="border-b border-border/50 hover:bg-accent/20">
                      <td className="py-2 pr-2 font-medium">
                        <Link
                          to="/portal/$clientSlug/properties/$propertyId"
                          params={{ clientSlug: client.slug, propertyId: property._id }}
                          className="inline-flex items-center gap-1.5 hover:text-primary"
                        >
                          {property.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground">
                        {PROPERTY_TYPE_LABELS[property.propertyType]}
                      </td>
                      <td className="py-2 pr-2 text-right font-mono">
                        {property.sizeSqm?.toLocaleString() ?? "—"}
                      </td>
                      <td className="py-2 pr-2 text-right font-mono">
                        {property.currentLease
                          ? formatZAR(property.currentLease.monthlyRental)
                          : "—"}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {property.currentLease ? formatDate(property.currentLease.endDate) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Renewal timeline</h3>
          <ul className="mt-4 space-y-3">
            {renewing.map((lease) => (
              <li key={lease._id} className="rounded-md border border-border bg-card/50 p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{lease.property?.name ?? "Property"}</span>
                  <span className="font-mono text-xs text-primary">
                    {formatTimeToExpiry(lease.endDate)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {describeLeaseStatus(lease)} · ends {formatDate(lease.endDate)}
                </div>
              </li>
            ))}
            {leases !== undefined && renewing.length === 0 && (
              <li className="text-sm text-muted-foreground">
                Nothing renewing in the next 18 months.
              </li>
            )}
          </ul>
        </Card>
      </div>

      {anomalies && anomalies.length > 0 ? (
        <Card className="surface-elevated mt-6 border-warning/40 bg-warning/5 p-5">
          <h3 className="inline-flex items-center gap-2 font-display text-lg text-warning">
            <AlertTriangle className="h-4 w-4" /> Cost alerts
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            {anomalies.map((anomaly) => (
              <li key={anomaly._id}>
                <span className="font-medium">{anomaly.supplier}</span>
                {anomaly.property ? (
                  <span className="text-muted-foreground"> · {anomaly.property.name}</span>
                ) : null}
                <span className="text-muted-foreground"> — {anomaly.cause}</span>
                <span className="ml-1 text-xs text-muted-foreground">
                  (
                  {anomaly.status === "resolved"
                    ? "resolved"
                    : anomaly.status === "investigating"
                      ? "Cyphersoft is investigating"
                      : "under review"}
                  )
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card className="surface-elevated p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-lg">Your action items</h3>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/portal/$clientSlug/actions" params={{ clientSlug: client.slug }}>
                Action centre <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <div className="mt-3">
            {openActions === undefined ? (
              <LoadingState />
            ) : openActions.length === 0 ? (
              <EmptyState
                title="No open actions"
                description="Requests from your Cyphersoft team will appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {openActions.slice(0, 5).map((action) => (
                  <li
                    key={action._id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{action.title}</div>
                      <div
                        className={
                          isOverdue(action)
                            ? "text-xs text-destructive"
                            : "text-xs text-muted-foreground"
                        }
                      >
                        {action.dueDate
                          ? `${isOverdue(action) ? "Overdue · " : "Due "}${formatDate(action.dueDate)}`
                          : "No due date"}
                      </div>
                    </div>
                    <span className="tag-pill">{CLIENT_ACTION_STATUS_LABELS[action.status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        <Card className="surface-elevated p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-lg">Documents</h3>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/portal/$clientSlug/documents" params={{ clientSlug: client.slug }}>
                All documents <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <div className="mt-3">
            {documents === undefined ? (
              <LoadingState />
            ) : documents.length === 0 ? (
              <EmptyState
                title="No documents yet"
                description="Uploaded leases, invoices and statements will appear here."
              />
            ) : (
              <DocumentList
                documents={documents}
                audience="client"
                onOpen={openDocument}
                limit={5}
              />
            )}
          </div>
        </Card>
      </div>
      <Card className="surface-elevated mt-6 p-6">
        <h3 className="font-display text-lg">Recent activity</h3>
        {activity === undefined ? (
          <LoadingState />
        ) : activity.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {activity.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <span>{row.text}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {timeAgo(row.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

function Kpi({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
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
