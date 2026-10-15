import { timingSafeEqual } from "node:crypto";
import { registerApiRoute } from "@mastra/core/server";
import { runVoiceAssistant } from "../application/voice-assistant/voice-assistant-service";
import { voiceAssistantRequestSchema } from "../ports/voice-assistant";

export const voiceAssistantRoute = registerApiRoute("/voice/assist", {
  method: "POST",
  handler: async (context) => {
    const secret = process.env.MASTRA_VOICE_SERVICE_TOKEN;
    if (!secret) return context.json({ error: "Voice assistant is not configured." }, 503);
    const left = Buffer.from(context.req.header("Authorization") ?? "");
    const right = Buffer.from(`Bearer ${secret}`);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      return context.json({ error: "Unauthorized" }, 401);
    }
    const input = voiceAssistantRequestSchema.safeParse(await context.req.json().catch(() => null));
    if (!input.success) return context.json({ error: "Invalid assistant request." }, 400);
    const abortSignal = AbortSignal.any([context.req.raw.signal, AbortSignal.timeout(55_000)]);
    try {
      const agent = context.get("mastra").getAgent("voiceAssistantAgent");
      return context.json(await runVoiceAssistant(agent, input.data, abortSignal));
    } catch {
      return context.json({ error: "The assistant could not complete that request. Try again." }, 502);
    }
  },
});
