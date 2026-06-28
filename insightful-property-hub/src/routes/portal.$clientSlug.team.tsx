import { createFileRoute, Link, useNavigate, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, UserPlus, Trash2, Shield, Globe, LogOut } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { PageHeader } from "@/components/page-header";
import { getClientBySlug } from "@/lib/mock-data";
import {
  listUsers, createPortalUser, deletePortalUser, getSession, clearSession,
  type PortalUser, type PortalRole,
} from "@/lib/portal-auth";

export const Route = createFileRoute("/portal/$clientSlug/team")({
  loader: ({ params }) => {
    const client = getClientBySlug(params.clientSlug);
    if (!client) throw notFound();
    return { client };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `Team · ${loaderData?.client.name} · Megatrend portal` }],
  }),
  notFoundComponent: () => <div className="p-8">Organisation not found.</div>,
  component: TeamPage,
});

function TeamPage() {
  const { client } = Route.useLoaderData();
  const navigate = useNavigate();
  const [session, setSession] = useState(getSession());
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [form, setForm] = useState({
    fullName: "", email: "", username: "", password: "", role: "member" as PortalRole,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s || s.orgSlug !== client.slug) {
      navigate({ to: "/portal" });
      return;
    }
    setSession(s);
    setUsers(listUsers(client.slug));
  }, [client.slug, navigate]);

  if (!session) return null;
  const isAdmin = session.role === "admin";

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      createPortalUser({ orgSlug: client.slug, ...form });
      setUsers(listUsers(client.slug));
      setForm({ fullName: "", email: "", username: "", password: "", role: "member" });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const onDelete = (id: string) => {
    deletePortalUser(id);
    setUsers(listUsers(client.slug));
  };

  const logout = () => {
    clearSession();
    navigate({ to: "/portal" });
  };

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
          <div className="flex items-center gap-2 text-sm">
            <Link to="/portal/$clientSlug" params={{ clientSlug: client.slug }} className="text-muted-foreground hover:text-foreground">Portfolio</Link>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}><LogOut className="h-4 w-4" /> Sign out</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <Link to="/portal/$clientSlug" params={{ clientSlug: client.slug }} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to portfolio
        </Link>
        <PageHeader
          eyebrow="Organisation · Team"
          title="Manage your team"
          description={`Admins for ${client.name} can invite teammates, set their role, and revoke access.`}
        />

        {!isAdmin && (
          <Card className="surface-elevated mb-6 border-warning/40 bg-warning/5 p-4 text-sm">
            <Shield className="mr-2 inline h-4 w-4 text-warning" />
            Only organisation admins can add or remove users.
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="surface-elevated p-6 lg:col-span-2">
            <h3 className="font-display text-lg">Team members · {users.length}</h3>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-2 pr-2">Name</th>
                  <th className="py-2 pr-2">Username</th>
                  <th className="py-2 pr-2">Email</th>
                  <th className="py-2 pr-2">Role</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-border/50">
                    <td className="py-2 pr-2 font-medium">{u.fullName}</td>
                    <td className="py-2 pr-2 font-mono text-xs">{u.username}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{u.email}</td>
                    <td className="py-2 pr-2"><span className="tag-pill">{u.role}</span></td>
                    <td className="py-2 text-right">
                      {isAdmin && u.id !== session.userId && (
                        <Button variant="ghost" size="icon" onClick={() => onDelete(u.id)} aria-label="Remove">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="surface-elevated p-6">
            <h3 className="font-display text-lg">Invite a teammate</h3>
            <p className="mt-1 text-xs text-muted-foreground">They'll sign in with the org code <span className="font-mono">{client.slug}</span>.</p>
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              <div className="space-y-1.5"><Label>Full name</Label><Input required disabled={!isAdmin} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input required type="email" disabled={!isAdmin} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Username</Label><Input required disabled={!isAdmin} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Password</Label><Input required type="text" disabled={!isAdmin} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <select disabled={!isAdmin} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as PortalRole })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
              <Button type="submit" className="w-full" disabled={!isAdmin}><UserPlus className="h-4 w-4" /> Add user</Button>
            </form>
          </Card>
        </div>
      </main>
    </div>
  );
}
