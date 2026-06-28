import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { invoices, getClient, getProperty, formatZAR } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/invoices")({
  head: () => ({ meta: [{ title: "Invoices & anomalies · Megatrend OS" }, { name: "description", content: "Invoice tracking with baseline anomaly detection." }] }),
  component: InvoicesPage,
});

const sevColor = (s: string) =>
  s === "Critical" ? "!text-destructive !border-destructive/40 !bg-destructive/10" :
  s === "High" ? "!text-warning !border-warning/40 !bg-warning/10" :
  s === "Medium" ? "" : "!text-muted-foreground !border-border";

function InvoicesPage() {
  const anomalies = invoices.filter((i) => i.severity === "High" || i.severity === "Critical");
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Internal · Invoices"
        title="Invoices, baselined."
        description="Each invoice scored against a 24-month baseline. Anomalies bubble up before they hit the client."
      />
      {anomalies.length > 0 && (
        <Card className="surface-elevated mb-6 border-warning/40 bg-warning/5 p-5">
          <div className="flex items-center gap-2 text-warning"><AlertTriangle className="h-4 w-4" /><span className="font-medium">{anomalies.length} active anomalies</span></div>
          <ul className="mt-3 space-y-2 text-sm">
            {anomalies.map((i) => (
              <li key={i.id}>
                <strong>{getClient(i.clientId)?.name}</strong> · {getProperty(i.propertyId)?.name}: {i.supplier} <span className="font-mono">+{Math.round(i.delta * 100)}%</span> — <span className="text-muted-foreground">{i.cause}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="surface-elevated overflow-x-auto p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="py-3 pr-3">Client</th><th className="py-3 pr-3">Property</th>
              <th className="py-3 pr-3">Supplier</th><th className="py-3 pr-3">Month</th>
              <th className="py-3 pr-3 text-right">Amount</th><th className="py-3 pr-3 text-right">Baseline</th>
              <th className="py-3 pr-3 text-right">Δ</th><th className="py-3 pr-3">Severity</th><th className="py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-b border-border/50 hover:bg-accent/30">
                <td className="py-3 pr-3"><Link to="/clients/$id" params={{ id: i.clientId }} className="hover:text-primary">{getClient(i.clientId)?.name}</Link></td>
                <td className="py-3 pr-3 text-muted-foreground">{getProperty(i.propertyId)?.name}</td>
                <td className="py-3 pr-3">{i.supplier}</td>
                <td className="py-3 pr-3 font-mono text-xs">{i.month}</td>
                <td className="py-3 pr-3 text-right font-mono">{formatZAR(i.amount)}</td>
                <td className="py-3 pr-3 text-right font-mono text-muted-foreground">{formatZAR(i.baseline)}</td>
                <td className="py-3 pr-3 text-right font-mono">{i.delta > 0 ? "+" : ""}{Math.round(i.delta * 100)}%</td>
                <td className="py-3 pr-3"><span className={`tag-pill ${sevColor(i.severity)}`}>{i.severity}</span></td>
                <td className="py-3 text-xs text-muted-foreground">{i.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
