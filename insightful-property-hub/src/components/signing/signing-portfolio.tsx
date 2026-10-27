import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { portfolioError } from "./portfolio-error";
import type { FunctionArgs } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { partyContent } from "../../../../convex/lib/signing";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";

type Props = { agreementId: Id<"signingAgreements">; tenantId: Id<"tenants">; canEdit: boolean };
type Review = FunctionArgs<typeof api.signingPortfolio.preview>;
export function SigningPortfolio(props: Props) {
  const { profile } = useCyphersoftAuth();
  return profile ? (
    <LoadedPortfolio key={`${profile.userId}:${props.agreementId}`} {...props} />
  ) : null;
}
function LoadedPortfolio(props: Props) {
  const data = useQuery(api.signing.get, { agreementId: props.agreementId });
  const catalog = useQuery(api.signingPortfolio.catalog, { tenantId: props.tenantId });
  const state = useQuery(api.signingPortfolio.state, { agreementId: props.agreementId });
  if (!data || !catalog || !state) return null;
  return (
    <PortfolioForm key={data.revision._id} {...props} data={data} catalog={catalog} state={state} />
  );
}
type FormProps = Props & {
  data: NonNullable<ReturnType<typeof useQuery<typeof api.signing.get>>>;
  catalog: NonNullable<ReturnType<typeof useQuery<typeof api.signingPortfolio.catalog>>>;
  state: NonNullable<ReturnType<typeof useQuery<typeof api.signingPortfolio.state>>>;
};
function PortfolioForm({ agreementId, canEdit, data, catalog, state }: FormProps) {
  const initial = data.revision.portfolioContext;
  const [unitId, setUnitId] = useState(initial?.unitId ?? ""),
    [ownerId, setOwnerId] = useState(initial?.ownerId ?? ""),
    [renterId, setRenterId] = useState(initial?.renterId ?? "");
  const [links, setLinks] = useState<Record<string, string>>(
    Object.fromEntries(initial?.participantLinks.map((p) => [p.key, p.partyId]) ?? []),
  );
  const [mode, setMode] = useState<Review["mode"]>(
    data.revision.leaseId ? (data.revision.category === "renewal" ? "renew" : "amend") : "create",
  );
  const [target, setTarget] = useState<string>(data.revision.leaseId ?? "");
  const [terms, setTerms] = useState<Review["terms"]>({
    startDate: "",
    endDate: "",
    monthlyRent: "",
    deposit: "0.00",
    escalationPercent: 0,
    noticePeriodMonths: 0,
  });
  const [payment, setPayment] = useState({ purpose: "Deposit", amount: "", dueDate: "" });
  const [payments, setPayments] = useState<Review["plan"]["payments"]>([]);
  const [moveInDueDate, setMoveIn] = useState(""),
    [renewalReminders, setRenewals] = useState(true),
    [reason, setReason] = useState("");
  const [pending, setPending] = useState<Review | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const request = useRef(crypto.randomUUID());
  const approvalRequest = useRef(crypto.randomUUID());
  const feedback = useQuery(api.signingPortfolio.reviewFeedback, pending ?? "skip");
  const preview = feedback?.preview;
  const suggestion = useQuery(api.signingPortfolio.suggestedTerms, { agreementId });
  const updateDraft = useMutation(api.signing.updateDraft),
    apply = useMutation(api.signingPortfolio.apply),
    decide = useMutation(api.signingPortfolio.decideLease),
    recordPayment = useMutation(api.signingPortfolio.recordPayment);
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
  const context = (): Review["context"] => ({
    unitId: unitId as Id<"portfolioUnits">,
    ownerId: ownerId as Id<"portfolioParties">,
    renterId: renterId as Id<"portfolioParties">,
    participantLinks: Object.entries(links)
      .filter(([, id]) => id)
      .map(([key, partyId]) => ({ key, partyId: partyId as Id<"portfolioParties"> })),
  });
  const editable = canEdit && !busy && !state.application;
  const linked = !!(unitId && ownerId && renterId);
  const frozen = !!initial && data.agreement.status !== "draft";
  return (
    <Card className="mt-5 space-y-4 p-5">
      <h3 className="font-semibold">Portfolio application</h3>
      <p className="text-sm text-muted-foreground">
        Signed, active, paid and occupation authorised are separate approvals. Applying signed terms
        never activates a lease or authorises occupation.
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt>Signed</dt>
          <dd>{state.signed ? "Completed" : "Not completed"}</dd>
        </div>
        <div>
          <dt>Lease active</dt>
          <dd>{state.active ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Payment requests</dt>
          <dd>
            {state.payments.filter((p) => p.paidAt).length} / {state.payments.length} recorded paid
          </dd>
        </div>
        <div>
          <dt>Occupation authorised</dt>
          <dd>{state.occupationAuthorised ? "Yes" : "No"}</dd>
        </div>
      </dl>
      {state.application ? (
        <>
          <p className="text-sm">
            Reviewed {state.application.mode} application · lease {state.lease?._id} · approved{" "}
            {new Date(state.application.approvedAt).toLocaleString()}
          </p>
          <p className="break-all text-xs">Review SHA-256: {state.application.reviewHash}</p>
          {state.lease?.signingApplicationId !== state.application._id && (
            <p className="text-sm">
              A later reviewed agreement now manages this lease. Open that agreement for operational
              approvals.
            </p>
          )}
          {canEdit && (
            <>
              <Field label="Separate approval reason/reference" htmlFor="portfolio-decision-reason">
                <Input
                  id="portfolio-decision-reason"
                  dictation={false}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                {state.lease?.status === "pending" &&
                  state.lease.signingApplicationId === state.application._id && (
                    <Button
                      disabled={busy || !reason.trim()}
                      onClick={() =>
                        void run(async () => {
                          await decide({
                            leaseId: state.lease!._id,
                            applicationId: state.application!._id,
                            kind: "activate",
                            reason,
                            requestId: approvalRequest.current,
                          });
                          approvalRequest.current = crypto.randomUUID();
                        })
                      }
                    >
                      Approve lease activation
                    </Button>
                  )}
                {!state.occupationAuthorised &&
                  state.lease?.signingApplicationId === state.application._id && (
                    <Button
                      variant="outline"
                      disabled={busy || !reason.trim()}
                      onClick={() =>
                        void run(async () => {
                          await decide({
                            leaseId: state.lease!._id,
                            applicationId: state.application!._id,
                            kind: "occupation",
                            reason,
                            requestId: approvalRequest.current,
                          });
                          approvalRequest.current = crypto.randomUUID();
                        })
                      }
                    >
                      Authorise occupation separately
                    </Button>
                  )}
              </div>
              {!!state.payments.length && (
                <Field
                  label="Payment evidence/reference (staff confirmation only)"
                  htmlFor="portfolio-payment-evidence"
                >
                  <Input
                    id="portfolio-payment-evidence"
                    dictation={false}
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                  />
                </Field>
              )}
            </>
          )}
          {state.payments.map((p) => (
            <div key={p._id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {p.purpose} · ZAR {(p.amountCents / 100).toFixed(2)} · due {p.dueDate} ·{" "}
                {p.paidAt ? "Recorded paid" : "Unpaid"}
              </span>
              {canEdit && !p.paidAt && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !paymentReference.trim()}
                  onClick={() =>
                    void run(() => recordPayment({ paymentId: p._id, reference: paymentReference }))
                  }
                >
                  Record payment evidence
                </Button>
              )}
            </div>
          ))}
        </>
      ) : (
        <>
          {catalog.truncated && (
            <p role="status">
              Relationship selectors are limited to 500 records; the full register is available
              through departure export.
            </p>
          )}
          <fieldset
            disabled={!editable || frozen}
            className="grid gap-3 sm:grid-cols-3"
            onChange={() => setPending(null)}
          >
            <Field label="Unit" htmlFor="portfolio-unit">
              <NativeSelect
                id="portfolio-unit"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
              >
                <option value="">Select unit</option>
                {catalog.units
                  .filter((u) => u.propertyId === data.revision.propertyId)
                  .map((u) => (
                    <option key={u._id} value={u._id}>
                      {u.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Owner" htmlFor="portfolio-owner">
              <NativeSelect
                id="portfolio-owner"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                <option value="">Select owner</option>
                {catalog.parties
                  .filter((p) => p.kind === "owner")
                  .map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Renter (separate from company)" htmlFor="portfolio-renter">
              <NativeSelect
                id="portfolio-renter"
                value={renterId}
                onChange={(e) => setRenterId(e.target.value)}
              >
                <option value="">Select renter</option>
                {catalog.parties
                  .filter((p) => p.kind === "renter")
                  .map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            {data.participants.map((p) => (
              <Field
                key={p.key}
                label={`${p.name}: represented party`}
                htmlFor={`portfolio-party-${p.key}`}
              >
                <NativeSelect
                  id={`portfolio-party-${p.key}`}
                  value={links[p.key] ?? ""}
                  onChange={(e) => setLinks({ ...links, [p.key]: e.target.value })}
                >
                  <option value="">No party representation</option>
                  {[ownerId, renterId].filter(Boolean).map((id) => (
                    <option key={id} value={id}>
                      {catalog.parties.find((party) => party._id === id)?.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ))}
          </fieldset>
          {canEdit && data.agreement.status === "draft" && (
            <Button
              disabled={!editable || !linked}
              onClick={() =>
                void run(() =>
                  updateDraft({
                    agreementId,
                    requestId: request.current,
                    expectedRevision: data.agreement.revision,
                    draft: {
                      title: data.revision.title,
                      category: data.revision.category,
                      propertyId: data.revision.propertyId,
                      leaseId: data.revision.leaseId,
                      notes: data.revision.notes,
                      signatureMethod: data.revision.signatureMethod,
                      participants: data.participants.map(partyContent),
                      portfolioContext: context(),
                    },
                  }),
                )
              }
            >
              Save relationships in draft revision
            </Button>
          )}
          {state.signed && (
            <>
              <p className="text-sm">
                Review the completed PDF and enter exact terms. Legacy relationships are recorded in
                this application; the signed evidence stays unchanged.
              </p>
              {suggestion && canEdit && (
                <Button
                  variant="outline"
                  disabled={!editable}
                  onClick={() => {
                    setTerms(suggestion.terms);
                    setPending(null);
                  }}
                >
                  Use pinned generation terms (review notice period)
                </Button>
              )}
              {suggestion && (
                <p className="break-all text-xs">
                  Suggested source: generation {suggestion.generationId} · {suggestion.inputHash}
                </p>
              )}
              <fieldset
                disabled={!editable}
                className="grid gap-3 sm:grid-cols-2"
                onChange={() => setPending(null)}
              >
                <Field label="Application" htmlFor="portfolio-mode">
                  <NativeSelect
                    id="portfolio-mode"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as Review["mode"])}
                  >
                    <option value="create">Create pending lease</option>
                    <option value="amend">Amend existing lease</option>
                    <option value="renew">Linked renewal</option>
                  </NativeSelect>
                </Field>
                {mode !== "create" && (
                  <Field label="Target/predecessor lease" htmlFor="portfolio-target">
                    <NativeSelect
                      id="portfolio-target"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Select lease</option>
                      {catalog.leases
                        .filter((l) => l.propertyId === data.revision.propertyId)
                        .map((l) => (
                          <option key={l._id} value={l._id}>
                            {l.startDate} – {l.endDate} ({l.status})
                          </option>
                        ))}
                    </NativeSelect>
                  </Field>
                )}
                {(
                  [
                    ["startDate", "Start date", "date"],
                    ["endDate", "End date", "date"],
                    ["monthlyRent", "Monthly rent (ZAR)", "text"],
                    ["deposit", "Deposit (ZAR)", "text"],
                    ["escalationPercent", "Escalation percent", "number"],
                    ["noticePeriodMonths", "Notice months", "number"],
                  ] as const
                ).map(([key, label, type]) => (
                  <Field key={key} label={label} htmlFor={`portfolio-${key}`}>
                    <Input
                      id={`portfolio-${key}`}
                      dictation={false}
                      type={type}
                      value={terms[key]}
                      onChange={(e) =>
                        setTerms({
                          ...terms,
                          [key]: type === "number" ? Number(e.target.value) : e.target.value,
                        })
                      }
                    />
                  </Field>
                ))}
                <Field label="Move-in preparation task due (optional)" htmlFor="portfolio-move-in">
                  <Input
                    id="portfolio-move-in"
                    type="date"
                    value={moveInDueDate}
                    onChange={(e) => setMoveIn(e.target.value)}
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={renewalReminders}
                    onChange={(e) => setRenewals(e.target.checked)}
                  />
                  Enable existing renewal cadence after activation
                </label>
                <Field label="Review reason/reference" htmlFor="portfolio-review-reason">
                  <Input
                    id="portfolio-review-reason"
                    dictation={false}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              </fieldset>
              {canEdit && (
                <fieldset
                  disabled={!editable}
                  onChange={() => setPending(null)}
                  className="space-y-2"
                >
                  <legend className="text-sm font-medium">
                    Approved internal payment requests
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        ["purpose", "Purpose", "text"],
                        ["amount", "Amount (ZAR)", "text"],
                        ["dueDate", "Due date", "date"],
                      ] as const
                    ).map(([key, label, type]) => (
                      <Field key={key} label={label} htmlFor={`portfolio-payment-${key}`}>
                        <Input
                          id={`portfolio-payment-${key}`}
                          dictation={false}
                          type={type}
                          value={payment[key]}
                          onChange={(e) => setPayment({ ...payment, [key]: e.target.value })}
                        />
                      </Field>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    disabled={!payment.amount || !payment.dueDate || payments.length >= 24}
                    onClick={() => {
                      setPayments([...payments, payment]);
                      setPayment({ purpose: "Deposit", amount: "", dueDate: "" });
                      setPending(null);
                    }}
                  >
                    Add request to review
                  </Button>
                  {payments.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span>
                        {p.purpose} · ZAR {p.amount} · {p.dueDate}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPayments(payments.filter((_, n) => n !== i));
                          setPending(null);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </fieldset>
              )}
              {canEdit && (
                <Button
                  variant="outline"
                  disabled={
                    !editable ||
                    !linked ||
                    !reason.trim() ||
                    !terms.startDate ||
                    !terms.endDate ||
                    !terms.monthlyRent ||
                    (mode !== "create" && !target)
                  }
                  onClick={() =>
                    setPending({
                      agreementId,
                      mode,
                      ...(mode !== "create" ? { targetLeaseId: target as Id<"leases"> } : {}),
                      context: context(),
                      terms,
                      plan: {
                        payments,
                        ...(moveInDueDate ? { moveInDueDate } : {}),
                        renewalReminders,
                      },
                      reason,
                    })
                  }
                >
                  Preview exact portfolio changes
                </Button>
              )}
              {pending && preview && (
                <div className="space-y-2 rounded border p-3">
                  <p className="font-medium">Confirm reviewed application</p>
                  <p className="text-sm">
                    {preview.provenance}. {preview.mode} · {preview.terms.startDate} –{" "}
                    {preview.terms.endDate} · ZAR {preview.terms.monthlyRent}/month ·{" "}
                    {preview.plan.payments.length} payment requests.
                  </p>
                  {preview.before && (
                    <p className="text-sm">
                      Before: {preview.before.startDate} – {preview.before.endDate} · ZAR{" "}
                      {preview.before.monthlyRental}/month · {preview.before.status}
                    </p>
                  )}
                  <p className="break-all text-xs">Review SHA-256: {preview.reviewHash}</p>
                  {canEdit && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          apply({ ...pending, expectedReviewHash: preview.reviewHash }),
                        )
                      }
                    >
                      Confirm application and approved downstream work
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Administrator access with recent MFA is required for changes. Unsaved input is preserved.
        </p>
      )}
      <FormError message={error ?? feedback?.error ?? null} />
    </Card>
  );
}
