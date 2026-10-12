/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ADMIN_EMAIL = "admin@cyphersoft.test";

const LEASE_RESULT = {
  parsed_json_key: "acme/doc/lease.json",
  okf_bundle_root: "acme/doc/lease",
  extraction: {
    document_type: "lease",
    type_confidence: 0.98,
    summary: "Lease for Linbro DC.",
    missing_fields: [],
    fields: [
      {
        key: "lease_start_date",
        label: "Lease start date",
        kind: "date",
        value: "2024-03-01",
        confidence: 0.99,
      },
      {
        key: "lease_end_date",
        label: "Lease end date",
        kind: "date",
        value: "2029-02-28",
        confidence: 0.99,
      },
      {
        key: "monthly_rental",
        label: "Monthly rental (ZAR)",
        kind: "number",
        value: "845000",
        confidence: 0.6,
      },
      {
        key: "escalation_percent",
        label: "Annual escalation (%)",
        kind: "number",
        value: "7.5",
        confidence: 0.97,
      },
      {
        key: "lettable_area_sqm",
        label: "Lettable area (m²)",
        kind: "number",
        value: "8450",
        confidence: 0.98,
      },
    ],
  },
};

async function setup() {
  process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  const t = convexTest(schema, modules);
  const asUser = (userId: string) =>
    t.withIdentity({ subject: `${userId}|session` });
  const adminId = await t.run((ctx) =>
    ctx.db.insert("users", { email: ADMIN_EMAIL, name: "Admin" }),
  );
  const admin = asUser(adminId);
  const acme = await admin.mutation(api.clients.create, {
    name: "Acme",
    slug: "acme",
    primaryContactName: "Ann",
    primaryContactEmail: "ann@acme.test",
    inviteContactAsAdmin: true,
  });
  const annId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "ann@acme.test", name: "Ann" }),
  );
  const ann = asUser(annId);
  await ann.mutation(api.users.syncCurrentUser, {});
  const { propertyId } = await admin.mutation(api.properties.create, {
    tenantId: acme.tenantId,
    name: "Linbro DC",
    addressLine: "14 Modderfontein Rd",
    city: "Johannesburg",
    propertyType: "logistics",
    status: "active",
    features: [],
  });

  async function processedLease(result: unknown = LEASE_RESULT) {
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["%PDF"], { type: "application/pdf" })),
    );
    const created = await ann.mutation(api.documents.create, {
      tenantId: acme.tenantId,
      storageId,
      filename: "lease.pdf",
      propertyId,
      source: "upload",
    });
    const documentId = created.documentId!;
    await t.mutation(internal.processing.markQueued, {
      documentId,
      jobId: "job-1",
    });
    await t.mutation(internal.processing.applyResult, {
      documentId,
      jobId: "job-1",
      result,
    });
    return documentId;
  }

  return { t, admin, ann, adminId, annId, acme, propertyId, processedLease };
}

describe("review and publishing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  });
  afterEach(() => vi.useRealTimers());

  test("low-confidence fields block completion until a person decides; approved values update the lease", async () => {
    const { t, admin, ann, propertyId, processedLease } = await setup();
    const documentId = await processedLease();

    const queue = await admin.query(api.review.queue, {});
    expect(queue[0]).toMatchObject({
      kind: "document",
      id: documentId,
      lowConfidenceFields: 1,
    });

    // Staff get a review task and a notification; the client does not see the internal task.
    const staffActions = await admin.query(api.actions.list, {});
    expect(
      staffActions.some((action) =>
        action.title.startsWith("Review extracted fields"),
      ),
    ).toBe(true);
    expect(
      (
        await ann.query(api.actions.list, {
          tenantId: staffActions[0].tenantId,
        })
      ).length,
    ).toBe(0);

    await admin.mutation(api.review.approveHighConfidence, { documentId });
    await expect(
      admin.mutation(api.review.completeReview, { documentId }),
    ).rejects.toThrow(/1 field still needs/);

    // The low-confidence rental is NOT applied while undecided.
    const created = await admin
      .mutation(api.review.applyToLease, { documentId })
      .catch((error: Error) => error);
    expect(String(created)).toMatch(
      /approve the start date, end date and monthly rental/,
    );

    const detail = await admin.query(api.documents.get, { documentId });
    const rental = detail!.fields.find(
      (field) => field.key === "monthly_rental",
    )!;
    await admin.mutation(api.review.approveField, {
      fieldId: rental._id,
      value: "850 000",
    });
    await admin.mutation(api.review.completeReview, { documentId });

    const { leaseId } = await admin.mutation(api.review.applyToLease, {
      documentId,
    });
    const lease = await admin.query(api.leases.get, { leaseId });
    expect(lease).toMatchObject({
      startDate: "2024-03-01",
      endDate: "2029-02-28",
      monthlyRental: 850000,
      escalationPercent: 7.5,
      sourceDocumentId: documentId,
    });
    const property = await admin.query(api.properties.get, { propertyId });
    expect(property?.sizeSqm).toBe(8450);

    const reviewed = await admin.query(api.documents.get, { documentId });
    expect(reviewed?.status).toBe("approved");
    expect(
      reviewed?.fields.find((field) => field.key === "monthly_rental")
        ?.originalValue,
    ).toBe("845000");

    // Review task closed; client notified of the review and the lease update.
    const after = await admin.query(api.actions.list, {});
    expect(
      after.find((action) => action.title.startsWith("Review extracted fields"))
        ?.status,
    ).toBe("completed");
    const annInbox = await ann.query(api.notifications.mine, {});
    expect(annInbox.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["document.approved", "lease.updated"]),
    );
    void t;
  });

  test("missing details create one client action, even after re-processing", async () => {
    const { t, admin, ann, acme, processedLease } = await setup();
    const result = {
      ...LEASE_RESULT,
      extraction: {
        ...LEASE_RESULT.extraction,
        missing_fields: ["monthly_rental"],
      },
    };
    const documentId = await processedLease(result);
    await admin.mutation(api.documents.reprocess, { documentId });
    const attemptId = (await t.mutation(internal.processing.claim, {
      documentId,
      submissionJobId: "job-2",
    }))!;
    await t.mutation(internal.processing.beginSubmission, {
      documentId,
      attemptId,
    });
    await t.mutation(internal.processing.markQueued, {
      documentId,
      attemptId,
      jobId: "job-2",
    });
    await t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId,
      jobId: "job-2",
      result,
    });
    expect(
      (await admin.query(api.documents.get, { documentId }))
        ?.processingAttempts,
    ).toBe(2);
    expect((await admin.query(api.documents.get, { documentId }))?.status).toBe(
      "review_required",
    );

    const clientActions = await ann.query(api.actions.list, {
      tenantId: acme.tenantId,
    });
    expect(clientActions).toHaveLength(1);
    expect(clientActions[0]).toMatchObject({
      status: "waiting_on_client",
      visibleToClient: true,
      source: "document_flag",
    });
  });

  test("insights reach clients only when published with evidence", async () => {
    const { admin, ann, acme, processedLease } = await setup();
    const documentId = await processedLease();
    const { insightId } = await admin.mutation(api.insights.create, {
      tenantId: acme.tenantId,
      draftedBy: "staff",
      title: "Renewal window opens soon",
      body: "Start renewal talks.",
      category: "renewal",
      priority: "high",
      documentIds: [],
    });
    expect(
      await ann.query(api.insights.list, { tenantId: acme.tenantId }),
    ).toEqual([]);
    expect(await ann.query(api.insights.get, { insightId })).toBeNull();

    await expect(
      admin.mutation(api.insights.setStatus, {
        insightId,
        status: "published",
      }),
    ).rejects.toThrow(/evidence/);
    await admin.mutation(api.insights.update, {
      insightId,
      title: "Renewal window opens soon",
      body: "Start renewal talks.",
      category: "renewal",
      priority: "high",
      documentIds: [documentId],
    });
    await admin.mutation(api.insights.setStatus, {
      insightId,
      status: "under_review",
    });
    await admin.mutation(api.insights.setStatus, {
      insightId,
      status: "published",
    });

    const visible = await ann.query(api.insights.list, {
      tenantId: acme.tenantId,
    });
    expect(visible).toHaveLength(1);
    expect(visible[0].documents[0].filename).toBe("lease.pdf");
    const annInbox = await ann.query(api.notifications.mine, {});
    expect(
      annInbox.items.some((item) => item.kind === "insight.published"),
    ).toBe(true);

    await expect(
      admin.mutation(api.insights.update, {
        insightId,
        title: "x",
        body: "y",
        category: "renewal",
        priority: "low",
        documentIds: [documentId],
      }),
    ).rejects.toThrow(/Withdraw/);
  });
});

describe("actions and notifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  });
  afterEach(() => vi.useRealTimers());

  test("client request reaches staff; replies notify the other side; internal tasks stay hidden", async () => {
    const { admin, ann, acme } = await setup();

    const { actionId } = await ann.mutation(api.actions.create, {
      tenantId: acme.tenantId,
      title: "Quote for new warehouse",
      description: "Need options in Midrand",
      visibleToClient: false, // ignored for clients
    });
    const staffInbox = await admin.query(api.notifications.mine, {});
    expect(staffInbox.items[0]).toMatchObject({
      kind: "action.client_request",
      link: "/tasks",
    });

    await admin.mutation(api.actions.create, {
      tenantId: acme.tenantId,
      title: "Internal: check landlord terms",
      visibleToClient: false,
    });
    const clientView = await ann.query(api.actions.list, {
      tenantId: acme.tenantId,
    });
    expect(clientView.map((action) => action.title)).toEqual([
      "Quote for new warehouse",
    ]);

    await admin.mutation(api.actions.setStatus, {
      actionId,
      status: "waiting_on_client",
    });
    await admin.mutation(api.actions.addComment, {
      actionId,
      body: "Which size do you need?",
    });
    await admin.mutation(api.actions.addComment, {
      actionId,
      body: "internal note",
      internal: true,
    });
    let annInbox = await ann.query(api.notifications.mine, {});
    expect(annInbox.items.some((item) => item.kind === "action.reply")).toBe(
      true,
    );

    const annDetail = await ann.query(api.actions.get, { actionId });
    expect(annDetail?.comments.map((comment) => comment.body)).toEqual([
      "Which size do you need?",
    ]);

    await ann.mutation(api.actions.addComment, {
      actionId,
      body: "About 5 000 m²",
    });
    expect((await admin.query(api.actions.get, { actionId }))?.status).toBe(
      "waiting_on_cyphersoft",
    );

    await expect(
      ann.mutation(api.actions.setStatus, { actionId, status: "in_progress" }),
    ).rejects.toThrow(/complete/);
    await ann.mutation(api.actions.setStatus, {
      actionId,
      status: "completed",
    });

    await ann.mutation(api.notifications.markAllRead, {});
    annInbox = await ann.query(api.notifications.mine, {});
    expect(annInbox.unread).toBe(0);
  });
});
