import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { PROPERTY_TYPE_LABELS, formatZAR, type PropertyType } from "@/lib/portfolio";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/_app/reports")({
  head: () => ({
    meta: [
      { title: "Reports & ROI · Cyphersoft OS" },
      {
        name: "description",
        content: "Portfolio analytics, renewal exposure and ROI of the system itself.",
      },
    ],
  }),
  component: ReportsPage,
});

function Bars({ rows }: { rows: Array<{ label: string; value: number; detail?: string }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="mt-4 space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1 flex justify-between gap-3 text-xs">
            <span>{row.label}</span>
            <span className="font-mono">{row.detail ?? formatZAR(row.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ReportsPage() {
  const report = useQuery(api.reports.portfolio);
  // Minutes a person spends reading and capturing one document by hand (editable assumption).
  const [manualMinutes, setManualMinutes] = useState([25]);
  const [rate, setRate] = useState([850]);
  const [monthlyCost, setMonthlyCost] = useState([15000]);

  const roi = useMemo(() => {
    const docsPerMonth = report?.totals.documentsLast30Days ?? 0;
    const hoursSaved = (docsPerMonth * manualMinutes[0]) / 60;
    const monthlyValue = hoursSaved * rate[0];
    const payback = monthlyValue > 0 ? monthlyCost[0] / monthlyValue : null;
    return { docsPerMonth, hoursSaved, monthlyValue, annual: monthlyValue * 12, payback };
  }, [report, manualMinutes, rate, monthlyCost]);

  if (report === undefined) return <LoadingState label="Loading reports…" />;
  const { totals } = report;
  const approvalRate = totals.fieldsExtracted
    ? Math.round((totals.fieldsApproved / totals.fieldsExtracted) * 100)
    : null;
  const correctionRate = totals.fieldsApproved
    ? Math.round((totals.fieldsCorrected / totals.fieldsApproved) * 100)
    : null;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Reports · Analytics"
        title="The business, in numbers."
        description="Portfolio value, renewal pipeline and document intelligence — calculated from live records."
      />

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { l: "Clients", v: String(totals.clients) },
          { l: "Annual rental (live leases)", v: formatZAR(totals.annualRental) },
          { l: "Live leases", v: String(totals.liveLeases) },
          { l: "Excess charges flagged", v: formatZAR(totals.anomalyExcess) },
        ].map((s) => (
          <Card key={s.l} className="surface-elevated p-5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {s.l}
            </div>
            <div className="mt-2 font-display text-3xl">{s.v}</div>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Annual rental by region</h3>
          {report.byRegion.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No live leases yet" />
            </div>
          ) : (
            <Bars
              rows={report.byRegion.map((row) => ({ label: row.region, value: row.annualRental }))}
            />
          )}
        </Card>
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">By property type</h3>
          {report.byPropertyType.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No live leases yet" />
            </div>
          ) : (
            <Bars
              rows={report.byPropertyType.map((row) => ({
                label: PROPERTY_TYPE_LABELS[row.type as PropertyType] ?? row.type,
                value: row.annualRental,
              }))}
            />
          )}
        </Card>
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Renewals by year</h3>
          {report.renewalsByYear.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No live leases yet" />
            </div>
          ) : (
            <Bars
              rows={report.renewalsByYear.map((row) => ({
                label: row.year,
                value: row.annualRental,
                detail: `${row.count} lease${row.count === 1 ? "" : "s"} · ${formatZAR(row.annualRental)}`,
              }))}
            />
          )}
        </Card>
      </div>

      <Card className="surface-elevated mt-8 p-6">
        <h3 className="font-display text-lg">Document intelligence</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { l: "Documents processed", v: String(totals.documentsProcessed) },
            { l: "Last 30 days", v: String(totals.documentsLast30Days) },
            {
              l: "Median processing time",
              v:
                totals.medianProcessingSeconds !== null
                  ? `${Math.round(totals.medianProcessingSeconds)} s`
                  : "—",
            },
            {
              l: "Fields approved",
              v: approvalRate !== null ? `${totals.fieldsApproved} (${approvalRate}%)` : "—",
            },
            { l: "Corrected by staff", v: correctionRate !== null ? `${correctionRate}%` : "—" },
          ].map((s) => (
            <div key={s.l} className="rounded-md border border-border p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {s.l}
              </div>
              <div className="mt-1 font-display text-xl">{s.v}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="surface-elevated mt-8 p-6">
        <div className="tag-pill">ROI calculator</div>
        <h3 className="mt-3 font-display text-2xl">What the system pays back.</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Based on the {roi.docsPerMonth} documents processed in the last 30 days. Adjust the
          assumptions below.
        </p>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="space-y-5">
            <div>
              <Label className="text-xs">
                Manual minutes per document:{" "}
                <span className="font-mono text-primary">{manualMinutes[0]}</span>
              </Label>
              <Slider
                value={manualMinutes}
                min={5}
                max={90}
                step={5}
                onValueChange={setManualMinutes}
                className="mt-2"
              />
            </div>
            <div>
              <Label className="text-xs">
                Blended hourly rate (ZAR):{" "}
                <span className="font-mono text-primary">R{rate[0]}</span>
              </Label>
              <Slider
                value={rate}
                min={300}
                max={2000}
                step={50}
                onValueChange={setRate}
                className="mt-2"
              />
            </div>
            <div>
              <Label className="text-xs">
                System cost per month (ZAR):{" "}
                <span className="font-mono text-primary">{formatZAR(monthlyCost[0])}</span>
              </Label>
              <Slider
                value={monthlyCost}
                min={0}
                max={100000}
                step={1000}
                onValueChange={setMonthlyCost}
                className="mt-2"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { l: "Hours saved / month", v: roi.hoursSaved.toFixed(1) },
              { l: "Value / month", v: formatZAR(roi.monthlyValue) },
              { l: "Value / year", v: formatZAR(roi.annual) },
              {
                l: "Payback period",
                v: roi.payback !== null ? `${roi.payback.toFixed(1)} mo` : "—",
              },
            ].map((s) => (
              <Card key={s.l} className="surface-elevated p-4">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {s.l}
                </div>
                <div className="mt-2 font-display text-2xl">{s.v}</div>
              </Card>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
