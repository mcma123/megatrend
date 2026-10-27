import { ConvexError, v } from "convex/values";
import { canonicalJson, signingHash } from "./signing";

/** Bumped whenever rendered HTML could change for identical inputs. */
export const TEMPLATE_RENDERER = "cyphersoft-template-html-v1";
export const templateKind = v.union(
  v.literal("residential_lease"),
  v.literal("commercial_lease"),
  v.literal("month_to_month"),
  v.literal("renewal"),
  v.literal("general_contract"),
);
export type TemplateKind =
  | "residential_lease"
  | "commercial_lease"
  | "month_to_month"
  | "renewal"
  | "general_contract";
export const KIND_CATEGORY = {
  residential_lease: "residential_lease",
  commercial_lease: "commercial_lease",
  month_to_month: "residential_lease",
  renewal: "renewal",
  general_contract: "general_contract",
} as const;
export const versionStatus = v.union(
  v.literal("draft"),
  v.literal("approved"),
  v.literal("superseded"),
);
export const templateFieldType = v.union(
  v.literal("text"),
  v.literal("multiline"),
  v.literal("date"),
  v.literal("money"),
  v.literal("number"),
);
export const templateField = v.object({
  key: v.string(),
  label: v.string(),
  type: templateFieldType,
  required: v.boolean(),
});
export const templateCondition = v.object({
  key: v.string(),
  label: v.string(),
});
export type TemplateField = {
  key: string;
  label: string;
  type: "text" | "multiline" | "date" | "money" | "number";
  required: boolean;
};
export type TemplateCondition = { key: string; label: string };

// ---- Document schema -----------------------------------------------------------------------------

export type DocNode = {
  type: string;
  attrs?: Record<string, string | number | boolean | null>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string }[];
};
const BLOCKS = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "table",
  "horizontalRule",
  "pageBreak",
  "conditional",
  "clauseRef",
  "scheduleTable",
]);
const INLINE = new Set(["text", "hardBreak", "mergeField"]);
const MARKS = new Set(["bold", "italic", "underline"]);
const ALIGN = new Set(["left", "center", "right", "justify"]);
const KEY = /^[a-z][a-z0-9_]{0,40}(\.[a-z0-9_:-]{1,64}){0,3}$/;
export const FIELD_KEY = /^[a-z][a-z0-9_]{0,40}$/;
export const MAX_DOC_NODES = 6000;
export const MAX_DOC_TEXT = 200_000;

/**
 * Validates Tiptap/ProseMirror JSON against the closed signing schema and returns a canonical
 * copy holding only meaningful attributes. Unknown node or mark types are rejected.
 */
export function normalizeDoc(
  input: unknown,
  options: { allowClauses: boolean },
): DocNode {
  let nodes = 0,
    text = 0;
  const fail = (message: string): never => {
    throw new ConvexError(`Invalid document: ${message}`);
  };
  const attr = (node: Record<string, unknown>, name: string) =>
    (node.attrs as Record<string, unknown> | undefined)?.[name];
  function children(
    node: Record<string, unknown>,
    depth: number,
    allowed: (type: string) => boolean,
  ) {
    const content = node.content;
    if (content === undefined) return undefined;
    if (!Array.isArray(content) || content.length > 2000)
      fail("content must be a bounded list");
    return (content as unknown[]).map((child) => {
      const normalized = walk(child, depth + 1);
      if (!allowed(normalized.type))
        fail(`${normalized.type} is not allowed here`);
      return normalized;
    });
  }
  function walk(raw: unknown, depth: number): DocNode {
    if (depth > 24) fail("nesting is too deep");
    if (++nodes > MAX_DOC_NODES) fail("too many elements");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      fail("malformed element");
    const node = raw as Record<string, unknown>;
    const type = node.type;
    if (typeof type !== "string") fail("missing element type");
    const block = (t: string) =>
      BLOCKS.has(t) && (options.allowClauses || t !== "clauseRef");
    const inline = (t: string) => INLINE.has(t);
    switch (type) {
      case "doc":
        if (depth !== 0) fail("nested document");
        return { type, content: children(node, depth, block) ?? [] };
      case "text": {
        if (typeof node.text !== "string" || !node.text) fail("empty text");
        text += (node.text as string).length;
        if (text > MAX_DOC_TEXT) fail("too much text");
        if (
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(node.text as string)
        )
          fail("control characters");
        const marks = Array.isArray(node.marks)
          ? [
              ...new Set(
                (node.marks as { type?: unknown }[]).map((m) => m?.type),
              ),
            ]
          : [];
        if (marks.some((m) => typeof m !== "string" || !MARKS.has(m)))
          fail("unsupported formatting");
        return {
          type,
          text: node.text as string,
          ...(marks.length
            ? { marks: (marks as string[]).sort().map((m) => ({ type: m })) }
            : {}),
        };
      }
      case "paragraph":
      case "heading": {
        const align = attr(node, "textAlign");
        const level = attr(node, "level");
        if (
          type === "heading" &&
          (typeof level !== "number" || level < 1 || level > 4)
        )
          fail("heading level");
        const attrs: DocNode["attrs"] = {};
        if (type === "heading") attrs.level = level as number;
        if (typeof align === "string" && ALIGN.has(align) && align !== "left")
          attrs.textAlign = align;
        const content = children(node, depth, inline);
        return {
          type,
          ...(Object.keys(attrs).length ? { attrs } : {}),
          ...(content?.length ? { content } : {}),
        };
      }
      case "hardBreak":
      case "horizontalRule":
      case "pageBreak":
      case "scheduleTable":
        return { type };
      case "mergeField": {
        const key = attr(node, "key");
        if (typeof key !== "string" || !KEY.test(key)) fail("merge field key");
        return { type, attrs: { key: key as string } };
      }
      case "clauseRef": {
        const clauseId = attr(node, "clauseId");
        if (
          typeof clauseId !== "string" ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(clauseId)
        )
          fail("clause reference");
        return { type, attrs: { clauseId: clauseId as string } };
      }
      case "conditional": {
        const condition = attr(node, "condition");
        if (typeof condition !== "string" || !KEY.test(condition))
          fail("condition key");
        return {
          type,
          attrs: { condition: condition as string },
          content: children(node, depth, block) ?? [],
        };
      }
      case "bulletList":
      case "orderedList": {
        const start = attr(node, "start");
        const content = children(node, depth, (t) => t === "listItem") ?? [];
        return {
          type,
          ...(type === "orderedList" &&
          typeof start === "number" &&
          start > 1 &&
          start < 10_000
            ? { attrs: { start } }
            : {}),
          content,
        };
      }
      case "listItem":
        return {
          type,
          content:
            children(
              node,
              depth,
              (t) =>
                t === "paragraph" || t === "bulletList" || t === "orderedList",
            ) ?? [],
        };
      case "table":
        return {
          type,
          content: children(node, depth, (t) => t === "tableRow") ?? [],
        };
      case "tableRow":
        return {
          type,
          content:
            children(
              node,
              depth,
              (t) => t === "tableCell" || t === "tableHeader",
            ) ?? [],
        };
      case "tableCell":
      case "tableHeader": {
        const span = (name: string) => {
          const value = attr(node, name);
          return typeof value === "number" &&
            Number.isInteger(value) &&
            value > 1 &&
            value <= 20
            ? value
            : undefined;
        };
        const attrs: DocNode["attrs"] = {};
        if (span("colspan")) attrs.colspan = span("colspan")!;
        if (span("rowspan")) attrs.rowspan = span("rowspan")!;
        return {
          type,
          ...(Object.keys(attrs).length ? { attrs } : {}),
          content:
            children(
              node,
              depth,
              (t) =>
                t === "paragraph" || t === "bulletList" || t === "orderedList",
            ) ?? [],
        };
      }
      default:
        return fail(`unsupported element ${String(type).slice(0, 40)}`);
    }
  }
  const doc = walk(input, 0);
  if (doc.type !== "doc") fail("the root must be a document");
  return doc;
}

export function collectRefs(doc: DocNode) {
  const fields = new Set<string>(),
    conditions = new Set<string>(),
    clauses = new Set<string>();
  let schedule = false;
  const visit = (node: DocNode) => {
    if (node.type === "mergeField") fields.add(String(node.attrs!.key));
    if (node.type === "conditional")
      conditions.add(String(node.attrs!.condition));
    if (node.type === "clauseRef") clauses.add(String(node.attrs!.clauseId));
    if (node.type === "scheduleTable") schedule = true;
    node.content?.forEach(visit);
  };
  visit(doc);
  return { fields, conditions, clauses, schedule };
}

export function normalizeFieldDefinitions(
  fields: TemplateField[],
  conditions: TemplateCondition[],
) {
  if (fields.length > 50 || conditions.length > 20)
    throw new ConvexError("Too many template fields or conditions");
  const keys = new Set<string>();
  const clean = (label: string) => {
    const value = label.trim();
    if (!value || value.length > 120 || /[\u0000-\u001f]/.test(value))
      throw new ConvexError("Labels need 1–120 characters");
    return value;
  };
  return {
    fields: fields.map((f) => {
      if (!FIELD_KEY.test(f.key) || keys.has(f.key))
        throw new ConvexError(
          "Field keys must be unique lower_snake_case names",
        );
      keys.add(f.key);
      return {
        key: f.key,
        label: clean(f.label),
        type: f.type,
        required: f.required,
      };
    }),
    conditions: conditions.map((c) => {
      if (!FIELD_KEY.test(c.key) || keys.has(`condition:${c.key}`))
        throw new ConvexError(
          "Condition keys must be unique lower_snake_case names",
        );
      keys.add(`condition:${c.key}`);
      return { key: c.key, label: clean(c.label) };
    }),
  };
}

// ---- Money, dates and schedules -----------------------------------------------------------------

const MONEY = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;
const PERCENT = /^(0|[1-9]\d?)(\.\d{1,2})?$/;
export function moneyToCents(value: string, label: string) {
  const text = value.trim().replace(/[\s,]/g, "");
  if (!MONEY.test(text))
    throw new ConvexError(`${label} must be an amount such as 12500.00`);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}
/** Percent with up to two decimals as basis points (e.g. "8.5" → 850). */
export function percentToBasisPoints(
  value: string,
  label: string,
  max: number,
) {
  const text = value.trim();
  if (!PERCENT.test(text))
    throw new ConvexError(`${label} must be a percentage such as 8 or 8.5`);
  const [whole, fraction = ""] = text.split(".");
  const bp = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (bp > max)
    throw new ConvexError(`${label} is above the supported maximum`);
  return bp;
}
/** Exact division with half-up rounding for non-negative integers. */
export function roundHalfUp(numerator: bigint, denominator: bigint) {
  return (numerator * 2n + denominator) / (denominator * 2n);
}
export function formatMoney(cents: bigint) {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${negative ? "-" : ""}R ${whole}.${(abs % 100n).toString().padStart(2, "0")}`;
}
export function parseIsoDate(value: string, label: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match
    ? new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      )
    : null;
  if (
    !date ||
    date.toISOString().slice(0, 10) !== value ||
    date.getUTCFullYear() < 2000 ||
    date.getUTCFullYear() > 2150
  )
    throw new ConvexError(`${label} must be a valid date (YYYY-MM-DD)`);
  return date;
}
const iso = (date: Date) => date.toISOString().slice(0, 10);
/** Calendar month addition clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number, day = date.getUTCDate()) {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target;
}

export const scheduleInput = v.object({
  startDate: v.string(),
  termMonths: v.number(),
  monthlyRent: v.string(),
  escalationPercent: v.string(),
  deposit: v.string(),
  paymentDay: v.number(),
  vatRatePercent: v.string(),
  rentVatable: v.boolean(),
  charges: v.array(
    v.object({ label: v.string(), amount: v.string(), vatable: v.boolean() }),
  ),
});
export type ScheduleInput = {
  startDate: string;
  termMonths: number;
  monthlyRent: string;
  escalationPercent: string;
  deposit: string;
  paymentDay: number;
  vatRatePercent: string;
  rentVatable: boolean;
  charges: { label: string; amount: string; vatable: boolean }[];
};
export type ScheduleRow = {
  period: number;
  periodStart: string;
  dueDate: string;
  rent: string;
  charges: string;
  vat: string;
  total: string;
};

/**
 * Deterministic monthly schedule in integer cents. Rent escalates annually by compounding with
 * half-up rounding to the cent; VAT is computed per period on vatable rent and charges.
 */
export function computeSchedule(input: ScheduleInput) {
  const start = parseIsoDate(input.startDate, "Start date");
  if (
    !Number.isInteger(input.termMonths) ||
    input.termMonths < 1 ||
    input.termMonths > 120
  )
    throw new ConvexError("Term must be 1 to 120 months");
  if (
    !Number.isInteger(input.paymentDay) ||
    input.paymentDay < 1 ||
    input.paymentDay > 28
  )
    throw new ConvexError("Payment day must be 1 to 28");
  if (input.charges.length > 10)
    throw new ConvexError("At most 10 monthly charges");
  const baseRent = moneyToCents(input.monthlyRent, "Monthly rent");
  if (baseRent <= 0n)
    throw new ConvexError("Monthly rent must be more than zero");
  const escalation = BigInt(
    percentToBasisPoints(input.escalationPercent, "Escalation", 5000),
  );
  const vatRate = BigInt(
    percentToBasisPoints(input.vatRatePercent, "VAT rate", 3000),
  );
  const deposit = moneyToCents(input.deposit, "Deposit");
  const charges = input.charges.map((c) => {
    const label = c.label.trim();
    if (!label || label.length > 60)
      throw new ConvexError("Charge descriptions need 1–60 characters");
    return {
      label,
      cents: moneyToCents(c.amount, `Charge "${label}"`),
      vatable: c.vatable,
    };
  });
  const rows: ScheduleRow[] = [];
  let rent = baseRent,
    totalCents = 0n,
    vatCents = 0n;
  for (let period = 0; period < input.termMonths; period++) {
    if (period > 0 && period % 12 === 0)
      rent = roundHalfUp(rent * (10000n + escalation), 10000n);
    const periodStart = addMonths(start, period);
    const chargeCents = charges.reduce((sum, c) => sum + c.cents, 0n);
    const vatable =
      (input.rentVatable ? rent : 0n) +
      charges.filter((c) => c.vatable).reduce((s, c) => s + c.cents, 0n);
    const vat = roundHalfUp(vatable * vatRate, 10000n);
    const total = rent + chargeCents + vat;
    totalCents += total;
    vatCents += vat;
    rows.push({
      period: period + 1,
      periodStart: iso(periodStart),
      dueDate: iso(addMonths(periodStart, 0, input.paymentDay)),
      rent: formatMoney(rent),
      charges: formatMoney(chargeCents),
      vat: formatMoney(vat),
      total: formatMoney(total),
    });
  }
  const end = addMonths(start, input.termMonths);
  end.setUTCDate(end.getUTCDate() - 1);
  return {
    rows,
    startDate: iso(start),
    endDate: iso(end),
    deposit: formatMoney(deposit),
    depositRequired: deposit > 0n,
    vatApplicable:
      vatRate > 0n && (input.rentVatable || charges.some((c) => c.vatable)),
    escalates: escalation > 0n,
    totalPayable: formatMoney(totalCents),
    totalVat: formatMoney(vatCents),
    firstPeriodTotal: rows[0].total,
    monthlyRent: formatMoney(baseRent),
    escalationPercent: `${(Number(escalation) / 100).toFixed(2).replace(/\.?0+$/, "")}%`,
    vatRate: `${(Number(vatRate) / 100).toFixed(2).replace(/\.?0+$/, "")}%`,
    paymentDay: input.paymentDay,
    termMonths: input.termMonths,
    charges: charges.map((c) => ({
      label: c.label,
      amount: formatMoney(c.cents),
      vatable: c.vatable,
    })),
  };
}
export type Schedule = ReturnType<typeof computeSchedule>;

export function scheduleValues(schedule: Schedule) {
  return {
    "schedule.start_date": schedule.startDate,
    "schedule.end_date": schedule.endDate,
    "schedule.term_months": String(schedule.termMonths),
    "schedule.monthly_rent": schedule.monthlyRent,
    "schedule.escalation_percent": schedule.escalationPercent,
    "schedule.deposit": schedule.deposit,
    "schedule.payment_day": String(schedule.paymentDay),
    "schedule.vat_rate": schedule.vatRate,
    "schedule.first_period_total": schedule.firstPeriodTotal,
    "schedule.total_payable": schedule.totalPayable,
  };
}
export function scheduleConditions(schedule: Schedule | null) {
  return {
    "schedule.deposit_required": Boolean(schedule?.depositRequired),
    "schedule.vat_applicable": Boolean(schedule?.vatApplicable),
    "schedule.escalates": Boolean(schedule?.escalates),
  };
}

// ---- Field catalog --------------------------------------------------------------------------------

export type Fact = {
  value: string;
  label: string;
  source: "portfolio" | "approved_lease" | "agreement" | "entered" | "schedule";
};
/** Labels for built-in merge keys; party keys are added per draft participant. */
export const BUILTIN_LABELS: Record<string, string> = {
  "company.name": "Company name",
  "company.contact": "Company signer contact",
  "agreement.title": "Agreement title",
  "agreement.generated_on": "Generation date",
  "property.name": "Property name",
  "property.address": "Property address",
  "property.size_sqm": "Property size (m²)",
  "property.landlord": "Landlord / owner",
  "lease.start_date": "Lease start date",
  "lease.end_date": "Lease end date",
  "lease.notice_months": "Notice period (months)",
  "lease.renewal_option": "Renewal option",
  "lease.break_clause": "Break clause",
  "schedule.start_date": "Schedule start date",
  "schedule.end_date": "Schedule end date",
  "schedule.term_months": "Term (months)",
  "schedule.monthly_rent": "Monthly rent",
  "schedule.escalation_percent": "Annual escalation",
  "schedule.deposit": "Deposit",
  "schedule.payment_day": "Payment day",
  "schedule.vat_rate": "VAT rate",
  "schedule.first_period_total": "First period total",
  "schedule.total_payable": "Total payable over the term",
};
export const BUILTIN_CONDITIONS: Record<string, string> = {
  "schedule.deposit_required": "A deposit is payable",
  "schedule.vat_applicable": "VAT applies",
  "schedule.escalates": "Rent escalates annually",
  "agreement.residential": "Residential agreement",
  "agreement.commercial": "Commercial agreement",
  "agreement.has_property": "A property is linked",
};
export const PARTY_ATTRS = {
  name: "name",
  email: "email",
  role: "role",
} as const;

// ---- Rendering ------------------------------------------------------------------------------------

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
export type RenderContext = {
  title: string;
  values: Record<string, string>;
  conditions: Record<string, boolean>;
  clauses: Record<string, DocNode>;
  schedule: Schedule | null;
};
export const DOCUMENT_CSS =
  "@page{size:A4;margin:20mm 18mm}*{box-sizing:border-box}body{margin:0;font-family:'Liberation Serif','DejaVu Serif','Times New Roman',serif;font-size:11pt;line-height:1.45;color:#000}" +
  "h1{font-size:18pt;margin:0 0 10pt}h2{font-size:14pt;margin:14pt 0 6pt}h3{font-size:12pt;margin:12pt 0 4pt}h4{font-size:11pt;margin:10pt 0 4pt}p{margin:0 0 6pt}" +
  "table{border-collapse:collapse;width:100%;margin:6pt 0 10pt;page-break-inside:auto}tr{page-break-inside:avoid}td,th{border:0.75pt solid #444;padding:3pt 5pt;vertical-align:top;text-align:left}th{background:#eee}" +
  "table.schedule td{text-align:right;font-variant-numeric:tabular-nums}table.schedule td:first-child,table.schedule td:nth-child(2),table.schedule td:nth-child(3){text-align:left}" +
  ".page-break{break-after:page;page-break-after:always;height:0}hr{border:0;border-top:0.75pt solid #444;margin:10pt 0}.missing{background:#fde68a;padding:0 2pt}";

/** Deterministic HTML: only whitelisted elements, every value escaped, no scripts or external resources. */
export function renderHtml(doc: DocNode, context: RenderContext) {
  const missing = new Set<string>();
  const usedClauses = new Set<string>();
  const align = (node: DocNode) =>
    node.attrs?.textAlign
      ? ` style="text-align:${String(node.attrs.textAlign)}"`
      : "";
  const render = (node: DocNode, inClause: boolean): string => {
    const inner = () =>
      (node.content ?? []).map((child) => render(child, inClause)).join("");
    switch (node.type) {
      case "doc":
        return inner();
      case "text": {
        let out = escapeHtml(node.text ?? "");
        for (const mark of node.marks ?? [])
          out =
            mark.type === "bold"
              ? `<strong>${out}</strong>`
              : mark.type === "italic"
                ? `<em>${out}</em>`
                : `<u>${out}</u>`;
        return out;
      }
      case "paragraph":
        return `<p${align(node)}>${inner() || "&#8203;"}</p>`;
      case "heading": {
        const level = Number(node.attrs?.level ?? 2);
        return `<h${level}${align(node)}>${inner()}</h${level}>`;
      }
      case "hardBreak":
        return "<br>";
      case "horizontalRule":
        return "<hr>";
      case "pageBreak":
        return '<div class="page-break"></div>';
      case "bulletList":
        return `<ul>${inner()}</ul>`;
      case "orderedList":
        return `<ol${node.attrs?.start ? ` start="${Number(node.attrs.start)}"` : ""}>${inner()}</ol>`;
      case "listItem":
        return `<li>${inner()}</li>`;
      case "table":
        return `<table>${inner()}</table>`;
      case "tableRow":
        return `<tr>${inner()}</tr>`;
      case "tableCell":
      case "tableHeader": {
        const tag = node.type === "tableHeader" ? "th" : "td";
        const spans = `${node.attrs?.colspan ? ` colspan="${Number(node.attrs.colspan)}"` : ""}${node.attrs?.rowspan ? ` rowspan="${Number(node.attrs.rowspan)}"` : ""}`;
        return `<${tag}${spans}>${inner()}</${tag}>`;
      }
      case "mergeField": {
        const key = String(node.attrs!.key);
        const value = context.values[key];
        if (value === undefined || value === "") {
          missing.add(key);
          return `<span class="missing">[${escapeHtml(key)}]</span>`;
        }
        return escapeHtml(value).replaceAll("\n", "<br>");
      }
      case "conditional":
        return context.conditions[String(node.attrs!.condition)] ? inner() : "";
      case "clauseRef": {
        const id = String(node.attrs!.clauseId);
        const clause = context.clauses[id];
        if (inClause || !clause) {
          missing.add(`clause:${id}`);
          return `<p class="missing">[clause unavailable]</p>`;
        }
        usedClauses.add(id);
        return `<section class="clause">${render(clause, true)}</section>`;
      }
      case "scheduleTable": {
        const schedule = context.schedule;
        if (!schedule) {
          missing.add("schedule");
          return `<p class="missing">[payment schedule]</p>`;
        }
        const head =
          "<tr><th>#</th><th>Period from</th><th>Due</th><th>Rent</th><th>Charges</th><th>VAT</th><th>Total</th></tr>";
        const rows = schedule.rows
          .map(
            (r) =>
              `<tr><td>${r.period}</td><td>${r.periodStart}</td><td>${r.dueDate}</td><td>${escapeHtml(r.rent)}</td><td>${escapeHtml(r.charges)}</td><td>${escapeHtml(r.vat)}</td><td>${escapeHtml(r.total)}</td></tr>`,
          )
          .join("");
        return `<table class="schedule">${head}${rows}<tr><th colspan="5">Total VAT ${escapeHtml(schedule.totalVat)}</th><th colspan="2">${escapeHtml(schedule.totalPayable)}</th></tr></table>`;
      }
      default:
        throw new ConvexError("Unsupported element during rendering");
    }
  };
  const body = render(doc, false);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(context.title)}</title><style>${DOCUMENT_CSS}</style></head><body>${body}</body></html>`;
  return {
    html,
    missing: [...missing].sort(),
    usedClauses: [...usedClauses].sort(),
  };
}

export async function contentHash(value: unknown) {
  return signingHash(value);
}
export const canonical = canonicalJson;
