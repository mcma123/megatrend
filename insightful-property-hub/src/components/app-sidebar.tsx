import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, Building2, Compass, FileText, Search,
  ScrollText, Workflow, Receipt, ListChecks, BarChart3, Globe2, Shield,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

const groups: { label: string; items: { title: string; url: string; icon: any }[] }[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "External bucket",
    items: [
      { title: "Sourcing", url: "/sourcing", icon: Compass },
      { title: "Properties", url: "/properties", icon: Building2 },
    ],
  },
  {
    label: "Internal bucket",
    items: [
      { title: "Clients", url: "/clients", icon: Users },
      { title: "Leases", url: "/leases", icon: ScrollText },
      { title: "Documents", url: "/documents", icon: FileText },
      { title: "Search", url: "/search", icon: Search },
      { title: "Invoices", url: "/invoices", icon: Receipt },
    ],
  },
  {
    label: "Automation bucket",
    items: [
      { title: "Workflows", url: "/automations", icon: Workflow },
      { title: "Tasks", url: "/tasks", icon: ListChecks },
    ],
  },
  {
    label: "Reporting",
    items: [
      { title: "Reports & ROI", url: "/reports", icon: BarChart3 },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Organisations", url: "/organizations", icon: Shield },
      { title: "Client portal", url: "/portal", icon: Globe2 },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) =>
    url === "/dashboard" ? pathname === url : pathname.startsWith(url);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link to="/dashboard" className="flex items-center gap-2 px-2 py-1.5">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <span className="font-display text-lg leading-none">M</span>
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Cypher-soft</span>
              <span className="font-display text-sm">Megatrend OS</span>
            </div>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && (
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            v0.1 · Prototype
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
