import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import type { FunctionReturnType } from "convex/server";
import { CalendarClock, Lock, MessageSquare, Plus, Search } from "lucide-react";
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
import { validateNewFormSearch } from "@/lib/voice/new-form-search";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/_app/tasks")({
  validateSearch: validateNewFormSearch,
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

const COLUMN_ACCENTS: Record<ActionStatus, string> = {
  open: "bg-muted-foreground",
  in_progress: "bg-primary",
  waiting_on_client: "bg-warning",
  waiting_on_landlord: "bg-warning",
  waiting_on_cyphersoft: "bg-primary/60",
  completed: "bg-success",
  cancelled: "bg-muted-foreground",
};

type TaskAction = NonNullable<FunctionReturnType<typeof api.actions.list>>[number];

function TaskCard({
  action,
  isDragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  action: TaskAction;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const overdue = isOverdue(action);
  return (
    <Card
      draggable
      role="button"
      tabIndex={0}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "surface-elevated cursor-grab p-3 text-sm shadow-none transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        overdue && "border-l-2 border-l-destructive",
        isDragging && "opacity-50",
      )}
    >
      <div className="flex items-start gap-2">
        <p className="line-clamp-3 flex-1 break-words font-medium leading-snug">{action.title}</p>
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          {action.source === "client_request" ? (
            <MessageSquare className="h-3.5 w-3.5 text-primary" aria-label="Client request" />
          ) : null}
          {!action.visibleToClient ? (
            <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Internal" />
          ) : null}
        </div>
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {action.client.name}
        {action.property ? ` · ${action.property.name}` : ""}
      </p>
      <div className="mt-3 flex items-center gap-2 text-[11px]">
        <span className={cn("rounded-full border px-2 py-0.5", PRIORITY_CLASSES[action.priority])}>
          {PRIORITY_LABELS[action.priority]}
        </span>
        {action.dueDate ? (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              overdue ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            <CalendarClock className="h-3 w-3" />
            {overdue ? "Overdue · " : ""}
            {formatDate(action.dueDate)}
          </span>
        ) : null}
        {action.assigneeName ? (
          <span
            className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary"
            title={action.assigneeName}
          >
            {initials(action.assigneeName)}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function TasksPage() {
  const actions = useQuery(api.actions.list, {});
  const setStatus = useMutation(api.actions.setStatus);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "client" | "internal">("all");
  const [form, setForm] = useState<ActionFormValues | null>(null);
  const [selected, setSelected] = useState<Id<"actions"> | null>(null);
  const [dragging, setDragging] = useState<Id<"actions"> | null>(null);
  const [dropTarget, setDropTarget] = useState<ActionStatus | null>(null);
  const navigate = useNavigate();
  const search = Route.useSearch();

  // `?new=1` (used by the voice assistant) opens a blank task form.
  useEffect(() => {
    if (search.new === "1") setForm((current) => current ?? { ...EMPTY_ACTION });
  }, [search.new]);

  const closeForm = () => {
    setForm(null);
    if (search.new === "1") void navigate({ to: "/tasks", search: {}, replace: true });
  };

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
        <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
          <div className="flex w-max snap-x gap-4">
            {COLUMNS.map((column) => {
              const items = filtered.filter((action) => action.status === column);
              const isTarget = dropTarget === column && dragging !== null;
              return (
                <section
                  key={column}
                  aria-label={ACTION_STATUS_LABELS[column]}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dropTarget !== column) setDropTarget(column);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setDropTarget(null);
                    }
                  }}
                  onDrop={() => {
                    const action = (actions ?? []).find((item) => item._id === dragging);
                    if (action && action.status !== column) void move(action._id, column);
                    setDragging(null);
                    setDropTarget(null);
                  }}
                  className={cn(
                    "flex w-[280px] shrink-0 snap-start flex-col rounded-xl border bg-muted/40 transition-colors",
                    isTarget ? "border-primary/60 bg-primary/5" : "border-border",
                  )}
                >
                  <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                    <span className={cn("h-2 w-2 rounded-full", COLUMN_ACCENTS[column])} />
                    <h2 className="truncate text-sm font-medium">{ACTION_STATUS_LABELS[column]}</h2>
                    <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {items.length}
                    </span>
                  </header>
                  <div className="flex max-h-[calc(100vh-20rem)] min-h-[160px] flex-col gap-2 overflow-y-auto p-2">
                    {items.map((action) => (
                      <TaskCard
                        key={action._id}
                        action={action}
                        isDragging={dragging === action._id}
                        onDragStart={() => setDragging(action._id)}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(null);
                        }}
                        onOpen={() => setSelected(action._id)}
                      />
                    ))}
                    {items.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                        {isTarget ? "Drop here" : "Nothing here"}
                      </div>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
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
          onOpenChange={(open) => !open && closeForm()}
        />
      ) : null}
    </div>
  );
}
