import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";
import { portfolioError } from "./portfolio-error";

type Props = { tenantId: Id<"tenants">; canEdit: boolean };
export function SigningReporting(props: Props) {
  const { profile } = useCyphersoftAuth();
  return profile ? <CompanyTools key={`${profile.userId}:${props.tenantId}`} {...props} /> : null;
}
async function saveVolume(
  volume: { url: string; sha256: string; part: number; sizeBytes: number },
  signal: AbortSignal,
) {
  const response = await fetch(volume.url, {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
  });
  if (!response.ok || !response.body) throw new Error("Download failed");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > volume.sizeBytes || length > 55 * 1024 * 1024)
        throw new Error("Invalid export size");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== volume.sha256 || length !== volume.sizeBytes || signal.aborted)
    throw new Error("Export integrity check failed");
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `company-handover-${volume.part}.zip`;
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
function CompanyTools({ tenantId, canEdit }: Props) {
  const catalog = useQuery(api.signingPortfolio.catalog, { tenantId }),
    exports = useQuery(api.signingExports.list, { tenantId });
  const addParty = useMutation(api.signingPortfolio.addParty),
    addUnit = useMutation(api.signingPortfolio.addUnit),
    request = useMutation(api.signingExports.request),
    reconcile = useMutation(api.signingExports.reconcile);
  const runReport = useAction(api.signingReports.run),
    download = useAction(api.signingExports.download);
  const [kind, setKind] = useState<"owner" | "renter">("owner"),
    [name, setName] = useState(""),
    [reference, setReference] = useState("");
  const [property, setProperty] = useState(""),
    [unit, setUnit] = useState(""),
    [reason, setReason] = useState("");
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<FunctionReturnType<typeof api.signingReports.run> | null>(
    null,
  );
  const [volumes, setVolumes] = useState<FunctionReturnType<typeof api.signingExports.download>>(
    [],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [canEdit]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(portfolioError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Portfolio relationships</h2>
        <p className="text-sm">
          Owners and renters are explicit company-scoped records. Manage units here, then link them
          to participants in an agreement draft or reviewed legacy application.
        </p>
        {canEdit && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Party type" htmlFor="party-kind">
                <NativeSelect
                  id="party-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                >
                  <option value="owner">Owner</option>
                  <option value="renter">Renter</option>
                </NativeSelect>
              </Field>
              <Field label="Name" htmlFor="party-name">
                <Input
                  id="party-name"
                  dictation={false}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Stable company reference" htmlFor="party-reference">
                <Input
                  id="party-reference"
                  dictation={false}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            </div>
            <Button
              disabled={busy || !name.trim() || !reference.trim()}
              onClick={() =>
                void run(async () => {
                  await addParty({ tenantId, kind, name, reference });
                  setName("");
                  setReference("");
                })
              }
            >
              Add party
            </Button>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Property" htmlFor="unit-property">
                <NativeSelect
                  id="unit-property"
                  value={property}
                  onChange={(e) => setProperty(e.target.value)}
                >
                  <option value="">Select property</option>
                  {catalog?.properties.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Unit name/reference" htmlFor="unit-name">
                <Input
                  id="unit-name"
                  dictation={false}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </Field>
            </div>
            <Button
              disabled={busy || !property || !unit.trim()}
              onClick={() =>
                void run(async () => {
                  await addUnit({ propertyId: property as Id<"properties">, name: unit });
                  setUnit("");
                })
              }
            >
              Add unit
            </Button>
          </>
        )}
        <p className="text-sm">
          {catalog?.parties.length ?? 0} parties · {catalog?.units.length ?? 0} units
          {catalog?.truncated ? " (loaded selectors limited to 500)" : ""}
        </p>
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Signing reports</h2>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Agreements created from" htmlFor="report-from">
            <Input
              id="report-from"
              disabled={busy}
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setReport(null);
              }}
            />
          </Field>
          <Field label="Through" htmlFor="report-to">
            <Input
              id="report-to"
              disabled={busy}
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setReport(null);
              }}
            />
          </Field>
          <Button
            disabled={busy || !from || !to}
            onClick={() =>
              void run(async () => {
                setReport(
                  await runReport({
                    tenantId,
                    from: Date.parse(`${from}T00:00:00+02:00`),
                    to: Date.parse(`${to}T23:59:59.999+02:00`),
                  }),
                );
              })
            }
          >
            Generate report
          </Button>
        </div>
        {report && (
          <>
            <p className="text-xs text-muted-foreground">
              {report.cohort}. Dates use South African time. Generated{" "}
              {new Date(report.generatedAt).toLocaleString()}.
            </p>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(
                [
                  ["Agreements", report.agreements],
                  ["Completed", report.completed],
                  ["Outstanding required participants", report.outstanding],
                  ["Mailbox verified", report.verified],
                  ["Provider accepted messages", report.providerAccepted],
                  ["Delivered messages", report.delivered],
                  ["Failed messages", report.failed],
                  ["Unresolved deliveries", report.unresolved],
                  [
                    "Median issue-to-completion",
                    report.medianTurnaroundMs === null
                      ? "No completed transactions"
                      : `${(report.medianTurnaroundMs / 3600000).toFixed(1)} hours`,
                  ],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs">
              Provider acceptance and delivery do not imply document review or signing. Delivery
              counts include OTP and reminder messages.
            </p>
          </>
        )}
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Company departure handover</h2>
        <p className="text-sm">
          Private JSON/CSV records, completed PDFs, retained evidence and available validated
          originals/supporting documents, with SHA-256 manifests. Export does not delete records or
          lift legal holds.
        </p>
        {canEdit && (
          <>
            <Field label="Export reason/reference" htmlFor="export-reason">
              <Input
                id="export-reason"
                dictation={false}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button
              disabled={busy || !reason.trim()}
              onClick={() =>
                void run(async () => {
                  await request({ tenantId, requestId: requestId.current, reason });
                  requestId.current = crypto.randomUUID();
                  setReason("");
                })
              }
            >
              Request private handover
            </Button>
          </>
        )}
        {exports?.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"
          >
            <span>
              {new Date(item.createdAt).toLocaleString()} · {item.status}
              {item.error ? ` · ${item.error}` : ""}
            </span>
            {canEdit && item.status === "ready" && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => setVolumes(await download({ exportId: item.id })))
                }
              >
                Get verified volume downloads
              </Button>
            )}
            {canEdit && ["running", "unknown"].includes(item.status) && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void run(() => reconcile({ exportId: item.id }))}
              >
                Check existing export
              </Button>
            )}
          </div>
        ))}
        {canEdit &&
          volumes.map((volume) => (
            <Button
              key={volume.part}
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  controller.current?.abort();
                  controller.current = new AbortController();
                  await saveVolume(volume, controller.current.signal);
                })
              }
            >
              Verify and save volume {volume.part} ({(volume.sizeBytes / 1048576).toFixed(1)} MB)
            </Button>
          ))}
        {!!volumes.length && (
          <p className="text-xs">
            Download links expire after 60 seconds; request fresh links if needed. Save every
            volume; the final volume contains the hash manifest.
          </p>
        )}
        {!canEdit && (
          <p className="text-sm">
            Administrator access with recent MFA is required to request or download a handover.
          </p>
        )}
      </Card>
      <FormError message={error} />
    </div>
  );
}
