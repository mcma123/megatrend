import { describe, expect, test } from "vitest";
import {
  initialField,
  layoutBlockers,
  normalizeFields,
} from "./lib/signingFields";
import type { SigningField } from "./lib/signingFields";
import type { PageGeometry } from "./lib/signingPreparation";
import {
  methodBlockers,
  normalizeDraft,
  partyContent,
  signingHash,
} from "./lib/signing";
import type { SigningDraft } from "./lib/signing";
import {
  acceptedValues,
  checkDraftValues,
  fieldVisible,
} from "./lib/signerPortal";
import type { FrozenSigning } from "./lib/signerPortal";

const page: PageGeometry = {
  pageIndex: 0,
  sourceFileId: "source",
  sourcePageIndex: 0,
  mediaBox: [0, 0, 600, 800],
  cropBox: [0, 0, 600, 800],
  rotation: 0,
  userUnit: 1,
  widthPt: 600,
  heightPt: 800,
};
const party = (
  key: string,
  extra: Partial<SigningDraft["participants"][number]> = {},
) => ({
  key,
  name: `Synthetic ${key}`,
  email: `${key}@example.test`,
  role: "Party",
  responsibility: "signer" as const,
  stage: 1,
  ...extra,
});
const signers = [party("tenant"), party("owner")];
const at = (field: SigningField, y: number) => ({ ...field, y });
const signature = initialField("signature", "tenant", page, "sig");
const pets = {
  ...initialField("checkbox", "tenant", page, "pets"),
  required: false,
};
const plan = {
  ...initialField("radio", "tenant", page, "plan"),
  options: ["Monthly", "Annual"],
};
const petName = {
  ...initialField("text", "tenant", page, "pet-name"),
  showIf: { fieldKey: "pets", equals: "true" },
};
const annualRef = {
  ...initialField("dropdown", "tenant", page, "annual-ref"),
  options: ["Debit order", "EFT"],
  showIf: { fieldKey: "plan", equals: "Annual" },
};
const proof = initialField("attachment", "tenant", page, "proof");
const layout = [signature, pets, plan, petName, annualRef, proof].map((f, i) =>
  at(f, 0.05 + i * 0.1),
);

describe("choice, conditional and supporting-document fields", () => {
  test("valid layouts normalize; choices, conditions and purposes are validated server-side", () => {
    expect(normalizeFields(layout, [page], signers)).toHaveLength(6);
    const invalid: [string, SigningField[]][] = [
      ["choice without options", [signature, { ...plan, options: undefined }]],
      ["duplicate options", [signature, { ...plan, options: ["A", "A"] }]],
      [
        "options on text",
        [signature, { ...petName, showIf: undefined, options: ["A", "B"] }],
      ],
      [
        "condition on unknown field",
        [
          signature,
          { ...petName, showIf: { fieldKey: "nope", equals: "true" } },
        ],
      ],
      [
        "condition on another signer",
        [signature, { ...pets, participantKey: "owner" }, petName],
      ],
      [
        "condition value not an option",
        [
          signature,
          plan,
          { ...annualRef, showIf: { fieldKey: "plan", equals: "Weekly" } },
        ],
      ],
      [
        "nested condition",
        [
          signature,
          plan,
          annualRef,
          { ...petName, showIf: { fieldKey: "annual-ref", equals: "EFT" } },
        ],
      ],
      [
        "text as condition source",
        [
          signature,
          { ...petName, showIf: undefined },
          { ...pets, key: "x", showIf: { fieldKey: "pet-name", equals: "a" } },
        ],
      ],
      [
        "attachment without purpose",
        [signature, { ...proof, purpose: undefined }],
      ],
      [
        "purpose on text",
        [
          signature,
          { ...petName, showIf: undefined, purpose: "identity" as const },
        ],
      ],
      ["read-only attachment", [signature, { ...proof, readOnly: true }]],
      [
        "fixed choice outside options",
        [signature, { ...plan, readOnly: true, fixedValue: "Weekly" }],
      ],
    ];
    for (const [name, fields] of invalid)
      expect(
        () =>
          normalizeFields(
            fields.map((f, i) => at(f, 0.05 + i * 0.1)),
            [page],
            signers,
          ),
        name,
      ).toThrow();
    expect(
      normalizeFields(
        [
          at(signature, 0.1),
          at({ ...plan, readOnly: true, fixedValue: "Annual" }, 0.3),
        ],
        [page],
        signers,
      )[1].fixedValue,
    ).toBe("Annual");
  });

  test("a conditional signature never satisfies the always-required signature", () => {
    const conditional = {
      ...signature,
      showIf: { fieldKey: "pets", equals: "true" },
    };
    expect(
      layoutBlockers([at(pets, 0.1), at(conditional, 0.3)], [party("tenant")]),
    ).toContain("Add a required signature for Synthetic tenant");
  });

  test("hidden fields are neither required nor recorded; shown ones are validated", () => {
    const fields = normalizeFields(layout, [page], signers);
    const snapshot = {
      fields,
      participants: signers,
    } as unknown as FrozenSigning;
    const marks = new Map<string, "signature" | "initials" | "attachment">([
      ["m".repeat(64), "signature"],
      ["d".repeat(64), "attachment"],
    ]);
    const base = {
      sig: "m".repeat(64),
      plan: "Monthly",
      proof: "d".repeat(64),
    };
    expect(fieldVisible(fields[3], fields, { pets: "false" })).toBe(false);
    const hidden = acceptedValues(
      snapshot,
      signers[0],
      { ...base, pets: "false", "pet-name": "Rex" },
      marks,
      0,
    );
    expect(hidden.problems).toEqual([]);
    expect(hidden.accepted.map((v) => v.key)).not.toContain("pet-name");
    expect(hidden.accepted.map((v) => v.key)).not.toContain("annual-ref");
    const shown = acceptedValues(
      snapshot,
      signers[0],
      { ...base, pets: "true", plan: "Annual" },
      marks,
      0,
    );
    expect(shown.problems).toEqual(
      expect.arrayContaining(["Text is required", "Choice (list) is required"]),
    );
    const bad = acceptedValues(
      snapshot,
      signers[0],
      { ...base, plan: "Weekly", proof: "e".repeat(64) },
      marks,
      0,
    );
    expect(bad.problems).toEqual(
      expect.arrayContaining([
        "Choice (radio) must be one of the listed options",
        "Supporting document must be a scanned upload of yours",
      ]),
    );
    const proofValue = shown.accepted.find((v) => v.key === "proof");
    expect(proofValue).toMatchObject({
      attachmentHash: "d".repeat(64),
      value: "Supporting document provided",
    });
    expect(() => checkDraftValues(fields, { plan: "Weekly" }, marks)).toThrow(
      "listed options",
    );
    expect(() =>
      checkDraftValues(fields, { proof: "e".repeat(64) }, marks),
    ).toThrow("Upload the supporting document");
  });
});

describe("participant workflows and method gates", () => {
  const draft = (
    participants: SigningDraft["participants"],
    extra: Partial<SigningDraft> = {},
  ) =>
    normalizeDraft({
      title: "Synthetic",
      category: "commercial_lease",
      notes: "",
      participants,
      ...extra,
    });

  test("a witness is a signer attesting another signer in the same or a later stage", () => {
    expect(
      draft([party("tenant"), party("witness", { witnessFor: "tenant" })])
        .participants[1].witnessFor,
    ).toBe("tenant");
    const invalid = [
      [party("tenant"), party("witness", { witnessFor: "missing" })],
      [party("tenant"), party("witness", { witnessFor: "witness" })],
      [
        party("tenant", { stage: 2 }),
        party("witness", { witnessFor: "tenant" }),
      ],
      [
        party("tenant", { responsibility: "viewer" }),
        party("witness", { witnessFor: "tenant" }),
      ],
      [
        party("tenant"),
        party("witness", { witnessFor: "tenant", responsibility: "approver" }),
      ],
      [
        party("tenant"),
        party("w1", { witnessFor: "tenant" }),
        party("w2", { witnessFor: "w1" }),
      ],
    ];
    for (const participants of invalid)
      expect(() => draft(participants)).toThrow("witness");
  });

  test("phone numbers are E.164 and WhatsApp needs a recorded opt-in", () => {
    expect(
      draft([party("tenant", { phone: "+27 82 123 4567" })]).participants[0]
        .phone,
    ).toBe("+27821234567");
    expect(() => draft([party("tenant", { phone: "0821234567" })])).toThrow(
      "international format",
    );
    expect(() => draft([party("tenant", { notifyVia: "sms" })])).toThrow(
      "phone number",
    );
    expect(() =>
      draft([
        party("tenant", { notifyVia: "whatsapp", phone: "+27821234567" }),
      ]),
    ).toThrow("opt-in");
    const optedIn = draft([
      party("tenant", {
        notifyVia: "whatsapp",
        phone: "+27821234567",
        whatsappOptInReference: "consent-form-12",
      }),
    ]);
    expect(optedIn.participants[0]).toMatchObject({
      notifyVia: "whatsapp",
      whatsappOptInReference: "consent-form-12",
    });
    // An opt-in reference without WhatsApp is not stored.
    expect(
      draft([party("tenant", { whatsappOptInReference: "x" })]).participants[0]
        .whatsappOptInReference,
    ).toBeUndefined();
  });

  test("witnessing, SMS, WhatsApp and advanced signatures stay gated", () => {
    const policy = { witnessingReference: undefined } as unknown as Parameters<
      typeof methodBlockers
    >[0];
    expect(methodBlockers(policy, { participants: [party("tenant")] })).toEqual(
      [],
    );
    expect(
      methodBlockers(policy, {
        participants: [party("tenant"), party("w", { witnessFor: "tenant" })],
      }),
    ).toEqual([
      "Witnessing requires a recorded legal approval in the signing policy",
    ]);
    expect(
      methodBlockers(
        { ...policy!, witnessingReference: "legal-witness-1" },
        { participants: [party("w", { witnessFor: "tenant" })] },
      ),
    ).toEqual([]);
    expect(
      methodBlockers(policy, {
        signatureMethod: "advanced",
        participants: [
          party("t", { notifyVia: "sms" }),
          party("u", { notifyVia: "whatsapp" }),
        ],
      }),
    ).toHaveLength(3);
  });

  test("earlier drafts keep identical content hashes after the Phase 9 fields were added", async () => {
    const plain = draft([party("tenant")]);
    expect(plain).not.toHaveProperty("signatureMethod");
    expect(Object.keys(plain.participants[0]).sort()).toEqual([
      "email",
      "key",
      "name",
      "responsibility",
      "role",
      "stage",
    ]);
    expect(await signingHash(plain.participants.map(partyContent))).toBe(
      await signingHash([
        {
          key: "tenant",
          name: "Synthetic tenant",
          email: "tenant@example.test",
          role: "Party",
          responsibility: "signer",
          stage: 1,
        },
      ]),
    );
  });
});
