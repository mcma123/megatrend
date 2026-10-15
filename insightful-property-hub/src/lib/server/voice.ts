import { ConvexError } from "convex/values";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

// Server-only voice helpers shared by /api/transcribe and /api/assistant.
// Never log audio or transcript content: only sizes, formats, status codes and timings.

export const AUDIO_FORMATS = ["wav", "mp3", "flac", "m4a", "ogg", "webm", "aac"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

const DEFAULT_TRANSCRIPTION_MODEL = "openai/whisper-large-v3-turbo";
const DEFAULT_MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export class VoiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function maxAudioBytes() {
  const parsed = Number(process.env.VOICE_MAX_AUDIO_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_AUDIO_BYTES;
}

export function isAudioFormat(value: unknown): value is AudioFormat {
  return typeof value === "string" && (AUDIO_FORMATS as readonly string[]).includes(value);
}

/** Reserve one voice request against the caller's per-minute and daily limits (Convex). */
export async function consumeVoiceQuota(
  convex: ConvexHttpClient,
  kind: "transcribe" | "assistant",
) {
  try {
    await convex.mutation(api.voice.consume, { kind });
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === "string") {
      throw new VoiceError(error.data, 429);
    }
    throw new VoiceError("Voice input is unavailable right now.", 503);
  }
}

/** Transcribe audio with OpenRouter (`/audio/transcriptions`). Returns trimmed text (may be empty). */
export async function transcribeWithOpenRouter(audio: ArrayBuffer, format: AudioFormat) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new VoiceError("Voice transcription is not configured.", 503);
  const baseUrl = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(
    /\/$/,
    "",
  );
  const model = process.env.OPENROUTER_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL;
  const started = Date.now();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input_audio: { data: Buffer.from(audio).toString("base64"), format },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    console.warn(`[voice] transcription request failed after ${Date.now() - started}ms`);
    throw new VoiceError("Transcription timed out. Try a shorter recording.", 504);
  }

  console.info(
    `[voice] transcription status=${response.status} bytes=${audio.byteLength} format=${format} ms=${Date.now() - started}`,
  );
  if (response.status === 429)
    throw new VoiceError("Transcription is busy. Try again shortly.", 429);
  if (!response.ok) throw new VoiceError("Transcription failed. Try again.", 502);

  const payload = (await response.json().catch(() => null)) as { text?: unknown } | null;
  return typeof payload?.text === "string" ? payload.text.trim() : "";
}

export function voiceErrorResponse(error: unknown) {
  if (error instanceof VoiceError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "Voice request failed. Try again." }, { status: 500 });
}
