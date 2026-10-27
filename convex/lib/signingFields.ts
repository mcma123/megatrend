import { ConvexError, v } from "convex/values";
import { z } from "zod";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { PageGeometry } from "./signingPreparation";
import {
  boundedText,
  canonicalJson,
  methodBlockers,
  policyBlockers,
  signingHash,
} from "./signing";

export const MAX_SIGNING_FIELDS = 400;
export const FIELD_COORDINATE_SYSTEM = "crop-top-left-unrotated-v1";
export const FIELD_TYPES = [
  "signature",
  "initials",
  "full_name",
  "signing_date",
  "text",
  "number",
  "checkbox",
  "radio",
  "dropdown",
  "attachment",
] as const;
export const FIELD_LABELS: Record<(typeof FIELD_TYPES)[number], string> = {
  signature: "Signature",
  initials: "Initials",
  full_name: "Full name",
  signing_date: "Signing date",
  text: "Text",
  number: "Number",
  checkbox: "Checkbox",
  radio: "Choice (radio)",
  dropdown: "Choice (list)",
  attachment: "Supporting document",
};
export const ATTACHMENT_PURPOSES = [
  "identity",
  "proof_of_income",
  "proof_of_address",
  "company_authority",
  "other",
] as const;
export const ATTACHMENT_PURPOSE_LABELS: Record<
  (typeof ATTACHMENT_PURPOSES)[number],
  string
> = {
  identity: "Identity document",
  proof_of_income: "Proof of income",
  proof_of_address: "Proof of address",
  company_authority: "Company authority",
  other: "Other supporting document",
};
export const attachmentPurpose = v.union(
  ...ATTACHMENT_PURPOSES.map((purpose) => v.literal(purpose)),
);
export const CHOICE_TYPES = new Set(["radio", "dropdown"]);
export const CONDITION_SOURCES = new Set(["checkbox", "radio", "dropdown"]);
export const fieldType = v.union(...FIELD_TYPES.map((type) => v.literal(type)));
export const fieldDefinition = v.object({
  key: v.string(),
  type: fieldType,
  label: v.string(),
  participantKey: v.string(),
  pageIndex: v.number(),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
  required: v.boolean(),
  readOnly: v.boolean(),
  fixedValue: v.optional(v.string()),
  minLength: v.optional(v.number()),
  maxLength: v.optional(v.number()),
  min: v.optional(v.number()),
  max: v.optional(v.number()),
  decimals: v.optional(v.number()),
  options: v.optional(v.array(v.string())),
  showIf: v.optional(v.object({ fieldKey: v.string(), equals: v.string() })),
  purpose: v.optional(attachmentPurpose),
});
const ratio = z.number().finite().min(0).max(1);
export const fieldSchema = z
  .object({
    key: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    type: z.enum(FIELD_TYPES),
    label: z.string().max(120),
    participantKey: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    pageIndex: z.number().int().min(0).max(199),
    x: ratio,
    y: ratio,
    width: ratio.positive(),
    height: ratio.positive(),
    required: z.boolean(),
    readOnly: z.boolean(),
    fixedValue: z.string().max(2000).optional(),
    minLength: z.number().int().min(0).max(2000).optional(),
    maxLength: z.number().int().min(1).max(2000).optional(),
    min: z.number().finite().min(-1e12).max(1e12).optional(),
    max: z.number().finite().min(-1e12).max(1e12).optional(),
    decimals: z.number().int().min(0).max(6).optional(),
    options: z
      .array(z.string().trim().min(1).max(80))
      .min(2)
      .max(20)
      .optional(),
    showIf: z
      .object({
        fieldKey: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        equals: z.string().max(80),
      })
      .strict()
      .optional(),
    purpose: z.enum(ATTACHMENT_PURPOSES).optional(),
  })
  .strict();
export type SigningField = z.infer<typeof fieldSchema>;
export type FieldRect = Pick<SigningField, "x" | "y" | "width" | "height">;
export type FieldParticipant = Pick<
  Doc<"signingParticipants">,
  | "key"
  | "name"
  | "email"
  | "role"
  | "responsibility"
  | "stage"
  | "witnessFor"
  | "phone"
  | "notifyVia"
  | "whatsappOptInReference"
>;

/** Coordinates are fractions of the UNROTATED crop box, measured from its top-left. */
export function fieldToPdfRect(
  field: FieldRect,
  page: Pick<PageGeometry, "cropBox">,
): [number, number, number, number] {
  const [left, bottom, right, top] = page.cropBox;
  const width = right - left,
    height = top - bottom;
  return [
    left + field.x * width,
    top - (field.y + field.height) * height,
    left + (field.x + field.width) * width,
    top - field.y * height,
  ];
}
export function toDisplayRect(rect: FieldRect, rotation: number): FieldRect {
  const { x, y, width, height } = rect;
  const subtract = (a: number, b: number, c = 0) => {
    const value = a - b - c;
    return Math.abs(value) < 1e-12 ? 0 : value;
  };
  switch (rotation) {
    case 0:
      return { x, y, width, height };
    case 90:
      return { x: subtract(1, y, height), y: x, width: height, height: width };
    case 180:
      return {
        x: subtract(1, x, width),
        y: subtract(1, y, height),
        width,
        height,
      };
    case 270:
      return { x: y, y: subtract(1, x, width), width: height, height: width };
    default:
      throw new Error("Unsupported page rotation");
  }
}
export function fromDisplayRect(rect: FieldRect, rotation: number): FieldRect {
  return toDisplayRect(rect, (360 - rotation) % 360);
}
export function adjustDisplayRect(
  rect: FieldRect,
  dx: number,
  dy: number,
  resize: boolean,
  minWidth = 0.005,
  minHeight = 0.005,
): FieldRect {
  const clamp = (n: number, low: number, high: number) =>
    Math.max(low, Math.min(high, n));
  return resize
    ? {
        ...rect,
        width: clamp(rect.width + dx, minWidth, 1 - rect.x),
        height: clamp(rect.height + dy, minHeight, 1 - rect.y),
      }
    : {
        ...rect,
        x: clamp(rect.x + dx, 0, 1 - rect.width),
        y: clamp(rect.y + dy, 0, 1 - rect.height),
      };
}
export function initialField(
  type: SigningField["type"],
  participantKey: string,
  page: PageGeometry,
  key: string,
): SigningField {
  const dimensions: Record<SigningField["type"], [number, number]> = {
    signature: [140, 40],
    initials: [60, 28],
    full_name: [150, 24],
    signing_date: [100, 24],
    text: [150, 24],
    number: [90, 24],
    checkbox: [18, 18],
    radio: [150, 24],
    dropdown: [150, 24],
    attachment: [150, 24],
  };
  const [width, height] = dimensions[type];
  return {
    key,
    type,
    label: FIELD_LABELS[type],
    participantKey,
    pageIndex: page.pageIndex,
    x: 0.08,
    y: 0.1,
    width: Math.min(0.8, width / page.widthPt),
    height: Math.min(0.4, height / page.heightPt),
    required: true,
    readOnly: type === "signing_date" || type === "full_name",
    ...(type === "text" || type === "full_name"
      ? { minLength: 1, maxLength: type === "full_name" ? 160 : 500 }
      : {}),
    ...(type === "number" ? { decimals: 2 } : {}),
    ...(CHOICE_TYPES.has(type) ? { options: ["Option 1", "Option 2"] } : {}),
    ...(type === "attachment" ? { purpose: "other" as const } : {}),
  };
}
export function parsePageSelection(value: string, pageCount: number): number[] {
  if (!value.trim() || value.length > 1000)
    throw new Error("Enter page numbers such as 1, 3-5");
  const selected = new Set<number>();
  for (const item of value.split(",")) {
    const match = /^\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*$/.exec(item);
    if (!match) throw new Error("Use page numbers and ranges such as 1, 3-5");
    const start = Number(match[1]),
      end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > pageCount)
      throw new Error("Choose pages within the prepared PDF");
    for (let page = start; page <= end; page++) selected.add(page - 1);
  }
  return [...selected].sort((a, b) => a - b);
}
export function validateFixedValue(field: SigningField) {
  const value = field.fixedValue;
  if (field.type === "signing_date" && !field.readOnly)
    throw new ConvexError("Signing dates must be recorded by the server");
  if (
    (field.type === "signature" || field.type === "initials") &&
    field.readOnly
  )
    throw new ConvexError(
      "Signatures and initials must be completed by their assigned signer",
    );
  const fixable = ["text", "number", "checkbox", "radio", "dropdown"];
  if (value !== undefined && (!field.readOnly || !fixable.includes(field.type)))
    throw new ConvexError(
      "Only locked text, number, checkbox and choice fields accept approved values",
    );
  if (field.readOnly && fixable.includes(field.type) && value === undefined)
    throw new ConvexError("Read-only fields need an approved value");
  if (value === undefined) return;
  if (CHOICE_TYPES.has(field.type)) {
    if (!field.options?.includes(value))
      throw new ConvexError(
        "An approved choice must be one of the field's options",
      );
    return;
  }
  boundedText(value, "Approved value", 2000, !field.required);
  if (
    field.type === "text" &&
    (value.length < (field.minLength ?? (field.required ? 1 : 0)) ||
      value.length > (field.maxLength ?? 500))
  )
    throw new ConvexError("Approved text violates its length limits");
  if (field.type === "number") {
    if (
      !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) ||
      !Number.isFinite(Number(value)) ||
      Math.abs(Number(value)) > 1e12 ||
      (field.min !== undefined && Number(value) < field.min) ||
      (field.max !== undefined && Number(value) > field.max) ||
      (value.split(".")[1]?.length ?? 0) > (field.decimals ?? 2)
    )
      throw new ConvexError("Approved number violates its numeric limits");
  }
  if (
    field.type === "checkbox" &&
    (!["true", "false"].includes(value) || (field.required && value !== "true"))
  )
    throw new ConvexError("A required locked checkbox must be checked");
}
export function normalizeFields(
  input: unknown,
  pages: PageGeometry[],
  participants: FieldParticipant[],
): SigningField[] {
  const parsed = z.array(fieldSchema).max(MAX_SIGNING_FIELDS).safeParse(input);
  if (!parsed.success)
    throw new ConvexError(
      "Invalid fields. Check types, coordinates, limits and the 400-field maximum",
    );
  if (new TextEncoder().encode(canonicalJson(parsed.data)).length > 200_000)
    throw new ConvexError(
      "Field preparation exceeds its 200 KB evidence limit. Reduce approved text or split the agreement",
    );
  const keys = new Set<string>();
  const normalized = parsed.data.map((field) => {
    if (keys.has(field.key)) throw new ConvexError("Field keys must be unique");
    keys.add(field.key);
    const page = pages[field.pageIndex];
    if (
      !page ||
      page.pageIndex !== field.pageIndex ||
      field.x + field.width > 1 + 1e-9 ||
      field.y + field.height > 1 + 1e-9 ||
      field.width * page.widthPt < 8 ||
      field.height * page.heightPt < 8
    )
      throw new ConvexError(
        "Place each field inside its page and at least 8 points wide and high",
      );
    if (
      !participants.some(
        (p) => p.key === field.participantKey && p.responsibility === "signer",
      )
    )
      throw new ConvexError(
        "Every field must belong to a signer in this revision",
      );
    const text = field.type === "text" || field.type === "full_name";
    const choice = CHOICE_TYPES.has(field.type);
    if (choice !== Boolean(field.options))
      throw new ConvexError(
        "Choice fields need 2–20 options; other fields have none",
      );
    if (field.options && new Set(field.options).size !== field.options.length)
      throw new ConvexError("Choice options must be unique");
    if ((field.type === "attachment") !== Boolean(field.purpose))
      throw new ConvexError(
        "Supporting-document fields need a declared purpose; other fields have none",
      );
    if (field.type === "attachment" && field.readOnly)
      throw new ConvexError(
        "Supporting-document fields are completed by the participant",
      );
    if (
      (!text &&
        (field.minLength !== undefined || field.maxLength !== undefined)) ||
      (field.type !== "number" &&
        (field.min !== undefined ||
          field.max !== undefined ||
          field.decimals !== undefined))
    )
      throw new ConvexError("Validation rules must match the field type");
    if (
      (text && (field.minLength ?? 0) > (field.maxLength ?? 500)) ||
      (field.min !== undefined &&
        field.max !== undefined &&
        field.min > field.max)
    )
      throw new ConvexError("Minimum limits cannot exceed maximum limits");
    const normalized = {
      ...field,
      label: boundedText(field.label, "Field label", 120),
    };
    if (field.type === "full_name" && field.readOnly) {
      const name = participants.find(
        (p) => p.key === field.participantKey,
      )!.name;
      if (
        name.length < (field.minLength ?? 0) ||
        name.length > (field.maxLength ?? 500)
      )
        throw new ConvexError(
          "The participant's approved name violates the field length limits",
        );
    }
    validateFixedValue(normalized);
    return normalized;
  });
  // Conditions: one level only, same participant, a checkbox or choice source and a valid value.
  const byKey = new Map(normalized.map((field) => [field.key, field]));
  for (const field of normalized) {
    if (!field.showIf) continue;
    const source = byKey.get(field.showIf.fieldKey);
    if (
      !source ||
      source.key === field.key ||
      source.participantKey !== field.participantKey ||
      source.showIf ||
      !CONDITION_SOURCES.has(source.type) ||
      (source.type === "checkbox"
        ? !["true", "false"].includes(field.showIf.equals)
        : !source.options?.includes(field.showIf.equals))
    )
      throw new ConvexError(
        "A conditional field must depend on an unconditional checkbox or choice field of the same signer, using one of its values",
      );
    if (
      field.type === "signature" &&
      field.required &&
      !normalized.some(
        (f) =>
          f.participantKey === field.participantKey &&
          f.type === "signature" &&
          f.required &&
          !f.showIf,
      )
    )
      throw new ConvexError(
        "Each signer needs a required signature that is always shown",
      );
  }
  return normalized;
}
export function layoutBlockers(
  fields: SigningField[],
  participants: FieldParticipant[],
) {
  const signers = participants.filter((p) => p.responsibility === "signer");
  const blockers = signers.length ? [] : ["Add at least one signer"];
  for (const participant of signers)
    if (
      !fields.some(
        (f) =>
          f.participantKey === participant.key &&
          f.type === "signature" &&
          f.required &&
          !f.showIf,
      )
    )
      blockers.push(`Add a required signature for ${participant.name}`);
  return blockers;
}
export const layoutContent = (
  agreement: Doc<"signingAgreements">,
  bundle: Doc<"signingBundles">,
  fields: SigningField[],
) => ({
  coordinateSystem: FIELD_COORDINATE_SYSTEM,
  contractVersion: 1,
  tenantId: agreement.tenantId,
  agreementId: agreement._id,
  revisionId: agreement.currentRevisionId,
  bundleId: bundle._id,
  pdfHash: bundle.pdfHash,
  manifestHash: bundle.manifestHash,
  pages: bundle.pages,
  fields,
});

export async function preparationState(
  ctx: QueryCtx | MutationCtx,
  agreement: Doc<"signingAgreements">,
  bundle: Doc<"signingBundles"> | null,
  revision: Doc<"signingRevisions">,
  participants: FieldParticipant[],
  policy: Doc<"signingPolicies"> | null,
) {
  const blockers = [
    ...policyBlockers(policy, agreement.category),
    ...methodBlockers(policy, {
      signatureMethod: revision.signatureMethod,
      participants,
    }),
  ];
  if (
    !bundle ||
    bundle.tenantId !== agreement.tenantId ||
    bundle.agreementId !== agreement._id ||
    bundle.revisionId !== revision._id ||
    bundle.fileRevision !== (agreement.fileRevision ?? 0) ||
    (bundle.retainUntil ?? 0) <= Date.now() ||
    !bundle.pages?.length ||
    !bundle.manifestVersion
  )
    return {
      layout: null,
      fields: [] as SigningField[],
      blockers: [...blockers, "Prepare and validate the current PDF bundle"],
      preparationHash: null,
      snapshot: null,
    };
  const layout = agreement.currentLayoutId
    ? await ctx.db.get(agreement.currentLayoutId)
    : null;
  if (
    !layout ||
    layout.tenantId !== agreement.tenantId ||
    layout.agreementId !== agreement._id ||
    layout.revisionId !== revision._id ||
    layout.bundleId !== bundle._id ||
    layout.version !== (agreement.layoutRevision ?? 0)
  )
    return {
      layout: null,
      fields: [] as SigningField[],
      blockers: [...blockers, "Save field preparation for this PDF bundle"],
      preparationHash: null,
      snapshot: null,
    };
  const fields = normalizeFields(
    layout.fields,
    bundle.pages as PageGeometry[],
    participants,
  );
  if (
    (await signingHash(layoutContent(agreement, bundle, fields))) !==
    layout.layoutHash
  )
    throw new ConvexError("Field preparation integrity check failed");
  const snapshot = {
    contractVersion: 1,
    coordinateSystem: FIELD_COORDINATE_SYSTEM,
    tenantId: agreement.tenantId,
    agreementId: agreement._id,
    revisionId: revision._id,
    contentHash: revision.contentHash,
    ...(revision.portfolioContext
      ? { portfolioContext: revision.portfolioContext }
      : {}),
    bundleId: bundle._id,
    pdfHash: bundle.pdfHash,
    manifestHash: bundle.manifestHash,
    artifactKey: bundle.artifactKey,
    storageVersion: bundle.storageVersion,
    manifestKey: bundle.manifestKey,
    manifestVersion: bundle.manifestVersion,
    pages: bundle.pages,
    layoutId: layout._id,
    layoutHash: layout.layoutHash,
    fields,
    participants: participants.map(
      ({
        key,
        name,
        email,
        role,
        responsibility,
        stage,
        witnessFor,
        phone,
        notifyVia,
        whatsappOptInReference,
      }) => ({
        key,
        name,
        email,
        role,
        responsibility,
        stage,
        witnessFor,
        phone,
        notifyVia,
        whatsappOptInReference,
      }),
    ),
    signatureMethod: revision.signatureMethod,
    policyRevision: policy?.revision ?? null,
    policy,
    policyHash: policy ? await signingHash(policy) : null,
    consentVersion: policy?.consentVersion ?? null,
  };
  return {
    layout,
    fields,
    blockers: [...blockers, ...layoutBlockers(fields, participants)],
    preparationHash: await signingHash(snapshot),
    snapshot: canonicalJson(snapshot),
  };
}
