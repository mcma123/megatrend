import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError } from "@/components/portfolio/form-fields";
import { SigningFieldEditor } from "./signing-field-editor";

type AgreementReview = Pick<
  FunctionReturnType<typeof api.signing.get>,
  "agreement" | "approval" | "decision" | "approvalCurrent" | "frozenPreparation"
>;
export function SigningPreparation({
  review,
  canEdit,
}: {
  review: AgreementReview;
  canEdit: boolean;
}) {
  const { profile } = useCyphersoftAuth();
  return profile ? (
    <PreparationPanel
      key={`${profile.userId}:${review.agreement._id}`}
      review={review}
      canEdit={canEdit}
      userId={profile.userId}
    />
  ) : null;
}
function PreparationPanel({
  review,
  canEdit,
  userId,
}: {
  review: AgreementReview;
  canEdit: boolean;
  userId: string;
}) {
  const { agreement, approval, decision, approvalCurrent, frozenPreparation } = review;
  const data = useQuery(api.signingFields.get, { agreementId: agreement._id });
  const requestApproval = useMutation(api.signing.requestApproval);
  const decideApproval = useMutation(api.signing.decideApproval);
  const returnToDraft = useMutation(api.signing.returnToDraft);
  const [reviewedHash, setReviewedHash] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"approve" | "reject" | "return" | null>(null);
  if (!data) return <Card className="p-5 text-sm">Loading field preparation and approval…</Card>;
  async function run(operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
      setReviewedHash(null);
      setConfirm(null);
      setReason("");
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "The approval operation failed. Reload and check the current status before retrying.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const reviewed = Boolean(data.preparationHash && reviewedHash === data.preparationHash);
  const selfApprovalBlocked = approval?.requestedBy === userId && !data.allowSelfApproval;
  const stages = [
    ...new Set(
      data.participants
        .filter((p) => p.responsibility === "signer" || p.responsibility === "approver")
        .map((p) => p.stage),
    ),
  ].sort((a, b) => a - b);
  return (
    <>
      <Card className="space-y-4 p-5">
        <h2 className="font-medium">Preparation progress</h2>
        <ol className="grid gap-2 text-sm sm:grid-cols-2">
          {[
            [
              "Agreement details and participants",
              data.participants.some((p) => p.responsibility === "signer"),
            ],
            ["Validated PDF and ordered annexures", !!data.bundle],
            [
              "Saved fields for every signer",
              !!data.layoutId &&
                !data.blockers.some((b) => /signature|signer|field preparation/.test(b)),
            ],
            [
              "Approved frozen preparation",
              !!frozenPreparation && approvalCurrent && decision?.decision === "approved",
            ],
          ].map(([label, done]) => (
            <li key={String(label)} className="flex items-center gap-2">
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${done ? "text-emerald-600" : "text-muted-foreground/40"}`}
              />
              <span>
                {label}
                {done ? " · ready" : " · pending"}
              </span>
            </li>
          ))}
        </ol>
        <div className="space-y-2 border-t pt-3">
          <h3 className="text-sm font-medium">Participant workflow</h3>
          {stages.map((stage) => (
            <div key={stage} className="rounded-md border p-3 text-sm">
              <p className="font-medium">
                Stage {stage}
                {data.participants.filter(
                  (p) =>
                    p.stage === stage &&
                    (p.responsibility === "signer" || p.responsibility === "approver"),
                ).length > 1 && " · parallel actions"}
              </p>
              <ul className="mt-1 text-xs text-muted-foreground">
                {data.participants
                  .filter(
                    (p) =>
                      p.stage === stage &&
                      (p.responsibility === "signer" || p.responsibility === "approver"),
                  )
                  .map((p) => (
                    <li key={p.key}>
                      {p.name} · {p.role} · {p.responsibility}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          {data.participants
            .filter((p) => p.responsibility === "viewer" || p.responsibility === "copy")
            .map((p) => (
              <p key={p.key} className="text-xs text-muted-foreground">
                {p.name} · {p.role} · {p.responsibility === "copy" ? "copy recipient" : "viewer"} ·
                no signing fields
              </p>
            ))}
          <p className="text-xs text-muted-foreground">
            People within one stage act in parallel; subsequent stages follow in order. Party roles
            describe capacity. Responsibilities determine signing, approval or read-only access.
            Internal company approval below requires an authorized administrator.
          </p>
        </div>
        <SigningFieldEditor agreementId={agreement._id} data={data} canEdit={canEdit} />
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="flex items-center gap-2 font-medium">
          <LockKeyhole className="h-4 w-4" />
          Internal approval
        </h2>
        <p className="text-sm text-muted-foreground">
          Approval binds the exact PDF, fields, participants, stage order and policy. It freezes
          preparation without sending invitations or collecting signatures.
        </p>
        {!!data.blockers.length && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {data.blockers.map((blocker, index) => (
              <li key={`${index}:${blocker}`}>{blocker}</li>
            ))}
          </ul>
        )}
        {approval && (
          <p className="text-sm">
            {decision
              ? `Decision: ${decision.decision}. ${decision.reason}`
              : "Awaiting administrator approval."}
            {!approvalCurrent &&
              " Preparation or policy changed; return to draft for fresh preparation and approval."}
          </p>
        )}
        {frozenPreparation && decision?.decision === "approved" && approvalCurrent && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
            <p className="font-medium">Preparation frozen and approved</p>
            <p className="mt-1 break-all text-xs">Reference: {frozenPreparation.preparationHash}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              External sending is still disabled until the remaining release phases and operational
              checks pass.
            </p>
          </div>
        )}
        {canEdit &&
          data.preparationHash &&
          !data.blockers.length &&
          (agreement.status === "draft" || agreement.status === "awaiting_approval") && (
            <label className="flex items-start gap-2 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={reviewed}
                disabled={busy}
                onChange={(e) => setReviewedHash(e.target.checked ? data.preparationHash : null)}
              />
              <span>
                I reviewed the current PDF and annexures, every participant's fields, signing order
                and approved terms.
              </span>
            </label>
          )}
        {canEdit && agreement.status === "draft" && (
          <Button
            disabled={busy || !reviewed || !!data.blockers.length || !data.layoutId}
            onClick={() =>
              void run(async () => {
                await requestApproval({
                  agreementId: agreement._id,
                  expectedRevision: data.revision,
                  expectedPreparationHash: data.preparationHash!,
                });
              })
            }
          >
            {busy ? "Requesting…" : "Request internal approval"}
          </Button>
        )}
        {canEdit && agreement.status === "awaiting_approval" && approval && !decision && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !reviewed || !approvalCurrent || selfApprovalBlocked}
                onClick={() => setConfirm("approve")}
              >
                Approve preparation
              </Button>
              <Button
                variant="outline"
                disabled={busy || !approvalCurrent}
                onClick={() => setConfirm("reject")}
              >
                Reject with reason
              </Button>
            </div>
            {selfApprovalBlocked && (
              <p className="text-xs text-muted-foreground">
                Another authorized administrator must approve. This company's policy does not allow
                self-approval.
              </p>
            )}
          </div>
        )}
        {canEdit &&
          (agreement.status === "awaiting_approval" || agreement.status === "ready_to_send") && (
            <Button variant="outline" disabled={busy} onClick={() => setConfirm("return")}>
              Return to draft for changes
            </Button>
          )}
        {canEdit && confirm && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm">
              {confirm === "approve"
                ? "Confirm approval of the reviewed preparation. Further changes require a fresh revision and approval."
                : confirm === "reject"
                  ? "Record why this preparation is rejected. The agreement will return to an editable draft."
                  : "Returning to draft invalidates approval and requires a new PDF bundle and field preparation."}
            </p>
            <Field
              label={
                confirm === "return" ? "Reason for returning to draft" : "Approval decision reason"
              }
              htmlFor="signing-approval-reason"
            >
              <Textarea
                id="signing-approval-reason"
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                disabled={
                  busy ||
                  !reason.trim() ||
                  (confirm === "approve" && (!reviewed || !approvalCurrent || selfApprovalBlocked))
                }
                onClick={() =>
                  void run(async () => {
                    if (confirm === "return")
                      await returnToDraft({
                        agreementId: agreement._id,
                        expectedRevision: data.revision,
                        reason,
                      });
                    else if (approval)
                      await decideApproval({
                        agreementId: agreement._id,
                        approvalId: approval._id,
                        decision: confirm === "approve" ? "approved" : "rejected",
                        reason,
                      });
                  })
                }
              >
                {busy
                  ? "Saving…"
                  : confirm === "approve"
                    ? "Confirm approval and freeze"
                    : confirm === "reject"
                      ? "Confirm rejection"
                      : "Confirm return to draft"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>
                Keep current status
              </Button>
            </div>
          </div>
        )}
        {error && <FormError message={error} />}
      </Card>
    </>
  );
}
