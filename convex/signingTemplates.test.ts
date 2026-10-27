/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  addMonths,
  computeSchedule,
  moneyToCents,
  normalizeDoc,
  parseIsoDate,
  renderHtml,
  roundHalfUp,
  type ScheduleInput,
} from "./lib/signingTemplates";
import { PLACEHOLDER } from "./lib/signingTemplateStarters";

const modules = import.meta.glob("./**/*.ts");
const adminA = "templates-a@example.test",
  adminB = "templates-b@example.test";
const schedule: ScheduleInput = {
  startDate: "2027-01-31",
  termMonths: 25,
  monthlyRent: "10000.00",
  escalationPercent: "7.5",
  deposit: "20000",
  paymentDay: 1,
  vatRatePercent: "15",
  rentVatable: true,
  charges: [{ label: "Parking", amount: "333.33", vatable: false }],
};

describe("decimal-safe schedules and safe documents", () => {
  test("money parses exactly and rounding is half-up in integer cents", () => {
    expect(moneyToCents("12 500.5", "x")).toBe(1250050n);
    for (const bad of ["12.345", "1e3", "-5", "0x10", "12.", ""])
      expect(() => moneyToCents(bad, "Rent")).toThrow();
    expect(roundHalfUp(5n, 2n)).toBe(3n);
    expect(roundHalfUp(4n, 2n)).toBe(2n);
    expect(
      addMonths(parseIsoDate("2027-01-31", "d"), 1).toISOString().slice(0, 10),
    ).toBe("2027-02-28");
    expect(
      addMonths(parseIsoDate("2028-01-31", "d"), 1).toISOString().slice(0, 10),
    ).toBe("2028-02-29");
    expect(() => parseIsoDate("2027-02-30", "Start")).toThrow("valid date");
  });
  test("schedule escalates annually by compounding with cent rounding and per-period VAT", () => {
    const result = computeSchedule(schedule);
    expect(result.rows).toHaveLength(25);
    expect(result.rows[0]).toMatchObject({
      periodStart: "2027-01-31",
      dueDate: "2027-01-01",
      rent: "R 10 000.00",
      charges: "R 333.33",
      vat: "R 1 500.00",
      total: "R 11 833.33",
    });
    expect(result.rows[1].periodStart).toBe("2027-02-28");
    // 10 000.00 × 1.075 = 10 750.00; × 1.075 = 11 556.25
    expect(result.rows[12].rent).toBe("R 10 750.00");
    expect(result.rows[24].rent).toBe("R 11 556.25");
    expect(result.rows[24].vat).toBe("R 1 733.44"); // 11 556.25 × 15% = 1 733.4375 → half-up
    expect(result).toMatchObject({
      endDate: "2029-02-27",
      deposit: "R 20 000.00",
      depositRequired: true,
      vatApplicable: true,
      escalates: true,
    });
    expect(result.totalPayable).toMatch(/^R \d{1,3}( \d{3})*\.\d{2}$/);
    expect(() => computeSchedule({ ...schedule, termMonths: 121 })).toThrow(
      "Term",
    );
    expect(() =>
      computeSchedule({ ...schedule, escalationPercent: "75" }),
    ).toThrow("maximum");
    expect(() => computeSchedule({ ...schedule, paymentDay: 31 })).toThrow(
      "Payment day",
    );
  });
  test("documents are a closed schema and rendering escapes every value", () => {
    expect(() =>
      normalizeDoc(
        { type: "doc", content: [{ type: "script" }] },
        { allowClauses: true },
      ),
    ).toThrow("unsupported element");
    expect(() =>
      normalizeDoc(
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "x", marks: [{ type: "link" }] }],
            },
          ],
        },
        { allowClauses: true },
      ),
    ).toThrow("unsupported formatting");
    expect(() =>
      normalizeDoc(
        {
          type: "doc",
          content: [{ type: "clauseRef", attrs: { clauseId: "c1" } }],
        },
        { allowClauses: false },
      ),
    ).toThrow("not allowed");
    const doc = normalizeDoc(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "left", junk: 1 },
            content: [
              { type: "text", text: "<script>alert(1)</script>" },
              { type: "mergeField", attrs: { key: "input.name" } },
            ],
          },
          {
            type: "conditional",
            attrs: { condition: "input.show" },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Shown" }] },
            ],
          },
        ],
      },
      { allowClauses: true },
    );
    expect(doc.content![0].attrs).toBeUndefined();
    const out = renderHtml(doc, {
      title: "T",
      values: { "input.name": '"<b>Ann</b>"' },
      conditions: {},
      clauses: {},
      schedule: null,
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("&quot;&lt;b&gt;Ann&lt;/b&gt;&quot;");
    expect(out.html).not.toContain("Shown");
    expect(
      renderHtml(doc, {
        title: "T",
        values: {},
        conditions: { "input.show": true },
        clauses: {},
        schedule: null,
      }).missing,
    ).toEqual(["input.name"]);
  });
});

async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T08:00:00Z"));
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", `${adminA},${adminB}`);
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const sessions: { userId: Id<"users">; sessionId: Id<"authSessions"> }[] =
      [];
    for (const email of [adminA, adminB]) {
      const userId = await ctx.db.insert("users", { email });
      const sessionId = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: Date.now() + 3_600_000,
      });
      await ctx.db.insert("signingMfa", {
        userId,
        credentialVersion: "test",
        keyId: "test",
        encryptedSecret: "fixture",
        enabled: true,
        enrollmentExpiresAt: 0,
        recoveryHashes: [],
        failedAttempts: 0,
        lockedUntil: 0,
        lastAttemptAt: 0,
      });
      await ctx.db.insert("signingMfaGrants", {
        userId,
        sessionId,
        credentialVersion: "test",
        expiresAt: Date.now() + 3_600_000,
      });
      sessions.push({ userId, sessionId });
    }
    const createdBy = sessions[0].userId;
    const tenantId = await ctx.db.insert("tenants", {
      slug: "tpl",
      displayName: "Template Company",
      status: "active",
      primaryRegion: "ZA",
      createdAt: Date.now(),
      createdBy,
    });
    await ctx.db.insert("signingPolicies", {
      tenantId,
      revision: 1,
      jurisdiction: "ZA",
      legalReviewReference: "legal",
      privacyNoticeReference: "privacy",
      retentionPolicyReference: "retention",
      consentVersion: "c1",
      allowedCategories: ["residential_lease"],
      approvalRequired: true,
      allowSelfApproval: false,
      signerContact: "leases@example.test",
      updatedAt: Date.now(),
      updatedBy: createdBy,
    });
    const propertyId = await ctx.db.insert("properties", {
      tenantId,
      name: "Oak House",
      addressLine: "1 Oak Road",
      suburb: "Rosebank",
      city: "Johannesburg",
      propertyType: "office",
      status: "active",
      features: [],
      landlord: "Oak Holdings",
      createdAt: Date.now(),
      createdBy,
      updatedAt: Date.now(),
      updatedBy: createdBy,
    });
    const leaseId = await ctx.db.insert("leases", {
      tenantId,
      propertyId,
      startDate: "2027-01-01",
      endDate: "2027-12-31",
      monthlyRental: 10000.1,
      escalationPercent: 8,
      noticePeriodMonths: 2,
      status: "active",
      approvedAt: Date.now(),
      createdAt: Date.now(),
      createdBy,
      updatedAt: Date.now(),
      updatedBy: createdBy,
    });
    return { sessions, tenantId, propertyId, leaseId };
  });
  const a = t.withIdentity({
    subject: `${ids.sessions[0].userId}|${ids.sessions[0].sessionId}`,
  });
  const b = t.withIdentity({
    subject: `${ids.sessions[1].userId}|${ids.sessions[1].sessionId}`,
  });
  const { agreementId } = await a.mutation(api.signing.createDraft, {
    tenantId: ids.tenantId,
    requestId: "template-fixture-draft",
    draft: {
      title: "Oak House lease",
      category: "residential_lease",
      propertyId: ids.propertyId,
      leaseId: ids.leaseId,
      notes: "",
      participants: [
        {
          key: "tenant",
          name: "Thandi Tenant",
          email: "tenant@example.test",
          role: "Tenant",
          responsibility: "signer",
          stage: 1,
        },
      ],
    },
  });
  await a.mutation(api.signingTemplates.installStarters, {
    tenantId: ids.tenantId,
  });
  const library = () =>
    a.query(api.signingTemplates.library, { tenantId: ids.tenantId });
  return { ...ids, t, a, b, agreementId, library };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
type F = Awaited<ReturnType<typeof fixture>>;
const residential = async (f: F) =>
  (await f.library()).templates.find((t) => t.kind === "residential_lease")!;
/** Approves the residential starter after replacing its placeholder text (as a reviewer would). */
async function approvedResidential(f: F, extra: object[] = []) {
  const template = await residential(f);
  const draft = template.versions[0];
  const full = await f.a.query(api.signingTemplates.templateVersion, {
    versionId: draft.id,
  });
  const content = JSON.parse(
    JSON.stringify(full.content).replaceAll(
      PLACEHOLDER,
      "Approved synthetic clause text.",
    ),
  );
  content.content.push(...extra);
  const saved = await f.a.mutation(api.signingTemplates.saveTemplateDraft, {
    versionId: draft.id,
    expectedRevision: draft.revision,
    content,
    fields: full.fields,
    conditions: full.conditions,
  });
  await f.b.mutation(api.signingTemplates.approveTemplateVersion, {
    versionId: draft.id,
    expectedRevision: saved.revision,
    legalReference: "LEGAL-REVIEW-SYNTHETIC-1",
  });
  return { template, versionId: draft.id };
}
const inputs = (overrides: Record<string, string> = {}) => ({
  values: {
    "input.owner_name": "Oak Holdings (Pty) Ltd",
    "input.owner_identifier": "2001/000001/07",
    "input.renter_name": "Thandi Tenant",
    "input.renter_identifier": "9001010000080",
    "input.unit": "Unit 4B",
    ...overrides,
  },
  conditions: { pets_permitted: false },
  schedule,
});

describe("template and clause library", () => {
  test("starters are drafts with placeholder wording, installed once", async () => {
    const f = await fixture();
    const lib = await f.library();
    expect(lib.templates.map((t) => t.kind).sort()).toEqual([
      "commercial_lease",
      "general_contract",
      "month_to_month",
      "renewal",
      "residential_lease",
    ]);
    expect(
      lib.templates.every(
        (t) => t.versions[0].status === "draft" && !t.approvedVersionId,
      ),
    ).toBe(true);
    expect(lib.clauses).toHaveLength(4);
    expect(
      await f.a.mutation(api.signingTemplates.installStarters, {
        tenantId: f.tenantId,
      }),
    ).toEqual({ created: 0 });
    const full = await f.a.query(api.signingTemplates.templateVersion, {
      versionId: lib.templates[0].versions[0].id,
    });
    expect(JSON.stringify(full.content)).toContain(PLACEHOLDER);
    await expect(
      f.t
        .withIdentity({ subject: "outsider" })
        .query(api.signingTemplates.library, { tenantId: f.tenantId }),
    ).rejects.toThrow();
  });
  test("approval needs a second administrator, pins clauses and makes versions immutable", async () => {
    const f = await fixture();
    const clause = (await f.library()).clauses[0];
    const clauseRef = { type: "clauseRef", attrs: { clauseId: clause.id } };
    const template = await residential(f);
    const draft = template.versions[0];
    const full = await f.a.query(api.signingTemplates.templateVersion, {
      versionId: draft.id,
    });
    const saved = await f.a.mutation(api.signingTemplates.saveTemplateDraft, {
      versionId: draft.id,
      expectedRevision: draft.revision,
      content: {
        ...full.content,
        content: [...full.content.content!, clauseRef],
      },
      fields: full.fields,
      conditions: full.conditions,
    });
    await expect(
      f.a.mutation(api.signingTemplates.approveTemplateVersion, {
        versionId: draft.id,
        expectedRevision: saved.revision,
        legalReference: "L1",
      }),
    ).rejects.toThrow("Another administrator");
    await expect(
      f.b.mutation(api.signingTemplates.approveTemplateVersion, {
        versionId: draft.id,
        expectedRevision: saved.revision,
        legalReference: "L1",
      }),
    ).rejects.toThrow("Approve the clause");
    const clauseDraft = clause.versions[0];
    await f.b.mutation(api.signingTemplates.approveClauseVersion, {
      versionId: clauseDraft.id,
      expectedRevision: clauseDraft.revision,
      legalReference: "L-C1",
    });
    await f.b.mutation(api.signingTemplates.approveTemplateVersion, {
      versionId: draft.id,
      expectedRevision: saved.revision,
      legalReference: "L1",
    });
    const approved = await f.a.query(api.signingTemplates.templateVersion, {
      versionId: draft.id,
    });
    expect(approved.clausePins).toEqual([
      expect.objectContaining({
        clauseId: clause.id,
        versionId: clauseDraft.id,
      }),
    ]);
    await expect(
      f.a.mutation(api.signingTemplates.saveTemplateDraft, {
        versionId: draft.id,
        expectedRevision: approved.revision,
        content: approved.content,
        fields: approved.fields,
        conditions: approved.conditions,
      }),
    ).rejects.toThrow("immutable");
    const next = await f.a.mutation(api.signingTemplates.newTemplateVersion, {
      templateId: template.id,
    });
    expect(next).not.toBe(draft.id);
    expect(
      (await residential(f)).versions.map((v) => [v.version, v.status]),
    ).toEqual([
      [2, "draft"],
      [1, "approved"],
    ]);
    // A later clause version never changes the pinned clause of an approved template version.
    const nextClause = await f.a.mutation(
      api.signingTemplates.newClauseVersion,
      { clauseId: clause.id },
    );
    await f.a.mutation(api.signingTemplates.saveClauseDraft, {
      versionId: nextClause,
      expectedRevision: 1,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Changed" }] },
        ],
      },
    });
    expect(
      (
        await f.a.query(api.signingTemplates.templateVersion, {
          versionId: draft.id,
        })
      ).clausePins![0].versionId,
    ).toBe(clauseDraft.id);
    await expect(
      f.a.mutation(api.signingTemplates.saveTemplateDraft, {
        versionId: next,
        expectedRevision: 1,
        content: approved.content,
        fields: [
          ...approved.fields,
          { key: "bad key", label: "x", type: "text", required: false },
        ],
        conditions: [],
      }),
    ).rejects.toThrow("lower_snake_case");
  });
});

describe("generation from approved templates", () => {
  test("preview merges portfolio facts with provenance and blocks missing entries", async () => {
    const f = await fixture();
    const { versionId } = await approvedResidential(f);
    expect(
      (
        await f.a.query(api.signingTemplates.available, {
          agreementId: f.agreementId,
        })
      ).map((t) => t.versionId),
    ).toEqual([versionId]);
    const empty = await f.a.query(api.signingTemplates.preview, {
      agreementId: f.agreementId,
      templateVersionId: versionId,
      inputs: { values: {}, conditions: {}, schedule: null },
    });
    expect(empty.blockers).toEqual(
      expect.arrayContaining([
        "Lessor / owner legal name is required",
        "Complete the rent and payment schedule",
      ]),
    );
    expect(empty.suggestedSchedule).toMatchObject({
      startDate: "2027-01-01",
      termMonths: 12,
      monthlyRent: "10000.10",
      escalationPercent: "8",
    });
    const byKey = Object.fromEntries(empty.requirements.map((r) => [r.key, r]));
    expect(byKey["property.name"]).toMatchObject({
      value: "Oak House",
      source: "portfolio",
    });
    expect(byKey["input.unit"]).toMatchObject({ value: null, source: null });
    const full = await f.a.query(api.signingTemplates.preview, {
      agreementId: f.agreementId,
      templateVersionId: versionId,
      inputs: inputs(),
    });
    expect(full.blockers).toEqual([]);
    expect(full.html).toContain("Oak Holdings (Pty) Ltd");
    expect(full.html).toContain("1 Oak Road, Rosebank, Johannesburg");
    expect(full.html).toContain("R 10 750.00");
    expect(full.html).not.toContain("Pets");
    await expect(
      f.a.query(api.signingTemplates.preview, {
        agreementId: f.agreementId,
        templateVersionId: versionId,
        inputs: {
          ...inputs(),
          values: { ...inputs().values, "input.unknown": "x" },
        },
      }),
    ).rejects.toThrow("not used by this template");
    await expect(
      f.a.query(api.signingTemplates.preview, {
        agreementId: f.agreementId,
        templateVersionId: versionId,
        inputs: {
          ...inputs(),
          schedule: { ...schedule, monthlyRent: "12.345" },
        },
      }),
    ).rejects.toThrow("Monthly rent");
  });

  test("generation renders once, attaches the primary PDF and records every version", async () => {
    const f = await fixture();
    const { versionId } = await approvedResidential(f);
    const agreement = (await f.t.run((ctx) => ctx.db.get(f.agreementId)))!;
    await expect(
      f.a.mutation(api.signingTemplates.generate, {
        agreementId: f.agreementId,
        templateVersionId: versionId,
        expectedRevision: agreement.revision,
        expectedFileRevision: 0,
        requestId: "generate-missing",
        inputs: { ...inputs(), values: {} },
      }),
    ).rejects.toThrow("is required");
    const generationId = await f.a.mutation(api.signingTemplates.generate, {
      agreementId: f.agreementId,
      templateVersionId: versionId,
      expectedRevision: agreement.revision,
      expectedFileRevision: 0,
      requestId: "generate-one",
      inputs: inputs(),
    });
    expect(
      await f.a.mutation(api.signingTemplates.generate, {
        agreementId: f.agreementId,
        templateVersionId: versionId,
        expectedRevision: agreement.revision,
        expectedFileRevision: 0,
        requestId: "generate-one",
        inputs: inputs(),
      }),
    ).toBe(generationId);
    vi.stubEnv("SIGNING_WINDMILL_BASE_URL", "https://windmill.example.test");
    vi.stubEnv("WINDMILL_WORKSPACE", "w");
    vi.stubEnv("WINDMILL_SIGNING_DOCUMENTS_TOKEN", "documents-token");
    const sent: { url: string; body: Record<string, any> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({
        status: "rendered",
        sourceVersion: "q-v1",
        sizeBytes: 54321,
        pdfHash: "c".repeat(64),
        pageCount: 3,
        renderer: "gotenberg-chromium+pypdf-normalized-v1",
      });
    });
    await f.t.action(internal.signingTemplates.render, { generationId });
    expect(sent[0].url).toContain("/f/signing/render_template");
    const row = (await f.t.run((ctx) => ctx.db.get(generationId)))!;
    expect(sent[0].body.payload).toMatchObject({
      generationId,
      uploadId: row.uploadId,
      htmlHash: row.htmlHash,
    });
    expect(row).toMatchObject({
      status: "attached",
      pdfHash: "c".repeat(64),
      pageCount: 3,
    });
    const files = await f.t.run((ctx) =>
      ctx.db.query("signingFiles").collect(),
    );
    expect(files).toEqual([
      expect.objectContaining({
        role: "primary",
        active: true,
        sourceVersion: "q-v1",
        sizeBytes: 54321,
      }),
    ]);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.agreementId)))?.fileRevision,
    ).toBe(1);
    const events = await f.t.run((ctx) =>
      ctx.db.query("signingEvents").collect(),
    );
    expect(
      JSON.parse(
        events.find((e) => e.eventType === "document_generated")!.payload,
      ),
    ).toMatchObject({
      templateVersionId: versionId,
      rendererVersion: "cyphersoft-template-html-v1",
      pdfHash: "c".repeat(64),
      annexures: [],
    });
    const listed = await f.a.query(api.signingTemplates.generations, {
      agreementId: f.agreementId,
    });
    expect(listed[0]).toMatchObject({
      status: "attached",
      version: 1,
      pageCount: 3,
    });
    // Regenerating replaces the primary file; the earlier file record remains for history.
    const second = await f.a.mutation(api.signingTemplates.generate, {
      agreementId: f.agreementId,
      templateVersionId: versionId,
      expectedRevision: agreement.revision,
      expectedFileRevision: 1,
      requestId: "generate-two",
      inputs: inputs({ "input.unit": "Unit 5C" }),
    });
    await f.t.mutation(internal.signingTemplates.completeGeneration, {
      generationId: second,
      sourceVersion: "q-v2",
      sizeBytes: 100,
      pdfHash: "d".repeat(64),
      pageCount: 3,
      renderer: "r",
    });
    const after = await f.t.run((ctx) =>
      ctx.db.query("signingFiles").collect(),
    );
    expect(after.filter((x) => x.active).map((x) => x.sourceVersion)).toEqual([
      "q-v2",
    ]);
    expect(after).toHaveLength(2);
  });

  test("a draft changed during rendering supersedes the result; failures are recorded", async () => {
    const f = await fixture();
    const { versionId } = await approvedResidential(f);
    const agreement = (await f.t.run((ctx) => ctx.db.get(f.agreementId)))!;
    const generationId = await f.a.mutation(api.signingTemplates.generate, {
      agreementId: f.agreementId,
      templateVersionId: versionId,
      expectedRevision: agreement.revision,
      expectedFileRevision: 0,
      requestId: "generate-stale",
      inputs: inputs(),
    });
    await f.t.run((ctx) => ctx.db.patch(f.agreementId, { fileRevision: 4 }));
    await f.t.mutation(internal.signingTemplates.completeGeneration, {
      generationId,
      sourceVersion: "q",
      sizeBytes: 1,
      pdfHash: "e".repeat(64),
      pageCount: 1,
      renderer: "r",
    });
    expect((await f.t.run((ctx) => ctx.db.get(generationId)))?.status).toBe(
      "superseded",
    );
    expect(
      await f.t.run((ctx) => ctx.db.query("signingFiles").collect()),
    ).toHaveLength(0);
    await f.t.run((ctx) => ctx.db.patch(f.agreementId, { fileRevision: 0 }));
    const failing = await f.a.mutation(api.signingTemplates.generate, {
      agreementId: f.agreementId,
      templateVersionId: versionId,
      expectedRevision: agreement.revision,
      expectedFileRevision: 0,
      requestId: "generate-fail",
      inputs: inputs(),
    });
    vi.stubGlobal("fetch", async () =>
      Response.json({ status: "blocked", error: "renderer_unavailable" }),
    );
    vi.stubEnv("SIGNING_WINDMILL_BASE_URL", "https://windmill.example.test");
    vi.stubEnv("WINDMILL_WORKSPACE", "w");
    vi.stubEnv("WINDMILL_SIGNING_DOCUMENTS_TOKEN", "documents-token");
    await f.t.action(internal.signingTemplates.render, {
      generationId: failing,
    });
    expect(await f.t.run((ctx) => ctx.db.get(failing))).toMatchObject({
      status: "failed",
      error: "renderer_unavailable",
    });
  });

  test("historical generations reproduce exactly after template and portfolio changes", async () => {
    const f = await fixture();
    const { template, versionId } = await approvedResidential(f);
    const agreement = (await f.t.run((ctx) => ctx.db.get(f.agreementId)))!;
    const generationId = await f.a.mutation(api.signingTemplates.generate, {
      agreementId: f.agreementId,
      templateVersionId: versionId,
      expectedRevision: agreement.revision,
      expectedFileRevision: 0,
      requestId: "generate-history",
      inputs: inputs(),
    });
    // Later edits: the property is renamed and a new template version is approved.
    await f.t.run((ctx) =>
      ctx.db.patch(f.propertyId, { name: "Renamed House" }),
    );
    const next = await f.a.mutation(api.signingTemplates.newTemplateVersion, {
      templateId: template.id,
    });
    const full = await f.a.query(api.signingTemplates.templateVersion, {
      versionId: next,
    });
    const saved = await f.a.mutation(api.signingTemplates.saveTemplateDraft, {
      versionId: next,
      expectedRevision: 1,
      content: {
        ...full.content,
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "New heading" }],
          },
          ...full.content.content!,
        ],
      },
      fields: full.fields,
      conditions: full.conditions,
    });
    await f.b.mutation(api.signingTemplates.approveTemplateVersion, {
      versionId: next,
      expectedRevision: saved.revision,
      legalReference: "L2",
    });
    expect(
      await f.a.query(api.signingTemplates.reproduce, { generationId }),
    ).toMatchObject({ matches: true });
    const stored = (await f.t.run((ctx) => ctx.db.get(generationId)))!;
    expect(stored.html).toContain("Oak House");
    await f.t.run((ctx) =>
      ctx.db.patch(generationId, {
        inputs: stored.inputs.replace("Unit 4B", "Unit 9Z"),
      }),
    );
    expect(
      await f.a.query(api.signingTemplates.reproduce, { generationId }),
    ).toMatchObject({ matches: false });
  });
});
