import { createFileRoute, Link, notFound, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  FileText,
  Globe,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  LogOut,
  MapPinned,
  PanelLeft,
  ScrollText,
  Users as UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { getClientBySlug, properties } from "@/lib/mock-data";
import { useMegatrendAuth } from "@/lib/auth-session";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

export const Route = createFileRoute("/portal/$clientSlug")({
  loader: ({ params }) => {
    const client = getClientBySlug(params.clientSlug);
    if (!client) throw notFound();
    return { client };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.client.name ?? "Client"} portal | Megatrend` },
      { name: "description", content: `Live portfolio portal for ${loaderData?.client.name}.` },
    ],
  }),
  notFoundComponent: () => <div className="p-8">Client portal not found.</div>,
  component: ClientPortalShell,
});

type PortalNavItem = {
  title: string;
  to:
    | "/portal/$clientSlug"
    | "/portal/$clientSlug/actions"
    | "/portal/$clientSlug/documents"
    | "/portal/$clientSlug/insights"
    | "/portal/$clientSlug/properties/$propertyId"
    | "/portal/$clientSlug/properties/$propertyId/lease"
    | "/portal/$clientSlug/team";
  params: { clientSlug: string; propertyId?: string };
  icon: typeof LayoutDashboard;
  active: boolean;
  disabled?: boolean;
};

function ClientPortalShell() {
  const { client } = Route.useLoaderData();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const auth = useMegatrendAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (auth.isLoading) {
      return;
    }
    if (!auth.isAuthenticated) {
      navigate({ to: "/portal" });
      return;
    }
    if (auth.portalSlug && auth.portalSlug !== client.slug) {
      navigate({ to: "/portal/$clientSlug", params: { clientSlug: auth.portalSlug } });
      return;
    }
    setReady(true);
  }, [auth.isAuthenticated, auth.isLoading, auth.portalSlug, client.slug, navigate]);

  const logout = () => {
    void auth.logout({ returnTo: "/portal" });
  };

  const clientProperties = properties.filter((property) => property.clientId === client.id);
  const primaryProperty = clientProperties[0];
  const basePath = `/portal/${client.slug}`;
  const normalizedPath = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

  const navGroups: { label: string; items: PortalNavItem[] }[] = [
    {
      label: "Workspace",
      items: [
        {
          title: "Portfolio",
          to: "/portal/$clientSlug",
          params: { clientSlug: client.slug },
          icon: LayoutDashboard,
          active: normalizedPath === basePath,
        },
        {
          title: "Property detail",
          to: "/portal/$clientSlug/properties/$propertyId",
          params: { clientSlug: client.slug, propertyId: primaryProperty?.id },
          icon: MapPinned,
          active:
            normalizedPath.startsWith(`${basePath}/properties/`) &&
            !normalizedPath.endsWith("/lease"),
          disabled: !primaryProperty,
        },
        {
          title: "Lease detail",
          to: "/portal/$clientSlug/properties/$propertyId/lease",
          params: { clientSlug: client.slug, propertyId: primaryProperty?.id },
          icon: ScrollText,
          active: normalizedPath.endsWith("/lease"),
          disabled: !primaryProperty,
        },
      ],
    },
    {
      label: "Client bucket",
      items: [
        {
          title: "Actions",
          to: "/portal/$clientSlug/actions",
          params: { clientSlug: client.slug },
          icon: ListChecks,
          active: normalizedPath === `${basePath}/actions`,
        },
        {
          title: "Documents",
          to: "/portal/$clientSlug/documents",
          params: { clientSlug: client.slug },
          icon: FileText,
          active: normalizedPath === `${basePath}/documents`,
        },
        {
          title: "Insights",
          to: "/portal/$clientSlug/insights",
          params: { clientSlug: client.slug },
          icon: Lightbulb,
          active: normalizedPath === `${basePath}/insights`,
        },
        {
          title: "Team",
          to: "/portal/$clientSlug/team",
          params: { clientSlug: client.slug },
          icon: UsersIcon,
          active: normalizedPath === `${basePath}/team`,
        },
      ],
    },
  ];

  if (!ready || !auth.profile) return null;

  return (
    <SidebarProvider>
      <ClientPortalFrame
        client={client}
        session={{
          fullName: auth.profile.name ?? auth.profile.email ?? "Portal user",
          email: auth.profile.email ?? "",
        }}
        logout={logout}
        navGroups={navGroups}
        primaryPropertyName={primaryProperty?.name}
      />
    </SidebarProvider>
  );
}

function ClientPortalFrame({
  client,
  session,
  logout,
  navGroups,
  primaryPropertyName,
}: {
  client: NonNullable<ReturnType<typeof Route.useLoaderData>["client"]>;
  session: {
    fullName: string;
    email: string;
  };
  logout: () => void;
  navGroups: { label: string; items: PortalNavItem[] }[];
  primaryPropertyName?: string;
}) {
  return (
    <div className="flex min-h-screen w-full bg-background">
      <ClientPortalSidebar
        clientName={client.name}
        clientSlug={client.slug}
        navGroups={navGroups}
        primaryPropertyName={primaryPropertyName}
      />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md">
          <SidebarTrigger />
          <div className="ml-2 hidden items-center gap-2 md:flex">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Client portal</span>
            <span className="text-muted-foreground">|</span>
            <span className="font-display text-sm">{client.name}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Portal workspace">
              <PanelLeft className="h-4 w-4" />
            </Button>
            <ThemeToggle />
            <span className="hidden text-xs text-muted-foreground md:inline">{session.fullName}</span>
            <div className="ml-1 hidden h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground md:flex">
              {session.fullName
                .split(" ")
                .map((name) => name[0])
                .join("")
                .slice(0, 2)}
            </div>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden px-4 py-6 md:px-8 md:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function ClientPortalSidebar({
  clientName,
  clientSlug,
  navGroups,
  primaryPropertyName,
}: {
  clientName: string;
  clientSlug: string;
  navGroups: { label: string; items: PortalNavItem[] }[];
  primaryPropertyName?: string;
}) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link to="/portal/$clientSlug" params={{ clientSlug }} className="flex items-center gap-2 px-2 py-1.5">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Globe className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Client portal</span>
              <span className="font-display text-sm">{clientName}</span>
            </div>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    {item.disabled ? (
                      <SidebarMenuButton isActive={item.active} disabled>
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton asChild isActive={item.active}>
                        <Link to={item.to} params={item.params} className="flex items-center gap-2">
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{item.title}</span>}
                        </Link>
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && (
          <div className="space-y-1 px-2 py-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <div>Client workspace</div>
            {primaryPropertyName ? (
              <div className="normal-case tracking-normal text-xs text-sidebar-foreground/80">
                Demo property: {primaryPropertyName}
              </div>
            ) : null}
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
