// Browser mirror of the Mastra contract in `src/mastra/ports/voice-assistant.ts`; keep both aligned.

export type VoiceFieldType = "text" | "textarea" | "number" | "select" | "date" | "boolean";
export type VoiceFieldValue = string | number | boolean;

export type VoiceField = {
  name: string;
  label: string;
  type: VoiceFieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  description?: string;
  /** DOM id of the input, used to highlight fields the assistant filled. */
  inputId?: string;
};

export type VoiceForm = { formId: string; title: string; fields: VoiceField[] };

export type OpenableVoiceForm = VoiceForm & { route: string; search?: Record<string, string> };

export type VoiceAction =
  | { type: "navigate"; route: string; search?: Record<string, string> }
  | { type: "fill_form"; formId: string; values: Record<string, VoiceFieldValue> }
  | { type: "ask_user"; question: string };

export type VoiceTurn = { role: "user" | "assistant"; text: string };

export type VoiceAssistantRequest = {
  transcript: string;
  pathname: string;
  openForm: (VoiceForm & { values: Record<string, VoiceFieldValue | null> }) | null;
  availableForms: OpenableVoiceForm[];
  history: VoiceTurn[];
};

export type VoiceAssistantResponse = { reply: string; actions: VoiceAction[] };
