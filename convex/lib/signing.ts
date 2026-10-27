import { ConvexError, v, type Infer } from "convex/values";
import { portfolioContext } from "./signingPortfolio";

export const signingStatus = v.union(
  v.literal("draft"),
  v.literal("awaiting_approval"),
  v.literal("ready_to_send"),
  v.literal("awaiting_signatures"),
  v.literal("partially_signed"),
  v.literal("finalising"),
  v.literal("completed"),
  v.literal("declined"),
  v.literal("expired"),
  v.literal("voided"),
  v.literal("superseded"),
);
export const signingCategory = v.union(
  v.literal("residential_lease"),
  v.literal("commercial_lease"),
  v.literal("renewal"),
  v.literal("general_contract"),
  v.literal("suretyship"),
  v.literal("property_sale"),
  v.literal("long_term_lease"),
  v.literal("will"),
  v.literal("bill_of_exchange"),
  v.literal("other"),
);
export const participantResponsibility = v.union(
  v.literal("signer"),
  v.literal("approver"),
  v.literal("viewer"),
  v.literal("copy"),
);
export const notifyChannel = v.union(
  v.literal("email"),
  v.literal("sms"),
  v.literal("whatsapp"),
);
export const identityDocument = v.union(
  v.literal("sa_id"),
  v.literal("passport"),
  v.literal("drivers_licence"),
  v.literal("asylum_permit"),
);
export const signatureMethod = v.union(
  v.literal("electronic"),
  v.literal("advanced"),
);
/** Optional participant attributes added in Phase 9; absent values keep earlier hashes unchanged. */
export const participantExtras = {
  witnessFor: v.optional(v.string()),
  phone: v.optional(v.string()),
  notifyVia: v.optional(notifyChannel),
  whatsappOptInReference: v.optional(v.string()),
};
/** Hashed participant content; storage-only fields (ids, position) are excluded. */
export function partyContent(participant: {
  key: string;
  name: string;
  email: string;
  role: string;
  responsibility: "signer" | "approver" | "viewer" | "copy";
  stage: number;
  witnessFor?: string;
  phone?: string;
  notifyVia?: "email" | "sms" | "whatsapp";
  whatsappOptInReference?: string;
}) {
  const { key, name, email, role, responsibility, stage } = participant;
  const { witnessFor, phone, notifyVia, whatsappOptInReference } = participant;
  return {
    key,
    name,
    email,
    role,
    responsibility,
    stage,
    ...(witnessFor ? { witnessFor } : {}),
    ...(phone ? { phone } : {}),
    ...(notifyVia ? { notifyVia } : {}),
    ...(whatsappOptInReference ? { whatsappOptInReference } : {}),
  };
}
export const participantInput = v.object({
  key: v.string(),
  name: v.string(),
  email: v.string(),
  role: v.string(),
  responsibility: participantResponsibility,
  stage: v.number(),
  ...participantExtras,
});
export const draftInput = v.object({
  title: v.string(),
  category: signingCategory,
  propertyId: v.optional(v.id("properties")),
  leaseId: v.optional(v.id("leases")),
  notes: v.string(),
  signatureMethod: v.optional(signatureMethod),
  portfolioContext: v.optional(portfolioContext),
  participants: v.array(participantInput),
});
export type SigningStatus = Infer<typeof signingStatus>;
export type SigningCategory = Infer<typeof signingCategory>;
export type SigningDraft = Infer<typeof draftInput>;

export const MAX_SIGNING_PARTICIPANTS = 20;
// This is a product restriction, not a legal determination about a particular contract.
export const ORDINARY_SIGNING_CATEGORIES: SigningCategory[] = [
  "residential_lease",
  "commercial_lease",
  "renewal",
  "general_contract",
];

export function boundedText(
  value: string,
  label: string,
  max: number,
  optional = false,
) {
  const text = value.trim();
  if (
    (!optional && !text) ||
    text.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
  ) {
    throw new ConvexError(
      `${label} must contain ${optional ? "0" : "1"}–${max} characters`,
    );
  }
  return text;
}

export function checkedRevision(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new ConvexError("Invalid revision");
  return value;
}

export function normalizeDraft(input: SigningDraft): SigningDraft {
  if (input.participants.length > MAX_SIGNING_PARTICIPANTS) {
    throw new ConvexError(
      `An agreement supports at most ${MAX_SIGNING_PARTICIPANTS} participants`,
    );
  }
  const keys = new Set<string>();
  const participants = input.participants.map((participant) => {
    const key = boundedText(participant.key, "Participant key", 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(key) || keys.has(key)) {
      throw new ConvexError(
        "Participant keys must be unique letters, numbers, hyphens or underscores",
      );
    }
    keys.add(key);
    const email = boundedText(
      participant.email,
      "Participant email",
      254,
    ).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ConvexError("Enter a valid participant email");
    }
    if (
      !Number.isSafeInteger(participant.stage) ||
      participant.stage < 1 ||
      participant.stage > 20
    ) {
      throw new ConvexError(
        "Participant stage must be a whole number from 1 to 20",
      );
    }
    const phone = participant.phone?.replace(/[\s()-]/g, "");
    if (phone && !/^\+[1-9]\d{7,14}$/.test(phone))
      throw new ConvexError(
        "Enter phone numbers in international format, e.g. +27821234567",
      );
    const notifyVia = participant.notifyVia ?? "email";
    if (notifyVia !== "email" && !phone)
      throw new ConvexError(
        "SMS or WhatsApp notification needs a phone number",
      );
    const optIn = participant.whatsappOptInReference?.trim();
    if (notifyVia === "whatsapp" && !optIn)
      throw new ConvexError(
        "WhatsApp needs a reference to the participant's recorded opt-in",
      );
    return {
      key,
      name: boundedText(participant.name, "Participant name", 160),
      email,
      role: boundedText(participant.role, "Participant role", 100),
      responsibility: participant.responsibility,
      stage: participant.stage,
      ...(participant.witnessFor
        ? { witnessFor: participant.witnessFor.trim() }
        : {}),
      ...(phone ? { phone } : {}),
      ...(notifyVia !== "email" ? { notifyVia } : {}),
      ...(notifyVia === "whatsapp" && optIn
        ? {
            whatsappOptInReference: boundedText(
              optIn,
              "WhatsApp opt-in reference",
              300,
            ),
          }
        : {}),
    };
  });
  // A witness is a signer who attests another signer's signature in the same or a later stage.
  for (const witness of participants.filter((p) => p.witnessFor)) {
    const witnessed = participants.find((p) => p.key === witness.witnessFor);
    if (
      witness.responsibility !== "signer" ||
      !witnessed ||
      witnessed.key === witness.key ||
      witnessed.responsibility !== "signer" ||
      witnessed.witnessFor ||
      witness.stage < witnessed.stage
    )
      throw new ConvexError(
        "A witness must be a signer attesting another (non-witness) signer in the same or a later stage",
      );
  }
  return {
    title: boundedText(input.title, "Agreement title", 200),
    category: input.category,
    ...(input.propertyId ? { propertyId: input.propertyId } : {}),
    ...(input.leaseId ? { leaseId: input.leaseId } : {}),
    notes: boundedText(input.notes, "Draft notes", 10_000, true),
    ...(input.portfolioContext
      ? { portfolioContext: input.portfolioContext }
      : {}),
    ...(input.signatureMethod === "advanced"
      ? { signatureMethod: "advanced" as const }
      : {}),
    participants,
  };
}

/** Stable serialization for hashes and replay detection; never store plain credentials. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new ConvexError("Unsupported evidence value");
}

export async function signingHash(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export type SigningPolicy = {
  revision: number;
  legalReviewReference: string;
  privacyNoticeReference: string;
  retentionPolicyReference: string;
  consentVersion: string;
  allowedCategories: SigningCategory[];
  approvalRequired: boolean;
};

/**
 * Method gates: witnessing needs a recorded legal approval; accredited advanced signatures and
 * SMS/WhatsApp channels stay unavailable until a provider is accepted (none is, by design).
 */
export function methodBlockers(
  policy: (SigningPolicy & { witnessingReference?: string }) | null,
  draft: {
    signatureMethod?: "electronic" | "advanced";
    participants: {
      witnessFor?: string;
      notifyVia?: "email" | "sms" | "whatsapp";
    }[];
  },
) {
  const blockers: string[] = [];
  if (
    draft.participants.some((p) => p.witnessFor) &&
    !policy?.witnessingReference?.trim()
  )
    blockers.push(
      "Witnessing requires a recorded legal approval in the signing policy",
    );
  if (draft.signatureMethod === "advanced")
    blockers.push(
      "Accredited advanced electronic signatures are unavailable until a provider is accepted",
    );
  if (draft.participants.some((p) => p.notifyVia === "sms"))
    blockers.push(
      "SMS notification is unavailable until an SMS provider is accepted",
    );
  if (draft.participants.some((p) => p.notifyVia === "whatsapp"))
    blockers.push(
      "WhatsApp notification is unavailable until a WhatsApp provider is accepted",
    );
  return blockers;
}

export function policyBlockers(
  policy: SigningPolicy | null,
  category?: SigningCategory,
) {
  const blockers: string[] = [];
  if (!policy?.legalReviewReference.trim())
    blockers.push("Legal review has not been recorded");
  if (!policy?.privacyNoticeReference.trim())
    blockers.push("Privacy notice has not been recorded");
  if (!policy?.retentionPolicyReference.trim())
    blockers.push("Retention policy has not been recorded");
  if (!policy?.consentVersion.trim())
    blockers.push("Electronic consent version has not been recorded");
  if (!policy?.allowedCategories.length)
    blockers.push("No contract categories have been approved");
  if (
    category &&
    (!ORDINARY_SIGNING_CATEGORIES.includes(category) ||
      !policy?.allowedCategories.includes(category))
  ) {
    blockers.push(
      "This contract category requires legal review or an unsupported signing method",
    );
  }
  return blockers;
}

/** A policy attestation alone never enables external signing. */
export const IMPLEMENTATION_BLOCKERS = [
  "Operational acceptance, monitoring and exception handling (Phase 7) are not complete",
] as const;

const SIGNING_TRANSITIONS: Record<SigningStatus, SigningStatus[]> = {
  draft: ["awaiting_approval", "voided"],
  awaiting_approval: ["draft", "ready_to_send", "voided"],
  ready_to_send: ["draft", "awaiting_signatures", "voided", "superseded"],
  awaiting_signatures: [
    "partially_signed",
    "finalising",
    "declined",
    "expired",
    "voided",
    "superseded",
  ],
  partially_signed: [
    "finalising",
    "declined",
    "expired",
    "voided",
    "superseded",
  ],
  finalising: ["completed"],
  completed: [],
  declined: [],
  expired: [],
  voided: [],
  superseded: [],
};

/** Future workers must supply verified facts, not a browser-selected target status. */
export function assertSigningTransition(
  from: SigningStatus,
  to: SigningStatus,
  facts: {
    approved?: boolean;
    frozen?: boolean;
    canIssue?: boolean;
    allSigned?: boolean;
    artifactsVerified?: boolean;
  } = {},
) {
  if (!SIGNING_TRANSITIONS[from].includes(to))
    throw new ConvexError("Invalid agreement status transition");
  if ((to === "awaiting_approval" || to === "ready_to_send") && !facts.frozen)
    throw new ConvexError("A validated immutable document bundle is required");
  if (to === "ready_to_send" && !facts.approved)
    throw new ConvexError("A current content-bound approval is required");
  if (
    to === "awaiting_signatures" &&
    (!facts.approved || !facts.frozen || !facts.canIssue)
  )
    throw new ConvexError("External signing prerequisites have not passed");
  if (to === "finalising" && !facts.allSigned)
    throw new ConvexError(
      "All required signatures are required before finalisation",
    );
  if (to === "completed" && (!facts.allSigned || !facts.artifactsVerified))
    throw new ConvexError(
      "Signed files and evidence must be verified before completion",
    );
}

export function assertDraftEditable(status: SigningStatus) {
  if (status !== "draft")
    throw new ConvexError(
      "Only a draft can be edited; issued terms require a replacement agreement",
    );
}
