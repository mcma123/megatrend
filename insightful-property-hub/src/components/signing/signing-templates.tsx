import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { JSONContent } from "@tiptap/core";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import {
  BUILTIN_CONDITIONS,
  BUILTIN_LABELS,
  type TemplateCondition,
  type TemplateField,
  type TemplateKind,
} from "../../../../convex/lib/signingTemplates";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";
import { TemplateEditor } from "./template-editor";

const KINDS: [TemplateKind, string][] = [
  ["residential_lease", "Residential lease"],
  ["commercial_lease", "Commercial lease"],
  ["month_to_month", "Month-to-month lease"],
  ["renewal", "Lease renewal"],
  ["general_contract", "General contract"],
];
const errorText = (err: unknown, fallback: string) =>
  err instanceof ConvexError && typeof err.data === "string" ? err.data : fallback;
type Selection =
  | { kind: "template"; id: Id<"signingTemplates">; versionId: Id<"signingTemplateVersions"> }
  | { kind: "clause"; id: Id<"signingClauses">; versionId: Id<"signingClauseVersions"> };

/** Company template and clause libraries. Approved versions are read-only and never edited in place. */
export function SigningTemplates({
  tenantId,
  canEdit,
}: {
  tenantId: Id<"tenants">;
  canEdit: boolean;
}) {
  const library = useQuery(api.signingTemplates.library, { tenantId });
  const install = useMutation(api.signingTemplates.installStarters),
    createTemplate = useMutation(api.signingTemplates.createTemplate),
    createClause = useMutation(api.signingTemplates.createClause);
  const [selected, setSelected] = useState<Selection | null>(null),
    [name, setName] = useState(""),
    [kind, setKind] = useState<TemplateKind>("residential_lease"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!library) return <Card className="p-5 text-sm">Loading templates…</Card>;
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err, "The library could not be updated"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.8fr)]">
      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <h2 className="font-medium">Templates</h2>
          <p className="text-xs text-muted-foreground">
            Starter structures contain placeholder wording only. Approved legal text must be
            supplied and approved by an authorised reviewer before use.
          </p>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => install({ tenantId }))}
              >
                Install starter structures
              </Button>
            </div>
          )}
          <ul className="divide-y text-sm">
            {library.templates.map((template) => (
              <li key={template.id} className="py-2">
                <button
                  className="w-full text-left"
                  onClick={() =>
                    setSelected({
                      kind: "template",
                      id: template.id,
                      versionId: template.versions[0].id as Id<"signingTemplateVersions">,
                    })
                  }
                >
                  <span className="font-medium">{template.name}</span>
                  {template.retired && (
                    <Badge className="ml-2" variant="secondary">
                      Retired
                    </Badge>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {KINDS.find(([k]) => k === template.kind)?.[1]} ·{" "}
                    {template.approvedVersionId
                      ? `approved v${template.versions.find((v) => v.id === template.approvedVersionId)?.version}`
                      : "not approved"}
                    {template.versions[0].status === "draft"
                      ? ` · draft v${template.versions[0].version}`
                      : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="space-y-2 border-t pt-3">
              <Field label="New template name" htmlFor="template-name">
                <Input
                  id="template-name"
                  dictation={false}
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <NativeSelect
                aria-label="Template type"
                value={kind}
                onChange={(e) => setKind(e.target.value as TemplateKind)}
              >
                {KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    void run(async () => {
                      await createTemplate({ tenantId, name, kind });
                      setName("");
                    })
                  }
                >
                  Create template
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    void run(async () => {
                      await createClause({ tenantId, title: name });
                      setName("");
                    })
                  }
                >
                  Create clause
                </Button>
              </div>
            </div>
          )}
        </Card>
        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Clause library</h2>
          <ul className="divide-y text-sm">
            {library.clauses.map((clause) => (
              <li key={clause.id} className="py-2">
                <button
                  className="w-full text-left"
                  onClick={() =>
                    setSelected({
                      kind: "clause",
                      id: clause.id,
                      versionId: clause.versions[0].id as Id<"signingClauseVersions">,
                    })
                  }
                >
                  <span className="font-medium">{clause.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {clause.approvedVersionId ? "approved" : "not approved"} · latest v
                    {clause.versions[0].version} ({clause.versions[0].status})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <FormError message={error} />
      </div>
      <div>
        {selected ? (
          <VersionEditor
            key={`${selected.kind}:${selected.versionId}`}
            selection={selected}
            library={library}
            canEdit={canEdit}
            onSelectVersion={(versionId) =>
              setSelected(
                selected.kind === "template"
                  ? { ...selected, versionId: versionId as Id<"signingTemplateVersions"> }
                  : { ...selected, versionId: versionId as Id<"signingClauseVersions"> },
              )
            }
          />
        ) : (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Select a template or clause to review its versions.
          </Card>
        )}
      </div>
    </div>
  );
}

type Library = NonNullable<ReturnType<typeof useQuery<typeof api.signingTemplates.library>>>;
function VersionEditor({
  selection,
  library,
  canEdit,
  onSelectVersion,
}: {
  selection: Selection;
  library: Library;
  canEdit: boolean;
  onSelectVersion: (id: string) => void;
}) {
  const template =
    selection.kind === "template" ? library.templates.find((t) => t.id === selection.id) : null;
  const clause =
    selection.kind === "clause" ? library.clauses.find((c) => c.id === selection.id) : null;
  const versions = (template ?? clause)?.versions ?? [];
  const templateVersion = useQuery(
    api.signingTemplates.templateVersion,
    selection.kind === "template" ? { versionId: selection.versionId } : "skip",
  );
  const clauseVersion = useQuery(
    api.signingTemplates.clauseVersion,
    selection.kind === "clause" ? { versionId: selection.versionId } : "skip",
  );
  const data = templateVersion ?? clauseVersion;
  const saveTemplate = useMutation(api.signingTemplates.saveTemplateDraft),
    saveClause = useMutation(api.signingTemplates.saveClauseDraft),
    approveTemplate = useMutation(api.signingTemplates.approveTemplateVersion),
    approveClause = useMutation(api.signingTemplates.approveClauseVersion),
    newTemplateVersion = useMutation(api.signingTemplates.newTemplateVersion),
    newClauseVersion = useMutation(api.signingTemplates.newClauseVersion),
    retire = useMutation(api.signingTemplates.retire);
  const [doc, setDoc] = useState<JSONContent | null>(null),
    [fields, setFields] = useState<TemplateField[]>([]),
    [conditions, setConditions] = useState<TemplateCondition[]>([]),
    [legal, setLegal] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (data && !dirty) {
      setDoc(data.content as JSONContent);
      if (templateVersion) {
        setFields(templateVersion.fields);
        setConditions(templateVersion.conditions);
      }
    }
  }, [data, templateVersion, dirty]);
  if (!data || !doc) return <Card className="p-5 text-sm">Loading version…</Card>;
  const draft = data.status === "draft" && canEdit && !(template?.retired || clause?.retired);
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      if (selection.kind === "template")
        await saveTemplate({
          versionId: selection.versionId,
          expectedRevision: data.revision,
          content: doc,
          fields,
          conditions,
        });
      else
        await saveClause({
          versionId: selection.versionId,
          expectedRevision: data.revision,
          content: doc,
        });
      setDirty(false);
    }, "The draft could not be saved");
  const options = {
    mergeKeys: [
      ...Object.entries(BUILTIN_LABELS).map(([key, label]) => ({ key, label })),
      ...fields.map((f) => ({ key: `input.${f.key}`, label: f.label })),
    ],
    conditions: [
      ...Object.entries(BUILTIN_CONDITIONS).map(([key, label]) => ({ key, label })),
      ...conditions.map((c) => ({ key: `input.${c.key}`, label: c.label })),
    ],
    clauses: library.clauses.filter((c) => !c.retired).map((c) => ({ id: c.id, title: c.title })),
  };
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">{template?.name ?? clause?.title}</h2>
          <p className="text-xs text-muted-foreground">
            Version {data.version} · {data.status}
            {data.legalReference ? ` · approval ${data.legalReference}` : ""} · content hash{" "}
            {data.contentHash.slice(0, 12)}…
          </p>
        </div>
        <NativeSelect
          aria-label="Version"
          value={selection.versionId}
          onChange={(e) => onSelectVersion(e.target.value)}
          className="w-40"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.version} ({v.status})
            </option>
          ))}
        </NativeSelect>
      </div>
      {!draft && data.status !== "draft" && (
        <p className="rounded-md border p-2 text-xs text-muted-foreground">
          This version is {data.status} and cannot change. Generated agreements keep referring to
          it.
        </p>
      )}
      <TemplateEditor
        key={`${selection.versionId}:${draft}`}
        content={doc}
        editable={draft}
        allowClauses={selection.kind === "template"}
        options={options}
        onChange={(next) => {
          setDoc(next);
          setDirty(true);
        }}
      />
      {selection.kind === "template" && (
        <FieldDefinitions
          fields={fields}
          conditions={conditions}
          editable={draft}
          onChange={(f, c) => {
            setFields(f);
            setConditions(c);
            setDirty(true);
          }}
        />
      )}
      {draft && (
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>
            Save draft
          </Button>
          <Field label="Legal approval reference" htmlFor="legal-reference">
            <Input
              id="legal-reference"
              dictation={false}
              maxLength={500}
              value={legal}
              onChange={(e) => setLegal(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || dirty || !legal.trim()}
            onClick={() =>
              void run(
                () =>
                  selection.kind === "template"
                    ? approveTemplate({
                        versionId: selection.versionId,
                        expectedRevision: data.revision,
                        legalReference: legal,
                      })
                    : approveClause({
                        versionId: selection.versionId,
                        expectedRevision: data.revision,
                        legalReference: legal,
                      }),
                "Approval failed",
              )
            }
          >
            Approve this exact version
          </Button>
        </div>
      )}
      {draft && dirty && (
        <p className="text-xs text-muted-foreground">Unsaved changes. Save before approving.</p>
      )}
      {canEdit && data.status !== "draft" && !(template?.retired || clause?.retired) && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const id =
                  selection.kind === "template"
                    ? await newTemplateVersion({ templateId: selection.id })
                    : await newClauseVersion({ clauseId: selection.id });
                onSelectVersion(id);
              }, "A new version could not be created")
            }
          >
            Create new version
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  retire(
                    selection.kind === "template"
                      ? { templateId: selection.id }
                      : { clauseId: selection.id },
                  ),
                "Retiring failed",
              )
            }
          >
            Retire
          </Button>
        </div>
      )}
      <FormError message={error} />
    </Card>
  );
}

function FieldDefinitions({
  fields,
  conditions,
  editable,
  onChange,
}: {
  fields: TemplateField[];
  conditions: TemplateCondition[];
  editable: boolean;
  onChange: (fields: TemplateField[], conditions: TemplateCondition[]) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">Information collected at generation</p>
      <p className="text-xs text-muted-foreground">
        Use these for facts the portfolio does not hold (renter, unit, owner details). Keys use
        lower_snake_case and appear as input.&lt;key&gt; merge fields.
      </p>
      {fields.map((field, index) => (
        <div
          key={index}
          className="grid grid-cols-[1fr_1.5fr_8rem_6rem_auto] items-center gap-2 text-xs"
        >
          <Input
            aria-label="Field key"
            dictation={false}
            disabled={!editable}
            value={field.key}
            onChange={(e) =>
              onChange(
                fields.map((f, i) => (i === index ? { ...f, key: e.target.value } : f)),
                conditions,
              )
            }
          />
          <Input
            aria-label="Field label"
            dictation={false}
            disabled={!editable}
            value={field.label}
            onChange={(e) =>
              onChange(
                fields.map((f, i) => (i === index ? { ...f, label: e.target.value } : f)),
                conditions,
              )
            }
          />
          <NativeSelect
            aria-label="Field type"
            disabled={!editable}
            value={field.type}
            onChange={(e) =>
              onChange(
                fields.map((f, i) =>
                  i === index ? { ...f, type: e.target.value as TemplateField["type"] } : f,
                ),
                conditions,
              )
            }
          >
            {["text", "multiline", "date", "money", "number"].map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </NativeSelect>
          <label className="flex gap-1">
            <input
              type="checkbox"
              disabled={!editable}
              checked={field.required}
              onChange={(e) =>
                onChange(
                  fields.map((f, i) => (i === index ? { ...f, required: e.target.checked } : f)),
                  conditions,
                )
              }
            />
            Required
          </label>
          {editable && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange(
                  fields.filter((_, i) => i !== index),
                  conditions,
                )
              }
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {conditions.map((condition, index) => (
        <div key={`c${index}`} className="grid grid-cols-[1fr_2fr_auto] items-center gap-2 text-xs">
          <Input
            aria-label="Condition key"
            dictation={false}
            disabled={!editable}
            value={condition.key}
            onChange={(e) =>
              onChange(
                fields,
                conditions.map((c, i) => (i === index ? { ...c, key: e.target.value } : c)),
              )
            }
          />
          <Input
            aria-label="Condition label"
            dictation={false}
            disabled={!editable}
            value={condition.label}
            onChange={(e) =>
              onChange(
                fields,
                conditions.map((c, i) => (i === index ? { ...c, label: e.target.value } : c)),
              )
            }
          />
          {editable && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange(
                  fields,
                  conditions.filter((_, i) => i !== index),
                )
              }
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {editable && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onChange(
                [...fields, { key: "", label: "", type: "text", required: true }],
                conditions,
              )
            }
          >
            Add field
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange(fields, [...conditions, { key: "", label: "" }])}
          >
            Add condition
          </Button>
        </div>
      )}
    </div>
  );
}
