import type { VoiceField, VoiceFieldValue, VoiceForm } from "../../ports/voice-assistant";

export type FieldRejection = { field: string; reason: string };

const MAX_TEXT = { text: 300, textarea: 4000 } as const;

function coerce(field: VoiceField, raw: string): { value?: VoiceFieldValue; reason?: string } {
  const text = raw.trim();
  switch (field.type) {
    case "text":
    case "textarea":
      if (text.length > MAX_TEXT[field.type]) return { reason: `longer than ${MAX_TEXT[field.type]} characters` };
      return { value: text };
    case "number": {
      // Allow a leading currency code/symbol ("USD 150,000", "R45000"); anything else must be numeric.
      const cleaned = text.replace(/[\s,]/g, "").replace(/^(?:[A-Za-z]{1,3}|[$€£R])(?=[\d.-])/, "");
      const number = /^-?\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
      return Number.isFinite(number) ? { value: number } : { reason: "not a number" };
    }
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text))
        ? { value: text }
        : { reason: "dates must be YYYY-MM-DD" };
    case "boolean":
      if (/^(true|yes|on)$/i.test(text)) return { value: true };
      if (/^(false|no|off)$/i.test(text)) return { value: false };
      return { reason: "must be true or false" };
    case "select": {
      const options = field.options ?? [];
      const match =
        options.find((option) => option.value === text) ??
        options.find((option) => option.value.toLowerCase() === text.toLowerCase()) ??
        options.find((option) => option.label.toLowerCase() === text.toLowerCase());
      return match
        ? { value: match.value }
        : { reason: `must be one of: ${options.map((option) => option.value).join(", ")}` };
    }
  }
}

/**
 * Validate agent-proposed values against a registered form schema. Unknown fields and values of the
 * wrong type or outside the allowed options are rejected so the agent can ask instead of guessing.
 */
export function validateFormValues(form: VoiceForm, entries: { field: string; value: string }[]) {
  const accepted: Record<string, VoiceFieldValue> = {};
  const rejected: FieldRejection[] = [];
  for (const entry of entries) {
    const field = form.fields.find((candidate) => candidate.name === entry.field);
    if (!field) {
      rejected.push({ field: entry.field, reason: "no such field on this form" });
      continue;
    }
    const result = coerce(field, entry.value);
    if (result.value === undefined) rejected.push({ field: field.name, reason: result.reason ?? "invalid" });
    else accepted[field.name] = result.value;
  }
  return { accepted, rejected };
}
