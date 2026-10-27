import { useReducer, useState } from "react";
import type { Dispatch, MouseEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileText,
  FlaskConical,
  RotateCcw,
} from "lucide-react";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";
import {
  demoRecord,
  demoReducer,
  initialDemo,
  type DemoAction,
  type DemoField,
  type DemoParty,
  type DemoState,
} from "./signing-demo-state";

const steps = [
  "Prepare",
  "Place fields",
  "Approve",
  "Invitations",
  "Signer journey",
  "Finalise",
  "Portfolio",
];
const money = (value: string) =>
  `R ${Number(value || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type StepProps = { state: DemoState; dispatch: Dispatch<DemoAction> };

export function SigningDemo() {
  const { profile } = useCyphersoftAuth();
  return profile && (profile.isStaff || profile.isPlatformAdmin) ? (
    <DemoWalkthrough key={profile.userId} />
  ) : null;
}
function DemoWalkthrough() {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemo);
  const [reviewed, setReviewed] = useState(false);
  const [placing, setPlacing] = useState<{ party: DemoParty; kind: DemoField["kind"] } | null>(
    null,
  );
  const [party, setParty] = useState<DemoParty>("renter");
  const [kind, setKind] = useState<DemoField["kind"]>("signature");
  const [selected, setSelected] = useState<number | null>(null);
  const selectedField = state.fields.find((f) => f.id === selected);
  function reset() {
    dispatch({ type: "reset" });
    setReviewed(false);
    setPlacing(null);
    setSelected(null);
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(demoRecord(state), null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "DEMO-signing-walkthrough.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="space-y-5">
      <style>{`@media print { body * { visibility: hidden; } #signing-demo-document, #signing-demo-document * { visibility: visible; } #signing-demo-document { position: absolute !important; left: 0; top: 0; width: 100% !important; box-shadow: none !important; } #signing-demo-document button { border: 1px solid #aaa; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm text-primary">
            <FlaskConical className="h-4 w-4" /> Client demonstration
          </div>
          <h1 className="font-display text-2xl font-semibold">Agreement signing walkthrough</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A complete sample journey, ready to present. No setup required.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={reset}>
            <RotateCcw />
            Restart demo
          </Button>
          <Button asChild variant="ghost">
            <a href="/agreements">
              <ArrowLeft />
              Exit demo
            </a>
          </Button>
        </div>
      </div>
      <Card className="flex gap-3 border-primary/30 bg-primary/5 p-4">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold">Demo mode — sample data only</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Invitations, verification, signatures and payments are simulated. No email is sent and
            no real agreements or portfolio records are changed. Restart or leave this page to clear
            the walkthrough.
          </p>
        </div>
      </Card>
      <ol
        className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7"
        aria-label="Demo progress"
      >
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={state.step === index ? "step" : undefined}
            className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-xs ${state.step === index ? "border-primary bg-primary/10 font-semibold text-primary" : state.step > index ? "border-primary/20 text-foreground" : "text-muted-foreground"}`}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
              {state.step > index ? <Check className="h-3 w-3" /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(290px,360px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{steps[state.step]}</h2>
              <Badge variant="secondary">Demo</Badge>
            </div>
            {state.step === 0 && (
              <>
                <p className="text-sm text-muted-foreground">
                  Use these ready-made details or personalise them for your presentation.
                </p>
                {(
                  [
                    ["title", "Agreement title"],
                    ["company", "Company"],
                    ["property", "Property"],
                    ["unit", "Unit"],
                    ["rent", "Monthly rent (ZAR)"],
                    ["deposit", "Deposit (ZAR)"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label} htmlFor={`demo-${key}`}>
                    <Input
                      id={`demo-${key}`}
                      dictation={false}
                      maxLength={key === "rent" || key === "deposit" ? 12 : 160}
                      value={state[key]}
                      onChange={(e) =>
                        dispatch({ type: "edit", values: { [key]: e.target.value } })
                      }
                    />
                  </Field>
                ))}
                {(["renter", "owner"] as const).map((p) => (
                  <fieldset key={p} className="space-y-2 rounded-lg border p-3">
                    <legend className="px-1 text-xs font-medium capitalize">
                      {p} · stage {p === "renter" ? 1 : 2}
                    </legend>
                    <Field label="Name" htmlFor={`demo-${p}-name`}>
                      <Input
                        id={`demo-${p}-name`}
                        dictation={false}
                        maxLength={160}
                        value={state.parties[p].name}
                        onChange={(e) =>
                          dispatch({
                            type: "party",
                            party: p,
                            name: e.target.value,
                            email: state.parties[p].email,
                          })
                        }
                      />
                    </Field>
                    <Field label="Sample email (no mail will be sent)" htmlFor={`demo-${p}-email`}>
                      <Input
                        id={`demo-${p}-email`}
                        dictation={false}
                        type="email"
                        maxLength={254}
                        value={state.parties[p].email}
                        onChange={(e) =>
                          dispatch({
                            type: "party",
                            party: p,
                            name: state.parties[p].name,
                            email: e.target.value,
                          })
                        }
                      />
                    </Field>
                  </fieldset>
                ))}
                <div className="flex gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                  <FileText className="h-5 w-5 shrink-0" />
                  <div>
                    {state.document}
                    <p className="mt-1 text-xs text-muted-foreground">
                      A built-in sample document is ready; no upload is needed.
                    </p>
                  </div>
                </div>
                <Button className="w-full" onClick={() => dispatch({ type: "prepare" })}>
                  Prepare sample agreement
                  <ArrowRight />
                </Button>
              </>
            )}
            {state.step === 1 && (
              <>
                <p className="text-sm text-muted-foreground">
                  Place fields on the sample page. The sample layout gives both parties a signature
                  and date field.
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    dispatch({ type: "sample_fields" });
                    setSelected(null);
                    setPlacing(null);
                  }}
                >
                  Use sample field layout
                </Button>
                <Field label="Assign field to" htmlFor="demo-field-party">
                  <NativeSelect
                    id="demo-field-party"
                    value={party}
                    onChange={(e) => setParty(e.target.value as DemoParty)}
                  >
                    <option value="renter">Renter — {state.parties.renter.name}</option>
                    <option value="owner">Owner — {state.parties.owner.name}</option>
                  </NativeSelect>
                </Field>
                <Field label="Field type" htmlFor="demo-field-kind">
                  <NativeSelect
                    id="demo-field-kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as DemoField["kind"])}
                  >
                    <option value="signature">Signature</option>
                    <option value="initials">Initials</option>
                    <option value="text">Text</option>
                    <option value="date">Date</option>
                  </NativeSelect>
                </Field>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={state.fields.length >= 20}
                  onClick={() => {
                    setSelected(null);
                    setPlacing({ party, kind });
                  }}
                >
                  Add field, then click the page
                </Button>
                {placing && (
                  <p role="status" className="rounded-lg bg-primary/10 p-3 text-sm text-primary">
                    Click the sample page to place a {placing.party} {placing.kind} field.
                  </p>
                )}
                {selectedField && (
                  <fieldset className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                    <legend className="px-1 text-xs">Move selected {selectedField.kind} (%)</legend>
                    {(["x", "y"] as const).map((axis) => (
                      <Field key={axis} label={axis.toUpperCase()} htmlFor={`demo-field-${axis}`}>
                        <Input
                          id={`demo-field-${axis}`}
                          type="number"
                          min={axis === "x" ? 2 : 4}
                          max={axis === "x" ? 69 : 92}
                          value={selectedField[axis]}
                          onChange={(e) =>
                            dispatch({
                              type: "move",
                              id: selectedField.id,
                              x: axis === "x" ? Number(e.target.value) : selectedField.x,
                              y: axis === "y" ? Number(e.target.value) : selectedField.y,
                            })
                          }
                        />
                      </Field>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="col-span-2"
                      onClick={() => {
                        dispatch({ type: "remove", id: selectedField.id });
                        setSelected(null);
                      }}
                    >
                      Remove selected field
                    </Button>
                  </fieldset>
                )}
                <p className="text-xs text-muted-foreground">
                  {state.fields.length} fields placed. Select a field, then click elsewhere to move
                  it; arrow keys also move a selected field.
                </p>
                <Button
                  className="w-full"
                  onClick={() => {
                    setPlacing(null);
                    setSelected(null);
                    dispatch({ type: "review" });
                  }}
                >
                  Review preparation
                  <ArrowRight />
                </Button>
              </>
            )}
            {state.step === 2 && (
              <>
                <p className="text-sm text-muted-foreground">
                  An internal reviewer checks the document, terms, field assignments and signing
                  order before invitations.
                </p>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Agreement</dt>
                    <dd className="font-medium">{state.title}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Unit</dt>
                    <dd>
                      {state.property} · {state.unit}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Rent / deposit</dt>
                    <dd>
                      {money(state.rent)} / {money(state.deposit)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Signing order</dt>
                    <dd>
                      1. {state.parties.renter.name}
                      <br />
                      2. {state.parties.owner.name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Prepared fields</dt>
                    <dd>{state.fields.length}</dd>
                  </div>
                </dl>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I have reviewed this sample agreement and its field assignments.
                </label>
                <Button
                  className="w-full"
                  disabled={!reviewed}
                  onClick={() => dispatch({ type: "approve", reviewed })}
                >
                  Approve and simulate invitations
                  <ArrowRight />
                </Button>
              </>
            )}
            {state.step === 3 && (
              <>
                <p className="text-sm text-muted-foreground">
                  {state.declined
                    ? "The sample agreement was declined. Restart to demonstrate another outcome."
                    : "Open the participant's view to demonstrate their private invitation, verification and signing journey."}
                </p>
                {(["renter", "owner"] as const).map((p) => {
                  const signed = !!state.signatures[p],
                    waiting = p === "owner" && !state.signatures.renter;
                  return (
                    <div key={p} className="space-y-2 rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{state.parties[p].name}</span>
                        <Badge variant="outline">
                          {state.declined
                            ? "Declined"
                            : signed
                              ? "Demo signed"
                              : waiting
                                ? "Next stage"
                                : "Demo delivered"}
                        </Badge>
                      </div>
                      <p className="break-all text-xs text-muted-foreground">
                        {state.parties[p].email} · {p}
                      </p>
                      {!signed && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          disabled={waiting || state.declined}
                          onClick={() => dispatch({ type: "open_signer", party: p })}
                        >
                          Open {p} demo journey
                          <ArrowRight />
                        </Button>
                      )}
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">
                  Invitations stay inside this demonstration; these addresses are never contacted.
                </p>
              </>
            )}
            {state.step === 4 && (
              <SignerJourney key={state.activeParty} state={state} dispatch={dispatch} />
            )}
            {state.step === 5 && (
              <>
                <CheckCircle2 className="h-9 w-9 text-primary" />
                <h3 className="font-medium">Both participants have finished</h3>
                <p className="text-sm text-muted-foreground">
                  The live workflow now finalises the document, retains the evidence and makes the
                  completed copy available. Preview that outcome here.
                </p>
                <ul className="space-y-2 text-sm">
                  <li>✓ Sample participant signatures collected</li>
                  <li>✓ Consent and activity recorded in this demo</li>
                  <li>→ Completed copy and handover</li>
                </ul>
                <Button className="w-full" onClick={() => dispatch({ type: "complete" })}>
                  Simulate finalisation
                  <ArrowRight />
                </Button>
              </>
            )}
            {state.step === 6 && (
              <>
                <div className="flex items-center gap-2 text-primary">
                  <CheckCircle2 />
                  <h3 className="font-semibold">Demo completed</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  The next step is a reviewed portfolio handover. Each operational decision remains
                  separate.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["Agreement", "Demo completed"],
                    [
                      "Lease",
                      state.active
                        ? "Demo active"
                        : state.applied
                          ? "Pending activation"
                          : "Not applied",
                    ],
                    ["Deposit", state.paid ? "Demo paid" : "Outstanding"],
                    ["Occupation", state.occupation ? "Demo authorised" : "Not authorised"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-sm font-medium">{value}</p>
                    </div>
                  ))}
                </div>
                <Button
                  className="w-full"
                  disabled={state.applied}
                  onClick={() => dispatch({ type: "apply" })}
                >
                  {state.applied
                    ? "Applied to demo lease register"
                    : "Apply to demo lease register"}
                </Button>
                {state.applied && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      One sample deposit request ({money(state.deposit)}) and one move-in
                      preparation task were created.
                    </p>
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={state.paid}
                      onClick={() => dispatch({ type: "pay" })}
                    >
                      {state.paid ? "Demo deposit recorded" : "Record demo deposit payment"}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={state.active}
                      onClick={() => dispatch({ type: "activate" })}
                    >
                      {state.active ? "Demo lease activated" : "Approve demo lease activation"}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={state.occupation}
                      onClick={() => dispatch({ type: "occupy" })}
                    >
                      {state.occupation
                        ? "Demo occupation authorised"
                        : "Authorise demo occupation separately"}
                    </Button>
                  </>
                )}
                <div className="space-y-2 border-t pt-4">
                  <Button variant="secondary" className="w-full" onClick={download}>
                    Download demo activity record
                  </Button>
                  <Button variant="ghost" className="w-full" onClick={() => window.print()}>
                    Print watermarked sample
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Downloads and printouts are marked DEMO. They contain no real signature, payment
                    confirmation, platform seal or timestamp.
                  </p>
                </div>
              </>
            )}
            <FormError message={state.error} />
          </Card>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Demo activity</h3>
            <ol
              className="max-h-64 space-y-3 overflow-y-auto text-xs text-muted-foreground"
              aria-live="polite"
            >
              {state.events.map((message, index) => (
                <li key={index} className="flex gap-2">
                  <span className="font-mono text-primary">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{message}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Sample agreement preview
            </span>
            <Badge variant="outline">DEMO · 1 page</Badge>
          </div>
          <SampleDocument
            state={state}
            editable={state.step === 1}
            selected={selected}
            placing={placing}
            onSelect={setSelected}
            onPlace={(x, y) => {
              if (placing) {
                dispatch({ type: "field", field: { ...placing, x, y } });
                setPlacing(null);
              } else if (selected !== null) dispatch({ type: "move", id: selected, x, y });
            }}
            onMove={(id, x, y) => dispatch({ type: "move", id, x, y })}
          />
          {state.step === 6 && (
            <Card className="grid grid-cols-3 gap-3 p-4 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Completed demos</p>
                <p className="mt-1 text-xl font-semibold">1</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Participants finished</p>
                <p className="mt-1 text-xl font-semibold">2 / 2</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Outstanding signatures</p>
                <p className="mt-1 text-xl font-semibold">0</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function SignerJourney({ state, dispatch }: StepProps) {
  const [code, setCode] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState(state.parties[state.activeParty].name);
  const verified = state.verified.includes(state.activeParty);
  return (
    <>
      <div className="rounded-lg bg-primary/5 p-3">
        <p className="text-xs text-muted-foreground">You are presenting the signer view for</p>
        <p className="mt-1 font-semibold">{state.parties[state.activeParty].name}</p>
        <p className="break-all text-xs text-muted-foreground">
          {state.parties[state.activeParty].email}
        </p>
      </div>
      {!verified ? (
        <>
          <p className="text-sm text-muted-foreground">
            In the live workflow the participant verifies a code sent to their mailbox. For the
            demo, use the sample code below.
          </p>
          <p className="rounded-lg border border-dashed border-primary/40 p-4 text-center text-2xl font-semibold tracking-[0.3em] text-primary">
            123456
          </p>
          <Field label="Demo verification code" htmlFor="demo-code">
            <Input
              id="demo-code"
              dictation={false}
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Button
            className="w-full"
            disabled={code.length !== 6}
            onClick={() => dispatch({ type: "verify", code })}
          >
            Verify demo code
          </Button>
        </>
      ) : (
        <>
          <Badge variant="secondary">Demo mailbox verified</Badge>
          <p className="text-sm text-muted-foreground">
            Review the sample page, adopt your signature and explicitly confirm signing.
          </p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I have reviewed the sample agreement and its terms.
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I consent to electronic signing in this demonstration.
          </label>
          <Field label="Type your demo signature" htmlFor="demo-signature-name">
            <Input
              id="demo-signature-name"
              dictation={false}
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="rounded-lg border border-dashed p-4">
            <p className="text-xs text-muted-foreground">Signature preview · DEMO</p>
            <p className="mt-3 text-2xl italic" style={{ fontFamily: "cursive" }}>
              {name || "Your signature"}
            </p>
          </div>
          <Button
            className="w-full"
            disabled={!reviewed || !consent || !name.trim()}
            onClick={() => dispatch({ type: "sign", name, reviewed, consent })}
          >
            Finish demo signing
            <Check />
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "correction" })}>
              Request demo correction
            </Button>
            <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "decline" })}>
              Decline demo
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function SampleDocument({
  state,
  editable,
  selected,
  placing,
  onSelect,
  onPlace,
  onMove,
}: {
  state: DemoState;
  editable: boolean;
  selected: number | null;
  placing: unknown;
  onSelect: (id: number) => void;
  onPlace: (x: number, y: number) => void;
  onMove: (id: number, x: number, y: number) => void;
}) {
  function click(event: MouseEvent<HTMLDivElement>) {
    if (!editable) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onPlace(
      ((event.clientX - bounds.left) / bounds.width) * 100,
      ((event.clientY - bounds.top) / bounds.height) * 100,
    );
  }
  return (
    <div
      id="signing-demo-document"
      style={{ containerType: "inline-size" }}
      onClick={click}
      className={`relative isolate aspect-[595/842] w-full overflow-hidden rounded-sm border bg-white text-slate-900 shadow-sm ${editable && (placing || selected !== null) ? "cursor-crosshair" : ""}`}
    >
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
        aria-hidden="true"
      >
        <span className="-rotate-45 whitespace-nowrap text-[clamp(3rem,8vw,6rem)] font-black text-slate-100">
          DEMO — NOT SIGNED
        </span>
      </div>
      <div className="relative px-[8%] pt-[7%] text-[clamp(7px,1.9cqw,13px)] leading-relaxed">
        <div className="flex items-center justify-between border-b-2 border-teal-700 pb-[1em]">
          <span className="font-bold tracking-wider text-teal-800">CYPHERSOFT</span>
          <span className="text-[0.8em] font-semibold text-amber-700">PRESENTATION SAMPLE</span>
        </div>
        <p className="mb-[0.5em] mt-[1.5em] text-[0.8em] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Commercial property agreement
        </p>
        <h2 className="line-clamp-2 break-words text-[1.7em] font-semibold leading-tight">
          {state.title}
        </h2>
        <p className="mt-[0.8em] text-slate-500">Prepared for {state.company}</p>
        <div className="mt-[1.2em] grid grid-cols-2 gap-[1em] rounded bg-slate-50 p-[0.8em]">
          <div>
            <p className="text-[0.8em] text-slate-500">Property and unit</p>
            <p className="font-semibold">
              {state.property} · {state.unit}
            </p>
          </div>
          <div>
            <p className="text-[0.8em] text-slate-500">Monthly rent</p>
            <p className="font-semibold">{money(state.rent)}</p>
          </div>
        </div>
        <h3 className="mt-[1.2em] font-semibold">1. Parties</h3>
        <p className="mt-1">
          Owner: <strong>{state.parties.owner.name}</strong>
          <br />
          Renter: <strong>{state.parties.renter.name}</strong>
        </p>
        <h3 className="mt-[1em] font-semibold">2. Premises and payment</h3>
        <p className="mt-1">
          This sample illustrates a lease of {state.unit} at {state.property}. The example monthly
          rental is {money(state.rent)} with a deposit of {money(state.deposit)}.
        </p>
        <h3 className="mt-[1em] font-semibold">3. Review and signing</h3>
        <p className="mt-1">
          Each participant reviews the same prepared document, confirms consent and explicitly
          adopts their signature. The renter signs first, followed by the owner.
        </p>
        <p className="mt-[1.2em] rounded border border-amber-200 bg-amber-50 p-[0.8em] text-[0.85em] text-amber-900">
          DEMONSTRATION ONLY. These are illustrative sample terms. This page is not a signed
          agreement, proof of payment or authority to occupy premises.
        </p>
      </div>
      {state.fields.map((field) => {
        const signature = state.signatures[field.party];
        const value =
          field.kind === "signature"
            ? signature
            : field.kind === "initials" && signature
              ? signature
                  .split(/\s+/)
                  .map((p) => p[0])
                  .join("")
              : field.kind === "date" && signature
                ? "Demo signing date"
                : field.kind === "text" && signature
                  ? state.parties[field.party].name
                  : null;
        return (
          <button
            key={field.id}
            type="button"
            disabled={!editable}
            aria-label={`${field.party} ${field.kind} field`}
            onClick={(e) => {
              e.stopPropagation();
              if (editable) onSelect(field.id);
            }}
            onKeyDown={(e) => {
              if (!editable || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
                return;
              e.preventDefault();
              const distance = e.shiftKey ? 3 : 1;
              onMove(
                field.id,
                field.x +
                  (e.key === "ArrowLeft" ? -distance : e.key === "ArrowRight" ? distance : 0),
                field.y + (e.key === "ArrowUp" ? -distance : e.key === "ArrowDown" ? distance : 0),
              );
            }}
            style={{ left: `${field.x}%`, top: `${field.y}%`, width: "29%", minHeight: "5%" }}
            className={`absolute z-10 rounded border px-2 py-1 text-left text-[clamp(8px,1.1vw,12px)] disabled:cursor-default ${field.party === "renter" ? "border-teal-500 bg-teal-50 text-teal-900" : "border-violet-400 bg-violet-50 text-violet-900"} ${editable && selected === field.id ? "ring-2 ring-primary ring-offset-2" : ""}`}
          >
            <span className="block text-[0.72em] uppercase tracking-wide">
              {field.party} · {field.kind} · demo
            </span>
            <span
              className={`block truncate ${field.kind === "signature" && value ? "text-[1.4em] italic" : "font-medium"}`}
              style={field.kind === "signature" && value ? { fontFamily: "cursive" } : undefined}
            >
              {value || `${state.parties[field.party].name}: ${field.kind}`}
            </span>
          </button>
        );
      })}
      <p className="absolute bottom-[3%] left-[8%] right-[8%] border-t pt-2 text-center text-[clamp(7px,1vw,10px)] font-semibold text-slate-500">
        DEMO — NOT LEGALLY SIGNED · {state.step === 6 ? "SIMULATED COMPLETION" : "SAMPLE PREVIEW"} ·
        PAGE 1 OF 1
      </p>
    </div>
  );
}
