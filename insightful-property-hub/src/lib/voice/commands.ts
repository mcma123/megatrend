import type { VoiceCommand, VoiceField } from "./types";

// Static catalog of page commands the voice assistant knows about, even before their page is open.
// Pages register live handlers (and live select options) with `useVoiceCommands`. "change" commands
// only run after the user taps Confirm. Destructive actions (delete/archive/reject/remove/revoke)
// are intentionally absent.

const query: VoiceField = { name: "query", label: "Search text", type: "text", required: true };

const select = (name: string, label: string, options: [string, string][]): VoiceField => ({
  name,
  label,
  type: "select",
  required: true,
  options: options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
});

/** A select whose options are only known on its page (supplied by the page's handler). */
const liveSelect = (name: string, label: string): VoiceField => ({
  name,
  label,
  type: "select",
  required: true,
});

export const COMMAND_CATALOG: VoiceCommand[] = [
  // Clients
  {
    id: "clients.search",
    label: "Search clients",
    description: "Filter the clients list by name.",
    page: "clients.list",
    effect: "view",
    params: [query],
  },
  {
    id: "client.tab",
    label: "Show client tab",
    description: "Switch the client page tab.",
    page: "clients.detail",
    effect: "view",
    params: [
      select("tab", "Tab", [
        ["portfolio", "Portfolio"],
        ["leases", "Leases"],
        ["documents", "Documents"],
        ["actions", "Actions"],
      ]),
    ],
  },
  {
    id: "client.openEdit",
    label: "Edit client",
    description: "Open the edit client form (form client.edit).",
    page: "clients.detail",
    effect: "view",
    params: [],
  },
  {
    id: "client.openAddProperty",
    label: "Add property for client",
    description: "Open the new property form for this client (form property.create).",
    page: "clients.detail",
    effect: "view",
    params: [],
  },
  {
    id: "client.openAddLease",
    label: "Add lease for client",
    description: "Open the new lease form for this client (form lease.create).",
    page: "clients.detail",
    effect: "view",
    params: [],
  },
  {
    id: "client.openUpload",
    label: "Upload documents for client",
    description:
      "Open the upload dialog for this client (form document.upload). The user picks the files.",
    page: "clients.detail",
    effect: "view",
    params: [],
  },
  {
    id: "client.openPortal",
    label: "Open client portal",
    description: "Open this client's portal.",
    page: "clients.detail",
    effect: "view",
    params: [],
  },

  // Properties
  {
    id: "properties.search",
    label: "Search properties",
    description: "Filter the properties list.",
    page: "properties.list",
    effect: "view",
    params: [query],
  },
  {
    id: "property.openEdit",
    label: "Edit property",
    description: "Open the edit property form (form property.edit).",
    page: "properties.detail",
    effect: "view",
    params: [],
  },
  {
    id: "property.openAddLease",
    label: "Add lease to property",
    description: "Open the new lease form for this property (form lease.create).",
    page: "properties.detail",
    effect: "view",
    params: [],
  },

  // Leases
  {
    id: "leases.filter",
    label: "Filter leases",
    description: "Switch the leases list filter.",
    page: "leases.list",
    effect: "view",
    params: [
      select("filter", "Filter", [
        ["all", "All leases"],
        ["expiring", "Expiring within 12 months"],
        ["renewals", "Renewal pipeline"],
      ]),
    ],
  },
  {
    id: "lease.openEdit",
    label: "Edit lease",
    description: "Open the edit lease form (form lease.edit).",
    page: "leases.detail",
    effect: "view",
    params: [],
  },
  {
    id: "lease.startRenewal",
    label: "Start renewal",
    description: "Set this active lease to 'renewal in progress'.",
    page: "leases.detail",
    effect: "change",
    params: [],
  },
  {
    id: "lease.addClause",
    label: "Add lease clause",
    description: "Add a clause to this lease.",
    page: "leases.detail",
    effect: "change",
    params: [
      { name: "title", label: "Clause title", type: "text", required: true },
      { name: "detail", label: "What the clause says", type: "textarea", required: true },
    ],
  },
  {
    id: "lease.draftInsight",
    label: "Draft insight with AI",
    description:
      "Draft a client insight from this lease and open it for review. Nothing is published.",
    page: "leases.detail",
    effect: "view",
    params: [],
  },

  // Documents
  {
    id: "documents.tab",
    label: "Filter documents",
    description: "Switch the documents list tab.",
    page: "documents.list",
    effect: "view",
    params: [
      select("tab", "Tab", [
        ["all", "All"],
        ["processing", "Processing"],
        ["review", "Needs review"],
        ["failed", "Failed"],
      ]),
    ],
  },
  {
    id: "documents.search",
    label: "Search documents",
    description: "Filter documents by filename, client or property.",
    page: "documents.list",
    effect: "view",
    params: [query],
  },
  {
    id: "document.reprocess",
    label: "Re-process document",
    description: "Run OCR and extraction again for this document.",
    page: "documents.detail",
    effect: "change",
    params: [],
  },
  {
    id: "document.approveHighConfidence",
    label: "Approve high-confidence fields",
    description: "Approve all detected (high-confidence) extracted fields.",
    page: "documents.detail",
    effect: "change",
    params: [],
  },
  {
    id: "document.approveField",
    label: "Approve field",
    description: "Approve one extracted field as detected.",
    page: "documents.detail",
    effect: "change",
    params: [liveSelect("field", "Field")],
  },
  {
    id: "document.correctField",
    label: "Correct field",
    description: "Approve one extracted field with a corrected value.",
    page: "documents.detail",
    effect: "change",
    params: [
      liveSelect("field", "Field"),
      { name: "value", label: "Corrected value", type: "text", required: true },
    ],
  },
  {
    id: "document.completeReview",
    label: "Complete review",
    description: "Mark the document review complete (all fields decided).",
    page: "documents.detail",
    effect: "change",
    params: [],
  },
  {
    id: "document.linkProperty",
    label: "Link property",
    description: "Link this document to a property.",
    page: "documents.detail",
    effect: "change",
    params: [liveSelect("property", "Property")],
  },
  {
    id: "document.applyToLease",
    label: "Apply approved fields to lease",
    description: "Copy approved lease fields to an existing lease or a new lease.",
    page: "documents.detail",
    effect: "change",
    params: [liveSelect("lease", "Lease")],
  },
  {
    id: "document.retryStage",
    label: "Retry processing stage",
    description: "Retry a failed processing stage.",
    page: "documents.detail",
    effect: "change",
    params: [liveSelect("stage", "Stage")],
  },
  {
    id: "document.acknowledgeIncomplete",
    label: "Acknowledge incomplete coverage",
    description: "Record that staff checked the incomplete source coverage.",
    page: "documents.detail",
    effect: "change",
    params: [
      {
        name: "reason",
        label: "What was checked (10-500 characters)",
        type: "textarea",
        required: true,
      },
    ],
  },

  // Sourcing
  {
    id: "sourcing.openBrief",
    label: "Open saved brief",
    description: "Show a saved sourcing brief and its results.",
    page: "sourcing",
    effect: "view",
    params: [liveSelect("brief", "Brief")],
  },
];

export function catalogCommand(id: string) {
  return COMMAND_CATALOG.find((command) => command.id === id) ?? null;
}
