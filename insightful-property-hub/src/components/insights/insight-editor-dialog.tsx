import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";
import { errorMessage } from "@/lib/portfolio";
import {
  INSIGHT_CATEGORY_LABELS,
  PRIORITY_LABELS,
  type InsightCategory,
  type Priority,
} from "@/lib/workflow";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type InsightDraftValues = {
  insightId?: Id<"insights">;
  tenantId?: Id<"tenants">;
  title: string;
  body: string;
  recommendedAction: string;
  category: InsightCategory;
  priority: Priority;
  propertyId?: Id<"properties">;
  leaseId?: Id<"leases">;
  documentIds: Id<"documents">[];
  draftedBy: "staff" | "ai" | "system";
};

export const EMPTY_INSIGHT: InsightDraftValues = {
  title: "",
  body: "",
  recommendedAction: "",
  category: "renewal",
  priority: "medium",
  documentIds: [],
  draftedBy: "staff",
};

/** Controlled editor: create (optionally from an AI draft) or edit an insight. */
export function InsightEditorDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: InsightDraftValues;
}) {
  const isEdit = Boolean(initial.insightId);
  const [values, setValues] = useState<InsightDraftValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const createInsight = useMutation(api.insights.create);
  const updateInsight = useMutation(api.insights.update);
  const clients = useQuery(api.clients.list, open && !initial.tenantId ? {} : "skip");
  const tenantId = values.tenantId;
  const properties = useQuery(api.properties.list, open && tenantId ? { tenantId } : "skip");
  const documents = useQuery(api.documents.list, open && tenantId ? { tenantId } : "skip");

  useEffect(() => {
    if (open) {
      setValues(initial);
      setError(null);
    }
  }, [open, initial]);

  const set = <K extends keyof InsightDraftValues>(key: K, value: InsightDraftValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const toggleDocument = (documentId: Id<"documents">, checked: boolean) =>
    set(
      "documentIds",
      checked
        ? [...values.documentIds, documentId].slice(0, 5)
        : values.documentIds.filter((id) => id !== documentId),
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!values.tenantId) {
      setError("Choose a client");
      return;
    }
    setSaving(true);
    setError(null);
    const fields = {
      title: values.title,
      body: values.body,
      recommendedAction: values.recommendedAction || undefined,
      category: values.category,
      priority: values.priority,
      propertyId: values.propertyId,
      leaseId: values.leaseId,
      documentIds: values.documentIds,
    };
    try {
      if (values.insightId) {
        await updateInsight({ insightId: values.insightId, ...fields });
        toast.success("Insight updated");
      } else {
        await createInsight({
          tenantId: values.tenantId,
          draftedBy: values.draftedBy === "ai" ? "ai" : "staff",
          ...fields,
        });
        toast.success("Draft saved. Publish it from Insights when it's ready.");
      }
      onOpenChange(false);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? "Edit insight"
              : values.draftedBy === "ai"
                ? "Review AI draft"
                : "New insight"}
          </DialogTitle>
          <DialogDescription>
            Clients only see an insight after it is published. Link the source document or lease as
            evidence.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {!initial.tenantId ? (
            <Field label="Client" htmlFor="insight-client">
              <NativeSelect
                id="insight-client"
                value={values.tenantId ?? ""}
                onChange={(e) =>
                  setValues((current) => ({
                    ...current,
                    tenantId: (e.target.value || undefined) as Id<"tenants"> | undefined,
                    propertyId: undefined,
                    documentIds: [],
                  }))
                }
              >
                <option value="">
                  {clients === undefined ? "Loading clients…" : "Choose a client"}
                </option>
                {clients?.map((client) => (
                  <option key={client.tenantId} value={client.tenantId}>
                    {client.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <Field label="Title" htmlFor="insight-title">
            <Input
              id="insight-title"
              required
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
          <Field label="Insight" htmlFor="insight-body">
            <Textarea
              id="insight-body"
              required
              rows={5}
              value={values.body}
              onChange={(e) => set("body", e.target.value)}
            />
          </Field>
          <Field label="Recommended action" htmlFor="insight-action">
            <Input
              id="insight-action"
              value={values.recommendedAction}
              onChange={(e) => set("recommendedAction", e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Category" htmlFor="insight-category">
              <NativeSelect
                id="insight-category"
                value={values.category}
                onChange={(e) => set("category", e.target.value as InsightCategory)}
              >
                {Object.entries(INSIGHT_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Priority" htmlFor="insight-priority">
              <NativeSelect
                id="insight-priority"
                value={values.priority}
                onChange={(e) => set("priority", e.target.value as Priority)}
              >
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Property" htmlFor="insight-property">
              <NativeSelect
                id="insight-property"
                value={values.propertyId ?? ""}
                onChange={(e) =>
                  set("propertyId", (e.target.value || undefined) as Id<"properties"> | undefined)
                }
                disabled={!tenantId}
              >
                <option value="">Whole portfolio</option>
                {properties?.map((property) => (
                  <option key={property._id} value={property._id}>
                    {property.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium">Evidence documents</p>
            {!tenantId ? (
              <p className="text-xs text-muted-foreground">Choose a client first.</p>
            ) : documents && documents.length > 0 ? (
              <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
                {documents.map((document) => (
                  <li key={document._id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`evidence-${document._id}`}
                      checked={values.documentIds.includes(document._id)}
                      onCheckedChange={(checked) => toggleDocument(document._id, checked === true)}
                    />
                    <label htmlFor={`evidence-${document._id}`} className="truncate">
                      {document.filename}
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                {values.leaseId
                  ? "Linked to the lease record as evidence."
                  : "No documents for this client yet."}
              </p>
            )}
          </div>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Save draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Asks the Mastra insight drafter (via /api/insights/draft) for a draft from approved facts. */
export function useDraftInsight() {
  const token = useAuthToken();
  return useCallback(
    async (source: {
      documentId?: Id<"documents">;
      leaseId?: Id<"leases">;
    }): Promise<InsightDraftValues | null> => {
      const response = await fetch("/api/insights/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(source),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        draft?: {
          title: string;
          body: string;
          recommendedAction?: string;
          category: string;
          priority: string;
        };
        tenantId?: string;
        propertyId?: string | null;
        leaseId?: string | null;
        documentIds?: string[];
      };
      if (!response.ok || !payload.draft) {
        toast.error(payload.error ?? "Could not draft an insight");
        return null;
      }
      return {
        tenantId: payload.tenantId as Id<"tenants">,
        title: payload.draft.title,
        body: payload.draft.body,
        recommendedAction: payload.draft.recommendedAction ?? "",
        category: payload.draft.category as InsightCategory,
        priority: payload.draft.priority as Priority,
        propertyId: (payload.propertyId ?? undefined) as Id<"properties"> | undefined,
        leaseId: (payload.leaseId ?? undefined) as Id<"leases"> | undefined,
        documentIds: (payload.documentIds ?? []) as Id<"documents">[],
        draftedBy: "ai",
      };
    },
    [token],
  );
}

/** Button that drafts with AI and opens the editor pre-filled. */
export function DraftInsightButton({
  source,
  children,
  variant = "outline",
}: {
  source: { documentId?: Id<"documents">; leaseId?: Id<"leases"> };
  children: ReactNode;
  variant?: "outline" | "default";
}) {
  const draftInsight = useDraftInsight();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<InsightDraftValues | null>(null);
  return (
    <>
      <Button
        variant={variant}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void draftInsight(source)
            .then((result) => result && setDraft(result))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Drafting…" : children}
      </Button>
      {draft ? (
        <InsightEditorDialog
          open
          onOpenChange={(open) => !open && setDraft(null)}
          initial={draft}
        />
      ) : null}
    </>
  );
}
