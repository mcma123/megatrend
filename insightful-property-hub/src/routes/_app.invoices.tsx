import { DocumentLink } from "@/components/documents/document-link";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { AlertTriangle, Eye, EyeOff, FileText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, LoadingState, NativeSelect } from "@/components/portfolio/form-fields";
import { errorMessage, formatDate, formatZAR } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/_app/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices & anomalies · Cyphersoft OS" },
      {
        name: "description",
        content: "Invoices from approved documents, with baseline anomaly detection.",
      },
    ],
  }),
  component: InvoicesPage,
});

type AnomalyStatus = Doc<"anomalies">["status"];
const SEVERITY_CLASSES: Record<Doc<"anomalies">["severity"], string> = {
  low: "border-border text-muted-foreground",
  medium: "border-primary/30 text-primary",
  high: "border-warning/40 text-warning",
  critical: "border-destructive/40 text-destructive",
};
const STATUS_LABELS: Record<AnomalyStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

function InvoicesPage() {
  const invoices = useQuery(api.invoices.list, {});
  const anomalies = useQuery(api.invoices.listAnomalies, {});
  const setStatus = useMutation(api.invoices.setAnomalyStatus);
  const setShared = useMutation(api.invoices.setAnomalyShared);
  const [tab, setTab] = useState<"anomalies" | "invoices">("anomalies");

  const open = (anomalies ?? []).filter(
    (anomaly) => anomaly.status === "open" || anomaly.status === "investigating",
  );
  const serious = open.filter(
    (anomaly) => anomaly.severity === "high" || anomaly.severity === "critical",
  );

  const changeStatus = async (anomalyId: Id<"anomalies">, status: AnomalyStatus) => {
    let note: string | undefined;
    if (status === "resolved" || status === "dismissed") {
      const answer = window.prompt("What was the outcome? (optional)");
      if (answer === null) return;
      note = answer || undefined;
    }
    try {
      await setStatus({ anomalyId, status, note });
    } catch (statusError) {
      toast.error(errorMessage(statusError));
    }
  };

  const toggleShared = async (anomalyId: Id<"anomalies">, shared: boolean) => {
    try {
      await setShared({ anomalyId, shared });
      toast.success(shared ? "Shared with the client portal" : "Hidden from the client portal");
    } catch (shareError) {
      toast.error(errorMessage(shareError));
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Internal · Invoices"
        title="Every invoice, checked against its baseline."
        description="Approved invoices and utility statements are recorded automatically and compared with the supplier's rolling average for that property. Spikes and possible duplicates open an investigation task and a draft insight."
      />

      {serious.length > 0 ? (
        <Card className="mb-6 border-warning/40 bg-warning/5 p-4 text-sm">
          <AlertTriangle className="mr-2 inline h-4 w-4 text-warning" />
          {serious.length} high or critical anomal{serious.length === 1 ? "y needs" : "ies need"}{" "}
          attention.
        </Card>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="mb-4">
        <TabsList>
          <TabsTrigger value="anomalies">
            Anomalies{open.length ? ` (${open.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "anomalies" ? (
        <Card className="surface-elevated overflow-x-auto p-4">
          {anomalies === undefined ? (
            <LoadingState label="Loading anomalies…" />
          ) : anomalies.length === 0 ? (
            <EmptyState
              title="No anomalies"
              description="They appear when an approved invoice is well above its baseline or looks like a duplicate."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-3 pr-3">Supplier</th>
                  <th className="py-3 pr-3">Client / property</th>
                  <th className="py-3 pr-3 text-right">Amount</th>
                  <th className="py-3 pr-3 text-right">Baseline</th>
                  <th className="py-3 pr-3">Severity</th>
                  <th className="py-3 pr-3">Status</th>
                  <th className="py-3 text-right">Client</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((anomaly) => (
                  <tr key={anomaly._id} className="border-b border-border/50 align-top">
                    <td className="py-3 pr-3">
                      <div className="font-medium">{anomaly.supplier}</div>
                      <div className="max-w-sm text-xs text-muted-foreground">{anomaly.cause}</div>
                      {anomaly.document ? (
                        <DocumentLink
                          documentId={anomaly.document.documentId}
                          className="mt-1 inline-flex items-center gap-1 text-xs hover:text-primary"
                        >
                          <FileText className="h-3 w-3" /> {anomaly.document.filename}
                        </DocumentLink>
                      ) : null}
                      {anomaly.note ? (
                        <div className="mt-1 text-xs italic text-muted-foreground">
                          Outcome: {anomaly.note}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">
                      {anomaly.client.name}
                      {anomaly.property ? (
                        <div className="text-xs">{anomaly.property.name}</div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 text-right font-mono">{formatZAR(anomaly.amount)}</td>
                    <td className="py-3 pr-3 text-right font-mono text-muted-foreground">
                      {anomaly.baseline !== undefined ? formatZAR(anomaly.baseline) : "—"}
                      {anomaly.delta !== undefined ? (
                        <div className="text-xs text-warning">
                          +{Math.round(anomaly.delta * 100)}%
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs capitalize",
                          SEVERITY_CLASSES[anomaly.severity],
                        )}
                      >
                        {anomaly.kind === "possible_duplicate" ? "Duplicate?" : anomaly.severity}
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <NativeSelect
                        className="h-8 w-auto text-xs"
                        value={anomaly.status}
                        onChange={(e) =>
                          void changeStatus(anomaly._id, e.target.value as AnomalyStatus)
                        }
                        aria-label="Anomaly status"
                      >
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </NativeSelect>
                    </td>
                    <td className="py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void toggleShared(anomaly._id, !anomaly.sharedWithClient)}
                      >
                        {anomaly.sharedWithClient ? (
                          <>
                            <Eye className="h-3.5 w-3.5" /> Shared
                          </>
                        ) : (
                          <>
                            <EyeOff className="h-3.5 w-3.5" /> Share
                          </>
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card className="surface-elevated overflow-x-auto p-4">
          {invoices === undefined ? (
            <LoadingState label="Loading invoices…" />
          ) : invoices.length === 0 ? (
            <EmptyState
              title="No invoices yet"
              description="Invoices are recorded when an uploaded invoice or utility statement is reviewed and approved."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-3 pr-3">Supplier</th>
                  <th className="py-3 pr-3">Client / property</th>
                  <th className="py-3 pr-3">Date</th>
                  <th className="py-3 pr-3 text-right">Amount</th>
                  <th className="py-3 pr-3 text-right">Baseline</th>
                  <th className="py-3 pr-3 text-right">Delta</th>
                  <th className="py-3">Flags</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice._id} className="border-b border-border/50">
                    <td className="py-3 pr-3">
                      <DocumentLink
                        documentId={invoice.documentId}
                        className="font-medium hover:text-primary"
                      >
                        {invoice.supplier}
                      </DocumentLink>
                      <div className="text-xs text-muted-foreground">
                        {invoice.kind === "utility_statement" ? "Utility statement" : "Invoice"}
                        {invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ""}
                        {invoice.periodLabel ? ` · ${invoice.periodLabel}` : ""}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">
                      {invoice.client.name}
                      {invoice.property ? (
                        <div className="text-xs">{invoice.property.name}</div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs">
                      {formatDate(invoice.periodDate)}
                    </td>
                    <td className="py-3 pr-3 text-right font-mono">{formatZAR(invoice.amount)}</td>
                    <td className="py-3 pr-3 text-right font-mono text-muted-foreground">
                      {invoice.baseline !== undefined ? (
                        formatZAR(invoice.baseline)
                      ) : (
                        <span className="text-xs">needs {3 - invoice.baselineSampleSize} more</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "py-3 pr-3 text-right font-mono",
                        invoice.delta !== null && invoice.delta >= 0.15
                          ? "text-warning"
                          : "text-muted-foreground",
                      )}
                    >
                      {invoice.delta !== null
                        ? `${invoice.delta >= 0 ? "+" : ""}${Math.round(invoice.delta * 100)}%`
                        : "—"}
                    </td>
                    <td className="py-3">
                      {invoice.anomalies.map((anomaly) => (
                        <span
                          key={anomaly.anomalyId}
                          className={cn(
                            "mr-1 rounded-full border px-2 py-0.5 text-[11px]",
                            SEVERITY_CLASSES[anomaly.severity],
                          )}
                        >
                          {anomaly.kind === "possible_duplicate" ? "duplicate?" : anomaly.severity}{" "}
                          · {STATUS_LABELS[anomaly.status].toLowerCase()}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
