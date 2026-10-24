import { useContext, useRef, useState, type ReactNode } from "react";
import { Search, ListChecks, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RichOutputContext } from "./assistant-runtime-context";
import { AssistantRunContext, ShortlistContext } from "./interaction-context";
import {
  highlightedParts,
  resultIdentity,
  searchFormSchema,
  searchPrompt,
  shortlistPrompt,
  toggleShortlist,
} from "./interaction-data";
import { safeUrl, type ResultCard } from "./rich-output-data";
import type { z } from "zod";

export function AssistantInteractionProvider({ children }: { children: ReactNode }) {
  const [selections, setSelections] = useState<Record<string, ResultCard[]>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const active = useRef(new Set<string>());
  return (
    <AssistantRunContext.Provider
      value={{
        running,
        begin: (id) => {
          if (active.current.has(id)) return false;
          active.current.add(id);
          setRunning((current) => ({ ...current, [id]: true }));
          return true;
        },
        finish: (id) => {
          active.current.delete(id);
          setRunning((current) => ({ ...current, [id]: false }));
        },
      }}
    >
      <ShortlistContext.Provider
        value={{
          selections,
          toggle: (id, card) =>
            setSelections((current) => ({
              ...current,
              [id]: toggleShortlist(current[id] || [], card),
            })),
          clear: (id) => setSelections((current) => ({ ...current, [id]: [] })),
        }}
      >
        {children}
      </ShortlistContext.Provider>
    </AssistantRunContext.Provider>
  );
}

export function GuidedSearchCard(props: z.infer<typeof searchFormSchema>) {
  const { agentId, busy, followUp } = useContext(RichOutputContext);
  const [error, setError] = useState("");
  const parsed = searchFormSchema.safeParse(props);
  if (!parsed.success)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {busy
          ? "Preparing search options…"
          : "Search options are incomplete. Ask the assistant to try again."}
      </p>
    );
  const data = parsed.data;
  const documents = agentId === "okf-agent";
  return (
    <section className="space-y-3 rounded-2xl border border-primary/20 bg-card p-4 shadow-sm">
      <h3 className="flex items-center gap-2 font-semibold">
        <Search className="h-4 w-4 text-primary" />
        {data.title}
      </h3>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const form = new FormData(event.currentTarget);
          try {
            const prompt = searchPrompt(agentId, {
              query: String(form.get("query") || ""),
              location: String(form.get("location") || ""),
              category: String(form.get("category") || ""),
              documentReference: String(form.get("documentReference") || ""),
              minimum: String(form.get("minimum") || ""),
              maximum: String(form.get("maximum") || ""),
              currency: String(form.get("currency") || ""),
            });
            setError("");
            followUp(prompt);
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Check the search criteria.");
          }
        }}
      >
        <label className="block space-y-1 text-xs">
          {documents ? "What do you want to know?" : "What are you looking for?"}
          <Input
            name="query"
            defaultValue={data.query}
            required
            maxLength={2000}
            placeholder={
              documents
                ? "Find renewal dates and notice periods"
                : "Office space, desks, or a research topic"
            }
            disabled={busy}
          />
        </label>
        {documents ? (
          <label className="block space-y-1 text-xs">
            Document reference (optional)
            <Input
              name="documentReference"
              defaultValue={data.documentReference}
              maxLength={500}
              placeholder="Search all accessible documents"
              disabled={busy}
            />
          </label>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                Location
                <Input
                  name="location"
                  defaultValue={data.location}
                  maxLength={240}
                  disabled={busy}
                />
              </label>
              <label className="space-y-1 text-xs">
                Category / property type
                <Input
                  name="category"
                  defaultValue={data.category}
                  maxLength={160}
                  disabled={busy}
                />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1 text-xs">
                Min budget
                <Input name="minimum" type="number" min="0" step="any" disabled={busy} />
              </label>
              <label className="space-y-1 text-xs">
                Max budget
                <Input name="maximum" type="number" min="0" step="any" disabled={busy} />
              </label>
              <label className="space-y-1 text-xs">
                Currency
                <Input name="currency" placeholder="ZAR" maxLength={20} disabled={busy} />
              </label>
            </div>
          </>
        )}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="sm" disabled={busy}>
          Search with these criteria
        </Button>
      </form>
    </section>
  );
}

export function ShortlistToggle({ card }: { card: ResultCard }) {
  const { agentId } = useContext(RichOutputContext);
  const { selections, toggle } = useContext(ShortlistContext);
  const selected = selections[agentId] || [];
  const checked = selected.some((item) => resultIdentity(item) === resultIdentity(card));
  if (!resultIdentity(card)) return null;
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        disabled={!checked && selected.length >= 8}
        onChange={() => toggle(agentId, card)}
        className="h-4 w-4 accent-primary"
      />
      {checked ? "Shortlisted" : "Add to shortlist"}
    </label>
  );
}

export function ShortlistTray() {
  const { agentId, busy, followUp } = useContext(RichOutputContext);
  const { selections, toggle, clear } = useContext(ShortlistContext);
  const selected = selections[agentId] || [];
  if (!selected.length) return null;
  return (
    <section
      aria-label="Selected results"
      className="shrink-0 space-y-2 border-t bg-primary/5 px-5 py-3"
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <p className="flex items-center gap-2 font-medium">
          <ListChecks className="h-4 w-4" />
          Shortlist · {selected.length}/8
        </p>
        <button type="button" className="text-primary underline" onClick={() => clear(agentId)}>
          Clear shortlist
        </button>
      </div>
      <ul className="flex max-h-20 flex-wrap gap-2 overflow-auto">
        {selected.map((card) => (
          <li
            key={resultIdentity(card)}
            className="flex min-w-0 items-center gap-2 rounded-full border bg-card px-2 py-1 text-xs"
          >
            <span className="max-w-40 truncate">{card.title}</span>
            <button
              type="button"
              aria-label={`Remove ${card.title} from shortlist`}
              onClick={() => toggle(agentId, card)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || selected.length < 2}
          onClick={() => followUp(shortlistPrompt(selected, true))}
        >
          Compare selected
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => followUp(shortlistPrompt(selected, false))}
        >
          Investigate selected
        </Button>
      </div>
    </section>
  );
}

export function EvidenceContent({ card }: { card: ResultCard }) {
  const [query, setQuery] = useState("");
  const { busy, followUp } = useContext(RichOutputContext);
  const excerpt = card.evidence || card.description || "";
  const reference = resultIdentity(card);
  return (
    <div className="space-y-3">
      {reference ? (
        <p className="break-all font-mono text-xs text-muted-foreground">
          {reference}
          {card.page ? ` · Page ${card.page}` : ""}
        </p>
      ) : null}
      {excerpt ? (
        <>
          <label className="block space-y-1 text-xs">
            Find in retrieved excerpt
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={120}
              placeholder="Search a word or phrase"
            />
          </label>
          <blockquote className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border-l-2 border-primary bg-muted/40 p-4 text-sm leading-7">
            {highlightedParts(excerpt, query).map((part, index) =>
              part.match ? (
                <mark key={index} className="rounded bg-amber-200 px-0.5 text-slate-950">
                  {part.text}
                </mark>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )}
          </blockquote>
          <p className="text-xs text-muted-foreground">
            Retrieved excerpt; it may not include the complete source.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This result contains metadata only. Retrieve the source to inspect its evidence.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {safeUrl(card.url) ? (
          <a
            href={safeUrl(card.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary underline"
          >
            Open original source
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !reference}
          onClick={() =>
            followUp(
              `Retrieve the original source for this selected result and provide exact supporting excerpts with citations. Title: ${card.title}\nSource: ${reference}`,
            )
          }
        >
          Retrieve more evidence
        </Button>
      </div>
    </div>
  );
}

export function EvidenceViewer({ card }: { card: ResultCard }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs">
          View evidence
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{card.title}</DialogTitle>
          <DialogDescription>Inspect the retrieved text and its original source.</DialogDescription>
        </DialogHeader>
        <EvidenceContent card={card} />
      </DialogContent>
    </Dialog>
  );
}
