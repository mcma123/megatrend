import { useState } from "react";
import type { SigningField, FieldParticipant } from "../../../../convex/lib/signingFields";
import {
  ATTACHMENT_PURPOSE_LABELS,
  ATTACHMENT_PURPOSES,
  parsePageSelection,
} from "../../../../convex/lib/signingFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/portfolio/form-fields";

const FIXABLE = ["text", "number", "checkbox", "radio", "dropdown"];
const CHOICE = ["radio", "dropdown"];
export function FieldProperties({
  field,
  fields,
  participants,
  pageCount,
  disabled,
  onChange,
  onRemove,
  onRepeat,
}: {
  field: SigningField;
  fields: SigningField[];
  participants: FieldParticipant[];
  pageCount: number;
  disabled: boolean;
  onChange: (patch: Partial<SigningField>) => void;
  onRemove: () => void;
  onRepeat: (pages: number[]) => void;
}) {
  const [pageSelection, setPageSelection] = useState("");
  const [repeat, setRepeat] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefix = `field-${field.key}`;
  return (
    <fieldset disabled={disabled} className="space-y-3 border-t pt-4">
      <legend className="sr-only">Selected field properties</legend>
      <Field label="Field label" htmlFor={`${prefix}-label`}>
        <Input
          dictation={false}
          id={`${prefix}-label`}
          maxLength={120}
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </Field>
      <Field label="Assigned signer" htmlFor={`${prefix}-signer`}>
        <NativeSelect
          id={`${prefix}-signer`}
          value={field.participantKey}
          onChange={(e) => onChange({ participantKey: e.target.value })}
        >
          {participants
            .filter((p) => p.responsibility === "signer")
            .map((p) => (
              <option key={p.key} value={p.key}>
                {p.name} · {p.role}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <Field label="Document page" htmlFor={`${prefix}-page`}>
        <Input
          id={`${prefix}-page`}
          dictation={false}
          type="number"
          min={1}
          max={pageCount}
          step={1}
          value={field.pageIndex + 1}
          onChange={(e) => {
            const page = Number(e.target.value);
            if (Number.isInteger(page) && page >= 1 && page <= pageCount)
              onChange({ pageIndex: page - 1 });
          }}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        {(["x", "y", "width", "height"] as const).map((key) => (
          <Field
            key={key}
            label={`${key === "x" ? "Left" : key === "y" ? "Top" : key} (%)`}
            htmlFor={`${prefix}-${key}`}
          >
            <Input
              id={`${prefix}-${key}`}
              dictation={false}
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={Number((field[key] * 100).toFixed(3))}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value)) onChange({ [key]: value / 100 });
              }}
            />
          </Field>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Coordinates use the unrotated page crop area. Drag or use arrow keys to move; use the resize
        handle or its arrow keys to resize. Shift moves ten points.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        Required field
      </label>
      {!["signature", "initials", "signing_date", "attachment"].includes(field.type) && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={field.readOnly}
            onChange={(e) =>
              onChange({
                readOnly: e.target.checked,
                fixedValue:
                  e.target.checked && FIXABLE.includes(field.type)
                    ? field.type === "checkbox"
                      ? "true"
                      : CHOICE.includes(field.type)
                        ? (field.options?.[0] ?? "")
                        : ""
                    : undefined,
              })
            }
          />
          Read-only approved value
        </label>
      )}
      {field.type === "signing_date" && (
        <p className="text-xs text-muted-foreground">
          The server records the actual signing date. It cannot be entered in advance.
        </p>
      )}
      {field.type === "full_name" && field.readOnly && (
        <p className="text-xs text-muted-foreground">
          Uses the assigned participant's name in this approved revision.
        </p>
      )}
      {field.readOnly && FIXABLE.includes(field.type) && (
        <Field label="Approved value" htmlFor={`${prefix}-value`}>
          {CHOICE.includes(field.type) ? (
            <NativeSelect
              id={`${prefix}-value`}
              value={field.fixedValue ?? ""}
              onChange={(e) => onChange({ fixedValue: e.target.value })}
            >
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          ) : field.type === "checkbox" ? (
            <NativeSelect
              id={`${prefix}-value`}
              value={field.fixedValue ?? "true"}
              onChange={(e) => onChange({ fixedValue: e.target.value })}
            >
              <option value="true">Checked</option>
              <option value="false">Unchecked</option>
            </NativeSelect>
          ) : (
            <Input
              dictation={false}
              id={`${prefix}-value`}
              maxLength={2000}
              value={field.fixedValue ?? ""}
              onChange={(e) => onChange({ fixedValue: e.target.value })}
            />
          )}
        </Field>
      )}
      {(field.type === "text" || field.type === "full_name") && (
        <div className="grid grid-cols-2 gap-2">
          {(["minLength", "maxLength"] as const).map((key) => (
            <Field
              key={key}
              label={key === "minLength" ? "Minimum length" : "Maximum length"}
              htmlFor={`${prefix}-${key}`}
            >
              <Input
                id={`${prefix}-${key}`}
                dictation={false}
                type="number"
                min={key === "minLength" ? 0 : 1}
                max={2000}
                value={field[key] ?? ""}
                onChange={(e) =>
                  onChange({ [key]: e.target.value === "" ? undefined : Number(e.target.value) })
                }
              />
            </Field>
          ))}
        </div>
      )}
      {field.type === "number" && (
        <div className="grid grid-cols-2 gap-2">
          {(["min", "max", "decimals"] as const).map((key) => (
            <Field
              key={key}
              label={key === "min" ? "Minimum" : key === "max" ? "Maximum" : "Decimal places"}
              htmlFor={`${prefix}-${key}`}
            >
              <Input
                id={`${prefix}-${key}`}
                dictation={false}
                type="number"
                min={key === "decimals" ? 0 : -1e12}
                max={key === "decimals" ? 6 : 1e12}
                step={key === "decimals" ? 1 : "any"}
                value={field[key] ?? ""}
                onChange={(e) =>
                  onChange({ [key]: e.target.value === "" ? undefined : Number(e.target.value) })
                }
              />
            </Field>
          ))}
        </div>
      )}
      {CHOICE.includes(field.type) && (
        <Field label="Options (one per line, 2–20)" htmlFor={`${prefix}-options`}>
          <textarea
            id={`${prefix}-options`}
            className="w-full rounded-md border px-2 py-1 text-sm"
            rows={4}
            value={(field.options ?? []).join("\n")}
            onChange={(e) =>
              onChange({
                options: e.target.value.split("\n").map((option) => option.slice(0, 80)),
              })
            }
          />
        </Field>
      )}
      {field.type === "attachment" && (
        <Field label="Purpose" htmlFor={`${prefix}-purpose`}>
          <NativeSelect
            id={`${prefix}-purpose`}
            value={field.purpose ?? "other"}
            onChange={(e) =>
              onChange({ purpose: e.target.value as NonNullable<SigningField["purpose"]> })
            }
          >
            {ATTACHMENT_PURPOSES.map((purpose) => (
              <option key={purpose} value={purpose}>
                {ATTACHMENT_PURPOSE_LABELS[purpose]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <ConditionEditor field={field} fields={fields} onChange={onChange} prefix={prefix} />
      {field.type === "initials" && (
        <div className="space-y-2 rounded-md border p-3">
          <Field label="Repeat initials on pages" htmlFor={`${prefix}-repeat`}>
            <Input
              id={`${prefix}-repeat`}
              dictation={false}
              placeholder="1, 3-5"
              value={pageSelection}
              onChange={(e) => {
                setPageSelection(e.target.value);
                setRepeat(null);
                setError(null);
              }}
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              try {
                const pages = parsePageSelection(pageSelection, pageCount).filter(
                  (p) => p !== field.pageIndex,
                );
                if (!pages.length) throw new Error("Choose at least one other page");
                setRepeat(pages);
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Check page selection");
              }
            }}
          >
            Review repeated placement
          </Button>
          {repeat && (
            <div className="space-y-2 text-xs">
              <p>
                Add {repeat.length} new initials fields for{" "}
                {participants.find((p) => p.key === field.participantKey)?.name} on pages{" "}
                {repeat.map((p) => p + 1).join(", ")}, at the same relative page position? Existing
                fields remain.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  onRepeat(repeat);
                  setRepeat(null);
                }}
              >
                Confirm repeated fields
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
      <Button variant="destructive" size="sm" onClick={onRemove}>
        Remove selected field
      </Button>
    </fieldset>
  );
}

/** Shows a field only when another of the same signer's checkbox/choice fields has a value. */
function ConditionEditor({
  field,
  fields,
  onChange,
  prefix,
}: {
  field: SigningField;
  fields: SigningField[];
  onChange: (patch: Partial<SigningField>) => void;
  prefix: string;
}) {
  const sources = fields.filter(
    (f) =>
      f.key !== field.key &&
      f.participantKey === field.participantKey &&
      !f.showIf &&
      ["checkbox", ...CHOICE].includes(f.type),
  );
  if (!sources.length && !field.showIf) return null;
  const source = sources.find((f) => f.key === field.showIf?.fieldKey);
  const values = source?.type === "checkbox" ? ["true", "false"] : (source?.options ?? []);
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Show only when" htmlFor={`${prefix}-show-if`}>
        <NativeSelect
          id={`${prefix}-show-if`}
          value={field.showIf?.fieldKey ?? ""}
          onChange={(e) => {
            const next = sources.find((f) => f.key === e.target.value);
            onChange({
              showIf: next
                ? {
                    fieldKey: next.key,
                    equals: next.type === "checkbox" ? "true" : (next.options?.[0] ?? ""),
                  }
                : undefined,
            });
          }}
        >
          <option value="">Always shown</option>
          {sources.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {field.showIf && (
        <Field label="Has the value" htmlFor={`${prefix}-show-equals`}>
          <NativeSelect
            id={`${prefix}-show-equals`}
            value={field.showIf.equals}
            onChange={(e) =>
              onChange({ showIf: { fieldKey: field.showIf!.fieldKey, equals: e.target.value } })
            }
          >
            {values.map((value) => (
              <option key={value} value={value}>
                {value === "true" ? "Checked" : value === "false" ? "Unchecked" : value}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
    </div>
  );
}
