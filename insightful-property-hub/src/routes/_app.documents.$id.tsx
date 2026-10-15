import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ExternalLink, RefreshCcw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApplyToRecordsCard } from "@/components/documents/apply-to-records-card";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { FieldReviewTable } from "@/components/documents/field-review-table";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import {
  DOCUMENT_TYPE_LABELS,
  formatBytes,
  formatTimestamp,
  isProcessing,
  processingProgress,
} from "@/lib/documents";
import { errorMessage } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import { useVoiceCommands } from "@/lib/voice/command-registry";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/_app/documents/$id")({
  head: () => ({ meta: [{ title: "Document · Cyphersoft OS" }] }),
  component: DocumentDetail,
});

const PIPELINE = [
  { status: "uploaded", label: "Uploaded" },
  { status: "queued_for_ocr", label: "Reading (Docling OCR)" },
  { status: "ocr_complete", label: "Extracting fields" },
  { status: "extraction_complete", label: "Extracted" },
] as const;

function DocumentDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const document = useQuery(api.documents.get, { documentId: id as Id<"documents"> });
  const reprocess = useMutation(api.documents.reprocess);
  const remove = useMutation(api.documents.requestDeletion);
  const acknowledgeIncomplete = useMutation(api.review.acknowledgeIncomplete);
  const retryStage = useMutation(api.processing.retryStage);
  const reconcile = useMutation(api.processing.reconcile);
  const [busy, setBusy] = useState(false);
  const [coverageReason, setCoverageReason] = useState("");
  useEffect(() => setCoverageReason(""), [document?.activeAttemptId, document?.windmillJobId]);

  const isStaffManager = Boolean(document?.isStaff && document.canManage);
  const retryableStages = (document?.stageSummary ?? []).filter((stage) => stage.canRetry);
  useVoiceCommands("documents.detail", {
    "document.reprocess": {
      run: async () => {
        if (!document) throw new Error("Document is not loaded yet.");
        try {
          await reprocess({ documentId: document._id });
        } catch (error) {
          throw new Error(errorMessage(error));
        }
        toast.success("Processing restarted");
        return "Processing restarted.";
      },
      enabled:
        Boolean(document?.canManage) &&
        !(document && (isProcessing(document.status) || document.processingActive)),
    },
    "document.retryStage": {
      run: async ({ stage }) => {
        if (!document) throw new Error("Document is not loaded yet.");
        try {
          await retryStage({
            documentId: document._id,
            attemptId: document.activeAttemptId,
            stage: String(stage) as "parse" | "knowledge" | "extract",
          });
        } catch (error) {
          throw new Error(errorMessage(error));
        }
        return "Stage retry started.";
      },
      params: [
        {
          name: "stage",
          label: "Stage",
          type: "select",
          required: true,
          options: retryableStages.map((stage) => ({
            value: stage.name,
            label:
              stage.name === "parse"
                ? "Document reading"
                : stage.name === "knowledge"
                  ? "Document search"
                  : "Field extraction",
          })),
        },
      ],
      enabled: isStaffManager && retryableStages.length > 0,
    },
    "document.acknowledgeIncomplete": {
      run: async ({ reason }) => {
        if (!document) throw new Error("Document is not loaded yet.");
        const text = String(reason).trim();
        if (text.length < 10)
          throw new Error("Describe what you checked (at least 10 characters).");
        try {
          await acknowledgeIncomplete({
            documentId: document._id,
            attemptId: document.activeAttemptId,
            reason: text.slice(0, 500),
          });
        } catch (error) {
          throw new Error(errorMessage(error));
        }
        return "Source coverage decision recorded.";
      },
      enabled:
        isStaffManager &&
        Boolean(document?.processingIncomplete) &&
        !document?.incompleteAcknowledgedAt,
    },
  });

  if (document === undefined) {
    return <LoadingState label="Loading document…" />;
  }
  if (document === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Document not found"
          description="It may have been deleted, or you don't have access to it."
          action={
            <Button asChild variant="outline">
              <Link to="/documents">All documents</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const type = document.documentType ?? document.declaredType;
  const processing = isProcessing(document.status) || document.processingActive;
  const stageIndex = PIPELINE.findIndex((stage) => stage.status === document.status);
  const reachedAll =
    !processing && document.status !== "processing_failed" && !document.processingIncomplete;

  const onReprocess = async () => {
    setBusy(true);
    try {
      await reprocess({ documentId: document._id });
      toast.success("Processing restarted");
    } catch (reprocessError) {
      toast.error(errorMessage(reprocessError));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (
      !window.confirm(
        `Delete ${document.filename}? It will be hidden from staff and the client portal.`,
      )
    )
      return;
    setBusy(true);
    try {
      await remove({ documentId: document._id });
      toast.success("Document deleted");
      void navigate({ to: "/documents" });
    } catch (deleteError) {
      toast.error(errorMessage(deleteError));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        to="/documents"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Documents
      </Link>
      <PageHeader
        eyebrow={`${type ? DOCUMENT_TYPE_LABELS[type] : "Document"} · ${document.client.name}`}
        title={document.filename}
        description={`${formatBytes(document.sizeBytes)} · uploaded ${formatTimestamp(document.createdAt)} by ${document.uploaderName}${document.uploaderPrincipal === "client" ? " (client)" : ""}`}
        actions={
          <>
            {document.fileUrl ? (
              <Button asChild variant="outline">
                <a href={document.fileUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" /> View original
                </a>
              </Button>
            ) : null}
            {document.canManage ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => void onReprocess()}
                  disabled={busy || processing}
                >
                  <RefreshCcw className="h-4 w-4" /> Re-process
                </Button>
                <Button variant="outline" onClick={() => void onDelete()} disabled={busy}>
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {document.deletionRequestedAt ? (
        <Card className="mb-4 border-destructive/40 bg-destructive/5 p-4 text-sm">
          The client asked for this document to be removed
          {document.deletionReason ? `: “${document.deletionReason}”` : "."}
        </Card>
      ) : null}

      {document.stageSummary.length > 0 ? (
        <Card className="mb-4 p-5">
          <h3 className="font-display text-lg">Processing stages</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {document.stageSummary.map((stage) => (
              <div key={stage.name} className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {stage.name === "parse"
                    ? "Document reading"
                    : stage.name === "knowledge"
                      ? "Document search"
                      : "Field extraction"}
                </p>
                <p className="mt-1 text-xs capitalize">
                  {stage.status}
                  {stage.reused ? " · saved output reused" : ""}
                </p>
                {stage.message ? <p className="mt-2 text-xs">{stage.message}</p> : null}
                {document.isStaff && stage.error ? (
                  <p className="mt-2 break-words text-xs text-destructive">{stage.error}</p>
                ) : null}
                {stage.completedAt ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Updated {formatTimestamp(stage.completedAt)}
                  </p>
                ) : null}
                {document.isStaff && document.canManage && stage.canRetry ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void retryStage({
                        documentId: document._id,
                        attemptId: document.activeAttemptId,
                        stage: stage.name,
                      })
                        .then(() => toast.success("Stage retry started"))
                        .catch((error) => toast.error(errorMessage(error)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Retry{" "}
                    {stage.name === "parse"
                      ? "reading"
                      : stage.name === "knowledge"
                        ? "search indexing"
                        : "extraction"}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          {document.processingHeld && document.isStaff && document.canManage ? (
            <Button
              variant="outline"
              className="mt-4"
              disabled={busy}
              onClick={() => {
                const attemptId = document.activeRecoveryAttemptId ?? document.activeAttemptId;
                setBusy(true);
                void reconcile({ documentId: document._id, attemptId })
                  .then(() => toast.success("Checking the existing processing job"))
                  .catch((error) => toast.error(errorMessage(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Check existing job
            </Button>
          ) : null}
        </Card>
      ) : null}

      {document.processingIncomplete ? (
        <Card className="mb-4 border-warning/40 bg-warning/5 p-4 text-sm">
          <p className="font-medium">Source coverage is incomplete</p>
          <p className="mt-1 text-xs">
            Check the original before completing review or applying extracted values.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {document.processingWarnings?.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          {document.incompleteAcknowledgedAt ? (
            <p className="mt-3 text-xs">
              Staff acknowledgement: {document.incompleteAcknowledgementReason}
            </p>
          ) : document.isStaff && document.canManage ? (
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                try {
                  await acknowledgeIncomplete({
                    documentId: document._id,
                    attemptId: document.activeAttemptId,
                    reason: coverageReason,
                  });
                  toast.success("Source coverage decision recorded");
                } catch (error) {
                  toast.error(errorMessage(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Input
                className="min-w-60 flex-1"
                value={coverageReason}
                onChange={(event) => setCoverageReason(event.target.value)}
                maxLength={500}
                aria-label="Source coverage check"
                placeholder="Describe what you checked in the original document"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={busy || coverageReason.trim().length < 10}
              >
                Acknowledge incomplete coverage
              </Button>
            </form>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="surface-elevated p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg">Processing</h3>
            <DocumentStatusBadge status={document.status} />
          </div>
          <ol className="mt-4 space-y-2 text-sm">
            {PIPELINE.map((stage, index) => {
              const done = reachedAll || (stageIndex >= 0 && index < stageIndex);
              const current = processing && index === stageIndex;
              return (
                <li key={stage.status} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      done ? "bg-primary" : current ? "animate-pulse bg-primary/60" : "bg-border",
                    )}
                  />
                  <span className={done || current ? "text-foreground" : "text-muted-foreground"}>
                    {stage.label}
                  </span>
                </li>
              );
            })}
          </ol>
          {processing ? (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${processingProgress(document.status)}%` }}
              />
            </div>
          ) : null}
          {document.statusMessage ? (
            <p
              className={cn(
                "mt-4 text-xs",
                document.status === "processing_failed"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {document.statusMessage}
            </p>
          ) : null}
          <dl className="mt-4 space-y-1.5 text-xs text-muted-foreground">
            {document.ocrConfidence !== undefined ? (
              <div>OCR confidence: {Math.round(document.ocrConfidence * 100)}%</div>
            ) : null}
            {document.typeConfidence !== undefined ? (
              <div>Type confidence: {Math.round(document.typeConfidence * 100)}%</div>
            ) : null}
            {document.pageCount ? <div>Pages: {document.pageCount}</div> : null}
            {document.processedAt ? (
              <div>Processed: {formatTimestamp(document.processedAt)}</div>
            ) : null}
            <div>Attempts: {document.processingAttempts}</div>
            {document.okfBundleRoot ? (
              <div className="break-all">Knowledge bundle: {document.okfBundleRoot}</div>
            ) : null}
          </dl>
        </Card>

        <Card className="surface-elevated p-5 lg:col-span-2">
          <h3 className="font-display text-lg">Extracted fields</h3>
          {document.summary ? (
            <p className="mt-1 text-sm text-muted-foreground">{document.summary}</p>
          ) : null}
          {document.missingFields.length > 0 ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                Not found in the document:{" "}
                {document.missingFields.map((key) => key.replace(/_/g, " ")).join(", ")}. Ask the
                client for the missing information or check the original.
              </span>
            </div>
          ) : null}
          {document.fields.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title={processing ? "Extraction in progress…" : "No fields extracted"}
                description={
                  processing
                    ? "Fields appear here automatically when processing finishes."
                    : undefined
                }
              />
            </div>
          ) : (
            <FieldReviewTable
              documentId={document._id}
              fields={document.fields}
              canReview={document.isStaff && document.canManage}
              reviewOpen={
                document.status === "review_required" || document.status === "extraction_complete"
              }
            />
          )}
        </Card>
      </div>

      {document.isStaff && document.canManage && document.fields.length > 0 ? (
        <ApplyToRecordsCard
          documentId={document._id}
          tenantId={document.tenantId}
          propertyId={document.property?.propertyId}
          documentType={document.documentType ?? document.declaredType}
          hasApprovedFields={document.fields.some((field) => field.state === "approved")}
        />
      ) : null}

      {document.textPreview ? (
        <Card className="surface-elevated mt-4 p-5">
          <h3 className="font-display text-lg">Text preview</h3>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            {document.textPreview}
          </pre>
        </Card>
      ) : null}

      <Card className="surface-elevated mt-4 p-5 text-sm">
        <span className="text-muted-foreground">Client: </span>
        <Link
          to="/clients/$id"
          params={{ id: document.client.slug }}
          className="font-medium hover:text-primary"
        >
          {document.client.name}
        </Link>
        {document.property ? (
          <>
            <span className="text-muted-foreground"> · Property: </span>
            <Link
              to="/properties/$id"
              params={{ id: document.property.propertyId }}
              className="font-medium hover:text-primary"
            >
              {document.property.name}
            </Link>
          </>
        ) : null}
      </Card>
    </div>
  );
}
