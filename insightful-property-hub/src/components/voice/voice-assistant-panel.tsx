import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuthToken } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { HelpCircle, Loader2, Mic, Send, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  executeVoiceActions,
  requestAssistant,
  type ActionOutcome,
} from "@/lib/voice/assistant-actions";
import { getOpenForm } from "@/lib/voice/form-registry";
import { openableVoiceForms } from "@/lib/voice/forms";
import type { VoiceTurn } from "@/lib/voice/types";
import { formatElapsed, useVoiceRecorder } from "@/lib/voice/voice-recorder";
import { api } from "../../../../convex/_generated/api";

type Exchange = {
  id: number;
  heard: string;
  reply?: string;
  outcome?: ActionOutcome;
  error?: string;
};

const MAX_HISTORY = 12;

/** Staff voice assistant: speak a request; it navigates and fills forms for review. Never saves. */
export function VoiceAssistantPanel({ onClose }: { onClose: () => void }) {
  const { status, owner, elapsedMs, start, stop } = useVoiceRecorder();
  const token = useAuthToken();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const clients = useQuery(api.clients.list, {});
  const properties = useQuery(api.properties.list, {});
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
        properties: properties?.map((property) => ({
          value: property._id,
          label: `${property.name} · ${property.client.name}`,
        })),
      }),
    [clients, properties],
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [exchanges, thinking]);

  const send = async (transcript: string) => {
    const text = transcript.trim();
    if (!text || thinking) return;
    const id = Date.now();
    setExchanges((current) => [...current, { id, heard: text }]);
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
              }
            : null,
          availableForms,
          history,
        },
        token,
      );
      const outcome = await executeVoiceActions(response.actions, async (route, search) => {
        await navigate({ to: route, search } as never);
      });
      setExchanges((current) =>
        current.map((item) =>
          item.id === id ? { ...item, reply: response.reply, outcome } : item,
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
            Fills forms for you to review. It never saves.
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
            Try: “Create a new property called Sunset Villas in Harare with a garden and garage.”
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
