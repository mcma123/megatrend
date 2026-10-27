import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError } from "@/components/portfolio/form-fields";
import { useCyphersoftAuth } from "@/lib/auth-session";

type Props = {
  agreementId: Id<"signingAgreements">;
  canEdit: boolean;
  onOpenAgreement?: (id: Id<"signingAgreements">) => void;
};
type Mode = "void" | "extend" | "resume" | "replace" | "hold" | "release-hold";
const COPY: Record<Mode, { title: string; detail: string; confirm: string }> = {
  void: {
    title: "Cancel this agreement",
    detail:
      "Revokes every unfinished invitation and session. Accepted signatures and evidence are kept.",
    confirm: "Cancel agreement",
  },
  extend: {
    title: "Extend the signing deadline",
    detail: "Applies to every unfinished invitation. At most 30 days from today.",
    confirm: "Extend deadline",
  },
  resume: {
    title: "Resume without changes",
    detail: "Use only when the correction request needs no document change.",
    confirm: "Resume signing",
  },
  replace: {
    title: "Replace with a corrected draft",
    detail:
      "Creates a new editable draft with the same terms and participants. An open agreement becomes Superseded and access is revoked; history is preserved.",
    confirm: "Create replacement draft",
  },
  hold: {
    title: "Place a legal hold",
    detail: "Prevents retention purging of this agreement's transient data until released.",
    confirm: "Place hold",
  },
  "release-hold": {
    title: "Release the legal hold",
    detail: "Retention schedules apply again after release.",
    confirm: "Release hold",
  },
};

export function SigningExceptions(props: Props) {
  const { profile } = useCyphersoftAuth();
  return profile ? (
    <ExceptionsCard key={`${profile.userId}:${props.agreementId}`} {...props} />
  ) : null;
}
function ExceptionsCard({ agreementId, canEdit, onOpenAgreement }: Props) {
  const data = useQuery(api.signingExceptions.status, { agreementId });
  const voidIssued = useMutation(api.signingExceptions.voidIssued),
    extend = useMutation(api.signingExceptions.extendDeadline),
    resume = useMutation(api.signingExceptions.resumeAfterCorrection),
    replace = useMutation(api.signingExceptions.replace),
    resumeStage = useMutation(api.signingExceptions.resumeStage),
    placeHold = useMutation(api.signingExceptions.placeHold),
    releaseHold = useMutation(api.signingExceptions.releaseHold);
  const [mode, setMode] = useState<Mode | null>(null),
    [reason, setReason] = useState(""),
    [days, setDays] = useState(7),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!data) return null;
  const activeHold = data.holds.find((hold) => hold.releasedAt === null);
  const actions: [Mode, boolean][] = [
    ["extend", data.canExtend],
    ["resume", data.canResume],
    ["replace", data.canReplace],
    ["void", data.canVoid],
    ["hold", !activeHold],
    ["release-hold", Boolean(activeHold)],
  ];
  const visible = actions.filter(([, allowed]) => allowed);
  if (
    !visible.length &&
    !data.replacesAgreementId &&
    !data.replacedByAgreementId &&
    !data.holds.length
  )
    return null;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "void") await voidIssued({ agreementId, reason });
      if (mode === "extend")
        await extend({ agreementId, reason, expiresAt: Date.now() + days * 86400_000 });
      if (mode === "resume") await resumeAfterCorrection();
      if (mode === "replace") {
        const replacement = await replace({ agreementId, reason });
        onOpenAgreement?.(replacement);
      }
      if (mode === "hold") await placeHold({ agreementId, reason });
      if (mode === "release-hold" && activeHold)
        await releaseHold({ holdId: activeHold.id, reason });
      setMode(null);
      setReason("");
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "The action could not be completed",
      );
    } finally {
      setBusy(false);
    }
  };
  const resumeAfterCorrection = () => resume({ agreementId, reason });
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-medium">Exceptions and records</h2>
      {data.transaction && (
        <p className="text-xs text-muted-foreground">
          Transaction {data.transaction.status} · stage {data.transaction.currentStage} · deadline{" "}
          {new Date(data.transaction.expiresAt).toLocaleString()}
          {data.transaction.status === "paused" && " · paused for a correction request"}
        </p>
      )}
      {data.replacesAgreementId && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => onOpenAgreement?.(data.replacesAgreementId!)}
        >
          Replaces an earlier agreement
        </Button>
      )}
      {data.replacedByAgreementId && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => onOpenAgreement?.(data.replacedByAgreementId!)}
        >
          Replaced by a newer agreement
        </Button>
      )}
      {data.holds.length > 0 && (
        <ul className="space-y-1 text-xs">
          {data.holds.map((hold) => (
            <li key={hold.id}>
              Legal hold {new Date(hold.placedAt).toLocaleDateString()}: {hold.reason}
              {hold.releasedAt
                ? ` · released ${new Date(hold.releasedAt).toLocaleDateString()} (${hold.releaseReason})`
                : " · active"}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {visible.map(([action]) => (
            <Button
              key={action}
              size="sm"
              variant={action === "void" ? "destructive" : "outline"}
              disabled={busy}
              onClick={() => {
                setMode(action);
                setReason("");
              }}
            >
              {COPY[action].confirm}
            </Button>
          ))}
          {data.canResumeStage && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await resumeStage({ agreementId });
                } catch (err) {
                  setError(
                    err instanceof ConvexError && typeof err.data === "string"
                      ? err.data
                      : "The stage could not be resumed",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send held stage invitations
            </Button>
          )}
        </div>
      )}
      {canEdit && mode && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">{COPY[mode].title}</p>
          <p className="text-xs text-muted-foreground">{COPY[mode].detail}</p>
          {mode === "extend" && (
            <Field label="New deadline (days from today)" htmlFor="extend-days">
              <input
                id="extend-days"
                type="number"
                min={1}
                max={30}
                className="w-24 rounded border px-2 py-1 text-sm"
                value={days}
                onChange={(event) =>
                  setDays(Math.min(30, Math.max(1, Number(event.target.value) || 7)))
                }
              />
            </Field>
          )}
          <Field label="Reason (recorded in the audit trail)" htmlFor="exception-reason">
            <Textarea
              id="exception-reason"
              dictation={false}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "void" ? "destructive" : "default"}
              disabled={busy || !reason.trim()}
              onClick={() => void submit()}
            >
              {COPY[mode].confirm}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode(null)}>
              Keep as is
            </Button>
          </div>
        </div>
      )}
      <FormError message={error} />
    </Card>
  );
}
