import { useEffect, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import type { ScheduleInput } from "../../../../convex/lib/signingTemplates";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";
import { useCyphersoftAuth } from "@/lib/auth-session";

const SOURCE: Record<string, string> = {
  portfolio: "Portfolio record",
  approved_lease: "Approved lease data",
  agreement: "Agreement draft",
  entered: "Entered here",
  schedule: "Schedule below",
};
const blankSchedule: ScheduleInput = {
  startDate: "",
  termMonths: 12,
  monthlyRent: "",
  escalationPercent: "0",
  deposit: "0",
  paymentDay: 1,
  vatRatePercent: "15",
  rentVatable: false,
  charges: [],
};
type Props = {
  agreementId: Id<"signingAgreements">;
  revision: number;
  fileRevision: number;
  status: string;
  canEdit: boolean;
};
export function SigningGenerate(props: Props) {
  const { profile } = useCyphersoftAuth();
  return profile ? (
    <GeneratePanel key={`${profile.userId}:${props.agreementId}`} {...props} />
  ) : null;
}
function GeneratePanel({ agreementId, revision, fileRevision, status, canEdit }: Props) {
  const available = useQuery(api.signingTemplates.available, { agreementId });
  const history = useQuery(api.signingTemplates.generations, { agreementId });
  const generate = useMutation(api.signingTemplates.generate);
  const [versionId, setVersionId] = useState<Id<"signingTemplateVersions"> | null>(null),
    [values, setValues] = useState<Record<string, string>>({}),
    [conditions, setConditions] = useState<Record<string, boolean>>({}),
    [schedule, setSchedule] = useState<ScheduleInput | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [checked, setChecked] = useState<string | null>(null);
  const request = useRef<string | null>(null);
  const inputs = { values, conditions, schedule };
  // Debounced server preview. The server re-validates everything; an invalid entry keeps the
  // last valid preview on screen with the error, so it can still be corrected.
  const convex = useConvex();
  const [preview, setPreview] = useState<FunctionReturnType<typeof api.signingTemplates.preview>>();
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    if (!versionId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      convex
        .query(api.signingTemplates.preview, {
          agreementId,
          templateVersionId: versionId,
          inputs: { values, conditions, schedule },
        })
        .then((result) => {
          if (cancelled) return;
          setPreview(result);
          setPreviewError(null);
        })
        .catch((err: unknown) => {
          if (!cancelled)
            setPreviewError(
              err instanceof ConvexError && typeof err.data === "string"
                ? err.data
                : "Check the entries above",
            );
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [convex, agreementId, versionId, values, conditions, schedule, fileRevision]);
  if (!available || !history) return null;
  if (status !== "draft" && !history.length) return null;
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-medium">Generate from a template</h2>
        <p className="text-xs text-muted-foreground">
          Builds the primary PDF from an approved template version, portfolio facts and the details
          entered here. The PDF then goes through the same quarantine, scanning and preparation as
          an uploaded file. Each generation keeps its template, clause, input and renderer versions.
        </p>
      </div>
      {status === "draft" && canEdit && (
        <>
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No approved template matches this agreement&apos;s category.
            </p>
          ) : (
            <NativeSelect
              aria-label="Approved template"
              value={versionId ?? ""}
              onChange={(e) => {
                setVersionId((e.target.value || null) as Id<"signingTemplateVersions"> | null);
                setValues({});
                setConditions({});
                setSchedule(null);
                setPreview(undefined);
                request.current = null;
              }}
            >
              <option value="">Choose an approved template…</option>
              {available.map((t) => (
                <option key={t.versionId} value={t.versionId}>
                  {t.name} (v{t.version})
                </option>
              ))}
            </NativeSelect>
          )}
          {versionId && preview && preview.fields && (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Facts used by this template</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1">Field</th>
                      <th>Value</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.requirements.map((req) => {
                      const field = preview!.fields.find((f) => `input.${f.key}` === req.key);
                      const editableFact =
                        !req.key.startsWith("schedule.") && req.key !== "agreement.generated_on";
                      return (
                        <tr key={req.key} className="border-t align-top">
                          <td className="py-1 pr-2">{req.label}</td>
                          <td className="pr-2">
                            {editableFact &&
                            (field || !req.value || values[req.key] !== undefined) ? (
                              field?.type === "multiline" ? (
                                <Textarea
                                  aria-label={req.label}
                                  dictation={false}
                                  rows={2}
                                  value={values[req.key] ?? ""}
                                  onChange={(e) =>
                                    setValues({ ...values, [req.key]: e.target.value })
                                  }
                                />
                              ) : (
                                <Input
                                  aria-label={req.label}
                                  dictation={false}
                                  type={field?.type === "date" ? "date" : "text"}
                                  placeholder={
                                    req.value ?? (field?.required ? "Required" : "Missing")
                                  }
                                  value={values[req.key] ?? ""}
                                  onChange={(e) =>
                                    setValues({ ...values, [req.key]: e.target.value })
                                  }
                                />
                              )
                            ) : (
                              <span>{req.value ?? "From the schedule"}</span>
                            )}
                            {editableFact &&
                              !field &&
                              req.value &&
                              values[req.key] === undefined && (
                                <Button
                                  size="sm"
                                  variant="link"
                                  className="h-auto p-0 text-xs"
                                  onClick={() =>
                                    setValues({ ...values, [req.key]: req.value ?? "" })
                                  }
                                >
                                  Correct for this agreement
                                </Button>
                              )}
                          </td>
                          <td className="text-muted-foreground">
                            {values[req.key]?.trim()
                              ? SOURCE.entered
                              : req.source
                                ? SOURCE[req.source]
                                : "Missing"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
              {preview.conditions.length > 0 && (
                <section className="space-y-1">
                  <h3 className="text-sm font-medium">Optional sections</h3>
                  {preview.conditions.map((c) => (
                    <label key={c.key} className="flex gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={conditions[c.key] === true}
                        onChange={(e) =>
                          setConditions({ ...conditions, [c.key]: e.target.checked })
                        }
                      />
                      {c.label}
                    </label>
                  ))}
                </section>
              )}
              <ScheduleForm
                value={schedule}
                suggested={preview.suggestedSchedule}
                onChange={setSchedule}
              />
              {preview.schedule && (
                <p className="text-xs text-muted-foreground">
                  {preview.schedule.rows.length} periods · first period{" "}
                  {preview.schedule.firstPeriodTotal} · total {preview.schedule.totalPayable} (VAT{" "}
                  {preview.schedule.totalVat}) · ends {preview.schedule.endDate}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Annexures included as currently attached:{" "}
                {preview.annexures.length ? preview.annexures.join(", ") : "none"}.
              </p>
              {preview.blockers.length > 0 && (
                <ul
                  className="list-disc rounded-md border border-amber-500/30 p-3 pl-6 text-xs"
                  role="status"
                >
                  {preview.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              <iframe
                title="Generated document preview"
                sandbox=""
                className="h-[32rem] w-full rounded-md border bg-white"
                srcDoc={preview.html}
              />
              <Button
                disabled={busy || preview.blockers.length > 0}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  request.current ??= crypto.randomUUID().replaceAll("-", "");
                  try {
                    await generate({
                      agreementId,
                      templateVersionId: versionId,
                      expectedRevision: revision,
                      expectedFileRevision: fileRevision,
                      requestId: request.current,
                      inputs,
                    });
                    request.current = null;
                  } catch (err) {
                    setError(
                      err instanceof ConvexError && typeof err.data === "string"
                        ? err.data
                        : "Generation failed",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Generate and use as the primary PDF
              </Button>
            </>
          )}
          {previewError && <FormError message={previewError} />}
        </>
      )}
      {history.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Generation history</h3>
          <ul className="space-y-1 text-xs">
            {history.map((g) => (
              <li key={g.id} className="rounded border p-2">
                {g.template} v{g.version} · {g.status}
                {g.error ? ` (${g.error.replaceAll("_", " ")})` : ""} ·{" "}
                {new Date(g.createdAt).toLocaleString()}
                {g.pdfHash && (
                  <span className="block break-all">
                    PDF SHA-256 {g.pdfHash} · {g.pageCount} pages
                  </span>
                )}
                <span className="block text-muted-foreground">
                  Inputs {g.inputHash.slice(0, 12)}… · HTML {g.htmlHash.slice(0, 12)}… ·{" "}
                  {g.rendererVersion}
                  {g.pdfRenderer ? ` · ${g.pdfRenderer}` : ""} · annexures:{" "}
                  {g.annexures.length ? g.annexures.join(", ") : "none"}
                </span>
                <ReproduceCheck
                  generationId={g.id}
                  active={checked === g.id}
                  onCheck={() => setChecked(g.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      <FormError message={error} />
    </Card>
  );
}
function ReproduceCheck({
  generationId,
  active,
  onCheck,
}: {
  generationId: Id<"signingGenerations">;
  active: boolean;
  onCheck: () => void;
}) {
  const result = useQuery(api.signingTemplates.reproduce, active ? { generationId } : "skip");
  if (!active)
    return (
      <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={onCheck}>
        Check reproducibility
      </Button>
    );
  if (!result) return <span className="block">Checking…</span>;
  return (
    <span className="block font-medium">
      {result.matches
        ? "Reproduces exactly from stored versions and inputs"
        : `Does not reproduce: ${result.reason}`}
    </span>
  );
}
function ScheduleForm({
  value,
  suggested,
  onChange,
}: {
  value: ScheduleInput | null;
  suggested: ScheduleInput | null;
  onChange: (value: ScheduleInput | null) => void;
}) {
  if (!value)
    return (
      <div className="flex flex-wrap gap-2">
        {suggested && (
          <Button size="sm" variant="outline" onClick={() => onChange(suggested)}>
            Start the schedule from the linked lease
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => onChange(blankSchedule)}>
          Enter a rent schedule
        </Button>
      </div>
    );
  const set = (patch: Partial<ScheduleInput>) => onChange({ ...value, ...patch });
  return (
    <section className="space-y-2 rounded-md border p-3">
      <h3 className="text-sm font-medium">Rent and payment schedule</h3>
      <p className="text-xs text-muted-foreground">
        Amounts are exact rand values (e.g. 12500.00). Escalation compounds annually; VAT and
        rounding are calculated in whole cents on the server.
      </p>
      <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <Field label="Start date" htmlFor="schedule-start">
          <Input
            id="schedule-start"
            type="date"
            dictation={false}
            value={value.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
          />
        </Field>
        <Field label="Term (months)" htmlFor="schedule-term">
          <Input
            id="schedule-term"
            type="number"
            min={1}
            max={120}
            dictation={false}
            value={value.termMonths}
            onChange={(e) => set({ termMonths: Number(e.target.value) || 1 })}
          />
        </Field>
        <Field label="Monthly rent (R)" htmlFor="schedule-rent">
          <Input
            id="schedule-rent"
            inputMode="decimal"
            dictation={false}
            value={value.monthlyRent}
            onChange={(e) => set({ monthlyRent: e.target.value })}
          />
        </Field>
        <Field label="Annual escalation (%)" htmlFor="schedule-escalation">
          <Input
            id="schedule-escalation"
            inputMode="decimal"
            dictation={false}
            value={value.escalationPercent}
            onChange={(e) => set({ escalationPercent: e.target.value })}
          />
        </Field>
        <Field label="Deposit (R)" htmlFor="schedule-deposit">
          <Input
            id="schedule-deposit"
            inputMode="decimal"
            dictation={false}
            value={value.deposit}
            onChange={(e) => set({ deposit: e.target.value })}
          />
        </Field>
        <Field label="Payment day (1–28)" htmlFor="schedule-day">
          <Input
            id="schedule-day"
            type="number"
            min={1}
            max={28}
            dictation={false}
            value={value.paymentDay}
            onChange={(e) => set({ paymentDay: Number(e.target.value) || 1 })}
          />
        </Field>
        <Field label="VAT rate (%)" htmlFor="schedule-vat">
          <Input
            id="schedule-vat"
            inputMode="decimal"
            dictation={false}
            value={value.vatRatePercent}
            onChange={(e) => set({ vatRatePercent: e.target.value })}
          />
        </Field>
        <label className="flex items-end gap-2 pb-2">
          <input
            type="checkbox"
            checked={value.rentVatable}
            onChange={(e) => set({ rentVatable: e.target.checked })}
          />
          VAT on rent
        </label>
      </div>
      {value.charges.map((charge, index) => (
        <div key={index} className="grid grid-cols-[2fr_1fr_auto_auto] items-center gap-2 text-xs">
          <Input
            aria-label="Charge description"
            dictation={false}
            maxLength={60}
            value={charge.label}
            onChange={(e) =>
              set({
                charges: value.charges.map((c, i) =>
                  i === index ? { ...c, label: e.target.value } : c,
                ),
              })
            }
          />
          <Input
            aria-label="Charge amount"
            inputMode="decimal"
            dictation={false}
            value={charge.amount}
            onChange={(e) =>
              set({
                charges: value.charges.map((c, i) =>
                  i === index ? { ...c, amount: e.target.value } : c,
                ),
              })
            }
          />
          <label className="flex gap-1">
            <input
              type="checkbox"
              checked={charge.vatable}
              onChange={(e) =>
                set({
                  charges: value.charges.map((c, i) =>
                    i === index ? { ...c, vatable: e.target.checked } : c,
                  ),
                })
              }
            />
            VAT
          </label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => set({ charges: value.charges.filter((_, i) => i !== index) })}
          >
            Remove
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        {value.charges.length < 10 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              set({ charges: [...value.charges, { label: "", amount: "0", vatable: false }] })
            }
          >
            Add monthly charge
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Remove schedule
        </Button>
      </div>
    </section>
  );
}
