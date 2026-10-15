import { DOCUMENT_TYPE_LABELS } from "@/lib/documents";
import {
  CLIENT_TYPE_LABELS,
  LEASE_STATUS_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  RELATIONSHIP_STATUS_LABELS,
} from "@/lib/portfolio";
import { PRIORITY_LABELS } from "@/lib/workflow";
import type { OpenableVoiceForm, VoiceField } from "./types";

// Voice-fillable form schemas. Each form component passes the same fields to `useVoiceForm`,
// and the assistant receives `openableVoiceForms()` so it can open a form before it is mounted.
// Field names must match the form's state keys.

type Option = { value: string; label: string };

const options = (labels: Record<string, string>): Option[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export type VoiceFormOptions = {
  /** Client choices (tenant id -> client name) when the form lets staff pick a client. */
  clients?: Option[];
  /** Property choices (property id -> "Name · Client") when the form lets staff pick a property. */
  properties?: Option[];
  /** Active clients only (sourcing briefs require an active client). */
  activeClients?: Option[];
};

export function propertyVoiceFields({ clients }: VoiceFormOptions = {}): VoiceField[] {
  return [
    ...(clients
      ? [
          {
            name: "tenantId",
            label: "Client",
            type: "select",
            options: clients,
            required: true,
            inputId: "property-client",
          } as const,
        ]
      : []),
    {
      name: "name",
      label: "Property name",
      type: "text",
      required: true,
      inputId: "property-name",
    },
    {
      name: "addressLine",
      label: "Street address",
      type: "text",
      required: true,
      inputId: "property-address",
    },
    { name: "suburb", label: "Suburb", type: "text", inputId: "property-suburb" },
    { name: "city", label: "City", type: "text", required: true, inputId: "property-city" },
    { name: "province", label: "Province / region", type: "text", inputId: "property-province" },
    { name: "landlord", label: "Landlord", type: "text", inputId: "property-landlord" },
    {
      name: "propertyType",
      label: "Type",
      type: "select",
      options: options(PROPERTY_TYPE_LABELS),
      inputId: "property-type",
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: options(PROPERTY_STATUS_LABELS),
      inputId: "property-status",
    },
    { name: "sizeSqm", label: "Size (m²)", type: "number", inputId: "property-size" },
    {
      name: "rentalPerSqm",
      label: "Rental per m² (R)",
      type: "number",
      description: "Monthly rental per square metre only. Not a sale or total price.",
      inputId: "property-rate",
    },
    {
      name: "features",
      label: "Features",
      type: "text",
      description: "Comma separated, e.g. Garden, Garage",
      inputId: "property-features",
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      description:
        "Free text. Spoken facts without their own field go here as 'Label: value' lines (e.g. 'Bedrooms: 3', 'Price: USD 150000').",
      inputId: "property-notes",
    },
  ];
}

export function leaseVoiceFields({ properties }: VoiceFormOptions = {}): VoiceField[] {
  return [
    ...(properties
      ? [
          {
            name: "propertyId",
            label: "Property",
            type: "select",
            options: properties,
            required: true,
            inputId: "lease-property",
          } as const,
        ]
      : []),
    {
      name: "startDate",
      label: "Start date",
      type: "date",
      required: true,
      inputId: "lease-start",
    },
    { name: "endDate", label: "End date", type: "date", required: true, inputId: "lease-end" },
    {
      name: "monthlyRental",
      label: "Monthly rental (R)",
      type: "number",
      required: true,
      inputId: "lease-rental",
    },
    {
      name: "escalationPercent",
      label: "Annual escalation (%)",
      type: "number",
      inputId: "lease-escalation",
    },
    {
      name: "noticePeriodMonths",
      label: "Notice period (months)",
      type: "number",
      inputId: "lease-notice",
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: options(LEASE_STATUS_LABELS),
      inputId: "lease-status",
    },
    { name: "breakClause", label: "Break clause", type: "text", inputId: "lease-break" },
    { name: "renewalOption", label: "Renewal option", type: "text", inputId: "lease-renewal" },
    { name: "accountManagerName", label: "Consultant", type: "text", inputId: "lease-consultant" },
  ];
}

export function actionVoiceFields({ clients }: VoiceFormOptions = {}): VoiceField[] {
  return [
    ...(clients
      ? [
          {
            name: "tenantId",
            label: "Client",
            type: "select",
            options: clients,
            required: true,
            inputId: "action-client",
          } as const,
        ]
      : []),
    { name: "title", label: "Title", type: "text", required: true, inputId: "action-title" },
    { name: "description", label: "Description", type: "textarea", inputId: "action-description" },
    { name: "dueDate", label: "Due date", type: "date", inputId: "action-due" },
    {
      name: "priority",
      label: "Priority",
      type: "select",
      options: options(PRIORITY_LABELS),
      inputId: "action-priority",
    },
    {
      name: "visibleToClient",
      label: "Visible to client",
      type: "boolean",
      inputId: "action-visible",
    },
  ];
}

export function clientVoiceFields({ isEdit = false }: { isEdit?: boolean } = {}): VoiceField[] {
  return [
    { name: "name", label: "Client name", type: "text", required: true, inputId: "client-name" },
    ...(isEdit
      ? []
      : [
          {
            name: "slug",
            label: "Portal address (slug)",
            type: "text",
            description:
              "Lowercase letters, numbers and dashes. Filled automatically from the name.",
            inputId: "client-slug",
          } as const,
        ]),
    {
      name: "contactName",
      label: "Primary contact name",
      type: "text",
      required: true,
      inputId: "client-contact",
    },
    {
      name: "contactEmail",
      label: "Primary contact email",
      type: "text",
      required: true,
      inputId: "client-email",
    },
    { name: "industry", label: "Industry", type: "text", inputId: "client-industry" },
    {
      name: "clientType",
      label: "Client type",
      type: "select",
      options: options(CLIENT_TYPE_LABELS),
      inputId: "client-type",
    },
    {
      name: "relationshipStatus",
      label: "Relationship status",
      type: "select",
      options: options(RELATIONSHIP_STATUS_LABELS),
      inputId: "client-status",
    },
    {
      name: "accountManagerName",
      label: "Account manager",
      type: "text",
      inputId: "client-manager",
    },
    { name: "clientSince", label: "Client since", type: "date", inputId: "client-since" },
    ...(isEdit
      ? []
      : [
          {
            name: "inviteContactAsAdmin",
            label: "Invite the contact as client admin",
            type: "boolean",
            inputId: "client-invite",
          } as const,
        ]),
  ];
}

export function documentUploadVoiceFields({
  clients,
  properties,
}: VoiceFormOptions = {}): VoiceField[] {
  return [
    ...(clients
      ? [
          {
            name: "tenantId",
            label: "Client",
            type: "select",
            options: clients,
            required: true,
            inputId: "upload-client",
          } as const,
        ]
      : []),
    ...(properties
      ? [
          {
            name: "propertyId",
            label: "Property (optional)",
            type: "select",
            options: properties,
            inputId: "upload-property",
          } as const,
        ]
      : []),
    {
      name: "declaredType",
      label: "Document type",
      type: "select",
      options: options(DOCUMENT_TYPE_LABELS),
      description: "Leave empty to auto-detect.",
      inputId: "upload-type",
    },
  ];
}

export const SOURCING_TYPES = ["office", "logistics", "warehouse", "retail"] as const;

export function sourcingVoiceFields({ clients }: VoiceFormOptions = {}): VoiceField[] {
  return [
    ...(clients
      ? [
          {
            name: "tenantId",
            label: "Client",
            type: "select",
            options: clients,
            required: true,
            inputId: "sourcing-client",
          } as const,
        ]
      : []),
    {
      name: "propertyType",
      label: "Property type",
      type: "select",
      required: true,
      options: SOURCING_TYPES.map((value) => ({ value, label: PROPERTY_TYPE_LABELS[value] })),
      inputId: "sourcing-type",
    },
    {
      name: "sizeSqm",
      label: "Size (m²)",
      type: "number",
      required: true,
      min: 500,
      max: 25000,
      description: "500 to 25,000 square metres, rounded to 500.",
      inputId: "sourcing-size-field",
    },
    {
      name: "location",
      label: "Location",
      type: "text",
      required: true,
      inputId: "sourcing-location",
    },
    { name: "notes", label: "Requirements / notes", type: "textarea", inputId: "sourcing-notes" },
  ];
}

/** Forms the assistant can open by navigating (each route opens its create dialog for `?new=1`). */
export function openableVoiceForms(choices: VoiceFormOptions): OpenableVoiceForm[] {
  return [
    {
      formId: "property.create",
      title: "New property",
      route: "/properties",
      search: { new: "1" },
      fields: propertyVoiceFields({ clients: choices.clients }),
      submittable: true,
    },
    {
      formId: "lease.create",
      title: "New lease",
      route: "/leases",
      search: { new: "1" },
      fields: leaseVoiceFields({ properties: choices.properties }),
      submittable: true,
    },
    {
      formId: "action.create",
      title: "New task",
      route: "/tasks",
      search: { new: "1" },
      fields: actionVoiceFields({ clients: choices.clients }),
      submittable: true,
    },
    {
      formId: "client.create",
      title: "New client",
      route: "/clients",
      search: { new: "1" },
      fields: clientVoiceFields(),
      submittable: true,
    },
    {
      formId: "document.upload",
      title: "Upload documents",
      route: "/documents",
      search: { new: "1" },
      fields: documentUploadVoiceFields({
        clients: choices.clients,
        properties: choices.properties,
      }),
    },
    {
      formId: "sourcing.brief",
      title: "Property sourcing brief",
      route: "/sourcing",
      fields: sourcingVoiceFields({ clients: choices.activeClients ?? choices.clients }),
      submittable: true,
    },
  ];
}
