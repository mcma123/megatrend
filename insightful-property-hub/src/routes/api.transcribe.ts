import { createFileRoute } from "@tanstack/react-router";
import { authedClient, canAccessPortal, getRequestUser } from "../lib/server-auth";
import {
  VoiceError,
  consumeVoiceQuota,
  isAudioFormat,
  maxAudioBytes,
  transcribeWithOpenRouter,
  voiceErrorResponse,
} from "../lib/server/voice";

// Speech-to-text for dictation and the voice assistant. Staff, or client users of the portal named
// in `X-Cyphersoft-Portal`. Multipart body: `audio` (file) + `format` (wav|mp3|flac|m4a|ogg|webm|aac).

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const user = await getRequestUser(request);
          const convex = authedClient(request);
          if (!user || !convex) throw new VoiceError("Sign in to use voice input.", 401);
          if (!user.isStaff) {
            const slug = request.headers.get("x-cyphersoft-portal");
            if (!(await canAccessPortal(request, slug))) {
              throw new VoiceError("You don't have access to voice input here.", 403);
            }
          }

          const declared = Number(request.headers.get("content-length") ?? 0);
          if (declared > maxAudioBytes() + 64 * 1024) {
            throw new VoiceError("Recording is too large.", 413);
          }
          const form = await request.formData().catch(() => null);
          const audio = form?.get("audio");
          const format = form?.get("format");
          if (!(audio instanceof Blob) || !isAudioFormat(format)) {
            throw new VoiceError("Send an audio recording.", 400);
          }
          if (audio.size === 0) throw new VoiceError("Didn't catch that, try again.", 422);
          if (audio.size > maxAudioBytes()) throw new VoiceError("Recording is too large.", 413);

          await consumeVoiceQuota(convex, "transcribe");
          const text = await transcribeWithOpenRouter(await audio.arrayBuffer(), format);
          return Response.json({ text });
        } catch (error) {
          return voiceErrorResponse(error);
        }
      },
    },
  },
});
