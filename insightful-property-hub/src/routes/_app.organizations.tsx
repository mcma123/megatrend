import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ExternalLink, Plus, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ClientFormDialog } from "@/components/portfolio/client-form-dialog";
import {
  EmptyState,
  Field,
  FormError,
  LoadingState,
  NativeSelect,
} from "@/components/portfolio/form-fields";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { errorMessage } from "@/lib/portfolio";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/_app/organizations")({
  head: () => ({
    meta: [
      { title: "Organisations · Cyphersoft OS" },
      { name: "description", content: "Client workspaces, portal access and invitations." },
    ],
  }),
  component: OrgsPage,
});

const CLIENT_ROLES = [
  { value: "client_admin", label: "Client admin (manages their team)" },
  { value: "property_manager", label: "Property manager" },
  { value: "finance_user", label: "Finance user" },
  { value: "legal_reviewer", label: "Legal reviewer" },
  { value: "executive_viewer", label: "Executive viewer (read only)" },
] as const;

type ClientRole = (typeof CLIENT_ROLES)[number]["value"];

function OrgsPage() {
  const clients = useQuery(api.clients.list);
  const auth = useCyphersoftAuth();
  const navigate = useNavigate();
  const canCreate = auth.profile?.isPlatformAdmin === true;

  const newClientButton = canCreate ? (
    <ClientFormDialog
      trigger={
        <Button>
          <Plus className="h-4 w-4" /> New organisation
        </Button>
      }
      onSaved={({ slug }) => void navigate({ to: "/clients/$id", params: { id: slug } })}
    />
  ) : null;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Administration · Organisations"
        title="Client workspaces & portal access."
        description="Each client has a private portal. Invite their people by email — they create their own password at sign-in, and only see their own workspace."
        actions={newClientButton}
      />
      <Card className="surface-elevated overflow-x-auto p-4">
        {clients === undefined ? (
          <LoadingState label="Loading organisations…" />
        ) : clients.length === 0 ? (
          <EmptyState
            title="No client workspaces yet"
            description="Create an organisation to give a client portal access."
            action={newClientButton}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="py-3 pr-3">Organisation</th>
                <th className="py-3 pr-3">Portal code</th>
                <th className="py-3 pr-3">Primary contact</th>
                <th className="py-3 pr-3 text-right">Portal users</th>
                <th className="py-3 pr-3 text-right">Pending invites</th>
                <th className="py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.tenantId} className="border-b border-border/50 hover:bg-accent/30">
                  <td className="py-3 pr-3">
                    <Link
                      to="/clients/$id"
                      params={{ id: client.slug }}
                      className="font-medium hover:text-primary"
                    >
                      {client.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs">{client.slug}</td>
                  <td className="py-3 pr-3 text-muted-foreground">
                    {client.contactName ?? "—"}
                    {client.contactEmail ? (
                      <div className="text-xs">{client.contactEmail}</div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono">{client.clientMemberCount}</td>
                  <td className="py-3 pr-3 text-right font-mono">{client.pendingInviteCount}</td>
                  <td className="py-3">
                    <div className="flex justify-end gap-2">
                      <InviteDialog slug={client.slug} clientName={client.name} />
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/portal/$clientSlug" params={{ clientSlug: client.slug }}>
                          <ExternalLink className="h-3.5 w-3.5" /> Portal
                        </Link>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function InviteDialog({ slug, clientName }: { slug: string; clientName: string }) {
  const invite = useMutation(api.portal.invitePortalMember);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleKey, setRoleKey] = useState<ClientRole>("client_admin");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await invite({ slug, email, fullName: fullName || undefined, roleKey });
      toast.success(`Invitation created. ${result.inviteTarget} can now sign up at /sign-in.`);
      setEmail("");
      setFullName("");
      setOpen(false);
    } catch (inviteError) {
      setError(errorMessage(inviteError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UserPlus className="h-3.5 w-3.5" /> Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to {clientName}</DialogTitle>
          <DialogDescription>
            The invitation is valid for 7 days. Share the sign-in link with them: they create their
            account with this email address.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" htmlFor="invite-email">
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Full name" htmlFor="invite-name">
            <Input
              id="invite-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <NativeSelect
              id="invite-role"
              value={roleKey}
              onChange={(e) => setRoleKey(e.target.value as ClientRole)}
            >
              {CLIENT_ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Inviting…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
