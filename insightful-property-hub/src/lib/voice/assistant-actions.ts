import { getRegisteredForm, sanitizeValues, waitForForm } from "./form-registry";
import type { VoiceAction, VoiceAssistantRequest, VoiceAssistantResponse } from "./types";

// Browser side of the voice assistant: send a turn to `/api/assistant`, then execute the returned
// client actions (navigate, fill, ask). There is no save/delete action: the user always saves.

const HIGHLIGHT_MS = 2500;

export async function requestAssistant(
  request: VoiceAssistantRequest,
  token: string | null,
): Promise<VoiceAssistantResponse> {
  if (!navigator.onLine) throw new Error("You're offline. Check your connection and try again.");
  let response: Response;
  try {
    response = await fetch("/api/assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(request),
    });
  } catch {
    throw new Error("Network error. Check your connection and try again.");
  }
  const payload = (await response.json().catch(() => null)) as
    (VoiceAssistantResponse & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error || "The assistant is unavailable.");
  return { reply: payload.reply, actions: Array.isArray(payload.actions) ? payload.actions : [] };
}

function highlight(ids: string[]) {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (!element) continue;
    element.classList.remove("voice-filled");
    // Restart the animation when the same field is filled twice.
    void element.offsetWidth;
    element.classList.add("voice-filled");
    window.setTimeout(() => element.classList.remove("voice-filled"), HIGHLIGHT_MS);
  }
}

export type ActionOutcome = {
  filled: { title: string; labels: string[] }[];
  questions: string[];
  failures: string[];
};

export async function executeVoiceActions(
  actions: VoiceAction[],
  navigate: (route: string, search?: Record<string, string>) => Promise<void>,
): Promise<ActionOutcome> {
  const outcome: ActionOutcome = { filled: [], questions: [], failures: [] };
  for (const action of actions) {
    if (action.type === "navigate") {
      await navigate(action.route, action.search);
    } else if (action.type === "fill_form") {
      const form = getRegisteredForm(action.formId) ?? (await waitForForm(action.formId));
      if (!form) {
        outcome.failures.push("The form didn't open, so nothing was filled.");
        continue;
      }
      const values = sanitizeValues(form.fields, action.values);
      const names = Object.keys(values);
      if (names.length === 0) continue;
      form.setValues(values);
      const fields = form.fields.filter((field) => names.includes(field.name));
      // Let React render the new values before highlighting.
      window.requestAnimationFrame(() =>
        highlight(fields.flatMap((field) => (field.inputId ? [field.inputId] : []))),
      );
      outcome.filled.push({ title: form.title, labels: fields.map((field) => field.label) });
    } else if (action.type === "ask_user") {
      outcome.questions.push(action.question);
    }
  }
  return outcome;
}
