/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ADMIN_EMAIL = "admin@cyphersoft.test";

async function setup() {
  process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  const t = convexTest(schema, modules);
  const asUser = (userId: string) => t.withIdentity({ subject: `${userId}|session` });
  const adminId = await t.run((ctx) => ctx.db.insert("users", { email: ADMIN_EMAIL }));
  const admin = asUser(adminId);
  const acme = await admin.mutation(api.clients.create, {
    name: "Acme",
    slug: "acme",
    primaryContactName: "Ann",
    primaryContactEmail: "ann@acme.test",
    inviteContactAsAdmin: true,
  });
  const other = await admin.mutation(api.clients.create, {
    name: "Other",
    slug: "other",
    primaryContactName: "Olu",
    primaryContactEmail: "olu@other.test",
    inviteContactAsAdmin: true,
  });
  const annId = await t.run((ctx) => ctx.db.insert("users", { email: "ann@acme.test" }));
  const ann = asUser(annId);
  await ann.mutation(api.users.syncCurrentUser, {});
  const oluId = await t.run((ctx) => ctx.db.insert("users", { email: "olu@other.test" }));
  const olu = asUser(oluId);
  await olu.mutation(api.users.syncCurrentUser, {});

  const store = (content: string, type: string) =>
    t.run((ctx) => ctx.storage.store(new Blob([content], { type })));

  return { t, admin, ann, olu, acme, other, store };
}

describe("documents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a client upload is visible to that client and staff only", async () => {
    const { admin, ann, olu, acme, other, store } = await setup();
    const storageId = await store("%PDF-1.4 test", "application/pdf");
    const created = await ann.mutation(api.documents.create, {
      tenantId: acme.tenantId,
      storageId,
      filename: "lease.pdf",
      declaredType: "lease",
      source: "upload",
    });
    const documentId = created.documentId!;

    const annList = await ann.query(api.documents.list, { tenantId: acme.tenantId });
    expect(annList.map((doc) => doc.filename)).toEqual(["lease.pdf"]);
    expect(annList[0].status).toBe("uploaded");
    expect(annList[0].uploaderPrincipal).toBe("client");

    expect(await olu.query(api.documents.get, { documentId })).toBeNull();
    await expect(olu.query(api.documents.list, { tenantId: acme.tenantId })).rejects.toThrow(/access/);
    expect(await olu.query(api.documents.list, { tenantId: other.tenantId })).toEqual([]);

    const staffList = await admin.query(api.documents.list, {});
    expect(staffList).toHaveLength(1);
    const detail = await admin.query(api.documents.get, { documentId });
    expect(detail?.fileUrl).toBeTruthy();
  });

  test("unsupported files are rejected and removed from storage", async () => {
    const { ann, acme, store, t } = await setup();
    const storageId = await store("PK zip bytes", "application/zip");
    const result = await ann.mutation(api.documents.create, {
      tenantId: acme.tenantId,
      storageId,
      filename: "archive.zip",
      source: "upload",
    });
    expect(result.documentId).toBeNull();
    expect(result.error).toMatch(/Unsupported file type/);
    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
  });

  test("processing results become fields; low confidence and missing fields need review", async () => {
    const { t, admin, ann, acme, store } = await setup();
    const storageId = await store("%PDF-1.4 test", "application/pdf");
    const created = await ann.mutation(api.documents.create, {
      tenantId: acme.tenantId,
      storageId,
      filename: "lease.pdf",
      source: "upload",
    });
    const documentId = created.documentId!;
    await t.mutation(internal.processing.markQueued, { documentId, jobId: "job-1" });

    // A late result from another job is ignored.
    await t.mutation(internal.processing.applyResult, {
      documentId,
      jobId: "stale-job",
      result: { extraction: { document_type: "invoice", fields: [] } },
    });
    expect((await admin.query(api.documents.get, { documentId }))?.status).toBe("queued_for_ocr");

    await t.mutation(internal.processing.applyResult, {
      documentId,
      jobId: "job-1",
      result: {
        parsed_json_key: "acme/x/lease.json",
        okf_bundle_root: "acme/x/lease",
        docling_confidence: 0.93,
        extraction: {
          document_type: "lease",
          type_confidence: 0.98,
          summary: "A lease.",
          missing_fields: ["monthly_rental"],
          fields: [
            { key: "lease_start_date", label: "Lease start date", kind: "date", value: "2024-03-01", confidence: 0.99, evidence: "commences on 1 March 2024" },
            { key: "tenant_name", label: "Tenant", kind: "text", value: "Acme", confidence: 0.6 },
          ],
        },
      },
    });

    const detail = await admin.query(api.documents.get, { documentId });
    expect(detail?.status).toBe("review_required");
    expect(detail?.documentType).toBe("lease");
    expect(detail?.missingFields).toEqual(["monthly_rental"]);
    expect(detail?.okfBundleRoot).toBe("acme/x/lease");
    const states = Object.fromEntries((detail?.fields ?? []).map((field) => [field.key, field.state]));
    expect(states).toEqual({ lease_start_date: "detected", tenant_name: "low_confidence_review" });
  });

  test("clients can only retry failed documents; deletion is a request for clients", async () => {
    const { t, admin, ann, acme, store } = await setup();
    const storageId = await store("%PDF-1.4 test", "application/pdf");
    const created = await ann.mutation(api.documents.create, {
      tenantId: acme.tenantId,
      storageId,
      filename: "invoice.pdf",
      source: "upload",
    });
    const documentId = created.documentId!;
    await t.mutation(internal.processing.markQueued, { documentId, jobId: "job-1" });
    await expect(ann.mutation(api.documents.reprocess, { documentId })).rejects.toThrow(/failed documents/);
    await t.mutation(internal.processing.markFailed, { documentId, jobId: "job-1", message: "Docling timeout" });
    await ann.mutation(api.documents.reprocess, { documentId });
    expect((await ann.query(api.documents.get, { documentId }))?.status).toBe("uploaded");

    const requested = await ann.mutation(api.documents.requestDeletion, { documentId, reason: "Wrong file" });
    expect(requested.deleted).toBe(false);
    expect((await ann.query(api.documents.get, { documentId }))?.deletionRequestedAt).toBeTruthy();

    const deleted = await admin.mutation(api.documents.requestDeletion, { documentId });
    expect(deleted.deleted).toBe(true);
    expect(await ann.query(api.documents.list, { tenantId: acme.tenantId })).toEqual([]);
  });
});
