import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireStaff, requireTenantAccess } from "./lib/auth";
import { appendSigningEvent } from "./lib/signingAudit";
import { assertPreparationIdle } from "./lib/signingFileAccess";
import { boundedText, canonicalJson, signingHash } from "./lib/signing";
import {
  BUILTIN_CONDITIONS,
  BUILTIN_LABELS,
  collectRefs,
  computeSchedule,
  FIELD_KEY,
  formatMoney,
  KIND_CATEGORY,
  moneyToCents,
  normalizeDoc,
  normalizeFieldDefinitions,
  parseIsoDate,
  renderHtml,
  scheduleConditions,
  scheduleInput,
  scheduleValues,
  templateCondition,
  templateField,
  templateKind,
  TEMPLATE_RENDERER,
  type DocNode,
  type Fact,
  type ScheduleInput,
  type TemplateField,
} from "./lib/signingTemplates";
import { STARTER_CLAUSES, STARTERS } from "./lib/signingTemplateStarters";
import { workerRequest } from "./lib/signingWorker";
import { getAgreement, requireSigningWriter } from "./signing";

const MAX_HTML = 700_000;
const SAST = 2 * 3600_000;

async function requireReader(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
) {
  await requireStaff(ctx);
  const access = await requireTenantAccess(ctx, tenantId);
  if (access.principalType !== "staff")
    throw new ConvexError("Signing templates require company staff access");
}
async function policyOf(ctx: QueryCtx | MutationCtx, tenantId: Id<"tenants">) {
  return ctx.db
    .query("signingPolicies")
    .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
    .unique();
}

// ---- Library -------------------------------------------------------------------------------------

export const library = query({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await requireReader(ctx, args.tenantId);
    const templates = await ctx.db
      .query("signingTemplates")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .take(200);
    const clauses = await ctx.db
      .query("signingClauses")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .take(300);
    const summary = <
      T extends Doc<"signingTemplateVersions"> | Doc<"signingClauseVersions">,
    >(
      rows: T[],
    ) =>
      rows.map((row) => ({
        id: row._id as T["_id"],
        version: row.version,
        status: row.status,
        revision: row.revision,
        contentHash: row.contentHash,
        legalReference: row.legalReference ?? null,
        updatedAt: row.updatedAt,
        approvedAt: row.approvedAt ?? null,
      }));
    return {
      templates: await Promise.all(
        templates.map(async (t) => ({
          id: t._id,
          name: t.name,
          kind: t.kind,
          category: t.category,
          retired: Boolean(t.retiredAt),
          approvedVersionId: t.approvedVersionId ?? null,
          versions: summary(
            await ctx.db
              .query("signingTemplateVersions")
              .withIndex("by_templateId_and_version", (q) =>
                q.eq("templateId", t._id),
              )
              .order("desc")
              .take(20),
          ),
        })),
      ),
      clauses: await Promise.all(
        clauses.map(async (c) => ({
          id: c._id,
          title: c.title,
          retired: Boolean(c.retiredAt),
          approvedVersionId: c.approvedVersionId ?? null,
          versions: summary(
            await ctx.db
              .query("signingClauseVersions")
              .withIndex("by_clauseId_and_version", (q) =>
                q.eq("clauseId", c._id),
              )
              .order("desc")
              .take(20),
          ),
        })),
      ),
    };
  },
});
export const templateVersion = query({
  args: { versionId: v.id("signingTemplateVersions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.versionId);
    if (!row) throw new ConvexError("Template version not found");
    await requireReader(ctx, row.tenantId);
    return { ...row, content: JSON.parse(row.content) as DocNode };
  },
});
export const clauseVersion = query({
  args: { versionId: v.id("signingClauseVersions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.versionId);
    if (!row) throw new ConvexError("Clause version not found");
    await requireReader(ctx, row.tenantId);
    return { ...row, content: JSON.parse(row.content) as DocNode };
  },
});

async function versionHash(
  content: DocNode,
  fields: TemplateField[] = [],
  conditions: { key: string; label: string }[] = [],
) {
  return signingHash({ contractVersion: 1, content, fields, conditions });
}
async function checkClauseRefs(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  doc: DocNode,
) {
  for (const clauseId of collectRefs(doc).clauses) {
    const id = ctx.db.normalizeId("signingClauses", clauseId);
    const clause = id ? await ctx.db.get(id) : null;
    if (!clause || clause.tenantId !== tenantId)
      throw new ConvexError(
        "A referenced clause is not in this company's library",
      );
  }
}
async function insertTemplate(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  userId: Id<"users">,
  input: {
    name: string;
    kind: Doc<"signingTemplates">["kind"];
    doc: DocNode;
    fields: TemplateField[];
    conditions: { key: string; label: string }[];
  },
) {
  const content = normalizeDoc(input.doc, { allowClauses: true });
  const defs = normalizeFieldDefinitions(input.fields, input.conditions);
  const now = Date.now();
  const templateId = await ctx.db.insert("signingTemplates", {
    tenantId,
    name: boundedText(input.name, "Template name", 120),
    kind: input.kind,
    category: KIND_CATEGORY[input.kind],
    latestVersion: 1,
    createdAt: now,
    createdBy: userId,
  });
  await ctx.db.insert("signingTemplateVersions", {
    tenantId,
    templateId,
    version: 1,
    status: "draft",
    content: canonicalJson(content),
    ...defs,
    revision: 1,
    contentHash: await versionHash(content, defs.fields, defs.conditions),
    updatedAt: now,
    updatedBy: userId,
  });
  return templateId;
}
async function insertClause(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  userId: Id<"users">,
  title: string,
  doc: DocNode,
) {
  const content = normalizeDoc(doc, { allowClauses: false });
  const now = Date.now();
  const clauseId = await ctx.db.insert("signingClauses", {
    tenantId,
    title: boundedText(title, "Clause title", 120),
    latestVersion: 1,
    createdAt: now,
    createdBy: userId,
  });
  await ctx.db.insert("signingClauseVersions", {
    tenantId,
    clauseId,
    version: 1,
    status: "draft",
    content: canonicalJson(content),
    revision: 1,
    contentHash: await versionHash(content),
    updatedAt: now,
    updatedBy: userId,
  });
  return clauseId;
}

/** Installs draft starter structures (placeholders, never approved text). Idempotent by name. */
export const installStarters = mutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const user = await requireSigningWriter(ctx, args.tenantId);
    const templates = await ctx.db
      .query("signingTemplates")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .take(200);
    const clauses = await ctx.db
      .query("signingClauses")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", args.tenantId))
      .take(300);
    let created = 0;
    for (const starter of STARTERS)
      if (!templates.some((t) => t.name === starter.name)) {
        await insertTemplate(ctx, args.tenantId, user._id, starter);
        created += 1;
      }
    for (const starter of STARTER_CLAUSES)
      if (!clauses.some((c) => c.title === starter.title)) {
        await insertClause(
          ctx,
          args.tenantId,
          user._id,
          starter.title,
          starter.doc,
        );
        created += 1;
      }
    return { created };
  },
});
export const createTemplate = mutation({
  args: { tenantId: v.id("tenants"), name: v.string(), kind: templateKind },
  handler: async (ctx, args) => {
    const user = await requireSigningWriter(ctx, args.tenantId);
    return insertTemplate(ctx, args.tenantId, user._id, {
      name: args.name,
      kind: args.kind,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: args.name.trim() || "Agreement" }],
          },
        ],
      },
      fields: [],
      conditions: [],
    });
  },
});
export const createClause = mutation({
  args: { tenantId: v.id("tenants"), title: v.string() },
  handler: async (ctx, args) => {
    const user = await requireSigningWriter(ctx, args.tenantId);
    return insertClause(ctx, args.tenantId, user._id, args.title, {
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  },
});

async function editableTemplateVersion(
  ctx: MutationCtx,
  versionId: Id<"signingTemplateVersions">,
  expectedRevision: number,
) {
  const row = await ctx.db.get(versionId);
  if (!row) throw new ConvexError("Template version not found");
  const user = await requireSigningWriter(ctx, row.tenantId);
  if (row.status !== "draft")
    throw new ConvexError(
      "Approved versions are immutable. Create a new version to edit",
    );
  if (row.revision !== expectedRevision)
    throw new ConvexError("This draft changed. Reload before saving");
  const template = (await ctx.db.get(row.templateId))!;
  if (template.retiredAt) throw new ConvexError("This template is retired");
  return { row, user, template };
}
export const saveTemplateDraft = mutation({
  args: {
    versionId: v.id("signingTemplateVersions"),
    expectedRevision: v.number(),
    content: v.any(),
    fields: v.array(templateField),
    conditions: v.array(templateCondition),
  },
  handler: async (ctx, args) => {
    const { row, user } = await editableTemplateVersion(
      ctx,
      args.versionId,
      args.expectedRevision,
    );
    const content = normalizeDoc(args.content, { allowClauses: true });
    await checkClauseRefs(ctx, row.tenantId, content);
    const defs = normalizeFieldDefinitions(args.fields, args.conditions);
    const refs = collectRefs(content);
    for (const key of refs.fields)
      if (
        key.startsWith("input.") &&
        !defs.fields.some((f) => `input.${f.key}` === key) &&
        !defs.conditions.some((c) => `input.${c.key}` === key)
      )
        throw new ConvexError(
          `Define the input field ${key.slice(6)} before using it`,
        );
    await ctx.db.patch(row._id, {
      content: canonicalJson(content),
      ...defs,
      revision: row.revision + 1,
      contentHash: await versionHash(content, defs.fields, defs.conditions),
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
    return { revision: row.revision + 1 };
  },
});
export const saveClauseDraft = mutation({
  args: {
    versionId: v.id("signingClauseVersions"),
    expectedRevision: v.number(),
    content: v.any(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.versionId);
    if (!row) throw new ConvexError("Clause version not found");
    const user = await requireSigningWriter(ctx, row.tenantId);
    if (row.status !== "draft")
      throw new ConvexError(
        "Approved versions are immutable. Create a new version to edit",
      );
    if (row.revision !== args.expectedRevision)
      throw new ConvexError("This draft changed. Reload before saving");
    const content = normalizeDoc(args.content, { allowClauses: false });
    await ctx.db.patch(row._id, {
      content: canonicalJson(content),
      revision: row.revision + 1,
      contentHash: await versionHash(content),
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
    return { revision: row.revision + 1 };
  },
});

async function assertApprover(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  editor: Id<"users">,
  approver: Id<"users">,
) {
  const policy = await policyOf(ctx, tenantId);
  if (editor === approver && !policy?.allowSelfApproval)
    throw new ConvexError(
      "Another administrator must approve this version (company policy disallows self-approval)",
    );
}
/** Approves the exact reviewed draft and pins the approved version of every referenced clause. */
export const approveTemplateVersion = mutation({
  args: {
    versionId: v.id("signingTemplateVersions"),
    expectedRevision: v.number(),
    legalReference: v.string(),
  },
  handler: async (ctx, args) => {
    const { row, user, template } = await editableTemplateVersion(
      ctx,
      args.versionId,
      args.expectedRevision,
    );
    await assertApprover(ctx, row.tenantId, row.updatedBy, user._id);
    const legalReference = boundedText(
      args.legalReference,
      "Legal approval reference",
      500,
    );
    const content = JSON.parse(row.content) as DocNode;
    const pins = [];
    for (const clauseId of collectRefs(content).clauses) {
      const clause = await ctx.db.get(clauseId as Id<"signingClauses">);
      const approved = clause?.approvedVersionId
        ? await ctx.db.get(clause.approvedVersionId)
        : null;
      if (
        !clause ||
        clause.retiredAt ||
        !approved ||
        approved.status !== "approved"
      )
        throw new ConvexError(
          `Approve the clause "${clause?.title ?? "unknown"}" before this template`,
        );
      pins.push({
        clauseId: clause._id,
        versionId: approved._id,
        contentHash: approved.contentHash,
      });
    }
    if (template.approvedVersionId)
      await ctx.db.patch(template.approvedVersionId, { status: "superseded" });
    await ctx.db.patch(row._id, {
      status: "approved",
      clausePins: pins,
      legalReference,
      approvedAt: Date.now(),
      approvedBy: user._id,
    });
    await ctx.db.patch(template._id, { approvedVersionId: row._id });
    return null;
  },
});
export const approveClauseVersion = mutation({
  args: {
    versionId: v.id("signingClauseVersions"),
    expectedRevision: v.number(),
    legalReference: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.versionId);
    if (!row) throw new ConvexError("Clause version not found");
    const user = await requireSigningWriter(ctx, row.tenantId);
    if (row.status !== "draft" || row.revision !== args.expectedRevision)
      throw new ConvexError(
        "This draft changed or is already approved. Reload first",
      );
    await assertApprover(ctx, row.tenantId, row.updatedBy, user._id);
    const clause = (await ctx.db.get(row.clauseId))!;
    if (clause.approvedVersionId)
      await ctx.db.patch(clause.approvedVersionId, { status: "superseded" });
    await ctx.db.patch(row._id, {
      status: "approved",
      legalReference: boundedText(
        args.legalReference,
        "Legal approval reference",
        500,
      ),
      approvedAt: Date.now(),
      approvedBy: user._id,
    });
    await ctx.db.patch(clause._id, { approvedVersionId: row._id });
    return null;
  },
});
/** New editable draft copied from the latest version; earlier versions never change. */
export const newTemplateVersion = mutation({
  args: { templateId: v.id("signingTemplates") },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new ConvexError("Template not found");
    const user = await requireSigningWriter(ctx, template.tenantId);
    const latest = await ctx.db
      .query("signingTemplateVersions")
      .withIndex("by_templateId_and_version", (q) =>
        q.eq("templateId", template._id).eq("version", template.latestVersion),
      )
      .unique();
    if (!latest) throw new ConvexError("Template version not found");
    if (latest.status === "draft") return latest._id;
    const version = template.latestVersion + 1;
    const id = await ctx.db.insert("signingTemplateVersions", {
      tenantId: template.tenantId,
      templateId: template._id,
      version,
      status: "draft",
      content: latest.content,
      fields: latest.fields,
      conditions: latest.conditions,
      revision: 1,
      contentHash: latest.contentHash,
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
    await ctx.db.patch(template._id, { latestVersion: version });
    return id;
  },
});
export const newClauseVersion = mutation({
  args: { clauseId: v.id("signingClauses") },
  handler: async (ctx, args) => {
    const clause = await ctx.db.get(args.clauseId);
    if (!clause) throw new ConvexError("Clause not found");
    const user = await requireSigningWriter(ctx, clause.tenantId);
    const latest = await ctx.db
      .query("signingClauseVersions")
      .withIndex("by_clauseId_and_version", (q) =>
        q.eq("clauseId", clause._id).eq("version", clause.latestVersion),
      )
      .unique();
    if (!latest) throw new ConvexError("Clause version not found");
    if (latest.status === "draft") return latest._id;
    const version = clause.latestVersion + 1;
    const id = await ctx.db.insert("signingClauseVersions", {
      tenantId: clause.tenantId,
      clauseId: clause._id,
      version,
      status: "draft",
      content: latest.content,
      revision: 1,
      contentHash: latest.contentHash,
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
    await ctx.db.patch(clause._id, { latestVersion: version });
    return id;
  },
});
export const retire = mutation({
  args: {
    templateId: v.optional(v.id("signingTemplates")),
    clauseId: v.optional(v.id("signingClauses")),
  },
  handler: async (ctx, args) => {
    const row = args.templateId
      ? await ctx.db.get(args.templateId)
      : args.clauseId
        ? await ctx.db.get(args.clauseId)
        : null;
    if (!row) throw new ConvexError("Template or clause not found");
    await requireSigningWriter(ctx, row.tenantId);
    if (!row.retiredAt) await ctx.db.patch(row._id, { retiredAt: Date.now() });
    return null;
  },
});

// ---- Generation ----------------------------------------------------------------------------------

export const generationInputs = v.object({
  values: v.record(v.string(), v.string()),
  conditions: v.record(v.string(), v.boolean()),
  schedule: v.union(scheduleInput, v.null()),
});
type Inputs = {
  values: Record<string, string>;
  conditions: Record<string, boolean>;
  schedule: ScheduleInput | null;
};
/** Everything needed to re-render exactly; stored with each generation. */
type Snapshot = {
  contractVersion: 1;
  generatedOn: string;
  facts: Record<string, Fact>;
  conditions: Record<string, boolean>;
  schedule: ScheduleInput | null;
  annexures: { fileId: string; sourceVersion: string; filename: string }[];
};

function formatInput(field: TemplateField, raw: string) {
  const value = raw.trim();
  if (!value) return "";
  if (
    value.length > 2000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new ConvexError(
      `${field.label} is too long or contains unsupported characters`,
    );
  if (field.type === "date")
    return parseIsoDate(value, field.label).toISOString().slice(0, 10);
  if (field.type === "money")
    return formatMoney(moneyToCents(value, field.label));
  if (
    field.type === "number" &&
    !/^-?(0|[1-9]\d{0,11})(\.\d{1,4})?$/.test(value)
  )
    throw new ConvexError(`${field.label} must be a number`);
  if (field.type !== "multiline" && value.includes("\n"))
    throw new ConvexError(`${field.label} must be a single line`);
  return value;
}
async function liveFacts(
  ctx: QueryCtx | MutationCtx,
  agreement: Doc<"signingAgreements">,
) {
  const facts: Record<string, Fact> = {};
  const put = (
    key: string,
    value: string | number | undefined | null,
    source: Fact["source"],
    label = BUILTIN_LABELS[key] ?? key,
  ) => {
    if (value === undefined || value === null || String(value).trim() === "")
      return;
    facts[key] = { value: String(value).trim(), label, source };
  };
  const revision = agreement.currentRevisionId
    ? await ctx.db.get(agreement.currentRevisionId)
    : null;
  if (!revision) throw new ConvexError("Agreement revision not found");
  const tenant = await ctx.db.get(agreement.tenantId);
  const policy = await policyOf(ctx, agreement.tenantId);
  put("company.name", tenant?.displayName, "portfolio");
  put("company.contact", policy?.signerContact, "portfolio");
  put("agreement.title", revision.title, "agreement");
  const property = revision.propertyId
    ? await ctx.db.get(revision.propertyId)
    : null;
  if (
    property &&
    property.tenantId === agreement.tenantId &&
    !property.archivedAt
  ) {
    put("property.name", property.name, "portfolio");
    put(
      "property.address",
      [property.addressLine, property.suburb, property.city, property.province]
        .filter(Boolean)
        .join(", "),
      "portfolio",
    );
    put("property.size_sqm", property.sizeSqm, "portfolio");
    put("property.landlord", property.landlord, "portfolio");
  }
  const lease = revision.leaseId ? await ctx.db.get(revision.leaseId) : null;
  if (lease && lease.tenantId === agreement.tenantId && !lease.archivedAt) {
    // Values applied from a staff-approved document are labelled as such.
    const source = lease.approvedAt ? "approved_lease" : "portfolio";
    put("lease.start_date", lease.startDate, source);
    put("lease.end_date", lease.endDate, source);
    put("lease.notice_months", lease.noticePeriodMonths, source);
    put("lease.renewal_option", lease.renewalOption, source);
    put("lease.break_clause", lease.breakClause, source);
  }
  const participants = await ctx.db
    .query("signingParticipants")
    .withIndex("by_revisionId", (q) => q.eq("revisionId", revision._id))
    .take(21);
  for (const party of participants) {
    put(
      `party.${party.key}.name`,
      party.name,
      "agreement",
      `${party.role} name`,
    );
    put(
      `party.${party.key}.email`,
      party.email,
      "agreement",
      `${party.role} email`,
    );
    put(
      `party.${party.key}.role`,
      party.role,
      "agreement",
      `${party.role} role`,
    );
  }
  return { facts, revision, property, lease };
}
/** Suggested schedule from portfolio facts; staff confirm or change it explicitly. */
function suggestedSchedule(lease: Doc<"leases"> | null): ScheduleInput | null {
  if (!lease) return null;
  const start = new Date(`${lease.startDate}T00:00:00Z`),
    end = new Date(`${lease.endDate}T00:00:00Z`);
  const months = Math.max(
    1,
    Math.min(
      120,
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        end.getUTCMonth() -
        start.getUTCMonth() +
        (end.getUTCDate() >= start.getUTCDate() - 1 ? 1 : 0),
    ),
  );
  return {
    startDate: lease.startDate,
    termMonths: months,
    monthlyRent: (Math.round(lease.monthlyRental * 100) / 100).toFixed(2),
    escalationPercent: String(lease.escalationPercent ?? 0),
    deposit: "0",
    paymentDay: 1,
    vatRatePercent: "15",
    rentVatable: false,
    charges: [],
  };
}
async function clauseDocs(
  ctx: QueryCtx | MutationCtx,
  version: Doc<"signingTemplateVersions">,
) {
  const clauses: Record<string, DocNode> = {};
  for (const pin of version.clausePins ?? []) {
    const clause = await ctx.db.get(pin.versionId);
    if (
      !clause ||
      clause.contentHash !== pin.contentHash ||
      clause.tenantId !== version.tenantId
    )
      throw new ConvexError(
        "A pinned clause version failed its integrity check",
      );
    clauses[pin.clauseId] = JSON.parse(clause.content) as DocNode;
  }
  return clauses;
}
/** Pure re-render from a stored snapshot; used for previews, generation and reproduction. */
function renderSnapshot(
  version: Doc<"signingTemplateVersions">,
  title: string,
  clauses: Record<string, DocNode>,
  snapshot: Snapshot,
) {
  const schedule = snapshot.schedule
    ? computeSchedule(snapshot.schedule)
    : null;
  const values: Record<string, string> = Object.fromEntries(
    Object.entries(snapshot.facts).map(([k, f]) => [k, f.value]),
  );
  values["agreement.generated_on"] = snapshot.generatedOn;
  if (schedule) Object.assign(values, scheduleValues(schedule));
  return {
    ...renderHtml(JSON.parse(version.content) as DocNode, {
      title,
      values,
      conditions: snapshot.conditions,
      clauses,
      schedule,
    }),
    schedule,
  };
}
async function prepare(
  ctx: QueryCtx | MutationCtx,
  agreement: Doc<"signingAgreements">,
  versionId: Id<"signingTemplateVersions">,
  inputs: Inputs,
  generatedOn: string,
) {
  const version = await ctx.db.get(versionId);
  const template = version ? await ctx.db.get(version.templateId) : null;
  if (
    !version ||
    !template ||
    version.tenantId !== agreement.tenantId ||
    version.status !== "approved" ||
    template.retiredAt
  )
    throw new ConvexError("Choose a current approved template");
  if (template.category !== agreement.category)
    throw new ConvexError(
      "The template category does not match this agreement",
    );
  const { facts, revision, lease } = await liveFacts(ctx, agreement);
  const refs = collectRefs(JSON.parse(version.content) as DocNode);
  const blockers: string[] = [];
  // Explicit entries: template fields, plus any referenced fact staff choose to supply or correct.
  for (const [key, raw] of Object.entries(inputs.values)) {
    if (key.length > 120) throw new ConvexError("Invalid entry key");
    const field = version.fields.find((f) => `input.${f.key}` === key);
    if (field) {
      const value = formatInput(field, raw);
      if (value) facts[key] = { value, label: field.label, source: "entered" };
    } else if (
      refs.fields.has(key) &&
      !key.startsWith("schedule.") &&
      key !== "agreement.generated_on"
    ) {
      const value = formatInput(
        {
          key,
          label: BUILTIN_LABELS[key] ?? key,
          type: "text",
          required: false,
        },
        raw,
      );
      if (value)
        facts[key] = {
          value,
          label: facts[key]?.label ?? BUILTIN_LABELS[key] ?? key,
          source: "entered",
        };
    } else if (raw.trim())
      throw new ConvexError(`${key} is not used by this template`);
  }
  for (const field of version.fields)
    if (field.required && !facts[`input.${field.key}`])
      blockers.push(`${field.label} is required`);
  let schedule = null;
  if (inputs.schedule) schedule = computeSchedule(inputs.schedule);
  else if (
    refs.schedule ||
    [...refs.fields].some((k) => k.startsWith("schedule."))
  )
    blockers.push("Complete the rent and payment schedule");
  const conditions: Record<string, boolean> = {
    ...scheduleConditions(schedule),
    "agreement.residential": agreement.category === "residential_lease",
    "agreement.commercial": agreement.category === "commercial_lease",
    "agreement.has_property": Boolean(facts["property.name"]),
  };
  for (const condition of version.conditions)
    conditions[`input.${condition.key}`] =
      inputs.conditions[condition.key] === true;
  for (const key of Object.keys(inputs.conditions))
    if (!FIELD_KEY.test(key) || !version.conditions.some((c) => c.key === key))
      throw new ConvexError(`Unknown condition ${key.slice(0, 40)}`);
  const annexures = (
    await ctx.db
      .query("signingFiles")
      .withIndex("by_agreementId_and_active", (q) =>
        q.eq("agreementId", agreement._id).eq("active", true),
      )
      .take(20)
  )
    .filter((f) => f.role === "annexure")
    .sort((a, b) => a.position - b.position)
    .map((f) => ({
      fileId: f._id,
      sourceVersion: f.sourceVersion,
      filename: f.filename,
    }));
  const snapshot: Snapshot = {
    contractVersion: 1,
    generatedOn,
    facts,
    conditions,
    schedule: inputs.schedule,
    annexures,
  };
  const clauses = await clauseDocs(ctx, version);
  const rendered = renderSnapshot(version, revision.title, clauses, snapshot);
  for (const key of rendered.missing)
    if (
      key !== "schedule" ||
      !blockers.includes("Complete the rent and payment schedule")
    )
      blockers.push(
        `Missing: ${facts[key]?.label ?? BUILTIN_LABELS[key] ?? key}`,
      );
  if (rendered.html.length > MAX_HTML)
    blockers.push("The generated document is too large");
  const used = [...refs.fields].sort();
  return {
    version,
    template,
    revision,
    snapshot,
    rendered,
    blockers: [...new Set(blockers)],
    requirements: used.map((key) => ({
      key,
      label:
        facts[key]?.label ??
        version.fields.find((f) => `input.${f.key}` === key)?.label ??
        BUILTIN_LABELS[key] ??
        key,
      value:
        key.startsWith("schedule.") || key === "agreement.generated_on"
          ? null
          : (facts[key]?.value ?? null),
      source:
        facts[key]?.source ?? (key.startsWith("schedule.") ? "schedule" : null),
    })),
    suggestedSchedule: suggestedSchedule(lease),
    conditionLabels: {
      ...BUILTIN_CONDITIONS,
      ...Object.fromEntries(
        version.conditions.map((c) => [`input.${c.key}`, c.label]),
      ),
    },
  };
}
const todaySast = () => new Date(Date.now() + SAST).toISOString().slice(0, 10);

export const preview = query({
  args: {
    agreementId: v.id("signingAgreements"),
    templateVersionId: v.id("signingTemplateVersions"),
    inputs: generationInputs,
  },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const result = await prepare(
      ctx,
      agreement,
      args.templateVersionId,
      args.inputs,
      todaySast(),
    );
    return {
      html: result.rendered.html,
      blockers: result.blockers,
      requirements: result.requirements,
      fields: result.version.fields,
      conditions: result.version.conditions,
      conditionLabels: result.conditionLabels,
      suggestedSchedule: result.suggestedSchedule,
      schedule: result.rendered.schedule,
      annexures: result.snapshot.annexures.map((a) => a.filename),
    };
  },
});
/** Approved templates matching an agreement's category, for the generation picker. */
export const available = query({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const templates = await ctx.db
      .query("signingTemplates")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", agreement.tenantId))
      .take(200);
    const out = [];
    for (const t of templates)
      if (
        !t.retiredAt &&
        t.approvedVersionId &&
        t.category === agreement.category
      ) {
        const version = await ctx.db.get(t.approvedVersionId);
        if (version)
          out.push({
            templateId: t._id,
            name: t.name,
            versionId: version._id,
            version: version.version,
          });
      }
    return out;
  },
});

export const generate = mutation({
  args: {
    agreementId: v.id("signingAgreements"),
    templateVersionId: v.id("signingTemplateVersions"),
    expectedRevision: v.number(),
    expectedFileRevision: v.number(),
    requestId: v.string(),
    inputs: generationInputs,
  },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const user = await requireSigningWriter(ctx, agreement.tenantId);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(args.requestId))
      throw new ConvexError("Invalid request");
    const replay = await ctx.db
      .query("signingUploads")
      .withIndex("by_agreementId_and_createdBy_and_requestId", (q) =>
        q
          .eq("agreementId", agreement._id)
          .eq("createdBy", user._id)
          .eq("requestId", args.requestId),
      )
      .unique();
    if (replay) {
      const prior = (
        await ctx.db
          .query("signingGenerations")
          .withIndex("by_agreementId", (q) =>
            q.eq("agreementId", agreement._id),
          )
          .take(200)
      ).find((g) => g.uploadId === replay._id);
      if (!prior)
        throw new ConvexError("This request was already used for another file");
      return prior._id;
    }
    if (agreement.status !== "draft")
      throw new ConvexError("Generate documents only for drafts");
    await assertPreparationIdle(ctx, agreement);
    if (
      agreement.revision !== args.expectedRevision ||
      (agreement.fileRevision ?? 0) !== args.expectedFileRevision
    )
      throw new ConvexError(
        "The draft or its files changed. Reload before generating",
      );
    const result = await prepare(
      ctx,
      agreement,
      args.templateVersionId,
      args.inputs,
      todaySast(),
    );
    if (result.blockers.length) throw new ConvexError(result.blockers[0]);
    const inputs = canonicalJson(result.snapshot);
    const now = Date.now();
    const uploadId = await ctx.db.insert("signingUploads", {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      revisionId: result.revision._id,
      createdBy: user._id,
      requestId: args.requestId,
      filename: `${
        result.template.name
          .replace(/[^A-Za-z0-9 _-]/g, "")
          .trim()
          .slice(0, 80) || "agreement"
      } v${result.version.version}.pdf`,
      role: "primary",
      expectedSize: 0,
      expiresAt: now + 30 * 60_000,
      state: "pending",
    });
    const generationId = await ctx.db.insert("signingGenerations", {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      revisionId: result.revision._id,
      templateId: result.template._id,
      templateVersionId: result.version._id,
      templateContentHash: result.version.contentHash,
      rendererVersion: TEMPLATE_RENDERER,
      inputs,
      inputHash: await signingHash(result.snapshot),
      html: result.rendered.html,
      htmlHash: await sha256(result.rendered.html),
      fileRevision: agreement.fileRevision ?? 0,
      uploadId,
      status: "rendering",
      createdAt: now,
      createdBy: user._id,
    });
    await appendSigningEvent(
      ctx,
      agreement,
      user._id,
      "document_generation_requested",
      {
        generationId,
        templateVersionId: result.version._id,
        templateContentHash: result.version.contentHash,
        rendererVersion: TEMPLATE_RENDERER,
      },
    );
    await ctx.scheduler.runAfter(0, internal.signingTemplates.render, {
      generationId,
    });
    return generationId;
  },
});
async function sha256(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const generationContext = internalQuery({
  args: { generationId: v.id("signingGenerations") },
  handler: async (ctx, args) => ctx.db.get(args.generationId),
});
const RENDER_ERRORS = new Set([
  "not_configured",
  "renderer_unavailable",
  "render_failed",
  "storage_failed",
  "limit_exceeded",
  "result_invalid",
]);
export const render = internalAction({
  args: { generationId: v.id("signingGenerations") },
  handler: async (ctx, args): Promise<null> => {
    const row: Doc<"signingGenerations"> | null = await ctx.runQuery(
      internal.signingTemplates.generationContext,
      args,
    );
    if (!row || row.status !== "rendering") return null;
    let result: Record<string, unknown>;
    try {
      result = (await workerRequest(
        "/run_wait_result/p/f/signing/render_template",
        {
          operation: "render",
          tenant_id: row.tenantId,
          agreement_id: row.agreementId,
          payload: {
            generationId: row._id,
            uploadId: row.uploadId,
            html: row.html,
            htmlHash: row.htmlHash,
          },
        },
      )) as Record<string, unknown>;
    } catch {
      result = { status: "blocked", error: "renderer_unavailable" };
    }
    if (result?.status !== "rendered") {
      const code =
        typeof result?.error === "string" && RENDER_ERRORS.has(result.error)
          ? result.error
          : "render_failed";
      await ctx.runMutation(internal.signingTemplates.failGeneration, {
        generationId: row._id,
        error: code,
      });
      return null;
    }
    await ctx.runMutation(internal.signingTemplates.completeGeneration, {
      generationId: row._id,
      sourceVersion: String(result.sourceVersion ?? ""),
      sizeBytes: Number(result.sizeBytes),
      pdfHash: String(result.pdfHash ?? ""),
      pageCount: Number(result.pageCount),
      renderer: String(result.renderer ?? "").slice(0, 100),
    });
    return null;
  },
});
export const failGeneration = internalMutation({
  args: { generationId: v.id("signingGenerations"), error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.generationId);
    if (!row || row.status !== "rendering") return null;
    await ctx.db.patch(row._id, { status: "failed", error: args.error });
    return null;
  },
});
/** Attaches the rendered PDF as the draft's primary file only if nothing changed meanwhile. */
export const completeGeneration = internalMutation({
  args: {
    generationId: v.id("signingGenerations"),
    sourceVersion: v.string(),
    sizeBytes: v.number(),
    pdfHash: v.string(),
    pageCount: v.number(),
    renderer: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.generationId);
    if (!row || row.status !== "rendering") return null;
    const agreement = await ctx.db.get(row.agreementId);
    const upload = await ctx.db.get(row.uploadId);
    const valid =
      args.sourceVersion &&
      args.sourceVersion !== "null" &&
      args.sourceVersion.length <= 1024 &&
      !/[\r\n]/.test(args.sourceVersion) &&
      Number.isSafeInteger(args.sizeBytes) &&
      args.sizeBytes > 0 &&
      args.sizeBytes <= 25 * 1024 * 1024 &&
      /^[a-f0-9]{64}$/.test(args.pdfHash) &&
      Number.isInteger(args.pageCount) &&
      args.pageCount > 0 &&
      args.pageCount <= 200;
    if (!valid) {
      await ctx.db.patch(row._id, {
        status: "failed",
        error: "result_invalid",
      });
      return null;
    }
    const preparing = agreement?.bundleAttemptId
      ? await ctx.db.get(agreement.bundleAttemptId)
      : null;
    if (
      !agreement ||
      !upload ||
      upload.state !== "pending" ||
      agreement.status !== "draft" ||
      agreement.currentRevisionId !== row.revisionId ||
      (agreement.fileRevision ?? 0) !== row.fileRevision ||
      (preparing &&
        ["queued", "submitting", "running", "submission_unknown"].includes(
          preparing.status,
        ))
    ) {
      await ctx.db.patch(row._id, { status: "superseded" });
      return null;
    }
    const files = await ctx.db
      .query("signingFiles")
      .withIndex("by_agreementId_and_active", (q) =>
        q.eq("agreementId", agreement._id).eq("active", true),
      )
      .take(20);
    for (const file of files)
      if (file.role === "primary")
        await ctx.db.patch(file._id, { active: false });
    const fileId = await ctx.db.insert("signingFiles", {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      uploadId: upload._id,
      filename: upload.filename,
      role: "primary",
      sizeBytes: args.sizeBytes,
      sourceVersion: args.sourceVersion,
      position: -1,
      active: true,
      createdAt: Date.now(),
      createdBy: row.createdBy,
    });
    await ctx.db.patch(upload._id, {
      state: "attached",
      fileId,
      expectedSize: args.sizeBytes,
    });
    await ctx.db.patch(agreement._id, {
      fileRevision: (agreement.fileRevision ?? 0) + 1,
      currentBundleId: undefined,
      currentLayoutId: undefined,
      frozenPreparationId: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(row._id, {
      status: "attached",
      fileId,
      pdfHash: args.pdfHash,
      pdfRenderer: args.renderer,
      sizeBytes: args.sizeBytes,
      pageCount: args.pageCount,
    });
    const snapshot = JSON.parse(row.inputs) as Snapshot;
    await appendSigningEvent(
      ctx,
      agreement,
      row.createdBy,
      "document_generated",
      {
        generationId: row._id,
        fileId,
        templateVersionId: row.templateVersionId,
        templateContentHash: row.templateContentHash,
        rendererVersion: row.rendererVersion,
        pdfRenderer: args.renderer,
        inputHash: row.inputHash,
        htmlHash: row.htmlHash,
        pdfHash: args.pdfHash,
        annexures: snapshot.annexures,
      },
    );
    return fileId;
  },
});

export const generations = query({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const agreement = await getAgreement(ctx, args.agreementId);
    const rows = await ctx.db
      .query("signingGenerations")
      .withIndex("by_agreementId", (q) => q.eq("agreementId", agreement._id))
      .order("desc")
      .take(20);
    return Promise.all(
      rows.map(async (g) => {
        const version = await ctx.db.get(g.templateVersionId);
        const template = await ctx.db.get(g.templateId);
        return {
          id: g._id,
          status: g.status,
          error: g.error ?? null,
          template: template?.name ?? "Template",
          version: version?.version ?? null,
          createdAt: g.createdAt,
          inputHash: g.inputHash,
          htmlHash: g.htmlHash,
          pdfHash: g.pdfHash ?? null,
          pageCount: g.pageCount ?? null,
          rendererVersion: g.rendererVersion,
          pdfRenderer: g.pdfRenderer ?? null,
          annexures: (JSON.parse(g.inputs) as Snapshot).annexures.map(
            (a) => a.filename,
          ),
        };
      }),
    );
  },
});
/** Re-renders a historical generation from its stored snapshot and pinned versions. */
export const reproduce = query({
  args: { generationId: v.id("signingGenerations") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.generationId);
    if (!row) throw new ConvexError("Generation not found");
    await getAgreement(ctx, row.agreementId);
    const version = await ctx.db.get(row.templateVersionId);
    if (!version || version.contentHash !== row.templateContentHash)
      return { matches: false, reason: "Template version changed or missing" };
    const revision = await ctx.db.get(row.revisionId);
    const snapshot = JSON.parse(row.inputs) as Snapshot;
    if ((await signingHash(snapshot)) !== row.inputHash)
      return { matches: false, reason: "Stored inputs failed integrity check" };
    const rendered = renderSnapshot(
      version,
      revision?.title ?? "",
      await clauseDocs(ctx, version),
      snapshot,
    );
    const htmlHash = await sha256(rendered.html);
    return {
      matches:
        htmlHash === row.htmlHash && row.rendererVersion === TEMPLATE_RENDERER,
      reason: htmlHash === row.htmlHash ? null : "Rendered HTML differs",
      htmlHash,
    };
  },
});
