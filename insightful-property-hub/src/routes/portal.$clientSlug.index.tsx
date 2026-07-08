import { type RefObject, useRef, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Building2, Receipt, FileText, Bell, Upload, MessageSquare, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getClientBySlug, leases, properties, documents, tasks, invoices,
  formatZAR, monthsUntil,
} from "@/lib/mock-data";

export const Route = createFileRoute("/portal/$clientSlug/")({
  loader: ({ params }) => {
    const client = getClientBySlug(params.clientSlug);
    if (!client) throw notFound();
    return { client };
  },
  component: PortalDashboard,
});

function PortalDashboard() {
  const { client } = Route.useLoaderData();
  const clientLeases = leases.filter((lease) => lease.clientId === client.id);
  const clientProps = properties.filter((property) => property.clientId === client.id);
  const renewing = clientLeases.filter((lease) => monthsUntil(lease.end) <= 18);
  const clientTasks = tasks.filter((task) => task.clientId === client.id);
  const clientDocs = documents.filter((document) => document.clientId === client.id);
  const clientAnomalies = invoices.filter(
    (invoice) => invoice.clientId === client.id && (invoice.severity === "High" || invoice.severity === "Critical"),
  );
  const invoiceInputRef = useRef<HTMLInputElement>(null);
  const contractInputRef = useRef<HTMLInputElement>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<File | null>(null);
  const [selectedContract, setSelectedContract] = useState<File | null>(null);

  const openPicker = (inputRef: RefObject<HTMLInputElement | null>) => {
    inputRef.current?.click();
  };

  const openActionsCount = clientTasks.filter((task) => task.status !== "Completed").length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <input
        ref={invoiceInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(event) => setSelectedInvoice(event.target.files?.[0] ?? null)}
      />
      <input
        ref={contractInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(event) => setSelectedContract(event.target.files?.[0] ?? null)}
      />

      <PageHeader
        eyebrow={`Welcome back, ${client.contact.split(" ")[0]}`}
        title="Your portfolio, live."
        description={`Managed by ${client.consultant}. Everything is current as of today.`}
        actions={
          <>
            <Button variant="outline" onClick={() => openPicker(invoiceInputRef)}>
              <Upload className="h-4 w-4" /> Upload invoice
            </Button>
            <Button variant="outline" onClick={() => openPicker(contractInputRef)}>
              <Upload className="h-4 w-4" /> Upload contract
            </Button>
            <Button><MessageSquare className="h-4 w-4" /> Request quote</Button>
          </>
        }
      />

      <Card className="surface-elevated mb-6 p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Document uploads</div>
            <h2 className="mt-2 font-display text-2xl">Upload invoices and contracts from your device.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose a file to prepare it for submission. The buttons above open your device file picker for the relevant document type.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[26rem]">
            <div className="rounded-md border border-border bg-card/50 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Invoice</div>
              <div className="mt-2 font-medium">{selectedInvoice?.name ?? "No invoice selected"}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {selectedInvoice ? "Ready to upload" : "PDF, spreadsheet, or image files supported"}
              </div>
            </div>
            <div className="rounded-md border border-border bg-card/50 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Contract</div>
              <div className="mt-2 font-medium">{selectedContract?.name ?? "No contract selected"}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {selectedContract ? "Ready to upload" : "PDF, Word, or image files supported"}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="surface-elevated p-5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Active leases</div>
            <Building2 className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 font-display text-2xl">{clientLeases.length}</div>
        </Card>
        <Card className="surface-elevated p-5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Annual rental</div>
            <Receipt className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 font-display text-2xl">{formatZAR(client.annualRental)}</div>
        </Card>
        <Card className="surface-elevated p-5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Renewing {"<="}18mo</div>
            <Bell className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 font-display text-2xl">{renewing.length}</div>
        </Card>
        <Link to="/portal/$clientSlug/actions" params={{ clientSlug: client.slug }} className="block">
          <Card className="surface-elevated p-5 transition-colors hover:border-primary/40 hover:bg-primary/5">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Open actions</div>
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 font-display text-2xl">{openActionsCount}</div>
            <div className="mt-3 inline-flex items-center gap-1 text-xs text-primary">
              Open action centre <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Card>
        </Link>
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card className="surface-elevated p-6 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-lg">Your properties</h3>
            <div className="text-xs text-muted-foreground">Select a property to open its working detail page.</div>
          </div>
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
              {clientProps.map((property) => (
                <tr key={property.id} className="border-b border-border/50 hover:bg-accent/20">
                  <td className="py-2 pr-2 font-medium">
                    <Link
                      to="/portal/$clientSlug/properties/$propertyId"
                      params={{ clientSlug: client.slug, propertyId: property.id }}
                      className="inline-flex items-center gap-1.5 hover:text-primary"
                    >
                      {property.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-2 text-muted-foreground">{property.type}</td>
                  <td className="py-2 pr-2 text-right font-mono">{property.sizeSqm.toLocaleString()}</td>
                  <td className="py-2 pr-2 text-right font-mono">{formatZAR(property.monthlyRental)}</td>
                  <td className="py-2 font-mono text-xs">{property.expiry}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Renewal timeline</h3>
          <ul className="mt-4 space-y-3">
            {renewing.map((lease) => {
              const property = properties.find((item) => item.id === lease.propertyId)!;
              return (
                <li key={lease.id} className="rounded-md border border-border bg-card/50 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{property.name}</span>
                    <span className="font-mono text-xs text-primary">T-{monthsUntil(lease.end)}mo</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{lease.status}</div>
                </li>
              );
            })}
            {renewing.length === 0 && <li className="text-sm text-muted-foreground">Nothing renewing in the next 18 months.</li>}
          </ul>
        </Card>
      </div>

      {clientAnomalies.length > 0 && (
        <Card className="surface-elevated mt-6 border-warning/40 bg-warning/5 p-5">
          <h3 className="font-display text-lg text-warning">Anomaly alerts</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {clientAnomalies.map((invoice) => (
              <li key={invoice.id}>
                {invoice.supplier} - {invoice.month} - <span className="font-mono">+{Math.round(invoice.delta * 100)}%</span> vs baseline.{" "}
                <span className="text-muted-foreground">{invoice.cause}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card className="surface-elevated p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-lg">Your action items</h3>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/portal/$clientSlug/actions" params={{ clientSlug: client.slug }}>
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <ul className="mt-3 divide-y divide-border">
            {clientTasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{task.title}</div>
                  <div className="text-xs text-muted-foreground">due {task.due}</div>
                </div>
                <span className="tag-pill">{task.status}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Documents</h3>
          <ul className="mt-3 divide-y divide-border">
            {clientDocs.map((document) => (
              <li key={document.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">{document.name}</div>
                  <div className="text-xs text-muted-foreground">{document.type} - {document.uploaded}</div>
                </div>
                <span className="tag-pill">{document.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </main>
  );
}
