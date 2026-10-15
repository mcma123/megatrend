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
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";
import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  errorMessage,
  parseOptionalNumber,
  type PropertyStatus,
  type PropertyType,
} from "@/lib/portfolio";
import { toFormStrings, useVoiceForm } from "@/lib/voice/form-registry";
import { propertyVoiceFields } from "@/lib/voice/forms";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type FormState = {
  tenantId: string;
  name: string;
  addressLine: string;
  suburb: string;
  city: string;
  province: string;
  propertyType: PropertyType;
  status: PropertyStatus;
  sizeSqm: string;
  rentalPerSqm: string;
  landlord: string;
  features: string;
  notes: string;
};

function toFormState(property?: Doc<"properties">, tenantId?: string): FormState {
  return {
    tenantId: property?.tenantId ?? tenantId ?? "",
    name: property?.name ?? "",
    addressLine: property?.addressLine ?? "",
    suburb: property?.suburb ?? "",
    city: property?.city ?? "",
    province: property?.province ?? "",
    propertyType: property?.propertyType ?? "office",
    status: property?.status ?? "active",
    sizeSqm: property?.sizeSqm?.toString() ?? "",
    rentalPerSqm: property?.rentalPerSqm?.toString() ?? "",
    landlord: property?.landlord ?? "",
    features: property?.features.join(", ") ?? "",
    notes: property?.notes ?? "",
  };
}

/**
 * Create a property (optionally for a fixed client) or edit an existing one. Pass `open` and
 * `onOpenChange` to control the dialog (e.g. from a `?new=1` search param). Voice-fillable.
 */
export function PropertyFormDialog({
  trigger,
  property,
  tenantId,
  onSaved,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger: ReactNode;
  property?: Doc<"properties">;
  tenantId?: Id<"tenants">;
  onSaved?: (propertyId: Id<"properties">) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isEdit = Boolean(property);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const showClientPicker = !isEdit && !tenantId;
  const clients = useQuery(api.clients.list, open && showClientPicker ? {} : "skip");
  const createProperty = useMutation(api.properties.create);
  const updateProperty = useMutation(api.properties.update);
  const [values, setValues] = useState<FormState>(toFormState(property, tenantId));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(toFormState(property, tenantId));
      setError(null);
    }
  }, [open, property, tenantId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  useVoiceForm({
    formId: isEdit ? "property.edit" : "property.create",
    title: isEdit ? `Edit ${property?.name ?? "property"}` : "New property",
    enabled: open,
    fields: propertyVoiceFields({
      clients: showClientPicker
        ? (clients ?? []).map((client) => ({ value: client.tenantId, label: client.name }))
        : undefined,
    }),
    values,
    setValues: (patch) => setValues((current) => ({ ...current, ...toFormStrings(patch) })),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const fields = {
      name: values.name,
      addressLine: values.addressLine,
      suburb: values.suburb || undefined,
      city: values.city,
      province: values.province || undefined,
      propertyType: values.propertyType,
      status: values.status,
      sizeSqm: parseOptionalNumber(values.sizeSqm),
      rentalPerSqm: parseOptionalNumber(values.rentalPerSqm),
      landlord: values.landlord || undefined,
      features: values.features
        .split(",")
        .map((feature) => feature.trim())
        .filter(Boolean),
      notes: values.notes || undefined,
    };
    try {
      if (property) {
        await updateProperty({ propertyId: property._id, ...fields });
        toast.success("Property updated");
        // Close before onSaved so a navigating onSaved wins over a route-controlled close.
        setOpen(false);
        onSaved?.(property._id);
      } else {
        if (!values.tenantId) {
          throw new Error("Choose a client");
        }
        const result = await createProperty({
          tenantId: values.tenantId as Id<"tenants">,
          ...fields,
        });
        toast.success("Property added");
        setOpen(false);
        onSaved?.(result.propertyId);
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
          <DialogTitle>{isEdit ? "Edit property" : "New property"}</DialogTitle>
          <DialogDescription>
            Property details shown to staff and in the client portal.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {!isEdit && !tenantId ? (
              <Field label="Client" htmlFor="property-client" className="sm:col-span-2">
                <NativeSelect
                  id="property-client"
                  required
                  value={values.tenantId}
                  onChange={(e) => set("tenantId", e.target.value)}
                >
                  <option value="">
                    {clients === undefined ? "Loading clients…" : "Choose a client"}
                  </option>
                  {clients?.map((client) => (
                    <option key={client.tenantId} value={client.tenantId}>
                      {client.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field label="Property name" htmlFor="property-name" className="sm:col-span-2">
              <Input
                id="property-name"
                required
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label="Address" htmlFor="property-address" className="sm:col-span-2">
              <Input
                id="property-address"
                required
                value={values.addressLine}
                onChange={(e) => set("addressLine", e.target.value)}
              />
            </Field>
            <Field label="Suburb" htmlFor="property-suburb">
              <Input
                id="property-suburb"
                value={values.suburb}
                onChange={(e) => set("suburb", e.target.value)}
              />
            </Field>
            <Field label="City" htmlFor="property-city">
              <Input
                id="property-city"
                required
                value={values.city}
                onChange={(e) => set("city", e.target.value)}
              />
            </Field>
            <Field label="Province" htmlFor="property-province">
              <Input
                id="property-province"
                value={values.province}
                onChange={(e) => set("province", e.target.value)}
              />
            </Field>
            <Field label="Landlord" htmlFor="property-landlord">
              <Input
                id="property-landlord"
                value={values.landlord}
                onChange={(e) => set("landlord", e.target.value)}
              />
            </Field>
            <Field label="Type" htmlFor="property-type">
              <NativeSelect
                id="property-type"
                value={values.propertyType}
                onChange={(e) => set("propertyType", e.target.value as PropertyType)}
              >
                {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Status" htmlFor="property-status">
              <NativeSelect
                id="property-status"
                value={values.status}
                onChange={(e) => set("status", e.target.value as PropertyStatus)}
              >
                {Object.entries(PROPERTY_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Size (m²)" htmlFor="property-size">
              <Input
                id="property-size"
                inputMode="decimal"
                value={values.sizeSqm}
                onChange={(e) => set("sizeSqm", e.target.value)}
              />
            </Field>
            <Field label="Rental per m² (R)" htmlFor="property-rate">
              <Input
                id="property-rate"
                inputMode="decimal"
                value={values.rentalPerSqm}
                onChange={(e) => set("rentalPerSqm", e.target.value)}
              />
            </Field>
            <Field
              label="Features"
              htmlFor="property-features"
              hint="Comma separated, e.g. Backup power, 12 loading docks"
              className="sm:col-span-2"
            >
              <Input
                id="property-features"
                value={values.features}
                onChange={(e) => set("features", e.target.value)}
              />
            </Field>
            <Field label="Notes" htmlFor="property-notes" className="sm:col-span-2">
              <Textarea
                id="property-notes"
                rows={3}
                value={values.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
          </div>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add property"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
