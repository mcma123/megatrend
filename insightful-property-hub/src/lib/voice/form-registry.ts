import { useEffect, useRef } from "react";
import type { VoiceField, VoiceFieldValue, VoiceForm } from "./types";

// Client-side registry of forms the voice assistant may fill. Forms register while mounted/open
// via `useVoiceForm`; the assistant reads the open form and fills it through `setValues`.

type RegisteredForm = VoiceForm & {
  getValues: () => Record<string, VoiceFieldValue | null>;
  setValues: (values: Record<string, VoiceFieldValue>) => void;
};

const forms = new Map<string, RegisteredForm>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function getRegisteredForm(formId: string) {
  return forms.get(formId) ?? null;
}

/** The most recently registered form, i.e. the one the user is looking at. */
export function getOpenForm() {
  const all = [...forms.values()];
  return all.length > 0 ? all[all.length - 1] : null;
}

/** Resolve once `formId` registers (e.g. after navigating opens its dialog), or null on timeout. */
export function waitForForm(formId: string, timeoutMs = 5000): Promise<RegisteredForm | null> {
  const existing = forms.get(formId);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      listeners.delete(check);
      resolve(null);
    }, timeoutMs);
    function check() {
      const form = forms.get(formId);
      if (!form) return;
      window.clearTimeout(timer);
      listeners.delete(check);
      resolve(form);
    }
    listeners.add(check);
  });
}

/** Keep only values that match a field, its type and its options. */
export function sanitizeValues(fields: VoiceField[], values: Record<string, VoiceFieldValue>) {
  const clean: Record<string, VoiceFieldValue> = {};
  for (const [name, value] of Object.entries(values)) {
    const field = fields.find((candidate) => candidate.name === name);
    if (!field) continue;
    if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) continue;
    if (field.type === "boolean" && typeof value !== "boolean") continue;
    if (field.type === "select" && !field.options?.some((option) => option.value === value))
      continue;
    if (["text", "textarea", "date"].includes(field.type) && typeof value !== "string") continue;
    clean[name] = value;
  }
  return clean;
}

/** Convert assistant values to the string-valued state most forms here keep. */
export function toFormStrings(values: Record<string, VoiceFieldValue>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === "boolean" ? value : String(value),
    ]),
  );
}

/**
 * Make a form voice-fillable while `enabled` (e.g. while its dialog is open).
 *
 *   useVoiceForm({ formId: "property.create", title: "New property", fields, values,
 *     setValues: (patch) => setValues((current) => ({ ...current, ...toFormStrings(patch) })),
 *     enabled: open });
 */
export function useVoiceForm({
  formId,
  title,
  fields,
  values,
  setValues,
  enabled = true,
}: {
  formId: string;
  title: string;
  fields: VoiceField[];
  values: Record<string, unknown>;
  setValues: (values: Record<string, VoiceFieldValue>) => void;
  enabled?: boolean;
}) {
  const latest = useRef({ title, fields, values, setValues });
  latest.current = { title, fields, values, setValues };

  useEffect(() => {
    if (!enabled) return;
    const entry: RegisteredForm = {
      formId,
      get title() {
        return latest.current.title;
      },
      get fields() {
        return latest.current.fields;
      },
      getValues: () => {
        const current = latest.current.values;
        return Object.fromEntries(
          latest.current.fields.map((field) => {
            const value = current[field.name];
            return [
              field.name,
              typeof value === "string" || typeof value === "number" || typeof value === "boolean"
                ? value
                : null,
            ];
          }),
        );
      },
      setValues: (patch) => latest.current.setValues(patch),
    };
    forms.delete(formId);
    forms.set(formId, entry);
    notify();
    return () => {
      if (forms.get(formId) === entry) forms.delete(formId);
      notify();
    };
  }, [formId, enabled]);
}
