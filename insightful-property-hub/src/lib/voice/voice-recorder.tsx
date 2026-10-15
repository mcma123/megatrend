import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import { toast } from "sonner";

// One shared microphone recorder for dictation and the voice assistant. Only one recording can be
// active: starting a new one discards the current one. Audio is uploaded to `/api/transcribe` and
// dropped from memory afterwards.

export type VoiceOwner = "dictation" | "assistant";
export type VoiceStatus = "idle" | "recording" | "transcribing";
type AudioFormat = "webm" | "m4a" | "ogg" | "aac";

const MAX_SECONDS = (() => {
  const parsed = Number(import.meta.env.VITE_VOICE_MAX_RECORDING_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 120) : 60;
})();
const MIN_DURATION_MS = 500;
const SILENCE_PEAK = 0.03;
export const DIDNT_CATCH = "Didn't catch that, try again.";

const MIME_CANDIDATES: [string, AudioFormat][] = [
  ["audio/webm;codecs=opus", "webm"],
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["audio/ogg;codecs=opus", "ogg"],
  ["audio/aac", "aac"],
];

type Session = {
  owner: VoiceOwner;
  recorder: MediaRecorder;
  stream: MediaStream;
  audioContext: AudioContext | null;
  chunks: Blob[];
  format: AudioFormat;
  startedAt: number;
  peak: number;
  timer: number;
  discard: boolean;
  onTranscript: (text: string) => void;
};

type VoiceRecorderValue = {
  status: VoiceStatus;
  owner: VoiceOwner | null;
  elapsedMs: number;
  maxMs: number;
  start: (owner: VoiceOwner, onTranscript: (text: string) => void) => Promise<void>;
  stop: () => void;
  cancel: () => void;
};

const VoiceRecorderContext = createContext<VoiceRecorderValue | null>(null);

function portalSlug() {
  return /^\/portal\/([^/]+)/.exec(window.location.pathname)?.[1] ?? null;
}

async function transcribe(audio: Blob, format: AudioFormat, token: string | null) {
  if (!navigator.onLine) throw new Error("You're offline. Check your connection and try again.");
  const body = new FormData();
  body.append("audio", audio, `recording.${format}`);
  body.append("format", format);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const slug = portalSlug();
  if (slug) headers["X-Cyphersoft-Portal"] = slug;
  let response: Response;
  try {
    response = await fetch("/api/transcribe", { method: "POST", body, headers });
  } catch {
    throw new Error("Network error. Check your connection and try again.");
  }
  const payload = (await response.json().catch(() => null)) as {
    text?: string;
    error?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.error || "Transcription failed. Try again.");
  return payload?.text?.trim() ?? "";
}

function microphoneError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow it in your browser's site settings and try again.";
  }
  if (name === "NotFoundError") return "No microphone was found.";
  if (name === "NotReadableError") return "Your microphone is in use by another app.";
  return "Couldn't start the microphone.";
}

export function VoiceRecorderProvider({ children }: { children: ReactNode }) {
  const token = useAuthToken();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const session = useRef<Session | null>(null);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [owner, setOwner] = useState<VoiceOwner | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const release = useCallback((current: Session) => {
    window.clearInterval(current.timer);
    current.stream.getTracks().forEach((track) => track.stop());
    void current.audioContext?.close().catch(() => undefined);
  }, []);

  const finish = useCallback(
    async (current: Session) => {
      release(current);
      const duration = Date.now() - current.startedAt;
      const blob = new Blob(current.chunks, { type: current.recorder.mimeType });
      current.chunks = [];
      if (session.current === current) session.current = null;
      if (current.discard) return;
      if (duration < MIN_DURATION_MS || blob.size === 0 || current.peak < SILENCE_PEAK) {
        setStatus("idle");
        setOwner(null);
        toast.info(DIDNT_CATCH);
        return;
      }
      setStatus("transcribing");
      try {
        const text = await transcribe(blob, current.format, tokenRef.current);
        if (!text) toast.info(DIDNT_CATCH);
        else current.onTranscript(text);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Transcription failed.");
      } finally {
        setStatus("idle");
        setOwner(null);
      }
    },
    [release],
  );

  const stop = useCallback(() => {
    const current = session.current;
    if (current && current.recorder.state !== "inactive") current.recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    const current = session.current;
    if (!current) return;
    current.discard = true;
    if (current.recorder.state !== "inactive") current.recorder.stop();
    else release(current);
    session.current = null;
    setStatus("idle");
    setOwner(null);
  }, [release]);

  const start = useCallback(
    async (nextOwner: VoiceOwner, onTranscript: (text: string) => void) => {
      if (status === "transcribing") return;
      cancel();
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        toast.error("Voice input isn't supported in this browser.");
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (error) {
        toast.error(microphoneError(error));
        return;
      }
      const [mimeType, format] = MIME_CANDIDATES.find(([mime]) =>
        MediaRecorder.isTypeSupported(mime),
      ) ?? ["", "webm" as AudioFormat];
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      let audioContext: AudioContext | null = null;
      let analyser: AnalyserNode | null = null;
      try {
        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        audioContext.createMediaStreamSource(stream).connect(analyser);
      } catch {
        audioContext = null;
        analyser = null;
      }
      const samples = analyser ? new Float32Array(analyser.fftSize) : null;

      const current: Session = {
        owner: nextOwner,
        recorder,
        stream,
        audioContext,
        chunks: [],
        format,
        startedAt: Date.now(),
        // Without an analyser we cannot detect silence; let the server decide.
        peak: analyser ? 0 : 1,
        timer: 0,
        discard: false,
        onTranscript,
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) current.chunks.push(event.data);
      };
      recorder.onstop = () => void finish(current);
      current.timer = window.setInterval(() => {
        if (analyser && samples) {
          analyser.getFloatTimeDomainData(samples);
          for (const sample of samples) current.peak = Math.max(current.peak, Math.abs(sample));
        }
        const elapsed = Date.now() - current.startedAt;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_SECONDS * 1000 && recorder.state === "recording") {
          toast.info(`Stopped at the ${MAX_SECONDS}-second limit.`);
          recorder.stop();
        }
      }, 100);

      session.current = current;
      recorder.start(250);
      setElapsedMs(0);
      setOwner(nextOwner);
      setStatus("recording");
    },
    [cancel, finish, status],
  );

  useEffect(() => () => cancel(), [cancel]);

  const value = useMemo(
    () => ({ status, owner, elapsedMs, maxMs: MAX_SECONDS * 1000, start, stop, cancel }),
    [status, owner, elapsedMs, start, stop, cancel],
  );
  return <VoiceRecorderContext.Provider value={value}>{children}</VoiceRecorderContext.Provider>;
}

export function useVoiceRecorder() {
  const value = useContext(VoiceRecorderContext);
  if (!value) throw new Error("useVoiceRecorder must be used inside VoiceRecorderProvider");
  return value;
}

export function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
