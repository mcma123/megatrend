import { verifiedPdf } from "./private-pdf";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { ArrowDown, ArrowUp, FileCheck2, FileLock2, Trash2 } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
  PREPARATION_MESSAGES,
  type PreparationError,
} from "../../../../convex/lib/signingPreparation";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";

const PdfPreview = lazy(() => import("@/components/documents/pdf-preview"));
const message = (error: unknown) =>
  error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : "The file operation failed. Please retry.";

function PreparedPreview({
  agreementId,
  bundleId,
}: {
  agreementId: Id<"signingAgreements">;
  bundleId: Id<"signingBundles">;
}) {
  const getUrl = useAction(api.signingFiles.getPreparedUrl);
  const [open, setOpen] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let privateUrl: string | null = null;
    void (async () => {
      try {
        const result = await getUrl({ agreementId });
        controller.signal.throwIfAborted();
        const blob = await verifiedPdf(result.url, result.pdfHash, controller.signal);
        privateUrl = URL.createObjectURL(blob);
        setBlobUrl(privateUrl);
      } catch (err) {
        if (!controller.signal.aborted) setError(message(err));
      }
    })();
    return () => {
      controller.abort();
      if (privateUrl) URL.revokeObjectURL(privateUrl);
    };
  }, [open, agreementId, bundleId, getUrl]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setBlobUrl(null);
        setError(null);
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileCheck2 className="h-4 w-4" />
          View prepared PDF
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[92dvh] w-[96vw] max-w-6xl flex-col gap-2 p-4">
        <DialogTitle>Prepared agreement and annexures</DialogTitle>
        <DialogDescription>
          Verified static PDF. This document has not been signed.
        </DialogDescription>
        {blobUrl && (
          <a className="w-fit text-sm underline" href={blobUrl} download="agreement.pdf">
            Download prepared PDF
          </a>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <FormError message={error} />
          ) : blobUrl ? (
            <Suspense fallback={<p>Loading PDF viewer…</p>}>
              <PdfPreview url={blobUrl} />
            </Suspense>
          ) : (
            <p className="p-5 text-sm" role="status">
              Verifying private PDF…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SigningFiles({
  agreement,
  canEdit,
}: {
  agreement: Doc<"signingAgreements">;
  canEdit: boolean;
}) {
  const { profile } = useCyphersoftAuth();
  return profile ? (
    <FileWorkspace
      key={`${profile.userId}:${agreement._id}`}
      agreement={agreement}
      canEdit={canEdit}
    />
  ) : null;
}
function FileWorkspace({
  agreement,
  canEdit,
}: {
  agreement: Doc<"signingAgreements">;
  canEdit: boolean;
}) {
  const data = useQuery(api.signingFiles.list, { agreementId: agreement._id });
  const reserve = useMutation(api.signingFiles.reserveUpload);
  const getForm = useAction(api.signingFiles.getUploadForm);
  const complete = useAction(api.signingFiles.completeUpload);
  const change = useMutation(api.signingFiles.changeFiles);
  const prepare = useMutation(api.signingPreparations.request);
  const reconcile = useMutation(api.signingPreparations.reconcile);
  const [role, setRole] = useState<"primary" | "annexure">("primary");
  const [file, setFile] = useState<File | null>(null);
  const [ticket, setTicket] = useState<{
    uploadId: Id<"signingUploads">;
    expiresAt: number;
  } | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Id<"signingFiles"> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const editable = canEdit && agreement.status === "draft" && !data?.busy;
  async function run(operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (err) {
      setError(message(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const resetFile = () => {
    setFile(null);
    setTicket(null);
    setRequestId(crypto.randomUUID());
    if (input.current) input.current.value = "";
  };
  async function upload() {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 25 * 1024 * 1024) {
      setError("Choose a PDF up to 25 MB.");
      return;
    }
    await run(async () => {
      const reserved =
        ticket ??
        (await reserve({
          agreementId: agreement._id,
          expectedRevision: agreement.revision,
          filename: file.name,
          role,
          sizeBytes: file.size,
          requestId,
        }));
      setTicket(reserved);
      const form = await getForm({ uploadId: reserved.uploadId });
      if (!alive.current) return;
      const body = new FormData();
      Object.entries(form.fields).forEach(([key, value]) => body.append(key, value));
      body.append("file", file);
      const abort = new AbortController();
      controller.current = abort;
      const timer = setTimeout(() => abort.abort(), 120_000);
      try {
        const response = await fetch(form.url, {
          method: "POST",
          body,
          signal: abort.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
        });
        if (!response.ok) throw new Error("Upload failed");
      } finally {
        clearTimeout(timer);
      }
      await complete({ uploadId: reserved.uploadId });
      resetFile();
    });
  }
  if (!data) return <Card className="p-5 text-sm">Loading private files…</Card>;
  const reorder = async (id: Id<"signingFiles">, direction: number) => {
    const ordered = data.files.map((f) => f.id);
    const index = ordered.indexOf(id);
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await change({
      agreementId: agreement._id,
      expectedFileRevision: data.fileRevision,
      orderedFileIds: ordered,
    });
  };
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="flex items-center gap-2 font-medium">
          <FileLock2 className="h-4 w-4" />
          Agreement PDF and annexures
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a flat, unsigned PDF. Files stay quarantined until malware scanning and PDF
          validation pass. The primary agreement appears first, followed by annexures in this order.
        </p>
      </div>
      {!data.configured && (
        <p className="rounded-md border border-amber-500/30 p-3 text-sm">
          Private signing storage and scanning are awaiting configuration. Upload and preparation
          are unavailable.
        </p>
      )}
      <ol className="divide-y rounded-md border">
        {!data.files.length && (
          <li className="p-3 text-sm text-muted-foreground">No PDFs uploaded yet.</li>
        )}
        {data.files.map((item, index) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
          >
            <div className="min-w-0">
              <p className="break-all font-medium">
                {index + 1}. {item.filename}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.role === "primary" ? "Primary agreement" : "Annexure"} ·{" "}
                {(item.sizeBytes / 1024 / 1024).toFixed(2)} MB ·{" "}
                {data.bundle
                  ? "Validated in current bundle"
                  : "Quarantined — no participant access"}
              </p>
            </div>
            {editable && (
              <div className="flex gap-1">
                {item.role === "annexure" && (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Move ${item.filename} earlier`}
                      disabled={busy || index === 0 || data.files[index - 1]?.role === "primary"}
                      onClick={() => void run(() => reorder(item.id, -1))}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Move ${item.filename} later`}
                      disabled={busy || index === data.files.length - 1}
                      onClick={() => void run(() => reorder(item.id, 1))}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${item.filename}`}
                  disabled={busy}
                  onClick={() => setRemoving(item.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {removing && editable && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <p>
            Remove this file from the draft? Any prepared bundle will need to be regenerated.
            Previous versions remain retained.
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await change({
                    agreementId: agreement._id,
                    expectedFileRevision: data.fileRevision,
                    orderedFileIds: data.files.filter((f) => f.id !== removing).map((f) => f.id),
                    removeFileId: removing,
                  });
                  setRemoving(null);
                })
              }
            >
              Remove file
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>
              Keep file
            </Button>
          </div>
        </div>
      )}
      {canEdit && agreement.status === "draft" && (
        <div className="space-y-3 rounded-md border p-4">
          <Field label="Document role" htmlFor="signing-file-role">
            <NativeSelect
              id="signing-file-role"
              value={role}
              disabled={busy || !!ticket || !editable}
              onChange={(e) => setRole(e.target.value as "primary" | "annexure")}
            >
              <option value="primary">Primary agreement</option>
              <option value="annexure">Annexure</option>
            </NativeSelect>
          </Field>
          <Field label="PDF file (maximum 25 MB)" htmlFor="signing-pdf-upload">
            <Input
              id="signing-pdf-upload"
              ref={input}
              type="file"
              accept=".pdf,application/pdf"
              disabled={busy || !editable || !data.configured}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setTicket(null);
                setRequestId(crypto.randomUUID());
                setError(null);
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!file || busy || !editable || !data.configured}
              onClick={() => void upload()}
            >
              {busy ? "Working…" : ticket ? "Retry upload" : "Upload to quarantine"}
            </Button>
            {ticket && (
              <>
                <Button
                  variant="outline"
                  disabled={busy || !editable}
                  onClick={() =>
                    void run(async () => {
                      await complete({ uploadId: ticket.uploadId });
                      resetFile();
                    })
                  }
                >
                  Check uploaded file
                </Button>
                <Button variant="ghost" disabled={busy} onClick={resetFile}>
                  Choose another file
                </Button>
              </>
            )}
          </div>
          {ticket && (
            <p className="text-xs text-muted-foreground">
              If the connection failed after uploading, use “Check uploaded file” before retrying.
              Expired tickets require selecting the file again.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Up to 10 PDFs, 75 MB total and 200 pages. Export interactive forms, annotations and
            layers to a flat PDF first.
          </p>
        </div>
      )}
      {data.attempt && (
        <p className="text-sm" role="status">
          Preparation: {data.attempt.status.replaceAll("_", " ")}
          {data.attempt.waitingTimedOut &&
            " — taking longer than expected; reconcile the existing job"}
          .
          {data.attempt.error && ` ${PREPARATION_MESSAGES[data.attempt.error as PreparationError]}`}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {editable && (
          <Button
            disabled={busy || !data.configured || !data.files.some((f) => f.role === "primary")}
            onClick={() =>
              void run(async () => {
                await prepare({
                  agreementId: agreement._id,
                  expectedRevision: agreement.revision,
                  expectedFileRevision: data.fileRevision,
                });
              })
            }
          >
            {data.attempt?.status === "failed"
              ? "Retry PDF preparation"
              : "Prepare and validate PDF bundle"}
          </Button>
        )}
        {canEdit && data.busy && data.attempt?.waitingTimedOut && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await reconcile({ agreementId: agreement._id });
              })
            }
          >
            Reconcile existing job
          </Button>
        )}
        {data.bundle && (
          <PreparedPreview
            key={data.bundle.id}
            agreementId={agreement._id}
            bundleId={data.bundle.id}
          />
        )}
      </div>
      {data.bundle && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Prepared bundle: {data.bundle.pageCount} pages · Integrity references
          </summary>
          <p className="mt-2 break-all">PDF SHA-256: {data.bundle.pdfHash}</p>
          <p className="mt-1 break-all">Ordered manifest SHA-256: {data.bundle.manifestHash}</p>
          <p className="mt-2">
            Changing draft details or files requires a fresh bundle and approval. A prepared PDF is
            not an issued or signed agreement.
          </p>
        </details>
      )}
      {error && <FormError message={error} />}
    </Card>
  );
}
