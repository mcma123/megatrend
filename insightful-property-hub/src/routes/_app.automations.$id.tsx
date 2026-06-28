import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { automations, renewalSteps } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/automations/$id")({
  loader: ({ params }) => {
    const a = automations.find((x) => x.id === params.id);
    if (!a) throw notFound();
    return { a };
  },
  notFoundComponent: () => <div className="p-8">Automation not found.</div>,
  component: AutomationDetail,
});

function AutomationDetail() {
  const { a } = Route.useLoaderData();
  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/automations" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Workflows</Link>
      <PageHeader eyebrow={a.category} title={a.name} description={`Trigger · ${a.trigger}`} actions={<><Switch defaultChecked={a.enabled} /><Button>Simulate</Button></>} />
      <Card className="surface-elevated p-6">
        <h3 className="font-display text-lg">Run history</h3>
        <ul className="mt-4 divide-y divide-border text-sm">
          {renewalSteps.map((s, i) => (
            <li key={i} className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">{s.title}</div>
                <div className="text-xs text-muted-foreground">{s.detail}</div>
              </div>
              <span className="font-mono text-xs text-primary">{s.offset}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
