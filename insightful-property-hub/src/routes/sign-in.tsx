import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Globe, LogIn, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { useCyphersoftAuth } from "@/lib/auth-session";

type SignInSearch = {
  returnTo?: string;
  portal?: string;
};

// Only allow same-site relative paths so the sign-in page can't be used as an open redirect.
function safeReturnTo(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
    portal: typeof search.portal === "string" ? search.portal : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in · Cyphersoft" },
      { name: "description", content: "Sign in to Cyphersoft OS or your client portal." },
    ],
  }),
  component: SignInPage,
});

function SignInPage() {
  const { returnTo, portal } = Route.useSearch();
  const navigate = useNavigate();
  const auth = useCyphersoftAuth();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const destination = safeReturnTo(returnTo);

  useEffect(() => {
    if (auth.isAuthenticated) {
      void navigate({ to: destination });
    }
  }, [auth.isAuthenticated, destination, navigate]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.signInWithPassword({ flow, email, password, name, portalSlug: portal });
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  };

  const isSignUp = flow === "signUp";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
              <Globe className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Cyphersoft
              </div>
              <div className="font-display text-base">
                {portal ? "Client portal" : "Cyphersoft OS"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/portal" className="text-xs text-muted-foreground hover:text-foreground">
              Client portal
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-md flex-col px-6 py-16 md:py-24">
        <Card className="surface-elevated p-8">
          <h1 className="font-display text-2xl">
            {isSignUp ? "Create your account" : "Secure sign in"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSignUp
              ? "Use the email address your Cyphersoft invitation was sent to."
              : portal
                ? `Signing in to the ${portal} workspace.`
                : "Sign in with your Cyphersoft email and password."}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-1 rounded-md border border-border p-1 text-sm">
            <button
              type="button"
              onClick={() => {
                setFlow("signIn");
                setError(null);
              }}
              className={`rounded px-3 py-1.5 ${!isSignUp ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setFlow("signUp");
                setError(null);
              }}
              className={`rounded px-3 py-1.5 ${isSignUp ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {isSignUp && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                minLength={8}
                required
              />
              {isSignUp && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
            </div>
            {(error || !auth.isConfigured) && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error ?? "Sign-in is not configured. Set VITE_CONVEX_URL first."}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={submitting || !auth.isConfigured}>
              {isSignUp ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
              {submitting ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}
