import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "convex/react";
import { AlertTriangle, FileText, Search, Upload } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { DocumentUploadDialog } from "@/components/documents/document-upload-dialog";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { DOCUMENT_TYPE_LABELS, formatTimestamp, isProcessing } from "@/lib/documents";
import { useVoiceCommands } from "@/lib/voice/command-registry";
import { validateNewFormSearch } from "@/lib/voice/new-form-search";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/_app/documents")({
  validateSearch: validateNewFormSearch,
  head: () => ({
    meta: [
      { title: "Document intelligence · Cyphersoft OS" },
      {
        name: "description",
        content: "Uploaded leases, invoices and statements, read and extracted automatically.",
      },
    ],
  }),
  component: DocumentsPage,
});

type DocumentTab = "all" | "processing" | "review" | "failed";

function DocumentsPage() {
  const documents = useQuery(api.documents.list, {});
  const [tab, setTab] = useState<DocumentTab>("all");
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const setUploadOpen = (open: boolean) =>
    void navigate({ to: "/documents", search: open ? { new: "1" } : {}, replace: !open });

  useVoiceCommands("documents.list", {
    "documents.tab": {
      run: ({ tab: next }) => {
        setTab(String(next) as DocumentTab);
        return `Showing ${String(next)} documents.`;
      },
    },
    "documents.search": {
      run: ({ query: text }) => {
        setQ(String(text));
        return `Showing documents matching "${String(text)}".`;
      },
    },
  });

  const counts = {
    processing: (documents ?? []).filter((d) => isProcessing(d.status)).length,
    review: (documents ?? []).filter((d) => d.status === "review_required").length,
    failed: (documents ?? []).filter((d) => d.status === "processing_failed").length,
  };
  const filtered = (documents ?? []).filter((d) => {
    const matchesTab =
      tab === "all"
        ? true
        : tab === "processing"
          ? isProcessing(d.status)
          : tab === "review"
            ? d.status === "review_required"
            : d.status === "processing_failed";
    const matchesQuery =
      !query ||
      [d.filename, d.client.name, d.property?.name ?? ""].some((v) =>
        v.toLowerCase().includes(query),
      );
    return matchesTab && matchesQuery;
  });

  const uploadButton = (
    <DocumentUploadDialog
      open={search.new === "1"}
      onOpenChange={setUploadOpen}
      trigger={
        <Button>
          <Upload className="h-4 w-4" /> Upload documents
        </Button>
      }
    />
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Internal · Document intelligence"
        title="From PDF to structured data."
        description="Leases, invoices and statements uploaded by your team or clients are read by Docling and their key fields extracted for review."
        actions={uploadButton}
      />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs value={tab} onValueChange={(value) => setTab(value as DocumentTab)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="processing">
              Processing{counts.processing ? ` (${counts.processing})` : ""}
            </TabsTrigger>
            <TabsTrigger value="review">
              Needs review{counts.review ? ` (${counts.review})` : ""}
            </TabsTrigger>
            <TabsTrigger value="failed">
              Failed{counts.failed ? ` (${counts.failed})` : ""}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search files, clients, properties…"
            className="pl-9"
          />
        </div>
      </div>

      <Card className="surface-elevated overflow-x-auto p-4">
        {documents === undefined ? (
          <LoadingState label="Loading documents…" />
        ) : documents.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Upload a lease, invoice or statement to get started."
            action={
              <Button onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4" /> Upload documents
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No documents match this view" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="py-3 pr-3">File</th>
                <th className="py-3 pr-3">Type</th>
                <th className="py-3 pr-3">Client</th>
                <th className="py-3 pr-3">Uploaded</th>
                <th className="py-3 pr-3">Status</th>
                <th className="py-3">Flags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d._id} className="border-b border-border/50 hover:bg-accent/30">
                  <td className="py-3 pr-3">
                    <Link
                      to="/documents/$id"
                      params={{ id: d._id }}
                      className="inline-flex items-center gap-2 font-medium hover:text-primary"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="max-w-[18rem] truncate">{d.filename}</span>
                    </Link>
                    {d.property ? (
                      <div className="pl-6 text-xs text-muted-foreground">{d.property.name}</div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">
                    {(d.documentType ?? d.declaredType)
                      ? DOCUMENT_TYPE_LABELS[(d.documentType ?? d.declaredType)!]
                      : "—"}
                  </td>
                  <td className="py-3 pr-3 text-muted-foreground">{d.client.name}</td>
                  <td className="py-3 pr-3 text-xs text-muted-foreground">
                    {formatTimestamp(d.createdAt)}
                    <div>
                      {d.uploaderName}
                      {d.uploaderPrincipal === "client" ? " · client" : ""}
                      {d.source === "scanner" ? " · scanned" : ""}
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <DocumentStatusBadge status={d.status} />
                  </td>
                  <td className="py-3 text-xs">
                    {d.missingFields.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <AlertTriangle className="h-3.5 w-3.5" /> Missing {d.missingFields.length}
                      </span>
                    ) : null}
                    {d.deletionRequestedAt ? (
                      <div className="text-destructive">Deletion requested</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
