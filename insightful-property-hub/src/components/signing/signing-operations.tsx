import { useQuery } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** Platform-administrator view of open signing alerts. Alerts carry codes, never personal data. */
export function SigningOperations() {
  const alerts = useQuery(api.signingOperations.alerts, {});
  if (!alerts) return null;
  return (
    <Card className="space-y-2 p-4">
      <h2 className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" />
        Signing operations
      </h2>
      {alerts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No open alerts. Stuck jobs, unresolved deliveries, failed finalisation and near deadlines
          are checked every 30 minutes.
        </p>
      ) : (
        <ul className="space-y-2 text-xs">
          {alerts.map((alert) => (
            <li key={alert.id} className="rounded border p-2">
              <div className="flex items-center gap-2">
                <Badge variant={alert.severity === "critical" ? "destructive" : "secondary"}>
                  {alert.severity}
                </Badge>
                <span className="font-medium capitalize">{alert.kind.replaceAll("_", " ")}</span>
              </div>
              <p className="mt-1">{alert.message}</p>
              <p className="text-muted-foreground">
                {alert.company ?? "Platform"} · since {new Date(alert.firstSeenAt).toLocaleString()}
                {alert.agreementId ? ` · agreement ${alert.agreementId.slice(-8)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Response steps are in the signing operations runbook.
      </p>
    </Card>
  );
}
