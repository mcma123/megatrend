import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError } from "@/components/portfolio/form-fields";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { InPersonSession } from "./signing-in-person";

type Props = { agreementId: Id<"signingAgreements">; canEdit: boolean };
// Participant outcomes come from immutable submissions; a correction request pauses, it does not sign.
const OUTCOME_LABELS = {
  sign: "Signed",
  approve: "Approved",
  decline: "Declined",
  correction_request: "Requested correction",
} as const;
export function SigningInvitations(props: Props) {
  const { profile } = useCyphersoftAuth();
  return profile ? (
    <InvitationLedger key={`${profile.userId}:${props.agreementId}`} {...props} />
  ) : null;
}
function InvitationLedger({ agreementId, canEdit }: Props) {
  const data = useQuery(api.signingInvitations.list, { agreementId }),
    remind = useAction(api.signingInvitations.remind),
    send = useAction(api.signingInvitations.send),
    remindAll = useAction(api.signingExceptions.remindOutstanding),
    reissue = useAction(api.signingInvitations.reissue),
    revoke = useMutation(api.signingInvitations.revoke),
    reconcile = useMutation(api.signingDeliveries.reconcile);
  const [target, setTarget] = useState<{
      id: Id<"signingInvitations">;
      version: number;
      mode: "revoke" | "reissue";
    } | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const reminderRequests = useRef(new Map<string, string>());
  // One issue identity (request ID + deadline) is reused across retries so a lost response cannot issue twice.
  const issue = useRef<{ requestId: string; expiresAt: number; days: number } | null>(null);
  const [days, setDays] = useState(14),
    [confirmed, setConfirmed] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  async function run(operation: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
      setTarget(null);
      setReason("");
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "The request failed. Check the current delivery before trying again.",
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  if (!data) return <Card className="p-5 text-sm">Loading invitations and delivery status…</Card>;
  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-medium">Invitations and secure access</h2>
      <p className="text-sm text-muted-foreground">
        Email delivery and verified access are tracked separately. Provider acceptance is not proof
        of inbox delivery, document review or signing.
      </p>
      {!data.canSend && data.releaseBlockers.length > 0 && (
        <div className="rounded-md border border-amber-500/30 p-3 text-sm" role="status">
          <p className="font-medium">External sending is blocked</p>
          <ul className="list-disc pl-5 text-xs">
            {data.releaseBlockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
      {!data.transaction ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This agreement has no issued signing invitations.
          </p>
          {canEdit && data.canSend && data.frozenPreparationId && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Release invitations</p>
              <p className="text-xs text-muted-foreground">
                Sends personal links to the first stage and viewers for the approved, frozen
                document. Terms cannot change after release; corrections need a replacement.
              </p>
              <Field label="Deadline (days from now)" htmlFor="invitation-deadline">
                <input
                  id="invitation-deadline"
                  type="number"
                  min={1}
                  max={30}
                  className="w-24 rounded border px-2 py-1 text-sm"
                  value={days}
                  onChange={(event) =>
                    setDays(Math.min(30, Math.max(1, Number(event.target.value) || 14)))
                  }
                />
              </Field>
              <label className="flex gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I confirm the participants, their order and the approved document are final.
              </label>
              <Button
                size="sm"
                disabled={busy || !confirmed}
                onClick={() =>
                  void run(async () => {
                    if (!issue.current || issue.current.days !== days)
                      issue.current = {
                        requestId: crypto.randomUUID(),
                        expiresAt: Date.now() + days * 86400_000,
                        days,
                      };
                    await send({
                      agreementId,
                      frozenId: data.frozenPreparationId!,
                      requestId: issue.current.requestId,
                      expiresAt: issue.current.expiresAt,
                    });
                    issue.current = null;
                  })
                }
              >
                Release invitations
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="break-all text-xs text-muted-foreground">
            Transaction {data.transaction.reference} · {data.transaction.status} · active stage{" "}
            {data.transaction.currentStage} · deadline{" "}
            {new Date(data.transaction.expiresAt).toLocaleString()}
          </p>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !data.canSend || !data.invitations.some((i) => i.reminderEligible)}
              onClick={() =>
                void run(async () => {
                  const result = await remindAll({
                    agreementId,
                    requestId: crypto.randomUUID().replaceAll("-", ""),
                  });
                  setNotice(
                    `${result.queued} reminder${result.queued === 1 ? "" : "s"} queued${result.skipped ? `, ${result.skipped} skipped` : ""}.`,
                  );
                })
              }
            >
              Remind all outstanding participants
            </Button>
          )}
          {notice && (
            <p role="status" className="text-xs">
              {notice}
            </p>
          )}
          <ol className="space-y-3">
            {data.invitations.map((invite) => (
              <li key={invite.id} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">
                  {invite.name} · {invite.status} · access version {invite.version}
                </p>
                <p className="text-xs text-muted-foreground">
                  {invite.verifiedAt
                    ? `Email verified ${new Date(invite.verifiedAt).toLocaleString()}`
                    : "Email not yet verified"}
                  . No document-view event is inferred from an email or page load.
                </p>
                {invite.outcomes.length > 0 && (
                  <ul
                    className="space-y-1 text-xs"
                    aria-label={`${invite.name} participant outcomes`}
                  >
                    {invite.outcomes.map((outcome) => (
                      <li key={outcome.submissionHash} className="break-words">
                        <span className="font-medium">{OUTCOME_LABELS[outcome.intent]}</span>{" "}
                        {new Date(outcome.acceptedAt).toLocaleString()} · record{" "}
                        {outcome.submissionHash.slice(0, 12)}…
                        {outcome.reason ? ` · “${outcome.reason}”` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                <ul className="space-y-2">
                  {invite.deliveries.map((delivery) => (
                    <li key={delivery.id} className="rounded border bg-muted/20 p-2 text-xs">
                      <p className="capitalize">
                        {delivery.kind} ·{" "}
                        {delivery.status === "accepted"
                          ? "Provider accepted"
                          : delivery.status === "unknown"
                            ? "Delivery unresolved"
                            : delivery.status.replaceAll("_", " ")}
                      </p>
                      {delivery.deliveredAt && (
                        <p>
                          Mail-server delivery confirmed{" "}
                          {new Date(delivery.deliveredAt).toLocaleString()}
                        </p>
                      )}
                      {delivery.bouncedAt && <p className="text-destructive">Delivery bounced</p>}
                      {delivery.complainedAt && (
                        <p className="text-destructive">Recipient complaint recorded</p>
                      )}
                      {delivery.providerObservedStatus && (
                        <p>
                          Provider lookup: {delivery.providerObservedStatus} ·{" "}
                          {new Date(delivery.providerObservedAt!).toLocaleString()}
                        </p>
                      )}
                      {delivery.error && <p className="text-destructive">{delivery.error}</p>}
                      {(delivery.bouncedAt ||
                        delivery.complainedAt ||
                        delivery.status === "rejected") && (
                        <p className="font-medium">
                          Action needed: confirm the address with the participant. Changing a
                          participant&apos;s address requires replacing the agreement.
                        </p>
                      )}
                      {delivery.status === "unknown" && (
                        <p className="font-medium">
                          Action needed: check the existing delivery before any new message; it is
                          never resent automatically.
                        </p>
                      )}
                      {canEdit &&
                        ["submitting", "running", "unknown", "accepted"].includes(
                          delivery.status,
                        ) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await reconcile({ deliveryId: delivery.id });
                              })
                            }
                          >
                            Check existing delivery
                          </Button>
                        )}
                    </li>
                  ))}
                </ul>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !data.canSend || !invite.reminderEligible}
                      onClick={() =>
                        void run(async () => {
                          const requestKey = `${invite.id}:${invite.version}`;
                          const requestId =
                            reminderRequests.current.get(requestKey) ?? crypto.randomUUID();
                          reminderRequests.current.set(requestKey, requestId);
                          await remind({ invitationId: invite.id, requestId });
                          reminderRequests.current.delete(requestKey);
                        })
                      }
                    >
                      Remind outstanding participant
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        busy || invite.status === "completed" || invite.status === "revoked"
                      }
                      onClick={() =>
                        setTarget({ id: invite.id, version: invite.version, mode: "revoke" })
                      }
                    >
                      Revoke access
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !data.canSend || invite.status === "completed"}
                      onClick={() =>
                        setTarget({ id: invite.id, version: invite.version, mode: "reissue" })
                      }
                    >
                      Reissue personal link
                    </Button>
                    {invite.status === "active" && data.canSend && (
                      <InPersonSession
                        agreementId={agreementId}
                        participantKey={invite.participantKey}
                        name={invite.name}
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      {canEdit && target && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm">
            {target.mode === "revoke"
              ? "Revoke this participant's current link and sessions?"
              : "Issue a new access version and invalidate the previous link and sessions?"}
          </p>
          <Field label="Reason" htmlFor="invitation-reason">
            <Textarea
              id="invitation-reason"
              dictation={false}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              disabled={busy || !reason.trim()}
              onClick={() =>
                void run(async () => {
                  if (target.mode === "revoke")
                    await revoke({
                      invitationId: target.id,
                      expectedVersion: target.version,
                      reason,
                    });
                  else
                    await reissue({
                      invitationId: target.id,
                      expectedVersion: target.version,
                      reason,
                    });
                })
              }
            >
              Confirm {target.mode}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setTarget(null)}>
              Keep current access
            </Button>
          </div>
        </div>
      )}
      {error && <FormError message={error} />}
      <p className="text-xs text-muted-foreground">
        Personal links, verification codes and session credentials are never displayed in the staff
        ledger.
      </p>
    </Card>
  );
}
