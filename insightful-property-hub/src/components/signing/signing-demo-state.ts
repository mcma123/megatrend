/** Presentation-only state. No service credentials, application IDs, storage or network calls. */
export type DemoParty = "renter" | "owner";
export type DemoField = {
  id: number;
  party: DemoParty;
  kind: "signature" | "initials" | "text" | "date";
  x: number;
  y: number;
};
export type DemoState = {
  step: number;
  title: string;
  company: string;
  property: string;
  unit: string;
  rent: string;
  deposit: string;
  document: string;
  parties: Record<DemoParty, { name: string; email: string }>;
  fields: DemoField[];
  activeParty: DemoParty;
  verified: DemoParty[];
  signatures: Partial<Record<DemoParty, string>>;
  consented: DemoParty[];
  applied: boolean;
  paid: boolean;
  active: boolean;
  occupation: boolean;
  declined: boolean;
  events: string[];
  error: string | null;
};
export function initialDemo(): DemoState {
  return {
    step: 0,
    title: "Commercial lease — client demonstration",
    company: "Demo Property Group",
    property: "Demo Business Park",
    unit: "Office 4",
    rent: "12000.00",
    deposit: "24000.00",
    document: "Sample commercial lease.pdf",
    parties: {
      renter: { name: "Alex Tenant", email: "alex@example.test" },
      owner: { name: "Jordan Owner", email: "jordan@example.test" },
    },
    fields: [],
    activeParty: "renter",
    verified: [],
    signatures: {},
    consented: [],
    applied: false,
    paid: false,
    active: false,
    occupation: false,
    declined: false,
    events: ["Sample agreement opened. All activity in this walkthrough is simulated."],
    error: null,
  };
}
export type DemoAction =
  | {
      type: "edit";
      values: Partial<
        Pick<DemoState, "title" | "company" | "property" | "unit" | "rent" | "deposit" | "document">
      >;
    }
  | { type: "party"; party: DemoParty; name: string; email: string }
  | { type: "prepare" }
  | { type: "field"; field: Omit<DemoField, "id"> }
  | { type: "move"; id: number; x: number; y: number }
  | { type: "remove"; id: number }
  | { type: "sample_fields" }
  | { type: "review" }
  | { type: "approve"; reviewed: boolean }
  | { type: "open_signer"; party: DemoParty }
  | { type: "verify"; code: string }
  | { type: "sign"; name: string; reviewed: boolean; consent: boolean }
  | { type: "decline" }
  | { type: "correction" }
  | { type: "complete" }
  | { type: "apply" }
  | { type: "pay" }
  | { type: "activate" }
  | { type: "occupy" }
  | { type: "reset" };
const fail = (state: DemoState, error: string) => ({ ...state, error });
const event = (state: DemoState, message: string, changes: Partial<DemoState> = {}): DemoState => ({
  ...state,
  ...changes,
  error: null,
  events: [...state.events, message],
});
export const fieldPosition = (x: number, y: number) => ({
  x: Math.max(2, Math.min(69, Number.isFinite(x) ? x : 2)),
  y: Math.max(4, Math.min(92, Number.isFinite(y) ? y : 4)),
});
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "reset":
      return initialDemo();
    case "edit":
      return state.step === 0 ? { ...state, ...action.values, error: null } : state;
    case "party":
      return state.step === 0
        ? {
            ...state,
            parties: {
              ...state.parties,
              [action.party]: { name: action.name, email: action.email },
            },
            error: null,
          }
        : state;
    case "prepare": {
      if (state.step !== 0) return state;
      if (
        !state.title.trim() ||
        !state.company.trim() ||
        !state.property.trim() ||
        !state.unit.trim()
      )
        return fail(state, "Complete the agreement, company, property and unit details.");
      if (![state.rent, state.deposit].every((n) => /^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(n)))
        return fail(
          state,
          "Enter rent and deposit as positive rand amounts, for example 12000.00.",
        );
      if (
        !Object.values(state.parties).every(
          (p) => p.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email),
        )
      )
        return fail(state, "Give both sample participants a name and valid email address.");
      return event(
        state,
        "Demo PDF preparation completed. Sample pages are ready for field placement.",
        { step: 1 },
      );
    }
    case "sample_fields":
      return state.step === 1
        ? {
            ...state,
            error: null,
            fields: [
              { id: 1, party: "renter", kind: "signature", x: 8, y: 76 },
              { id: 2, party: "owner", kind: "signature", x: 55, y: 76 },
              { id: 3, party: "renter", kind: "date", x: 8, y: 86 },
              { id: 4, party: "owner", kind: "date", x: 55, y: 86 },
            ],
          }
        : state;
    case "field":
      return state.step === 1 && state.fields.length < 20
        ? {
            ...state,
            error: null,
            fields: [
              ...state.fields,
              {
                ...action.field,
                ...fieldPosition(action.field.x, action.field.y),
                id: Math.max(0, ...state.fields.map((f) => f.id)) + 1,
              },
            ],
          }
        : state;
    case "move":
      return state.step === 1
        ? {
            ...state,
            fields: state.fields.map((f) =>
              f.id === action.id ? { ...f, ...fieldPosition(action.x, action.y) } : f,
            ),
          }
        : state;
    case "remove":
      return state.step === 1
        ? { ...state, fields: state.fields.filter((f) => f.id !== action.id) }
        : state;
    case "review":
      if (state.step !== 1) return state;
      if (
        !(["renter", "owner"] as const).every((p) =>
          state.fields.some((f) => f.party === p && f.kind === "signature"),
        )
      )
        return fail(
          state,
          "Place a signature field for both the renter and owner, or use the sample layout.",
        );
      return event(
        state,
        "Sample terms, parties and field layout submitted for internal approval.",
        { step: 2 },
      );
    case "approve":
      if (state.step !== 2) return state;
      if (!action.reviewed) return fail(state, "Confirm that you reviewed the sample agreement.");
      return event(
        state,
        "Demo approval recorded; renter invitation simulated. No email was sent.",
        { step: 3, declined: false },
      );
    case "open_signer":
      if (state.step !== 3 || state.declined) return state;
      if (state.signatures[action.party])
        return fail(state, "This participant has already signed the demonstration.");
      if (action.party === "owner" && !state.signatures.renter)
        return fail(state, "The renter signs first; the owner is in the next signing stage.");
      return event(state, `Opened ${state.parties[action.party].name}'s demo signer journey.`, {
        step: 4,
        activeParty: action.party,
      });
    case "verify":
      if (state.step !== 4 || state.verified.includes(state.activeParty)) return state;
      if (action.code !== "123456")
        return fail(state, "For this demonstration, enter the displayed sample code: 123456.");
      return event(state, "Mailbox verification simulated using the on-screen demo code.", {
        verified: [...state.verified, state.activeParty],
      });
    case "sign": {
      if (state.step !== 4) return state;
      if (
        !state.verified.includes(state.activeParty) ||
        !action.reviewed ||
        !action.consent ||
        !action.name.trim()
      )
        return fail(
          state,
          "Verify the demo code, review the sample agreement, give consent and enter a signature name.",
        );
      const signatures = {
        ...state.signatures,
        [state.activeParty]: action.name.trim().slice(0, 160),
      };
      return event(
        state,
        `${state.parties[state.activeParty].name}'s signature simulated.${state.activeParty === "renter" ? " Owner invitation is now available." : " All participants have finished."}`,
        {
          signatures,
          consented: [...state.consented, state.activeParty],
          step: signatures.renter && signatures.owner ? 5 : 3,
        },
      );
    }
    case "decline":
      return state.step === 4
        ? event(
            state,
            "Participant declined the demo agreement. Restart the walkthrough to try again.",
            { step: 3, declined: true },
          )
        : state;
    case "correction":
      return state.step === 4
        ? event(
            state,
            "Demo correction requested. All sample submissions cleared for a new approval.",
            { step: 2, signatures: {}, consented: [], verified: [] },
          )
        : state;
    case "complete":
      return state.step === 5 && state.signatures.renter && state.signatures.owner
        ? event(
            state,
            "Demo finalisation completed. No cryptographic seal, timestamp or legal signature was created.",
            { step: 6 },
          )
        : state;
    case "apply":
      return state.step === 6 && !state.applied
        ? event(
            state,
            "Sample lease added to the demo register in Pending activation; deposit request and move-in task created once.",
            { applied: true },
          )
        : state;
    case "pay":
      return state.applied && !state.paid
        ? event(
            state,
            "Demo deposit payment recorded. Lease activation and occupation remain independent.",
            { paid: true },
          )
        : state;
    case "activate":
      return state.applied && !state.active
        ? event(state, "Demo lease activation explicitly approved.", { active: true })
        : state;
    case "occupy":
      return state.applied && !state.occupation
        ? event(state, "Demo occupation authorisation explicitly approved.", { occupation: true })
        : state;
  }
}
export function demoRecord(state: DemoState) {
  return {
    demo: true,
    legallySigned: false,
    externalEmailSent: false,
    productionRecordsCreated: false,
    title: state.title,
    company: state.company,
    property: state.property,
    unit: state.unit,
    rent: state.rent,
    deposit: state.deposit,
    simulatedComplete: state.step === 6,
    participants: state.parties,
    simulatedSignatures: state.signatures,
    portfolio: {
      applied: state.applied,
      paymentRecorded: state.paid,
      active: state.active,
      occupationAuthorised: state.occupation,
    },
    events: state.events,
    notice: "DEMONSTRATION ONLY — NOT A SIGNED AGREEMENT OR PROOF OF PAYMENT.",
  };
}
