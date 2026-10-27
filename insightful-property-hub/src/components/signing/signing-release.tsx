import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";

const errorText = (err: unknown, fallback: string) =>
  err instanceof ConvexError && typeof err.data === "string" ? err.data : fallback;

/**
 * Company release record: the second key for external sending. The deployment key is set by
 * operators; recording references here never proves legal validity or service health alone.
 */
export function SigningRelease({
  tenantId,
  canEdit,
}: {
  tenantId: Id<"tenants">;
  canEdit: boolean;
}) {
  const data = useQuery(api.signingRelease.get, { tenantId });
  const record = useMutation(api.signingRelease.record),
    suspend = useMutation(api.signingRelease.suspend);
  const [open, setOpen] = useState<"record" | "suspend" | null>(null),
    [form, setForm] = useState({
      mode: "pilot" as "pilot" | "live",
      pilotRecipients: "",
      legalSignOffReference: "",
      acceptanceReference: "",
    }),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!data) return null;
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setOpen(null);
      setReason("");
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  };
  const current = data.record;
  return (
    <div className="mt-4 space-y-2 border-t pt-3 text-xs">
      <p className="font-medium">External sending release</p>
      <p className="text-muted-foreground">
        Deployment: {data.deploymentMode === "off" ? "switched off" : data.deploymentMode} ·
        Company:{" "}
        {current
          ? current.suspendedAt
            ? `suspended (${current.suspensionReason ?? "no reason"})`
            : `${current.mode} release, revision ${current.revision}`
          : "no release recorded"}
      </p>
      {current?.mode === "pilot" && !current.suspendedAt && (
        <p className="break-words text-muted-foreground">
          Pilot recipients: {current.pilotRecipients.join(", ")}
        </p>
      )}
      {data.blockers.length > 0 ? (
        <ul className="list-disc pl-5 text-muted-foreground">
          {data.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : (
        <p>All release checks pass. Pilot allowlists are checked for each agreement.</p>
      )}
      {canEdit && !open && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setForm({
                mode: current?.mode ?? "pilot",
                pilotRecipients: current?.pilotRecipients.join("\n") ?? "",
                legalSignOffReference: current?.legalSignOffReference ?? "",
                acceptanceReference: current?.acceptanceReference ?? "",
              });
              setOpen("record");
            }}
          >
            {current ? "Update release" : "Record release"}
          </Button>
          {current && !current.suspendedAt && (
            <Button size="sm" variant="outline" onClick={() => setOpen("suspend")}>
              Suspend sending
            </Button>
          )}
        </div>
      )}
      {open === "record" && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                record({
                  tenantId,
                  expectedRevision: current?.revision ?? 0,
                  mode: form.mode,
                  pilotRecipients: form.pilotRecipients
                    .split(/[\s,]+/)
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                  legalSignOffReference: form.legalSignOffReference,
                  acceptanceReference: form.acceptanceReference,
                }),
              "The release could not be recorded",
            );
          }}
        >
          <Field label="Mode" htmlFor="release-mode">
            <NativeSelect
              id="release-mode"
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value as "pilot" | "live" })}
            >
              <option value="pilot">Pilot (allowlisted recipients only)</option>
              <option value="live">Live</option>
            </NativeSelect>
          </Field>
          <Field label="Pilot recipients (emails or @domain, one per line)" htmlFor="release-pilot">
            <Textarea
              id="release-pilot"
              dictation={false}
              value={form.pilotRecipients}
              onChange={(e) => setForm({ ...form, pilotRecipients: e.target.value })}
            />
          </Field>
          <Field label="Legal sign-off reference" htmlFor="release-legal">
            <Input
              id="release-legal"
              dictation={false}
              maxLength={500}
              value={form.legalSignOffReference}
              onChange={(e) => setForm({ ...form, legalSignOffReference: e.target.value })}
            />
          </Field>
          <Field label="Operational acceptance evidence reference" htmlFor="release-acceptance">
            <Input
              id="release-acceptance"
              dictation={false}
              maxLength={500}
              value={form.acceptanceReference}
              onChange={(e) => setForm({ ...form, acceptanceReference: e.target.value })}
            />
          </Field>
          <p className="text-muted-foreground">
            Record only existing evidence. Release also requires the deployment release key, a
            complete policy and configured services.
          </p>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={busy}>
              Save release
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {open === "suspend" && (
        <div className="space-y-2">
          <Field label="Reason for suspending" htmlFor="release-suspend">
            <Textarea
              id="release-suspend"
              dictation={false}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <p className="text-muted-foreground">
            Stops new invitations, reminders and next-stage emails immediately. Participants already
            invited can still finish.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={() => void run(() => suspend({ tenantId, reason }), "Suspension failed")}
            >
              Suspend sending
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
