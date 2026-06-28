import { createFileRoute, Link, notFound, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Globe, LogOut, LayoutDashboard, Users as UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { getClientBySlug } from "@/lib/mock-data";
import { getSession, clearSession, type PortalSession } from "@/lib/portal-auth";

export const Route = createFileRoute("/portal/$clientSlug")({
  loader: ({ params }) => {
    const client = getClientBySlug(params.clientSlug);
    if (!client) throw notFound();
    return { client };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.client.name ?? "Client"} portal · Megatrend` },
      { name: "description", content: `Live portfolio portal for ${loaderData?.client.name}.` },
    ],
  }),
  notFoundComponent: () => <div className="p-8">Client portal not found.</div>,
  component: ClientPortalShell,
});

function ClientPortalShell() {
  const { client } = Route.useLoaderData();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s || s.orgSlug !== client.slug) {
      navigate({ to: "/portal" });
      return;
    }
    setSession(s);
    setReady(true);
  }, [client.slug, navigate]);

  if (!ready || !session) return null;

  const logout = () => { clearSession(); navigate({ to: "/portal" }); };
  const onTeam = pathname.endsWith("/team");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground"><Globe className="h-4 w-4" /></div>
            <div className="leading-tight">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Client portal</div>
              <div className="font-display text-base">{client.name}</div>
            </div>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            <Link to="/portal/$clientSlug" params={{ clientSlug: client.slug }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 ${!onTeam ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <LayoutDashboard className="h-3.5 w-3.5" /> Portfolio
            </Link>
            <Link to="/portal/$clientSlug/team" params={{ clientSlug: client.slug }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 ${onTeam ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <UsersIcon className="h-3.5 w-3.5" /> Team
            </Link>
            <ThemeToggle />
            <span className="ml-2 hidden text-xs text-muted-foreground md:inline">{session.fullName}</span>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground text-xs">
              {session.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <Button variant="ghost" size="sm" onClick={logout}><LogOut className="h-4 w-4" /> Sign out</Button>
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
