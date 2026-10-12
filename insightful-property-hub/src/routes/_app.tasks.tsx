import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Lock, MessageSquare, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionDetailDialog } from "@/components/actions/action-detail-dialog";
import {
  ActionFormDialog,
  EMPTY_ACTION,
  type ActionFormValues,
} from "@/components/actions/action-form-dialog";
import { LoadingState, NativeSelect } from "@/components/portfolio/form-fields";
import { errorMessage, formatDate } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import {
  ACTION_STATUS_LABELS,
  PRIORITY_CLASSES,
  PRIORITY_LABELS,
  isOverdue,
  type ActionStatus,
} from "@/lib/workflow";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/_app/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks · Cyphersoft OS" },
      {
        name: "description",
        content: "Action items from automation, document flags and client requests.",
      },
    ],
  }),
  component: TasksPage,
});

const COLUMNS: ActionStatus[] = [
  "open",
  "in_progress",
  "waiting_on_client",
  "waiting_on_landlord",
  "waiting_on_cyphersoft",
  "completed",
];

function TasksPage() {
  const actions = useQuery(api.actions.list, {});
  const setStatus = useMutation(api.actions.setStatus);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "client" | "internal">("all");
  const [form, setForm] = useState<ActionFormValues | null>(null);
  const [selected, setSelected] = useState<Id<"actions"> | null>(null);
  const [dragging, setDragging] = useState<Id<"actions"> | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (actions ?? []).filter(
      (action) =>
        action.status !== "cancelled" &&
        (scope === "all" ||
          (scope === "client" ? action.visibleToClient : !action.visibleToClient)) &&
        (!q ||
          [action.title, action.client.name, action.property?.name ?? ""].some((value) =>
            value.toLowerCase().includes(q),
          )),
    );
  }, [actions, query, scope]);

  const overdue = filtered.filter(isOverdue).length;

  const move = async (actionId: Id<"actions">, status: ActionStatus) => {
    try {
      await setStatus({ actionId, status });
    } catch (moveError) {
      toast.error(errorMessage(moveError));
    }
  };

  const openEdit = () => {
    const action = (actions ?? []).find((item) => item._id === selected);
    if (!action) return;
    setForm({
      actionId: action._id,
      tenantId: action.tenantId,
      title: action.title,
      description: action.description ?? "",
      propertyId: action.propertyId,
      documentId: action.documentId,
      dueDate: action.dueDate ?? "",
      priority: action.priority,
      assignedTo: action.assignedTo,
      visibleToClient: action.visibleToClient,
      status: action.status,
    });
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        eyebrow="Automation · Tasks"
        title="Work in motion."
        description="Client requests, document follow-ups and internal tasks in one board. Drag a card to another column or open it to reply."
        actions={
          <Button onClick={() => setForm({ ...EMPTY_ACTION })}>
            <Plus className="h-4 w-4" /> New task
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, clients, properties…"
            className="pl-9"
          />
        </div>
        <NativeSelect
          className="w-auto"
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
          aria-label="Visibility"
        >
          <option value="all">All tasks</option>
          <option value="client">Client-visible</option>
          <option value="internal">Internal only</option>
        </NativeSelect>
        {overdue > 0 ? (
          <span className="text-sm font-medium text-destructive">{overdue} overdue</span>
        ) : null}
      </div>

      {actions === undefined ? (
        <LoadingState label="Loading tasks…" />
      ) : (
        <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-3 xl:grid-cols-6">
          {COLUMNS.map((column) => {
            const items = filtered.filter((action) => action.status === column);
            return (
              <div
                key={column}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragging) void move(dragging, column);
                  setDragging(null);
                }}
                className="min-w-[220px] rounded-xl border border-border bg-muted/30 p-2"
              >
                <div className="mb-2 flex items-center justify-between px-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  <span>{ACTION_STATUS_LABELS[column]}</span>
                  <span>{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((action) => (
                    <Card
                      key={action._id}
                      draggable
                      onDragStart={() => setDragging(action._id)}
                      onClick={() => setSelected(action._id)}
                      className="surface-elevated cursor-pointer p-3 text-sm transition-colors hover:border-primary/40"
                    >
                      <div className="font-medium leading-snug">{action.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {action.client.name}
                        {action.property ? ` · ${action.property.name}` : ""}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span
                          className={cn(
                            "rounded-full border px-1.5 py-0.5",
                            PRIORITY_CLASSES[action.priority],
                          )}
                        >
                          {PRIORITY_LABELS[action.priority]}
                        </span>
                        {action.dueDate ? (
                          <span
                            className={
                              isOverdue(action)
                                ? "font-medium text-destructive"
                                : "text-muted-foreground"
                            }
                          >
                            {isOverdue(action) ? "Overdue " : ""}
                            {formatDate(action.dueDate)}
                          </span>
                        ) : null}
                        {!action.visibleToClient ? (
                          <Lock className="h-3 w-3 text-muted-foreground" aria-label="Internal" />
                        ) : null}
                        {action.source === "client_request" ? (
                          <MessageSquare
                            className="h-3 w-3 text-primary"
                            aria-label="Client request"
                          />
                        ) : null}
                      </div>
                      {action.assigneeName ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {action.assigneeName}
                        </div>
                      ) : null}
                    </Card>
                  ))}
                  {items.length === 0 ? (
                    <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                      Nothing here
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ActionDetailDialog
        actionId={selected}
        audience="staff"
        onClose={() => setSelected(null)}
        onEdit={() => {
          openEdit();
          setSelected(null);
        }}
      />
      {form ? (
        <ActionFormDialog
          open
          audience="staff"
          initial={form}
          onOpenChange={(open) => !open && setForm(null)}
        />
      ) : null}
    </div>
  );
}
