import { type RefObject, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  ArrowRight,
  Bell,
  CalendarRange,
  ChevronRight,
  FileSearch,
  FileText,
  MapPin,
  MessageSquare,
  Receipt,
  Sparkles,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatZAR, getClientBySlug, getProperty, leases, monthsUntil } from "@/lib/mock-data";

type LinkedDocument = {
  id: string;
  name: string;
  type: "Lease agreement" | "Rental invoice" | "Utility statement" | "Addendum";
  status: "Published" | "Needs Review" | "Processing";
  uploaded: string;
};

type PropertyInsight = {
  id: string;
  title: string;
  priority: "High" | "Medium" | "Low";
  confidence: string;
  source: string;
  note: string;
  cta: string;
};

type PropertyAction = {
  id: string;
  title: string;
  due: string;
  priority: "High" | "Medium" | "Low";
  status: "Open" | "Waiting on client" | "In progress";
  cta: string;
};

type TimelineItem = {
  label: string;
  date: string;
  tone: "complete" | "current" | "urgent" | "warning" | "future";
};

const linkedDocuments: LinkedDocument[] = [
  { id: "ld-1", name: "DHL Linbro Park Lease Agreement.pdf", type: "Lease agreement", status: "Published", uploaded: "2026-07-01" },
  { id: "ld-2", name: "Rental Invoice May 2026.pdf", type: "Rental invoice", status: "Published", uploaded: "2026-06-29" },
  { id: "ld-3", name: "June Utility Statement.pdf", type: "Utility statement", status: "Needs Review", uploaded: "2026-07-03" },
  { id: "ld-4", name: "Signed Addendum.pdf", type: "Addendum", status: "Processing", uploaded: "2026-06-28" },
];

const insights: PropertyInsight[] = [
  {
    id: "pi-1",
    title: "Renewal window opens in 2 months.",
    priority: "High",
    confidence: "94%",
    source: "DHL Linbro Park Lease Agreement.pdf",
    note: "Account manager note placeholder",
    cta: "Review renewal path",
  },
  {
    id: "pi-2",
    title: "Monthly rental is above portfolio average for logistics properties.",
    priority: "Medium",
    confidence: "81%",
    source: "Portfolio benchmarking model",
    note: "Account manager note placeholder",
    cta: "Compare rental",
  },
  {
    id: "pi-3",
    title: "Utility statement missing for latest billing cycle.",
    priority: "High",
    confidence: "88%",
    source: "June Utility Statement.pdf",
    note: "Account manager note placeholder",
    cta: "Upload missing statement",
  },
];

const propertyActions: PropertyAction[] = [
  { id: "pa-1", title: "Upload latest utility invoice", due: "2026-07-10", priority: "High", status: "Open", cta: "Upload now" },
  { id: "pa-2", title: "Confirm renewal decision", due: "2026-07-18", priority: "High", status: "Waiting on client", cta: "Update decision" },
  { id: "pa-3", title: "Review lease addendum", due: "2026-07-22", priority: "Medium", status: "In progress", cta: "Open review" },
];

export const Route = createFileRoute("/portal/$clientSlug/properties/$propertyId")({
  loader: ({ params }) => {
    const client = getClientBySlug(params.clientSlug);
    const property = getProperty(params.propertyId);

    if (!client || !property || property.clientId !== client.id) {
      throw notFound();
    }

    return { client, property };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.property.name ?? "Property Detail"} | ${loaderData?.client.name ?? "Client"} portal | Megatrend` },
      {
        name: "description",
        content: `Work with the lease, documents, insights, and renewal plan for ${loaderData?.property.name ?? "this property"}.`,
      },
    ],
  }),
  component: PropertyDetailPage,
});

function PropertyDetailPage() {
  const { client, property } = Route.useLoaderData();
  const lease = leases.find((item) => item.propertyId === property.id && item.clientId === client.id);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [selectedUpload, setSelectedUpload] = useState<File | null>(null);

  if (!lease) {
    return <main className="mx-auto max-w-6xl px-6 py-10">No active lease found for this property.</main>;
  }

  const annualRental = property.monthlyRental * 12;
  const previousYearRental = Math.round(property.monthlyRental / 1.075);
  const projectedNextYearRental = Math.round(property.monthlyRental * 1.075);
  const costPerSqm = Math.round(property.monthlyRental / property.sizeSqm);
  const renewalWindowLabel = `T-${monthsUntil(lease.end)} months`;
  const renewalNoticeDate = "2026-02-28";
  const currentDate = "2026-07-07";

  const timelineItems = useMemo<TimelineItem[]>(
    () => [
      { label: "Lease start", date: lease.start, tone: "complete" },
      { label: "Current date", date: currentDate, tone: "current" },
      { label: "Renewal window open", date: "2026-06-30", tone: "urgent" },
      { label: "Notice deadline", date: renewalNoticeDate, tone: "warning" },
      { label: "Lease expiry", date: lease.end, tone: "future" },
    ],
    [lease.end, lease.start],
  );

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xls,.xlsx"
        onChange={(event) => setSelectedUpload(event.target.files?.[0] ?? null)}
      />

      <nav className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link to="/portal/$clientSlug" params={{ clientSlug: client.slug }} className="hover:text-foreground">Portfolio</Link>
        <ChevronRight className="h-4 w-4" />
        <span>Properties</span>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">{property.name}</span>
      </nav>

      <PageHeader
        eyebrow="Property Detail"
        title={property.name}
        description={`${property.suburb}, ${property.city} | ${renewalWindowLabel}`}
        actions={
          <>
            <div className="inline-flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-sm">
              <span className="tag-pill !mb-0">{property.type}</span>
            </div>
            <Button variant="outline" onClick={() => openPicker(uploadInputRef)}>
              <Upload className="h-4 w-4" /> Upload document
            </Button>
            <Button variant="outline">
              <Receipt className="h-4 w-4" /> Request quote
            </Button>
            <Button>
              <Sparkles className="h-4 w-4" /> Ask Megatrend
            </Button>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <div className="inline-flex items-center gap-1.5">
          <MapPin className="h-4 w-4" /> {property.suburb}, {property.city}
        </div>
        {selectedUpload && <div className="rounded-md border border-border bg-card px-3 py-1.5 text-xs">Ready to upload: {selectedUpload.name}</div>}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.85fr)]">
        <div className="space-y-6">
          <Card className="surface-elevated p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl">Property overview</h2>
              <span className="inline-flex items-center rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">Active</span>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <InfoBlock label="Address" value={property.address} />
              <InfoBlock label="Property type" value={property.type} />
              <InfoBlock label="Size" value={`${property.sizeSqm.toLocaleString()} m2`} />
              <InfoBlock label="Region" value={`${property.suburb}, ${property.city}`} />
              <InfoBlock label="Portfolio owner" value={client.consultant} />
              <InfoBlock label="Last updated" value="2026-07-07" />
            </div>
          </Card>

          <Card className="surface-elevated p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl">Active lease</h2>
              <span className="tag-pill">{lease.status}</span>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <InfoBlock label="Lease start date" value={lease.start} />
              <InfoBlock label="Lease expiry date" value={lease.end} />
              <InfoBlock label="Renewal notice date" value={renewalNoticeDate} />
              <InfoBlock label="Landlord" value={property.landlord} />
              <InfoBlock label="Current monthly rental" value={formatZAR(property.monthlyRental)} />
              <InfoBlock label="Escalation percentage" value={lease.escalation} />
            </div>
            <div className="mt-5">
              <Button variant="outline" asChild>
                <Link to="/portal/$clientSlug/properties/$propertyId/lease" params={{ clientSlug: client.slug, propertyId: property.id }}>
                  <FileSearch className="h-4 w-4" /> View lease details
                </Link>
              </Button>
            </div>
          </Card>

          <Card className="surface-elevated p-6">
            <h2 className="font-display text-xl">Rental summary</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard label="Monthly rental" value={formatZAR(property.monthlyRental)} />
              <MetricCard label="Annual rental" value={formatZAR(annualRental)} />
              <MetricCard label="Escalation" value={lease.escalation} />
              <MetricCard label="Cost per m2" value={`R ${costPerSqm}`} />
              <MetricCard label="Previous year rental" value={formatZAR(previousYearRental)} />
              <MetricCard label="Projected next year rental" value={formatZAR(projectedNextYearRental)} />
            </div>
          </Card>

          <Card className="surface-elevated p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl">Linked documents</h2>
                <p className="mt-1 text-sm text-muted-foreground">Lease, rental, utility, and addendum records connected to this property.</p>
              </div>
              <Button variant="outline" onClick={() => openPicker(uploadInputRef)}>
                <Upload className="h-4 w-4" /> Add document
              </Button>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="py-3 pr-3">Document name</th>
                    <th className="py-3 pr-3">Type</th>
                    <th className="py-3 pr-3">Status</th>
                    <th className="py-3 pr-3">Upload date</th>
                    <th className="py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedDocuments.map((document) => (
                    <tr key={document.id} className="border-b border-border/60 hover:bg-accent/20">
                      <td className="py-3 pr-3 font-medium">{document.name}</td>
                      <td className="py-3 pr-3"><span className="tag-pill">{document.type}</span></td>
                      <td className="py-3 pr-3"><DocStatus status={document.status} /></td>
                      <td className="py-3 pr-3 font-mono text-xs text-muted-foreground">{document.uploaded}</td>
                      <td className="py-3 text-right">
                        <Button variant="ghost" size="sm">
                          <FileText className="h-4 w-4" /> View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <section>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl">Insights</h2>
                <p className="mt-1 text-sm text-muted-foreground">Signals that connect the lease, document flow, and portfolio context for this property.</p>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {insights.map((insight) => (
                <Card key={insight.id} className="surface-elevated p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`rounded-md border px-2.5 py-1 text-xs font-medium ${priorityClass(insight.priority)}`}>{insight.priority} priority</span>
                    <span className="font-mono text-xs text-muted-foreground">{insight.confidence}</span>
                  </div>
                  <h3 className="mt-4 font-display text-lg">{insight.title}</h3>
                  <div className="mt-3 text-sm text-muted-foreground">
                    Source: <span className="text-foreground">{insight.source}</span>
                  </div>
                  <div className="mt-3 rounded-md border border-border bg-card/50 p-3 text-sm text-muted-foreground">{insight.note}</div>
                  <Button variant="outline" className="mt-4 w-full justify-between">
                    {insight.cta} <ArrowRight className="h-4 w-4" />
                  </Button>
                </Card>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <Card className="surface-elevated p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl">Renewal timeline</h2>
                <p className="mt-1 text-sm text-muted-foreground">The current lease is approaching a decision window.</p>
              </div>
              <span className="inline-flex items-center rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                <Bell className="mr-1 h-3.5 w-3.5" /> {renewalWindowLabel}
              </span>
            </div>
            <div className="mt-5 h-2 rounded-full bg-accent">
              <div className="h-2 rounded-full bg-warning" style={{ width: "78%" }} />
            </div>
            <div className="mt-5 space-y-4">
              {timelineItems.map((item) => (
                <div key={item.label} className="relative flex gap-3">
                  <div className={`mt-1 h-3 w-3 rounded-full ${timelineTone(item.tone)}`} />
                  <div>
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{item.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="surface-elevated p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl">Open actions</h2>
                <p className="mt-1 text-sm text-muted-foreground">Tasks that keep the property moving toward renewal readiness.</p>
              </div>
              <CalendarRange className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-4 space-y-3">
              {propertyActions.map((action) => (
                <div key={action.id} className="rounded-lg border border-border/70 bg-card/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{action.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Due {action.due}</div>
                    </div>
                    <span className={`rounded-md border px-2 py-1 text-xs font-medium ${priorityClass(action.priority)}`}>{action.priority}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="tag-pill">{action.status}</span>
                    <Button variant="ghost" size="sm">
                      {action.cta}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/50 p-4">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-xl">{value}</div>
    </div>
  );
}

function DocStatus({ status }: { status: LinkedDocument["status"] }) {
  const classes = {
    Published: "border-success/40 bg-success/10 text-success",
    "Needs Review": "border-warning/40 bg-warning/10 text-warning",
    Processing: "border-primary/30 bg-primary/10 text-primary",
  } satisfies Record<LinkedDocument["status"], string>;

  return <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${classes[status]}`}>{status}</span>;
}

function priorityClass(priority: "High" | "Medium" | "Low") {
  if (priority === "High") return "border-warning/40 bg-warning/10 text-warning";
  if (priority === "Medium") return "border-primary/30 bg-primary/10 text-primary";
  return "border-border bg-card text-muted-foreground";
}

function timelineTone(tone: "complete" | "current" | "urgent" | "warning" | "future") {
  if (tone === "complete") return "bg-success";
  if (tone === "current") return "bg-primary";
  if (tone === "urgent") return "bg-warning ring-4 ring-warning/15";
  if (tone === "warning") return "bg-warning/70";
  return "bg-muted-foreground/40";
}

function openPicker(inputRef: RefObject<HTMLInputElement | null>) {
  inputRef.current?.click();
}
