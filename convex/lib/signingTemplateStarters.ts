import type {
  DocNode,
  TemplateCondition,
  TemplateField,
  TemplateKind,
} from "./signingTemplates";

/**
 * Starter structures only. Clause wording is deliberately a placeholder: approved legal text
 * must be supplied and approved by the company's legal reviewer before any template is used.
 */
export const PLACEHOLDER =
  "[Clause wording to be supplied and approved by the company's legal reviewer]";

const text = (value: string, marks?: string[]): DocNode => ({
  type: "text",
  text: value,
  ...(marks?.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const field = (key: string): DocNode => ({
  type: "mergeField",
  attrs: { key },
});
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const h = (level: number, value: string): DocNode => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const placeholder = () => p(text(PLACEHOLDER, ["italic"]));
const when = (condition: string, ...content: DocNode[]): DocNode => ({
  type: "conditional",
  attrs: { condition },
  content,
});
const row = (cells: DocNode[][], header = false): DocNode => ({
  type: "tableRow",
  content: cells.map((content) => ({
    type: header ? "tableHeader" : "tableCell",
    content: [p(...content)],
  })),
});

function partiesTable(): DocNode {
  return {
    type: "table",
    content: [
      row([[text("Party")], [text("Details")]], true),
      row([
        [text("Lessor / owner")],
        [
          field("input.owner_name"),
          text(", "),
          field("input.owner_identifier"),
        ],
      ]),
      row([
        [text("Lessee / renter")],
        [
          field("input.renter_name"),
          text(", "),
          field("input.renter_identifier"),
        ],
      ]),
    ],
  };
}
function premises(): DocNode[] {
  return [
    h(2, "Premises"),
    p(
      text("Property: "),
      field("property.name"),
      text(", "),
      field("property.address"),
    ),
    p(text("Unit: "), field("input.unit")),
  ];
}
function money(): DocNode[] {
  return [
    h(2, "Rent, deposit and payments"),
    p(
      text("Monthly rent: "),
      field("schedule.monthly_rent"),
      text(", payable on day "),
      field("schedule.payment_day"),
      text(" of each month."),
    ),
    when(
      "schedule.escalates",
      p(
        text("Rent escalates annually by "),
        field("schedule.escalation_percent"),
        text("."),
      ),
    ),
    when(
      "schedule.deposit_required",
      p(text("Deposit: "), field("schedule.deposit"), text(".")),
      placeholder(),
    ),
    when(
      "schedule.vat_applicable",
      p(
        text("VAT is charged at "),
        field("schedule.vat_rate"),
        text(" where applicable."),
      ),
    ),
    h(3, "Payment schedule"),
    { type: "scheduleTable" },
  ];
}
function closing(): DocNode[] {
  return [
    h(2, "General"),
    placeholder(),
    { type: "pageBreak" },
    h(2, "Signatures"),
    p(text("Signature fields are placed on this page during preparation.")),
  ];
}
const leaseFields: TemplateField[] = [
  {
    key: "owner_name",
    label: "Lessor / owner legal name",
    type: "text",
    required: true,
  },
  {
    key: "owner_identifier",
    label: "Lessor registration or identity number",
    type: "text",
    required: true,
  },
  {
    key: "renter_name",
    label: "Lessee / renter legal name",
    type: "text",
    required: true,
  },
  {
    key: "renter_identifier",
    label: "Lessee registration or identity number",
    type: "text",
    required: true,
  },
  {
    key: "unit",
    label: "Unit or premises description",
    type: "text",
    required: true,
  },
];

export const STARTERS: {
  name: string;
  kind: TemplateKind;
  doc: DocNode;
  fields: TemplateField[];
  conditions: TemplateCondition[];
}[] = [
  {
    name: "Residential lease (starter structure)",
    kind: "residential_lease",
    fields: leaseFields,
    conditions: [{ key: "pets_permitted", label: "Pets are permitted" }],
    doc: {
      type: "doc",
      content: [
        h(1, "Residential lease agreement"),
        partiesTable(),
        ...premises(),
        h(2, "Term"),
        p(
          text("From "),
          field("schedule.start_date"),
          text(" to "),
          field("schedule.end_date"),
          text(" ("),
          field("schedule.term_months"),
          text(" months)."),
        ),
        ...money(),
        h(2, "Use and occupation"),
        placeholder(),
        when("input.pets_permitted", h(3, "Pets"), placeholder()),
        ...closing(),
      ],
    },
  },
  {
    name: "Commercial lease (starter structure)",
    kind: "commercial_lease",
    fields: [
      ...leaseFields,
      {
        key: "permitted_use",
        label: "Permitted use of the premises",
        type: "multiline",
        required: true,
      },
    ],
    conditions: [],
    doc: {
      type: "doc",
      content: [
        h(1, "Commercial lease agreement"),
        partiesTable(),
        ...premises(),
        p(text("Permitted use: "), field("input.permitted_use")),
        h(2, "Term"),
        p(
          text("From "),
          field("schedule.start_date"),
          text(" to "),
          field("schedule.end_date"),
          text("."),
        ),
        p(
          text("Notice period: "),
          field("lease.notice_months"),
          text(" months."),
        ),
        ...money(),
        h(2, "Maintenance and operating costs"),
        placeholder(),
        ...closing(),
      ],
    },
  },
  {
    name: "Month-to-month lease (starter structure)",
    kind: "month_to_month",
    fields: [
      ...leaseFields,
      {
        key: "notice_days",
        label: "Notice period (days)",
        type: "number",
        required: true,
      },
    ],
    conditions: [],
    doc: {
      type: "doc",
      content: [
        h(1, "Month-to-month lease agreement"),
        partiesTable(),
        ...premises(),
        h(2, "Term and notice"),
        p(
          text("Starting "),
          field("schedule.start_date"),
          text(", continuing monthly until terminated on "),
          field("input.notice_days"),
          text(" days' written notice."),
        ),
        placeholder(),
        ...money(),
        ...closing(),
      ],
    },
  },
  {
    name: "Lease renewal (starter structure)",
    kind: "renewal",
    fields: [
      ...leaseFields,
      {
        key: "original_lease_date",
        label: "Date of the original lease",
        type: "date",
        required: true,
      },
    ],
    conditions: [],
    doc: {
      type: "doc",
      content: [
        h(1, "Lease renewal agreement"),
        partiesTable(),
        ...premises(),
        p(
          text("This renews the lease dated "),
          field("input.original_lease_date"),
          text(" for the period "),
          field("schedule.start_date"),
          text(" to "),
          field("schedule.end_date"),
          text("."),
        ),
        placeholder(),
        ...money(),
        ...closing(),
      ],
    },
  },
  {
    name: "General contract (starter structure)",
    kind: "general_contract",
    fields: [
      {
        key: "party_a",
        label: "First party legal name",
        type: "text",
        required: true,
      },
      {
        key: "party_b",
        label: "Second party legal name",
        type: "text",
        required: true,
      },
      {
        key: "subject",
        label: "Subject of the agreement",
        type: "multiline",
        required: true,
      },
    ],
    conditions: [],
    doc: {
      type: "doc",
      content: [
        h(1, "Agreement"),
        p(
          text("Between "),
          field("input.party_a"),
          text(" and "),
          field("input.party_b"),
          text("."),
        ),
        h(2, "Subject"),
        p(field("input.subject")),
        h(2, "Terms"),
        placeholder(),
        ...closing(),
      ],
    },
  },
];
export const STARTER_CLAUSES: { title: string; doc: DocNode }[] = [
  "Deposit and its refund",
  "Breach and remedies",
  "Termination",
  "Domicilium and notices",
].map((title) => ({
  title,
  doc: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 3 }, content: [text(title)] },
      placeholder(),
    ],
  },
}));
