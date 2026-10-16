import { DocumentLink } from "@/components/documents/document-link";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "convex/react";
import { Download, FileText, Search, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminAssistant } from "@/components/admin-assistant/admin-assistant-context";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { DOCUMENT_TYPE_LABELS } from "@/lib/documents";
import { describeLeaseStatus, formatDate, formatZAR } from "@/lib/portfolio";
import { api } from "../../../convex/_generated/api";

type SearchParams = { q?: string };

export const Route = createFileRoute("/_app/search")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Search · Cyphersoft OS" },
      { name: "description", content: "Search clients, properties, leases and documents." },
    ],
  }),
  component: SearchPage,
});

function toCsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
}

function SearchPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const { openWithPrompt } = useAdminAssistant();
  const [input, setInput] = useState(q ?? "");
  const term = (q ?? "").trim();
  const results = useQuery(api.search.global, term.length >= 2 ? { q: term } : "skip");

  useEffect(() => {
    setInput(q ?? "");
  }, [q]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void navigate({ to: "/search", search: { q: input.trim() || undefined } });
  };

  const total = results
    ? results.clients.length +
      results.properties.length +
      results.leases.length +
      results.documents.length
    : 0;

  const exportCsv = () => {
    if (!results) return;
    const rows: string[][] = [["Type", "Name", "Client", "Details"]];
    for (const client of results.clients)
      rows.push(["Client", client.name, client.name, client.industry ?? ""]);
    for (const property of results.properties)
      rows.push(["Property", property.name, property.client.name, property.city]);
    for (const lease of results.leases)
      rows.push([
        "Lease",
        lease.propertyName,
        lease.client.name,
        `${lease.startDate} to ${lease.endDate}; R ${lease.monthlyRental}/month; ${lease.status}`,
      ]);
    for (const document of results.documents)
      rows.push([
        "Document",
        document.filename,
        document.client.name,
        `${document.documentType ?? ""}; ${document.status}`,
      ]);
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `cyphersoft-search-${term.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Internal · Search"
        title="Find anything in the portfolio."
        description="Searches client names, properties, leases and document text. For questions about what documents say, ask the knowledge assistant."
      />

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. Linbro, City of Johannesburg, escalation…"
            className="h-11 pl-9"
          />
        </div>
        <Button type="submit" className="h-11">
          Search
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={!input.trim()}
          onClick={() => openWithPrompt("okf-agent", input.trim())}
        >
          <Sparkles className="h-4 w-4" /> Ask the documents
        </Button>
      </form>

      {term.length < 2 ? (
        <div className="mt-8">
          <EmptyState title="Type at least two characters to search" />
        </div>
      ) : results === undefined ? (
        <LoadingState label="Searching…" />
      ) : total === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={`No matches for “${term}”`}
            description="Try a client, property or supplier name — or ask the knowledge assistant about document contents."
          />
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {total} result{total === 1 ? "" : "s"} for “{term}”
            </p>
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {results.clients.length > 0 ? (
              <Card className="surface-elevated p-5">
                <h3 className="font-display text-lg">Clients</h3>
                <ul className="mt-3 divide-y divide-border text-sm">
                  {results.clients.map((client) => (
                    <li key={client.tenantId} className="py-2">
                      <Link
                        to="/clients/$id"
                        params={{ id: client.slug }}
                        className="font-medium hover:text-primary"
                      >
                        {client.name}
                      </Link>
                      {client.industry ? (
                        <span className="text-muted-foreground"> · {client.industry}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            {results.properties.length > 0 ? (
              <Card className="surface-elevated p-5">
                <h3 className="font-display text-lg">Properties</h3>
                <ul className="mt-3 divide-y divide-border text-sm">
                  {results.properties.map((property) => (
                    <li key={property.propertyId} className="py-2">
                      <Link
                        to="/properties/$id"
                        params={{ id: property.propertyId }}
                        className="font-medium hover:text-primary"
                      >
                        {property.name}
                      </Link>
                      <span className="text-muted-foreground">
                        {" "}
                        · {property.city} · {property.client.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            {results.leases.length > 0 ? (
              <Card className="surface-elevated p-5">
                <h3 className="font-display text-lg">Leases</h3>
                <ul className="mt-3 divide-y divide-border text-sm">
                  {results.leases.map((lease) => (
                    <li
                      key={lease.leaseId}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <Link
                          to="/leases/$id"
                          params={{ id: lease.leaseId }}
                          className="font-medium hover:text-primary"
                        >
                          {lease.propertyName}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {lease.client.name} · {formatDate(lease.startDate)} →{" "}
                          {formatDate(lease.endDate)} · {formatZAR(lease.monthlyRental)}/mo
                        </div>
                      </div>
                      <span className="tag-pill">{describeLeaseStatus(lease)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            {results.documents.length > 0 ? (
              <Card className="surface-elevated p-5 lg:col-span-2">
                <h3 className="font-display text-lg">Documents</h3>
                <ul className="mt-3 divide-y divide-border text-sm">
                  {results.documents.map((document) => (
                    <li
                      key={document.documentId}
                      className="flex items-start justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <DocumentLink
                          documentId={document.documentId}
                          className="inline-flex items-center gap-2 font-medium hover:text-primary"
                        >
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />{" "}
                          {document.filename}
                        </DocumentLink>
                        <div className="pl-6 text-xs text-muted-foreground">
                          {document.client.name}
                          {document.documentType
                            ? ` · ${DOCUMENT_TYPE_LABELS[document.documentType]}`
                            : ""}
                          {document.match === "content" ? " · matched in text" : ""}
                        </div>
                        {document.snippet ? (
                          <p className="pl-6 text-xs italic text-muted-foreground">
                            …{document.snippet}…
                          </p>
                        ) : null}
                      </div>
                      <DocumentStatusBadge status={document.status} />
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
