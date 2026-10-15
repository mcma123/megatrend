import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
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
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";
import {
  LEASE_STATUS_LABELS,
  errorMessage,
  parseOptionalNumber,
  type LeaseStatus,
} from "@/lib/portfolio";
import { toFormStrings, useVoiceForm } from "@/lib/voice/form-registry";
import { leaseVoiceFields } from "@/lib/voice/forms";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type FormState = {
  propertyId: string;
  startDate: string;
  endDate: string;
  monthlyRental: string;
  escalationPercent: string;
  noticePeriodMonths: string;
  breakClause: string;
  renewalOption: string;
  accountManagerName: string;
  status: LeaseStatus;
};

function toFormState(lease?: Doc<"leases">, propertyId?: string): FormState {
  return {
    propertyId: lease?.propertyId ?? propertyId ?? "",
    startDate: lease?.startDate ?? "",
    endDate: lease?.endDate ?? "",
    monthlyRental: lease?.monthlyRental?.toString() ?? "",
    escalationPercent: lease?.escalationPercent?.toString() ?? "",
    noticePeriodMonths: lease?.noticePeriodMonths?.toString() ?? "",
    breakClause: lease?.breakClause ?? "",
    renewalOption: lease?.renewalOption ?? "",
    accountManagerName: lease?.accountManagerName ?? "",
    status: lease?.status ?? "active",
  };
}

/**
 * Create a lease (optionally for a fixed property) or edit an existing one. Pass `open` and
 * `onOpenChange` to control the dialog (e.g. from a `?new=1` search param). Voice-fillable.
 */
export function LeaseFormDialog({
  trigger,
  lease,
  propertyId,
  tenantId,
  onSaved,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger: ReactNode;
  lease?: Doc<"leases">;
  propertyId?: Id<"properties">;
  /** Limits the property picker to one client. */
  tenantId?: Id<"tenants">;
  onSaved?: (leaseId: Id<"leases">) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isEdit = Boolean(lease);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const properties = useQuery(
    api.properties.list,
    open && !isEdit && !propertyId ? (tenantId ? { tenantId } : {}) : "skip",
  );
  const createLease = useMutation(api.leases.create);
  const updateLease = useMutation(api.leases.update);
  const [values, setValues] = useState<FormState>(toFormState(lease, propertyId));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(toFormState(lease, propertyId));
      setError(null);
    }
  }, [open, lease, propertyId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  useVoiceForm({
    formId: isEdit ? "lease.edit" : "lease.create",
    title: isEdit ? "Edit lease" : "New lease",
    enabled: open,
    fields: leaseVoiceFields({
      properties:
        !isEdit && !propertyId
          ? (properties ?? []).map((item) => ({
              value: item._id,
              label: `${item.name} · ${item.client.name}`,
            }))
          : undefined,
    }),
    values,
    setValues: (patch) => setValues((current) => ({ ...current, ...toFormStrings(patch) })),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const monthlyRental = parseOptionalNumber(values.monthlyRental);
      if (monthlyRental === undefined) {
        throw new Error("Enter the monthly rental");
      }
      const fields = {
        startDate: values.startDate,
        endDate: values.endDate,
        monthlyRental,
        escalationPercent: parseOptionalNumber(values.escalationPercent),
        noticePeriodMonths: parseOptionalNumber(values.noticePeriodMonths),
        breakClause: values.breakClause || undefined,
        renewalOption: values.renewalOption || undefined,
        accountManagerName: values.accountManagerName || undefined,
        status: values.status,
      };
      if (lease) {
        await updateLease({ leaseId: lease._id, ...fields });
        toast.success("Lease updated");
        // Close before onSaved so a navigating onSaved wins over a route-controlled close.
        setOpen(false);
        onSaved?.(lease._id);
      } else {
        if (!values.propertyId) {
          throw new Error("Choose a property");
        }
        const result = await createLease({
          propertyId: values.propertyId as Id<"properties">,
          ...fields,
        });
        toast.success("Lease added");
        setOpen(false);
        onSaved?.(result.leaseId);
      }
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
          <DialogTitle>{isEdit ? "Edit lease" : "New lease"}</DialogTitle>
          <DialogDescription>
            Commercial terms; renewal dates are calculated from the end date.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {!isEdit && !propertyId ? (
              <Field label="Property" htmlFor="lease-property" className="sm:col-span-2">
                <NativeSelect
                  id="lease-property"
                  required
                  value={values.propertyId}
                  onChange={(e) => set("propertyId", e.target.value)}
                >
                  <option value="">
                    {properties === undefined
                      ? "Loading properties…"
                      : properties.length === 0
                        ? "Add a property first"
                        : "Choose a property"}
                  </option>
                  {properties?.map((property) => (
                    <option key={property._id} value={property._id}>
                      {property.name} · {property.client.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field label="Start date" htmlFor="lease-start">
              <Input
                id="lease-start"
                type="date"
                required
                value={values.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </Field>
            <Field label="End date" htmlFor="lease-end">
              <Input
                id="lease-end"
                type="date"
                required
                value={values.endDate}
                onChange={(e) => set("endDate", e.target.value)}
              />
            </Field>
            <Field label="Monthly rental (R)" htmlFor="lease-rental">
              <Input
                id="lease-rental"
                required
                inputMode="decimal"
                value={values.monthlyRental}
                onChange={(e) => set("monthlyRental", e.target.value)}
              />
            </Field>
            <Field label="Escalation (% per year)" htmlFor="lease-escalation">
              <Input
                id="lease-escalation"
                inputMode="decimal"
                value={values.escalationPercent}
                onChange={(e) => set("escalationPercent", e.target.value)}
              />
            </Field>
            <Field label="Notice period (months)" htmlFor="lease-notice">
              <Input
                id="lease-notice"
                inputMode="numeric"
                value={values.noticePeriodMonths}
                onChange={(e) => set("noticePeriodMonths", e.target.value)}
              />
            </Field>
            <Field label="Status" htmlFor="lease-status">
              <NativeSelect
                id="lease-status"
                value={values.status}
                onChange={(e) => set("status", e.target.value as LeaseStatus)}
              >
                {Object.entries(LEASE_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Break clause" htmlFor="lease-break" className="sm:col-span-2">
              <Input
                id="lease-break"
                value={values.breakClause}
                onChange={(e) => set("breakClause", e.target.value)}
              />
            </Field>
            <Field label="Renewal option" htmlFor="lease-renewal" className="sm:col-span-2">
              <Input
                id="lease-renewal"
                value={values.renewalOption}
                onChange={(e) => set("renewalOption", e.target.value)}
              />
            </Field>
            <Field label="Consultant" htmlFor="lease-consultant" className="sm:col-span-2">
              <Input
                id="lease-consultant"
                value={values.accountManagerName}
                onChange={(e) => set("accountManagerName", e.target.value)}
              />
            </Field>
          </div>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add lease"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
