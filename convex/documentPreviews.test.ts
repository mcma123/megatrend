/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { PREVIEW_BUDGET_MS, previewKind } from "./lib/documentPreview";

const modules = import.meta.glob("./**/*.ts");
async function setup() {
  vi.useFakeTimers();
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", "preview-admin@test.local");
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "preview-admin@test.local" }),
  );
  const admin = t.withIdentity({ subject: `${userId}|session` });
  const client = await admin.mutation(api.clients.create, {
    name: "Preview",
    slug: "preview",
    primaryContactName: "Ann",
    primaryContactEmail: "preview-client@test.local",
    inviteContactAsAdmin: true,
  });
  const clientId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "preview-client@test.local" }),
  );
  const member = t.withIdentity({ subject: `${clientId}|session` });
  await member.mutation(api.users.syncCurrentUser, {});
  const outsiderId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "outsider@test.local" }),
  );
  const outsider = t.withIdentity({ subject: `${outsiderId}|session` });
  const store = (text = "%PDF-1.4 preview", type = "application/pdf") =>
    t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob([text], { type }));
      // convex-test's storeBlob omits contentType; emulate the HTTP upload metadata.
      const db = ctx.db as unknown as {
        patch: (
          id: Id<"_storage">,
          fields: { contentType: string },
        ) => Promise<void>;
      };
      await db.patch(id, { contentType: type });
      return id;
    });
  const sourceId = await store("office-file", "application/msword");
  const created = await member.mutation(api.documents.create, {
    tenantId: client.tenantId,
    storageId: sourceId,
    filename: "lease.doc",
    source: "upload",
  });
  const documentId = created.documentId!;
  return { t, admin, member, outsider, store, documentId, sourceId };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("private document previews", () => {
  test("reserved jobs reconcile an ambiguous submission without resubmitting", async () => {
    const { t, member, documentId, store } = await setup();
    vi.stubEnv("WINDMILL_BASE_URL", "https://windmill.test");
    vi.stubEnv("WINDMILL_WORKSPACE", "preview-test");
    vi.stubEnv("WINDMILL_PREVIEW_TOKEN", "test-only-token");
    const previewId = (await member.mutation(api.documentPreviews.request, {
      documentId,
    }))!;
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("uncertain transport failure"));
    vi.stubGlobal("fetch", fetcher);
    await t.action(internal.documentPreviews.start, { previewId });
    await t.action(internal.documentPreviews.start, { previewId });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const work = await t.query(internal.documentPreviews.work, { previewId });
    expect(work?.preview.jobId).toBeTruthy();
    const output = await store();
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "CompletedJob",
          success: true,
          result: { storage_id: output },
        }),
      ),
    );
    await t.action(internal.documentPreviews.poll, { previewId, check: 0 });
    expect(String(fetcher.mock.calls[1][0])).toContain(
      `/jobs_u/get/${work?.preview.jobId}`,
    );
    expect(
      (await member.query(api.documentPreviews.view, { documentId }))
        ?.previewStatus,
    ).toBe("ready");
  });

  test("missing cached outputs can regenerate without restarting extraction", async () => {
    const { t, member, documentId, store } = await setup();
    const first = (await member.mutation(api.documentPreviews.request, {
      documentId,
    }))!;
    const output = await store();
    await t.mutation(internal.documentPreviews.complete, {
      previewId: first,
      storageId: output,
    });
    await t.run((ctx) => ctx.storage.delete(output));
    const second = await member.mutation(api.documentPreviews.request, {
      documentId,
      retry: true,
    });
    expect(second).not.toBe(first);
    expect(
      (await member.query(api.documentPreviews.view, { documentId }))
        ?.previewStatus,
    ).toBe("preparing");
  });

  test("all accepted extensions have an in-app rendering path", () => {
    for (const extension of [
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "pptx",
      "png",
      "jpg",
      "jpeg",
      "tif",
      "tiff",
      "webp",
      "csv",
      "txt",
      "md",
      "html",
    ]) {
      expect(
        previewKind(
          "application/octet-stream",
          `FILE.${extension.toUpperCase()}`,
        ),
      ).not.toBe("unsupported");
    }
  });

  test("members view files before extraction; outsiders and anonymous callers cannot", async () => {
    const { t, member, outsider, documentId } = await setup();
    const result = await member.query(api.documentPreviews.view, {
      documentId,
    });
    expect(result?.originalUrl).toBeTruthy();
    expect(result?.isStaff).toBe(false);
    expect(result).not.toHaveProperty("fields");
    expect(result).not.toHaveProperty("processingStages");
    expect(
      await outsider.query(api.documentPreviews.view, { documentId }),
    ).toBeNull();
    expect(await t.query(api.documentPreviews.view, { documentId })).toBeNull();
    await expect(
      outsider.mutation(api.documentPreviews.request, { documentId }),
    ).rejects.toThrow();
  });

  test("concurrent viewers share one conversion and never change extraction state", async () => {
    const { t, member, admin, documentId, store } = await setup();
    const before = await t.run((ctx) => ctx.db.get(documentId));
    const first = await member.mutation(api.documentPreviews.request, {
      documentId,
    });
    expect(
      await admin.mutation(api.documentPreviews.request, {
        documentId,
        retry: true,
      }),
    ).toBe(first);
    const output = await store();
    await t.mutation(internal.documentPreviews.complete, {
      previewId: first!,
      storageId: output,
    });
    expect(
      await member.mutation(api.documentPreviews.request, { documentId }),
    ).toBe(first);
    expect(
      (await member.query(api.documentPreviews.view, { documentId }))
        ?.previewUrl,
    ).toBeTruthy();
    const after = await t.run((ctx) => ctx.db.get(documentId));
    expect(after).toEqual({ ...before, previewId: first });
  });

  test("failed conversion requires explicit retry and ignores/cleans late output", async () => {
    const { t, member, documentId, store } = await setup();
    const first = await member.mutation(api.documentPreviews.request, {
      documentId,
    });
    await t.mutation(internal.documentPreviews.fail, {
      previewId: first!,
      timeout: true,
    });
    expect(
      await member.mutation(api.documentPreviews.request, { documentId }),
    ).toBe(first);
    const second = await member.mutation(api.documentPreviews.request, {
      documentId,
      retry: true,
    });
    expect(second).not.toBe(first);
    const late = await store();
    await t.mutation(internal.documentPreviews.complete, {
      previewId: first!,
      storageId: late,
    });
    expect(await t.run((ctx) => ctx.db.system.get(late))).toBeNull();
    expect(
      (await member.query(api.documentPreviews.view, { documentId }))
        ?.previewStatus,
    ).toBe("preparing");
  });

  test("completion is idempotent and an expiry cannot fail a ready preview", async () => {
    const { t, member, documentId, store } = await setup();
    const previewId = (await member.mutation(api.documentPreviews.request, {
      documentId,
    }))!;
    const storageId = await store();
    await t.mutation(internal.documentPreviews.complete, {
      previewId,
      storageId,
    });
    await t.mutation(internal.documentPreviews.complete, {
      previewId,
      storageId,
    });
    await t.mutation(internal.documentPreviews.fail, {
      previewId,
      timeout: true,
    });
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).not.toBeNull();
    expect(
      (await member.query(api.documentPreviews.view, { documentId }))
        ?.previewStatus,
    ).toBe("ready");
  });

  test.each(["deleted", "replaced-source", "expired", "invalid-output"])(
    "rejects %s results and cleans generated files",
    async (scenario) => {
      const { t, member, documentId, store } = await setup();
      const previewId = (await member.mutation(api.documentPreviews.request, {
        documentId,
      }))!;
      const storageId = await store(
        "output",
        scenario === "invalid-output" ? "image/png" : "application/pdf",
      );
      if (scenario === "deleted")
        await t.run((ctx) =>
          ctx.db.patch(documentId, { deletedAt: Date.now() }),
        );
      if (scenario === "replaced-source") {
        const replacement = await store();
        await t.run((ctx) =>
          ctx.db.patch(documentId, { storageId: replacement }),
        );
      }
      if (scenario === "expired")
        vi.setSystemTime(Date.now() + PREVIEW_BUDGET_MS + 1);
      await t.mutation(internal.documentPreviews.complete, {
        previewId,
        storageId,
      });
      expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeNull();
      if (scenario === "deleted")
        expect(
          await member.query(api.documentPreviews.view, { documentId }),
        ).toBeNull();
    },
  );

  test("missing configuration fails safely; claiming submission twice cannot duplicate jobs", async () => {
    const { t, member, documentId } = await setup();
    vi.stubEnv("WINDMILL_PREVIEW_TOKEN", "");
    const previewId = (await member.mutation(api.documentPreviews.request, {
      documentId,
    }))!;
    await t.action(internal.documentPreviews.start, { previewId });
    expect(
      (await member.query(api.documentPreviews.view, { documentId }))
        ?.previewError,
    ).toContain("not configured");
    const next = (await member.mutation(api.documentPreviews.request, {
      documentId,
      retry: true,
    }))!;
    expect(
      await t.mutation(internal.documentPreviews.prepare, {
        previewId: next,
        jobId: "reserved-job",
      }),
    ).toBeTruthy();
    expect(
      await t.mutation(internal.documentPreviews.prepare, {
        previewId: next,
        jobId: "another-job",
      }),
    ).toBeNull();
  });

  test("replaced originals retain their existing file permissions and new uploads get their own preview", async () => {
    const { t, member, documentId, sourceId, store } = await setup();
    const replacement = await store("new office-file", "application/msword");
    const created = await member.mutation(api.documents.replace, {
      documentId,
      storageId: replacement,
      filename: "new.doc",
    });
    expect(created.documentId).toBeTruthy();
    expect(
      (await member.query(api.documentPreviews.view, { documentId }))
        ?.originalUrl,
    ).toBeTruthy();
    expect((await t.run((ctx) => ctx.db.get(documentId)))?.storageId).toBe(
      sourceId,
    );
    expect(
      (
        await member.query(api.documentPreviews.view, {
          documentId: created.documentId!,
        })
      )?.previewStatus,
    ).toBeNull();
  });
});
