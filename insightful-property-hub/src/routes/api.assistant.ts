import { createFileRoute } from "@tanstack/react-router";
import { authedClient, getRequestUser } from "../lib/server-auth";
import { VoiceError, consumeVoiceQuota, voiceErrorResponse } from "../lib/server/voice";

// Staff-only voice assistant: forwards the transcript, current page and voice-fillable form schemas
// to Mastra `POST /voice/assist` (service token). Returns `{ reply, actions }` for the browser to
// execute; nothing is saved by this route or the agent.

const MASTRA_API_URL =
  process.env.MASTRA_API_URL ??
  (process.env.MASTRA_CHAT_URL
    ? process.env.MASTRA_CHAT_URL.replace(/\/chat\/?$/, "")
    : "http://localhost:4111");

// Requests carry form schemas, page commands and up to 300 rows per record type.
const MAX_BODY_BYTES = 512 * 1024;

export const Route = createFileRoute("/api/assistant")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const user = await getRequestUser(request);
          const convex = authedClient(request);
          if (!user?.isStaff || !convex) {
            throw new VoiceError("Sign in with a Cyphersoft staff account.", 401);
          }
          const token = process.env.MASTRA_VOICE_SERVICE_TOKEN;
          if (!token) throw new VoiceError("The voice assistant is not configured.", 503);

          const body = await request.text();
          if (body.length > MAX_BODY_BYTES) throw new VoiceError("Request is too large.", 413);

          await consumeVoiceQuota(convex, "assistant");

          let upstream: Response;
          try {
            upstream = await fetch(`${MASTRA_API_URL.replace(/\/$/, "")}/voice/assist`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body,
              signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
            });
          } catch {
            throw new VoiceError("The assistant is unavailable. Try again shortly.", 503);
          }
          const payload = (await upstream.json().catch(() => null)) as {
            reply?: unknown;
            actions?: unknown;
            error?: unknown;
          } | null;
          if (!upstream.ok || !payload) {
            const message =
              upstream.status === 400
                ? "The assistant couldn't read that request."
                : "The assistant could not complete that request. Try again.";
            throw new VoiceError(message, upstream.status === 400 ? 400 : 502);
          }
          return Response.json({
            reply: typeof payload.reply === "string" ? payload.reply : "",
            actions: Array.isArray(payload.actions) ? payload.actions : [],
          });
        } catch (error) {
          return voiceErrorResponse(error);
        }
      },
    },
  },
});
