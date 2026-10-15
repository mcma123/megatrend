import type {
  OpenableVoiceForm,
  VoiceAction,
  VoiceAssistantRequest,
  VoiceFieldValue,
  VoiceForm,
} from "../../ports/voice-assistant";
import { validateFormValues } from "./form-values";

export const VOICE_SESSION_KEY = "voiceSession";

/** Staff modules the assistant may open. Anything else is refused. */
export const VOICE_MODULES: Record<string, { route: string; label: string }> = {
  dashboard: { route: "/dashboard", label: "Dashboard" },
  clients: { route: "/clients", label: "Clients" },
  properties: { route: "/properties", label: "Properties" },
  leases: { route: "/leases", label: "Leases" },
  documents: { route: "/documents", label: "Documents" },
  review: { route: "/review", label: "Review inbox" },
  insights: { route: "/insights", label: "Insights" },
  tasks: { route: "/tasks", label: "Tasks" },
  invoices: { route: "/invoices", label: "Invoices" },
  reports: { route: "/reports", label: "Reports" },
  sourcing: { route: "/sourcing", label: "Property sourcing" },
  automations: { route: "/automations", label: "Automations" },
  search: { route: "/search", label: "Search" },
};

const ALLOWED_ROUTES = new Set(Object.values(VOICE_MODULES).map((module) => module.route));

/**
 * Per-request state shared with the voice tools through the request context. Tools only record
 * client actions here; nothing is executed or saved on the server.
 */
export class VoiceSession {
  readonly actions: VoiceAction[] = [];
  private readonly navigatedForms = new Set<string>();

  constructor(private readonly request: VoiceAssistantRequest) {}

  get openForm() {
    return this.request.openForm;
  }

  get availableForms(): OpenableVoiceForm[] {
    return this.request.availableForms.filter((form) => ALLOWED_ROUTES.has(form.route));
  }

  describe() {
    return {
      currentPage: this.request.pathname,
      openForm: this.request.openForm,
      // Fields are included so the agent can fill a form it opens in the same turn.
      formsYouCanOpen: this.availableForms.map(({ formId, title, fields }) => ({
        formId,
        title,
        fields,
      })),
      modules: Object.keys(VOICE_MODULES),
    };
  }

  private form(formId: string): VoiceForm | undefined {
    if (this.request.openForm?.formId === formId) return this.request.openForm;
    return this.availableForms.find((form) => form.formId === formId);
  }

  navigate(target: string) {
    const openable = this.availableForms.find((form) => form.formId === target);
    if (openable) {
      if (this.request.openForm?.formId === target || this.navigatedForms.has(target)) {
        return { ok: true, message: `${openable.title} is already open.` };
      }
      this.navigatedForms.add(target);
      this.actions.push({ type: "navigate", route: openable.route, search: openable.search });
      return { ok: true, message: `Opening ${openable.title}.` };
    }
    const module = VOICE_MODULES[target];
    if (!module) {
      return { ok: false, message: `Unknown target. Use one of: ${[...this.availableForms.map((f) => f.formId), ...Object.keys(VOICE_MODULES)].join(", ")}` };
    }
    this.actions.push({ type: "navigate", route: module.route });
    return { ok: true, message: `Opening ${module.label}.` };
  }

  fill(formId: string, entries: { field: string; value: string }[]) {
    const form = this.form(formId);
    if (!form) return { ok: false, message: "That form is not available.", accepted: {}, rejected: [] };
    if (this.request.openForm?.formId !== formId) this.navigate(formId);
    const { accepted, rejected } = validateFormValues(form, entries);
    if (Object.keys(accepted).length > 0) {
      const existing = this.actions.find(
        (action): action is Extract<VoiceAction, { type: "fill_form" }> =>
          action.type === "fill_form" && action.formId === formId,
      );
      if (existing) Object.assign(existing.values, accepted);
      else this.actions.push({ type: "fill_form", formId, values: accepted as Record<string, VoiceFieldValue> });
    }
    return { ok: rejected.length === 0, accepted, rejected };
  }

  ask(question: string) {
    this.actions.push({ type: "ask_user", question });
    return { ok: true };
  }
}
