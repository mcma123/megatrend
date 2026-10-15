import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { ArrowLeft, Building2, Mail, Pencil, Plus, Upload, User } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientFormDialog } from "@/components/portfolio/client-form-dialog";
import { DocumentList } from "@/components/documents/document-list";
import { DocumentUploadDialog } from "@/components/documents/document-upload-dialog";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { LeaseFormDialog } from "@/components/portfolio/lease-form-dialog";
import { PropertyFormDialog } from "@/components/portfolio/property-form-dialog";
import {
  CLIENT_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
  describeLeaseStatus,
  formatDate,
  formatZAR,
  isLiveLease,
  monthsUntil,
} from "@/lib/portfolio";
import { ACTION_STATUS_LABELS } from "@/lib/workflow";
import { useVoiceCommands } from "@/lib/voice/command-registry";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/_app/clients/$id")({
  head: () => ({
    meta: [
      { title: "Client · Cyphersoft OS" },
      { name: "description", content: "Portfolio, leases and documents for a client." },
    ],
  }),
  component: ClientDetail,
});

function ClientDetail() {
  const { id: slug } = Route.useParams();
  const client = useQuery(api.clients.get, { slug });
  const allClients = useQuery(api.clients.list);
  const properties = useQuery(api.properties.list, client ? { tenantId: client.tenantId } : "skip");
  const leases = useQuery(api.leases.list, client ? { tenantId: client.tenantId } : "skip");
  const documents = useQuery(api.documents.list, client ? { tenantId: client.tenantId } : "skip");
  const actions = useQuery(api.actions.list, client ? { tenantId: client.tenantId } : "skip");
  const navigate = useNavigate();
  const [tab, setTab] = useState("portfolio");
  const [editOpen, setEditOpen] = useState(false);
  const [addPropertyOpen, setAddPropertyOpen] = useState(false);
  const [addLeaseOpen, setAddLeaseOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  // Stable so the edit dialog doesn't reset while Convex re-renders this page.
  const editInitial = useMemo(
    () =>
      client
        ? {
            tenantId: client.tenantId,
            name: client.name,
            slug: client.slug,
            contactName: client.contactName ?? "",
            contactEmail: client.contactEmail ?? "",
            industry: client.industry ?? "",
            clientType: client.clientType ?? ("" as const),
            relationshipStatus: client.relationshipStatus ?? ("active" as const),
            accountManagerName: client.accountManagerName ?? "",
            clientSince: client.clientSince ?? "",
          }
        : undefined,
    [client],
  );
  const canEdit = client?.canEdit === true;

  useVoiceCommands("clients.detail", {
    "client.tab": {
      run: ({ tab: next }) => {
        setTab(String(next));
        return `Showing ${String(next)}.`;
      },
      enabled: Boolean(client),
    },
    "client.openEdit": { run: () => setEditOpen(true), enabled: canEdit },
    "client.openAddProperty": {
      run: () => {
        setTab("portfolio");
        setAddPropertyOpen(true);
      },
      enabled: canEdit,
    },
    "client.openAddLease": {
      run: () => {
        setTab("leases");
        setAddLeaseOpen(true);
      },
      enabled: canEdit && Boolean(properties?.length),
    },
    "client.openUpload": {
      run: () => {
        setTab("documents");
        setUploadOpen(true);
      },
      enabled: Boolean(client),
    },
    "client.openPortal": {
      run: () => {
        if (client)
          void navigate({ to: "/portal/$clientSlug", params: { clientSlug: client.slug } });
      },
      enabled: Boolean(client),
    },
  });

  if (client === undefined) {
    return <LoadingState label="Loading client…" />;
  }
  if (client === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Client not found"
          description="It may have been removed, or you don't have access to it."
          action={
            <Button asChild variant="outline">
              <Link to="/clients">All clients</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const liveLeases = (leases ?? []).filter(isLiveLease);
  const annualRental = liveLeases.reduce((total, lease) => total + lease.monthlyRental * 12, 0);
  const subtitle = [
    client.industry,
    client.clientSince ? `client since ${formatDate(client.clientSince)}` : null,
    client.accountManagerName ? `managed by ${client.accountManagerName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-2">
        <Link
          to="/clients"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All clients
        </Link>
      </div>
      <PageHeader
        eyebrow={`Client${client.clientType ? ` · ${CLIENT_TYPE_LABELS[client.clientType]}` : ""}`}
        title={client.name}
        description={subtitle || undefined}
        actions={
          <>
            {client.canEdit ? (
              <ClientFormDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                trigger={
                  <Button variant="outline">
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                }
                initial={editInitial}
              />
            ) : null}
            <Button asChild variant="outline">
              <Link to="/portal/$clientSlug" params={{ clientSlug: client.slug }}>
                View client portal
              </Link>
            </Button>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Annual rental", value: formatZAR(annualRental) },
          { label: "Active leases", value: liveLeases.length },
          { label: "Properties", value: properties?.length ?? "—" },
          {
            label: "Renewals ≤18mo",
            value: liveLeases.filter((lease) => monthsUntil(lease.endDate) <= 18).length,
          },
        ].map((s) => (
          <Card key={s.label} className="surface-elevated p-4">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {s.label}
            </div>
            <div className="mt-2 font-display text-2xl">{s.value}</div>
          </Card>
        ))}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="surface-elevated h-fit p-3">
          <div className="px-2 pb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Clients
          </div>
          <ul className="space-y-0.5">
            {(allClients ?? []).map((c) => (
              <li key={c.tenantId}>
                <Link
                  to="/clients/$id"
                  params={{ id: c.slug }}
                  className={`block rounded-md px-2 py-2 text-sm transition-colors ${c.slug === client.slug ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.leaseCount} leases · {formatZAR(c.annualRental)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <div>
          <Card className="surface-elevated mb-4 p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Main contact
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <User className="h-3.5 w-3.5 text-muted-foreground" /> {client.contactName ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Email
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />{" "}
                  {client.contactEmail ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Account owner
                </div>
                <div className="mt-1 text-sm">{client.accountManagerName ?? "—"}</div>
              </div>
            </div>
          </Card>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
              <TabsTrigger value="leases">Leases</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>
            <TabsContent value="portfolio">
              <Card className="surface-elevated p-4">
                {client.canEdit ? (
                  <div className="mb-3 flex justify-end">
                    <PropertyFormDialog
                      open={addPropertyOpen}
                      onOpenChange={setAddPropertyOpen}
                      tenantId={client.tenantId}
                      trigger={
                        <Button size="sm">
                          <Plus className="h-4 w-4" /> Add property
                        </Button>
                      }
                    />
                  </div>
                ) : null}
                {properties === undefined ? (
                  <LoadingState />
                ) : properties.length === 0 ? (
                  <EmptyState
                    title="No properties yet"
                    description="Add the client's first property."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          <th className="py-2 pr-3">Property</th>
                          <th className="py-2 pr-3">City / suburb</th>
                          <th className="py-2 pr-3">Type</th>
                          <th className="py-2 pr-3 text-right">Size</th>
                          <th className="py-2 pr-3 text-right">Rental</th>
                          <th className="py-2">Expiry</th>
                        </tr>
                      </thead>
                      <tbody>
                        {properties.map((p) => (
                          <tr key={p._id} className="border-b border-border/50 hover:bg-accent/30">
                            <td className="py-2 pr-3">
                              <Link
                                to="/properties/$id"
                                params={{ id: p._id }}
                                className="font-medium hover:text-primary"
                              >
                                {p.name}
                              </Link>
                            </td>
                            <td className="py-2 pr-3 text-muted-foreground">
                              {[p.city, p.suburb].filter(Boolean).join(" · ")}
                            </td>
                            <td className="py-2 pr-3">{PROPERTY_TYPE_LABELS[p.propertyType]}</td>
                            <td className="py-2 pr-3 text-right font-mono">
                              {p.sizeSqm?.toLocaleString() ?? "—"}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono">
                              {p.currentLease ? formatZAR(p.currentLease.monthlyRental) : "—"}
                            </td>
                            <td className="py-2 font-mono text-xs">
                              {p.currentLease ? formatDate(p.currentLease.endDate) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </TabsContent>
            <TabsContent value="leases">
              <Card className="surface-elevated p-4">
                {client.canEdit && properties && properties.length > 0 ? (
                  <div className="mb-3 flex justify-end">
                    <LeaseFormDialog
                      open={addLeaseOpen}
                      onOpenChange={setAddLeaseOpen}
                      tenantId={client.tenantId}
                      trigger={
                        <Button size="sm">
                          <Plus className="h-4 w-4" /> Add lease
                        </Button>
                      }
                    />
                  </div>
                ) : null}
                {leases === undefined ? (
                  <LoadingState />
                ) : leases.length === 0 ? (
                  <EmptyState
                    title="No leases yet"
                    description={
                      properties?.length
                        ? "Add a lease to one of the client's properties."
                        : "Add a property first, then its lease."
                    }
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {leases.map((l) => (
                      <li key={l._id} className="flex items-center justify-between py-3">
                        <div>
                          <Link
                            to="/leases/$id"
                            params={{ id: l._id }}
                            className="font-medium hover:text-primary"
                          >
                            <Building2 className="inline h-3.5 w-3.5" />{" "}
                            {l.property?.name ?? "Property"}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(l.startDate)} → {formatDate(l.endDate)}
                            {l.escalationPercent !== undefined
                              ? ` · ${l.escalationPercent}% escalation`
                              : ""}
                          </div>
                        </div>
                        <span className="tag-pill">
                          {describeLeaseStatus(l, client.renewalHorizonDays)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </TabsContent>
            <TabsContent value="documents">
              <Card className="surface-elevated p-4">
                <div className="mb-3 flex justify-end">
                  <DocumentUploadDialog
                    open={uploadOpen}
                    onOpenChange={setUploadOpen}
                    tenantId={client.tenantId}
                    trigger={
                      <Button size="sm">
                        <Upload className="h-4 w-4" /> Upload documents
                      </Button>
                    }
                  />
                </div>
                {documents === undefined ? (
                  <LoadingState />
                ) : documents.length === 0 ? (
                  <EmptyState
                    title="No documents yet"
                    description="Uploaded leases, invoices and statements for this client will appear here."
                  />
                ) : (
                  <DocumentList documents={documents} audience="staff" />
                )}
              </Card>
            </TabsContent>
            <TabsContent value="actions">
              <Card className="surface-elevated p-4">
                {actions === undefined ? (
                  <LoadingState />
                ) : actions.length === 0 ? (
                  <EmptyState
                    title="No actions yet"
                    description="Tasks and client requests for this client will appear here."
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {actions.map((action) => (
                      <li
                        key={action._id}
                        className="flex items-center justify-between gap-3 py-3 text-sm"
                      >
                        <div className="min-w-0">
                          <Link to="/tasks" className="font-medium hover:text-primary">
                            {action.title}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {[
                              action.assigneeName,
                              action.dueDate ? `due ${formatDate(action.dueDate)}` : null,
                              action.visibleToClient ? "client-visible" : "internal",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                        <span className="tag-pill">{ACTION_STATUS_LABELS[action.status]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
