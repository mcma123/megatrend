import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";
import { errorMessage } from "@/lib/portfolio";
import {
  ACTION_STATUS_LABELS,
  PRIORITY_LABELS,
  type ActionStatus,
  type Priority,
} from "@/lib/workflow";
import { toFormStrings, useVoiceForm } from "@/lib/voice/form-registry";
import { actionVoiceFields } from "@/lib/voice/forms";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type ActionFormValues = {
  actionId?: Id<"actions">;
  tenantId?: Id<"tenants">;
  title: string;
  description: string;
  propertyId?: Id<"properties">;
  documentId?: Id<"documents">;
  dueDate: string;
  priority: Priority;
  assignedTo?: Id<"users">;
  visibleToClient: boolean;
  status: ActionStatus;
};

export const EMPTY_ACTION: ActionFormValues = {
  title: "",
  description: "",
  dueDate: "",
  priority: "medium",
  visibleToClient: false,
  status: "open",
};

/** Staff: create or edit a task. Clients (`audience="client"`): submit a request. */
export function ActionFormDialog({
  open,
  onOpenChange,
  initial,
  audience,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ActionFormValues;
  audience: "staff" | "client";
}) {
  const isEdit = Boolean(initial.actionId);
  const isStaff = audience === "staff";
  const [values, setValues] = useState<ActionFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const createAction = useMutation(api.actions.create);
  const updateAction = useMutation(api.actions.update);
  const clients = useQuery(api.clients.list, open && isStaff && !initial.tenantId ? {} : "skip");
  const tenantId = values.tenantId;
  const properties = useQuery(api.properties.list, open && tenantId ? { tenantId } : "skip");
  const assignees = useQuery(
    api.actions.listAssignees,
    open && isStaff && tenantId ? { tenantId } : "skip",
  );

  useEffect(() => {
    if (open) {
      setValues(initial);
      setError(null);
    }
  }, [open, initial]);

  const set = <K extends keyof ActionFormValues>(key: K, value: ActionFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  // Staff tasks are voice-fillable. Client fields (property, document, assignee) stay manual.
  const formRef = useRef<HTMLFormElement>(null);
  useVoiceForm({
    formRef,
    formId: isEdit ? "action.edit" : "action.create",
    title: isEdit ? "Edit task" : "New task",
    enabled: open && isStaff,
    fields: actionVoiceFields({
      clients: initial.tenantId
        ? undefined
        : (clients ?? []).map((client) => ({ value: client.tenantId, label: client.name })),
    }),
    values,
    setValues: (patch) =>
      setValues((current) => ({
        ...current,
        ...(toFormStrings(patch) as Partial<ActionFormValues>),
      })),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!values.tenantId) {
      setError("Choose a client");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (values.actionId) {
        await updateAction({
          actionId: values.actionId,
          title: values.title,
          description: values.description || undefined,
          propertyId: values.propertyId,
          documentId: values.documentId,
          dueDate: values.dueDate || undefined,
          priority: values.priority,
          assignedTo: values.assignedTo,
          visibleToClient: values.visibleToClient,
        });
        toast.success("Task updated");
      } else {
        await createAction({
          tenantId: values.tenantId,
          title: values.title,
          description: values.description || undefined,
          propertyId: values.propertyId,
          documentId: values.documentId,
          dueDate: values.dueDate || undefined,
          priority: values.priority,
          ...(isStaff
            ? {
                assignedTo: values.assignedTo,
                visibleToClient: values.visibleToClient,
                status: values.status,
              }
            : {}),
        });
        toast.success(isStaff ? "Task created" : "Request sent to your Cyphersoft team");
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
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit task" : isStaff ? "New task" : "New request"}</DialogTitle>
          <DialogDescription>
            {isStaff
              ? "Internal tasks stay with Cyphersoft. Tick “Show in client portal” for actions the client should see."
              : "Ask your Cyphersoft team for a quote, a change or help. You'll be notified when they reply."}
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={submit} className="space-y-4">
          {isStaff && !initial.tenantId ? (
            <Field label="Client" htmlFor="action-client">
              <NativeSelect
                id="action-client"
                value={values.tenantId ?? ""}
                onChange={(e) =>
                  setValues((current) => ({
                    ...current,
                    tenantId: (e.target.value || undefined) as Id<"tenants"> | undefined,
                    propertyId: undefined,
                    assignedTo: undefined,
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
          <Field label="Title" htmlFor="action-title">
            <Input
              id="action-title"
              required
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
          <Field label="Details" htmlFor="action-description">
            <Textarea
              id="action-description"
              rows={3}
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Property" htmlFor="action-property">
              <NativeSelect
                id="action-property"
                value={values.propertyId ?? ""}
                onChange={(e) =>
                  set("propertyId", (e.target.value || undefined) as Id<"properties"> | undefined)
                }
                disabled={!tenantId}
              >
                <option value="">None</option>
                {properties?.map((property) => (
                  <option key={property._id} value={property._id}>
                    {property.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Due date" htmlFor="action-due">
              <Input
                id="action-due"
                type="date"
                value={values.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
              />
            </Field>
            <Field label="Priority" htmlFor="action-priority">
              <NativeSelect
                id="action-priority"
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
            {isStaff ? (
              <Field label="Assignee" htmlFor="action-assignee">
                <NativeSelect
                  id="action-assignee"
                  value={values.assignedTo ?? ""}
                  onChange={(e) =>
                    set("assignedTo", (e.target.value || undefined) as Id<"users"> | undefined)
                  }
                  disabled={!tenantId}
                >
                  <option value="">Unassigned</option>
                  {assignees?.map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            {isStaff && !isEdit ? (
              <Field label="Status" htmlFor="action-status">
                <NativeSelect
                  id="action-status"
                  value={values.status}
                  onChange={(e) => set("status", e.target.value as ActionStatus)}
                >
                  {Object.entries(ACTION_STATUS_LABELS)
                    .filter(([value]) => value !== "cancelled" && value !== "completed")
                    .map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
            ) : null}
          </div>
          {isStaff ? (
            <div className="flex items-start gap-2 rounded-md border border-border p-3">
              <Checkbox
                id="action-visible"
                checked={values.visibleToClient}
                onCheckedChange={(checked) => set("visibleToClient", checked === true)}
              />
              <Label
                htmlFor="action-visible"
                className="text-xs font-normal leading-5 text-muted-foreground"
              >
                Show in client portal (the client can see, reply and mark it complete)
              </Label>
            </div>
          ) : null}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : isStaff
                    ? "Create task"
                    : "Send request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
