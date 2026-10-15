import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "convex/react";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClientFormDialog } from "@/components/portfolio/client-form-dialog";
import { EmptyState, LoadingState } from "@/components/portfolio/form-fields";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { CLIENT_TYPE_LABELS, RELATIONSHIP_STATUS_LABELS, formatZAR } from "@/lib/portfolio";
import { useVoiceCommands } from "@/lib/voice/command-registry";
import { validateNewFormSearch } from "@/lib/voice/new-form-search";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/_app/clients")({
  validateSearch: validateNewFormSearch,
  head: () => ({
    meta: [
      { title: "Clients · Cyphersoft OS" },
      { name: "description", content: "Client portfolio CRM for tenant-rep advisory." },
    ],
  }),
  component: ClientsPage,
});

function ClientsPage() {
  const [q, setQ] = useState("");
  const clients = useQuery(api.clients.list);
  const auth = useCyphersoftAuth();
  const navigate = useNavigate();
  const canCreate = auth.profile?.isPlatformAdmin === true;
  const search = Route.useSearch();
  const setCreateOpen = (open: boolean) =>
    void navigate({ to: "/clients", search: open ? { new: "1" } : {}, replace: !open });

  useVoiceCommands("clients.list", {
    "clients.search": {
      run: ({ query }) => {
        setQ(String(query));
        return `Showing clients matching "${String(query)}".`;
      },
    },
  });
  const filtered = (clients ?? []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  const newClientButton = canCreate ? (
    <ClientFormDialog
      open={search.new === "1"}
      onOpenChange={setCreateOpen}
      trigger={
        <Button>
          <Plus className="h-4 w-4" /> New client
        </Button>
      }
      onSaved={({ slug }) => void navigate({ to: "/clients/$id", params: { id: slug } })}
    />
  ) : null;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Internal · Clients"
        title="Every client. Every lease. One profile."
        description="Annual exposure, leases, consultants and portal access for every client in one place."
        actions={newClientButton}
      />
      <Card className="surface-elevated p-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients…"
            className="pl-9"
          />
        </div>
        <div className="mt-4 overflow-x-auto">
          {clients === undefined ? (
            <LoadingState label="Loading clients…" />
          ) : clients.length === 0 ? (
            <EmptyState
              title="No clients yet"
              description="Create your first client to start adding properties and leases."
              action={newClientButton}
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-3 pr-4">Client</th>
                  <th className="py-3 pr-4">Industry</th>
                  <th className="py-3 pr-4">Type</th>
                  <th className="py-3 pr-4">Consultant</th>
                  <th className="py-3 pr-4 text-right">Leases</th>
                  <th className="py-3 pr-4 text-right">Annual rental</th>
                  <th className="py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.tenantId}
                    className="border-b border-border/50 transition-colors hover:bg-accent/30"
                  >
                    <td className="py-3 pr-4">
                      <Link
                        to="/clients/$id"
                        params={{ id: c.slug }}
                        className="font-medium hover:text-primary"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{c.industry ?? "—"}</td>
                    <td className="py-3 pr-4">
                      {c.clientType ? (
                        <span className="tag-pill">{CLIENT_TYPE_LABELS[c.clientType]}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {c.accountManagerName ?? "—"}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono">{c.leaseCount}</td>
                    <td className="py-3 pr-4 text-right font-mono">{formatZAR(c.annualRental)}</td>
                    <td className="py-3">
                      <span
                        className={`tag-pill ${c.relationshipStatus === "active" || !c.relationshipStatus ? "" : "!text-muted-foreground !border-border"}`}
                      >
                        {RELATIONSHIP_STATUS_LABELS[c.relationshipStatus ?? "active"]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
