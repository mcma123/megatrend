import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Bell, LogIn, LogOut, Search, Sparkles } from "lucide-react";
import {
  AdminAssistantProvider,
  useAdminAssistant,
} from "@/components/admin-assistant/admin-assistant-context";
import { AdminAssistantSheet } from "@/components/admin-assistant/admin-assistant-sheet";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useMegatrendAuth } from "@/lib/auth-session";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <AdminAssistantProvider>
      <SidebarProvider>
        <AppFrame />
      </SidebarProvider>
    </AdminAssistantProvider>
  );
}

function AppFrame() {
  const { expanded } = useAdminAssistant();

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
        </div>
      </div>
    </div>
  );
}

function Header() {
  const { open, toggleOpen } = useAdminAssistant();
  const auth = useMegatrendAuth();

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
        <span className="text-muted-foreground">�</span>
        <span className="font-display text-sm">Megatrend OS</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="relative hidden md:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Ask anything..." className="h-9 w-72 pl-8" />
        </div>
        <Button variant={open ? "secondary" : "default"} className="gap-2" onClick={toggleOpen}>
          <Sparkles className="h-4 w-4" />
          <span className="hidden sm:inline">
            {open ? "Close Assistant" : "Megatrend Assistant"}
          </span>
        </Button>
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-4 w-4" />
        </Button>
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
