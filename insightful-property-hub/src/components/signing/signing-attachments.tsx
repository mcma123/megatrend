import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { ATTACHMENT_PURPOSE_LABELS } from "../../../../convex/lib/signingFields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError } from "@/components/portfolio/form-fields";

const STATUS = { pending: "Awaiting scan", clean: "Scanned and accepted", rejected: "Rejected" };

/**
 * Participant supporting documents. Opening one needs signing authority, recent MFA and a stated
 * reason, and is recorded in the agreement's audit trail before the short-lived link is issued.
 */
export function SigningAttachments({
  agreementId,
  canEdit,
}: {
  agreementId: Id<"signingAgreements">;
  canEdit: boolean;
}) {
  const rows = useQuery(api.signingAttachments.list, { agreementId });
  const open = useAction(api.signingAttachments.open);
  const [target, setTarget] = useState<Id<"signingAttachments"> | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!rows?.length) return null;
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="font-medium">Supporting documents</h3>
        <p className="text-xs text-muted-foreground">
          Uploaded by participants, malware-scanned and retained. They are not read by assistants or
          text extraction. Each staff access is recorded with its reason.
        </p>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium break-words">
              {row.filename} · {ATTACHMENT_PURPOSE_LABELS[row.purpose]}
            </p>
            <p className="text-xs text-muted-foreground">
              {STATUS[row.status]} · {(row.sizeBytes / 1024).toFixed(0)} KB · uploaded{" "}
              {new Date(row.createdAt).toLocaleString()}
              {row.sha256 ? ` · SHA-256 ${row.sha256.slice(0, 12)}…` : ""}
            </p>
            {canEdit && row.status === "clean" && target !== row.id && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTarget(row.id);
                  setReason("");
                  setError(null);
                }}
              >
                Open document
              </Button>
            )}
            {target === row.id && (
              <div className="space-y-2">
                <Field label="Why do you need this document?" htmlFor={`${row.id}-reason`}>
                  <Textarea
                    id={`${row.id}-reason`}
                    dictation={false}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                {error && <FormError message={error} />}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || reason.trim().length < 10}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      void open({ attachmentId: row.id, reason })
                        .then(({ url }) => {
                          window.open(url, "_blank", "noopener,noreferrer");
                          setTarget(null);
                        })
                        .catch((err) =>
                          setError(
                            err instanceof ConvexError && typeof err.data === "string"
                              ? err.data
                              : "The document could not be opened",
                          ),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    Record reason and open
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
