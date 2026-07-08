import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSearch,
  MessageSquare,
  Receipt,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatZAR, getClientBySlug, getProperty } from "@/lib/mock-data";

type ExtractedField = {
  field: string;
  value: string;
  confidence: string;
  source: string;
  status: "Approved" | "Needs Review";
};

type LeaseInsight = {
  title: string;
  detail: string;
  priority: "High" | "Medium" | "Low";
  cta: string;
};

type LeaseTimelineItem = {
  label: string;
  date: string;
  tone: "complete" | "current" | "urgent" | "warning" | "future";
};

const extractedFields: ExtractedField[] = [
  { field: "Lease expiry date", value: "2026-08-31", confidence: "96%", source: "Page 4", status: "Approved" },
  { field: "Escalation", value: "8% annually", confidence: "89%", source: "Page 7", status: "Approved" },
  { field: "Deposit", value: "R 3 385 600", confidence: "76%", source: "Page 3", status: "Needs Review" },
  { field: "Utility responsibility", value: "Tenant responsible for electricity and water", confidence: "93%", source: "Page 9", status: "Approved" },
];

const leaseInsights: LeaseInsight[] = [
  {
    title: "Renewal alert",
    detail: "Renewal notice was due on 2026-06-30 and expiry is approaching.",
    priority: "High",
    cta: "Review renewal plan",
  },
  {
    title: "Escalation warning",
    detail: "The 8% escalation is above recent portfolio trend for comparable logistics leases.",
    priority: "Medium",
    cta: "Compare escalation",
  },
  {
    title: "Missing addendum issue",
    detail: "No signed addendum has been linked for the latest commercial amendment discussion.",
    priority: "High",
    cta: "Request missing document",
  },
];

export const Route = createFileRoute("/portal/$clientSlug/properties/$propertyId/lease")({
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
      { title: `Lease Detail | ${loaderData?.property.name ?? "Property"} | ${loaderData?.client.name ?? "Client"} portal | Megatrend` },
      {
        name: "description",
        content: `Lease detail workspace for ${loaderData?.property.name ?? "this property"}.`,
      },
    ],
  }),
  component: LeaseDetailPage,
});

function LeaseDetailPage() {
  const { client, property } = Route.useLoaderData();

  const lease = {
    property: "DHL Linbro Park DC",
    landlord: "Linbro Industrial Holdings",
    startDate: "2023-09-01",
    expiryDate: "2026-08-31",
    renewalNoticeDate: "2026-06-30",
    monthlyRental: 1_692_800,
    annualRental: 20_313_600,
    escalation: "8% annually",
    deposit: "R 3 385 600",
    utilityResponsibility: "Tenant responsible for electricity and water",
    linkedContract: "DHL Linbro Park Lease Agreement.pdf",
    contractUploadDate: "2026-07-01",
    contractStatus: "Published",
    aiConfidence: "94%",
    accountManager: client.consultant,
    tenant: client.name,
    maintenanceResponsibility: "Maintenance responsibility placeholder",
    insuranceResponsibility: "Insurance responsibility placeholder",
    paymentFrequency: "Monthly in advance",
    renewalWindowStatus: "Renewal window active",
    monthsRemaining: "T-2 months",
    approvedBy: "Jared van Niekerk",
    approvedDate: "2026-07-02",
    lastReviewed: "2026-07-07",
    notes: "Megatrend reviewed the source lease and approved the client-visible commercial terms below.",
  };

  const costPerSqm = Math.round(lease.monthlyRental / property.sizeSqm);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <nav className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link to="/portal/$clientSlug" params={{ clientSlug: client.slug }} className="hover:text-foreground">Portfolio</Link>
        <ChevronRight className="h-4 w-4" />
        <span>Properties</span>
        <ChevronRight className="h-4 w-4" />
        <Link to="/portal/$clientSlug/properties/$propertyId" params={{ clientSlug: client.slug, propertyId: property.id }} className="hover:text-foreground">
          {property.name}
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">Lease</span>
      </nav>

      <PageHeader
        eyebrow="Lease workspace"
        title="Lease Detail"
        description={lease.property}
        actions={
          <>
            <span className="inline-flex items-center rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
              Active
            </span>
            <Button variant="outline">
              <FileSearch className="h-4 w-4" /> View contract
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Monthly rental" value={formatZAR(lease.monthlyRental)} />
        <MetricCard label="Annual rental" value={formatZAR(lease.annualRental)} />
        <MetricCard label="Expiry date" value={lease.expiryDate} />
        <MetricCard label="Renewal notice" value={lease.renewalNoticeDate} />
        <MetricCard label="Escalation" value={lease.escalation} />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.85fr)]">
        <div className="space-y-6">
          <Card className="surface-elevated p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl">Important dates</h2>
              <span className="inline-flex items-center rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                {lease.monthsRemaining}
              </span>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <InfoBlock label="Lease start date" value={lease.startDate} />
              <InfoBlock label="Lease expiry date" value={lease.expiryDate} />
              <InfoBlock label="Renewal notice deadline" value={lease.renewalNoticeDate} />
              <InfoBlock label="Renewal window status" value={lease.renewalWindowStatus} />
              <InfoBlock label="Months remaining" value={lease.monthsRemaining} />
              <InfoBlock label="Urgency" value="Close attention required" />
            </div>
            <div className="mt-5 h-2 rounded-full bg-accent">
              <div className="h-2 rounded-full bg-warning" style={{ width: "84%" }} />
            </div>
          </Card>

          <Card className="surface-elevated p-6">
            <h2 className="font-display text-xl">Financial terms</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <InfoBlock label="Monthly rental" value={formatZAR(lease.monthlyRental)} />
              <InfoBlock label="Annual rental" value={formatZAR(lease.annualRental)} />
              <InfoBlock label="Deposit" value={lease.deposit} />
              <InfoBlock label="Escalation percentage" value={lease.escalation} />
              <InfoBlock label="Cost per m2" value={`R ${costPerSqm}`} />
              <InfoBlock label="Payment frequency" value={lease.paymentFrequency} />
              <InfoBlock label="Utility responsibility" value={lease.utilityResponsibility} />
            </div>
          </Card>

          <Card className="surface-elevated p-6">
            <h2 className="font-display text-xl">Parties and responsibilities</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <InfoBlock label="Tenant" value={lease.tenant} />
              <InfoBlock label="Landlord" value={lease.landlord} />
              <InfoBlock label="Megatrend account manager" value={lease.accountManager} />
              <InfoBlock label="Utility responsibility" value={lease.utilityResponsibility} />
              <InfoBlock label="Maintenance responsibility" value={lease.maintenanceResponsibility} />
              <InfoBlock label="Insurance responsibility" value={lease.insuranceResponsibility} />
            </div>
          </Card>

          <Card className="surface-elevated p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl">Linked contract</h2>
                <p className="mt-1 text-sm text-muted-foreground">The source contract stays one click away from the lease intelligence.</p>
              </div>
              <span className="inline-flex items-center rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                {lease.aiConfidence}
              </span>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <InfoBlock label="Contract file name" value={lease.linkedContract} />
              <InfoBlock label="Document type" value="Lease agreement" />
              <InfoBlock label="Upload date" value={lease.contractUploadDate} />
              <InfoBlock label="Processing status" value={lease.contractStatus} />
              <InfoBlock label="AI confidence" value={lease.aiConfidence} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="outline"><FileSearch className="h-4 w-4" /> View document</Button>
              <Button variant="outline"><Download className="h-4 w-4" /> Download</Button>
              <Button variant="outline"><ScrollText className="h-4 w-4" /> Replace contract</Button>
            </div>
          </Card>

          <Card className="surface-elevated p-6">
            <h2 className="font-display text-xl">AI extracted fields</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Raw AI extraction is visible here so clients can see what was found and what still needs review.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="py-3 pr-3">Field name</th>
                    <th className="py-3 pr-3">Extracted value</th>
                    <th className="py-3 pr-3">Confidence</th>
                    <th className="py-3 pr-3">Source page/reference</th>
                    <th className="py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {extractedFields.map((field) => (
                    <tr key={field.field} className="border-b border-border/60 hover:bg-accent/20">
                      <td className="py-3 pr-3 font-medium">{field.field}</td>
                      <td className="py-3 pr-3">{field.value}</td>
                      <td className="py-3 pr-3 font-mono text-xs text-muted-foreground">{field.confidence}</td>
                      <td className="py-3 pr-3 text-muted-foreground">{field.source}</td>
                      <td className="py-3"><FieldStatus status={field.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="surface-elevated border-success/30 bg-success/5 p-6">
            <h2 className="font-display text-xl text-success">Human approved lease intelligence</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Client-visible lease values are reviewed and approved by Megatrend before they are published here.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <InfoBlock label="Approved by" value={lease.approvedBy} />
              <InfoBlock label="Approved date" value={lease.approvedDate} />
              <InfoBlock label="Last reviewed" value={lease.lastReviewed} />
              <InfoBlock label="Notes" value={lease.notes} />
            </div>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card className="surface-elevated p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl">Renewal timeline</h2>
                <p className="mt-1 text-sm text-muted-foreground">Critical renewal milestones for this lease.</p>
              </div>
              <span className="inline-flex items-center rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                {lease.monthsRemaining}
              </span>
            </div>
            <div className="mt-5 space-y-4">
              {([
                { label: "Lease started", date: lease.startDate, tone: "complete" },
                { label: "Current period", date: "2026-07-07", tone: "current" },
                { label: "Renewal notice deadline", date: lease.renewalNoticeDate, tone: "urgent" },
                { label: "Renewal decision", date: "Pending", tone: "warning" },
                { label: "Lease expiry", date: lease.expiryDate, tone: "future" },
              ] as LeaseTimelineItem[]).map((item) => (
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
            <h2 className="font-display text-xl">Related insights</h2>
            <div className="mt-4 space-y-3">
              {leaseInsights.map((insight) => (
                <div key={insight.title} className="rounded-lg border border-border/70 bg-card/50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{insight.title}</div>
                    <span className={`rounded-md border px-2 py-1 text-xs font-medium ${priorityClass(insight.priority)}`}>{insight.priority}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{insight.detail}</p>
                  <Button variant="ghost" size="sm" className="mt-3 px-0">
                    {insight.cta} <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card className="surface-elevated border-warning/40 bg-warning/5 p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
              <div>
                <h2 className="font-display text-lg text-warning">Transparency note</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  AI extraction is shown separately from human-approved lease intelligence so clients can distinguish raw capture from reviewed terms.
                </p>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="surface-elevated p-5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-3 font-display text-2xl">{value}</div>
    </Card>
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

function FieldStatus({ status }: { status: ExtractedField["status"] }) {
  if (status === "Approved") {
    return (
      <span className="inline-flex items-center rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approved
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
      <AlertTriangle className="mr-1 h-3.5 w-3.5" /> Needs Review
    </span>
  );
}

function priorityClass(priority: LeaseInsight["priority"]) {
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
