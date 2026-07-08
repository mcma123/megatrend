import { createFileRoute, useNavigate, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shield, UserPlus, UserX } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { getClientBySlug } from "@/lib/mock-data";
import { useMegatrendAuth } from "@/lib/auth-session";
import { api } from "../../../convex/_generated/api";

const clientRoleOptions = [
  { value: "client_admin", label: "Client Admin" },
  { value: "property_manager", label: "Property Manager" },
  { value: "finance_user", label: "Finance User" },
  { value: "legal_reviewer", label: "Legal Reviewer" },
  { value: "executive_viewer", label: "Executive Viewer" },
] as const;

export const Route = createFileRoute("/portal/$clientSlug/team")({
  loader: ({ params }) => {
    const client = getClientBySlug(params.clientSlug);
    if (!client) throw notFound();
    return { client };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `Team | ${loaderData?.client.name} | Megatrend portal` }],
  }),
  notFoundComponent: () => <div className="p-8">Organisation not found.</div>,
  component: TeamPage,
});

function TeamPage() {
  const { client } = Route.useLoaderData();
  const navigate = useNavigate();
  const auth = useMegatrendAuth();
  const workspace = useQuery(api.portal.getPortalTeamWorkspace, { slug: client.slug });
  const invitePortalMember = useMutation(api.portal.invitePortalMember);
  const revokePortalMember = useMutation(api.portal.revokePortalMember);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    roleKey: "property_manager" as (typeof clientRoleOptions)[number]["value"],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (auth.isLoading) {
      return;
    }
    if (!auth.isAuthenticated) {
      navigate({ to: "/portal" });
    }
  }, [auth.isAuthenticated, auth.isLoading, navigate]);

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await invitePortalMember({
        slug: client.slug,
        email: form.email,
        fullName: form.fullName || undefined,
        roleKey: form.roleKey,
      });
      setSuccess(`Invitation queued for ${form.email}. Access will be provisioned on first OIDC sign-in.`);
      setForm({ fullName: "", email: "", roleKey: "property_manager" });
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Failed to invite member.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (membershipId: string) => {
    setError(null);
    setSuccess(null);
    try {
      await revokePortalMember({ membershipId: membershipId as never });
      setSuccess("Membership revoked.");
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Failed to revoke member.");
    }
  };

  if (workspace === undefined) {
    return <main className="px-0 py-2"><Card className="surface-elevated p-6">Loading team workspace?</Card></main>;
  }

  if (workspace === null) {
    return (
      <main className="px-0 py-2">
        <PageHeader
          eyebrow="Organisation | Team"
          title="Team setup unavailable"
          description={`No tenant workspace is provisioned yet for ${client.name}.`}
        />
        <Card className="surface-elevated p-6 text-sm text-muted-foreground">
          Megatrend still needs to provision the Convex tenant and organization record for this client before team memberships can be managed here.
        </Card>
      </main>
    );
  }

  return (
    <main className="px-0 py-2">
      <PageHeader
        eyebrow="Organisation | Team"
        title="Manage your team"
        description={`Invite teammates through your identity provider and manage tenant memberships for ${client.name}.`}
      />

      <Card className="surface-elevated mb-6 border-primary/40 bg-primary/5 p-4 text-sm">
        <Shield className="mr-2 inline h-4 w-4 text-primary" />
        Invitations are now tracked in Convex. Membership is provisioned automatically the first time an invited user authenticates through the configured OIDC provider.
      </Card>

      {error ? (
        <Card className="surface-elevated mb-6 border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      {success ? (
        <Card className="surface-elevated mb-6 border-success/40 bg-success/10 p-4 text-sm text-success">
          {success}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
        <Card className="surface-elevated p-6">
          <h3 className="font-display text-lg">Active memberships | {workspace.members.length}</h3>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="py-2 pr-2">Name</th>
                <th className="py-2 pr-2">Email</th>
                <th className="py-2 pr-2">Role</th>
                <th className="py-2 pr-2">Type</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {workspace.members.map((member) => (
                <tr key={member.membershipId} className="border-b border-border/50">
                  <td className="py-2 pr-2 font-medium">{member.fullName ?? "Pending profile"}</td>
                  <td className="py-2 pr-2 text-muted-foreground">{member.email ?? "No email claim"}</td>
                  <td className="py-2 pr-2"><span className="tag-pill">{member.roleKey}</span></td>
                  <td className="py-2 pr-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">{member.principalType}</td>
                  <td className="py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => { void handleRevoke(member.membershipId); }}>
                      <UserX className="h-4 w-4" /> Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="space-y-6">
          <Card className="surface-elevated p-6">
            <h3 className="font-display text-lg">Invite a teammate</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Invitations are matched by email claim after OIDC sign-in.
            </p>
            <form onSubmit={handleInvite} className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <Input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <select
                  value={form.roleKey}
                  onChange={(event) => setForm({ ...form, roleKey: event.target.value as (typeof clientRoleOptions)[number]["value"] })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {clientRoleOptions.map((role) => (
                    <option key={role.value} value={role.value}>{role.label}</option>
                  ))}
                </select>
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                <UserPlus className="h-4 w-4" /> {submitting ? "Queuing invitation?" : "Invite member"}
              </Button>
            </form>
          </Card>

          <Card className="surface-elevated p-6">
            <h3 className="font-display text-lg">Pending invitations | {workspace.invitations.length}</h3>
            <div className="mt-4 space-y-3">
              {workspace.invitations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pending invitations.</p>
              ) : workspace.invitations.map((invitation) => (
                <div key={invitation.invitationId} className="rounded-md border border-border/70 p-3 text-sm">
                  <div className="font-medium">{invitation.fullName ?? invitation.email}</div>
                  <div className="text-muted-foreground">{invitation.email}</div>
                  <div className="mt-2 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <span>{invitation.roleKey}</span>
                    <span>?</span>
                    <span>{invitation.providerHint ?? "oidc"}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
