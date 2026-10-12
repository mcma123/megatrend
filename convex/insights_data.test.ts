/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ADMIN_EMAIL = "admin@cyphersoft.test";

function invoiceResult(amount: number, date: string, invoiceNumber: string) {
  return {
    // convex-test's search fake needs every document to have the searched field.
    text_preview: `City of Johannesburg water statement ${date} amount due R ${amount}`,
    extraction: {
      document_type: "utility_statement",
      type_confidence: 0.97,
      summary: "Water bill.",
      missing_fields: [],
      fields: [
        { key: "supplier_name", label: "Supplier", kind: "text", value: "City of Johannesburg Water", confidence: 0.98 },
        { key: "statement_date", label: "Statement date", kind: "date", value: date, confidence: 0.98 },
        { key: "amount_due", label: "Amount due (ZAR)", kind: "number", value: String(amount), confidence: 0.97 },
        { key: "account_number", label: "Account number", kind: "text", value: invoiceNumber, confidence: 0.95 },
      ],
    },
  };
}

async function setup() {
  process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  const t = convexTest(schema, modules);
  const asUser = (userId: string) => t.withIdentity({ subject: `${userId}|session` });
  const adminId = await t.run((ctx) => ctx.db.insert("users", { email: ADMIN_EMAIL, name: "Admin" }));
  const admin = asUser(adminId);
  const acme = await admin.mutation(api.clients.create, {
    name: "Acme Logistics",
    slug: "acme",
    primaryContactName: "Ann",
    primaryContactEmail: "ann@acme.test",
    inviteContactAsAdmin: true,
  });
  const annId = await t.run((ctx) => ctx.db.insert("users", { email: "ann@acme.test", name: "Ann" }));
  const ann = asUser(annId);
  await ann.mutation(api.users.syncCurrentUser, {});
  const { propertyId } = await admin.mutation(api.properties.create, {
    tenantId: acme.tenantId,
    name: "Linbro Distribution Centre",
    addressLine: "14 Modderfontein Rd",
    city: "Johannesburg",
    province: "Gauteng",
    propertyType: "logistics",
    status: "active",
    features: [],
  });

  let job = 0;
  /** Upload → process → approve all → complete review; returns the review result. */
  async function approvedStatement(amount: number, date: string, reference = `ACC-${date}`) {
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["%PDF"], { type: "application/pdf" })));
    const created = await ann.mutation(api.documents.create, {
      tenantId: acme.tenantId,
      storageId,
      filename: `water-${date}.pdf`,
      propertyId,
      source: "upload",
    });
    const documentId = created.documentId!;
    job += 1;
    await t.mutation(internal.processing.markQueued, { documentId, jobId: `job-${job}` });
    await t.mutation(internal.processing.applyResult, {
      documentId,
      jobId: `job-${job}`,
      result: invoiceResult(amount, date, reference),
    });
    await admin.mutation(api.review.approveHighConfidence, { documentId });
    return { documentId, review: await admin.mutation(api.review.completeReview, { documentId }) };
  }

  return { t, admin, ann, acme, propertyId, approvedStatement };
}

describe("invoices and anomalies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  });
  afterEach(() => vi.useRealTimers());

  test("a bill 50% above the rolling baseline raises a critical anomaly with a task and draft insight", async () => {
    const { admin, ann, acme, approvedStatement } = await setup();
    await approvedStatement(10000, "2026-05-01");
    await approvedStatement(10400, "2026-06-01");
    const third = await approvedStatement(9600, "2026-07-01");
    expect(third.review.invoiceRecorded).toBe(true);
    expect(third.review.anomalies).toBe(0);

    const spike = await approvedStatement(15000, "2026-08-01");
    expect(spike.review.anomalies).toBe(1);

    const invoices = await admin.query(api.invoices.list, {});
    expect(invoices).toHaveLength(4);
    const latest = invoices[0];
    expect(latest).toMatchObject({ amount: 15000, baseline: 10000, baselineSampleSize: 3 });

    const anomalies = await admin.query(api.invoices.listAnomalies, {});
    expect(anomalies[0]).toMatchObject({ kind: "cost_spike", severity: "critical", status: "open" });

    // Investigation task (internal) and a system draft insight exist.
    const tasks = await admin.query(api.actions.list, {});
    expect(tasks.some((task) => task.title === "Investigate cost spike: City of Johannesburg Water" && !task.visibleToClient)).toBe(true);
    const drafts = await admin.query(api.insights.list, { status: "draft" });
    expect(drafts.some((insight) => insight.draftedBy === "system" && insight.category === "cost")).toBe(true);

    // Clients see invoices but not unshared anomalies.
    const clientAnomalies = await ann.query(api.invoices.listAnomalies, { tenantId: acme.tenantId });
    expect(clientAnomalies).toEqual([]);
    await admin.mutation(api.invoices.setAnomalyShared, { anomalyId: anomalies[0]._id, shared: true });
    expect(await ann.query(api.invoices.listAnomalies, { tenantId: acme.tenantId })).toHaveLength(1);

    await admin.mutation(api.invoices.setAnomalyStatus, { anomalyId: anomalies[0]._id, status: "resolved", note: "Leak fixed" });
    const afterTasks = await admin.query(api.actions.list, {});
    expect(afterTasks.find((task) => task.title.startsWith("Investigate cost spike"))?.status).toBe("completed");
  });

  test("the same bill uploaded twice is flagged as a possible duplicate", async () => {
    const { admin, approvedStatement } = await setup();
    await approvedStatement(10000, "2026-05-01", "INV-1");
    const second = await approvedStatement(10000, "2026-05-01", "INV-1");
    expect(second.review.anomalies).toBe(1);
    const anomalies = await admin.query(api.invoices.listAnomalies, {});
    expect(anomalies[0].kind).toBe("possible_duplicate");
  });
});

describe("dashboard, reports and search", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  });
  afterEach(() => vi.useRealTimers());

  test("overview, activity, reports and search reflect real records", async () => {
    const { admin, ann, acme, propertyId, approvedStatement } = await setup();
    const end = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    await admin.mutation(api.leases.create, {
      propertyId,
      startDate: "2022-01-01",
      endDate: end,
      monthlyRental: 100000,
      status: "active",
    });
    await approvedStatement(10000, "2026-05-01");

    const overview = await admin.query(api.dashboard.staffOverview, {});
    expect(overview.kpis).toMatchObject({ activeClients: 1, liveLeases: 1, annualRental: 1200000, documentsTotal: 1 });
    expect(overview.renewals).toHaveLength(1);
    expect(overview.activity.some((row) => row.text.startsWith("Document review completed"))).toBe(true);

    const report = await admin.query(api.reports.portfolio, {});
    expect(report.byRegion[0]).toMatchObject({ region: "Gauteng", annualRental: 1200000 });
    expect(report.totals.documentsProcessed).toBe(1);

    const results = await admin.query(api.search.global, { q: "Linbro" });
    expect(results.properties.map((property) => property.name)).toEqual(["Linbro Distribution Centre"]);
    expect(results.leases).toHaveLength(1);
    await expect(ann.query(api.search.global, { q: "Linbro" })).rejects.toThrow(/staff/);

    const clientFeed = await ann.query(api.dashboard.clientActivity, { tenantId: acme.tenantId });
    expect(clientFeed.every((row) => !row.eventType.startsWith("anomaly") && row.eventType !== "insight.drafted")).toBe(true);
  });
});
