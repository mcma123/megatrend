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

const recordModule = z.enum(["clients", "properties", "leases", "documents"]);

const argList = z
  .array(
    z.object({
      field: z.string().min(1).describe("Field or parameter name from the schema."),
      value: z
        .string()
        .describe(
          "Value as text: plain digits for numbers, YYYY-MM-DD for dates, an option value for selects, true/false for checkboxes.",
        ),
    }),
  )
  .max(40);

/**
 * Client-action tools for the voice assistant. They record actions for the browser to execute.
 * Data-changing commands and form submits only run after the user taps Confirm in the app; there is
 * intentionally no delete/archive/reject tool.
 */
export const voiceAssistantTools = {
  get_current_form_state: createTool({
    id: "get_current_form_state",
    description:
      "Get the current page, the open form (fields and values), forms you can open, commands on this page (with parameters), commands on other pages, and record counts.",
    inputSchema: z.object({}),
    outputSchema: z.any(),
    execute: async (_input, context) => sessionFrom(context).describe(),
  }),
  navigate_to_module: createTool({
    id: "navigate_to_module",
    description:
      "Open a form (by formId, e.g. client.create) or a module page (e.g. clients, leases, documents, sourcing). Opening does not save anything.",
    inputSchema: z.object({
      target: z.string().min(1).describe("A formId from formsYouCanOpen or a module name."),
    }),
    outputSchema: z.any(),
    execute: async ({ target }, context) => sessionFrom(context).navigate(target),
  }),
  find_records: createTool({
    id: "find_records",
    description:
      "Search the user's clients, properties, leases or documents by name/words. Use before open_record. Returns ids (slug for clients).",
    inputSchema: z.object({
      module: recordModule,
      query: z.string().max(200).describe("Words the user said, e.g. 'DHL Sandton' or 'Acme invoice'."),
    }),
    outputSchema: z.any(),
    execute: async ({ module, query }, context) => sessionFrom(context).findRecords(module, query),
  }),
  open_record: createTool({
    id: "open_record",
    description: "Open one record's detail page using an id (slug for clients) returned by find_records.",
    inputSchema: z.object({ module: recordModule, id: z.string().min(1).max(200) }),
    outputSchema: z.any(),
    execute: async ({ module, id }, context) => sessionFrom(context).openRecord(module, id),
  }),
  run_page_command: createTool({
    id: "run_page_command",
    description:
      "Run a page command (filter, tab, search, open a dialog, or a data change like start renewal or re-process). Use commandsOnThisPage; a command on another page works only after you open that page in this turn. Commands with effect 'change' wait for the user to tap Confirm.",
    inputSchema: z.object({
      commandId: z.string().min(1).max(80),
      args: z
        .array(
          z.object({
            param: z.string().min(1).describe("Parameter name from the command's params, e.g. 'tab' or 'field'."),
            value: z
              .string()
              .describe("Parameter value: an option value (or exact label) for selects, plain text otherwise."),
          }),
        )
        .max(10)
        .default([]),
    }),
    outputSchema: z.any(),
    execute: async ({ commandId, args }, context) =>
      sessionFrom(context).runCommand(
        commandId,
        args.map((arg) => ({ field: arg.param, value: arg.value })),
      ),
  }),
  fill_form: createTool({
    id: "fill_form",
    description:
      "Fill fields of a form for the user to review. Only set fields the user actually stated. Opens the form first if needed.",
    inputSchema: z.object({ formId: z.string().min(1), values: argList.min(1) }),
    outputSchema: z.any(),
    execute: async ({ formId, values }, context) => sessionFrom(context).fill(formId, values),
  }),
  submit_form: createTool({
    id: "submit_form",
    description:
      "Offer to save/submit a filled form (e.g. Save client, Generate sourcing options). Only when the user asked to save/create/generate. The user must tap Confirm.",
    inputSchema: z.object({ formId: z.string().min(1) }),
    outputSchema: z.any(),
    execute: async ({ formId }, context) => sessionFrom(context).submitForm(formId),
  }),
  ask_user: createTool({
    id: "ask_user",
    description: "Ask the user one short follow-up question, for example about missing required fields.",
    inputSchema: z.object({ question: z.string().min(1).max(300) }),
    outputSchema: z.any(),
    execute: async ({ question }, context) => sessionFrom(context).ask(question),
  }),
};
