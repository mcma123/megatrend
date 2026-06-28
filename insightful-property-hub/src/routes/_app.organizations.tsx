import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Plus, KeyRound, Copy, Check } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clients } from "@/lib/mock-data";
import { listOrgs, listUsers, createOrg, type PortalOrg } from "@/lib/portal-auth";

export const Route = createFileRoute("/_app/organizations")({
  head: () => ({
    meta: [
      { title: "Organisations · Megatrend OS" },
      { name: "description", content: "Provision client organisations and seed their admin user." },
    ],
  }),
  component: OrgsPage,
});

function OrgsPage() {
  const [orgs, setOrgs] = useState<PortalOrg[]>([]);
  const [form, setForm] = useState({
    clientId: "", slug: "", name: "",
    adminFullName: "", adminEmail: "", adminUsername: "admin", adminPassword: "",
  });
  const [created, setCreated] = useState<{ slug: string; username: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setOrgs(listOrgs()); }, []);

  const availableClients = clients.filter((c) => !orgs.some((o) => o.clientId === c.id));

  const onClientPick = (id: string) => {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    setForm((f) => ({ ...f, clientId: id, slug: c.slug, name: c.name, adminFullName: c.contact, adminEmail: c.email }));
  };

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let p = "";
    for (let i = 0; i < 12; i++) p += chars[Math.floor(Math.random() * chars.length)];
    setForm((f) => ({ ...f, adminPassword: p }));
  };

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { org, admin } = createOrg(form);
      setOrgs(listOrgs());
      setCreated({ slug: org.slug, username: admin.username, password: admin.password });
      setForm({ clientId: "", slug: "", name: "", adminFullName: "", adminEmail: "", adminUsername: "admin", adminPassword: "" });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const copyCreds = () => {
    if (!created) return;
    navigator.clipboard.writeText(`Organisation: ${created.slug}\nUsername: ${created.username}\nPassword: ${created.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Admin · Organisations"
        title="Provision client portals."
        description="Each client company is a separate tenant. Create the organisation here, hand the admin credentials to the client lead, and they can invite the rest of their team from inside their portal."
      />

      {created && (
        <Card className="surface-elevated mb-6 border-primary/40 bg-primary/5 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-primary">Admin credentials issued</div>
              <div className="mt-2 font-mono text-sm">
                <div>Organisation: <strong>{created.slug}</strong></div>
                <div>Username: <strong>{created.username}</strong></div>
                <div>Password: <strong>{created.password}</strong></div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Share securely — this is the only time it's shown.</p>
            </div>
            <Button variant="outline" onClick={copyCreds}>
              {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="surface-elevated p-6 lg:col-span-2">
          <h3 className="font-display text-lg">Provisioned organisations · {orgs.length}</h3>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="py-2 pr-2">Organisation</th>
                <th className="py-2 pr-2">Slug (login code)</th>
                <th className="py-2 pr-2 text-right">Users</th>
                <th className="py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.slug} className="border-b border-border/50">
                  <td className="py-2 pr-2 font-medium">{o.name}</td>
                  <td className="py-2 pr-2 font-mono text-xs">{o.slug}</td>
                  <td className="py-2 pr-2 text-right font-mono">{listUsers(o.slug).length}</td>
                  <td className="py-2 text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="surface-elevated p-6">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg">New organisation</h3>
          </div>
          {availableClients.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">All clients already have a portal provisioned.</p>
          ) : (
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label>Client</Label>
                <select required value={form.clientId} onChange={(e) => onClientPick(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="">Select a client…</option>
                  {availableClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>Org slug</Label><Input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Admin full name</Label><Input required value={form.adminFullName} onChange={(e) => setForm({ ...form, adminFullName: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Admin email</Label><Input required type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Admin username</Label><Input required value={form.adminUsername} onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} /></div>
              <div className="space-y-1.5">
                <Label>Initial password</Label>
                <div className="flex gap-2">
                  <Input required value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
                  <Button type="button" variant="outline" size="icon" onClick={generatePassword} aria-label="Generate"><KeyRound className="h-4 w-4" /></Button>
                </div>
              </div>
              {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
              <Button type="submit" className="w-full"><Plus className="h-4 w-4" /> Provision organisation</Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
