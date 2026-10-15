import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { VOICE_SESSION_KEY, VoiceSession } from "../application/voice-assistant/voice-session";

type ContextLike = { requestContext: { getRaw(key: string): unknown } };

function sessionFrom(context: ContextLike) {
  const session = context.requestContext.getRaw(VOICE_SESSION_KEY);
  if (!(session instanceof VoiceSession)) {
    throw new Error("Voice assistant tools only run inside a voice assistant request.");
  }
  return session;
}

/**
 * Client-action tools for the voice assistant. They record actions for the browser to execute
 * (navigate, fill a form, ask a question); they never save, submit or delete anything.
 */
export const voiceAssistantTools = {
  get_current_form_state: createTool({
    id: "get_current_form_state",
    description:
      "Get the current page, the open form (fields, allowed options and current values) and the forms and modules you can open.",
    inputSchema: z.object({}),
    outputSchema: z.any(),
    execute: async (_input, context) => sessionFrom(context).describe(),
  }),
  navigate_to_module: createTool({
    id: "navigate_to_module",
    description:
      "Open a form (by formId, e.g. property.create) or a module page (e.g. properties, tasks). Opening a form does not save anything.",
    inputSchema: z.object({
      target: z.string().min(1).describe("A formId from formsYouCanOpen or a module name."),
    }),
    outputSchema: z.any(),
    execute: async ({ target }, context) => sessionFrom(context).navigate(target),
  }),
  fill_form: createTool({
    id: "fill_form",
    description:
      "Fill fields of a form for the user to review. Only set fields the user actually stated. Opens the form first if needed. Never saves.",
    inputSchema: z.object({
      formId: z.string().min(1),
      values: z
        .array(
          z.object({
            field: z.string().min(1).describe("Field name from the form schema."),
            value: z
              .string()
              .describe("Value as text: plain digits for numbers, YYYY-MM-DD for dates, an option value for selects, true/false for checkboxes."),
          }),
        )
        .min(1)
        .max(40),
    }),
    outputSchema: z.any(),
    execute: async ({ formId, values }, context) => sessionFrom(context).fill(formId, values),
  }),
  ask_user: createTool({
    id: "ask_user",
    description: "Ask the user one short follow-up question, for example about missing required fields.",
    inputSchema: z.object({ question: z.string().min(1).max(300) }),
    outputSchema: z.any(),
    execute: async ({ question }, context) => sessionFrom(context).ask(question),
  }),
};
