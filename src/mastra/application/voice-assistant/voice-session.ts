import type {
  OpenableVoiceForm,
  VoiceAction,
  VoiceAssistantRequest,
  VoiceCommand,
  VoiceFieldValue,
  VoiceForm,
  VoicePageKey,
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

export type RecordModule = "clients" | "properties" | "leases" | "documents";

/** Page key for a pathname, used to decide which page commands are reachable. */
export function pageForPath(pathname: string): VoicePageKey | null {
  const [first, second] = pathname.split("?")[0].split("/").filter(Boolean);
  const detail = Boolean(second);
  switch (first) {
    case "clients":
      return detail ? "clients.detail" : "clients.list";
    case "properties":
      return detail ? "properties.detail" : "properties.list";
    case "leases":
      return detail ? "leases.detail" : "leases.list";
    case "documents":
      return detail ? "documents.detail" : "documents.list";
    case "sourcing":
      return "sourcing";
    case "tasks":
      return "tasks";
    default:
      return null;
  }
}

function tokens(text: string) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Per-request state shared with the voice tools through the request context. Tools only record
 * client actions here; nothing is executed or saved on the server.
 */
export class VoiceSession {
  readonly actions: VoiceAction[] = [];
  private readonly navigatedForms = new Set<string>();
  /** The page the browser will be on after this turn's navigation. */
  private targetPage: VoicePageKey | null;
  private navigatedThisTurn = false;

  constructor(private readonly request: VoiceAssistantRequest) {
    this.targetPage = pageForPath(request.pathname);
  }

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
      formsYouCanOpen: this.availableForms.map(({ formId, title, fields, submittable }) => ({
        formId,
        title,
        fields,
        submittable: Boolean(submittable),
      })),
      commandsOnThisPage: this.request.pageCommands,
      commandsOnOtherPages: this.request.commandCatalog
        .filter((command) => !this.request.pageCommands.some((live) => live.id === command.id))
        .map(({ id, label, page, effect }) => ({ id, label, page, effect })),
      modules: Object.keys(VOICE_MODULES),
      recordCounts: Object.fromEntries(
        Object.entries(this.request.records).map(([key, rows]) => [key, rows.length]),
      ),
    };
  }

  private form(formId: string): VoiceForm | undefined {
    if (this.request.openForm?.formId === formId) return this.request.openForm;
    return this.availableForms.find((form) => form.formId === formId);
  }

  private pushNavigate(route: string, search?: Record<string, string>) {
    this.actions.push({ type: "navigate", route, search });
    this.targetPage = pageForPath(route);
    this.navigatedThisTurn = true;
  }

  navigate(target: string) {
    const openable = this.availableForms.find((form) => form.formId === target);
    if (openable) {
      if (this.request.openForm?.formId === target || this.navigatedForms.has(target)) {
        return { ok: true, message: `${openable.title} is already open.` };
      }
      this.navigatedForms.add(target);
      this.pushNavigate(openable.route, openable.search);
      return { ok: true, message: `Opening ${openable.title}.` };
    }
    const module = VOICE_MODULES[target];
    if (!module) {
      return {
        ok: false,
        message: `Unknown target. Use one of: ${[...this.availableForms.map((f) => f.formId), ...Object.keys(VOICE_MODULES)].join(", ")}`,
      };
    }
    this.pushNavigate(module.route);
    return { ok: true, message: `Opening ${module.label}.` };
  }

  findRecords(module: RecordModule, query: string) {
    const wanted = tokens(query);
    const rows = this.request.records[module] as Record<string, string>[];
    const scored = rows
      .map((row) => {
        const haystack = tokens(Object.values(row).join(" "));
        const score = wanted.filter((word) => haystack.some((token) => token.startsWith(word))).length;
        return { row, score };
      })
      .filter((item) => wanted.length === 0 || item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.row);
    return { matches: scored, total: rows.length };
  }

  openRecord(module: RecordModule, id: string) {
    const key = module === "clients" ? "slug" : "id";
    const rows = this.request.records[module] as Record<string, string>[];
    const record = rows.find((row) => row[key] === id);
    if (!record) return { ok: false, message: `No ${module} record with that id. Use find_records first.` };
    this.pushNavigate(`/${module}/${encodeURIComponent(id)}`);
    return { ok: true, message: `Opening ${record.name ?? record.label ?? record.filename}.` };
  }

  runCommand(commandId: string, entries: { field: string; value: string }[]) {
    const live = this.navigatedThisTurn
      ? undefined
      : this.request.pageCommands.find((command) => command.id === commandId);
    const catalog = this.request.commandCatalog.find((command) => command.id === commandId);
    let command: VoiceCommand | undefined = live;
    if (!command && catalog) {
      if (!this.navigatedThisTurn || this.targetPage !== catalog.page) {
        return {
          ok: false,
          message: this.navigatedThisTurn
            ? `${catalog.label} is on a different page (${catalog.page}). Open that page first.`
            : `${catalog.label} is not available on this page right now (wrong page or no permission). Open the right record first.`,
        };
      }
      command = catalog;
    }
    if (!command) return { ok: false, message: "Unknown command." };

    const { accepted, rejected } = validateFormValues(
      { formId: command.id, title: command.label, fields: command.params },
      entries,
    );
    const missing = command.params
      .filter((param) => param.required && accepted[param.name] === undefined)
      .map((param) => param.name);
    if (rejected.length > 0 || missing.length > 0) {
      return {
        ok: false,
        rejected,
        missing,
        message:
          command === catalog && command.params.some((param) => param.type === "select" && !param.options?.length)
            ? "This command's choices are only known once its page is open. Open the page, then ask the user to repeat the request."
            : "Fix the parameters or ask the user.",
      };
    }
    this.actions.push({
      type: "run_command",
      commandId: command.id,
      args: accepted as Record<string, VoiceFieldValue>,
      label: command.label,
      effect: command.effect,
    });
    return {
      ok: true,
      message:
        command.effect === "change"
          ? `${command.label} is waiting for the user to tap Confirm.`
          : `${command.label} will run now.`,
    };
  }

  submitForm(formId: string) {
    const form = this.form(formId);
    if (!form) return { ok: false, message: "That form is not available." };
    if (!form.submittable) return { ok: false, message: `${form.title} cannot be submitted by voice; the user must finish it.` };
    const touched =
      this.request.openForm?.formId === formId ||
      this.navigatedForms.has(formId) ||
      this.actions.some((action) => action.type === "fill_form" && action.formId === formId);
    if (!touched) return { ok: false, message: "Open and fill the form first." };
    if (this.actions.some((action) => action.type === "submit_form" && action.formId === formId)) {
      return { ok: true, message: "Already waiting for confirmation." };
    }
    this.actions.push({ type: "submit_form", formId, label: `Save ${form.title}` });
    return { ok: true, message: `Save ${form.title} is waiting for the user to tap Confirm.` };
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
