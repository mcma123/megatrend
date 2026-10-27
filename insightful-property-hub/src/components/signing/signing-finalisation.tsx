import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/portfolio/form-fields";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { verifiedPdf } from "./private-pdf";

type Props = { agreementId: Id<"signingAgreements">; canEdit: boolean };
type Report = {
  passed: boolean;
  checkedAt: number;
  checks: Record<"recordHash" | "pdfHash" | "evidenceHash" | "binding" | "seal", boolean>;
  timestamp: number | null;
  signerSubject: string | null;
};
const CHECK_LABELS: Record<keyof Report["checks"], string> = {
  recordHash: "Completion record",
  pdfHash: "Sealed PDF bytes",
  evidenceHash: "Evidence manifest",
  binding: "Canonical evidence encoding",
  seal: "Platform seal, timestamp and trust",
};
const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  submitting: "Submitting",
  running: "Sealing",
  submission_unknown: "Job outcome unresolved",
  failed: "Failed",
  completed: "Completed",
  superseded: "Superseded",
};
function errorText(error: unknown, fallback: string) {
  return error instanceof ConvexError && typeof error.data === "string" ? error.data : fallback;
}
export function SigningFinalisation(props: Props) {
  const { profile } = useCyphersoftAuth();
  return profile ? (
    <FinalisationCard key={`${profile.userId}:${props.agreementId}`} {...props} />
  ) : null;
}
function FinalisationCard({ agreementId, canEdit }: Props) {
  const data = useQuery(api.signingFinalisation.status, { agreementId }),
    retry = useMutation(api.signingFinalisation.retry),
    reconcile = useMutation(api.signingFinalisation.reconcile),
    getUrl = useAction(api.signingFinalisation.getSignedUrl),
    verify = useAction(api.signingFinalisation.verify);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [report, setReport] = useState<Report | null>(null);
  if (!data) return null;
  if (!["finalising", "completed"].includes(data.agreementStatus) && !data.attempts.length)
    return null;
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  };
  const completion = data.completion;
  const validation = completion?.validation as
    { level?: string; signerSubject?: string; tsaSubject?: string; timestamp?: number } | undefined;
  return (
    <Card className="space-y-3 p-5">
      <div>
        <h2 className="text-lg font-medium">Finalisation and evidence</h2>
        <p className="text-xs text-muted-foreground">
          The platform seal protects the completed file and its evidence; it is not a
          participant&apos;s certificate or an advanced electronic signature. An agreement stays
          Finalising until every artifact is stored and validated.
        </p>
      </div>
      {!data.configured && !completion && (
        <p role="alert" className="text-xs">
          Finalisation storage, platform seal or timestamp service is not configured. Signatures
          remain safely recorded; the agreement stays Finalising.
        </p>
      )}
      {completion && (
        <div className="space-y-1 rounded-md border bg-muted/20 p-3 text-xs">
          <p className="text-sm font-medium">
            Completed {new Date(completion.completedAt).toLocaleString()}
          </p>
          <p>
            {validation?.level ?? "Sealed"} · trusted timestamp{" "}
            {new Date(completion.sealedAt).toLocaleString()}
            {validation?.tsaSubject ? ` · ${validation.tsaSubject}` : ""}
          </p>
          {validation?.signerSubject && <p>Seal certificate: {validation.signerSubject}</p>}
          <p className="break-all">Sealed PDF SHA-256 {completion.pdfHash}</p>
          <p className="break-all">Evidence manifest SHA-256 {completion.evidenceHash}</p>
          <p>
            {completion.pageCount} pages including {completion.certificatePageCount} completion
            certificate page{completion.certificatePageCount === 1 ? "" : "s"} · retained until{" "}
            {new Date(completion.retainUntil).toLocaleDateString()}
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const link = await getUrl({ agreementId });
                  if (link.pdfHash !== completion.pdfHash)
                    throw new Error("Signed document reference changed");
                  const abort = new AbortController();
                  const blob = await verifiedPdf(link.url, completion.pdfHash, abort.signal);
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = "signed-agreement.pdf";
                  anchor.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }, "The signed document could not be downloaded or failed its integrity check")
              }
            >
              Download sealed PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(
                  async () => setReport((await verify({ agreementId })) as Report),
                  "Verification could not be completed",
                )
              }
            >
              Verify integrity
            </Button>
          </div>
          {report && (
            <div role="status" className="pt-2">
              <p className="font-medium">
                {report.passed ? "Verification passed" : "Verification FAILED"} ·{" "}
                {new Date(report.checkedAt).toLocaleString()}
              </p>
              <ul>
                {(Object.keys(CHECK_LABELS) as (keyof Report["checks"])[]).map((key) => (
                  <li key={key}>
                    {report.checks[key] ? "✓" : "✗"} {CHECK_LABELS[key]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {data.attempts.length > 0 && (
        <ol className="space-y-1 text-xs">
          {data.attempts.map((attempt) => (
            <li key={attempt.id} className="rounded border p-2">
              Attempt {attempt.attempt} · {STATUS_LABELS[attempt.status] ?? attempt.status} ·{" "}
              {new Date(attempt.createdAt).toLocaleString()}
              {attempt.automatic ? " · automatic" : ""}
              {attempt.message && <span className="block">{attempt.message}</span>}
            </li>
          ))}
        </ol>
      )}
      {canEdit && !completion && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || !data.canRetry || !data.configured}
            onClick={() => run(() => retry({ agreementId }), "Finalisation could not be started")}
          >
            {data.attempts.length ? "Retry finalisation" : "Start finalisation"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !data.canReconcile}
            onClick={() =>
              run(() => reconcile({ agreementId }), "The existing job could not be checked")
            }
          >
            Check existing job
          </Button>
        </div>
      )}
      <FormError message={error} />
    </Card>
  );
}
