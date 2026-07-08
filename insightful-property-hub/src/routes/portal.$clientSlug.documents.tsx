import { type ChangeEvent, type RefObject, useRef, useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  CalendarRange,
  CircleAlert,
  Download,
  Eye,
  FileSearch,
  Files,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getClientBySlug, properties } from "@/lib/mock-data";

type DocumentType = "Invoice" | "Lease" | "Utility" | "Contract" | "Statement" | "Other";
type DocumentStatus = "Processing" | "Needs Review" | "Published" | "Failed";
type ConfidenceLabel = `${number}%` | "Pending" | "Failed";
type QueueStep = "Uploaded" | "Validating" | "OCR" | "Extracting" | "Under Review" | "Published";

type ClientDocument = {
  id: string;
  name: string;
  type: DocumentType;
  propertyId: string;
  uploadDate: string;
  status: DocumentStatus;
  uploadedBy: string;
  confidence: ConfidenceLabel;
  insight: string;
};

type UploadQueueItem = {
  id: string;
  fileName: string;
  progress: number;
  currentStep: QueueStep;
  status: "active" | "complete" | "error";
  message: string;
};

const processingSteps: QueueStep[] = [
  "Uploaded",
  "Validating",
  "OCR",
  "Extracting",
  "Under Review",
  "Published",
];

const demoDocuments: ClientDocument[] = [
  {
    id: "doc-1",
    name: "DHL Linbro Park Lease Agreement.pdf",
    type: "Lease",
    propertyId: "p1",
    uploadDate: "2026-07-04",
    status: "Published",
    uploadedBy: "Thandi Mokoena",
    confidence: "94%",
    insight: "Lease term, escalation, and notice period extracted and published.",
  },
  {
    id: "doc-2",
    name: "June Utility Statement.pdf",
    type: "Utility",
    propertyId: "p1",
    uploadDate: "2026-07-03",
    status: "Needs Review",
    uploadedBy: "Jared van Niekerk",
    confidence: "81%",
    insight: "Consumption spike flagged. Meter reference needs confirmation.",
  },
  {
    id: "doc-3",
    name: "Rental Invoice May 2026.pdf",
    type: "Invoice",
    propertyId: "p2",
    uploadDate: "2026-06-29",
    status: "Published",
    uploadedBy: "Accounts Payable",
    confidence: "96%",
    insight: "Invoice lines matched to the Riverhorse lease and published.",
  },
  {
    id: "doc-4",
    name: "Signed Addendum.pdf",
    type: "Contract",
    propertyId: "p5",
    uploadDate: "2026-06-28",
    status: "Processing",
    uploadedBy: "Thandi Mokoena",
    confidence: "Pending",
    insight: "OCR completed. Clause extraction is still running.",
  },
  {
    id: "doc-5",
    name: "Airport Industria Utility Reconciliation.pdf",
    type: "Statement",
    propertyId: "p5",
    uploadDate: "2026-06-24",
    status: "Failed",
    uploadedBy: "Facilities Desk",
    confidence: "Failed",
    insight: "The uploaded scan is incomplete. Pages 2 and 3 are missing.",
  },
  {
    id: "doc-6",
    name: "Riverhorse Insurance Schedule.pdf",
    type: "Other",
    propertyId: "p2",
    uploadDate: "2026-06-21",
    status: "Published",
    uploadedBy: "Jared van Niekerk",
    confidence: "91%",
    insight: "Document classified as supporting property operations evidence.",
  },
  {
    id: "doc-7",
    name: "Linbro Service Charge Statement April 2026.pdf",
    type: "Statement",
    propertyId: "p1",
    uploadDate: "2026-06-19",
    status: "Needs Review",
    uploadedBy: "Accounts Payable",
    confidence: "67%",
    insight: "Charge code mapping is uncertain and needs human review.",
  },
  {
    id: "doc-8",
    name: "Warehouse Access Contract.pdf",
    type: "Contract",
    propertyId: "p2",
    uploadDate: "2026-06-16",
    status: "Published",
    uploadedBy: "Legal Team",
    confidence: "88%",
    insight: "Supplier contract linked to the active warehouse profile.",
  },
];

const initialQueue: UploadQueueItem[] = [
  {
    id: "queue-1",
    fileName: "Signed Addendum.pdf",
    progress: 72,
    currentStep: "Extracting",
    status: "active",
    message: "Megatrend AI is extracting clauses and matching them to the active lease.",
  },
  {
    id: "queue-2",
    fileName: "June Utility Statement.pdf",
    progress: 88,
    currentStep: "Under Review",
    status: "active",
    message: "Consumption variance has been flagged for client review before publication.",
  },
  {
    id: "queue-3",
    fileName: "Airport Industria Utility Reconciliation.pdf",
    progress: 18,
    currentStep: "Validating",
    status: "error",
    message: "Validation failed because the document scan is missing pages.",
  },
];

export const Route = createFileRoute("/portal/$clientSlug/documents")({
  loader: ({ params }) => {
    const client = getClientBySlug(params.clientSlug);
    if (!client) throw notFound();
    return { client };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `Documents | ${loaderData?.client.name ?? "Client"} portal | Megatrend` },
      {
        name: "description",
        content: `Track uploaded invoices, contracts, utility statements, and lease documents for ${loaderData?.client.name ?? "your portfolio"}.`,
      },
    ],
  }),
  component: ClientDocumentsPage,
});

function ClientDocumentsPage() {
  const { client } = Route.useLoaderData();
  const clientProperties = properties.filter((property) => property.clientId === client.id);
  const propertyOptions = clientProperties.map((property) => ({ id: property.id, name: property.name }));

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"All" | DocumentType>("All");
  const [statusFilter, setStatusFilter] = useState<"All" | DocumentStatus>("All");
  const [propertyFilter, setPropertyFilter] = useState<"All" | string>("All");
  const [dateRangeLabel] = useState("Date range");
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>(initialQueue);
  const singleUploadRef = useRef<HTMLInputElement>(null);
  const bulkUploadRef = useRef<HTMLInputElement>(null);

  const filteredDocuments = demoDocuments.filter((document) => {
    const matchesQuery =
      query.trim().length === 0 ||
      document.name.toLowerCase().includes(query.toLowerCase()) ||
      document.uploadedBy.toLowerCase().includes(query.toLowerCase()) ||
      getPropertyName(document.propertyId, propertyOptions).toLowerCase().includes(query.toLowerCase());
    const matchesType = typeFilter === "All" || document.type === typeFilter;
    const matchesStatus = statusFilter === "All" || document.status === statusFilter;
    const matchesProperty = propertyFilter === "All" || document.propertyId === propertyFilter;

    return matchesQuery && matchesType && matchesStatus && matchesProperty;
  });

  const summary = {
    total: demoDocuments.length,
    processing: demoDocuments.filter((document) => document.status === "Processing").length,
    needsReview: demoDocuments.filter((document) => document.status === "Needs Review").length,
    published: demoDocuments.filter((document) => document.status === "Published").length,
  };

  const onFileSelected = (event: ChangeEvent<HTMLInputElement>, source: "single" | "bulk") => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const queuedItems = files.map((file, index) => ({
      id: `${source}-${file.name}-${index}-${Date.now()}`,
      fileName: file.name,
      progress: source === "bulk" ? 10 : 14,
      currentStep: "Uploaded" as QueueStep,
      status: "active" as const,
      message:
        source === "bulk"
          ? "Added to the bulk upload queue. Validation will start as each file is ingested."
          : "File received. Validation and OCR will begin next.",
    }));

    setUploadQueue((current) => [...queuedItems, ...current].slice(0, 5));
    event.target.value = "";
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <input
        ref={singleUploadRef}
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xls,.xlsx"
        onChange={(event) => onFileSelected(event, "single")}
      />
      <input
        ref={bulkUploadRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xls,.xlsx"
        onChange={(event) => onFileSelected(event, "bulk")}
      />

      <PageHeader
        eyebrow="Client portal | Documents"
        title="Documents"
        description="Track uploaded invoices, contracts, utility statements, and lease documents."
        actions={
          <>
            <Button onClick={() => openFilePicker(singleUploadRef)}>
              <Upload className="h-4 w-4" /> Upload document
            </Button>
            <Button variant="outline" onClick={() => openFilePicker(bulkUploadRef)}>
              <Files className="h-4 w-4" /> Bulk upload
            </Button>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total documents" value={summary.total} detail="Across leases, invoices, utilities, and supporting records." />
        <SummaryCard label="Processing" value={summary.processing} detail="Currently moving through validation and extraction." />
        <SummaryCard label="Needs review" value={summary.needsReview} detail="Flagged for a client or consultant decision." />
        <SummaryCard label="Published" value={summary.published} detail="Available to the portfolio record and downstream workflows." />
      </section>

      <Card className="surface-elevated mt-6 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documents..."
              className="pl-9"
            />
          </div>
          <FilterSelect
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as "All" | DocumentType)}
            options={["All", "Invoice", "Lease", "Utility", "Contract", "Statement", "Other"]}
            ariaLabel="Filter by document type"
          />
          <FilterSelect
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "All" | DocumentStatus)}
            options={["All", "Processing", "Needs Review", "Published", "Failed"]}
            ariaLabel="Filter by document status"
          />
          <select
            value={propertyFilter}
            onChange={(event) => setPropertyFilter(event.target.value)}
            aria-label="Filter by property"
            className="h-9 min-w-[12rem] rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
          >
            <option value="All">All properties</option>
            {propertyOptions.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
          <Button variant="outline" className="justify-start xl:min-w-[11rem]">
            <CalendarRange className="h-4 w-4" /> {dateRangeLabel}
          </Button>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section>
          <Card className="surface-elevated overflow-hidden">
            <div className="border-b border-border px-5 py-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="font-display text-xl">Document register</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Every upload shows where it is in the review pipeline and how confident the extraction engine is.
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  Showing {filteredDocuments.length} of {demoDocuments.length} documents
                </div>
              </div>
            </div>

            {filteredDocuments.length === 0 ? (
              <EmptyState onUpload={() => openFilePicker(singleUploadRef)} />
            ) : (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        <th className="px-5 py-3">Document name</th>
                        <th className="px-3 py-3">Type</th>
                        <th className="px-3 py-3">Related property</th>
                        <th className="px-3 py-3">Upload date</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Uploaded by</th>
                        <th className="px-3 py-3">AI confidence</th>
                        <th className="px-5 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDocuments.map((document) => (
                        <tr key={document.id} className="border-b border-border/60 align-top hover:bg-accent/20">
                          <td className="px-5 py-4">
                            <div className="font-medium text-foreground">{document.name}</div>
                            <div className="mt-1 max-w-md text-xs text-muted-foreground">{document.insight}</div>
                          </td>
                          <td className="px-3 py-4"><span className="tag-pill">{document.type}</span></td>
                          <td className="px-3 py-4 text-muted-foreground">{getPropertyName(document.propertyId, propertyOptions)}</td>
                          <td className="px-3 py-4 font-mono text-xs text-muted-foreground">{document.uploadDate}</td>
                          <td className="px-3 py-4"><StatusBadge status={document.status} /></td>
                          <td className="px-3 py-4 text-muted-foreground">{document.uploadedBy}</td>
                          <td className="px-3 py-4"><ConfidenceLabel confidence={document.confidence} /></td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                                <Eye className="h-3.5 w-3.5" /> View
                              </Button>
                              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                                <Download className="h-3.5 w-3.5" /> Download
                              </Button>
                              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                                <RefreshCw className="h-3.5 w-3.5" /> Replace
                              </Button>
                              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground">
                                <Trash2 className="h-3.5 w-3.5" /> Request deletion
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 p-4 lg:hidden">
                  {filteredDocuments.map((document) => (
                    <Card key={document.id} className="border border-border/70 bg-card/60 p-4 shadow-none">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{document.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{getPropertyName(document.propertyId, propertyOptions)}</div>
                        </div>
                        <StatusBadge status={document.status} />
                      </div>
                      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <Metadata label="Type" value={document.type} />
                        <Metadata label="Upload date" value={document.uploadDate} />
                        <Metadata label="Uploaded by" value={document.uploadedBy} />
                        <Metadata label="AI confidence" value={document.confidence} />
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">{document.insight}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button variant="outline" size="sm">
                          <Eye className="h-3.5 w-3.5" /> View
                        </Button>
                        <Button variant="ghost" size="sm">
                          <Download className="h-3.5 w-3.5" /> Download
                        </Button>
                        <Button variant="ghost" size="sm">
                          <RefreshCw className="h-3.5 w-3.5" /> Replace
                        </Button>
                        <Button variant="ghost" size="sm">
                          <Trash2 className="h-3.5 w-3.5" /> Request deletion
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </Card>
        </section>

        <aside className="space-y-4">
          <Card className="surface-elevated p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Upload queue</div>
                <h2 className="mt-2 font-display text-lg">What happens after upload</h2>
              </div>
              <Upload className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Clients can see exactly which step each file is in, from intake through AI extraction and publication.
            </p>
            <div className="mt-4 space-y-3">
              {uploadQueue.map((item) => (
                <UploadQueueCard key={item.id} item={item} />
              ))}
            </div>
          </Card>

          <Card className="surface-elevated p-5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Client signal</div>
            <h2 className="mt-2 font-display text-lg">Why a document is held back</h2>
            <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
              <li className="rounded-md border border-border/70 bg-card/50 p-3">
                Low confidence keeps a file in review so extracted data does not overwrite the lease record too early.
              </li>
              <li className="rounded-md border border-border/70 bg-card/50 p-3">
                Failed validation means the file is readable enough to store, but not reliable enough to classify.
              </li>
              <li className="rounded-md border border-border/70 bg-card/50 p-3">
                Published documents are immediately available to downstream invoice, lease, and property workflows.
              </li>
            </ul>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <Card className="surface-elevated p-5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-3 font-display text-3xl">{value}</div>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </Card>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  options: string[];
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      onChange={onChange}
      aria-label={ariaLabel}
      className="h-9 min-w-[10rem] rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option === "All" ? `All ${ariaLabel.replace("Filter by ", "")}` : option}
        </option>
      ))}
    </select>
  );
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  const classes = {
    Processing: "border-primary/25 bg-primary/8 text-primary",
    "Needs Review": "border-warning/40 bg-warning/10 text-warning",
    Published: "border-success/40 bg-success/10 text-success",
    Failed: "border-destructive/40 bg-destructive/10 text-destructive",
  } satisfies Record<DocumentStatus, string>;

  return <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${classes[status]}`}>{status}</span>;
}

function ConfidenceLabel({ confidence }: { confidence: ConfidenceLabel }) {
  const isHigh = confidence.endsWith("%") && Number.parseInt(confidence, 10) >= 90;
  const isMid = confidence.endsWith("%") && Number.parseInt(confidence, 10) < 90;
  const className = confidence === "Failed"
    ? "text-destructive"
    : confidence === "Pending"
      ? "text-muted-foreground"
      : isHigh
        ? "text-success"
        : isMid
          ? "text-warning"
          : "text-foreground";

  return <span className={`font-mono text-xs ${className}`}>{confidence}</span>;
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

function UploadQueueCard({ item }: { item: UploadQueueItem }) {
  const currentStepIndex = processingSteps.indexOf(item.currentStep);

  return (
    <div className="rounded-lg border border-border/70 bg-card/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{item.fileName}</div>
          <div className="mt-1 text-xs text-muted-foreground">{item.message}</div>
        </div>
        {item.status === "error" ? (
          <CircleAlert className="mt-0.5 h-4 w-4 text-destructive" />
        ) : item.status === "complete" ? (
          <ShieldCheck className="mt-0.5 h-4 w-4 text-success" />
        ) : (
          <FileSearch className="mt-0.5 h-4 w-4 text-primary" />
        )}
      </div>
      <div className="mt-3 h-2 rounded-full bg-accent">
        <div className={`h-2 rounded-full ${item.status === "error" ? "bg-destructive" : "bg-primary"}`} style={{ width: `${item.progress}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {processingSteps.map((step, index) => {
          const isComplete = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;
          return (
            <span
              key={step}
              className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${
                isCurrent
                  ? item.status === "error"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-primary/30 bg-primary/10 text-primary"
                  : isComplete
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-border text-muted-foreground"
              }`}
            >
              {step}
            </span>
          );
        })}
      </div>
      {item.status === "error" && (
        <Button variant="ghost" size="sm" className="mt-3 h-8 px-2 text-xs">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full border border-dashed border-border bg-accent/30">
        <FileText className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mt-5 font-display text-2xl">No documents uploaded yet.</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Upload your first document to start tracking validation, AI extraction, and publication status in one place.
      </p>
      <Button className="mt-5" onClick={onUpload}>
        <Upload className="h-4 w-4" /> Upload your first document
      </Button>
    </div>
  );
}

function getPropertyName(propertyId: string, propertyOptions: Array<{ id: string; name: string }>) {
  return propertyOptions.find((property) => property.id === propertyId)?.name ?? "Unassigned property";
}

function openFilePicker(inputRef: RefObject<HTMLInputElement | null>) {
  inputRef.current?.click();
}
