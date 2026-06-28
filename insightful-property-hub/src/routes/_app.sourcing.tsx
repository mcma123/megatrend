import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Sparkles, Globe, Download, Send, Star } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clients, properties, formatZAR, formatNumber, briefs } from "@/lib/mock-data";

export const Route = createFileRoute("/_app/sourcing")({
  head: () => ({
    meta: [
      { title: "Sourcing · Megatrend OS" },
      { name: "description", content: "Type a brief, get a ranked options pack. The external bucket." },
    ],
  }),
  component: SourcingPage,
});

const propTypes = ["Office", "Logistics", "Warehouse", "Retail"] as const;
const locations = ["Sandton / Linbro", "Centurion", "CT Airport", "Durban Bayhead", "Rosebank", "Midrand"];

function SourcingPage() {
  const [clientId, setClientId] = useState(clients[0].id);
  const [type, setType] = useState<typeof propTypes[number]>("Logistics");
  const [size, setSize] = useState([10000]);
  const [location, setLocation] = useState("Sandton / Linbro");
  const [notes, setNotes] = useState("13m+ eaves preferred, ESFR sprinklers a must, yard ≥35m");
  const [generated, setGenerated] = useState(true);

  const results = useMemo(() => {
    return properties
      .filter((p) => p.type === type || type === "Logistics")
      .map((p) => ({
        ...p,
        matchScore: p.matchScore ?? Math.max(60, Math.min(99, 100 - Math.abs(p.sizeSqm - size[0]) / 400)),
      }))
      .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
      .slice(0, 6);
  }, [type, size]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Bucket 02 · External"
        title="Brief in. Options pack out."
        description="Replace the 3-hour manual cycle of pulling vacancy schedules, debating, and formatting PowerPoints. Type the brief, hit go, get a ranked pack."
        actions={
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Today's process</div>
            <div className="font-display text-3xl">
              <span className="text-muted-foreground line-through decoration-2">~3 hours</span>
            </div>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Brief form */}
        <Card className="surface-elevated p-6">
          <div className="mb-6 flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-accent text-accent-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <h2 className="font-display text-xl">New brief</h2>
          </div>

          <div className="space-y-5">
            <div>
              <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Client</Label>
              <select
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={clientId} onChange={(e) => setClientId(e.target.value)}
              >
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Property type</Label>
              <div className="mt-1.5 grid grid-cols-4 gap-2">
                {propTypes.map((t) => (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`h-10 rounded-md border text-sm transition-colors ${
                      type === t ? "border-primary bg-accent text-accent-foreground" : "border-input bg-background hover:bg-accent/50"
                    }`}
                  >{t}</button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Size: {formatNumber(size[0])} sqm</Label>
              <Slider value={size} min={500} max={25000} step={500} onValueChange={setSize} className="mt-3" />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground"><span>500</span><span>25 000</span></div>
            </div>

            <div>
              <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1.5" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {locations.map((l) => (
                  <button key={l} onClick={() => setLocation(l)} className="rounded-full border border-border bg-card px-3 py-1 text-xs hover:border-primary hover:text-primary">
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" rows={3} />
            </div>

            <Button className="w-full" onClick={() => setGenerated(true)}>
              <Sparkles className="h-4 w-4" /> Generate options pack
            </Button>
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Recent briefs</div>
            <ul className="space-y-1.5 text-sm">
              {briefs.map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent/50">
                  <span className="truncate">{clients.find(c => c.id === b.clientId)?.name} · {b.location}</span>
                  <span className="text-xs text-muted-foreground">{b.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        {/* Results */}
        <Card className="surface-elevated min-h-[600px] p-6">
          {!generated ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl border border-border bg-card">
                <Globe className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="mt-6 font-display text-2xl">Awaiting brief</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Fill in the form and hit Generate. The pack will appear here, scored and ranked.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-xl">Ranked options · {results.length}</h3>
                  <p className="text-xs text-muted-foreground">Generated in 47s · sourced from internal DB + listed inventory</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm"><Download className="h-3.5 w-3.5" /> PDF</Button>
                  <Button size="sm"><Send className="h-3.5 w-3.5" /> Send to client</Button>
                </div>
              </div>
              <ul className="space-y-3">
                {results.map((r, i) => (
                  <li key={r.id} className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-muted-foreground">#{String(i + 1).padStart(2, "0")}</span>
                          <Link to="/properties/$id" params={{ id: r.id }} className="truncate font-display text-base font-medium hover:text-primary">
                            {r.name}
                          </Link>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{r.suburb}, {r.city} · {r.landlord}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg font-medium text-primary">{Math.round(r.matchScore!)}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">match</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3 text-xs">
                      <div><div className="text-muted-foreground">Size</div><div className="font-mono">{formatNumber(r.sizeSqm)} sqm</div></div>
                      <div><div className="text-muted-foreground">Rental</div><div className="font-mono">R{r.rentalPerSqm}/sqm</div></div>
                      <div><div className="text-muted-foreground">Monthly</div><div className="font-mono">{formatZAR(r.monthlyRental)}</div></div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {r.features.slice(0, 3).map((f) => (
                          <span key={f} className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">{f}</span>
                        ))}
                      </div>
                      <Button variant="ghost" size="sm"><Star className="h-3.5 w-3.5" /> Shortlist</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
