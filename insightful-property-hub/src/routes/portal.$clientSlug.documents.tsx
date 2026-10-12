import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  ExternalLink,
  FileScan,
  FileText,
  RefreshCcw,
  Replace,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { DocumentUploadDialog } from "@/components/documents/document-upload-dialog";
import { EmptyState, LoadingState, NativeSelect } from "@/components/portfolio/form-fields";
import {
  ACCEPTED_UPLOAD_TYPES,
  CLIENT_DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  formatBytes,
  formatTimestamp,
  isProcessing,
  processingProgress,
  type DocumentType,
} from "@/lib/documents";
import { usePortal } from "@/lib/portal-context";
import { errorMessage } from "@/lib/portfolio";
import { useDocumentUpload, useOpenDocument } from "@/lib/use-document-upload";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/portal/$clientSlug/documents")({
  head: () => ({ meta: [{ title: "Documents | Client portal | Cyphersoft" }] }),
  component: ClientDocumentsPage,
});

type StatusFilter = "all" | "processing" | "review" | "failed";

function ClientDocumentsPage() {
  const { client, viewer } = usePortal();
  const documents = useQuery(api.documents.list, { tenantId: client.tenantId });
  const properties = useQuery(api.properties.list, { tenantId: client.tenantId }) ?? [];
  const reprocess = useMutation(api.documents.reprocess);
  const requestDeletion = useMutation(api.documents.requestDeletion);
  const openDocument = useOpenDocument();
  const { replace } = useDocumentUpload();
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<Id<"documents"> | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<DocumentType | "all">("all");
  const [propertyFilter, setPropertyFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const canUpload = viewer.roleKey !== "executive_viewer" && viewer.roleKey !== "read_only_staff";

  const rows = useMemo(() => documents ?? [], [documents]);
  const processingRows = rows.filter(
    (d) =>
      isProcessing(d.status) ||
      d.processingActive ||
      d.processingIncomplete ||
      d.stageSummary.some((stage) => stage.status === "failed" || stage.status === "partial"),
  );
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const summary = {
    total: rows.length,
    processing: processingRows.length,
    failed: rows.filter((d) => d.status === "processing_failed").length,
    thisMonth: rows.filter((d) => d.createdAt >= startOfMonth).length,
  };

  const filtered = rows.filter((d) => {
    const type = d.documentType ?? d.declaredType;
    const q = query.trim().toLowerCase();
    return (
      (!q ||
        d.filename.toLowerCase().includes(q) ||
        (d.property?.name ?? "").toLowerCase().includes(q)) &&
      (typeFilter === "all" || type === typeFilter) &&
      (propertyFilter === "all" || d.property?.propertyId === propertyFilter) &&
      (statusFilter === "all" ||
        (statusFilter === "processing" && isProcessing(d.status)) ||
        (statusFilter === "review" &&
          (d.status === "review_required" || d.status === "extraction_complete")) ||
        (statusFilter === "failed" && d.status === "processing_failed"))
    );
  });

  const onRetry = async (documentId: Id<"documents">) => {
    try {
      await reprocess({ documentId });
      toast.success("Processing restarted");
    } catch (retryError) {
      toast.error(errorMessage(retryError));
    }
  };

  const onRequestDeletion = async (documentId: Id<"documents">, filename: string) => {
    const reason = window.prompt(`Why should "${filename}" be removed? (optional)`);
    if (reason === null) return;
    try {
      await requestDeletion({ documentId, reason: reason || undefined });
      toast.success("Deletion requested. Your Cyphersoft team will confirm.");
    } catch (deleteError) {
      toast.error(errorMessage(deleteError));
    }
  };

  const onReplaceFile = async (file: File) => {
    if (!replaceTarget) return;
    const result = await replace(file, replaceTarget, client.tenantId);
    setReplaceTarget(null);
    if (result.ok) {
      toast.success("New version uploaded. Processing has started.");
    } else {
      toast.error(result.error);
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <input
        ref={replaceInputRef}
        type="file"
        accept={ACCEPTED_UPLOAD_TYPES}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onReplaceFile(file);
        }}
      />
      <PageHeader
        eyebrow="Client portal | Documents"
        title="Documents"
        description="Upload invoices, statements, contracts and leases. Each document is read automatically and reviewed by your Cyphersoft team."
        actions={
          canUpload ? (
            <>
              <DocumentUploadDialog
                tenantId={client.tenantId}
                trigger={
                  <Button>
                    <Upload className="h-4 w-4" /> Upload
                  </Button>
                }
              />
              <DocumentUploadDialog
                tenantId={client.tenantId}
                title="Bulk upload"
                trigger={
                  <Button variant="outline">
                    <Upload className="h-4 w-4" /> Bulk upload
                  </Button>
                }
              />
              <Button asChild variant="outline">
                <Link
                  to="/portal/$clientSlug/documents/scanner"
                  params={{ clientSlug: client.slug }}
                >
                  <FileScan className="h-4 w-4" /> Scan document
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Documents" value={summary.total} />
        <Summary label="Processing" value={summary.processing} />
        <Summary
          label="Need attention"
          value={summary.failed}
          detail="Failed to process; retry or replace"
        />
        <Summary label="Uploaded this month" value={summary.thisMonth} />
      </section>

      {processingRows.length > 0 ? (
        <Card className="surface-elevated mt-6 p-5">
          <h3 className="font-display text-lg">Processing and review queue</h3>
          <ul className="mt-3 space-y-3">
            {processingRows.map((d) => (
              <li key={d._id}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{d.filename}</span>
                  <DocumentStatusBadge status={d.status} audience="client" />
                </div>
                {d.statusMessage ? (
                  <p className="mt-2 text-xs text-muted-foreground">{d.statusMessage}</p>
                ) : null}
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {d.stageSummary.map((stage) => (
                    <li key={stage.name}>
                      {stage.name === "parse"
                        ? "Reading"
                        : stage.name === "knowledge"
                          ? "Document search"
                          : "Extracting details"}
                      :{" "}
                      {stage.status === "failed" || stage.status === "partial"
                        ? "Team attention needed"
                        : stage.status === "succeeded"
                          ? "Ready"
                          : stage.status === "skipped"
                            ? "Waiting for earlier work"
                            : "In progress"}
                    </li>
                  ))}
                </ul>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${processingProgress(d.status)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="surface-elevated mt-6 p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documents…"
              className="pl-9"
            />
          </div>
          <NativeSelect
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as DocumentType | "all")}
            aria-label="Type"
          >
            <option value="all">All types</option>
            {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value={propertyFilter}
            onChange={(e) => setPropertyFilter(e.target.value)}
            aria-label="Property"
          >
            <option value="all">All properties</option>
            {properties.map((property) => (
              <option key={property._id} value={property._id}>
                {property.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Status"
          >
            <option value="all">All statuses</option>
            <option value="processing">Processing</option>
            <option value="review">Under review</option>
            <option value="failed">Failed</option>
          </NativeSelect>
        </div>

        <div className="mt-4 overflow-x-auto">
          {documents === undefined ? (
            <LoadingState label="Loading documents…" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No documents yet"
              description={
                canUpload
                  ? "Upload your first lease, invoice or statement."
                  : "Documents shared with you will appear here."
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState title="No documents match these filters" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-3 pr-3">Document</th>
                  <th className="py-3 pr-3">Type</th>
                  <th className="py-3 pr-3">Property</th>
                  <th className="py-3 pr-3">Uploaded</th>
                  <th className="py-3 pr-3">Status</th>
                  <th className="py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const type = d.documentType ?? d.declaredType;
                  return (
                    <tr
                      key={d._id}
                      className="border-b border-border/50 align-top hover:bg-accent/20"
                    >
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-2 font-medium">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="max-w-[16rem] truncate">{d.filename}</span>
                        </div>
                        <div className="pl-6 text-xs text-muted-foreground">
                          {formatBytes(d.sizeBytes)}
                          {d.source === "scanner" ? " · scanned" : ""}
                        </div>
                        {d.statusMessage ? (
                          <div className="pl-6 text-xs text-destructive">{d.statusMessage}</div>
                        ) : null}
                        {d.deletionRequestedAt ? (
                          <div className="pl-6 text-xs text-destructive">Deletion requested</div>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3">{type ? DOCUMENT_TYPE_LABELS[type] : "—"}</td>
                      <td className="py-3 pr-3 text-muted-foreground">{d.property?.name ?? "—"}</td>
                      <td className="py-3 pr-3 text-xs text-muted-foreground">
                        {formatTimestamp(d.createdAt)}
                        <div>{d.uploaderName}</div>
                      </td>
                      <td className="py-3 pr-3" title={CLIENT_DOCUMENT_STATUS_LABELS[d.status]}>
                        <DocumentStatusBadge status={d.status} audience="client" />
                      </td>
                      <td className="py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void openDocument(d._id)}
                          >
                            <ExternalLink className="h-3.5 w-3.5" /> View
                          </Button>
                          {canUpload && d.canRetryProcessing ? (
                            <Button variant="ghost" size="sm" onClick={() => void onRetry(d._id)}>
                              <RefreshCcw className="h-3.5 w-3.5" /> Retry
                            </Button>
                          ) : null}
                          {canUpload ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setReplaceTarget(d._id);
                                replaceInputRef.current?.click();
                              }}
                            >
                              <Replace className="h-3.5 w-3.5" /> Replace
                            </Button>
                          ) : null}
                          {canUpload && !d.deletionRequestedAt ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void onRequestDeletion(d._id, d.filename)}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </main>
  );
}

function Summary({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <Card className="surface-elevated p-5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-2xl">{value}</div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </Card>
  );
}
