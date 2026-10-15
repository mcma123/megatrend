import type { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";

import type {
  VoiceAction,
  VoiceAssistantRequest,
  VoiceAssistantResponse,
} from "../../ports/voice-assistant";
import { VOICE_SESSION_KEY, VoiceSession } from "./voice-session";

// Navigate, then fill, then view commands, then actions awaiting confirmation, then questions.
function actionRank(action: VoiceAction) {
  switch (action.type) {
    case "navigate":
      return 0;
    case "fill_form":
      return 1;
    case "run_command":
      return action.effect === "view" ? 2 : 3;
    case "submit_form":
      return 3;
    case "ask_user":
      return 4;
  }
}

/**
 * Run one voice-assistant turn. The agent's tools record client actions in a per-request session;
 * the browser executes them (navigate, fill, ask). Nothing is persisted here.
 */
export async function runVoiceAssistant(
  agent: Agent,
  request: VoiceAssistantRequest,
  abortSignal: AbortSignal,
): Promise<VoiceAssistantResponse> {
  const session = new VoiceSession(request);
  const requestContext = new RequestContext();
  requestContext.setRaw(VOICE_SESSION_KEY, session);

  const context = JSON.stringify(session.describe());
  const messages = [
    ...request.history.map((turn) =>
      turn.role === "user"
        ? { role: "user" as const, content: turn.text }
        : { role: "assistant" as const, content: turn.text },
    ),
    {
      role: "user" as const,
      content: `App state (JSON, current at the time of speaking): ${context}\n\nUser said: "${request.transcript}"`,
    },
  ];

  const result = await agent.generate(messages, {
    requestContext,
    maxSteps: 8,
    abortSignal,
  });

  const actions = [...session.actions].sort((a, b) => actionRank(a) - actionRank(b));
  const reply =
    result.text?.trim() ||
    (actions.length > 0 ? "Done. Please review before saving." : "Sorry, I couldn't work out what to do.");
  return { reply: reply.slice(0, 1000), actions };
}
