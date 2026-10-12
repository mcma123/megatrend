/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ADMIN = "stages@cyphersoft.test";
const JOB = "11111111-1111-4111-8111-111111111111";
const SOURCE = "stage-test/doc/source/parse.json";

function output(attemptId: Id<"processingAttempts">) {
  return {
    contract_version: 1,
    attempt_id: attemptId,
    docling_status: "success",
    parsed_json_key: SOURCE,
    parsed_json_bucket: "parsedinjson",
    okf_bundle_root: "old/bundle",
    stages: {
      parse: { status: "succeeded" },
      knowledge: { status: "succeeded" },
      extract: { status: "succeeded" },
    },
    completeness: { complete: true },
    extraction: {
      document_type: "lease",
      type_confidence: 0.99,
      missing_fields: [],
      fields: [
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

async function setup() {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) => ctx.db.insert("users", { email: ADMIN }));
  const admin = t.withIdentity({ subject: `${id}|session` });
  const client = await admin.mutation(api.clients.create, {
    name: "Stage test",
    slug: "stage-test",
    primaryContactName: "Client",
    primaryContactEmail: "client@stages.test",
    inviteContactAsAdmin: true,
  });
  const clientId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "client@stages.test" }),
  );
  const clientUser = t.withIdentity({ subject: `${clientId}|session` });
  await clientUser.mutation(api.users.syncCurrentUser, {});
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["%PDF"], { type: "application/pdf" })),
  );
  const { documentId: doc } = await admin.mutation(api.documents.create, {
    tenantId: client.tenantId,
    storageId,
    filename: "lease.pdf",
    source: "upload",
  });
  const documentId = doc!;
  const read = () => admin.query(api.documents.get, { documentId });
  const attemptId = (await t.mutation(internal.processing.claim, {
    documentId,
    submissionJobId: JOB,
  }))!;
  await t.mutation(internal.processing.beginSubmission, {
    documentId,
    attemptId,
  });
  await t.mutation(internal.processing.markQueued, {
    documentId,
    attemptId,
    jobId: JOB,
  });
  const apply = (result: unknown) =>
    t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId,
      jobId: JOB,
      result,
    });
  const retry = (stage: "parse" | "knowledge" | "extract") =>
    admin.mutation(api.processing.retryStage, { documentId, attemptId, stage });
  const submitRetry = async (id: Id<"processingAttempts">) => {
    const record = (await t.run((ctx) => ctx.db.get(id)))!;
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(record.submissionJobId));
    vi.stubGlobal("fetch", fetcher);
    await t.action(internal.processing.start, { documentId, attemptId: id });
    const inputs = JSON.parse(fetcher.mock.calls[0][1].body);
    return { jobId: record.submissionJobId, inputs };
  };
  return {
    t,
    admin,
    clientUser,
    documentId,
    attemptId,
    read,
    apply,
    retry,
    submitRetry,
  };
}

describe("stage outcomes and recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", ADMIN);
    vi.stubEnv("WINDMILL_BASE_URL", "http://windmill.test");
    vi.stubEnv("WINDMILL_WORKSPACE", "test");
    vi.stubEnv("WINDMILL_PROCESSING_TOKEN", "test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  test("knowledge-only recovery preserves approval, current extraction, timestamps and field decisions", async () => {
    const { t, admin, documentId, attemptId, read, apply, retry, submitRetry } =
      await setup();
    const result = output(attemptId);
    result.stages.knowledge = { status: "failed" };
    await apply({
      ...result,
      okf_bundle_root: null,
      okf_error: "503 storage unavailable",
    });
    expect((await read())!.processingIncomplete).toBe(false);
    expect((await read())!.processingStages?.knowledge).toMatchObject({
      status: "failed",
      retryable: true,
      errorKind: "transport",
    });
    await admin.mutation(api.review.approveHighConfidence, { documentId });
    await admin.mutation(api.review.completeReview, { documentId });
    const before = (await read())!;
    const { attemptId: recoveryId } = await retry("knowledge");
    expect((await read())!.activeAttemptId).toBe(attemptId);
    await expect(
      admin.mutation(api.documents.reprocess, { documentId }),
    ).rejects.toThrow(/still active/);
    const { jobId, inputs } = await submitRetry(recoveryId);
    expect(inputs).toMatchObject({
      retry_stage: "knowledge",
      parsed_json_key: SOURCE,
      attempt_id: recoveryId,
    });
    await t.mutation(internal.processing.updateStageProgress, {
      documentId,
      attemptId: recoveryId,
      jobId,
      modules: [
        { id: "parse", type: "Success" },
        { id: "okf", type: "InProgress" },
        { id: "extract", type: "Success" },
      ],
    });
    await t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId: recoveryId,
      jobId,
      result: {
        ...output(recoveryId),
        okf_bundle_root: "recovery/bundle",
        extraction: {},
      },
    });
    const after = (await read())!;
    expect(after).toMatchObject({
      status: "approved",
      activeAttemptId: attemptId,
      windmillJobId: JOB,
      processedAt: before.processedAt,
      reviewedAt: before.reviewedAt,
      okfBundleRoot: "recovery/bundle",
    });
    expect(after.fields).toEqual(before.fields);
    expect(after.processingStages?.extract).toEqual(
      before.processingStages?.extract,
    );
    expect(after.processingStages?.knowledge?.status).toBe("succeeded");
    await t.mutation(internal.processing.markFailed, {
      documentId,
      attemptId: recoveryId,
      jobId,
      message: "Late failure",
    });
    expect((await read())!.processingStages?.knowledge?.status).toBe(
      "succeeded",
    );
  });

  test("knowledge retry is atomic, staff-only, and requires the current source attempt", async () => {
    const { t, admin, clientUser, documentId, attemptId, apply, retry } =
      await setup();
    await apply({
      ...output(attemptId),
      okf_bundle_root: null,
      stages: {
        ...output(attemptId).stages,
        knowledge: { status: "failed", error: "503" },
      },
    });
    await expect(
      clientUser.mutation(api.processing.retryStage, {
        documentId,
        attemptId,
        stage: "knowledge",
      }),
    ).rejects.toThrow(/staff/);
    await expect(
      admin.mutation(api.processing.retryStage, {
        documentId,
        stage: "knowledge",
      }),
    ).rejects.toThrow(/Processing changed/);
    const results = await Promise.allSettled([
      retry("knowledge"),
      retry("knowledge"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("processingAttempts").take(10)),
    ).toHaveLength(2);
  });

  test("extraction retry reuses parsing and knowledge, invalidating only field decisions", async () => {
    const { t, admin, documentId, attemptId, read, apply, retry, submitRetry } =
      await setup();
    await apply({
      ...output(attemptId),
      completeness: { complete: false },
      extraction: { ...output(attemptId).extraction, truncated: true },
      stages: {
        ...output(attemptId).stages,
        extract: { status: "partial", error: "truncated source" },
      },
    });
    await admin.mutation(api.review.approveHighConfidence, { documentId });
    const before = (await read())!;
    const { attemptId: next } = await retry("extract");
    expect((await read())!.fields).toEqual([]);
    const { inputs, jobId } = await submitRetry(next);
    expect(inputs).toMatchObject({
      retry_stage: "extract",
      parsed_json_key: SOURCE,
      reused_knowledge: { bundle_root: "old/bundle", status: "succeeded" },
    });
    await t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId: next,
      jobId,
      result: {
        ...output(next),
        okf_bundle_root: null,
        stages: { ...output(next).stages, knowledge: { status: "skipped" } },
      },
    });
    const after = (await read())!;
    expect(after.processingStages?.parse).toMatchObject({
      reused: true,
      sourceAttemptId: attemptId,
    });
    expect(after.processingStages?.knowledge).toMatchObject({
      status: "succeeded",
      reused: true,
      artifactKey: "old/bundle",
    });
    expect(after.fields[0]).toMatchObject({
      attemptId: next,
      state: "detected",
    });
    expect(await t.run((ctx) => ctx.db.get(before.fields[0]._id))).toEqual(
      before.fields[0],
    );
    await expect(
      admin.mutation(api.review.approveField, {
        fieldId: before.fields[0]._id,
      }),
    ).rejects.toThrow(/obsolete/);
  });

  test("confirmed parse failure records skipped downstream stages and retries from the original", async () => {
    const { t, documentId, attemptId, read, retry, submitRetry } =
      await setup();
    await t.mutation(internal.processing.markFailed, {
      documentId,
      attemptId,
      jobId: JOB,
      message: "503 Docling unavailable",
      stage: "parse",
    });
    expect((await read())!.processingStages).toMatchObject({
      parse: { status: "failed", retryable: true },
      knowledge: { status: "skipped" },
      extract: { status: "skipped" },
    });
    const { attemptId: next } = await retry("parse");
    const { inputs, jobId } = await submitRetry(next);
    expect(inputs).toMatchObject({
      retry_stage: "parse",
      parsed_json_key: null,
      do_ocr: true,
    });
    expect(inputs.file_url).toBeTruthy();
    await t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId: next,
      jobId,
      result: output(next),
    });
    expect((await read())!.status).toBe("extraction_complete");
    expect((await read())!.fields[0].state).toBe("detected");
  });

  test("partial parsing and malformed extraction remain incomplete; input failures require correction", async () => {
    const { admin, documentId, attemptId, read, apply, retry } = await setup();
    await apply({
      ...output(attemptId),
      docling_status: "partial_success",
      completeness: { complete: false },
      extraction: { document_type: "lease", fields: [null] },
      stages: {
        parse: { status: "partial" },
        knowledge: {
          status: "failed",
          error: "403 invalid credential https://private/?token=sensitive",
        },
        extract: { status: "failed", error: "malformed model response" },
      },
    });
    expect((await read())!).toMatchObject({
      status: "processing_failed",
      processingIncomplete: true,
      fields: [],
    });
    expect((await read())!.processingStages?.extract).toMatchObject({
      status: "failed",
      errorKind: "invalid_input",
      retryable: false,
    });
    expect((await read())!.processingStages?.knowledge?.error).not.toContain(
      "sensitive",
    );
    await expect(retry("extract")).rejects.toThrow(/Correct the source/);
    await expect(
      admin.mutation(api.review.completeReview, { documentId }),
    ).rejects.toThrow(/not ready/);
  });

  test("a rate-limited extraction reports failure and can recover from its retained source", async () => {
    const { t, documentId, attemptId, read, apply, retry, submitRetry } =
      await setup();
    await apply({
      ...output(attemptId),
      completeness: { complete: false },
      extraction: {},
      stages: {
        ...output(attemptId).stages,
        extract: {
          status: "failed",
          error: "429 rate limit",
          error_kind: "rate_limit",
          retryable: true,
        },
      },
    });
    expect((await read())!).toMatchObject({
      status: "processing_failed",
      parsedJsonKey: SOURCE,
    });
    const { attemptId: next } = await retry("extract");
    const { jobId } = await submitRetry(next);
    await t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId: next,
      jobId,
      result: output(next),
    });
    expect((await read())!).toMatchObject({
      status: "extraction_complete",
      processingIncomplete: false,
    });
  });

  test("missing configuration keeps uploaded originals readable with actionable client guidance", async () => {
    const { t, admin, clientUser, read } = await setup();
    const tenantId = (await read())!.tenantId;
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["%PDF"], { type: "application/pdf" })),
    );
    const { documentId } = await admin.mutation(api.documents.create, {
      tenantId,
      storageId,
      filename: "unconfigured.pdf",
      source: "upload",
    });
    vi.stubEnv("WINDMILL_PROCESSING_TOKEN", "");
    await t.action(internal.processing.start, { documentId: documentId! });
    const doc = (await clientUser.query(api.documents.get, {
      documentId: documentId!,
    }))!;
    expect(doc.status).toBe("uploaded");
    expect(doc.fileUrl).toBeTruthy();
    expect(doc.statusMessage).toContain("contact your team");
    expect(JSON.stringify(doc)).not.toContain("WINDMILL");
  });

  test("clients receive safe stage guidance without technical errors or artifact paths", async () => {
    const { admin, clientUser, documentId, attemptId, apply, read } =
      await setup();
    await apply({
      ...output(attemptId),
      okf_bundle_root: null,
      stages: {
        ...output(attemptId).stages,
        knowledge: {
          status: "failed",
          error: "Internal server 503 storage-host /private/key",
        },
      },
    });
    const staff = (await read())!;
    expect(
      staff.stageSummary.find((s) => s.name === "knowledge")?.error,
    ).toContain("storage-host");
    for (const view of [
      await clientUser.query(api.documents.get, { documentId }),
      (
        await clientUser.query(api.documents.list, { tenantId: staff.tenantId })
      )[0],
    ]) {
      expect(JSON.stringify(view)).not.toContain("storage-host");
      expect(view?.parsedJsonKey).toBeUndefined();
      expect(view?.processingStages).toBeUndefined();
      expect(
        view?.stageSummary.find((s) => s.name === "knowledge")?.message,
      ).toContain("search is temporarily unavailable");
      expect(view?.stageSummary.every((s) => !s.canRetry)).toBe(true);
    }
    expect(
      (await admin.query(api.documents.get, { documentId }))
        ?.processingIncomplete,
    ).toBe(false);
  });

  test("timeout retains ownership, blocks duplicate retry, and reconciles remote completion", async () => {
    const { t, admin, documentId, attemptId, read } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network unavailable")),
    );
    await t.action(internal.processing.poll, {
      documentId,
      attemptId,
      jobId: JOB,
      attempt: 90,
    });
    expect((await read())!).toMatchObject({
      status: "processing_failed",
      processingHeld: true,
      canRetryProcessing: false,
    });
    expect(await t.run((ctx) => ctx.db.get(attemptId))).toMatchObject({
      state: "running",
      timedOut: true,
    });
    await expect(
      admin.mutation(api.documents.reprocess, { documentId }),
    ).rejects.toThrow(/still active/);
    await expect(
      admin.mutation(api.processing.retryStage, {
        documentId,
        attemptId,
        stage: "parse",
      }),
    ).rejects.toThrow(/still active/);
    await admin.mutation(api.processing.reconcile, { documentId, attemptId });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "CompletedJob",
            success: true,
            result: output(attemptId),
          }),
        ),
      ),
    );
    await t.action(internal.processing.poll, {
      documentId,
      attemptId,
      jobId: JOB,
      attempt: 91,
    });
    expect((await read())!).toMatchObject({
      status: "extraction_complete",
      processingHeld: false,
    });
    await t.mutation(internal.processing.markFailed, {
      documentId,
      attemptId,
      jobId: JOB,
      message: "Late timeout",
    });
    expect((await read())!.status).toBe("extraction_complete");
  });

  test.each([true, false])(
    "legacy jobs remain held until remote success/failure is reconciled (success: %s)",
    async (success) => {
      const { t, admin, read, attemptId } = await setup();
      const tenantId = (await read())!.tenantId;
      const storageId = await t.run((ctx) =>
        ctx.storage.store(new Blob(["%PDF"], { type: "application/pdf" })),
      );
      const { documentId: doc } = await admin.mutation(api.documents.create, {
        tenantId,
        storageId,
        filename: "legacy.pdf",
        source: "upload",
      });
      const documentId = doc!;
      await t.mutation(internal.processing.markQueued, {
        documentId,
        jobId: "legacy-job",
      });
      await t.mutation(internal.processing.markTimedOut, {
        documentId,
        jobId: "legacy-job",
      });
      expect(
        (await admin.query(api.documents.get, { documentId }))!,
      ).toMatchObject({
        processingHeld: true,
        processingRemoteUnresolved: true,
      });
      await expect(
        admin.mutation(api.documents.reprocess, { documentId }),
      ).rejects.toThrow(/unresolved/);
      await admin.mutation(api.processing.reconcile, { documentId });
      await t.mutation(internal.processing.applyResult, {
        documentId,
        jobId: "legacy-job",
        result: success
          ? { extraction: output(attemptId).extraction }
          : {
              contract_version: 1,
              docling_status: "success",
              stages: {
                parse: { status: "succeeded" },
                knowledge: { status: "succeeded" },
                extract: { status: "failed", error: "429 rate limit" },
              },
              extraction: {},
            },
      });
      expect(
        (await admin.query(api.documents.get, { documentId }))!,
      ).toMatchObject({
        status: success ? "extraction_complete" : "processing_failed",
        processingHeld: false,
        processingRemoteUnresolved: false,
      });
    },
  );

  test("failed knowledge recovery preserves publication and a failed stage; old completions cannot repair a newer retry", async () => {
    const { t, admin, documentId, attemptId, read, apply, retry, submitRetry } =
      await setup();
    await apply({
      ...output(attemptId),
      okf_bundle_root: null,
      stages: {
        ...output(attemptId).stages,
        knowledge: { status: "failed", error: "503" },
      },
    });
    await admin.mutation(api.review.approveHighConfidence, { documentId });
    await admin.mutation(api.review.completeReview, { documentId });
    const { attemptId: recovery } = await retry("knowledge");
    const { jobId } = await submitRetry(recovery);
    await t.mutation(internal.processing.markFailed, {
      documentId,
      attemptId: recovery,
      jobId,
      message: "503 storage unavailable",
    });
    expect((await read())!).toMatchObject({
      status: "approved",
      processingStages: { knowledge: { status: "failed" } },
    });
    const { attemptId: latest } = await retry("knowledge");
    await t.mutation(internal.processing.applyResult, {
      documentId,
      attemptId: recovery,
      jobId,
      result: output(recovery),
    });
    expect((await read())!).toMatchObject({
      activeRecoveryAttemptId: latest,
      processingStages: { knowledge: { status: "pending" } },
    });
  });
});
