import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Label } from "@/components/ui/label";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";
import {
  CLIENT_TYPE_LABELS,
  RELATIONSHIP_STATUS_LABELS,
  errorMessage,
  type ClientType,
  type RelationshipStatus,
} from "@/lib/portfolio";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type ClientFormValues = {
  tenantId?: Id<"tenants">;
  name: string;
  slug: string;
  contactName: string;
  contactEmail: string;
  industry: string;
  clientType: ClientType | "";
  relationshipStatus: RelationshipStatus;
  accountManagerName: string;
  clientSince: string;
};

const EMPTY: ClientFormValues = {
  name: "",
  slug: "",
  contactName: "",
  contactEmail: "",
  industry: "",
  clientType: "",
  relationshipStatus: "active",
  accountManagerName: "",
  clientSince: "",
};

function toSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Create a client workspace (platform admin) or edit an existing client's profile. */
export function ClientFormDialog({
  trigger,
  initial,
  onSaved,
}: {
  trigger: ReactNode;
  initial?: ClientFormValues;
  onSaved?: (result: { slug: string }) => void;
}) {
  const isEdit = Boolean(initial?.tenantId);
  const createClient = useMutation(api.clients.create);
  const updateClient = useMutation(api.clients.update);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ClientFormValues>(initial ?? EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [invite, setInvite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(initial ?? EMPTY);
      setSlugTouched(false);
      setError(null);
    }
  }, [open, initial]);

  const set = <K extends keyof ClientFormValues>(key: K, value: ClientFormValues[K]) =>
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (key === "name" && !isEdit && !slugTouched) {
        next.slug = toSlug(String(value));
      }
      return next;
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const profile = {
      industry: values.industry || undefined,
      clientType: values.clientType || undefined,
      relationshipStatus: values.relationshipStatus,
      accountManagerName: values.accountManagerName || undefined,
      clientSince: values.clientSince || undefined,
    };
    try {
      if (isEdit && values.tenantId) {
        await updateClient({
          tenantId: values.tenantId,
          name: values.name,
          primaryContactName: values.contactName,
          primaryContactEmail: values.contactEmail,
          ...profile,
        });
        toast.success("Client updated");
        onSaved?.({ slug: values.slug });
      } else {
        const result = await createClient({
          name: values.name,
          slug: values.slug,
          primaryContactName: values.contactName,
          primaryContactEmail: values.contactEmail,
          inviteContactAsAdmin: invite,
          ...profile,
        });
        toast.success(
          result.invitedEmail
            ? `Client created. ${result.invitedEmail} can now create their account at /sign-in.`
            : "Client created",
        );
        onSaved?.({ slug: result.slug });
      }
      setOpen(false);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit client" : "New client"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the client profile and primary contact."
              : "Creates the client workspace and its private portal."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client name" htmlFor="client-name" className="sm:col-span-2">
              <Input
                id="client-name"
                required
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field
              label="Portal code"
              htmlFor="client-slug"
              hint={
                isEdit
                  ? "The portal address can't be changed."
                  : `Portal: /portal/${values.slug || "code"}`
              }
              className="sm:col-span-2"
            >
              <Input
                id="client-slug"
                required
                disabled={isEdit}
                value={values.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  set("slug", toSlug(e.target.value));
                }}
              />
            </Field>
            <Field label="Primary contact" htmlFor="client-contact">
              <Input
                id="client-contact"
                required
                value={values.contactName}
                onChange={(e) => set("contactName", e.target.value)}
              />
            </Field>
            <Field label="Contact email" htmlFor="client-email">
              <Input
                id="client-email"
                type="email"
                required
                value={values.contactEmail}
                onChange={(e) => set("contactEmail", e.target.value)}
              />
            </Field>
            <Field label="Industry" htmlFor="client-industry">
              <Input
                id="client-industry"
                value={values.industry}
                onChange={(e) => set("industry", e.target.value)}
              />
            </Field>
            <Field label="Client type" htmlFor="client-type">
              <NativeSelect
                id="client-type"
                value={values.clientType}
                onChange={(e) => set("clientType", e.target.value as ClientType | "")}
              >
                <option value="">Not set</option>
                {Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Status" htmlFor="client-status">
              <NativeSelect
                id="client-status"
                value={values.relationshipStatus}
                onChange={(e) => set("relationshipStatus", e.target.value as RelationshipStatus)}
              >
                {Object.entries(RELATIONSHIP_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Account manager" htmlFor="client-manager">
              <Input
                id="client-manager"
                value={values.accountManagerName}
                onChange={(e) => set("accountManagerName", e.target.value)}
              />
            </Field>
            <Field label="Client since" htmlFor="client-since">
              <Input
                id="client-since"
                type="date"
                value={values.clientSince}
                onChange={(e) => set("clientSince", e.target.value)}
              />
            </Field>
          </div>

          {!isEdit ? (
            <div className="flex items-start gap-2 rounded-md border border-border p-3">
              <Checkbox
                id="client-invite"
                checked={invite}
                onCheckedChange={(checked) => setInvite(checked === true)}
              />
              <Label
                htmlFor="client-invite"
                className="text-xs font-normal leading-5 text-muted-foreground"
              >
                Invite the primary contact as the portal admin. They sign up at /sign-in with this
                email and can then invite their own team.
              </Label>
            </div>
          ) : null}

          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
