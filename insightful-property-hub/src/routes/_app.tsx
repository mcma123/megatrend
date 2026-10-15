import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { LogIn, LogOut, Search, Sparkles } from "lucide-react";
import {
  AdminAssistantProvider,
  useAdminAssistant,
} from "@/components/admin-assistant/admin-assistant-context";
import { AdminAssistantSheet } from "@/components/admin-assistant/admin-assistant-sheet";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { VoiceDock } from "@/components/voice/voice-dock";
import { useCyphersoftAuth } from "@/lib/auth-session";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <StaffGate>
      <AdminAssistantProvider>
        <SidebarProvider>
          <AppFrame />
        </SidebarProvider>
      </AdminAssistantProvider>
    </StaffGate>
  );
}

/** Staff app: signed-in staff only. Client users go to their portal. */
function StaffGate({ children }: { children: ReactNode }) {
  const auth = useCyphersoftAuth();
  const navigate = useNavigate();
  // The old layout remains mounted during navigation. Never use the pending
  // destination as a new returnTo or it can redirect repeatedly to sign-in.
  const href = useRouterState({
    select: (state) =>
      state.location.href === state.resolvedLocation?.href ? state.location.href : null,
  });
  const profile = auth.profile;

  useEffect(() => {
    if (auth.isLoading || !href || href.split("?")[0] === "/sign-in") return;
    if (!auth.isAuthenticated) {
      void navigate({ to: "/sign-in", search: { returnTo: href }, replace: true });
      return;
    }
    if (profile && !profile.isStaff && profile.portals.length > 0) {
      void navigate({ to: "/portal/$clientSlug", params: { clientSlug: profile.portals[0].slug } });
    }
  }, [auth.isAuthenticated, auth.isLoading, href, navigate, profile]);

  if (!auth.isAuthenticated || !profile) {
    return <GateMessage title="Loading Cyphersoft OS…" />;
  }
  if (!profile.isStaff) {
    if (profile.portals.length > 0) {
      return <GateMessage title="Opening your client portal…" />;
    }
    return (
      <GateMessage
        title="No access yet"
        description="Your account isn't linked to Cyphersoft staff or a client portal. Ask your Cyphersoft contact for an invitation."
        action={
          <Button
            variant="outline"
            onClick={() => {
              void auth.logout({ returnTo: "/sign-in" });
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        }
      />
    );
  }
  return <>{children}</>;
}

function GateMessage({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="max-w-sm text-center">
        <p className="font-display text-xl text-foreground">{title}</p>
        {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
        {action ? <div className="mt-5 flex justify-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

function AppFrame() {
  const { expanded, open } = useAdminAssistant();

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Header />
        <div className="flex min-h-0 flex-1 min-w-0">
          {!expanded ? (
            <div className="flex min-w-0 flex-1 flex-col">
              <main className="flex-1 overflow-x-hidden px-4 py-6 md:px-8 md:py-10">
                <Outlet />
              </main>
            </div>
          ) : null}
          <AdminAssistantSheet />
          <VoiceDock assistant className={open && !expanded ? "md:right-[460px] xl:right-[500px]" : undefined} />
        </div>
      </div>
    </div>
  );
}

function Header() {
  const { open, toggleOpen } = useAdminAssistant();
  const navigate = useNavigate();
  const auth = useCyphersoftAuth();

  const initials =
    auth.profile?.name
      ?.split(" ")
      .map((name) => name[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? "JV";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md">
      <SidebarTrigger />
      <div className="ml-2 hidden items-center gap-2 md:flex">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Cypher-soft
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="font-display text-sm">Cyphersoft OS</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <form
          className="relative hidden md:block"
          onSubmit={(event) => {
            event.preventDefault();
            const query = new FormData(event.currentTarget).get("q")?.toString().trim();
            void navigate({ to: "/search", search: { q: query || undefined } });
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" placeholder="Search clients, properties, documents…" aria-label="Search" className="h-9 w-72 pl-8" />
        </form>
        <Button variant={open ? "secondary" : "default"} className="gap-2" onClick={toggleOpen}>
          <Sparkles className="h-4 w-4" />
          <span className="hidden sm:inline">
            {open ? "Close Assistant" : "Cyphersoft Assistant"}
          </span>
        </Button>
        <NotificationBell />
        {auth.isAuthenticated ? (
          <Button variant="ghost" size="sm" onClick={() => { void auth.logout({ returnTo: "/dashboard" }); }}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => { void auth.login({ returnTo: "/dashboard" }).catch(() => {}); }}>
            <LogIn className="h-4 w-4" />
            <span className="hidden sm:inline">Sign in</span>
          </Button>
        )}
        <ThemeToggle />
        <div className="ml-1 hidden h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground md:flex">
          {initials}
        </div>
      </div>
    </header>
  );
}
