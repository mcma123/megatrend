/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { completionEffects } from "./signingPortfolio";
import { canonicalJson, normalizeDraft, signingHash } from "./lib/signing";
import { sha256Text } from "./lib/signingAccessCrypto";
import type { FunctionArgs } from "convex/server";

const modules = import.meta.glob("./**/*.ts");
// Synthetic references model already verified Phase 6 completion, never live service acceptance.
const fake = <
  T extends
    | "signingTransactions"
    | "signingFinalisations"
    | "signingFrozenPreparations"
    | "signingInvitations"
    | "signingApplications"
    | "signingBundles"
    | "signingLayouts"
    | "signingApprovals"
    | "signingApprovalDecisions",
>(
  table: T,
) => `900000000000${table}` as Id<T>;
async function fixture() {
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", "admin@portfolio.test");
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", {
      email: "admin@portfolio.test",
    });
    const session = await ctx.db.insert("authSessions", {
      userId: user,
      expirationTime: Date.now() + 3600000,
    });
    await ctx.db.insert("signingMfa", {
      userId: user,
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
      userId: user,
      sessionId: session,
      credentialVersion: "test",
      expiresAt: Date.now() + 300000,
    });
    const tenantId = await ctx.db.insert("tenants", {
      slug: "portfolio-test",
      displayName: "Company",
      status: "active",
      primaryRegion: "ZA",
      createdAt: Date.now(),
      createdBy: user,
    });
    const other = await ctx.db.insert("tenants", {
      slug: "other",
      displayName: "Other",
      status: "active",
      primaryRegion: "ZA",
      createdAt: Date.now(),
      createdBy: user,
    });
    const staff = await ctx.db.insert("users", {
      email: "reader@portfolio.test",
    });
    const client = await ctx.db.insert("users", {
      email: "client@portfolio.test",
    });
    for (const [userId, principalType, roleKey] of [
      [staff, "staff", "read_only_staff"],
      [client, "client", "client_admin"],
    ] as const)
      await ctx.db.insert("memberships", {
        tenantId,
        userId,
        principalType,
        roleKey,
        status: "active",
        createdAt: Date.now(),
        createdBy: user,
      });
    const propertyId = await ctx.db.insert("properties", {
      tenantId,
      name: "Building",
      addressLine: "1 Test",
      city: "Test",
      propertyType: "office",
      status: "active",
      features: [],
      createdAt: Date.now(),
      createdBy: user,
      updatedAt: Date.now(),
      updatedBy: user,
    });
    return { user, session, tenantId, other, staff, client, propertyId };
  });
  const admin = t.withIdentity({ subject: `${ids.user}|${ids.session}` });
  const ownerId = await admin.mutation(api.signingPortfolio.addParty, {
    tenantId: ids.tenantId,
    kind: "owner",
    name: "Owner",
    reference: "O1",
  });
  const renterId = await admin.mutation(api.signingPortfolio.addParty, {
    tenantId: ids.tenantId,
    kind: "renter",
    name: "Renter",
    reference: "R1",
  });
  const unitId = await admin.mutation(api.signingPortfolio.addUnit, {
    propertyId: ids.propertyId,
    name: "Unit 1",
  });
  const draft = {
    title: "Lease",
    category: "commercial_lease" as const,
    propertyId: ids.propertyId,
    notes: "",
    participants: [
      {
        key: "owner",
        name: "Owner",
        email: "owner@example.test",
        role: "Owner",
        responsibility: "signer" as const,
        stage: 1,
      },
      {
        key: "renter",
        name: "Renter",
        email: "renter@example.test",
        role: "Renter",
        responsibility: "signer" as const,
        stage: 1,
      },
    ],
  };
  const created = await admin.mutation(api.signing.createDraft, {
    tenantId: ids.tenantId,
    requestId: "portfolio-fixture",
    draft,
  });
  const completionId = await t.run(async (ctx) => {
    const completionId = await ctx.db.insert("signingCompletions", {
      tenantId: ids.tenantId,
      agreementId: created.agreementId,
      transactionId: fake("signingTransactions"),
      finalisationId: fake("signingFinalisations"),
      evidenceHash: "e".repeat(64),
      evidenceKey: "e",
      evidenceVersion: "ev",
      pdfKey: "p",
      pdfVersion: "pv",
      pdfHash: "a".repeat(64),
      sizeBytes: 100,
      pageCount: 1,
      certificatePageCount: 1,
      recordKey: "r",
      recordVersion: "rv",
      recordHash: "b".repeat(64),
      retainUntil: Date.now() + 86400000,
      validation: "{}",
      sealedAt: Date.now(),
      completedAt: Date.now(),
    });
    await ctx.db.patch(created.agreementId, {
      status: "completed",
      completionId,
    });
    return completionId;
  });
  const context = {
    unitId,
    ownerId,
    renterId,
    participantLinks: [
      { key: "owner", partyId: ownerId },
      { key: "renter", partyId: renterId },
    ],
  };
  const input: FunctionArgs<typeof api.signingPortfolio.preview> = {
    agreementId: created.agreementId,
    mode: "create",
    context,
    terms: {
      startDate: "2027-01-01",
      endDate: "2027-12-31",
      monthlyRent: "1234.56",
      deposit: "2000.00",
      escalationPercent: 5,
      noticePeriodMonths: 2,
    },
    plan: {
      payments: [
        { purpose: "Deposit", amount: "2000.00", dueDate: "2026-12-20" },
      ],
      moveInDueDate: "2026-12-21",
      renewalReminders: true,
    },
    reason: "Reviewed synthetic completed PDF",
  };
  return {
    t,
    admin,
    ...ids,
    ...created,
    completionId,
    input,
    draft,
    reader: t.withIdentity({ subject: `${ids.staff}|reader-session` }),
    customer: t.withIdentity({ subject: `${ids.client}|client-session` }),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("reviewed application is permanently idempotent, exact-cent and pending; task closure cannot recreate effects", async () => {
  const f = await fixture();
  const preview = await f.admin.query(api.signingPortfolio.preview, f.input);
  const result = await f.admin.mutation(api.signingPortfolio.apply, {
    ...f.input,
    expectedReviewHash: preview.reviewHash,
  });
  await f.t.run(async (ctx) => {
    for (const action of await ctx.db.query("actions").collect())
      await ctx.db.patch(action._id, { status: "completed" });
  });
  expect(
    await f.admin.mutation(api.signingPortfolio.apply, {
      ...f.input,
      expectedReviewHash: preview.reviewHash,
    }),
  ).toEqual(result);
  const state = await f.admin.query(api.signingPortfolio.state, {
    agreementId: f.agreementId,
  });
  expect(state.lease).toMatchObject({
    status: "pending",
    monthlyRental: 1234.56,
    depositCents: 200000,
  });
  expect(state).toMatchObject({
    signed: true,
    active: false,
    occupationAuthorised: false,
  });
  expect(state.payments).toHaveLength(1);
  expect(
    await f.t.run((ctx) => ctx.db.query("actions").collect()),
  ).toHaveLength(1);
  await expect(
    f.admin.mutation(api.signingPortfolio.apply, {
      ...f.input,
      expectedReviewHash: "different",
    }),
  ).rejects.toThrow("already applied");
});
test("completion effects survive closed tasks and never change a lease or create payments", async () => {
  const f = await fixture();
  for (let n = 0; n < 2; n++)
    await f.t.run(async (ctx) => {
      const agreement = (await ctx.db.get(f.agreementId))!;
      await completionEffects(ctx, agreement, f.completionId);
      for (const action of await ctx.db.query("actions").collect())
        await ctx.db.patch(action._id, { status: "cancelled" });
    });
  expect(
    await f.t.run((ctx) => ctx.db.query("actions").collect()),
  ).toHaveLength(1);
  expect(
    await f.t.run((ctx) => ctx.db.query("notifications").collect()),
  ).toHaveLength(1); // admin only; read-only staff excluded by shared recipient policy
  expect(await f.t.run((ctx) => ctx.db.query("leases").collect())).toHaveLength(
    0,
  );
  expect(
    await f.t.run((ctx) => ctx.db.query("signingPayments").collect()),
  ).toHaveLength(0);
});
test("company isolation, reader restrictions, explicit participant mapping and MFA fail closed", async () => {
  const f = await fixture();
  await expect(
    f.customer.query(api.signingPortfolio.catalog, { tenantId: f.tenantId }),
  ).rejects.toThrow();
  await expect(
    f.reader.query(api.signingPortfolio.catalog, { tenantId: f.other }),
  ).rejects.toThrow();
  await expect(
    f.reader.mutation(api.signingPortfolio.addParty, {
      tenantId: f.tenantId,
      kind: "owner",
      name: "x",
      reference: "x",
    }),
  ).rejects.toThrow();
  const otherOwner = await f.admin.mutation(api.signingPortfolio.addParty, {
    tenantId: f.other,
    kind: "owner",
    name: "Other",
    reference: "O",
  });
  await expect(
    f.admin.query(api.signingPortfolio.preview, {
      ...f.input,
      context: { ...f.input.context, ownerId: otherOwner },
    }),
  ).rejects.toThrow("belonging");
  await expect(
    f.admin.query(api.signingPortfolio.preview, {
      ...f.input,
      context: { ...f.input.context, participantLinks: [] },
    }),
  ).rejects.toThrow("Participant");
  const preview = await f.admin.query(api.signingPortfolio.preview, f.input);
  await f.t.run(async (ctx) => {
    for (const row of await ctx.db.query("signingMfaGrants").collect())
      await ctx.db.delete(row._id);
  });
  await expect(
    f.admin.mutation(api.signingPortfolio.apply, {
      ...f.input,
      expectedReviewHash: preview.reviewHash,
    }),
  ).rejects.toThrow();
});
test("payment evidence, activation and occupation are independent and ordinary lease edit cannot bypass approval", async () => {
  const f = await fixture();
  const preview = await f.admin.query(api.signingPortfolio.preview, f.input);
  const applied = await f.admin.mutation(api.signingPortfolio.apply, {
    ...f.input,
    expectedReviewHash: preview.reviewHash,
  });
  let state = await f.admin.query(api.signingPortfolio.state, {
    agreementId: f.agreementId,
  });
  await f.admin.mutation(api.signingPortfolio.recordPayment, {
    paymentId: state.payments[0]._id,
    reference: "bank evidence 1",
  });
  await f.admin.mutation(api.signingPortfolio.recordPayment, {
    paymentId: state.payments[0]._id,
    reference: "bank evidence 1",
  });
  await expect(
    f.admin.mutation(api.signingPortfolio.recordPayment, {
      paymentId: state.payments[0]._id,
      reference: "different",
    }),
  ).rejects.toThrow("already recorded");
  state = await f.admin.query(api.signingPortfolio.state, {
    agreementId: f.agreementId,
  });
  expect(state.active).toBe(false);
  expect(state.occupationAuthorised).toBe(false);
  await expect(
    f.admin.mutation(api.leases.update, {
      leaseId: applied.leaseId,
      startDate: "2027-01-01",
      endDate: "2027-12-31",
      monthlyRental: 1,
      status: "active",
    }),
  ).rejects.toThrow("portfolio approval");
  const decision = {
    leaseId: applied.leaseId,
    applicationId: applied.applicationId,
    kind: "activate" as const,
    reason: "Explicit review",
    requestId: "activation-1",
  };
  expect(
    await f.admin.mutation(api.signingPortfolio.decideLease, decision),
  ).toEqual(await f.admin.mutation(api.signingPortfolio.decideLease, decision));
  state = await f.admin.query(api.signingPortfolio.state, {
    agreementId: f.agreementId,
  });
  expect(state.active).toBe(true);
  expect(state.occupationAuthorised).toBe(false);
  await f.admin.mutation(api.signingPortfolio.decideLease, {
    ...decision,
    kind: "occupation",
    requestId: "occupation-1",
  });
  expect(
    (
      await f.admin.query(api.signingPortfolio.state, {
        agreementId: f.agreementId,
      })
    ).occupationAuthorised,
  ).toBe(true);
});
test("amendment rejects stale review and stores prior values; renewal links predecessor without activating either", async () => {
  const f = await fixture();
  const lease = await f.admin.mutation(api.leases.create, {
    propertyId: f.propertyId,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    monthlyRental: 100,
    status: "active",
  });
  const input = {
    ...f.input,
    mode: "amend" as const,
    targetLeaseId: lease.leaseId,
  };
  const stale = await f.admin.query(api.signingPortfolio.preview, input);
  await f.t.run((ctx) => ctx.db.patch(lease.leaseId, { monthlyRental: 150 }));
  await expect(
    f.admin.mutation(api.signingPortfolio.apply, {
      ...input,
      expectedReviewHash: stale.reviewHash,
    }),
  ).rejects.toThrow("Review changed");
  const fresh = await f.admin.query(api.signingPortfolio.preview, input);
  const applied = await f.admin.mutation(api.signingPortfolio.apply, {
    ...input,
    expectedReviewHash: fresh.reviewHash,
  });
  expect(
    JSON.parse(
      (await f.t.run((ctx) => ctx.db.get(applied.applicationId)))!.before!,
    ).monthlyRental,
  ).toBe(150);
  expect((await f.t.run((ctx) => ctx.db.get(lease.leaseId)))!.status).toBe(
    "active",
  );
  const g = await fixture();
  const predecessor = await g.admin.mutation(api.leases.create, {
    propertyId: g.propertyId,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    monthlyRental: 100,
    status: "active",
  });
  const renewal = {
    ...g.input,
    mode: "renew" as const,
    targetLeaseId: predecessor.leaseId,
  };
  const reviewed = await g.admin.query(api.signingPortfolio.preview, renewal);
  const next = await g.admin.mutation(api.signingPortfolio.apply, {
    ...renewal,
    expectedReviewHash: reviewed.reviewHash,
  });
  expect(
    (await g.t.run((ctx) => ctx.db.get(predecessor.leaseId)))!.status,
  ).toBe("active");
  expect((await g.t.run((ctx) => ctx.db.get(next.leaseId)))!.status).toBe(
    "pending",
  );
  await g.admin.mutation(api.signingPortfolio.decideLease, {
    leaseId: next.leaseId,
    applicationId: next.applicationId,
    kind: "activate",
    reason: "Renewal activation",
    requestId: "renewal-activation",
  });
  expect(
    (await g.t.run((ctx) => ctx.db.get(predecessor.leaseId)))!.status,
  ).toBe("renewed");
});
test("new draft relationships are revision-bound; absent fields preserve legacy hashes", async () => {
  const f = await fixture();
  expect(normalizeDraft(f.draft)).not.toHaveProperty("portfolioContext");
  const created = await f.admin.mutation(api.signing.createDraft, {
    tenantId: f.tenantId,
    requestId: "linked-draft",
    draft: { ...f.draft, portfolioContext: f.input.context },
  });
  const data = await f.admin.query(api.signing.get, {
    agreementId: created.agreementId,
  });
  expect(data.revision.portfolioContext).toEqual(f.input.context);
  expect(data.revision.contentHash).not.toBe(
    await signingHash({
      contractVersion: 1,
      tenantId: f.tenantId,
      ...normalizeDraft(f.draft),
    }),
  );
});
test("reports aggregate beyond one page, use complete company cohort and exclude unfinished turnaround", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    for (let n = 0; n < 29; n++)
      await ctx.db.insert("signingAgreements", {
        tenantId: f.tenantId,
        title: "Synthetic",
        category: "general_contract",
        status: "draft",
        revision: 0,
        createdAt: Date.now(),
        createdBy: f.user,
        updatedAt: Date.now(),
        updatedBy: f.user,
        eventCount: 0,
      });
    await ctx.db.insert("signingAgreements", {
      tenantId: f.other,
      title: "Excluded",
      category: "general_contract",
      status: "draft",
      revision: 0,
      createdAt: Date.now(),
      createdBy: f.user,
      updatedAt: Date.now(),
      updatedBy: f.user,
      eventCount: 0,
    });
  });
  const result = await f.admin.action(api.signingReports.run, {
    tenantId: f.tenantId,
    from: 0,
    to: Date.now() + 10000,
  });
  expect(result.agreements).toBe(30);
  expect(result.completed).toBe(1);
  expect(result.medianTurnaroundMs).toBeNull();
  await f.t.run(async (ctx) => {
    const completion = (await ctx.db.get(f.completionId))!;
    const transactionId = await ctx.db.insert("signingTransactions", {
      tenantId: f.tenantId,
      agreementId: f.agreementId,
      frozenPreparationId: fake("signingFrozenPreparations"),
      preparationHash: "frozen",
      reference: "report-fixture",
      requestId: "report-fixture",
      status: "completed",
      currentStage: 1,
      expiresAt: Date.now() + 86400000,
      companyName: "Company",
      title: "Lease",
      createdAt: completion.completedAt - 60000,
      createdBy: f.user,
    });
    await ctx.db.patch(f.agreementId, { signingTransactionId: transactionId });
    await ctx.db.patch(f.completionId, { transactionId });
  });
  const timed = await f.admin.action(api.signingReports.run, {
    tenantId: f.tenantId,
    from: 0,
    to: Date.now() + 10000,
  });
  expect(timed.medianTurnaroundMs).toBe(60000);
  await f.t.run(async (ctx) => {
    const agreement = (await ctx.db.get(f.agreementId))!;
    const transactionId = agreement.signingTransactionId!;
    const frozenPreparationId = await ctx.db.insert(
      "signingFrozenPreparations",
      {
        tenantId: f.tenantId,
        agreementId: f.agreementId,
        revisionId: f.revisionId,
        bundleId: fake("signingBundles"),
        layoutId: fake("signingLayouts"),
        approvalId: fake("signingApprovals"),
        decisionId: fake("signingApprovalDecisions"),
        policyRevision: 1,
        preparationHash: "fixture",
        snapshot: canonicalJson({ participants: f.draft.participants }),
        eventSequence: 1,
        createdAt: Date.now(),
        createdBy: f.user,
      },
    );
    await ctx.db.patch(transactionId, {
      frozenPreparationId,
      status: "active",
    });
    await ctx.db.patch(f.agreementId, { status: "partially_signed" });
    for (const party of f.draft.participants) {
      const done = party.key === "owner";
      const invitationId = await ctx.db.insert("signingInvitations", {
        tenantId: f.tenantId,
        agreementId: f.agreementId,
        transactionId,
        frozenPreparationId,
        participantKey: party.key,
        version: 1,
        nonce: "private-link-secret",
        keyId: "test",
        tokenHash: "private-token-hash",
        status: done ? "completed" : "active",
        expiresAt: Date.now() + 86400000,
        createdAt: Date.now(),
        failedAttempts: 0,
        lockedUntil: 0,
        lastEmailAt: Date.now(),
        ...(done ? { verifiedAt: Date.now(), completedAt: Date.now() } : {}),
      });
      const mail = {
        deliveryKey: `report-${party.key}`,
        participantKey: party.key,
        kind: "invitation" as const,
        keyId: "test",
        recipientHash: "private-recipient-hash",
        expectedFrom: "test@example.test",
        payloadExpiresAt: Date.now() + 86400000,
        invitationVersion: 1,
        tenantId: f.tenantId,
        agreementId: f.agreementId,
        transactionId,
        invitationId,
        createdAt: Date.now(),
        checks: 0,
        payloadDigest: "fixture",
      };
      await ctx.db.insert("signingDeliveries", {
        ...mail,
        status: done ? "accepted" : "failed",
        acceptedAt: Date.now(),
        ...(done ? { deliveredAt: Date.now() } : { bouncedAt: Date.now() }),
      });
      if (!done)
        await ctx.db.insert("signingDeliveries", {
          ...mail,
          deliveryKey: "report-unknown",
          status: "unknown",
        });
    }
  });
  const delivery = await f.admin.action(api.signingReports.run, {
    tenantId: f.tenantId,
    from: 0,
    to: Date.now() + 10000,
  });
  expect(delivery).toMatchObject({
    agreements: 30,
    completed: 0,
    outstanding: 1,
    verified: 1,
    providerAccepted: 2,
    delivered: 1,
    failed: 1,
    unresolved: 1,
    medianTurnaroundMs: null,
  });
  expect(JSON.stringify(delivery)).not.toContain("private-");
  await expect(
    f.customer.action(api.signingReports.run, {
      tenantId: f.tenantId,
      from: 0,
      to: Date.now(),
    }),
  ).rejects.toThrow();
});
test("departure export snapshots once, excludes credentials and reconciles the same owned job", async () => {
  const f = await fixture();
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Synthetic outage");
    }),
  );
  vi.stubEnv("WINDMILL_SIGNING_EXPORT_TOKEN", "synthetic");
  vi.stubEnv("SIGNING_WINDMILL_BASE_URL", "https://worker.example.test");
  vi.stubEnv("WINDMILL_WORKSPACE", "test");
  const id = await f.admin.mutation(api.signingExports.request, {
    tenantId: f.tenantId,
    requestId: "export-1",
    reason: "Company departure",
  });
  expect(
    await f.admin.mutation(api.signingExports.request, {
      tenantId: f.tenantId,
      requestId: "export-1",
      reason: "Company departure",
    }),
  ).toBe(id);
  const row = (await f.t.run((ctx) => ctx.db.get(id)))!;
  expect(JSON.parse(row.snapshot).records.company._id).toBe(f.tenantId);
  expect(row.snapshot).not.toContain("encryptedSecret");
  expect(row.snapshot).not.toContain("tokenHash");
  await f.t.run((ctx) =>
    ctx.db.patch(f.propertyId, { name: "Changed after snapshot" }),
  );
  expect((await f.t.run((ctx) => ctx.db.get(id)))!.snapshot).toBe(row.snapshot);
  expect(await signingHash(JSON.parse(row.snapshot))).toBe(row.snapshotHash);
  await expect(
    f.customer.action(api.signingExports.download, { exportId: id }),
  ).rejects.toThrow();
  await f.t.mutation(internal.signingExports.mark, {
    exportId: id,
    jobId: "wrong",
    status: "ready",
    volumes: "[]",
  });
  expect((await f.t.run((ctx) => ctx.db.get(id)))!.status).toBe("queued");
  await expect(
    f.t.mutation(internal.signingExports.mark, {
      exportId: id,
      jobId: row.jobId,
      status: "ready",
      volumes: canonicalJson([
        { part: 2, sha256: "x", version: "null", sizeBytes: 0 },
      ]),
    }),
  ).rejects.toThrow("Invalid export receipt");
  const fetchMock = vi.mocked(fetch);
  await f.t.action(internal.signingExports.submit, { exportId: id });
  await f.t.action(internal.signingExports.submit, { exportId: id });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((await f.t.run((ctx) => ctx.db.get(id)))!.jobId).toBe(row.jobId);
  expect((await f.t.run((ctx) => ctx.db.get(id)))!.status).toBe("unknown");
  const volumes = [
    { part: 0, sha256: "f".repeat(64), version: "v1", sizeBytes: 100 },
  ];
  fetchMock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          id: row.jobId,
          script_path: "wrong/script",
          args: {
            operation: "build",
            tenant_id: f.tenantId,
            export_id: id,
            snapshot_hash: row.snapshotHash,
          },
          success: true,
          result: { status: "ready", snapshotHash: row.snapshotHash, volumes },
        }),
      ),
  );
  await f.t.action(internal.signingExports.poll, { exportId: id });
  expect((await f.t.run((ctx) => ctx.db.get(id)))!.status).toBe("unknown");
  fetchMock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          id: row.jobId,
          script_path: "f/signing/export_company",
          args: {
            operation: "build",
            tenant_id: f.tenantId,
            export_id: id,
            snapshot_hash: row.snapshotHash,
          },
          success: true,
          result: { status: "ready", snapshotHash: row.snapshotHash, volumes },
        }),
      ),
  );
  await f.t.action(internal.signingExports.poll, { exportId: id });
  expect((await f.t.run((ctx) => ctx.db.get(id)))!.status).toBe("ready");
});

test("concurrent reviewed replays create one application and changed payloads cannot reuse its review hash", async () => {
  const f = await fixture();
  const preview = await f.admin.query(api.signingPortfolio.preview, f.input);
  const args = { ...f.input, expectedReviewHash: preview.reviewHash };
  const results = await Promise.all([
    f.admin.mutation(api.signingPortfolio.apply, args),
    f.admin.mutation(api.signingPortfolio.apply, args),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(
    await f.t.run((ctx) => ctx.db.query("signingApplications").collect()),
  ).toHaveLength(1);
  await expect(
    f.admin.mutation(api.signingPortfolio.apply, {
      ...args,
      reason: "Changed request with stale hash",
    }),
  ).rejects.toThrow("already applied");
});
test("review feedback preserves invalid input without writes; activation blocks overlapping leases for the same unit", async () => {
  const f = await fixture();
  const invalid = await f.admin.query(api.signingPortfolio.reviewFeedback, {
    ...f.input,
    terms: { ...f.input.terms, startDate: "2027-02-30" },
  });
  expect(invalid.preview).toBeNull();
  expect(invalid.error).toContain("valid date");
  const preview = await f.admin.query(api.signingPortfolio.preview, f.input);
  const applied = await f.admin.mutation(api.signingPortfolio.apply, {
    ...f.input,
    expectedReviewHash: preview.reviewHash,
  });
  await f.t.run(async (ctx) => {
    const original = (await ctx.db.get(applied.leaseId))!;
    const { _id: _id, _creationTime: _time, ...copy } = original;
    await ctx.db.insert("leases", { ...copy, status: "active" });
  });
  await expect(
    f.admin.mutation(api.signingPortfolio.decideLease, {
      leaseId: applied.leaseId,
      applicationId: applied.applicationId,
      kind: "activate",
      reason: "Review",
      requestId: "activate",
    }),
  ).rejects.toThrow("overlapping");
  expect(
    (
      await f.admin.query(api.signingPortfolio.state, {
        agreementId: f.agreementId,
      })
    ).active,
  ).toBe(false);
  await f.t.run((ctx) =>
    ctx.db.patch(applied.leaseId, {
      signingApplicationId: fake("signingApplications"),
    }),
  );
  await expect(
    f.admin.mutation(api.signingPortfolio.decideLease, {
      leaseId: applied.leaseId,
      applicationId: applied.applicationId,
      kind: "occupation",
      reason: "Stale tab",
      requestId: "stale-approval",
    }),
  ).rejects.toThrow("application changed");
});

test("handover includes only accepted-version signature images, detects tampering and inventories legitimate purges", async () => {
  const f = await fixture();
  vi.useFakeTimers();
  vi.stubEnv("WINDMILL_SIGNING_EXPORT_TOKEN", "synthetic");
  vi.stubEnv("SIGNING_WINDMILL_BASE_URL", "https://worker.example.test");
  vi.stubEnv("WINDMILL_WORKSPACE", "test");
  const png = "c3ludGhldGlj",
    hash = await sha256Text(`signature:${png}`);
  const markId = await f.t.run(async (ctx) => {
    const transactionId = await ctx.db.insert("signingTransactions", {
      tenantId: f.tenantId,
      agreementId: f.agreementId,
      frozenPreparationId: fake("signingFrozenPreparations"),
      preparationHash: "frozen",
      reference: "handover-fixture",
      requestId: "handover-fixture",
      status: "completed",
      currentStage: 1,
      expiresAt: Date.now() + 86400000,
      companyName: "Company",
      title: "Lease",
      createdAt: Date.now(),
      createdBy: f.user,
    });
    await ctx.db.patch(f.agreementId, { signingTransactionId: transactionId });
    const image = {
      transactionId,
      invitationId: fake("signingInvitations"),
      participantKey: "owner",
      kind: "signature" as const,
      method: "drawn" as const,
      png,
      imageHash: hash,
      width: 100,
      height: 50,
      createdAt: Date.now(),
    };
    await ctx.db.insert("signingMarks", { ...image, invitationVersion: 1 });
    const id = await ctx.db.insert("signingMarks", {
      ...image,
      invitationVersion: 2,
    });
    await ctx.db.insert("signingSubmissions", {
      tenantId: f.tenantId,
      agreementId: f.agreementId,
      transactionId,
      invitationId: fake("signingInvitations"),
      invitationVersion: 2,
      participantKey: "owner",
      intent: "sign",
      requestKey: "synthetic",
      stage: 1,
      preparationHash: "frozen",
      evidence: canonicalJson({ marks: [{ hash }] }),
      submissionHash: "synthetic",
      acceptedAt: Date.now(),
      eventSequence: 1,
    });
    return id;
  });
  const exportId = await f.admin.mutation(api.signingExports.request, {
    tenantId: f.tenantId,
    requestId: "mark-export-1",
    reason: "Synthetic handover",
  });
  const snapshot = JSON.parse(
    (await f.t.run((ctx) => ctx.db.get(exportId)))!.snapshot,
  );
  expect(snapshot.records.agreements[0].acceptedMarks).toHaveLength(1);
  expect(
    snapshot.records.agreements[0].acceptedMarks[0].invitationVersion,
  ).toBe(2);
  await f.t.run((ctx) => ctx.db.patch(markId, { png: "tampered" }));
  await expect(
    f.admin.mutation(api.signingExports.request, {
      tenantId: f.tenantId,
      requestId: "mark-export-2",
      reason: "Synthetic handover",
    }),
  ).rejects.toThrow("integrity");
  await f.t.run(async (ctx) => {
    for (const mark of await ctx.db.query("signingMarks").collect())
      await ctx.db.delete(mark._id);
    await ctx.db.patch(f.agreementId, { transientPurgedAt: Date.now() });
  });
  const purgedId = await f.admin.mutation(api.signingExports.request, {
    tenantId: f.tenantId,
    requestId: "mark-export-3",
    reason: "Synthetic handover",
  });
  expect(
    JSON.parse((await f.t.run((ctx) => ctx.db.get(purgedId)))!.snapshot)
      .unavailable[0].reason,
  ).toContain("purged under retention");
});
