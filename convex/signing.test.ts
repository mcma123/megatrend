/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { initialField } from "./lib/signingFields";
import type { PageGeometry } from "./lib/signingPreparation";
import {
  canonicalJson,
  normalizeDraft,
  signingHash,
  type SigningDraft,
  type SigningStatus,
  assertSigningTransition,
} from "./lib/signing";

const modules = import.meta.glob("./**/*.ts");
const ADMIN_EMAIL = "signing-admin@cyphersoft.test";
const draft: SigningDraft = {
  title: "Warehouse lease",
  category: "commercial_lease",
  notes: "Draft only",
  participants: [
    {
      key: "renter",
      name: "Ann Renter",
      email: "ann@example.test",
      role: "Tenant",
      responsibility: "signer",
      stage: 1,
    },
    {
      key: "owner",
      name: "Olu Owner",
      email: "olu@example.test",
      role: "Landlord",
      responsibility: "signer",
      stage: 2,
    },
  ],
};

async function setup() {
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", ADMIN_EMAIL);
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", { email: ADMIN_EMAIL });
    const sessionId = await ctx.db.insert("authSessions", {
      userId: adminId,
      expirationTime: Date.now() + 3_600_000,
    });
    await ctx.db.insert("signingMfa", {
      userId: adminId,
      credentialVersion: "test-mfa",
      keyId: "test",
      encryptedSecret: "fixture-only",
      enabled: true,
      enrollmentExpiresAt: 0,
      recoveryHashes: [],
      failedAttempts: 0,
      lockedUntil: 0,
      lastAttemptAt: 0,
    });
    await ctx.db.insert("signingMfaGrants", {
      userId: adminId,
      sessionId,
      credentialVersion: "test-mfa",
      expiresAt: Date.now() + 300_000,
    });
    const staffId = await ctx.db.insert("users", {
      email: "staff@example.test",
    });
    const clientId = await ctx.db.insert("users", {
      email: "client@example.test",
    });
    const hybridId = await ctx.db.insert("users", {
      email: "hybrid@example.test",
    });
    const tenantId = await ctx.db.insert("tenants", {
      slug: "signing-test",
      displayName: "Company",
      status: "active",
      primaryRegion: "ZA",
      createdAt: Date.now(),
      createdBy: adminId,
    });
    const otherTenantId = await ctx.db.insert("tenants", {
      slug: "other-test",
      displayName: "Other",
      status: "active",
      primaryRegion: "ZA",
      createdAt: Date.now(),
      createdBy: adminId,
    });
    for (const member of [
      {
        userId: staffId,
        principalType: "staff" as const,
        roleKey: "read_only_staff" as const,
        tenantId,
      },
      {
        userId: clientId,
        principalType: "client" as const,
        roleKey: "client_admin" as const,
        tenantId,
      },
      {
        userId: hybridId,
        principalType: "staff" as const,
        roleKey: "account_manager" as const,
        tenantId: otherTenantId,
      },
      {
        userId: hybridId,
        principalType: "client" as const,
        roleKey: "client_admin" as const,
        tenantId,
      },
    ]) {
      await ctx.db.insert("memberships", {
        ...member,
        status: "active",
        createdAt: Date.now(),
        createdBy: adminId,
      });
    }
    const propertyId = await ctx.db.insert("properties", {
      tenantId,
      name: "Warehouse",
      addressLine: "1 Road",
      city: "Johannesburg",
      propertyType: "warehouse",
      status: "active",
      features: [],
      createdAt: Date.now(),
      createdBy: adminId,
      updatedAt: Date.now(),
      updatedBy: adminId,
    });
    const otherPropertyId = await ctx.db.insert("properties", {
      tenantId: otherTenantId,
      name: "Other building",
      addressLine: "2 Road",
      city: "Johannesburg",
      propertyType: "office",
      status: "active",
      features: [],
      createdAt: Date.now(),
      createdBy: adminId,
      updatedAt: Date.now(),
      updatedBy: adminId,
    });
    return {
      sessionId,
      adminId,
      staffId,
      clientId,
      hybridId,
      tenantId,
      otherTenantId,
      propertyId,
      otherPropertyId,
    };
  });
  const asUser = (userId: string) =>
    t.withIdentity({
      subject: `${userId}|${userId === ids.adminId ? ids.sessionId : "session"}`,
    });
  return {
    t,
    ...ids,
    admin: asUser(ids.adminId),
    staff: asUser(ids.staffId),
    client: asUser(ids.clientId),
    hybrid: asUser(ids.hybridId),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("signing PDF ingestion and preparation", () => {
  async function uploaded(annexure = false) {
    vi.useFakeTimers();
    vi.stubEnv(
      "SIGNING_WINDMILL_BASE_URL",
      "https://signing-worker.example.test",
    );
    vi.stubEnv("WINDMILL_WORKSPACE", "synthetic");
    vi.stubEnv("WINDMILL_SIGNING_DOCUMENTS_TOKEN", "synthetic-token");
    const fixture = await setup();
    const { admin, tenantId } = fixture;
    const created = await admin.mutation(api.signing.createDraft, {
      tenantId,
      draft,
      requestId: "pdf-draft-request",
    });
    const upload = await admin.mutation(api.signingFiles.reserveUpload, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      requestId: "pdf-upload-primary",
      filename: "agreement.pdf",
      role: "primary",
      sizeBytes: 120,
    });
    const fileId = await admin.mutation(internal.signingFiles.attach, {
      uploadId: upload.uploadId,
      sourceVersion: "source-v1",
      sizeBytes: 120,
    });
    if (annexure) {
      const extra = await admin.mutation(api.signingFiles.reserveUpload, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        requestId: "pdf-upload-annexure",
        filename: "annexure.pdf",
        role: "annexure",
        sizeBytes: 130,
      });
      await admin.mutation(internal.signingFiles.attach, {
        uploadId: extra.uploadId,
        sourceVersion: "annexure-v1",
        sizeBytes: 130,
      });
    }
    return { ...fixture, created, upload, fileId };
  }
  async function preparing(annexure = false) {
    const fixture = await uploaded(annexure);
    const { admin, created, t } = fixture;
    const files = await admin.query(api.signingFiles.list, {
      agreementId: created.agreementId,
    });
    const attemptId = await admin.mutation(api.signingPreparations.request, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedFileRevision: files.fileRevision,
    });
    const jobId = "f034c419-cfad-45f9-a824-61e6ac8a0dcf";
    await t.mutation(internal.signingPreparations.claim, { attemptId, jobId });
    const row = (await t.query(internal.signingPreparations.context, {
      attemptId,
    }))!;
    const snapshot = JSON.parse(row.snapshot);
    const sources = snapshot.files.map(
      (f: Record<string, unknown>, index: number) => ({
        ...f,
        sha256: "a".repeat(64),
        pageStartIndex: index,
        pageCount: 1,
        scanEngine: "ClamAV",
        scanVersion: "synthetic-scanner",
        scannedAt: Date.now(),
      }),
    );
    const pages = sources.map((source: { fileId: string }, index: number) => ({
      pageIndex: index,
      sourceFileId: source.fileId,
      sourcePageIndex: 0,
      mediaBox: [0, 0, 612, 792],
      cropBox: [0, 0, 612, 792],
      rotation: 0,
      userUnit: 1,
      widthPt: 612,
      heightPt: 792,
    }));
    const manifest = {
      contractVersion: 1,
      tenantId: row.tenantId,
      agreementId: row.agreementId,
      attemptId,
      inputDigest: row.inputDigest,
      rendererVersion: "pypdf-flat-v1:synthetic",
      pdfHash: "b".repeat(64),
      sizeBytes: 999,
      sources,
      pages,
      outputScan: {
        engine: "ClamAV",
        version: "synthetic-scanner",
        scannedAt: Date.now(),
      },
    };
    const prefix = `prepared/${row.tenantId}/${row.agreementId}/${attemptId}`;
    const result = {
      status: "ready",
      manifest,
      manifestHash: await signingHash(manifest),
      artifactKey: `${prefix}/bundle.pdf`,
      storageVersion: "bundle-v1",
      manifestKey: `${prefix}/manifest.json`,
      manifestVersion: "manifest-v1",
      retainUntil: Date.now() + 86_400_000,
    };
    return { ...fixture, attemptId, jobId, row, result };
  }
  test("files remain quarantined and clients, hybrid-company members and non-admin writers cannot access them", async () => {
    const { admin, staff, client, hybrid, created } = await uploaded();
    const data = await admin.query(api.signingFiles.list, {
      agreementId: created.agreementId,
    });
    expect(data.bundle).toBeNull();
    expect(JSON.stringify(data)).not.toMatch(/source-v1|https:/);
    expect(
      (
        await staff.query(api.signingFiles.list, {
          agreementId: created.agreementId,
        })
      ).files,
    ).toHaveLength(1);
    for (const user of [client, hybrid])
      await expect(
        user.query(api.signingFiles.list, { agreementId: created.agreementId }),
      ).rejects.toThrow();
    for (const user of [staff, client, hybrid])
      await expect(
        user.mutation(api.signingFiles.reserveUpload, {
          agreementId: created.agreementId,
          expectedRevision: 1,
          requestId: "access-denied-request",
          filename: "a.pdf",
          role: "annexure",
          sizeBytes: 1,
        }),
      ).rejects.toThrow();
    await expect(
      admin.action(api.signingFiles.getPreparedUrl, {
        agreementId: created.agreementId,
      }),
    ).rejects.toThrow(/Prepare/);
  });
  test("tickets are idempotent, source versions are pinned once and primary files cannot be duplicated", async () => {
    const { admin, created, upload, fileId, t } = await uploaded();
    const args = {
      agreementId: created.agreementId,
      expectedRevision: 1,
      requestId: "pdf-upload-primary",
      filename: "agreement.pdf",
      role: "primary" as const,
      sizeBytes: 120,
    };
    expect(await admin.mutation(api.signingFiles.reserveUpload, args)).toEqual(
      upload,
    );
    await expect(
      admin.mutation(api.signingFiles.reserveUpload, {
        ...args,
        filename: "different.pdf",
      }),
    ).rejects.toThrow(/already used/);
    expect(
      await admin.mutation(internal.signingFiles.attach, {
        uploadId: upload.uploadId,
        sourceVersion: "replacement-version",
        sizeBytes: 120,
      }),
    ).toBe(fileId);
    expect((await t.run((ctx) => ctx.db.get(fileId)))!.sourceVersion).toBe(
      "source-v1",
    );
    await expect(
      admin.mutation(api.signingFiles.reserveUpload, {
        ...args,
        requestId: "another-primary-upload",
      }),
    ).rejects.toThrow(/one primary/);
  });
  test("invalid filenames, size limits, expired tickets and changed drafts fail before attachment", async () => {
    const { admin, created } = await uploaded();
    const args = {
      agreementId: created.agreementId,
      expectedRevision: 1,
      requestId: "pdf-annexure-upload",
      filename: "annexure.pdf",
      role: "annexure" as const,
      sizeBytes: 120,
    };
    for (const invalid of [
      { filename: "../secret.pdf" },
      { filename: "file.exe" },
      { sizeBytes: 26 * 1024 * 1024 },
      { sizeBytes: 1.5 },
    ])
      await expect(
        admin.mutation(api.signingFiles.reserveUpload, { ...args, ...invalid }),
      ).rejects.toThrow(/PDF/);
    const ticket = await admin.mutation(api.signingFiles.reserveUpload, args);
    await admin.mutation(api.signing.updateDraft, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      requestId: "changed-draft-upload",
      draft: { ...draft, notes: "Changed" },
    });
    await expect(
      admin.mutation(internal.signingFiles.attach, {
        uploadId: ticket.uploadId,
        sourceVersion: "version",
        sizeBytes: 120,
      }),
    ).rejects.toThrow(/draft changed/);
    const fresh = await admin.mutation(api.signingFiles.reserveUpload, {
      ...args,
      expectedRevision: 2,
      requestId: "expired-upload-request",
    });
    vi.setSystemTime(Date.now() + 300_001);
    await expect(
      admin.mutation(internal.signingFiles.attach, {
        uploadId: fresh.uploadId,
        sourceVersion: "version",
        sizeBytes: 120,
      }),
    ).rejects.toThrow();
  });
  test("file ordering requires exact membership, a primary first and the loaded file revision", async () => {
    const { admin, created } = await uploaded(true);
    const data = await admin.query(api.signingFiles.list, {
      agreementId: created.agreementId,
    });
    const args = {
      agreementId: created.agreementId,
      expectedFileRevision: data.fileRevision,
      orderedFileIds: data.files.map((f) => f.id),
    };
    await expect(
      admin.mutation(api.signingFiles.changeFiles, {
        ...args,
        orderedFileIds: [...args.orderedFileIds].reverse(),
      }),
    ).rejects.toThrow(/primary/);
    await expect(
      admin.mutation(api.signingFiles.changeFiles, {
        ...args,
        orderedFileIds: [args.orderedFileIds[0], args.orderedFileIds[0]],
      }),
    ).rejects.toThrow(/complete file order/);
    await admin.mutation(api.signingFiles.changeFiles, {
      ...args,
      orderedFileIds: [args.orderedFileIds[0]],
      removeFileId: args.orderedFileIds[1],
    });
    await expect(
      admin.mutation(api.signingFiles.changeFiles, args),
    ).rejects.toThrow(/Files changed/);
  });
  test("unresolved jobs block metadata edits, file changes and duplicate preparation", async () => {
    const { admin, created } = await preparing();
    await expect(
      admin.mutation(api.signing.updateDraft, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        requestId: "locked-draft-change",
        draft,
      }),
    ).rejects.toThrow(/unresolved job/);
    await expect(
      admin.mutation(api.signingFiles.changeFiles, {
        agreementId: created.agreementId,
        expectedFileRevision: 1,
        orderedFileIds: [],
      }),
    ).rejects.toThrow(/unresolved job/);
    await expect(
      admin.mutation(api.signingPreparations.request, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        expectedFileRevision: 1,
      }),
    ).rejects.toThrow(/unresolved job/);
  });
  test("verified completion is immutable/idempotent and changing annexures invalidates it", async () => {
    const { admin, t, created, attemptId, jobId, result } =
      await preparing(true);
    const bundleId = await t.mutation(internal.signingPreparations.finish, {
      attemptId,
      jobId,
      result,
    });
    expect(bundleId).toBeTruthy();
    expect(
      await t.mutation(internal.signingPreparations.finish, {
        attemptId,
        jobId,
        result,
      }),
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("signingBundles").collect()),
    ).toHaveLength(1);
    const data = await admin.query(api.signingFiles.list, {
      agreementId: created.agreementId,
    });
    expect(data.bundle?.pageCount).toBe(2);
    await admin.mutation(api.signingFiles.changeFiles, {
      agreementId: created.agreementId,
      expectedFileRevision: 2,
      orderedFileIds: [data.files[0].id],
      removeFileId: data.files[1].id,
    });
    expect(
      (
        await admin.query(api.signingFiles.list, {
          agreementId: created.agreementId,
        })
      ).bundle,
    ).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(bundleId!)))!.pdfHash).toBe(
      result.manifest.pdfHash,
    );
  });
  test.each([
    "identity",
    "source",
    "hash",
    "page",
    "path",
    "retention",
    "snapshot",
  ])("invalid %s evidence never publishes a bundle", async (kind) => {
    const { t, admin, created, attemptId, jobId, result, row } =
      await preparing();
    if (kind === "snapshot")
      await t.run((ctx) =>
        ctx.db.patch(attemptId, {
          snapshot: JSON.stringify({
            ...JSON.parse(row.snapshot),
            filenames: ["changed.pdf"],
          }),
        }),
      );
    if (kind === "identity")
      result.manifest.agreementId =
        "another-agreement" as typeof result.manifest.agreementId;
    if (kind === "source")
      result.manifest.sources[0].sourceVersion = "changed-version";
    if (kind === "page") result.manifest.pages[0].rotation = 45;
    if (kind === "path") result.artifactKey = "foreign/bundle.pdf";
    if (kind === "retention") result.retainUntil = Date.now() - 1;
    result.manifestHash =
      kind === "hash" ? "0".repeat(64) : await signingHash(result.manifest);
    await t.mutation(internal.signingPreparations.finish, {
      attemptId,
      jobId,
      result,
    });
    expect(
      (
        await admin.query(api.signingFiles.list, {
          agreementId: created.agreementId,
        })
      ).bundle,
    ).toBeNull();
    expect(
      (await t.query(internal.signingPreparations.context, { attemptId }))!
        .error,
    ).toBe("result_invalid");
  });
  test("late results after cancellation cannot publish a bundle", async () => {
    const { t, admin, created, attemptId, jobId, result } = await preparing();
    await admin.mutation(api.signing.voidDraft, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      reason: "Cancelled synthetic test",
    });
    await t.mutation(internal.signingPreparations.finish, {
      attemptId,
      jobId,
      result,
    });
    expect(
      (await t.query(internal.signingPreparations.context, { attemptId }))!
        .status,
    ).toBe("superseded");
    expect(
      (
        await admin.query(api.signingFiles.list, {
          agreementId: created.agreementId,
        })
      ).bundle,
    ).toBeNull();
  });
  test("expired retention cannot offer a validated bundle or prepared download", async () => {
    const { t, admin, created, attemptId, jobId, result } = await preparing();
    await t.mutation(internal.signingPreparations.finish, {
      attemptId,
      jobId,
      result,
    });
    vi.setSystemTime(result.retainUntil + 1);
    expect(
      (
        await admin.query(api.signingFiles.list, {
          agreementId: created.agreementId,
        })
      ).bundle,
    ).toBeNull();
    await expect(
      admin.action(api.signingFiles.getPreparedUrl, {
        agreementId: created.agreementId,
      }),
    ).rejects.toThrow(/Prepare/);
  });
  test("a failed status lookup preserves submission ownership instead of allowing a duplicate job", async () => {
    const { t, attemptId, jobId, admin, created } = await preparing();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network offline")),
    );
    await t.action(internal.signingPreparations.poll, { attemptId });
    const row = (await t.query(internal.signingPreparations.context, {
      attemptId,
    }))!;
    expect(row.status).toBe("submission_unknown");
    expect(row.jobId).toBe(jobId);
    await expect(
      admin.mutation(api.signingPreparations.request, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        expectedFileRevision: 1,
      }),
    ).rejects.toThrow(/unresolved/);
  });
  test("polling binds the remote job path, args, owner and exact job ID", async () => {
    const { t, attemptId, jobId, row, result } = await preparing();
    const remote = {
      id: jobId,
      script_path: "f/docling/unrelated",
      success: true,
      result,
      args: {
        operation: "prepare",
        tenant_id: row.tenantId,
        agreement_id: row.agreementId,
        payload: { attemptId, inputDigest: row.inputDigest },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify(remote))),
        ),
    );
    await t.action(internal.signingPreparations.poll, { attemptId });
    expect(
      (await t.query(internal.signingPreparations.context, { attemptId }))!
        .status,
    ).toBe("submission_unknown");
    remote.script_path = "f/signing/prepare_bundle";
    await t.action(internal.signingPreparations.poll, { attemptId });
    expect(
      (await t.query(internal.signingPreparations.context, { attemptId }))!
        .status,
    ).toBe("ready");
  });
  test("missing worker configuration fails closed without scheduling preparation", async () => {
    const { admin, created } = await uploaded();
    vi.stubEnv("WINDMILL_SIGNING_DOCUMENTS_TOKEN", "");
    await expect(
      admin.mutation(api.signingPreparations.request, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        expectedFileRevision: 1,
      }),
    ).rejects.toThrow(/Configure/);
    expect(
      (
        await admin.query(api.signingFiles.list, {
          agreementId: created.agreementId,
        })
      ).attempt,
    ).toBeNull();
  });
});

describe("signing draft foundation", () => {
  test("create retry is idempotent and a changed payload cannot reuse the key", async () => {
    const { t, admin, tenantId } = await setup();
    const args = { tenantId, requestId: "create-request-001", draft };
    const created = await admin.mutation(api.signing.createDraft, args);
    expect(await admin.mutation(api.signing.createDraft, args)).toEqual(
      created,
    );
    await expect(
      admin.mutation(api.signing.createDraft, {
        ...args,
        draft: { ...draft, title: "Changed" },
      }),
    ).rejects.toThrow(/request ID/);
    const records = await t.run(async (ctx) => ({
      agreements: await ctx.db.query("signingAgreements").take(10),
      events: await ctx.db.query("signingEvents").take(10),
      participants: await ctx.db.query("signingParticipants").take(10),
    }));
    expect(records.agreements).toHaveLength(1);
    expect(records.events).toHaveLength(1);
    expect(records.participants).toHaveLength(2);
    expect(records.events[0]).toMatchObject({
      revision: 1,
      sequence: 1,
      eventType: "draft_created",
    });
    expect(records.events[0].payload).not.toContain("ann@example.test");
  });

  test("edits preserve historical participants/content and reject stale revisions", async () => {
    const { admin, tenantId, t } = await setup();
    const created = await admin.mutation(api.signing.createDraft, {
      tenantId,
      requestId: "create-request-002",
      draft,
    });
    const update = {
      agreementId: created.agreementId,
      expectedRevision: 1,
      requestId: "update-request-002",
      draft: {
        ...draft,
        title: "Revised lease",
        participants: [draft.participants[0]],
      },
    };
    const saved = await admin.mutation(api.signing.updateDraft, update);
    expect(saved.revision).toBe(2);
    expect(await admin.mutation(api.signing.updateDraft, update)).toEqual(
      saved,
    );
    await expect(
      admin.mutation(api.signing.updateDraft, {
        ...update,
        requestId: "stale-request-002",
      }),
    ).rejects.toThrow(/changed/);
    const current = await admin.query(api.signing.get, {
      agreementId: created.agreementId,
    });
    expect(current.participants).toHaveLength(1);
    expect(current.revision.title).toBe("Revised lease");
    const historical = await t.run(async (ctx) => ({
      revision: await ctx.db.get(created.revisionId),
      participants: await ctx.db
        .query("signingParticipants")
        .withIndex("by_revisionId", (q) =>
          q.eq("revisionId", created.revisionId),
        )
        .take(20),
    }));
    expect(historical.revision?.title).toBe(draft.title);
    expect(historical.participants).toHaveLength(2);
    expect(
      (
        await admin.query(api.signing.revisions, {
          agreementId: created.agreementId,
          paginationOpts: { numItems: 10, cursor: null },
        })
      ).page.map((r) => r.revision),
    ).toEqual([2, 1]);
    expect(
      await admin.query(api.signing.verifyAudit, {
        agreementId: created.agreementId,
      }),
    ).toMatchObject({
      status: "consistent_unanchored",
      independentlyAnchored: false,
      checkedEvents: 2,
    });
  });

  test("clients, anonymous callers and staff without company staff membership cannot read evidence", async () => {
    const { admin, staff, client, hybrid, tenantId, otherTenantId, t } =
      await setup();
    const created = await admin.mutation(api.signing.createDraft, {
      tenantId,
      requestId: "create-request-003",
      draft,
    });
    for (const caller of [client, hybrid, t]) {
      await expect(
        caller.query(api.signing.get, { agreementId: created.agreementId }),
      ).rejects.toThrow(/staff|access/);
      await expect(
        caller.query(api.signing.events, {
          agreementId: created.agreementId,
          paginationOpts: { numItems: 10, cursor: null },
        }),
      ).rejects.toThrow(/staff|access/);
    }
    await expect(
      staff.query(api.signing.list, {
        tenantId: otherTenantId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/access/);
    expect(
      (await staff.query(api.signing.get, { agreementId: created.agreementId }))
        .agreement._id,
    ).toBe(created.agreementId);
    for (const caller of [staff, client, hybrid]) {
      await expect(
        caller.mutation(api.signing.createDraft, {
          tenantId,
          requestId: "forbidden-request",
          draft,
        }),
      ).rejects.toThrow(/administrator/);
      await expect(
        caller.mutation(api.signing.updateDraft, {
          agreementId: created.agreementId,
          expectedRevision: 1,
          requestId: "forbidden-update",
          draft,
        }),
      ).rejects.toThrow(/administrator|staff|access/);
    }
  });

  test("property and lease references must belong to the company and selected property", async () => {
    const {
      admin,
      t,
      tenantId,
      otherTenantId,
      propertyId,
      otherPropertyId,
      adminId,
    } = await setup();
    await expect(
      admin.mutation(api.signing.createDraft, {
        tenantId,
        requestId: "wrong-property-004",
        draft: { ...draft, propertyId: otherPropertyId },
      }),
    ).rejects.toThrow(/property/);
    const leaseId = await t.run((ctx) =>
      ctx.db.insert("leases", {
        tenantId: otherTenantId,
        propertyId: otherPropertyId,
        startDate: "2026-01-01",
        endDate: "2027-01-01",
        monthlyRental: 1000,
        status: "active",
        createdAt: Date.now(),
        createdBy: adminId,
        updatedAt: Date.now(),
        updatedBy: adminId,
      }),
    );
    await expect(
      admin.mutation(api.signing.createDraft, {
        tenantId,
        requestId: "wrong-lease-0004",
        draft: { ...draft, propertyId, leaseId },
      }),
    ).rejects.toThrow(/lease/);
    const created = await admin.mutation(api.signing.createDraft, {
      tenantId,
      requestId: "valid-property-004",
      draft: { ...draft, propertyId },
    });
    expect(
      (await admin.query(api.signing.get, { agreementId: created.agreementId }))
        .revision.propertyId,
    ).toBe(propertyId);
    await t.run((ctx) => ctx.db.patch(propertyId, { archivedAt: Date.now() }));
    await expect(
      admin.mutation(api.signing.updateDraft, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        requestId: "archived-property",
        draft: { ...draft, propertyId },
      }),
    ).rejects.toThrow(/property/);
  });

  test("draft cancellation is audited, idempotent, and prohibits further edits", async () => {
    const { admin, tenantId } = await setup();
    const created = await admin.mutation(api.signing.createDraft, {
      tenantId,
      requestId: "create-request-005",
      draft,
    });
    const cancel = {
      agreementId: created.agreementId,
      expectedRevision: 1,
      reason: "Client requested a different contract",
    };
    await admin.mutation(api.signing.voidDraft, cancel);
    await admin.mutation(api.signing.voidDraft, cancel);
    expect(
      (await admin.query(api.signing.get, { agreementId: created.agreementId }))
        .agreement.status,
    ).toBe("voided");
    await expect(
      admin.mutation(api.signing.updateDraft, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        requestId: "edit-cancelled-005",
        draft,
      }),
    ).rejects.toThrow(/draft/);
    expect(
      (
        await admin.query(api.signing.events, {
          agreementId: created.agreementId,
          paginationOpts: { numItems: 10, cursor: null },
        })
      ).page,
    ).toHaveLength(2);
  });

  test("no non-draft status can be edited or voided through draft operations", async () => {
    const { admin, t, tenantId } = await setup();
    const created = await admin.mutation(api.signing.createDraft, {
      tenantId,
      requestId: "create-request-006",
      draft,
    });
    const statuses: SigningStatus[] = [
      "awaiting_approval",
      "ready_to_send",
      "awaiting_signatures",
      "partially_signed",
      "finalising",
      "completed",
      "declined",
      "expired",
      "superseded",
    ];
    for (const status of statuses) {
      await t.run((ctx) => ctx.db.patch(created.agreementId, { status }));
      await expect(
        admin.mutation(api.signing.updateDraft, {
          agreementId: created.agreementId,
          expectedRevision: 1,
          requestId: `blocked-${status}`,
          draft,
        }),
      ).rejects.toThrow(/draft/);
      await expect(
        admin.mutation(api.signing.voidDraft, {
          agreementId: created.agreementId,
          expectedRevision: 1,
          reason: "Cannot bypass issued cancellation",
        }),
      ).rejects.toThrow(/draft/);
    }
  });

  test("policy references never enable signing; unsupported categories fail closed", async () => {
    const { admin, staff, tenantId } = await setup();
    const empty = await admin.query(api.signing.readiness, { tenantId });
    expect(empty.canIssue).toBe(false);
    expect(empty.policyBlockers.length).toBeGreaterThan(0);
    const policy = {
      tenantId,
      expectedRevision: 0,
      legalReviewReference: "test-legal-policy",
      privacyNoticeReference: "test-privacy-v1",
      retentionPolicyReference: "test-retention",
      consentVersion: "test-v1",
      approvalRequired: true,
      allowedCategories: ["commercial_lease" as const],
    };
    await expect(
      staff.mutation(api.signing.recordPolicy, policy),
    ).rejects.toThrow(/administrator/);
    await admin.mutation(api.signing.recordPolicy, policy);
    const ready = await admin.query(api.signing.readiness, {
      tenantId,
      category: "commercial_lease",
    });
    expect(ready).toMatchObject({
      available: "drafts_only",
      canIssue: false,
      policyBlockers: [],
    });
    expect(ready.implementationBlockers.length).toBeGreaterThan(0);
    expect(ready.operationalBlockers.length).toBeGreaterThan(0);
    await expect(
      admin.mutation(api.signing.recordPolicy, policy),
    ).rejects.toThrow(/changed/);
    await expect(
      admin.mutation(api.signing.recordPolicy, {
        ...policy,
        expectedRevision: 1,
        allowedCategories: ["suretyship"],
      }),
    ).rejects.toThrow(/Unsupported/);
    expect(
      (
        await admin.query(api.signing.readiness, {
          tenantId,
          category: "suretyship",
        })
      ).policyBlockers.join(" "),
    ).toMatch(/unsupported/);
  });

  test("event edits, missing tail events and modified chain heads are detected", async () => {
    const { admin, t, tenantId } = await setup();
    const created = await admin.mutation(api.signing.createDraft, {
      tenantId,
      requestId: "create-request-007",
      draft,
    });
    const event = await t.run((ctx) => ctx.db.query("signingEvents").first());
    expect(event).not.toBeNull();
    await t.run((ctx) => ctx.db.patch(event!._id, { payload: "{}" }));
    expect(
      (
        await admin.query(api.signing.verifyAudit, {
          agreementId: created.agreementId,
        })
      ).status,
    ).toBe("inconsistent");
    await t.run((ctx) => ctx.db.patch(event!._id, { payload: event!.payload }));
    await t.run((ctx) =>
      ctx.db.patch(created.agreementId, { lastEventHash: "0".repeat(64) }),
    );
    expect(
      (
        await admin.query(api.signing.verifyAudit, {
          agreementId: created.agreementId,
        })
      ).status,
    ).toBe("inconsistent");
    await t.run(async (ctx) => {
      await ctx.db.patch(created.agreementId, {
        lastEventHash: event!.eventHash,
      });
      await ctx.db.delete(event!._id);
    });
    expect(
      (
        await admin.query(api.signing.verifyAudit, {
          agreementId: created.agreementId,
        })
      ).status,
    ).toBe("inconsistent");
  });

  test("inactive companies cannot create drafts", async () => {
    const { admin, t, tenantId } = await setup();
    await t.run((ctx) => ctx.db.patch(tenantId, { status: "suspended" }));
    await expect(
      admin.mutation(api.signing.createDraft, {
        tenantId,
        requestId: "inactive-company",
        draft,
      }),
    ).rejects.toThrow(/active company/);
  });

  test("changed draft content or participants fail integrity checks on access", async () => {
    const { admin, t, tenantId } = await setup();
    const created = await admin.mutation(api.signing.createDraft, {
      tenantId,
      requestId: "content-integrity",
      draft,
    });
    await t.run((ctx) =>
      ctx.db.patch(created.revisionId, {
        notes: "Altered without a new revision",
      }),
    );
    await expect(
      admin.query(api.signing.get, { agreementId: created.agreementId }),
    ).rejects.toThrow(/integrity/);
    await t.run(async (ctx) => {
      await ctx.db.patch(created.revisionId, { notes: draft.notes });
      const participant = await ctx.db
        .query("signingParticipants")
        .withIndex("by_revisionId", (q) =>
          q.eq("revisionId", created.revisionId),
        )
        .first();
      await ctx.db.patch(participant!._id, { email: "changed@example.test" });
    });
    await expect(
      admin.query(api.signing.get, { agreementId: created.agreementId }),
    ).rejects.toThrow(/integrity/);
  });
});

describe("content-bound approval and protected checkpoints", () => {
  async function prepared(participants = draft.participants) {
    const fixture = await setup();
    const { admin, tenantId, t } = fixture;
    const created = await admin.mutation(api.signing.createDraft, {
      tenantId,
      requestId: "approval-draft",
      draft: { ...draft, participants },
    });
    const policy = {
      tenantId,
      expectedRevision: 0,
      legalReviewReference: "synthetic-policy",
      privacyNoticeReference: "synthetic-privacy",
      retentionPolicyReference: "synthetic-retention",
      consentVersion: "synthetic-v1",
      approvalRequired: true,
      allowSelfApproval: true,
      allowedCategories: ["commercial_lease" as const],
    };
    await admin.mutation(api.signing.recordPolicy, policy);
    await expect(
      admin.mutation(api.signing.requestApproval, {
        agreementId: created.agreementId,
        expectedRevision: 1,
      }),
    ).rejects.toThrow(/PDF bundle/);
    // A Phase 2 worker will populate this table after actual PDF/scan validation.
    const bundleId = await t.run(async (ctx) => {
      const attemptId = await ctx.db.insert("signingPreparations", {
        tenantId,
        agreementId: created.agreementId,
        revisionId: created.revisionId,
        fileRevision: 0,
        inputDigest: "3".repeat(64),
        snapshot: "{}",
        status: "ready",
        createdAt: Date.now(),
        createdBy: fixture.adminId,
        checks: 0,
      });
      const bundleId = await ctx.db.insert("signingBundles", {
        tenantId,
        agreementId: created.agreementId,
        revisionId: created.revisionId,
        manifestHash: "1".repeat(64),
        pdfHash: "2".repeat(64),
        artifactKey: "synthetic/fixture.pdf",
        storageVersion: "synthetic-v1",
        validatedAt: Date.now(),
        scanReference: "synthetic-scan",
        rendererVersion: "synthetic-v1",
        attemptId,
        fileRevision: 0,
        inputDigest: "3".repeat(64),
        manifestVersion: "synthetic-manifest-v1",
        retainUntil: Date.now() + 86_400_000,
        pages: [
          {
            pageIndex: 0,
            sourceFileId: "synthetic-file",
            sourcePageIndex: 0,
            mediaBox: [0, 0, 600, 800],
            cropBox: [0, 0, 600, 800],
            rotation: 0,
            userUnit: 1,
            widthPt: 600,
            heightPt: 800,
          },
        ],
        sources: [
          {
            fileId: "synthetic-file",
            uploadId: "synthetic-upload",
            sourceVersion: "synthetic-version",
            sizeBytes: 100,
            sha256: "4".repeat(64),
            role: "primary",
            pageStartIndex: 0,
            pageCount: 1,
            scanEngine: "ClamAV",
            scanVersion: "synthetic",
            scannedAt: Date.now(),
          },
        ],
      });
      await ctx.db.patch(created.agreementId, { currentBundleId: bundleId });
      return bundleId;
    });
    const page: PageGeometry = {
      pageIndex: 0,
      sourceFileId: "synthetic-file",
      sourcePageIndex: 0,
      mediaBox: [0, 0, 600, 800],
      cropBox: [0, 0, 600, 800],
      rotation: 0,
      userUnit: 1,
      widthPt: 600,
      heightPt: 800,
    };
    const fields = participants
      .filter((p) => p.responsibility === "signer")
      .map((participant, index) => ({
        ...initialField(
          "signature",
          participant.key,
          page,
          `${participant.key}-signature`,
        ),
        x: 0.1 + (index % 2) * 0.45,
        y: 0.55 + Math.floor(index / 2) * 0.1,
      }));
    const layout = await admin.mutation(api.signingFields.save, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedLayoutRevision: 0,
      bundleId,
      fields,
    });
    const preparation = await admin.query(api.signingFields.get, {
      agreementId: created.agreementId,
    });
    return {
      ...fixture,
      created: { ...created, preparationHash: preparation.preparationHash! },
      policy,
      bundleId,
      layout,
      fields,
    };
  }

  test("field layouts are company-staff readable but only administrators with MFA can save", async () => {
    const { admin, client, hybrid, staff, t, created, fields, bundleId } =
      await prepared();
    for (const caller of [client, hybrid])
      await expect(
        caller.query(api.signingFields.get, {
          agreementId: created.agreementId,
        }),
      ).rejects.toThrow();
    expect(
      (
        await staff.query(api.signingFields.get, {
          agreementId: created.agreementId,
        })
      ).fields,
    ).toHaveLength(2);
    const args = {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedLayoutRevision: 1,
      bundleId,
      fields,
    };
    for (const caller of [staff, client, hybrid])
      await expect(
        caller.mutation(api.signingFields.save, args),
      ).rejects.toThrow();
    const grant = (await t.run((ctx) =>
      ctx.db.query("signingMfaGrants").first(),
    ))!;
    await t.run((ctx) => ctx.db.patch(grant._id, { expiresAt: 0 }));
    await expect(admin.mutation(api.signingFields.save, args)).rejects.toThrow(
      /MFA|authenticator|Verify/i,
    );
  });
  test("mixed stages preserve parallel signers, later signing and separate non-signing responsibilities", async () => {
    const participants = [
      { ...draft.participants[0], stage: 1 },
      { ...draft.participants[1], stage: 1 },
      {
        ...draft.participants[0],
        key: "representative",
        name: "Representative",
        stage: 2,
      },
      {
        ...draft.participants[0],
        key: "approver",
        responsibility: "approver" as const,
        stage: 1,
      },
      {
        ...draft.participants[0],
        key: "viewer",
        responsibility: "viewer" as const,
        stage: 1,
      },
      {
        ...draft.participants[0],
        key: "copy",
        responsibility: "copy" as const,
        stage: 1,
      },
    ];
    const { admin, t, created, bundleId, fields } =
      await prepared(participants);
    await expect(
      admin.mutation(api.signingFields.save, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        expectedLayoutRevision: 1,
        bundleId,
        fields: [{ ...fields[0], participantKey: "viewer" }],
      }),
    ).rejects.toThrow(/signer/);
    const { approvalId } = await admin.mutation(api.signing.requestApproval, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedPreparationHash: created.preparationHash,
    });
    await admin.mutation(api.signing.decideApproval, {
      agreementId: created.agreementId,
      approvalId,
      decision: "approved",
      reason: "Reviewed mixed workflow",
    });
    const frozen = (await t.run((ctx) =>
      ctx.db.query("signingFrozenPreparations").first(),
    ))!;
    expect(JSON.parse(frozen.snapshot).participants).toEqual(participants);
    expect(JSON.parse(frozen.snapshot).fields).toHaveLength(3);
  });
  test("field saves reject stale revisions, missing pages and foreign assignments", async () => {
    const { admin, created, fields, bundleId, layout } = await prepared();
    const args = {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedLayoutRevision: 1,
      bundleId,
      fields,
    };
    for (const patch of [
      { expectedRevision: 0 },
      { expectedLayoutRevision: 0 },
      { fields: [{ ...fields[0], pageIndex: 10 }] },
      { fields: [{ ...fields[0], participantKey: "foreign-signer" }] },
      { fields: [{ ...fields[0], x: 0.999 }] },
    ])
      await expect(
        admin.mutation(api.signingFields.save, { ...args, ...patch }),
      ).rejects.toThrow();
    const saved = await admin.mutation(api.signingFields.save, {
      ...args,
      fields: fields.map((f) => ({ ...f, y: 0.5 })),
    });
    expect(saved.layoutId).not.toBe(layout.layoutId);
    expect(saved.version).toBe(2);
    await expect(admin.mutation(api.signingFields.save, args)).rejects.toThrow(
      /changed/,
    );
  });
  test("all signers need a required signature, and a reviewed hash cannot approve changed fields", async () => {
    const { admin, created, fields, bundleId } = await prepared();
    await admin.mutation(api.signingFields.save, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedLayoutRevision: 1,
      bundleId,
      fields: [fields[0]],
    });
    const incomplete = await admin.query(api.signingFields.get, {
      agreementId: created.agreementId,
    });
    expect(incomplete.blockers.join(" ")).toMatch(/Olu Owner/);
    await expect(
      admin.mutation(api.signing.requestApproval, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        expectedPreparationHash: incomplete.preparationHash!,
      }),
    ).rejects.toThrow(/required signature/);
    await admin.mutation(api.signingFields.save, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedLayoutRevision: 2,
      bundleId,
      fields,
    });
    await expect(
      admin.mutation(api.signing.requestApproval, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        expectedPreparationHash: created.preparationHash,
      }),
    ).rejects.toThrow(/changed|reviewed/);
  });
  test("an unsupported legal category cannot be approved despite complete PDF fields", async () => {
    const { admin, t, created } = await prepared();
    // Tampering with the category is also detected by immutable revision integrity.
    await t.run((ctx) =>
      ctx.db.patch(created.agreementId, { category: "property_sale" }),
    );
    await expect(
      admin.mutation(api.signing.requestApproval, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        expectedPreparationHash: created.preparationHash,
      }),
    ).rejects.toThrow(/legal review|unsupported/);
  });
  test("approval freezes exact fields, participants, signing stages and consent in one transaction", async () => {
    const { admin, t, created, fields, bundleId, layout } = await prepared();
    const { approvalId } = await admin.mutation(api.signing.requestApproval, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedPreparationHash: created.preparationHash,
    });
    await expect(
      admin.mutation(api.signingFields.save, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        expectedLayoutRevision: 1,
        bundleId,
        fields,
      }),
    ).rejects.toThrow(/editable draft/);
    expect(
      await t.run((ctx) => ctx.db.query("signingFrozenPreparations").collect()),
    ).toHaveLength(0);
    await admin.mutation(api.signing.decideApproval, {
      agreementId: created.agreementId,
      approvalId,
      decision: "approved",
      reason: "Approved synthetic preparation",
    });
    const current = await admin.query(api.signing.get, {
      agreementId: created.agreementId,
    });
    expect(current.approvalCurrent).toBe(true);
    expect(current.frozenPreparation).toBeTruthy();
    const frozen = (await t.run((ctx) =>
      ctx.db.get(current.frozenPreparation!.id),
    ))!;
    const snapshot = JSON.parse(frozen.snapshot);
    expect(snapshot.fields).toEqual(fields);
    expect(snapshot.layoutId).toBe(layout.layoutId);
    expect(
      snapshot.participants.map((p: { stage: number }) => p.stage),
    ).toEqual([1, 2]);
    expect(snapshot.consentVersion).toBe("synthetic-v1");
    expect(snapshot.storageVersion).toBe("synthetic-v1");
    expect(await signingHash(snapshot)).toBe(created.preparationHash);
    const event = (await t.run((ctx) =>
      ctx.db
        .query("signingEvents")
        .withIndex("by_agreementId_and_sequence", (q) =>
          q
            .eq("agreementId", created.agreementId)
            .eq("sequence", frozen.eventSequence),
        )
        .unique(),
    ))!;
    expect(JSON.parse(event.payload).frozenPreparationId).toBe(frozen._id);
    await t.run((ctx) =>
      ctx.db.patch(frozen._id, {
        snapshot: JSON.stringify({ ...snapshot, consentVersion: "tampered" }),
      }),
    );
    expect(
      (await admin.query(api.signing.get, { agreementId: created.agreementId }))
        .approvalCurrent,
    ).toBe(false);
  });
  test("rejection produces no frozen record; return to draft invalidates PDF and layout pointers", async () => {
    const { admin, t, created } = await prepared();
    const { approvalId } = await admin.mutation(api.signing.requestApproval, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedPreparationHash: created.preparationHash,
    });
    await admin.mutation(api.signing.decideApproval, {
      agreementId: created.agreementId,
      approvalId,
      decision: "rejected",
      reason: "Revise placements",
    });
    expect(
      await t.run((ctx) => ctx.db.query("signingFrozenPreparations").collect()),
    ).toHaveLength(0);
    const layout = await admin.query(api.signingFields.get, {
      agreementId: created.agreementId,
    });
    const { approvalId: second } = await admin.mutation(
      api.signing.requestApproval,
      {
        agreementId: created.agreementId,
        expectedRevision: 1,
        expectedPreparationHash: layout.preparationHash!,
      },
    );
    await admin.mutation(api.signing.decideApproval, {
      agreementId: created.agreementId,
      approvalId: second,
      decision: "approved",
      reason: "Reviewed again",
    });
    const before = await admin.query(api.signing.get, {
      agreementId: created.agreementId,
    });
    await admin.mutation(api.signing.returnToDraft, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      reason: "Change participant capacity",
    });
    const after = await admin.query(api.signing.get, {
      agreementId: created.agreementId,
    });
    expect(after.agreement.currentBundleId).toBeUndefined();
    expect(after.agreement.currentLayoutId).toBeUndefined();
    expect(after.frozenPreparation).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get(before.frozenPreparation!.id)),
    ).toBeTruthy();
  });
  test("field and decision tampering cannot remain current after approval", async () => {
    const { admin, t, created, fields, layout, staffId } = await prepared();
    const { approvalId } = await admin.mutation(api.signing.requestApproval, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedPreparationHash: created.preparationHash,
    });
    await admin.mutation(api.signing.decideApproval, {
      agreementId: created.agreementId,
      approvalId,
      decision: "approved",
      reason: "Synthetic review",
    });
    await t.run((ctx) =>
      ctx.db.patch(layout.layoutId, {
        fields: [{ ...fields[0], x: 0.2 }, fields[1]],
      }),
    );
    await expect(
      admin.query(api.signing.get, { agreementId: created.agreementId }),
    ).rejects.toThrow(/integrity/);
    await t.run((ctx) => ctx.db.patch(layout.layoutId, { fields }));
    const approved = await admin.query(api.signing.get, {
      agreementId: created.agreementId,
    });
    await t.run((ctx) =>
      ctx.db.patch(approved.decision!._id, { decidedBy: staffId }),
    );
    expect(
      (await admin.query(api.signing.get, { agreementId: created.agreementId }))
        .approvalCurrent,
    ).toBe(false);
  });
  test.each(["missing", "reason", "timestamp", "status"])(
    "an altered %s approval decision invalidates the frozen preparation",
    async (kind) => {
      const { admin, t, created } = await prepared();
      const { approvalId } = await admin.mutation(api.signing.requestApproval, {
        agreementId: created.agreementId,
        expectedRevision: 1,
        expectedPreparationHash: created.preparationHash,
      });
      await admin.mutation(api.signing.decideApproval, {
        agreementId: created.agreementId,
        approvalId,
        decision: "approved",
        reason: "Reviewed frozen preparation",
      });
      const approved = await admin.query(api.signing.get, {
        agreementId: created.agreementId,
      });
      const decision = approved.decision!;
      await t.run(async (ctx) => {
        if (kind === "missing") await ctx.db.delete(decision._id);
        if (kind === "reason")
          await ctx.db.patch(decision._id, {
            reason: "Changed after approval",
          });
        if (kind === "timestamp")
          await ctx.db.patch(decision._id, {
            decidedAt: decision.decidedAt + 1,
          });
        if (kind === "status")
          await ctx.db.patch(decision._id, { decision: "rejected" });
      });
      expect(
        (
          await admin.query(api.signing.get, {
            agreementId: created.agreementId,
          })
        ).approvalCurrent,
      ).toBe(false);
    },
  );
  test("cached page geometry cannot change under an existing field layout", async () => {
    const { admin, t, created, bundleId } = await prepared();
    const bundle = (await t.run((ctx) => ctx.db.get(bundleId)))!;
    await t.run((ctx) =>
      ctx.db.patch(bundleId, {
        pages: bundle.pages!.map((p) => ({ ...p, rotation: 90 })),
      }),
    );
    await expect(
      admin.query(api.signingFields.get, { agreementId: created.agreementId }),
    ).rejects.toThrow(/integrity/);
  });
  test("approval binds document/manifest/policy and editing requires a fresh immutable revision", async () => {
    const { admin, created, policy } = await prepared();
    const { approvalId } = await admin.mutation(api.signing.requestApproval, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedPreparationHash: created.preparationHash,
    });
    await admin.mutation(api.signing.decideApproval, {
      agreementId: created.agreementId,
      approvalId,
      decision: "approved",
      reason: "Reviewed synthetic document",
    });
    const approved = await admin.query(api.signing.get, {
      agreementId: created.agreementId,
    });
    expect(approved.agreement.status).toBe("ready_to_send");
    expect(approved.approvalCurrent).toBe(true);
    await admin.mutation(api.signing.recordPolicy, {
      ...policy,
      expectedRevision: 1,
      consentVersion: "synthetic-v2",
    });
    expect(
      (await admin.query(api.signing.get, { agreementId: created.agreementId }))
        .approvalCurrent,
    ).toBe(false);
    expect(
      (await admin.query(api.signing.readiness, { tenantId: policy.tenantId }))
        .canIssue,
    ).toBe(false);
    await admin.mutation(api.signing.returnToDraft, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      reason: "New consent policy requires review",
    });
    const returned = await admin.query(api.signing.get, {
      agreementId: created.agreementId,
    });
    expect(returned.agreement).toMatchObject({ status: "draft", revision: 2 });
    expect(returned.approval).toBeNull();
    await expect(
      admin.mutation(api.signing.requestApproval, {
        agreementId: created.agreementId,
        expectedRevision: 2,
      }),
    ).rejects.toThrow(/PDF bundle/);
  });

  test("self approval is denied by default and changed PDF hashes cannot be approved", async () => {
    const { admin, t, policy, created, bundleId } = await prepared();
    await admin.mutation(api.signing.recordPolicy, {
      ...policy,
      expectedRevision: 1,
      allowSelfApproval: false,
    });
    created.preparationHash = (
      await admin.query(api.signingFields.get, {
        agreementId: created.agreementId,
      })
    ).preparationHash!;
    const { approvalId } = await admin.mutation(api.signing.requestApproval, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedPreparationHash: created.preparationHash,
    });
    const decision = {
      agreementId: created.agreementId,
      approvalId,
      decision: "approved" as const,
      reason: "Synthetic review",
    };
    await expect(
      admin.mutation(api.signing.decideApproval, decision),
    ).rejects.toThrow(/Another authorised/);
    await t.run((ctx) =>
      ctx.db.patch(bundleId, { storageVersion: "changed-version" }),
    );
    await expect(
      admin.mutation(api.signing.decideApproval, decision),
    ).rejects.toThrow(/Document or policy changed/);
    await t.run((ctx) =>
      ctx.db.patch(bundleId, {
        storageVersion: "synthetic-v1",
        pdfHash: "3".repeat(64),
      }),
    );
    await expect(
      admin.mutation(api.signing.decideApproval, decision),
    ).rejects.toThrow(/Document or policy changed|integrity/);
  });

  test("a different authorized administrator can approve with self-approval disabled", async () => {
    const { admin, t, created, policy, adminId } = await prepared();
    const email = "signing-reviewer@cyphersoft.test";
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", `${ADMIN_EMAIL},${email}`);
    const reviewer = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email });
      const sessionId = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: Date.now() + 3_600_000,
      });
      const credential = (await ctx.db
        .query("signingMfa")
        .withIndex("by_userId", (q) => q.eq("userId", adminId))
        .unique())!;
      const { _id, _creationTime, ...state } = credential;
      void _id;
      void _creationTime;
      await ctx.db.insert("signingMfa", {
        ...state,
        userId,
        credentialVersion: "reviewer-mfa",
      });
      await ctx.db.insert("signingMfaGrants", {
        userId,
        sessionId,
        credentialVersion: "reviewer-mfa",
        expiresAt: Date.now() + 300_000,
      });
      return { userId, sessionId };
    });
    await admin.mutation(api.signing.recordPolicy, {
      ...policy,
      expectedRevision: 1,
      allowSelfApproval: false,
    });
    const view = await admin.query(api.signingFields.get, {
      agreementId: created.agreementId,
    });
    const { approvalId } = await admin.mutation(api.signing.requestApproval, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedPreparationHash: view.preparationHash!,
    });
    const manager = t.withIdentity({
      subject: `${reviewer.userId}|${reviewer.sessionId}`,
    });
    await manager.mutation(api.signing.decideApproval, {
      agreementId: created.agreementId,
      approvalId,
      decision: "approved",
      reason: "Reviewed by another administrator",
    });
    const result = await manager.query(api.signing.get, {
      agreementId: created.agreementId,
    });
    expect(result.approvalCurrent).toBe(true);
    expect(result.decision!.decidedBy).toBe(reviewer.userId);
  });
  test("changing an approval's recorded requesting authority invalidates its protected binding", async () => {
    const { admin, t, staffId, created } = await prepared();
    const { approvalId } = await admin.mutation(api.signing.requestApproval, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      expectedPreparationHash: created.preparationHash,
    });
    await t.run((ctx) => ctx.db.patch(approvalId, { requestedBy: staffId }));
    expect(
      (await admin.query(api.signing.get, { agreementId: created.agreementId }))
        .approvalCurrent,
    ).toBe(false);
    await expect(
      admin.mutation(api.signing.decideApproval, {
        agreementId: created.agreementId,
        approvalId,
        decision: "approved",
        reason: "Synthetic review",
      }),
    ).rejects.toThrow(/Document or policy changed/);
  });

  test("checkpoint attempts publish only exact protected receipts; stale completion cannot overwrite success", async () => {
    const { admin, t, tenantId } = await setup();
    const created = await admin.mutation(api.signing.createDraft, {
      tenantId,
      requestId: "checkpoint-test",
      draft,
    });
    const checkpoint = await t.run((ctx) =>
      ctx.db
        .query("signingCheckpoints")
        .withIndex("by_agreementId_and_sequence", (q) =>
          q.eq("agreementId", created.agreementId),
        )
        .first(),
    );
    if (!checkpoint) throw new Error("Missing transactional checkpoint");
    vi.stubEnv("SIGNING_WINDMILL_BASE_URL", "https://signing-worker.test");
    vi.stubEnv("WINDMILL_WORKSPACE", "test");
    vi.stubEnv("WINDMILL_SIGNING_TOKEN", "synthetic-token");
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            payload: JSON.parse(checkpoint.snapshot),
            objectVersion: "synthetic-version-1",
            retainUntil: Date.now() + 86400000,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    await t.run((ctx) =>
      ctx.db.patch(checkpoint._id, {
        snapshot: canonicalJson({
          ...JSON.parse(checkpoint.snapshot),
          tenantId: "wrong-company",
        }),
      }),
    );
    await t.action(internal.signingCheckpoints.process, {
      checkpointId: checkpoint._id,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await t.run((ctx) => ctx.db.get(checkpoint._id)))?.status).toBe(
      "failed",
    );
    await t.run((ctx) =>
      ctx.db.patch(checkpoint._id, {
        snapshot: checkpoint.snapshot,
        status: "pending",
      }),
    );
    await t.action(internal.signingCheckpoints.process, {
      checkpointId: checkpoint._id,
    });
    expect((await t.run((ctx) => ctx.db.get(checkpoint._id)))?.status).toBe(
      "stored",
    );
    await t.mutation(internal.signingCheckpoints.finish, {
      checkpointId: checkpoint._id,
      attempt: 0,
      failed: true,
    });
    await t.action(internal.signingCheckpoints.process, {
      checkpointId: checkpoint._id,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await t.run((ctx) => ctx.db.get(checkpoint._id)))?.status).toBe(
      "stored",
    );
  });

  test("independent storage detects database rollback even when local receipts and chain are rolled back", async () => {
    const { admin, t, tenantId } = await setup();
    const created = await admin.mutation(api.signing.createDraft, {
      tenantId,
      requestId: "rollback-create",
      draft,
    });
    await admin.mutation(api.signing.updateDraft, {
      agreementId: created.agreementId,
      expectedRevision: 1,
      requestId: "rollback-update",
      draft: { ...draft, notes: "Second revision" },
    });
    const records = await t.run(async (ctx) => ({
      checkpoints: await ctx.db
        .query("signingCheckpoints")
        .withIndex("by_agreementId_and_sequence", (q) =>
          q.eq("agreementId", created.agreementId),
        )
        .take(10),
      events: await ctx.db
        .query("signingEvents")
        .withIndex("by_agreementId_and_sequence", (q) =>
          q.eq("agreementId", created.agreementId),
        )
        .take(10),
    }));
    vi.stubEnv("SIGNING_WINDMILL_BASE_URL", "https://signing-worker.test");
    vi.stubEnv("WINDMILL_WORKSPACE", "test");
    vi.stubEnv("WINDMILL_SIGNING_TOKEN", "synthetic-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              payload: JSON.parse(records.checkpoints[1].snapshot),
              objectVersion: "external-retained-version",
              retainUntil: Date.now() + 86400000,
            }),
          ),
      ),
    );
    expect(
      (
        await admin.action(api.signingCheckpoints.verify, {
          agreementId: created.agreementId,
        })
      ).status,
    ).toBe("anchored");
    await t.run(async (ctx) => {
      await ctx.db.delete(records.events[1]._id);
      for (const row of records.checkpoints) await ctx.db.delete(row._id);
      await ctx.db.patch(created.agreementId, {
        revision: 1,
        currentRevisionId: created.revisionId,
        eventCount: 1,
        lastEventHash: records.events[0].eventHash,
      });
    });
    expect(
      (
        await admin.query(api.signing.verifyAudit, {
          agreementId: created.agreementId,
        })
      ).status,
    ).toBe("consistent_unanchored");
    expect(
      (
        await admin.action(api.signingCheckpoints.verify, {
          agreementId: created.agreementId,
        })
      ).status,
    ).toBe("rollback_or_tampering_detected");
  });
});

describe("signing input and evidence contracts", () => {
  test("workflow transitions cannot skip approval, signatures or artifact validation", () => {
    expect(() => assertSigningTransition("draft", "completed")).toThrow(
      /transition/,
    );
    expect(() => assertSigningTransition("draft", "awaiting_approval")).toThrow(
      /immutable/,
    );
    expect(() =>
      assertSigningTransition("ready_to_send", "awaiting_signatures", {
        approved: true,
        frozen: true,
      }),
    ).toThrow(/prerequisites/);
    expect(() =>
      assertSigningTransition("partially_signed", "finalising"),
    ).toThrow(/signatures/);
    expect(() =>
      assertSigningTransition("finalising", "completed", { allSigned: true }),
    ).toThrow(/verified/);
    expect(() =>
      assertSigningTransition("finalising", "completed", {
        allSigned: true,
        artifactsVerified: true,
      }),
    ).not.toThrow();
    expect(() => assertSigningTransition("completed", "draft")).toThrow(
      /transition/,
    );
  });
  test("bounds and participant identity keys prevent ambiguous draft input", () => {
    expect(
      normalizeDraft({
        ...draft,
        title: "  Lease  ",
        participants: [
          { ...draft.participants[0], email: " ANN@EXAMPLE.TEST " },
        ],
      }),
    ).toMatchObject({
      title: "Lease",
      participants: [{ email: "ann@example.test" }],
    });
    expect(() =>
      normalizeDraft({
        ...draft,
        participants: [draft.participants[0], draft.participants[0]],
      }),
    ).toThrow(/unique/);
    expect(() =>
      normalizeDraft({
        ...draft,
        participants: [{ ...draft.participants[0], stage: NaN }],
      }),
    ).toThrow(/whole number/);
    expect(() =>
      normalizeDraft({
        ...draft,
        participants: [{ ...draft.participants[0], email: "bad-address" }],
      }),
    ).toThrow(/email/);
    expect(() =>
      normalizeDraft({ ...draft, notes: "x".repeat(10001) }),
    ).toThrow(/characters/);
    expect(() =>
      normalizeDraft({
        ...draft,
        participants: Array.from({ length: 21 }, (_, n) => ({
          ...draft.participants[0],
          key: `p${n}`,
        })),
      }),
    ).toThrow(/20 participants/);
  });

  test("hashes are stable across object insertion order and detect changed evidence", async () => {
    expect(canonicalJson({ b: 2, a: 1, optional: undefined })).toBe(
      '{"a":1,"b":2}',
    );
    expect(await signingHash({ b: 2, a: 1 })).toBe(
      await signingHash({ a: 1, b: 2 }),
    );
    expect(await signingHash(draft)).not.toBe(
      await signingHash({ ...draft, title: "Changed" }),
    );
    expect(() => canonicalJson({ value: NaN })).toThrow(/Unsupported/);
  });
});
