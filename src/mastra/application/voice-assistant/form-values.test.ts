import { describe, expect, test } from "vitest";
import type { VoiceForm } from "../../ports/voice-assistant";
import { validateFormValues } from "./form-values";

const form: VoiceForm = {
  formId: "property.create",
  title: "New property",
  fields: [
    { name: "name", label: "Property name", type: "text", required: true },
    { name: "sizeSqm", label: "Size (m²)", type: "number" },
    {
      name: "propertyType",
      label: "Type",
      type: "select",
      options: [
        { value: "office", label: "Office" },
        { value: "other", label: "Other" },
      ],
    },
    { name: "since", label: "Since", type: "date" },
    { name: "visible", label: "Visible", type: "boolean" },
  ],
};

describe("validateFormValues", () => {
  test("accepts and coerces valid values", () => {
    const { accepted, rejected } = validateFormValues(form, [
      { field: "name", value: " Sunset Villas " },
      { field: "sizeSqm", value: "1,250" },
      { field: "propertyType", value: "Other" },
      { field: "since", value: "2026-01-31" },
      { field: "visible", value: "yes" },
    ]);
    expect(rejected).toEqual([]);
    expect(accepted).toEqual({
      name: "Sunset Villas",
      sizeSqm: 1250,
      propertyType: "other",
      since: "2026-01-31",
      visible: true,
    });
  });

  test("accepts a unique partial option label but not an ambiguous one", () => {
    const review = {
      formId: "document.approveField",
      title: "Approve field",
      fields: [
        {
          name: "field",
          label: "Field",
          type: "select" as const,
          options: [
            { value: "f1", label: "Monthly rental: R 845 000" },
            { value: "f2", label: "Lease end date: 2027-01-31" },
            { value: "f3", label: "Lease start date: 2022-02-01" },
          ],
        },
      ],
    };
    expect(validateFormValues(review, [{ field: "field", value: "monthly rental" }]).accepted).toEqual({
      field: "f1",
    });
    expect(validateFormValues(review, [{ field: "field", value: "lease" }]).rejected).toHaveLength(1);
  });

  test("rejects unknown fields, bad types and options outside the list", () => {
    const { accepted, rejected } = validateFormValues(form, [
      { field: "bedrooms", value: "3" },
      { field: "sizeSqm", value: "large" },
      { field: "propertyType", value: "house" },
      { field: "since", value: "next week" },
    ]);
    expect(accepted).toEqual({});
    expect(rejected.map((item) => item.field)).toEqual(["bedrooms", "sizeSqm", "propertyType", "since"]);
  });
});
