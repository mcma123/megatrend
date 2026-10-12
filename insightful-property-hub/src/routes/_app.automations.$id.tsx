import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, Lock, Play, Zap } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { formatTimestamp } from "@/lib/documents";
import { errorMessage, formatDate } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/_app/automations/$id")({
  head: () => ({ meta: [{ title: "Automation · Cyphersoft OS" }] }),
  component: AutomationDetail,
});

type AutomationKey = Doc<"automations">["key"];
const KEYS: AutomationKey[] = ["renewal_cadence", "overdue_reminders", "invoice_anomaly_check"];
const MODE_LABELS: Record<Doc<"automationRuns">["mode"], string> = {
  scheduled: "Scheduled",
  manual: "Run now",
  dry_run: "Dry run",
  event: "Event",
};

function AutomationDetail() {
  const { id } = Route.useParams();
  const key = KEYS.includes(id as AutomationKey) ? (id as AutomationKey) : null;
  const automation = useQuery(api.automations.get, key ? { key } : "skip");
  const simulate = useMutation(api.automations.simulate);
  const runNow = useMutation(api.automations.runNow);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!key || automation === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Automation not found"
          action={
            <Button asChild variant="outline">
              <Link to="/automations">All automations</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (automation === undefined) return <LoadingState label="Loading automation…" />;

  const run = async (mode: "dry" | "real") => {
    if (
      mode === "real" &&
      !window.confirm(
        "Run now for real? This creates actions and sends notifications for every client.",
      )
    )
      return;
    setBusy(true);
    try {
      await (mode === "dry" ? simulate({ key }) : runNow({ key }));
      toast.success(mode === "dry" ? "Dry run recorded" : "Run complete");
    } catch (runError) {
      toast.error(errorMessage(runError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        to="/automations"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Automations
      </Link>
      <PageHeader
        eyebrow={`${automation.category} · ${automation.enabled ? "Enabled" : "Paused"}`}
        title={automation.name}
        description={`${automation.description} Trigger: ${automation.trigger}.`}
        actions={
          automation.canRunManually ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => void run("dry")}>
                <Play className="h-4 w-4" /> Simulate
              </Button>
              {automation.canManage ? (
                <Button disabled={busy || !automation.enabled} onClick={() => void run("real")}>
                  <Zap className="h-4 w-4" /> Run now
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {automation.steps.length > 0 ? (
        <Card className="surface-elevated mb-6 p-6">
          <h3 className="font-display text-lg">Cadence</h3>
          <div className="relative mt-6 overflow-x-auto">
            <div className="absolute left-0 right-0 top-[19px] h-px bg-border" />
            <ol className="relative flex min-w-[640px] justify-between">
              {automation.steps.map((step) => (
                <li
                  key={step.daysBefore}
                  className="flex w-full flex-col items-center px-2 text-center"
                >
                  <div className="relative z-10 grid h-10 w-10 place-items-center rounded-full border border-primary bg-card text-primary">
                    <span className="font-mono text-[10px]">T-{step.daysBefore}</span>
                  </div>
                  <div className="mt-2 max-w-[130px] text-xs font-medium">{step.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {step.visibleToClient ? "client + staff" : "staff task"}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      ) : null}

      {automation.upcoming.length > 0 ? (
        <Card className="surface-elevated mb-6 p-6">
          <h3 className="font-display text-lg">Coming up (next 120 days)</h3>
          <ul className="mt-3 divide-y divide-border text-sm">
            {automation.upcoming.map((item) => (
              <li
                key={`${item.leaseId}-${item.daysBefore}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <Link
                    to="/leases/$id"
                    params={{ id: item.leaseId }}
                    className="font-medium hover:text-primary"
                  >
                    {item.propertyName}
                  </Link>
                  <span className="text-muted-foreground">
                    {" "}
                    · {item.client.name} · T-{item.daysBefore} {item.title}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-xs text-primary">
                  {formatDate(item.dueDate)} · in {item.inDays} d
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="surface-elevated p-6">
        <h3 className="font-display text-lg">Run history</h3>
        {automation.runs.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No runs yet"
              description="Runs appear after the next scheduled time, a manual run, or a simulation."
            />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {automation.runs.map((run) => {
              const open = expanded === run._id;
              return (
                <li key={run._id} className="py-3">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 text-left"
                    onClick={() => setExpanded(open ? null : run._id)}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5",
                            run.mode === "dry_run"
                              ? "border-border text-muted-foreground"
                              : "border-primary/30 text-primary",
                          )}
                        >
                          {MODE_LABELS[run.mode]}
                        </span>
                        <span
                          className={run.status === "failed" ? "text-destructive" : "text-success"}
                        >
                          {run.status === "failed" ? "Failed" : "Succeeded"}
                        </span>
                        <span className="text-muted-foreground">
                          {formatTimestamp(run.startedAt)}
                          {run.triggeredByName ? ` · ${run.triggeredByName}` : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">{run.summary}</p>
                      {run.error ? <p className="text-xs text-destructive">{run.error}</p> : null}
                    </div>
                    <ChevronDown
                      className={cn(
                        "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                        open && "rotate-180",
                      )}
                    />
                  </button>
                  {open ? (
                    <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                        {Object.entries(run.stats).map(([stat, value]) => (
                          <span key={stat}>
                            {stat.replace(/([A-Z])/g, " $1").toLowerCase()}:{" "}
                            <span className="font-mono text-foreground">{value}</span>
                          </span>
                        ))}
                      </div>
                      {run.items.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {run.items.map((item, index) => (
                            <li key={index}>
                              <span className="font-medium">{item.label}</span> —{" "}
                              <span className="text-muted-foreground">{item.detail}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {!automation.canManage && automation.canRunManually ? (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" /> Only platform admins can run automations for real.
        </p>
      ) : null}
    </div>
  );
}
