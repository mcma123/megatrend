import { describe, expect, test } from "vitest";
import {
  voiceAssistantRequestSchema,
  type VoiceAssistantRequest,
  type VoiceCommand,
} from "../../ports/voice-assistant";
import { validateFormValues } from "./form-values";
import { VoiceSession, pageForPath } from "./voice-session";

const startRenewal: VoiceCommand = {
  id: "lease.startRenewal",
  label: "Start renewal",
  description: "Move the lease to renewal in progress.",
  page: "leases.detail",
  effect: "change",
  params: [],
};

const leasesFilter: VoiceCommand = {
  id: "leases.filter",
  label: "Filter leases",
  description: "Switch the leases list filter.",
  page: "leases.list",
  effect: "view",
  params: [
    {
      name: "filter",
      label: "Filter",
      type: "select",
      required: true,
      options: [
        { value: "all", label: "All leases" },
        { value: "expiring", label: "Expiring" },
      ],
    },
  ],
};

const approveField: VoiceCommand = {
  id: "document.approveField",
  label: "Approve field",
  description: "Approve one extracted field.",
  page: "documents.detail",
  effect: "change",
  params: [{ name: "field", label: "Field", type: "select", required: true }],
};

function request(overrides: Partial<VoiceAssistantRequest> = {}): VoiceAssistantRequest {
  return voiceAssistantRequestSchema.parse({
    transcript: "test",
    pathname: "/leases",
    openForm: null,
    availableForms: [
      {
        formId: "client.create",
        title: "New client",
        route: "/clients",
        search: { new: "1" },
        submittable: true,
        fields: [{ name: "name", label: "Name", type: "text", required: true }],
      },
      {
        formId: "document.upload",
        title: "Upload documents",
        route: "/documents",
        search: { new: "1" },
        fields: [{ name: "documentType", label: "Type", type: "text" }],
      },
    ],
    commandCatalog: [startRenewal, leasesFilter, approveField],
    pageCommands: [leasesFilter],
    records: {
      clients: [{ slug: "acme", name: "Acme Logistics" }],
      properties: [],
      leases: [
        { id: "l1", label: "Sandton DC", client: "DHL", endDate: "2027-01-31", status: "active" },
        { id: "l2", label: "Midrand Hub", client: "Acme Logistics", endDate: "2028-05-31", status: "active" },
      ],
      documents: [],
    },
    history: [],
    ...overrides,
  });
}

describe("pageForPath", () => {
  test("maps list and detail routes", () => {
    expect(pageForPath("/leases")).toBe("leases.list");
    expect(pageForPath("/leases/abc")).toBe("leases.detail");
    expect(pageForPath("/clients/acme")).toBe("clients.detail");
    expect(pageForPath("/sourcing")).toBe("sourcing");
    expect(pageForPath("/dashboard")).toBeNull();
  });
});

describe("records", () => {
  test("findRecords ranks by matching words", () => {
    const session = new VoiceSession(request());
    const { matches } = session.findRecords("leases", "DHL Sandton");
    expect(matches[0]).toMatchObject({ id: "l1" });
    expect(matches).toHaveLength(1);
  });

  test("openRecord only accepts known ids", () => {
    const session = new VoiceSession(request());
    expect(session.openRecord("leases", "nope").ok).toBe(false);
    expect(session.openRecord("clients", "acme").ok).toBe(true);
    expect(session.actions).toEqual([{ type: "navigate", route: "/clients/acme", search: undefined }]);
  });
});

describe("runCommand", () => {
  test("runs a live page command with valid params", () => {
    const session = new VoiceSession(request());
    const result = session.runCommand("leases.filter", [{ field: "filter", value: "Expiring" }]);
    expect(result.ok).toBe(true);
    expect(session.actions[0]).toMatchObject({
      type: "run_command",
      commandId: "leases.filter",
      args: { filter: "expiring" },
      effect: "view",
    });
  });

  test("rejects unknown commands, bad params and missing required params", () => {
    const session = new VoiceSession(request());
    expect(session.runCommand("lease.delete", []).ok).toBe(false);
    expect(session.runCommand("leases.filter", [{ field: "filter", value: "archived" }]).ok).toBe(false);
    expect(session.runCommand("leases.filter", []).ok).toBe(false);
    expect(session.actions).toEqual([]);
  });

  test("catalog commands for another page need navigation to that page first", () => {
    const session = new VoiceSession(request());
    expect(session.runCommand("lease.startRenewal", []).ok).toBe(false);
    session.openRecord("leases", "l1");
    const result = session.runCommand("lease.startRenewal", []);
    expect(result.ok).toBe(true);
    expect(session.actions.at(-1)).toMatchObject({ type: "run_command", effect: "change" });
  });

  test("catalog commands with page-specific choices cannot run before the page is open", () => {
    const session = new VoiceSession(request({ pathname: "/documents" }));
    session.navigate("documents");
    const result = session.runCommand("document.approveField", [{ field: "field", value: "rent" }]);
    expect(result.ok).toBe(false);
  });
});

describe("submitForm", () => {
  test("requires a submittable form that is open or filled", () => {
    const session = new VoiceSession(request());
    expect(session.submitForm("client.create").ok).toBe(false);
    expect(session.submitForm("document.upload").ok).toBe(false);
    session.fill("client.create", [{ field: "name", value: "Acme" }]);
    expect(session.submitForm("client.create").ok).toBe(true);
    expect(session.actions.map((action) => action.type)).toEqual(["navigate", "fill_form", "submit_form"]);
  });
});

describe("number bounds", () => {
  test("enforces min and max", () => {
    const form = {
      formId: "sourcing.brief",
      title: "Sourcing brief",
      fields: [{ name: "sizeSqm", label: "Size", type: "number" as const, min: 500, max: 25000 }],
    };
    expect(validateFormValues(form, [{ field: "sizeSqm", value: "12000" }]).accepted).toEqual({ sizeSqm: 12000 });
    expect(validateFormValues(form, [{ field: "sizeSqm", value: "40000" }]).rejected).toHaveLength(1);
  });
});
