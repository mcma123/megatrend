import { useContext, useState } from "react";
import type { Message } from "@ag-ui/core";
import type { z } from "zod";
import { Check, Circle, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichOutputContext } from "./assistant-runtime-context";
import {
  calculateScenario,
  calculatorSchema,
  choiceSchema,
  mapEmbedUrl,
  mapSchema,
  researchSteps,
  toolFailed,
} from "./advanced-interaction-data";
import { parseResult, record, safeUrl } from "./rich-output-data";

function Source({ value }: { value: string }) {
  return safeUrl(value) ? (
    <a
      href={safeUrl(value)}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-primary underline"
    >
      Source
    </a>
  ) : (
    <span className="break-all">{value}</span>
  );
}
function Pending({ noun }: { noun: string }) {
  const { busy } = useContext(RichOutputContext);
  return (
    <p role="status" className="rounded-xl border p-3 text-xs text-muted-foreground">
      {busy ? `Preparing ${noun}…` : `The ${noun} is incomplete. Ask the assistant to try again.`}
    </p>
  );
}

export function MapCard(props: z.infer<typeof mapSchema>) {
  const [selected, setSelected] = useState(0);
  const [maximum, setMaximum] = useState("");
  const [includeUnknown, setIncludeUnknown] = useState(true);
  const parsed = mapSchema.safeParse(props);
  if (!parsed.success) return <Pending noun="map" />;
  const data = parsed.data;
  const locations = data.locations
    .map((location, index) => ({ ...location, index }))
    .filter(
      (location) =>
        !maximum ||
        (location.price === undefined ? includeUnknown : location.price <= Number(maximum)),
    );
  const active = locations.find((location) => location.index === selected) || locations[0];
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
      <h3 className="flex items-center gap-2 font-semibold">
        <MapPin className="h-4 w-4 text-primary" />
        {data.title}
      </h3>
      {data.locations.some((location) => location.price !== undefined) ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="space-y-1 text-xs">
            Maximum price {data.priceUnit || ""}
            <Input
              type="number"
              min="0"
              step="any"
              value={maximum}
              onChange={(event) => setMaximum(event.target.value)}
              placeholder="No limit"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeUnknown}
              onChange={(event) => setIncludeUnknown(event.target.checked)}
            />
            Include unknown prices
          </label>
        </div>
      ) : null}
      {active ? (
        <>
          <iframe
            title={`Map location: ${active.title}`}
            src={mapEmbedUrl(active.latitude, active.longitude)}
            className="h-64 w-full rounded-xl border"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <p className="text-xs text-muted-foreground">
            Select a result to focus its marker. Map data ©{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              OpenStreetMap contributors
            </a>
            .
          </p>
          <ul className="max-h-60 space-y-2 overflow-y-auto">
            {locations.map((location) => (
              <li
                key={location.index}
                className={`rounded-lg border p-3 text-xs ${active.index === location.index ? "border-primary bg-primary/5" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => setSelected(location.index)}
                  aria-pressed={active.index === location.index}
                  className="text-left font-medium"
                >
                  {location.title}
                </button>
                <p className="mt-1">
                  {location.price === undefined
                    ? "Price unknown"
                    : `${location.price.toLocaleString()} ${data.priceUnit || ""}`}{" "}
                  · <Source value={location.source} />
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          No locations match this price filter.
        </p>
      )}
    </section>
  );
}

type Scenario = z.infer<typeof calculatorSchema>;
function ScenarioInputs({ data }: { data: Scenario }) {
  const { busy, followUp } = useContext(RichOutputContext);
  const [price, setPrice] = useState(data.purchasePrice?.value.toString() || "");
  const [rent, setRent] = useState(data.monthlyRent?.value.toString() || "");
  const [expenses, setExpenses] = useState(data.monthlyExpenses?.value.toString() || "");
  const result = calculateScenario(price, rent, expenses);
  const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["Purchase price", price, setPrice, data.purchasePrice],
            ["Monthly rent", rent, setRent, data.monthlyRent],
            ["Monthly expenses", expenses, setExpenses, data.monthlyExpenses],
          ] as const
        ).map(([label, value, setter, initial]) => (
          <div key={label} className="space-y-1">
            <label className="block space-y-1 text-xs">
              {label} ({data.currency})
              <Input
                value={value}
                type="number"
                min="0"
                max="1000000000000"
                step="any"
                onChange={(event) => setter(event.target.value)}
              />
            </label>
            <p className="text-[10px] text-muted-foreground">
              {initial && value.trim() && Number(value) === initial.value ? (
                <Source value={initial.source} />
              ) : (
                "Your assumption"
              )}
            </p>
          </div>
        ))}
      </div>
      {result ? (
        <dl
          aria-live="polite"
          className="grid grid-cols-2 gap-3 rounded-xl bg-primary/5 p-3 text-sm"
        >
          <div>
            <dt className="text-xs text-muted-foreground">Gross annual yield</dt>
            <dd className="font-semibold">{format(result.grossYield)}%</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Net annual yield</dt>
            <dd className="font-semibold">{format(result.netYield)}%</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Annual net income</dt>
            <dd className="font-semibold">
              {format(result.annualNet)} {data.currency}
            </dd>
          </div>
        </dl>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          Enter all three values and a purchase price above zero to calculate the scenario.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Annualized from monthly inputs. Financing, taxes and vacancies are excluded unless you
        include them in expenses. Edited inputs are assumptions.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !result}
        onClick={() =>
          followUp(
            `Analyze this user-adjusted scenario for ${data.title}. These inputs are assumptions, not newly verified facts: ${JSON.stringify({ currency: data.currency, purchasePrice: price, monthlyRent: rent, monthlyExpenses: expenses })}. Explain the calculation and identify missing costs without inventing them.`,
          )
        }
      >
        Discuss this scenario
      </Button>
    </>
  );
}
export function ScenarioCalculator(props: Scenario) {
  const parsed = calculatorSchema.safeParse(props);
  if (!parsed.success) return <Pending noun="calculator" />;
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
      <h3 className="font-semibold">{parsed.data.title}</h3>
      <ScenarioInputs key={JSON.stringify(parsed.data)} data={parsed.data} />
    </section>
  );
}

export function ChoiceCard({
  args,
  status,
  result,
  respond,
}: {
  args: unknown;
  status: string;
  result?: unknown;
  respond?: (result: unknown) => Promise<void>;
}) {
  const { busy } = useContext(RichOutputContext);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const parsed = choiceSchema.safeParse(args);
  if (!parsed.success) return <Pending noun="choice" />;
  const data = parsed.data;
  if (new Set(data.options.map((option) => option.id)).size !== data.options.length)
    return (
      <p role="status" className="text-xs">
        The choices contain duplicate identifiers. Stop this response and ask the assistant to
        clarify them.
      </p>
    );
  const completed = status === "complete";
  const selection = record(parseResult(result));
  const selectedLabel = data.options.find((option) => option.id === selection.choiceId)?.label;
  const answer = async (value: unknown) => {
    if (!respond || !busy || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await respond(value);
    } catch {
      setError("Could not send your selection. Try again.");
      setSubmitting(false);
    }
  };
  return (
    <section className="space-y-3 rounded-2xl border border-primary/20 bg-card p-4 shadow-sm">
      <h3 className="font-semibold">{data.title}</h3>
      <p className="text-sm">{data.question}</p>
      {completed ? (
        <p role="status" className="text-sm text-muted-foreground">
          {toolFailed(result)
            ? "This interaction was interrupted. Ask the assistant for new choices."
            : selection.cancelled
              ? "Selection cancelled."
              : selectedLabel
                ? `Selected: ${selectedLabel}`
                : "Your selection was received."}
        </p>
      ) : (
        <>
          <div className="grid gap-2">
            {data.options.map((option) => (
              <Button
                key={option.id}
                type="button"
                variant="outline"
                className="h-auto justify-start whitespace-normal p-3 text-left"
                disabled={!respond || !busy || submitting}
                onClick={() => void answer({ choiceId: option.id })}
              >
                <span>
                  <span className="block font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!respond || !busy || submitting}
            onClick={() => void answer({ cancelled: true })}
          >
            Cancel selection
          </Button>
          {!busy ? (
            <p role="status" className="text-xs text-muted-foreground">
              This interaction has stopped. Ask the assistant for new choices.
            </p>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function ResearchProgress({ messages, busy }: { messages: Message[]; busy: boolean }) {
  const steps = researchSteps(messages);
  if (!steps.length) return null;
  const done = steps.filter((step) => step.complete).length;
  return (
    <details className="mx-5 mt-3 shrink-0 rounded-xl border bg-card px-3 py-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        {steps.some((step) => step.waiting) && busy
          ? "Waiting for your choice"
          : busy
            ? "Research in progress"
            : "Research activity"}{" "}
        · {done}/{steps.length} steps returned
      </summary>
      <ol className="mt-2 max-h-40 space-y-2 overflow-y-auto">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2">
            {step.complete ? (
              <Check className="h-3 w-3 text-primary" />
            ) : busy && !step.waiting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Circle className="h-3 w-3" />
            )}
            <span>
              {step.label} ·{" "}
              {step.failed
                ? "Could not complete"
                : step.complete
                  ? "Returned"
                  : !busy
                    ? "Interrupted"
                    : step.waiting
                      ? "Your input needed"
                      : "In progress"}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
