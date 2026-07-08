import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Globe, LogIn, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { useMegatrendAuth } from "@/lib/auth-session";
import { listOrgs } from "@/lib/portal-auth";

export const Route = createFileRoute("/portal/")({
  head: () => ({
    meta: [
      { title: "Client portal · Megatrend" },
      { name: "description", content: "Sign in to your Megatrend client portal." },
    ],
  }),
  component: PortalLogin,
});

function PortalLogin() {
  const auth = useMegatrendAuth();
  const [org, setOrg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const clientSlug = org.trim().toLowerCase();
      if (!clientSlug) {
        throw new Error("Organisation code is required");
      }
      await auth.login({
        portalSlug: clientSlug,
        returnTo: `/portal/${clientSlug}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const orgs = listOrgs();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
              <Globe className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Megatrend</div>
              <div className="font-display text-base">Client portal</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">Megatrend staff?</Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-2 md:py-24">
        <div className="space-y-5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-primary">Multi-tenant access</div>
          <h1 className="font-display text-4xl leading-tight md:text-5xl">
            Your portfolio. Your team. <span className="text-primary">Your portal.</span>
          </h1>
          <p className="max-w-md text-muted-foreground">
            Each Megatrend client organisation has its own private workspace. Enter the
            organisation code Megatrend provisioned, then continue through secure sign-in.
          </p>
          <div className="rounded-lg border border-border bg-card p-4 text-sm">
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" /> Provisioned organisations
            </div>
            <ul className="space-y-1 font-mono text-xs">
              {orgs.slice(0, 4).map((o) => (
                <li key={o.slug} className="flex items-center justify-between">
                  <span className="text-foreground">{o.slug}</span>
                  <span className="text-muted-foreground">OIDC sign-in enabled</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Card className="surface-elevated p-8">
          <h2 className="font-display text-2xl">Secure sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the identity provider configured for your tenant.
          </p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="org">Organisation</Label>
              <Input
                id="org"
                placeholder="e.g. dhl-logistics-sa"
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                autoComplete="organization"
                required
              />
            </div>
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              <LogIn className="h-4 w-4" /> {loading ? "Redirecting…" : "Continue to secure sign-in"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              If your tenant has not been configured yet, ask Megatrend to complete the OIDC setup.
            </p>
          </form>
        </Card>
      </main>
    </div>
  );
}
