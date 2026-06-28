import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { tasks, getClient } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/tasks")({
  head: () => ({ meta: [{ title: "Tasks · Megatrend OS" }, { name: "description", content: "Action items from automation, document flags and client requests." }] }),
  component: TasksPage,
});

const columns = ["To do", "In progress", "Waiting on client", "Overdue", "Completed"] as const;

const prioColor = (p: string) =>
  p === "Critical" ? "!text-destructive !border-destructive/40 !bg-destructive/10" :
  p === "High" ? "!text-warning !border-warning/40 !bg-warning/10" : "";

function TasksPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Automation · Tasks"
        title="The work that needs a human."
        description="Anything an automation, document or client surfaced — converted into a clear, owned action item."
        actions={<Button><Plus className="h-4 w-4" /> New task</Button>}
      />
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {columns.map((col) => {
          const items = tasks.filter((t) => t.status === col);
          return (
            <div key={col}>
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{col}</div>
                <div className="font-mono text-xs text-muted-foreground">{items.length}</div>
              </div>
              <div className="space-y-2">
                {items.map((t) => (
                  <Card key={t.id} className="surface-elevated p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium">{t.title}</div>
                      <span className={`tag-pill ${prioColor(t.priority)}`}>{t.priority}</span>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">{t.clientId ? getClient(t.clientId)?.name + " · " : ""}{t.assignee}</div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Due {t.due}</span>
                      <span className="rounded-full border border-border px-2 py-0.5">{t.source}</span>
                    </div>
                  </Card>
                ))}
                {items.length === 0 && <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">Nothing here</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
