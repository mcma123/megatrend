import { ConvexError, v } from "convex/values";
import { z } from "zod";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { appendSigningEvent } from "./signingAudit";
import { canonicalJson, signingHash } from "./signing";
import { parseFrozen } from "./signingInvitations";
import type { FrozenSigning } from "./signerPortal";

export const finalisationStatus = v.union(
  v.literal("queued"),
  v.literal("submitting"),
  v.literal("running"),
  v.literal("submission_unknown"),
  v.literal("failed"),
  v.literal("completed"),
  v.literal("superseded"),
);
export const ACTIVE_FINALISATION = new Set([
  "queued",
  "submitting",
  "running",
  "submission_unknown",
]);
export const finalisationErrors = [
  "not_configured",
  "transfer_failed",
  "storage_failed",
  "source_changed",
  "result_invalid",
  "certificate_unavailable",
  "timestamp_unavailable",
  "revocation_unavailable",
  "validation_failed",
  "render_failed",
  "unsupported_text",
  "limit_exceeded",
  "finalisation_failed",
] as const;
export type FinalisationError = (typeof finalisationErrors)[number];
export const finalisationError = v.union(
  ...finalisationErrors.map((code) => v.literal(code)),
);
export const FINALISATION_MESSAGES: Record<FinalisationError, string> = {
  not_configured:
    "Finalisation storage, seal or timestamp service is not configured",
  transfer_failed: "The finalisation worker could not be reached",
  storage_failed:
    "Retained storage rejected or could not confirm the completed files",
  source_changed: "The approved document no longer matches its frozen version",
  result_invalid: "The finalisation result did not match this agreement",
  certificate_unavailable:
    "The platform seal certificate or key is unavailable or invalid",
  timestamp_unavailable: "The trusted timestamp service did not respond",
  revocation_unavailable:
    "Certificate revocation information could not be obtained",
  validation_failed:
    "The sealed document failed signature, timestamp or trust validation",
  render_failed: "Accepted values could not be placed on the document",
  unsupported_text:
    "Entries contain characters the configured document font cannot show",
  limit_exceeded: "The completed document exceeds size or time limits",
  finalisation_failed: "Finalisation failed for an unexpected reason",
};
// Transient service faults retry automatically; configuration/content faults wait for staff.
export const RETRYABLE: ReadonlySet<FinalisationError> = new Set([
  "transfer_failed",
  "storage_failed",
  "timestamp_unavailable",
  "revocation_unavailable",
  "finalisation_failed",
]);
export const RETRY_DELAYS = [5 * 60_000, 30 * 60_000, 2 * 3600_000];
export const MAX_EVIDENCE_BYTES = 900_000;

export const completedPrefix = (
  tenantId: string,
  agreementId: string,
  attemptId: string,
) => `completed/${tenantId}/${agreementId}/${attemptId}`;

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const storageVersion = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => value !== "null" && !/[\r\n]/.test(value));
export const finalResultSchema = z
  .object({
    status: z.literal("completed"),
    contractVersion: z.literal(1),
    tenantId: z.string(),
    agreementId: z.string(),
    attemptId: z.string(),
    renderer: z.string().max(100),
    evidenceHash: hash,
    evidenceVersion: storageVersion,
    pdfHash: hash,
    pdfVersion: storageVersion,
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(60 * 1024 * 1024),
    pageCount: z.number().int().positive().max(400),
    certificatePageCount: z.number().int().positive().max(50),
    sourcePdfHash: hash,
    sealedAt: z.number().int().positive(),
    validation: z
      .object({
        intact: z.literal(true),
        valid: z.literal(true),
        trusted: z.literal(true),
        revoked: z.literal(false),
        coverage: z.enum(["ENTIRE_FILE", "ENTIRE_REVISION"]),
        modificationLevel: z.enum(["NONE", "LTA_UPDATES"]),
        certified: z.literal(true),
        docmdp: z.literal("NO_CHANGES"),
        signerSubject: z.string().max(300),
        signerCertificateSha256: hash,
        signerNotAfter: z.number().int().positive(),
        timestamp: z.number().int().positive(),
        tsaSubject: z.string().max(300),
        dssCertificates: z.number().int().min(1),
        dssCrls: z.number().int().min(0),
        dssOcsps: z.number().int().min(0),
        level: z.literal("PAdES-B-LT"),
      })
      .strict()
      .refine((value) => value.dssCrls + value.dssOcsps > 0),
    pdfKey: z.string().max(500),
    evidenceKey: z.string().max(500),
    recordKey: z.string().max(500),
    recordVersion: storageVersion,
    recordHash: hash,
    retainUntil: z.number().int().positive(),
  })
  .strict();
export type FinalResult = z.infer<typeof finalResultSchema>;

export function validateFinalResult(
  row: Doc<"signingFinalisations">,
  value: unknown,
  pageCount: number,
) {
  const result = finalResultSchema.parse(value);
  const prefix = completedPrefix(row.tenantId, row.agreementId, row._id);
  if (
    result.tenantId !== row.tenantId ||
    result.agreementId !== row.agreementId ||
    result.attemptId !== row._id ||
    result.evidenceHash !== row.inputDigest ||
    result.pdfKey !== `${prefix}/signed.pdf` ||
    result.evidenceKey !== `${prefix}/evidence.json` ||
    result.recordKey !== `${prefix}/record.json` ||
    result.pageCount !== pageCount + result.certificatePageCount ||
    result.retainUntil <= Date.now() ||
    result.sealedAt < row.createdAt - 60_000 ||
    result.sealedAt > Date.now() + 60_000 ||
    result.validation.timestamp !== result.sealedAt
  )
    throw new Error("Finalisation result identity mismatch");
  const evidence = JSON.parse(row.evidence) as { bundle: { pdfHash: string } };
  if (result.sourcePdfHash !== evidence.bundle.pdfHash)
    throw new Error("Finalisation source mismatch");
  return result;
}

/**
 * Atomically claims finalisation once every signer/approver has an intact accepted submission.
 * The canonical evidence manifest is fixed here; the worker must reproduce its exact hash.
 */
export async function startFinalisation(
  ctx: MutationCtx,
  agreementId: Id<"signingAgreements">,
  requestedBy?: Id<"users">,
) {
  const agreement = await ctx.db.get(agreementId);
  if (!agreement || agreement.status !== "finalising" || agreement.completionId)
    throw new ConvexError(
      "Only an agreement awaiting finalisation can be finalised",
    );
  const current = agreement.finalisationAttemptId
    ? await ctx.db.get(agreement.finalisationAttemptId)
    : null;
  if (
    current &&
    (ACTIVE_FINALISATION.has(current.status) || current.status === "completed")
  )
    throw new ConvexError(
      "Finalisation is already running or unresolved. Reconcile it first",
    );
  const tx = agreement.signingTransactionId
    ? await ctx.db.get(agreement.signingTransactionId)
    : null;
  const frozen = tx ? await ctx.db.get(tx.frozenPreparationId) : null;
  const tenant = await ctx.db.get(agreement.tenantId);
  if (
    !tx ||
    !frozen ||
    !tenant ||
    tx.status !== "signed" ||
    tx.agreementId !== agreement._id ||
    frozen._id !== agreement.frozenPreparationId ||
    frozen.preparationHash !== tx.preparationHash ||
    (await signingHash(JSON.parse(frozen.snapshot))) !== tx.preparationHash
  )
    throw new ConvexError("Signing evidence failed its integrity check");
  const snapshot = JSON.parse(frozen.snapshot) as FrozenSigning & {
    manifestKey?: string;
    policyRevision?: number | null;
    policyHash?: string | null;
  };
  const bundle = snapshot.bundleId
    ? await ctx.db.get(ctx.db.normalizeId("signingBundles", snapshot.bundleId)!)
    : null;
  if (
    !bundle?.attemptId ||
    bundle.pdfHash !== snapshot.pdfHash ||
    bundle.storageVersion !== snapshot.storageVersion ||
    bundle.manifestHash !== snapshot.manifestHash ||
    (bundle.retainUntil ?? 0) <= Date.now()
  )
    throw new ConvexError(
      "The approved document bundle is unavailable or expired",
    );
  const parties = parseFrozen(frozen).participants;
  const invites = await ctx.db
    .query("signingInvitations")
    .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
    .take(21);
  const rows = await ctx.db
    .query("signingSubmissions")
    .withIndex("by_transactionId", (q) => q.eq("transactionId", tx._id))
    .take(200);
  const submissions = [];
  for (const party of parties.filter(
    (p) => p.responsibility === "signer" || p.responsibility === "approver",
  )) {
    const invite = invites.find((i) => i.participantKey === party.key);
    const intent = party.responsibility === "approver" ? "approve" : "sign";
    const accepted = rows.filter(
      (row) =>
        invite &&
        row.invitationId === invite._id &&
        row.invitationVersion === invite.version &&
        row.intent === intent,
    );
    const row = accepted[0];
    if (
      !invite ||
      invite.status !== "completed" ||
      accepted.length !== 1 ||
      row.preparationHash !== tx.preparationHash ||
      (await signingHash(JSON.parse(row.evidence))) !== row.submissionHash
    )
      throw new ConvexError(
        "Every required participant needs one intact accepted submission",
      );
    submissions.push({
      submissionId: row._id,
      participantKey: party.key,
      intent: row.intent,
      stage: row.stage,
      acceptedAt: row.acceptedAt,
      submissionHash: row.submissionHash,
      eventSequence: row.eventSequence,
      evidence: JSON.parse(row.evidence) as {
        marks?: { hash: string; kind: string; method: string }[];
      },
    });
  }
  const checkpoint = await ctx.db
    .query("signingCheckpoints")
    .withIndex("by_agreementId_and_sequence", (q) =>
      q.eq("agreementId", agreement._id),
    )
    .order("desc")
    .take(20)
    .then((list) => list.find((c) => c.status === "stored") ?? null);
  const attempts = await ctx.db
    .query("signingFinalisations")
    .withIndex("by_agreementId", (q) => q.eq("agreementId", agreement._id))
    .take(100);
  const attemptId = await ctx.db.insert("signingFinalisations", {
    tenantId: agreement.tenantId,
    agreementId: agreement._id,
    transactionId: tx._id,
    attempt: attempts.length + 1,
    inputDigest: "",
    evidence: "",
    status: "queued",
    checks: 0,
    createdAt: Date.now(),
    ...(requestedBy ? { requestedBy } : {}),
  });
  const evidence = {
    contractVersion: 1,
    kind: "cyphersoft-signing-evidence",
    tenantId: agreement.tenantId,
    agreementId: agreement._id,
    attemptId,
    transactionId: tx._id,
    reference: tx.reference,
    title: tx.title,
    companyName: tx.companyName,
    category: agreement.category,
    completedAt: Math.max(...submissions.map((s) => s.acceptedAt)),
    preparationHash: tx.preparationHash,
    approval: {
      frozenPreparationId: frozen._id,
      approvalId: frozen.approvalId,
      decisionId: frozen.decisionId,
      policyRevision: snapshot.policyRevision ?? null,
      policyHash: snapshot.policyHash ?? null,
      consentVersion: snapshot.consentVersion ?? null,
    },
    bundle: {
      bundleId: bundle._id,
      attemptId: bundle.attemptId,
      artifactKey: bundle.artifactKey,
      storageVersion: bundle.storageVersion,
      manifestKey: bundle.manifestKey ?? null,
      manifestVersion: bundle.manifestVersion ?? null,
      manifestHash: bundle.manifestHash,
      pdfHash: bundle.pdfHash,
    },
    pages: snapshot.pages ?? [],
    fields: snapshot.fields ?? [],
    participants: parties,
    submissions,
    marks: submissions.flatMap((s) => s.evidence.marks ?? []),
    audit: {
      eventSequence: agreement.eventCount,
      headHash: agreement.lastEventHash ?? null,
      checkpoint: checkpoint
        ? {
            sequence: checkpoint.sequence,
            headHash: checkpoint.headHash,
            status: checkpoint.status,
            objectVersion: checkpoint.objectVersion ?? null,
          }
        : null,
    },
  };
  const encoded = canonicalJson(evidence);
  if (new TextEncoder().encode(encoded).length > MAX_EVIDENCE_BYTES)
    throw new ConvexError("The evidence manifest exceeds its size limit");
  const inputDigest = await signingHash(evidence);
  await ctx.db.patch(attemptId, { evidence: encoded, inputDigest });
  await ctx.db.patch(agreement._id, { finalisationAttemptId: attemptId });
  await appendSigningEvent(
    ctx,
    agreement,
    requestedBy,
    "finalisation_requested",
    {
      attemptId,
      attempt: attempts.length + 1,
      evidenceHash: inputDigest,
    },
  );
  await ctx.scheduler.runAfter(0, internal.signingFinalisation.submit, {
    attemptId,
  });
  return attemptId;
}
