import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, FileText, AlertTriangle, CheckCircle2, RotateCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { documents, getClient, getProperty } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/documents/$id")({
  loader: ({ params }) => {
    const doc = documents.find((d) => d.id === params.id);
    if (!doc) throw notFound();
    return { doc };
  },
  notFoundComponent: () => <div className="p-8">Document not found.</div>,
  component: DocDetail,
});

function DocDetail() {
  const { doc } = Route.useLoaderData();
  const client = getClient(doc.clientId);
  const property = doc.propertyId ? getProperty(doc.propertyId) : null;

  // Mock extraction fields (from prototype's "Linbro Lease" example)
  const extracted = [
    { k: "Landlord", v: "Equites Property Fund" },
    { k: "Lease signed", v: "2021-08-12" },
    { k: "Term", v: "60 months" },
    { k: "Expiry", v: "2026-08-31" },
    { k: "Rental", v: "R1 692 800 / month" },
    { k: "Escalation", v: "CPI + 1.5%" },
    { k: "Notice period", v: "6 months" },
    { k: "Break clause", v: "Month 36, 6mo notice" },
    { k: "Parking", v: "180 bays" },
    { k: "Addenda referenced", v: "2 (1 missing)" },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/documents" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Documents</Link>
      <PageHeader
        eyebrow={`${doc.type} · ${client?.name}`}
        title={doc.name}
        description={`Confidence ${Math.round(doc.confidence * 100)}% · uploaded ${doc.uploaded}${property ? ` · ${property.name}` : ""}`}
        actions={
          <>
            <Button variant="outline"><RotateCw className="h-3.5 w-3.5" /> Re-process</Button>
            <Button variant="outline"><FileText className="h-3.5 w-3.5" /> View original</Button>
            <Button><CheckCircle2 className="h-3.5 w-3.5" /> Approve extraction</Button>
          </>
        }
      />
      {doc.missing && (
        <Card className="surface-elevated mb-4 border-warning/40 bg-warning/5 p-4">
          <div className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">Missing document</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{doc.missing[0]} — request copy from client.</p>
        </Card>
      )}
      <Card className="surface-elevated p-6">
        <h3 className="font-display text-lg">Extracted fields</h3>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {extracted.map((e) => (
            <div key={e.k} className="rounded-md border border-border bg-card/50 p-3">
              <dt className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{e.k}</dt>
              <dd className="mt-1 font-mono text-sm">{e.v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
