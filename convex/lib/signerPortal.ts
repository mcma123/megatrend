import { ConvexError, v } from "convex/values";
import { signingHash } from "./signing";
import { sha256Text } from "./signingAccessCrypto";
import type { SigningField } from "./signingFields";
import type { PageGeometry } from "./signingPreparation";
import type { FrozenParty } from "./signingInvitations";

export const signerIntent = v.union(
  v.literal("sign"),
  v.literal("approve"),
  v.literal("decline"),
  v.literal("correction_request"),
);
export const signerMarkKind = v.union(
  v.literal("signature"),
  v.literal("initials"),
);
export const signerMarkMethod = v.union(
  v.literal("drawn"),
  v.literal("typed"),
  v.literal("uploaded"),
);
export type SignerIntent =
  "sign" | "approve" | "decline" | "correction_request";
export type MarkKind = "signature" | "initials";
/** Known references for draft values: adopted marks and clean supporting documents (by SHA-256). */
export type ReferenceKind = MarkKind | "attachment";
export const ATTACHMENT_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
} as const;
export type AttachmentContentType = keyof typeof ATTACHMENT_TYPES;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export type MarkMethod = "drawn" | "typed" | "uploaded";

/** Platform wording is versioned separately from the company's approved policy reference. */
export const PLATFORM_CONSENT_VERSION = "cyphersoft-signer-consent-v1";
export const PLATFORM_CONSENT_TEXT = [
  "I agree to receive, review and sign this agreement electronically, and I understand that my electronic signature will be attached to this exact version of the document.",
  "Email verification confirms access to my mailbox. It does not verify my government identity and it is not an advanced electronic signature.",
  "Opening, scrolling, typing, drawing or saving does not sign. I sign only when I select Finish and sign after reviewing my entries.",
  "I can decline, or ask the company for a correction, instead of signing. I may request a paper process from the company before signing.",
] as const;
export const SAST_OFFSET_MS = 2 * 3600_000; // South Africa has no daylight saving time.
export const DRAFT_LIMIT_BYTES = 120_000;
export const MAX_MARK_BYTES = 80_000;

export type FrozenSigning = {
  participants: FrozenParty[];
  fields?: SigningField[];
  pages?: PageGeometry[];
  pdfHash?: string;
  bundleId?: string;
  storageVersion?: string;
  manifestVersion?: string;
  manifestHash?: string;
  consentVersion?: string | null;
  policy?: {
    privacyNoticeReference?: string;
    consentVersion?: string;
    signerContact?: string;
  } | null;
};

export async function consentHash(snapshot: FrozenSigning) {
  return signingHash({
    platformConsentVersion: PLATFORM_CONSENT_VERSION,
    text: PLATFORM_CONSENT_TEXT,
    policyConsentVersion: snapshot.consentVersion ?? "",
    privacyNoticeReference: snapshot.policy?.privacyNoticeReference ?? "",
  });
}

export function ownFields(snapshot: FrozenSigning, participantKey: string) {
  return (snapshot.fields ?? []).filter(
    (field) => field.participantKey === participantKey,
  );
}
/** Fields a participant can enter; locked values and server-owned dates are excluded. */
export function editableFields(
  snapshot: FrozenSigning,
  participantKey: string,
) {
  return ownFields(snapshot, participantKey).filter(
    (field) => !field.readOnly && field.type !== "signing_date",
  );
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function base64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Returns the inflated byte count, or -1 when the stream is invalid or exceeds `limit`. */
export type InflatedLength = (
  parts: Uint8Array[],
  limit: number,
) => Promise<number>;

/**
 * Accepts only an 8-bit, non-interlaced PNG and rebuilds it from IHDR/IDAT/IEND.
 * Metadata, text, colour profiles and any other ancillary chunk are discarded.
 */
export async function sanitizePng(
  input: string,
  kind: MarkKind,
  inflatedLength: InflatedLength,
) {
  const reject = () => {
    throw new ConvexError(
      "The signature image is invalid. Draw, type or upload it again",
    );
  };
  const encoded = input.replace(/^data:image\/png;base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 110_000)
    reject();
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  } catch {
    return reject();
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 57 ||
    bytes.length > MAX_MARK_BYTES ||
    signature.some((b, i) => bytes[i] !== b)
  )
    reject();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [Uint8Array.from(signature)];
  let offset = 8,
    width = 0,
    height = 0,
    sawData = false,
    dataEnded = false,
    ended = false;
  while (offset < bytes.length) {
    if (ended || offset + 12 > bytes.length) reject();
    const length = view.getUint32(offset);
    if (offset + 12 + length > bytes.length) reject();
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    const chunk = bytes.subarray(offset + 4, offset + 8 + length);
    if (crc32(chunk) !== view.getUint32(offset + 8 + length)) reject();
    const whole = bytes.subarray(offset, offset + 12 + length);
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) reject();
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const [depth, colour, compression, filter, interlace] = bytes.subarray(
        offset + 16,
        offset + 21,
      );
      if (
        width < 16 ||
        height < 8 ||
        width > 1200 ||
        height > 600 ||
        depth !== 8 ||
        ![0, 2, 4, 6].includes(colour) ||
        compression !== 0 ||
        filter !== 0 ||
        interlace !== 0
      )
        reject();
      kept.push(whole);
    } else if (type === "IDAT") {
      if (dataEnded) reject();
      sawData = true;
      kept.push(whole);
    } else if (type === "IEND") {
      if (!sawData || length !== 0) reject();
      ended = true;
      kept.push(whole);
    } else {
      // Critical chunks other than the accepted set (e.g. PLTE) are unsupported.
      if (!(typeBytes[0] & 0x20)) reject();
      if (sawData) dataEnded = true;
    }
    offset += 12 + length;
  }
  if (!ended) reject();
  // Image data must inflate to exactly the declared scanlines; trailing or truncated data fails.
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[bytes[25] as 0 | 2 | 4 | 6];
  const compressed = kept
    .filter((part) => String.fromCharCode(...part.subarray(4, 8)) === "IDAT")
    .map((part) => part.subarray(8, part.length - 4));
  if (
    (await inflatedLength(compressed, 2_000_000)) !==
    height * (1 + width * channels)
  )
    reject();
  const size = kept.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
  let position = 0;
  for (const part of kept) {
    output.set(part, position);
    position += part.length;
  }
  const png = base64(output);
  return {
    png,
    width,
    height,
    imageHash: await sha256Text(`${kind}:${png}`),
  };
}

export function parseDraftValues(values: string) {
  return JSON.parse(values) as Record<string, string>;
}

/** Whether a conditional field is shown, given the participant's values and approved values. */
export function fieldVisible(
  field: SigningField,
  fields: SigningField[],
  values: Record<string, string>,
) {
  if (!field.showIf) return true;
  const source = fields.find((f) => f.key === field.showIf!.fieldKey);
  if (!source) return false;
  const value = source.readOnly
    ? (source.fixedValue ?? "")
    : (values[source.key] ?? "");
  const shown =
    source.type === "checkbox" ? (value === "true" ? "true" : "false") : value;
  return shown === field.showIf.equals;
}

/** Save-time checks: only this participant's editable fields, bounded values, known marks. */
export function checkDraftValues(
  fields: SigningField[],
  values: unknown,
  marks: Map<string, ReferenceKind>,
) {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new ConvexError("Invalid saved entries");
  const editable = new Map(fields.map((field) => [field.key, field]));
  const result: Record<string, string> = {};
  const referenced = new Map<MarkKind, string>();
  for (const [key, value] of Object.entries(
    values as Record<string, unknown>,
  )) {
    const field = editable.get(key);
    if (!field || typeof value !== "string" || value.length > 2000)
      throw new ConvexError(
        "Entries can only be saved for your own editable fields",
      );
    if (!value) continue;
    if (field.type === "signature" || field.type === "initials") {
      if (marks.get(value) !== field.type)
        throw new ConvexError(
          "Adopt your signature or initials before placing them",
        );
      // One adopted mark per kind keeps every placement in the transaction identical.
      if ((referenced.get(field.type) ?? value) !== value)
        throw new ConvexError(
          `Use the same adopted ${field.type} for every ${field.type} field`,
        );
      referenced.set(field.type, value);
    }
    if (field.type === "attachment" && marks.get(value) !== "attachment")
      throw new ConvexError("Upload the supporting document before saving");
    if (field.type === "checkbox" && value !== "true" && value !== "false")
      throw new ConvexError("Invalid checkbox entry");
    if (
      (field.type === "radio" || field.type === "dropdown") &&
      !field.options?.includes(value)
    )
      throw new ConvexError("Choose one of the listed options");
    result[key] = value;
  }
  if (
    new TextEncoder().encode(JSON.stringify(result)).length > DRAFT_LIMIT_BYTES
  )
    throw new ConvexError("Saved entries exceed their size limit");
  return result;
}

export type AcceptedValue = {
  key: string;
  type: SigningField["type"];
  pageIndex: number;
  value: string;
  source: "participant" | "approved" | "server";
  markHash?: string;
  attachmentHash?: string;
};

/** Submission-time validation. Locked values and dates always come from frozen/server data. */
export function acceptedValues(
  snapshot: FrozenSigning,
  party: FrozenParty,
  values: Record<string, string>,
  marks: Map<string, ReferenceKind>,
  acceptedAt: number,
) {
  const accepted: AcceptedValue[] = [];
  const problems: string[] = [];
  const all = ownFields(snapshot, party.key);
  for (const field of all) {
    // Hidden conditional fields are neither required nor recorded.
    if (!fieldVisible(field, all, values)) continue;
    const base = {
      key: field.key,
      type: field.type,
      pageIndex: field.pageIndex,
    };
    if (field.type === "signing_date") {
      accepted.push({
        ...base,
        value: new Date(acceptedAt + SAST_OFFSET_MS).toISOString().slice(0, 10),
        source: "server",
      });
      continue;
    }
    if (field.readOnly) {
      accepted.push({
        ...base,
        value:
          field.type === "full_name" ? party.name : (field.fixedValue ?? ""),
        source: "approved",
      });
      continue;
    }
    const value = (values[field.key] ?? "").trim();
    const label = field.label || field.type;
    if (field.type === "signature" || field.type === "initials") {
      if (!value) {
        if (field.required) problems.push(`${label} is required`);
        continue;
      }
      if (marks.get(value) !== field.type) {
        problems.push(`${label} must use your adopted ${field.type}`);
        continue;
      }
      accepted.push({
        ...base,
        value: "applied",
        source: "participant",
        markHash: value,
      });
      continue;
    }
    if (field.type === "attachment") {
      if (!value) {
        if (field.required) problems.push(`${label} is required`);
        continue;
      }
      if (marks.get(value) !== "attachment") {
        problems.push(`${label} must be a scanned upload of yours`);
        continue;
      }
      accepted.push({
        ...base,
        value: "Supporting document provided",
        source: "participant",
        attachmentHash: value,
      });
      continue;
    }
    if (field.type === "radio" || field.type === "dropdown") {
      if (!value) {
        if (field.required) problems.push(`${label} is required`);
        continue;
      }
      if (!field.options?.includes(value)) {
        problems.push(`${label} must be one of the listed options`);
        continue;
      }
      accepted.push({ ...base, value, source: "participant" });
      continue;
    }
    if (field.type === "checkbox") {
      const checked = value === "true";
      if (field.required && !checked) problems.push(`${label} must be checked`);
      accepted.push({
        ...base,
        value: checked ? "true" : "false",
        source: "participant",
      });
      continue;
    }
    if (!value) {
      if (field.required) problems.push(`${label} is required`);
      continue;
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
      problems.push(`${label} contains unsupported characters`);
      continue;
    }
    if (field.type === "number") {
      const number = Number(value);
      if (
        !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) ||
        !Number.isFinite(number) ||
        (field.min !== undefined && number < field.min) ||
        (field.max !== undefined && number > field.max) ||
        (value.split(".")[1]?.length ?? 0) > (field.decimals ?? 2)
      ) {
        problems.push(`${label} must be a valid number within its limits`);
        continue;
      }
    } else if (
      value.length < (field.minLength ?? (field.required ? 1 : 0)) ||
      value.length >
        (field.maxLength ?? (field.type === "full_name" ? 160 : 500))
    ) {
      problems.push(`${label} must respect its length limits`);
      continue;
    }
    accepted.push({ ...base, value, source: "participant" });
  }
  return { accepted, problems };
}
