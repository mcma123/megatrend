/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ADMIN = "fields@cyphersoft.test";

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ADMIN }));
  const admin = t.withIdentity({ subject: `${userId}|session` });
  const client = await admin.mutation(api.clients.create, {
    name: "Field history",
    slug: "field-history",
    primaryContactName: "Client",
    primaryContactEmail: "client@fields.test",
    inviteContactAsAdmin: true,
  });
  const clientId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "client@fields.test" }),
  );
  const clientUser = t.withIdentity({ subject: `${clientId}|session` });
  await clientUser.mutation(api.users.syncCurrentUser, {});
  const { propertyId } = await admin.mutation(api.properties.create, {
    tenantId: client.tenantId,
    name: "Warehouse",
    addressLine: "1 Test St",
    city: "Sandton",
    propertyType: "warehouse",
    status: "active",
    features: [],
  });
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["%PDF"], { type: "application/pdf" })),
  );
  const { documentId: createdId } = await admin.mutation(api.documents.create, {
    tenantId: client.tenantId,
    storageId,
    filename: "lease.pdf",
    propertyId,
    source: "upload",
  });
  const documentId = createdId!;
  const read = () => admin.query(api.documents.get, { documentId });
  const field = async (
    key: string,
    value: string,
    extra: Partial<Doc<"extractedFields">> = {},
  ) =>
    t.run((ctx) =>
      ctx.db.insert("extractedFields", {
        tenantId: client.tenantId,
        documentId,
        key,
        value,
        kind: "text",
        label: key,
        state: "detected",
        confidence: 0.99,
        windmillJobId: "current-job",
        createdAt: Date.now(),
        ...extra,
      }),
    );
  async function history() {
    // 600 fields across six old jobs; many remain approved/detected even though
    // the former 500-row supersession loop could never reach all of them.
    return t.run(async (ctx) => {
      const ids: Id<"extractedFields">[] = [];
      for (let i = 0; i < 600; i++)
        ids.push(
          await ctx.db.insert("extractedFields", {
            tenantId: client.tenantId,
            documentId,
            key: i % 2 ? "monthly_rental" : "supplier_name",
            label: "Historical",
            value: i % 2 ? "999999" : "Old supplier",
            kind: "text",
            confidence: 0.99,
            state: i % 3 ? "approved" : "detected",
            windmillJobId: `old-${Math.floor(i / 100)}`,
            createdAt: Date.now(),
            originalValue: "old original",
            reviewedBy: userId,
            reviewedAt: Date.now(),
          }),
        );
      return ids;
    });
  }
  async function finish(
    fields: Record<string, unknown>[],
    type = "lease",
    jobId = "current-job",
  ) {
    const attemptId = (await t.mutation(internal.processing.claim, {
      documentId,
      submissionJobId: jobId,
    }))!;
    await t.mutation(internal.processing.beginSubmission, {
      documentId,
      attemptId,
    });
    await t.mutation(internal.processing.markQueued, {
      documentId,
      attemptId,
      jobId,
    });
    await t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId,
      jobId,
      result: {
        contract_version: 1,
        attempt_id: attemptId,
        docling_status: "success",
        stages: {
          parse: { status: "succeeded" },
          knowledge: { status: "succeeded" },
          extract: { status: "succeeded" },
        },
        completeness: { complete: true },
        extraction: {
          document_type: type,
          type_confidence: 0.99,
          missing_fields: [],
          fields,
        },
      },
    });
    return attemptId;
  }
  return {
    t,
    admin,
    clientUser,
    documentId,
    propertyId,
    read,
    field,
    history,
    finish,
  };
}

const LEASE_FIELDS = [
  {
    key: "lease_start_date",
    value: "2026-01-01",
    kind: "date",
    confidence: 0.99,
  },
  {
    key: "lease_end_date",
    value: "2029-01-01",
    kind: "date",
    confidence: 0.99,
  },
  { key: "monthly_rental", value: "25000", kind: "number", confidence: 0.6 },
];

describe("current extraction fields", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", ADMIN);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("600 historical fields cannot hide current fields or enter review, leases, reports, or AI facts", async () => {
    const { t, admin, documentId, read, history, finish } = await setup();
    const oldIds = await history();
    const before = await t.run((ctx) => ctx.db.get(oldIds[599]));
    const attemptId = await finish(LEASE_FIELDS);
    const detail = (await read())!;
    expect(detail.fields).toHaveLength(3);
    expect(detail.fields.every((f) => f.attemptId === attemptId)).toBe(true);
    expect((await admin.query(api.review.queue, {}))[0]).toMatchObject({
      pendingFields: 3,
      lowConfidenceFields: 1,
    });
    // /api/insights/draft takes its approved facts from this same documents.get response.
    expect(detail.fields.filter((f) => f.state === "approved")).toEqual([]);
    await expect(
      admin.mutation(api.review.approveField, { fieldId: oldIds[599] }),
    ).rejects.toThrow(/obsolete/);
    await expect(
      admin.mutation(api.review.rejectField, { fieldId: oldIds[598] }),
    ).rejects.toThrow(/obsolete/);
    expect(
      await admin.mutation(api.review.approveHighConfidence, { documentId }),
    ).toEqual({ approved: 2 });
    await expect(
      admin.mutation(api.review.completeReview, { documentId }),
    ).rejects.toThrow(/1 field still/);
    await expect(
      admin.mutation(api.review.applyToLease, { documentId }),
    ).rejects.toThrow(/approve the start date/);
    await admin.mutation(api.review.approveField, {
      fieldId: detail.fields[2]._id,
    });
    await admin.mutation(api.review.completeReview, { documentId });
    const { leaseId } = await admin.mutation(api.review.applyToLease, {
      documentId,
    });
    expect(
      (await admin.query(api.leases.get, { leaseId }))?.monthlyRental,
    ).toBe(25000);
    expect(
      (await read())!.fields
        .filter((f) => f.state === "approved")
        .map((f) => f.value),
    ).not.toContain("999999");
    expect((await admin.query(api.reports.portfolio, {})).totals).toMatchObject(
      { fieldsExtracted: 3, fieldsApproved: 3 },
    );
    expect(await t.run((ctx) => ctx.db.get(oldIds[599]))).toEqual(before);
  });

  test.each([false, true])(
    "legacy fields use exact current job after 600 history rows (Phase 1 pointer: %s)",
    async (withPointer) => {
      const { t, admin, documentId, read, field, history } = await setup();
      await history();
      await t.run(async (ctx) => {
        const attemptId = withPointer
          ? await ctx.db.insert("processingAttempts", {
              tenantId: (await ctx.db.get(documentId))!.tenantId,
              documentId,
              state: "completed",
              submissionJobId: "current-job",
              windmillJobId: "current-job",
              claimedAt: Date.now(),
              updatedAt: Date.now(),
            })
          : undefined;
        await ctx.db.patch(documentId, {
          status: "extraction_complete",
          documentType: "invoice",
          windmillJobId: "current-job",
          activeAttemptId: attemptId,
        });
      });
      await field("supplier_name", "Current supplier");
      await field("total_amount", "1234", { kind: "number" });
      const detail = (await read())!;
      expect(detail.fields).toHaveLength(2);
      await expect(
        admin.mutation(api.review.approveField, {
          fieldId: (await t.run((ctx) =>
            ctx.db.query("extractedFields").first(),
          ))!._id,
        }),
      ).rejects.toThrow(/obsolete/);
      expect(
        await admin.mutation(api.review.approveHighConfidence, { documentId }),
      ).toEqual({ approved: 2 });
      expect(
        await admin.mutation(api.review.completeReview, { documentId }),
      ).toMatchObject({ invoiceRecorded: true });
      const invoices = await t.run((ctx) => ctx.db.query("invoices").take(10));
      expect(invoices).toHaveLength(1);
      expect(invoices[0]).toMatchObject({
        supplier: "Current supplier",
        amount: 1234,
      });
    },
  );

  test("an owned invoice uses only approved fields from its current attempt", async () => {
    const { t, admin, documentId, history, finish } = await setup();
    await history();
    await finish(
      [
        { key: "supplier_name", value: "New supplier", confidence: 0.99 },
        {
          key: "total_amount",
          value: "4321",
          kind: "number",
          confidence: 0.99,
        },
      ],
      "invoice",
    );
    await admin.mutation(api.review.approveHighConfidence, { documentId });
    expect(
      await admin.mutation(api.review.completeReview, { documentId }),
    ).toMatchObject({ invoiceRecorded: true });
    expect(await t.run((ctx) => ctx.db.query("invoices").take(10))).toEqual([
      expect.objectContaining({ supplier: "New supplier", amount: 4321 }),
    ]);
  });

  test("pagination and completion include fields beyond 200, and cursors are bound to the extraction", async () => {
    const { t, admin, documentId, read, field, finish } = await setup();
    const attemptId = await finish(LEASE_FIELDS);
    const initial = (await read())!.fields;
    for (let i = 0; i < 230; i++)
      await field(`extra-${i}`, String(i), {
        attemptId,
        state: i === 229 ? "low_confidence_review" : "detected",
      });
    expect((await read())!.fields).toHaveLength(233);
    const first = await admin.query(api.documents.listFields, {
      documentId,
      attemptId,
      jobId: "current-job",
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(first.page).toHaveLength(100);
    const second = await admin.query(api.documents.listFields, {
      documentId,
      attemptId,
      jobId: "current-job",
      paginationOpts: { numItems: 100, cursor: first.continueCursor },
    });
    expect(second.page).toHaveLength(100);
    const third = await admin.query(api.documents.listFields, {
      documentId,
      attemptId,
      jobId: "current-job",
      paginationOpts: { numItems: 100, cursor: second.continueCursor },
    });
    expect(third.page).toHaveLength(33);
    expect(third.isDone).toBe(true);
    expect(
      new Set([...first.page, ...second.page, ...third.page].map((f) => f._id))
        .size,
    ).toBe(233);
    await admin.mutation(api.review.approveHighConfidence, { documentId });
    await expect(
      admin.mutation(api.review.completeReview, { documentId }),
    ).rejects.toThrow(/2 fields/);
    await admin.mutation(api.review.approveField, { fieldId: initial[2]._id });
    await expect(
      admin.mutation(api.review.completeReview, { documentId }),
    ).rejects.toThrow(/1 field/);
    await admin.mutation(api.review.rejectField, {
      fieldId: third.page[32]._id,
    });
    await admin.mutation(api.review.completeReview, { documentId });
    await admin.mutation(api.documents.reprocess, { documentId });
    expect((await read())!.fields).toEqual([]);
    await expect(
      admin.mutation(api.review.approveField, { fieldId: initial[0]._id }),
    ).rejects.toThrow(/obsolete/);
    await t.mutation(internal.processing.claim, {
      documentId,
      submissionJobId: "next-job",
    });
    await expect(
      admin.query(api.documents.listFields, {
        documentId,
        attemptId,
        jobId: "current-job",
        paginationOpts: { numItems: 100, cursor: first.continueCursor },
      }),
    ).rejects.toThrow(/Processing changed/);
  });

  test("two completed attempts preserve earlier approvals and exclude them from current review", async () => {
    const { t, admin, documentId, read, finish } = await setup();
    await finish(LEASE_FIELDS.map((f) => ({ ...f, confidence: 0.99 })));
    await admin.mutation(api.review.approveHighConfidence, { documentId });
    await admin.mutation(api.review.completeReview, { documentId });
    const earlier = (await read())!.fields;
    await admin.mutation(api.documents.reprocess, { documentId });
    const attemptId = await finish(LEASE_FIELDS, "lease", "second-job");
    expect(
      (await read())!.fields.every(
        (f) => f.attemptId === attemptId && f.windmillJobId === "second-job",
      ),
    ).toBe(true);
    expect((await admin.query(api.review.queue, {}))[0]).toMatchObject({
      pendingFields: 3,
      lowConfidenceFields: 1,
    });
    await expect(
      admin.mutation(api.review.approveField, { fieldId: earlier[0]._id }),
    ).rejects.toThrow(/obsolete/);
    expect(await t.run((ctx) => ctx.db.get(earlier[0]._id))).toEqual(
      earlier[0],
    );
  });

  test("oversized current catalogues fail bulk operations explicitly but support paged individual decisions", async () => {
    const { t, admin, documentId, read, finish } = await setup();
    const attemptId = await finish(LEASE_FIELDS);
    const first = (await read())!.fields[0];
    await t.run(async (ctx) => {
      for (let i = 0; i < 998; i++)
        await ctx.db.insert("extractedFields", {
          tenantId: first.tenantId,
          documentId,
          attemptId,
          key: `large-${i}`,
          label: "Large catalogue",
          value: "test",
          kind: "text",
          confidence: 0.99,
          state: "detected",
          windmillJobId: "current-job",
          createdAt: Date.now(),
        });
    });
    await expect(read()).rejects.toThrow(/not been truncated/);
    await expect(
      admin.mutation(api.review.approveHighConfidence, { documentId }),
    ).rejects.toThrow(/not been truncated/);
    await expect(
      admin.mutation(api.review.completeReview, { documentId }),
    ).rejects.toThrow(/not been truncated/);
    const page = await admin.query(api.documents.listFields, {
      documentId,
      attemptId,
      jobId: "current-job",
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(page.page).toHaveLength(100);
    await admin.mutation(api.review.approveField, { fieldId: first._id });
    expect((await t.run((ctx) => ctx.db.get(first._id)))!.state).toBe(
      "approved",
    );
  });

  test.each(["deletedAt", "replacedByDocumentId"] as const)(
    "%s documents reject field decisions and bulk publication",
    async (flag) => {
      const { t, admin, documentId, read, finish } = await setup();
      await finish(LEASE_FIELDS);
      const fieldId = (await read())!.fields[0]._id;
      await t.run((ctx) =>
        ctx.db.patch(
          documentId,
          flag === "deletedAt"
            ? { deletedAt: Date.now() }
            : { replacedByDocumentId: documentId },
        ),
      );
      await expect(
        admin.mutation(api.review.approveField, { fieldId }),
      ).rejects.toThrow(/obsolete/);
      await expect(
        admin.mutation(api.review.rejectField, { fieldId }),
      ).rejects.toThrow(/obsolete/);
      for (const fn of [
        api.review.approveHighConfidence,
        api.review.completeReview,
        api.review.applyToLease,
      ])
        await expect(admin.mutation(fn, { documentId })).rejects.toThrow(
          /Document not found/,
        );
    },
  );

  test("tagged current results do not mix with untagged rows, and field pagination enforces tenancy", async () => {
    const { t, admin, clientUser, documentId, read, field, finish } =
      await setup();
    const attemptId = await finish(LEASE_FIELDS);
    const oldId = await field("monthly_rental", "999999", {
      state: "approved",
    });
    expect((await read())!.fields).toHaveLength(3);
    await expect(
      admin.mutation(api.review.approveField, { fieldId: oldId }),
    ).rejects.toThrow(/obsolete/);
    const outsiderId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "outsider@test.com" }),
    );
    const outsider = t.withIdentity({ subject: `${outsiderId}|session` });
    await expect(
      outsider.query(api.documents.listFields, {
        documentId,
        attemptId,
        jobId: "current-job",
        paginationOpts: { numItems: 100, cursor: null },
      }),
    ).rejects.toThrow();
    expect(
      (
        await clientUser.query(api.documents.listFields, {
          documentId,
          attemptId,
          jobId: "current-job",
          paginationOpts: { numItems: 100, cursor: null },
        })
      ).page,
    ).toHaveLength(3);
    await expect(
      clientUser.mutation(api.review.approveField, {
        fieldId: (await read())!.fields[0]._id,
      }),
    ).rejects.toThrow(/staff/);
  });
});
