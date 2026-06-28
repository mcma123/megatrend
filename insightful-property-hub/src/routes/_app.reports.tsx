import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { clients, leases, properties, formatZAR } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/reports")({
  head: () => ({ meta: [{ title: "Reports & ROI · Megatrend OS" }, { name: "description", content: "Portfolio analytics, renewal exposure and ROI of the system itself." }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const [hours, setHours] = useState([12]);
  const [consultants, setConsultants] = useState([5]);
  const [rate, setRate] = useState([850]);

  const roi = useMemo(() => {
    const hoursSaved = hours[0] * consultants[0] * 4;
    const monthlyValue = hoursSaved * rate[0];
    const annual = monthlyValue * 12;
    const cost = 45_000 * 12;
    const payback = cost / monthlyValue;
    return { hoursSaved, monthlyValue, annual, payback };
  }, [hours, consultants, rate]);

  const byRegion = properties.reduce<Record<string, number>>((acc, p) => {
    acc[p.province] = (acc[p.province] ?? 0) + p.monthlyRental * 12;
    return acc;
  }, {});
  const regionMax = Math.max(...Object.values(byRegion));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Reports · Analytics"
        title="The business, in numbers."
        description="Portfolio value, renewal pipeline, anomalies caught — and the ROI of the system itself."
      />

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { l: "Clients managed", v: clients.length },
          { l: "Total annual rental", v: formatZAR(clients.reduce((s, c) => s + c.annualRental, 0)) },
          { l: "Active leases", v: leases.length },
        ].map((s) => (
          <Card key={s.l} className="surface-elevated p-5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{s.l}</div>
            <div className="mt-2 font-display text-3xl">{s.v}</div>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Annual rental by region</h3>
          <ul className="mt-4 space-y-3">
            {Object.entries(byRegion).map(([region, value]) => (
              <li key={region}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{region}</span>
                  <span className="font-mono">{formatZAR(value)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${(value / regionMax) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Renewals by year</h3>
          <ul className="mt-4 space-y-3">
            {["2025", "2026", "2027", "2028"].map((y) => {
              const n = leases.filter((l) => l.end.startsWith(y)).length;
              return (
                <li key={y} className="flex items-center gap-3">
                  <span className="font-mono w-12 text-xs">{y}</span>
                  <div className="h-2 flex-1 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${(n / leases.length) * 100 * 2}%` }} />
                  </div>
                  <span className="font-mono w-6 text-right text-xs">{n}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {/* ROI calculator */}
      <Card className="surface-elevated mt-8 p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="tag-pill">ROI calculator</div>
            <h3 className="mt-3 font-display text-2xl">What the system pays back.</h3>
          </div>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="space-y-5">
            <div>
              <Label className="text-xs">Hours saved per consultant / week: <span className="font-mono text-primary">{hours[0]}</span></Label>
              <Slider value={hours} min={2} max={30} step={1} onValueChange={setHours} className="mt-2" />
            </div>
            <div>
              <Label className="text-xs">Consultants in scope: <span className="font-mono text-primary">{consultants[0]}</span></Label>
              <Slider value={consultants} min={1} max={20} step={1} onValueChange={setConsultants} className="mt-2" />
            </div>
            <div>
              <Label className="text-xs">Blended hourly rate (ZAR): <span className="font-mono text-primary">R{rate[0]}</span></Label>
              <Slider value={rate} min={300} max={2000} step={50} onValueChange={setRate} className="mt-2" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Card className="surface-elevated p-4">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Hours saved / month</div>
              <div className="mt-2 font-display text-2xl">{roi.hoursSaved.toLocaleString()}</div>
            </Card>
            <Card className="surface-elevated p-4">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Value / month</div>
              <div className="mt-2 font-display text-2xl">{formatZAR(roi.monthlyValue)}</div>
            </Card>
            <Card className="surface-elevated p-4">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Value / year</div>
              <div className="mt-2 font-display text-2xl">{formatZAR(roi.annual)}</div>
            </Card>
            <Card className="surface-elevated p-4">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Payback period</div>
              <div className="mt-2 font-display text-2xl">{roi.payback.toFixed(1)} mo</div>
            </Card>
          </div>
        </div>
      </Card>
    </div>
  );
}
