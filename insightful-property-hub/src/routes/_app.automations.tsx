import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Play, Workflow } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { LoadingState } from "@/components/portfolio/form-fields";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { errorMessage } from "@/lib/portfolio";
import { timeAgo } from "@/lib/workflow";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/_app/automations")({
  head: () => ({
    meta: [
      { title: "Automations · Cyphersoft OS" },
      {
        name: "description",
        content: "Renewal cadence, overdue reminders and invoice anomaly checks.",
      },
    ],
  }),
  component: AutomationsPage,
});

type AutomationKey = Doc<"automations">["key"];

function AutomationsPage() {
  const automations = useQuery(api.automations.list);
  const setEnabled = useMutation(api.automations.setEnabled);
  const simulate = useMutation(api.automations.simulate);
  const auth = useCyphersoftAuth();
  const canManage = auth.profile?.isPlatformAdmin === true;

  const toggle = async (key: AutomationKey, enabled: boolean) => {
    try {
      await setEnabled({ key, enabled });
      toast.success(enabled ? "Automation enabled" : "Automation paused");
    } catch (toggleError) {
      toast.error(errorMessage(toggleError));
    }
  };

  const dryRun = async (key: AutomationKey) => {
    try {
      const result = await simulate({ key });
      const fired = result.stats.stepsFired ?? result.stats.remindersSent ?? 0;
      toast.success(
        `Dry run recorded: ${fired} item${fired === 1 ? "" : "s"} would run now. See the run history.`,
      );
    } catch (runError) {
      toast.error(errorMessage(runError));
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Automation · Workflows"
        title="Workflows that run themselves."
        description="The lease renewal cadence and overdue reminders run every morning; invoice checks run whenever an invoice review is completed. Every run is recorded."
        actions={
          <Button variant="outline" onClick={() => void dryRun("renewal_cadence")}>
            <Play className="h-4 w-4" /> Simulate renewal run
          </Button>
        }
      />

      {automations === undefined ? (
        <LoadingState label="Loading automations…" />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {automations.map((automation) => (
            <Card key={automation.key} className="surface-elevated flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="tag-pill">{automation.category}</span>
                  <Link
                    to="/automations/$id"
                    params={{ id: automation.key }}
                    className="mt-2 block font-display text-lg hover:text-primary"
                  >
                    {automation.name}
                  </Link>
                </div>
                <Switch
                  checked={automation.enabled}
                  disabled={!canManage}
                  onCheckedChange={(checked) => void toggle(automation.key, checked)}
                  aria-label={`${automation.enabled ? "Pause" : "Enable"} ${automation.name}`}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{automation.trigger}</p>
              <p className="mt-3 flex-1 text-sm text-muted-foreground">{automation.description}</p>
              <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>
                    <Workflow className="mr-1 inline h-3 w-3" /> {automation.runCount} run
                    {automation.runCount === 1 ? "" : "s"}
                  </span>
                  <span>
                    {automation.lastRunAt
                      ? `Last · ${timeAgo(automation.lastRunAt)}`
                      : "Not run yet"}
                  </span>
                </div>
                {automation.lastRunSummary ? (
                  <p className="mt-1">{automation.lastRunSummary}</p>
                ) : null}
                {!automation.enabled ? <p className="mt-1 text-warning">Paused</p> : null}
              </div>
              <div className="mt-3 flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/automations/$id" params={{ id: automation.key }}>
                    History
                  </Link>
                </Button>
                {automation.canRunManually ? (
                  <Button size="sm" variant="ghost" onClick={() => void dryRun(automation.key)}>
                    <Play className="h-3.5 w-3.5" /> Simulate
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
      {!canManage ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Only platform admins can pause or enable automations.
        </p>
      ) : null}
    </div>
  );
}
