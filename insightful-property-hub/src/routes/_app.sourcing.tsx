import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Globe, Loader2, Sparkles } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, formatZAR, formatNumber, PROPERTY_TYPE_LABELS } from "@/lib/portfolio";
import { useVoiceCommands } from "@/lib/voice/command-registry";
import { useVoiceForm } from "@/lib/voice/form-registry";
import { SOURCING_TYPES, sourcingVoiceFields } from "@/lib/voice/forms";

export const Route = createFileRoute("/_app/sourcing")({
  head: () => ({
    meta: [
      { title: "Sourcing · Cyphersoft OS" },
      {
        name: "description",
        content: "Find rental properties matching your brief with live web research.",
      },
    ],
  }),
  component: SourcingPage,
});

const propTypes = SOURCING_TYPES;
const locations = [
  "Sandton / Linbro",
  "Centurion",
  "CT Airport",
  "Durban Bayhead",
  "Rosebank",
  "Midrand",
];
const STATUS_LABELS = {
  queued: "Queued",
  running: "Searching",
  completed: "Completed",
  failed: "Failed",
};
const timeLabel = (value: number) => new Date(value).toLocaleString("en-ZA");

function SourcingPage() {
  const clients = useQuery(api.clients.list, {});
  const [clientId, setClientId] = useState<Id<"tenants"> | null>(null);
  const activeClients = clients?.filter((client) => client.tenantStatus === "active");
  const tenantId = clientId ?? activeClients?.[0]?.tenantId;
  const client = activeClients?.find((item) => item.tenantId === tenantId);
  const [type, setType] = useState<(typeof propTypes)[number]>("logistics");
  const [size, setSize] = useState([10000]);
  const [location, setLocation] = useState("Sandton / Linbro");
  const [notes, setNotes] = useState("13m+ eaves preferred, ESFR sprinklers a must, yard ≥35m");
  const [briefId, setBriefId] = useState<Id<"sourcingBriefs"> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const create = useMutation(api.sourcing.create);
  const history = useQuery(api.sourcing.list, tenantId ? { tenantId } : "skip");
  const recent = history?.briefs;
  const pack = useQuery(api.sourcing.get, briefId ? { briefId } : "skip");
  const searching = pack?.status === "queued" || pack?.status === "running";
  const stale =
    pack &&
    (pack.tenantId !== tenantId ||
      pack.propertyType !== type ||
      pack.sizeSqm !== size[0] ||
      pack.location !== location.trim() ||
      pack.notes !== notes.trim());

  const canGenerate =
    !submitting &&
    !(searching && !stale) &&
    Boolean(history?.canCreate) &&
    Boolean(location.trim());
  const formRef = useRef<HTMLFormElement>(null);

  useVoiceForm({
    formId: "sourcing.brief",
    title: "Property sourcing brief",
    enabled: Boolean(history?.canCreate),
    formRef,
    fields: sourcingVoiceFields({
      clients: (activeClients ?? []).map((item) => ({ value: item.tenantId, label: item.name })),
    }),
    values: { tenantId: tenantId ?? "", propertyType: type, sizeSqm: size[0], location, notes },
    setValues: (patch) => {
      if (typeof patch.tenantId === "string") {
        setClientId(patch.tenantId as Id<"tenants">);
        setBriefId(null);
        setError(null);
      }
      if (
        typeof patch.propertyType === "string" &&
        (propTypes as readonly string[]).includes(patch.propertyType)
      ) {
        setType(patch.propertyType as (typeof propTypes)[number]);
      }
      if (typeof patch.sizeSqm === "number") {
        const rounded = Math.round(patch.sizeSqm / 500) * 500;
        setSize([Math.min(25000, Math.max(500, rounded))]);
      }
      if (typeof patch.location === "string") setLocation(patch.location);
      if (typeof patch.notes === "string") setNotes(patch.notes);
    },
  });

  useVoiceCommands("sourcing", {
    "sourcing.openBrief": {
      run: ({ brief }) => {
        const match = recent?.find((item) => item._id === brief);
        if (!match) throw new Error("That brief is no longer listed.");
        openBrief(match);
        return "Showing the saved brief.";
      },
      params: [
        {
          name: "brief",
          label: "Brief",
          type: "select",
          required: true,
          options: (recent ?? []).map((item) => ({
            value: item._id,
            label: `${PROPERTY_TYPE_LABELS[item.propertyType]} · ${item.location} · ${timeLabel(item.createdAt)}`,
          })),
        },
      ],
      enabled: Boolean(recent?.length) && !submitting,
    },
  });

  async function generate() {
    if (!tenantId || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const input = {
      tenantId,
      propertyType: type,
      sizeSqm: size[0],
      location: location.trim(),
      notes: notes.trim(),
    };
    const fingerprint = JSON.stringify(input);
    // Retain the request ID after a network error so a retry cannot create duplicate searches.
    if (requestRef.current?.fingerprint !== fingerprint)
      requestRef.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const id = await create({ ...input, requestId: requestRef.current.id });
      setBriefId(id);
      requestRef.current = null;
    } catch (failure) {
      setError(errorMessage(failure, "The brief could not be saved. Try again."));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function openBrief(brief: Doc<"sourcingBriefs">) {
    setType(brief.propertyType);
    setSize([brief.sizeSqm]);
    setLocation(brief.location);
    setNotes(brief.notes);
    setBriefId(brief._id);
    setError(null);
    requestRef.current = null;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Bucket 02 · External"
        title="Brief in. Options pack out."
        description="Search rental listings with the Web Research Agent. Choose a property type, location and size, then generate a saved options pack."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="surface-elevated p-6">
          <div className="mb-6 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="font-display text-xl">New rental brief</h2>
          </div>
          <form
            ref={formRef}
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              // Same rule as the Generate button (also guards voice-confirmed submits).
              if (canGenerate) void generate();
            }}
          >
            <div>
              <Label htmlFor="sourcing-client">Client</Label>
              <select
                id="sourcing-client"
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={tenantId ?? ""}
                disabled={submitting || !activeClients?.length}
                onChange={(event) => {
                  setClientId(event.target.value as Id<"tenants">);
                  setBriefId(null);
                  setError(null);
                }}
              >
                {!activeClients?.length && (
                  <option value="">{clients ? "No active clients" : "Loading clients…"}</option>
                )}
                {activeClients?.map((item) => (
                  <option key={item.tenantId} value={item.tenantId}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <fieldset id="sourcing-type" disabled={submitting}>
              <legend className="text-sm font-medium">Property type</legend>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {propTypes.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={type === value}
                    onClick={() => setType(value)}
                    className={`h-10 rounded-md border text-sm transition-colors ${type === value ? "border-primary bg-accent text-accent-foreground" : "border-input bg-background hover:bg-accent/50"}`}
                  >
                    {PROPERTY_TYPE_LABELS[value]}
                  </button>
                ))}
              </div>
              {type === "logistics" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Includes warehouses and distribution facilities with evidence of logistics use.
                </p>
              )}
            </fieldset>
            <div>
              <Label id="sourcing-size">Target size: {formatNumber(size[0])} sqm</Label>
              <Slider
                id="sourcing-size-field"
                aria-labelledby="sourcing-size"
                value={size}
                min={500}
                max={25000}
                step={500}
                onValueChange={setSize}
                disabled={submitting}
                className="mt-3"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Size guides ranking; listing sizes and differences appear in the results.
              </p>
            </div>
            <div>
              <Label htmlFor="sourcing-location">Location</Label>
              <Input
                id="sourcing-location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                required
                maxLength={200}
                disabled={submitting}
                className="mt-1.5"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {locations.map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={submitting}
                    onClick={() => setLocation(value)}
                    className="rounded-full border border-border bg-card px-3 py-1 text-xs hover:border-primary hover:text-primary"
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="sourcing-notes">Requirements and notes</Label>
              <Textarea
                id="sourcing-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={2000}
                disabled={submitting}
                className="mt-1.5"
                rows={3}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {history && !history.canCreate && (
              <p className="text-sm text-muted-foreground">Your role can view saved searches.</p>
            )}
            <Button type="submit" className="w-full" disabled={!canGenerate}>
              {submitting || (searching && !stale) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {submitting
                ? "Saving brief…"
                : searching && !stale
                  ? "Searching listings…"
                  : "Generate options pack"}
            </Button>
          </form>
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="mb-2 text-sm font-medium">
              Recent briefs · {client?.name ?? "Choose a client"}
            </h3>
            {recent === undefined && tenantId && (
              <p className="text-sm text-muted-foreground">Loading saved briefs…</p>
            )}
            {recent?.length === 0 && (
              <p className="text-sm text-muted-foreground">No saved briefs for this client yet.</p>
            )}
            <ul className="space-y-1.5 text-sm">
              {recent?.map((brief) => (
                <li key={brief._id}>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => openBrief(brief)}
                    aria-current={brief._id === briefId ? "true" : undefined}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-accent/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">
                        {PROPERTY_TYPE_LABELS[brief.propertyType]} · {brief.location}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {timeLabel(brief.createdAt)}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {STATUS_LABELS[brief.status]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card className="surface-elevated min-h-[600px] p-6" aria-live="polite">
          {!briefId ? (
            <div className="flex min-h-[500px] flex-col items-center justify-center text-center">
              <Globe className="h-10 w-10 text-muted-foreground" />
              <h3 className="mt-6 font-display text-2xl">Awaiting brief</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Generate a pack to search for {PROPERTY_TYPE_LABELS[type].toLowerCase()} rentals, or
                reopen a saved brief.
              </p>
            </div>
          ) : pack === undefined ? (
            <p className="text-sm text-muted-foreground">Loading options pack…</p>
          ) : !pack ? (
            <p role="alert">This brief is unavailable.</p>
          ) : (
            <>
              <h3 className="font-display text-xl">
                {PROPERTY_TYPE_LABELS[pack.propertyType]} rental options · {pack.candidates.length}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {pack.location} · Target {formatNumber(pack.sizeSqm)} sqm ·{" "}
                {timeLabel(pack.createdAt)}
              </p>
              {stale && (
                <p className="mt-3 rounded-md border border-border bg-accent/50 p-3 text-sm">
                  The form has changed. This pack belongs to the saved brief above; generate again
                  to search with the new filters.
                </p>
              )}
              {searching && (
                <div role="status" className="my-8 flex items-center gap-3 text-sm">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Web Research Agent is searching and verifying listings…
                </div>
              )}
              {pack.status === "failed" && (
                <p role="alert" className="mt-4 text-sm text-destructive">
                  {pack.error}
                </p>
              )}
              {pack.status === "completed" && (
                <>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Researched {timeLabel(pack.completedAt ?? pack.createdAt)} · Match scores are AI
                    suitability assessments. Confirm current availability with the listing agent.
                  </p>
                  {pack.warnings.map((warning) => (
                    <p key={warning} className="mt-3 rounded-md border border-border p-3 text-sm">
                      {warning}
                    </p>
                  ))}
                  {!pack.candidates.length && (
                    <p className="my-8 text-sm text-muted-foreground">
                      No verified rental listings matched this type and location. Adjust the brief
                      and generate another search.
                    </p>
                  )}
                  <ul className="mt-4 space-y-3">
                    {pack.candidates.map((candidate, index) => (
                      <li
                        key={candidate._id}
                        className="rounded-lg border border-border bg-card p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className="text-xs text-muted-foreground">#{index + 1}</span>
                            <h4 className="font-display text-base font-medium">
                              <a
                                href={candidate.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-primary"
                              >
                                {candidate.name} <ExternalLink className="inline h-3.5 w-3.5" />
                              </a>
                            </h4>
                            <span className="mt-1 inline-block rounded-full bg-accent px-2 py-0.5 text-xs">
                              {PROPERTY_TYPE_LABELS[candidate.propertyType]}
                            </span>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {candidate.location}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-mono text-lg text-primary">
                              {candidate.matchScore}/100
                            </div>
                            <div className="text-[10px] text-muted-foreground">AI assessment</div>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3 text-xs">
                          <div>
                            <div className="text-muted-foreground">Size</div>
                            <div>
                              {candidate.sizeSqm === null
                                ? "Not stated"
                                : `${formatNumber(candidate.sizeSqm)} sqm`}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Rental / sqm</div>
                            <div>
                              {candidate.rentalPerSqm === null
                                ? "Not stated"
                                : formatZAR(candidate.rentalPerSqm)}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Monthly rental</div>
                            <div>
                              {candidate.monthlyRental === null
                                ? "Not stated"
                                : formatZAR(candidate.monthlyRental)}
                            </div>
                          </div>
                        </div>
                        <p className="mt-3 text-sm">{candidate.matchExplanation}</p>
                        {!!candidate.features.length && (
                          <div className="mt-3 flex flex-wrap gap-1">
                            {candidate.features.map((feature) => (
                              <span
                                key={feature}
                                className="rounded-full border border-border px-2 py-0.5 text-xs"
                              >
                                {feature}
                              </span>
                            ))}
                          </div>
                        )}
                        {!!candidate.unverifiedRequirements.length && (
                          <p className="mt-3 text-xs text-muted-foreground">
                            Not verified in the listing:{" "}
                            {candidate.unverifiedRequirements.join("; ")}
                          </p>
                        )}
                        <details className="mt-3 text-xs text-muted-foreground">
                          <summary className="cursor-pointer">Listing evidence</summary>
                          <p className="mt-2">Type: {candidate.typeEvidence}</p>
                          <p className="mt-1">Rental: {candidate.rentalEvidence}</p>
                          {candidate.logisticsUseEvidence && (
                            <p className="mt-1">Logistics use: {candidate.logisticsUseEvidence}</p>
                          )}
                        </details>
                        <a
                          href={candidate.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          View source listing <ExternalLink className="h-3 w-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
