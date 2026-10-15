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
  min?: number;
  max?: number;
  /** DOM id of the input, used to highlight fields the assistant filled. */
  inputId?: string;
};

export type VoiceForm = {
  formId: string;
  title: string;
  fields: VoiceField[];
  /** True when the assistant may offer a confirmed Save/Generate for this form. */
  submittable?: boolean;
};

export type OpenableVoiceForm = VoiceForm & { route: string; search?: Record<string, string> };

export type VoicePageKey =
  | "clients.list"
  | "clients.detail"
  | "properties.list"
  | "properties.detail"
  | "leases.list"
  | "leases.detail"
  | "documents.list"
  | "documents.detail"
  | "sourcing"
  | "tasks";

export type VoiceCommand = {
  id: string;
  label: string;
  description: string;
  page: VoicePageKey;
  /** "view" runs immediately; "change" needs the user's Confirm tap. */
  effect: "view" | "change";
  params: VoiceField[];
};

export type VoiceRecords = {
  clients: { slug: string; name: string }[];
  properties: { id: string; name: string; client: string }[];
  leases: { id: string; label: string; client: string; endDate: string; status: string }[];
  documents: { id: string; filename: string; client: string; status: string }[];
};

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

export type VoiceTurn = { role: "user" | "assistant"; text: string };

export type VoiceAssistantRequest = {
  transcript: string;
  pathname: string;
  openForm: (VoiceForm & { values: Record<string, VoiceFieldValue | null> }) | null;
  availableForms: OpenableVoiceForm[];
  commandCatalog: VoiceCommand[];
  pageCommands: VoiceCommand[];
  records: VoiceRecords;
  history: VoiceTurn[];
};

export type VoiceAssistantResponse = { reply: string; actions: VoiceAction[] };
