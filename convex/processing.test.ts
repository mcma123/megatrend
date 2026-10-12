/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const ADMIN = "processor@cyphersoft.test";
const JOB = "11111111-1111-4111-8111-111111111111";

async function setup() {
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) =>
    ctx.db.insert("users", { email: ADMIN }),
  );
  const admin = t.withIdentity({ subject: `${adminId}|session` });
  const client = await admin.mutation(api.clients.create, {
    name: "Processing test",
    slug: "processing-test",
    primaryContactName: "Test",
    primaryContactEmail: "client@processing.test",
    inviteContactAsAdmin: true,
  });
  const clientUserId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "client@processing.test" }),
  );
  const clientUser = t.withIdentity({ subject: `${clientUserId}|session` });
  await clientUser.mutation(api.users.syncCurrentUser, {});
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["%PDF-1.4 test"], { type: "application/pdf" })),
  );
  const result = await admin.mutation(api.documents.create, {
    tenantId: client.tenantId,
    storageId,
    filename: "lease.pdf",
    source: "upload",
  });
  const documentId = result.documentId!;
  const read = () => admin.query(api.documents.get, { documentId });
  const claim = async (jobId = JOB) => {
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
    return attemptId;
  };
  return { t, admin, clientUser, client, documentId, read, claim };
}

function completeResult(attemptId: Id<"processingAttempts">) {
  return {
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
      document_type: "lease",
      type_confidence: 0.99,
      truncated: false,
      missing_fields: [],
      fields: [
        {
          key: "lease_start_date",
          value: "2024-01-01",
          kind: "date",
          confidence: 0.99,
        },
        {
          key: "lease_end_date",
          value: "2029-01-01",
          kind: "date",
          confidence: 0.99,
        },
        {
          key: "monthly_rental",
          value: "10000",
          kind: "number",
          confidence: 0.99,
        },
      ],
    },
  };
}

describe("document processing ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", ADMIN);
    vi.stubEnv("WINDMILL_BASE_URL", "http://windmill.test");
    vi.stubEnv("WINDMILL_WORKSPACE", "test");
    vi.stubEnv("WINDMILL_PROCESSING_TOKEN", "test-token");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  test("concurrent starts submit exactly one job with a reserved ID and attempt identity", async () => {
    const { t, documentId, read } = await setup();
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe("POST");
        const id = new URL(String(url)).searchParams.get("job_id")!;
        return new Response(id, { status: 201 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([
      t.action(internal.processing.start, { documentId }),
      t.action(internal.processing.start, { documentId }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const document = (await read())!;
    const attempt = await t.run((ctx) => ctx.db.get(document.activeAttemptId!));
    expect(attempt?.state).toBe("running");
    expect(document.processingAttempts).toBe(1);
    expect(document.windmillJobId).toBe(attempt?.submissionJobId);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.attempt_id).toBe(document.activeAttemptId);
  });

  test("old attachment, failure, progress and success cannot modify a newer attempt", async () => {
    const { t, admin, documentId, read, claim } = await setup();
    const oldId = await claim();
    await t.mutation(internal.processing.markFailed, {
      documentId,
      attemptId: oldId,
      jobId: JOB,
      message: "Failed",
    });
    await admin.mutation(api.documents.reprocess, { documentId });
    // Even in the gap before a new claim, the failed attempt is terminal.
    await t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId: oldId,
      jobId: JOB,
      result: completeResult(oldId),
    });
    expect((await read())?.status).toBe("uploaded");
    const nextJob = "22222222-2222-4222-8222-222222222222";
    const nextId = await claim(nextJob);
    await t.mutation(internal.processing.markQueued, {
      documentId,
      attemptId: oldId,
      jobId: JOB,
    });
    await t.mutation(internal.processing.markOcrComplete, {
      documentId,
      attemptId: oldId,
      jobId: JOB,
    });
    await t.mutation(internal.processing.markFailed, {
      documentId,
      attemptId: oldId,
      message: "Late failure",
    });
    await t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId: oldId,
      jobId: JOB,
      result: completeResult(oldId),
    });
    expect(await read()).toMatchObject({
      activeAttemptId: nextId,
      windmillJobId: nextJob,
      status: "queued_for_ocr",
      fields: [],
    });
  });

  test("completion is idempotent and a late failure cannot undo staff review", async () => {
    const { t, admin, documentId, read, claim } = await setup();
    const attemptId = await claim();
    const args = {
      documentId,
      attemptId,
      jobId: JOB,
      result: completeResult(attemptId),
    };
    await t.mutation(internal.processing.applyResult, args);
    await admin.mutation(api.review.approveHighConfidence, { documentId });
    await admin.mutation(api.review.completeReview, { documentId });
    await t.mutation(internal.processing.applyResult, args);
    await t.mutation(internal.processing.markFailed, {
      documentId,
      attemptId,
      jobId: JOB,
      message: "Late",
    });
    expect((await read())?.status).toBe("approved");
    expect((await read())?.fields).toHaveLength(3);
    expect(
      (await read())?.fields.every((field) => field.state === "approved"),
    ).toBe(true);
  });

  test.each(["deletedAt", "replacedByDocumentId"] as const)(
    "updates to documents with %s are ignored",
    async (flag) => {
      const { t, documentId, claim } = await setup();
      const attemptId = await claim();
      await t.run((ctx) =>
        ctx.db.patch(
          documentId,
          flag === "deletedAt"
            ? { deletedAt: Date.now() }
            : { replacedByDocumentId: documentId },
        ),
      );
      await t.mutation(internal.processing.applyResult, {
        documentId,
        attemptId,
        jobId: JOB,
        result: completeResult(attemptId),
      });
      await t.mutation(internal.processing.markFailed, {
        documentId,
        attemptId,
        message: "Late",
      });
      expect(await t.run((ctx) => ctx.db.get(documentId))).toMatchObject({
        status: "queued_for_ocr",
      });
      expect(
        await t.run((ctx) => ctx.db.query("extractedFields").take(10)),
      ).toEqual([]);
    },
  );

  test("an abandoned claim can be retried but never resurrected", async () => {
    const { t, admin, documentId, read } = await setup();
    const attemptId = (await t.mutation(internal.processing.claim, {
      documentId,
      submissionJobId: JOB,
    }))!;
    vi.setSystemTime(Date.now() + 60_001);
    await t.mutation(internal.processing.abandonClaim, {
      documentId,
      attemptId,
    });
    expect((await read())?.status).toBe("processing_failed");
    expect(
      await t.mutation(internal.processing.beginSubmission, {
        documentId,
        attemptId,
      }),
    ).toBe(false);
    await admin.mutation(api.documents.reprocess, { documentId });
    expect(
      await t.mutation(internal.processing.claim, {
        documentId,
        submissionJobId: JOB,
      }),
    ).not.toBeNull();
  });

  test("ambiguous submission is quarantined and reconciles without resubmitting", async () => {
    const { t, admin, documentId, read } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Connection lost")),
    );
    await t.action(internal.processing.start, { documentId });
    const document = (await read())!;
    const attemptId = document.activeAttemptId!;
    const attempt = (await t.run((ctx) => ctx.db.get(attemptId)))!;
    expect(attempt.state).toBe("submission_unknown");
    await expect(
      admin.mutation(api.documents.reprocess, { documentId }),
    ).rejects.toThrow(/reconciliation/);
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        type: "CompletedJob",
        script_path: "f/docling/process_document_for_app",
        args: { attempt_id: attemptId },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await t.action(internal.processing.recoverSubmission, {
      documentId,
      attemptId,
      check: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      attempt.submissionJobId,
    );
    expect((await read())?.windmillJobId).toBe(attempt.submissionJobId);
    expect((await t.run((ctx) => ctx.db.get(attemptId)))?.state).toBe(
      "running",
    );
  });

  test("a confirmed authorization rejection permits a new attempt", async () => {
    const { t, admin, documentId, read } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Denied", { status: 403 })),
    );
    await t.action(internal.processing.start, { documentId });
    expect((await read())?.status).toBe("processing_failed");
    await admin.mutation(api.documents.reprocess, { documentId });
    expect((await read())?.status).toBe("uploaded");
  });

  test("404 during reconciliation does not release an ambiguous submission", async () => {
    const { t, admin, documentId, read } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Connection lost")),
    );
    await t.action(internal.processing.start, { documentId });
    const attemptId = (await read())!.activeAttemptId!;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Not found", { status: 404 })),
    );
    await t.action(internal.processing.recoverSubmission, {
      documentId,
      attemptId,
      check: 90,
    });
    await expect(
      admin.mutation(api.documents.reprocess, { documentId }),
    ).rejects.toThrow(/reconciliation/);
    expect((await read())?.statusMessage).toContain("Staff must reconcile");
  });

  test.each([
    "truncated",
    "partial_parse",
    "missing_sections",
    "invalid_shape",
  ])("%s forces review and explicit staff acknowledgement", async (failure) => {
    const { t, admin, clientUser, client, documentId, read, claim } =
      await setup();
    const attemptId = await claim();
    const result = completeResult(attemptId);
    if (failure === "truncated") result.extraction.truncated = true;
    if (failure === "partial_parse") result.stages.parse.status = "partial";
    const input =
      failure === "invalid_shape"
        ? { contract_version: 1, attempt_id: attemptId }
        : failure === "missing_sections"
          ? {
              ...result,
              completeness: {
                complete: true,
                total_sections: 3,
                completed_sections: 2,
              },
            }
          : result;
    await t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId,
      jobId: JOB,
      result: input,
    });
    expect(await read()).toMatchObject({
      processingIncomplete: true,
      status: "review_required",
    });
    await admin.mutation(api.review.approveHighConfidence, { documentId });
    const propertyId = await admin.mutation(api.properties.create, {
      tenantId: client.tenantId,
      name: "Warehouse",
      addressLine: "1 Test Street",
      propertyType: "warehouse",
      status: "active",
      city: "Sandton",
      province: "Gauteng",
      sizeSqm: 1000,
      features: [],
    });
    await admin.mutation(api.documents.updateDetails, {
      documentId,
      propertyId: propertyId.propertyId,
    });
    await expect(
      admin.mutation(api.review.completeReview, { documentId }),
    ).rejects.toThrow(/acknowledge/);
    await expect(
      admin.mutation(api.review.applyToLease, { documentId }),
    ).rejects.toThrow(/acknowledge/);
    await expect(
      clientUser.mutation(api.review.acknowledgeIncomplete, {
        documentId,
        attemptId,
        reason: "Checked the original source",
      }),
    ).rejects.toThrow(/staff/);
    await admin.mutation(api.review.acknowledgeIncomplete, {
      documentId,
      attemptId,
      reason: "Checked all source pages and recorded the missing coverage",
    });
    await admin.mutation(api.review.completeReview, { documentId });
    expect(await read()).toMatchObject({
      status: "approved",
      processingIncomplete: true,
    });
    expect((await read())?.statusMessage).toContain("incomplete");
    if (failure !== "invalid_shape") {
      const applied = await admin.mutation(api.review.applyToLease, {
        documentId,
      });
      expect(applied.created).toBe(true);
    }
    expect(await t.run((ctx) => ctx.db.query("auditEvents").take(50))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "document.incomplete_coverage_acknowledged",
        }),
      ]),
    );
    await admin.mutation(api.documents.reprocess, { documentId });
    const newId = await claim("33333333-3333-4333-8333-333333333333");
    expect((await read())?.incompleteAcknowledgedAt).toBeUndefined();
    await expect(
      admin.mutation(api.review.acknowledgeIncomplete, {
        documentId,
        attemptId,
        reason: "Old screen source check",
      }),
    ).rejects.toThrow(/Processing changed/);
    expect(newId).not.toBe(attemptId);
  });

  test("legacy results without the new contract still complete; stale legacy jobs are ignored", async () => {
    const { t, documentId, read } = await setup();
    await t.mutation(internal.processing.markQueued, {
      documentId,
      jobId: "legacy-job",
    });
    const result = completeResult("legacy" as Id<"processingAttempts">);
    await t.mutation(internal.processing.applyResult, {
      documentId,
      jobId: "legacy-job",
      result: { extraction: result.extraction },
    });
    expect((await read())?.status).toBe("extraction_complete");
    await t.mutation(internal.processing.markFailed, {
      documentId,
      jobId: "legacy-job",
      message: "Late failure",
    });
    expect((await read())?.status).toBe("extraction_complete");
  });

  test("legacy callbacks cannot claim or update an owned attempt", async () => {
    const { t, documentId, read, claim } = await setup();
    const attemptId = await claim();
    await t.mutation(internal.processing.markQueued, {
      documentId,
      jobId: JOB,
    });
    await t.mutation(internal.processing.markFailed, {
      documentId,
      jobId: JOB,
      message: "Old callback",
    });
    await t.mutation(internal.processing.applyResult, {
      documentId,
      jobId: JOB,
      result: completeResult(attemptId),
    });
    expect(await read()).toMatchObject({
      activeAttemptId: attemptId,
      status: "queued_for_ocr",
      fields: [],
    });
  });

  test("an old queue attachment cannot restart a legacy record after retry was requested", async () => {
    const { t, admin, documentId, read } = await setup();
    await t.mutation(internal.processing.markQueued, {
      documentId,
      jobId: "old-job",
    });
    await t.mutation(internal.processing.markFailed, {
      documentId,
      jobId: "old-job",
      message: "Failed",
    });
    await admin.mutation(api.documents.reprocess, { documentId });
    expect(
      await t.mutation(internal.processing.markQueued, {
        documentId,
        jobId: "late-old-job",
      }),
    ).toBe(false);
    expect((await read())?.status).toBe("uploaded");
  });

  test("a versioned result for another attempt cannot contribute extracted fields", async () => {
    const { t, documentId, read, claim } = await setup();
    const attemptId = await claim();
    await t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId,
      jobId: JOB,
      result: { ...completeResult(attemptId), attempt_id: "different-attempt" },
    });
    expect(await read()).toMatchObject({
      status: "review_required",
      processingIncomplete: true,
      fields: [],
    });
    expect((await read())?.processingWarnings?.join(" ")).toContain("identity");
  });

  test("new attempts can consume legacy output only with an incomplete-coverage warning", async () => {
    const { t, documentId, read, claim } = await setup();
    const attemptId = await claim();
    await t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId,
      jobId: JOB,
      result: { extraction: completeResult(attemptId).extraction },
    });
    expect(await read()).toMatchObject({
      status: "review_required",
      processingIncomplete: true,
    });
    expect((await read())?.fields).toHaveLength(3);
    expect((await read())?.processingWarnings?.join(" ")).toContain("Legacy");
  });
});
