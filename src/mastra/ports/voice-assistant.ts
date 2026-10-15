import { z } from "zod";

/**
 * Contract between the web app's staff-only `/api/assistant` route and Mastra `POST /voice/assist`.
 * The frontend mirror lives in `insightful-property-hub/src/lib/voice/types.ts`; keep both aligned.
 * Form/command schemas and records come from the browser. Mastra only returns client actions; data
 * changes run in the browser through existing UI handlers after the user taps Confirm.
 */
export const voiceFieldTypeSchema = z.enum(["text", "textarea", "number", "select", "date", "boolean"]);

export const voiceFieldSchema = z.object({
  name: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  type: voiceFieldTypeSchema,
  options: z
    .array(z.object({ value: z.string().max(200), label: z.string().max(200) }))
    .max(300)
    .optional(),
  required: z.boolean().optional(),
  description: z.string().max(300).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const fieldValueSchema = z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]);

export const voiceFormSchema = z.object({
  formId: z.string().min(1).max(60),
  title: z.string().min(1).max(120),
  fields: z.array(voiceFieldSchema).min(1).max(40),
  /** True when the assistant may offer a confirmed Save/Generate for this form. */
  submittable: z.boolean().optional(),
});

export const openVoiceFormSchema = voiceFormSchema.extend({
  values: z.record(z.string(), fieldValueSchema),
});

const routeSchema = z.string().regex(/^\/[a-z0-9/_-]*$/i).max(160);

export const openableVoiceFormSchema = voiceFormSchema.extend({
  route: routeSchema,
  search: z.record(z.string(), z.string().max(60)).optional(),
});

export const voicePageKeySchema = z.enum([
  "clients.list",
  "clients.detail",
  "properties.list",
  "properties.detail",
  "leases.list",
  "leases.detail",
  "documents.list",
  "documents.detail",
  "sourcing",
  "tasks",
]);

export const voiceCommandSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  description: z.string().max(400),
  page: voicePageKeySchema,
  /** "view" runs immediately; "change" needs the user's confirmation in the app. */
  effect: z.enum(["view", "change"]),
  params: z.array(voiceFieldSchema).max(10),
});

const shortText = z.string().max(200);

export const voiceRecordsSchema = z.object({
  clients: z.array(z.object({ slug: shortText, name: shortText })).max(300),
  properties: z.array(z.object({ id: shortText, name: shortText, client: shortText })).max(300),
  leases: z
    .array(z.object({ id: shortText, label: shortText, client: shortText, endDate: shortText, status: shortText }))
    .max(300),
  documents: z
    .array(z.object({ id: shortText, filename: shortText, client: shortText, status: shortText }))
    .max(300),
});

export const voiceAssistantRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(2000),
  pathname: z.string().max(300),
  openForm: openVoiceFormSchema.nullable(),
  availableForms: z.array(openableVoiceFormSchema).max(12),
  commandCatalog: z.array(voiceCommandSchema).max(60).default([]),
  pageCommands: z.array(voiceCommandSchema).max(40).default([]),
  records: voiceRecordsSchema.default({ clients: [], properties: [], leases: [], documents: [] }),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) }))
    .max(12),
});

export type VoiceField = z.infer<typeof voiceFieldSchema>;
export type VoiceForm = z.infer<typeof voiceFormSchema>;
export type OpenVoiceForm = z.infer<typeof openVoiceFormSchema>;
export type OpenableVoiceForm = z.infer<typeof openableVoiceFormSchema>;
export type VoicePageKey = z.infer<typeof voicePageKeySchema>;
export type VoiceCommand = z.infer<typeof voiceCommandSchema>;
export type VoiceRecords = z.infer<typeof voiceRecordsSchema>;
export type VoiceAssistantRequest = z.infer<typeof voiceAssistantRequestSchema>;
export type VoiceFieldValue = string | number | boolean;

/**
 * Client-executed actions. `run_command` with effect "change" and `submit_form` only run after the
 * user confirms in the app. There is deliberately no delete/archive/reject action.
 */
export type VoiceAction =
  | { type: "navigate"; route: string; search?: Record<string, string> }
  | { type: "fill_form"; formId: string; values: Record<string, VoiceFieldValue> }
  | {
      type: "run_command";
      commandId: string;
      args: Record<string, VoiceFieldValue>;
      label: string;
      effect: "view" | "change";
    }
  | { type: "submit_form"; formId: string; label: string }
  | { type: "ask_user"; question: string };

export type VoiceAssistantResponse = { reply: string; actions: VoiceAction[] };
