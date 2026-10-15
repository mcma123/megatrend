import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GripHorizontal, Loader2, Mic, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getDictationTarget, insertDictation, trackFocusedFields } from "@/lib/voice/focused-field";
import { VoiceRecorderProvider, formatElapsed, useVoiceRecorder } from "@/lib/voice/voice-recorder";
import { VoiceAssistantPanel } from "./voice-assistant-panel";

const POSITION_KEY = "cyphersoft-voice-dock:bottom";
const DEFAULT_BOTTOM = 24;

function readBottom() {
  try {
    const stored = Number(window.localStorage.getItem(POSITION_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_BOTTOM;
  } catch {
    return DEFAULT_BOTTOM;
  }
}

/**
 * Floating voice controls: a dictation mic for the last focused text field and (staff only) the
 * voice assistant. Mounted once per app shell. `data-voice-dock` keeps open dialogs from treating
 * presses here as "outside" clicks (see `components/ui/dialog.tsx`).
 */
export function VoiceDock({
  assistant = false,
  className,
}: {
  assistant?: boolean;
  className?: string;
}) {
  return (
    <VoiceRecorderProvider>
      <DockInner assistant={assistant} className={className} />
    </VoiceRecorderProvider>
  );
}

function DockInner({ assistant, className }: { assistant: boolean; className?: string }) {
  const [bottom, setBottom] = useState(DEFAULT_BOTTOM);
  const [panelOpen, setPanelOpen] = useState(false);
  const drag = useRef<{ startY: number; startBottom: number } | null>(null);

  useEffect(() => trackFocusedFields(), []);
  useEffect(() => setBottom(readBottom()), []);

  const onGripDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startBottom: bottom };
  };
  const onGripMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const next = drag.current.startBottom + (drag.current.startY - event.clientY);
    setBottom(Math.min(Math.max(next, 12), window.innerHeight - 160));
  };
  const onGripUp = () => {
    if (!drag.current) return;
    drag.current = null;
    try {
      window.localStorage.setItem(POSITION_KEY, String(Math.round(bottom)));
    } catch {
      // Position memory is a convenience only.
    }
  };

  return (
    <div
      data-voice-dock
      className={cn(
        "pointer-events-auto fixed right-4 z-[60] flex flex-col items-end gap-2 md:right-6",
        className,
      )}
      style={{ bottom: `max(${bottom}px, env(safe-area-inset-bottom))` }}
    >
      {assistant && panelOpen ? <VoiceAssistantPanel onClose={() => setPanelOpen(false)} /> : null}
      <div className="flex items-center gap-1 rounded-full border border-border bg-background/95 p-1 shadow-lg backdrop-blur">
        <button
          type="button"
          aria-label="Move voice controls"
          title="Drag to move"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          className="flex h-9 w-5 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
        >
          <GripHorizontal className="h-3.5 w-3.5 rotate-90" />
        </button>
        {assistant ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPanelOpen((open) => !open)}
            aria-label={panelOpen ? "Close voice assistant" : "Open voice assistant"}
            aria-expanded={panelOpen}
            title="Voice assistant"
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
              panelOpen
                ? "bg-primary text-primary-foreground"
                : "bg-primary/10 text-primary hover:bg-primary/20",
            )}
          >
            <Sparkles className="h-5 w-5" />
          </button>
        ) : null}
        <DictationButton />
      </div>
    </div>
  );
}

function DictationButton() {
  const { status, owner, elapsedMs, start, stop } = useVoiceRecorder();
  const recording = status === "recording" && owner === "dictation";
  const transcribing = status === "transcribing" && owner === "dictation";

  const onClick = useCallback(() => {
    if (recording) {
      stop();
      return;
    }
    if (!getDictationTarget()) {
      toast.info("Tap a text field first.");
      return;
    }
    void start("dictation", (text) => {
      if (!insertDictation(text)) toast.info("Tap a text field first.");
    });
  }, [recording, start, stop]);

  return (
    <button
      type="button"
      // Keep focus (and the caret) in the text field while pressing the mic.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={transcribing}
      aria-label={
        recording
          ? "Stop dictation"
          : transcribing
            ? "Transcribing"
            : "Dictate into the selected field"
      }
      aria-pressed={recording}
      title={recording ? "Stop and insert text" : "Dictate into the selected field"}
      className={cn(
        "relative flex h-11 items-center justify-center gap-1.5 rounded-full transition-all",
        recording
          ? "bg-destructive px-3 text-destructive-foreground"
          : "w-11 bg-muted text-foreground hover:bg-muted/70",
        transcribing && "cursor-wait opacity-80",
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
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <Mic className="h-5 w-5" />
      )}
    </button>
  );
}
