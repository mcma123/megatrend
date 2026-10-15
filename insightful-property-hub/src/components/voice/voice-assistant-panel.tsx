import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuthToken } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { Check, HelpCircle, Loader2, Mic, Send, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  confirmPendingAction,
  executeVoiceActions,
  requestAssistant,
  type ActionOutcome,
  type PendingAction,
} from "@/lib/voice/assistant-actions";
import { getPageCommands } from "@/lib/voice/command-registry";
import { COMMAND_CATALOG } from "@/lib/voice/commands";
import { getOpenForm } from "@/lib/voice/form-registry";
import { openableVoiceForms } from "@/lib/voice/forms";
import type { VoiceRecords, VoiceTurn } from "@/lib/voice/types";
import { formatElapsed, useVoiceRecorder } from "@/lib/voice/voice-recorder";
import { api } from "../../../../convex/_generated/api";

type PendingState = {
  action: PendingAction;
  /** Page the action belongs to; confirming elsewhere is refused. */
  pathname: string;
  state: "waiting" | "running" | "done" | "failed" | "cancelled";
  message?: string;
};

type Exchange = {
  id: number;
  heard: string;
  reply?: string;
  outcome?: ActionOutcome;
  pending?: PendingState[];
  error?: string;
};

const RECORD_LIMIT = 300;

const MAX_HISTORY = 12;

/**
 * Staff voice assistant: speak a request; it navigates, filters, opens records and fills forms right
 * away. Anything that changes data waits for a Confirm tap here.
 */
export function VoiceAssistantPanel({ onClose }: { onClose: () => void }) {
  const { status, owner, elapsedMs, start, stop } = useVoiceRecorder();
  const token = useAuthToken();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const clients = useQuery(api.clients.list, {});
  const properties = useQuery(api.properties.list, {});
  const leases = useQuery(api.leases.list, {});
  const documents = useQuery(api.documents.list, {});
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [history, setHistory] = useState<VoiceTurn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const recording = status === "recording" && owner === "assistant";
  const transcribing = status === "transcribing" && owner === "assistant";
  const busy = thinking || transcribing;

  const availableForms = useMemo(
    () =>
      openableVoiceForms({
        clients: clients?.map((client) => ({ value: client.tenantId, label: client.name })),
        activeClients: clients
          ?.filter((client) => client.tenantStatus === "active")
          .map((client) => ({ value: client.tenantId, label: client.name })),
        properties: properties?.map((property) => ({
          value: property._id,
          label: `${property.name} · ${property.client.name}`,
        })),
      }),
    [clients, properties],
  );

  const records = useMemo<VoiceRecords>(
    () => ({
      clients: (clients ?? [])
        .slice(0, RECORD_LIMIT)
        .map((client) => ({ slug: client.slug, name: client.name })),
      properties: (properties ?? []).slice(0, RECORD_LIMIT).map((property) => ({
        id: property._id,
        name: property.name,
        client: property.client.name,
      })),
      leases: (leases ?? []).slice(0, RECORD_LIMIT).map((lease) => ({
        id: lease._id,
        label: lease.property?.name ?? "Lease",
        client: lease.client.name,
        endDate: lease.endDate,
        status: lease.status,
      })),
      documents: (documents ?? []).slice(0, RECORD_LIMIT).map((document) => ({
        id: document._id,
        filename: document.filename,
        client: document.client.name,
        status: document.status,
      })),
    }),
    [clients, properties, leases, documents],
  );

  const updatePending = (exchangeId: number, index: number, patch: Partial<PendingState>) =>
    setExchanges((current) =>
      current.map((item) =>
        item.id === exchangeId && item.pending
          ? {
              ...item,
              pending: item.pending.map((entry, position) =>
                position === index ? { ...entry, ...patch } : entry,
              ),
            }
          : item,
      ),
    );

  const confirm = async (exchangeId: number, index: number, entry: PendingState) => {
    if (window.location.pathname !== entry.pathname) {
      updatePending(exchangeId, index, {
        state: "failed",
        message: "You moved to another page, so this was not run. Ask again.",
      });
      return;
    }
    updatePending(exchangeId, index, { state: "running" });
    try {
      const message = await confirmPendingAction(entry.action);
      updatePending(exchangeId, index, { state: "done", message });
    } catch (error) {
      updatePending(exchangeId, index, {
        state: "failed",
        message: error instanceof Error ? error.message : "That didn't work.",
      });
    }
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [exchanges, thinking]);

  const send = async (transcript: string) => {
    const text = transcript.trim();
    if (!text || thinking) return;
    const id = Date.now();
    // A new request replaces any confirmations still waiting.
    setExchanges((current) => [
      ...current.map((item) => ({
        ...item,
        pending: item.pending?.map((entry) =>
          entry.state === "waiting" ? { ...entry, state: "cancelled" as const } : entry,
        ),
      })),
      { id, heard: text },
    ]);
    setThinking(true);
    const open = getOpenForm();
    try {
      const response = await requestAssistant(
        {
          transcript: text,
          pathname,
          openForm: open
            ? {
                formId: open.formId,
                title: open.title,
                fields: open.fields,
                values: open.getValues(),
                submittable: open.submittable,
              }
            : null,
          availableForms,
          commandCatalog: COMMAND_CATALOG,
          pageCommands: getPageCommands(),
          records,
          history,
        },
        token,
      );
      const outcome = await executeVoiceActions(response.actions, async (route, search) => {
        await navigate({ to: route, search } as never);
      });
      const pending = outcome.pending.map((action) => ({
        action,
        pathname: window.location.pathname,
        state: "waiting" as const,
      }));
      setExchanges((current) =>
        current.map((item) =>
          item.id === id ? { ...item, reply: response.reply, outcome, pending } : item,
        ),
      );
      setHistory((current) =>
        [
          ...current,
          { role: "user" as const, text },
          { role: "assistant" as const, text: response.reply },
        ].slice(-MAX_HISTORY),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "The assistant is unavailable.";
      setExchanges((current) =>
        current.map((item) => (item.id === id ? { ...item, error: message } : item)),
      );
    } finally {
      setThinking(false);
    }
  };

  const toggleRecording = () => {
    if (recording) stop();
    else void start("assistant", (text) => void send(text));
  };

  const submitDraft = (event: FormEvent) => {
    event.preventDefault();
    const text = draft;
    setDraft("");
    void send(text);
  };

  return (
    <section
      aria-label="Voice assistant"
      className="flex max-h-[min(70svh,520px)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex-1">
          <h2 className="text-sm font-medium">Voice assistant</h2>
          <p className="text-xs text-muted-foreground">
            Acts right away; anything that changes data waits for your Confirm.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close voice assistant"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div
        ref={listRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm"
        aria-live="polite"
      >
        {exchanges.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Try: “Open the DHL lease and start the renewal” or “Show documents that need review.”
          </p>
        ) : null}
        {exchanges.map((exchange) => (
          <div key={exchange.id} className="space-y-1.5">
            <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-primary/10 px-3 py-2">
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                Heard
              </span>
              {exchange.heard}
            </p>
            {exchange.error ? (
              <p className="text-xs text-destructive">{exchange.error}</p>
            ) : exchange.reply !== undefined ? (
              <div className="max-w-[95%] space-y-1.5 rounded-2xl rounded-bl-sm bg-muted px-3 py-2">
                <p>{exchange.reply}</p>
                {exchange.outcome?.filled.map((filled) => (
                  <p key={filled.title} className="text-xs text-muted-foreground">
                    Filled {filled.labels.join(", ")} on {filled.title}.
                  </p>
                ))}
                {exchange.outcome?.done.map((done) => (
                  <p key={done} className="text-xs text-muted-foreground">
                    {done}
                  </p>
                ))}
                {exchange.pending?.map((entry, index) => (
                  <div
                    key={`${entry.action.type}-${index}`}
                    className="rounded-lg border border-border bg-background px-2.5 py-2 text-xs"
                  >
                    <p className="font-medium">{entry.action.label}</p>
                    {entry.state === "waiting" ? (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => void confirm(exchange.id, index, entry)}
                          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          <Check className="h-3.5 w-3.5" /> Confirm
                        </button>
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => updatePending(exchange.id, index, { state: "cancelled" })}
                          className="rounded-md px-2.5 py-1 text-muted-foreground hover:bg-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p
                        className={cn(
                          "mt-1",
                          entry.state === "failed" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {entry.state === "running"
                          ? "Working…"
                          : entry.state === "cancelled"
                            ? "Cancelled."
                            : entry.message}
                      </p>
                    )}
                  </div>
                ))}
                {exchange.outcome?.failures.map((failure) => (
                  <p key={failure} className="text-xs text-destructive">
                    {failure}
                  </p>
                ))}
                {exchange.outcome?.questions.map((question) => (
                  <p key={question} className="flex gap-1.5 text-xs font-medium text-primary">
                    <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {question}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {thinking ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working on it…
          </p>
        ) : null}
      </div>

      <footer className="flex items-center gap-2 border-t border-border p-3">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleRecording}
          disabled={busy}
          aria-label={recording ? "Stop and send" : "Speak a request"}
          aria-pressed={recording}
          className={cn(
            "relative flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full transition-all disabled:opacity-60",
            recording
              ? "bg-destructive px-3 text-destructive-foreground"
              : "w-10 bg-primary text-primary-foreground",
          )}
        >
          {recording ? (
            <>
              <span
                className="absolute inset-0 animate-ping rounded-full bg-destructive/40"
                aria-hidden
              />
              <Square className="relative h-3.5 w-3.5 fill-current" />
              <span className="relative font-mono text-xs tabular-nums">
                {formatElapsed(elapsedMs)}
              </span>
            </>
          ) : transcribing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </button>
        <form onSubmit={submitDraft} className="flex flex-1 items-center gap-1">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={recording ? "Listening…" : "Or type a request"}
            aria-label="Type a request"
            data-no-dictation
            disabled={busy}
            className="h-10 w-full min-w-0 rounded-full border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </footer>
    </section>
  );
}
