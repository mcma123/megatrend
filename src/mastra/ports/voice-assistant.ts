import { z } from "zod";

/**
 * Contract between the web app's staff-only `/api/assistant` route and Mastra `POST /voice/assist`.
 * The frontend mirror lives in `insightful-property-hub/src/lib/voice/types.ts`; keep both aligned.
 * Form schemas come from the browser and only drive form filling: nothing is saved server-side.
 */
export const voiceFieldTypeSchema = z.enum(["text", "textarea", "number", "select", "date", "boolean"]);

export const voiceFieldSchema = z.object({
  name: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  type: voiceFieldTypeSchema,
  options: z
    .array(z.object({ value: z.string().max(200), label: z.string().max(200) }))
    .max(200)
    .optional(),
  required: z.boolean().optional(),
  description: z.string().max(300).optional(),
});

const fieldValueSchema = z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]);

export const voiceFormSchema = z.object({
  formId: z.string().min(1).max(60),
  title: z.string().min(1).max(120),
  fields: z.array(voiceFieldSchema).min(1).max(40),
});

export const openVoiceFormSchema = voiceFormSchema.extend({
  values: z.record(z.string(), fieldValueSchema),
});

export const openableVoiceFormSchema = voiceFormSchema.extend({
  route: z.string().regex(/^\/[a-z0-9/_-]*$/i).max(120),
  search: z.record(z.string(), z.string().max(60)).optional(),
});

export const voiceAssistantRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(2000),
  pathname: z.string().max(300),
  openForm: openVoiceFormSchema.nullable(),
  availableForms: z.array(openableVoiceFormSchema).max(12),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) }))
    .max(12),
});

export type VoiceField = z.infer<typeof voiceFieldSchema>;
export type VoiceForm = z.infer<typeof voiceFormSchema>;
export type OpenVoiceForm = z.infer<typeof openVoiceFormSchema>;
export type OpenableVoiceForm = z.infer<typeof openableVoiceFormSchema>;
export type VoiceAssistantRequest = z.infer<typeof voiceAssistantRequestSchema>;
export type VoiceFieldValue = string | number | boolean;

/** Client-executed actions. There is deliberately no save/delete/pay/send action. */
export type VoiceAction =
  | { type: "navigate"; route: string; search?: Record<string, string> }
  | { type: "fill_form"; formId: string; values: Record<string, VoiceFieldValue> }
  | { type: "ask_user"; question: string };

export type VoiceAssistantResponse = { reply: string; actions: VoiceAction[] };
