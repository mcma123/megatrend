import { createFileRoute, Link } from "@tanstack/react-router";
import { Workflow, CheckCircle2, Play } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { automations, renewalSteps } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/automations")({
  head: () => ({ meta: [{ title: "Automations · Megatrend OS" }, { name: "description", content: "Event-driven workflows for renewals, anomalies and client communication." }] }),
  component: AutomationsPage,
});

function AutomationsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Bucket 03 · Automation"
        title="Workflows that run themselves."
        description="Lease renewal cadences, anomaly detection, missing-document chasers — the operational follow-ups that used to fall through the cracks."
        actions={<Button><Play className="h-4 w-4" /> Simulate run</Button>}
      />

      {/* Renewal timeline (hero) */}
      <Card className="surface-elevated mb-8 p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="tag-pill">Featured workflow</div>
            <h3 className="mt-3 font-display text-xl">Lease renewal cadence</h3>
            <p className="text-sm text-muted-foreground">Six time-based triggers from T-180 to T-7 days before expiry.</p>
          </div>
          <Switch defaultChecked />
        </div>
        <div className="relative mt-8 overflow-x-auto">
          <div className="absolute left-0 right-0 top-[19px] h-px bg-border" />
          <ol className="relative flex min-w-[700px] justify-between">
            {renewalSteps.map((s, i) => (
              <li key={s.offset} className="flex w-full flex-col items-center px-2 text-center">
                <div className={`relative z-10 grid h-10 w-10 place-items-center rounded-full border ${i < 3 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}>
                  {i < 3 ? <CheckCircle2 className="h-4 w-4" /> : <span className="font-mono text-[10px]">{s.offset}</span>}
                </div>
                <div className="mt-2 font-mono text-[10px] text-primary">{s.offset}</div>
                <div className="mt-1 max-w-[120px] text-xs font-medium">{s.title}</div>
              </li>
            ))}
          </ol>
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {automations.map((a) => (
          <Card key={a.id} className="surface-elevated p-5">
            <div className="flex items-start justify-between">
              <div>
                <span className="tag-pill">{a.category}</span>
                <Link to="/automations/$id" params={{ id: a.id }} className="mt-2 block font-display text-lg hover:text-primary">
                  {a.name}
                </Link>
                <div className="mt-1 text-xs text-muted-foreground">Trigger · {a.trigger}</div>
              </div>
              <Switch defaultChecked={a.enabled} />
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span><Workflow className="mr-1 inline h-3 w-3" /> {a.runs} runs</span>
              <span>Last · {a.lastRun}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
