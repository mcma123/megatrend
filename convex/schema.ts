import { authTables } from "@convex-dev/auth/server";
import {
  portfolioContext,
  applicationMode,
  leaseTerms,
  downstreamPlan,
} from "./lib/signingPortfolio";
import { fieldDefinition } from "./lib/signingFields";
import {
  emailKind,
  deliveryStatus,
  invitationStatus as signingInvitationStatus,
} from "./lib/signingInvitations";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { attachmentPurpose } from "./lib/signingFields";
import {
  signingCategory,
  signingStatus,
  participantResponsibility,
  participantExtras,
  signatureMethod,
  identityDocument,
} from "./lib/signing";
import {
  fileRole,
  preparationStatus,
  preparationError,
  pageGeometry,
  sourceReport,
} from "./lib/signingPreparation";
import {
  finalisationError,
  finalisationStatus,
} from "./lib/signingFinalisation";
import { releaseMode } from "./lib/signingRelease";
import {
  templateCondition,
  templateField,
  templateKind,
  versionStatus,
} from "./lib/signingTemplates";
import {
  signerIntent,
  signerMarkKind,
  signerMarkMethod,
} from "./lib/signerPortal";
import {
  auditActorType,
  clientRelationshipStatus,
  actionSource,
  actionStatus,
  anomalyKind,
  anomalyStatus,
  automationKey,
  automationRunMode,
  clientType,
  documentSource,
  documentStatus,
  documentType,
  processingStages,
  processingStageName,
  processingStage,
  extractedFieldState,
  insightCategory,
  insightStatus,
  invoiceKind,
  leaseStatus,
  priority,
  propertyStatus,
  propertyType,
  invitationStatus,
  membershipStatus,
  organizationStatus,
  principalType,
  roleKey,
  roleScope,
  sourceSystem,
  tenantStatus,
} from "./validators";

export default defineSchema({
  ...authTables,

  portfolioParties: defineTable({
    tenantId: v.id("tenants"),
    kind: v.union(v.literal("owner"), v.literal("renter")),
    name: v.string(),
    reference: v.string(),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_tenantId", ["tenantId"]),
  portfolioUnits: defineTable({
    tenantId: v.id("tenants"),
    propertyId: v.id("properties"),
    name: v.string(),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_tenantId", ["tenantId"]),
  signingApplications: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    completionId: v.id("signingCompletions"),
    mode: applicationMode,
    context: portfolioContext,
    terms: leaseTerms,
    plan: downstreamPlan,
    leaseId: v.id("leases"),
    predecessorId: v.optional(v.id("leases")),
    before: v.optional(v.string()),
    reviewHash: v.string(),
    requestHash: v.string(),
    reason: v.string(),
    approvedAt: v.number(),
    approvedBy: v.id("users"),
  })
    .index("by_agreementId", ["agreementId"])
    .index("by_tenantId", ["tenantId"]),
  signingEffects: defineTable({
    tenantId: v.id("tenants"),
    key: v.string(),
    fingerprint: v.string(),
    resultId: v.string(),
    createdAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_tenantId", ["tenantId"]),
  signingPayments: defineTable({
    tenantId: v.id("tenants"),
    applicationId: v.id("signingApplications"),
    leaseId: v.id("leases"),
    purpose: v.string(),
    amountCents: v.number(),
    currency: v.literal("ZAR"),
    dueDate: v.string(),
    approvedBy: v.id("users"),
    approvedAt: v.number(),
    paidAt: v.optional(v.number()),
    paidBy: v.optional(v.id("users")),
    paymentReference: v.optional(v.string()),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_applicationId", ["applicationId"]),
  signingLeaseDecisions: defineTable({
    tenantId: v.id("tenants"),
    leaseId: v.id("leases"),
    applicationId: v.id("signingApplications"),
    kind: v.union(v.literal("activate"), v.literal("occupation")),
    reason: v.string(),
    approvedAt: v.number(),
    approvedBy: v.id("users"),
    requestId: v.string(),
  }).index("by_leaseId", ["leaseId"]),
  signingExports: defineTable({
    tenantId: v.id("tenants"),
    requestId: v.string(),
    reason: v.string(),
    createdAt: v.number(),
    createdBy: v.id("users"),
    snapshot: v.string(),
    snapshotHash: v.string(),
    jobId: v.string(),
    checks: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("unknown"),
      v.literal("failed"),
      v.literal("ready"),
    ),
    error: v.optional(v.string()),
    volumes: v.optional(v.string()),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_requestId", ["tenantId", "requestId"]),

  // Signing records are separate from OCR documents and operational lease status.
  signingAgreements: defineTable({
    tenantId: v.id("tenants"),
    title: v.string(),
    category: signingCategory,
    propertyId: v.optional(v.id("properties")),
    leaseId: v.optional(v.id("leases")),
    status: signingStatus,
    revision: v.number(),
    currentRevisionId: v.optional(v.id("signingRevisions")),
    createdAt: v.number(),
    createdBy: v.id("users"),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
    eventCount: v.number(),
    lastEventHash: v.optional(v.string()),
    voidReason: v.optional(v.string()),
    approvalId: v.optional(v.id("signingApprovals")),
    approvalPolicyRevision: v.optional(v.number()),
    fileRevision: v.optional(v.number()),
    currentBundleId: v.optional(v.id("signingBundles")),
    bundleAttemptId: v.optional(v.id("signingPreparations")),
    layoutRevision: v.optional(v.number()),
    currentLayoutId: v.optional(v.id("signingLayouts")),
    frozenPreparationId: v.optional(v.id("signingFrozenPreparations")),
    signingTransactionId: v.optional(v.id("signingTransactions")),
    finalisationAttemptId: v.optional(v.id("signingFinalisations")),
    completionId: v.optional(v.id("signingCompletions")),
    // Replacement links preserve both agreements and their evidence; neither is edited in place.
    replacesAgreementId: v.optional(v.id("signingAgreements")),
    replacedByAgreementId: v.optional(v.id("signingAgreements")),
    transientPurgedAt: v.optional(v.number()),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_createdAt", ["tenantId", "createdAt"])
    .index("by_tenantId_and_status", ["tenantId", "status"])
    .index("by_status", ["status"]),

  // Draft revision snapshots are immutable; they are not frozen issued PDF versions.
  signingRevisions: defineTable({
    agreementId: v.id("signingAgreements"),
    tenantId: v.id("tenants"),
    revision: v.number(),
    title: v.string(),
    category: signingCategory,
    propertyId: v.optional(v.id("properties")),
    leaseId: v.optional(v.id("leases")),
    notes: v.string(),
    signatureMethod: v.optional(signatureMethod),
    portfolioContext: v.optional(portfolioContext),
    contentHash: v.string(),
    participantCount: v.number(),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_agreementId_and_revision", ["agreementId", "revision"]),

  signingParticipants: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    revisionId: v.id("signingRevisions"),
    key: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.string(),
    responsibility: participantResponsibility,
    stage: v.number(),
    position: v.number(),
    ...participantExtras,
  }).index("by_revisionId", ["revisionId"]),

  signingPolicies: defineTable({
    tenantId: v.id("tenants"),
    revision: v.number(),
    jurisdiction: v.literal("ZA"),
    legalReviewReference: v.string(),
    privacyNoticeReference: v.string(),
    retentionPolicyReference: v.string(),
    consentVersion: v.string(),
    allowedCategories: v.array(signingCategory),
    approvalRequired: v.boolean(),
    allowSelfApproval: v.optional(v.boolean()),
    signerContact: v.optional(v.string()),
    witnessingReference: v.optional(v.string()),
    transientRetentionDays: v.optional(v.number()),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  }).index("by_tenantId", ["tenantId"]),

  signingEvents: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    sequence: v.number(),
    eventType: v.string(),
    actorId: v.optional(v.id("users")),
    actorKind: v.optional(v.union(v.literal("provider"), v.literal("signer"))),
    participantKey: v.optional(v.string()),
    occurredAt: v.number(),
    revision: v.number(),
    payload: v.string(),
    previousHash: v.optional(v.string()),
    eventHash: v.string(),
  }).index("by_agreementId_and_sequence", ["agreementId", "sequence"]),

  signingRequests: defineTable({
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    requestId: v.string(),
    fingerprint: v.string(),
    agreementId: v.id("signingAgreements"),
    revisionId: v.id("signingRevisions"),
    revision: v.number(),
    createdAt: v.number(),
  }).index("by_tenantId_and_actorId_and_requestId", [
    "tenantId",
    "actorId",
    "requestId",
  ]),

  signingMfa: defineTable({
    userId: v.id("users"),
    credentialVersion: v.string(),
    keyId: v.string(),
    encryptedSecret: v.string(),
    enabled: v.boolean(),
    enrollmentExpiresAt: v.number(),
    recoveryHashes: v.array(v.string()),
    failedAttempts: v.number(),
    lockedUntil: v.number(),
    lastAttemptAt: v.number(),
    lastAcceptedStep: v.optional(v.number()),
    claimId: v.optional(v.string()),
    claimExpiresAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),
  signingMfaGrants: defineTable({
    userId: v.id("users"),
    sessionId: v.id("authSessions"),
    credentialVersion: v.string(),
    expiresAt: v.number(),
  }).index("by_sessionId", ["sessionId"]),
  signingSecurityEvents: defineTable({
    userId: v.id("users"),
    eventType: v.string(),
    occurredAt: v.number(),
  }).index("by_userId", ["userId"]),
  signingUploads: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    revisionId: v.id("signingRevisions"),
    createdBy: v.id("users"),
    requestId: v.string(),
    filename: v.string(),
    role: fileRole,
    expectedSize: v.number(),
    expiresAt: v.number(),
    state: v.union(v.literal("pending"), v.literal("attached")),
    fileId: v.optional(v.id("signingFiles")),
  })
    .index("by_agreementId_and_createdBy_and_requestId", [
      "agreementId",
      "createdBy",
      "requestId",
    ])
    .index("by_agreementId_and_state", ["agreementId", "state"]),
  signingFiles: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    uploadId: v.id("signingUploads"),
    filename: v.string(),
    role: fileRole,
    sizeBytes: v.number(),
    sourceVersion: v.string(),
    position: v.number(),
    active: v.boolean(),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_agreementId_and_active", ["agreementId", "active"]),
  signingPreparations: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    revisionId: v.id("signingRevisions"),
    fileRevision: v.number(),
    inputDigest: v.string(),
    snapshot: v.string(),
    status: preparationStatus,
    error: v.optional(preparationError),
    createdAt: v.number(),
    createdBy: v.id("users"),
    jobId: v.optional(v.string()),
    checks: v.number(),
    waitingTimedOut: v.optional(v.boolean()),
    bundleId: v.optional(v.id("signingBundles")),
  })
    .index("by_agreementId", ["agreementId"])
    .index("by_status", ["status"]),
  // Only verified preparation completion may populate bundles, never public callers.
  signingBundles: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    revisionId: v.id("signingRevisions"),
    manifestHash: v.string(),
    pdfHash: v.string(),
    artifactKey: v.string(),
    storageVersion: v.string(),
    validatedAt: v.number(),
    scanReference: v.string(),
    rendererVersion: v.string(),
    attemptId: v.optional(v.id("signingPreparations")),
    fileRevision: v.optional(v.number()),
    inputDigest: v.optional(v.string()),
    manifestKey: v.optional(v.string()),
    manifestVersion: v.optional(v.string()),
    retainUntil: v.optional(v.number()),
    sizeBytes: v.optional(v.number()),
    pages: v.optional(v.array(pageGeometry)),
    sources: v.optional(v.array(sourceReport)),
  }).index("by_revisionId", ["revisionId"]),
  signingTransactions: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    frozenPreparationId: v.id("signingFrozenPreparations"),
    preparationHash: v.string(),
    reference: v.string(),
    requestId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("voided"),
      v.literal("expired"),
      v.literal("completed"),
      v.literal("declined"),
      v.literal("signed"),
    ),
    currentStage: v.number(),
    expiresAt: v.number(),
    companyName: v.string(),
    title: v.string(),
    createdAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_agreementId", ["agreementId"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),
  signingInvitations: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    transactionId: v.id("signingTransactions"),
    frozenPreparationId: v.id("signingFrozenPreparations"),
    participantKey: v.string(),
    version: v.number(),
    nonce: v.string(),
    keyId: v.string(),
    tokenHash: v.string(),
    status: signingInvitationStatus,
    expiresAt: v.number(),
    createdAt: v.number(),
    failedAttempts: v.number(),
    lockedUntil: v.number(),
    lastEmailAt: v.number(),
    verifiedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revocationReason: v.optional(v.string()),
    lastCodeAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_transactionId", ["transactionId"]),
  signingAccessChallenges: defineTable({
    invitationId: v.id("signingInvitations"),
    invitationVersion: v.number(),
    tokenHash: v.string(),
    expiresAt: v.number(),
    generation: v.number(),
    keyId: v.string(),
    state: v.union(v.literal("pending"), v.literal("verified")),
    otpHash: v.optional(v.string()),
    otpExpiresAt: v.optional(v.number()),
    lastRequestedAt: v.number(),
    failedAttempts: v.number(),
    deliveryId: v.optional(v.id("signingDeliveries")),
    verifiedAt: v.optional(v.number()),
    sessionHash: v.optional(v.string()),
    inPersonCheckId: v.optional(v.id("signingInPersonChecks")),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_invitationId", ["invitationId"]),
  // Participant supporting documents: quarantined, scanned, then retained; staff access is purpose-logged.
  signingAttachments: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    transactionId: v.id("signingTransactions"),
    invitationId: v.id("signingInvitations"),
    invitationVersion: v.number(),
    participantKey: v.string(),
    fieldKey: v.string(),
    purpose: attachmentPurpose,
    filename: v.string(),
    contentType: v.union(
      v.literal("application/pdf"),
      v.literal("image/jpeg"),
      v.literal("image/png"),
    ),
    sizeBytes: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("clean"),
      v.literal("rejected"),
    ),
    createdAt: v.number(),
    sha256: v.optional(v.string()),
    storageVersion: v.optional(v.string()),
    retainUntil: v.optional(v.number()),
    scanEngine: v.optional(v.string()),
    scanVersion: v.optional(v.string()),
    scannedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_invitationId_and_sha256", ["invitationId", "sha256"])
    .index("by_agreementId", ["agreementId"]),
  // Staff identity check for an in-person session; the kiosk credential is stored only as a hash.
  signingInPersonChecks: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    transactionId: v.id("signingTransactions"),
    invitationId: v.id("signingInvitations"),
    invitationVersion: v.number(),
    participantKey: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
    staffUserId: v.id("users"),
    documentType: identityDocument,
    documentEnding: v.string(),
    createdAt: v.number(),
    usedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_invitationId", ["invitationId"]),
  signingSignerSessions: defineTable({
    tokenHash: v.string(),
    invitationId: v.id("signingInvitations"),
    invitationVersion: v.number(),
    transactionId: v.id("signingTransactions"),
    participantKey: v.string(),
    preparationHash: v.string(),
    expiresAt: v.number(),
    verifiedAt: v.number(),
    authMethod: v.union(
      v.literal("email_otp"),
      v.literal("in_person_email_otp"),
    ),
    inPersonCheckId: v.optional(v.id("signingInPersonChecks")),
    revokedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_invitationId", ["invitationId"]),
  signingAccessRates: defineTable({
    key: v.string(),
    count: v.number(),
    expiresAt: v.number(),
  }).index("by_key", ["key"]),
  signingDeliveries: defineTable({
    deliveryKey: v.string(),
    participantKey: v.string(),
    kind: emailKind,
    sealed: v.optional(v.string()),
    keyId: v.string(),
    recipientHash: v.string(),
    expectedFrom: v.string(),
    payloadExpiresAt: v.number(),
    invitationVersion: v.number(),
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    transactionId: v.id("signingTransactions"),
    invitationId: v.id("signingInvitations"),
    status: deliveryStatus,
    createdAt: v.number(),
    checks: v.number(),
    jobId: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
    requestKey: v.optional(v.string()),
    payloadDigest: v.string(),
    lastReconciledAt: v.optional(v.number()),
    providerObservedStatus: v.optional(v.string()),
    providerObservedAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    bouncedAt: v.optional(v.number()),
    complainedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    delayedAt: v.optional(v.number()),
  })
    .index("by_deliveryKey", ["deliveryKey"])
    .index("by_invitationId", ["invitationId"])
    .index("by_invitationId_and_status", ["invitationId", "status"])
    .index("by_providerMessageId", ["providerMessageId"])
    .index("by_requestKey", ["requestKey"])
    .index("by_status", ["status"]),
  signingDeliveryEvents: defineTable({
    eventId: v.string(),
    bodyHash: v.string(),
    providerMessageId: v.string(),
    deliveryId: v.optional(v.id("signingDeliveries")),
    eventType: v.string(),
    occurredAt: v.number(),
    receivedAt: v.number(),
    outcome: v.string(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_providerMessageId", ["providerMessageId"]),
  signingAccessEvents: defineTable({
    transactionId: v.id("signingTransactions"),
    invitationId: v.id("signingInvitations"),
    eventType: v.string(),
    occurredAt: v.number(),
    invitationVersion: v.number(),
  }).index("by_transactionId", ["transactionId"]),
  signingLayouts: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    revisionId: v.id("signingRevisions"),
    bundleId: v.id("signingBundles"),
    version: v.number(),
    fields: v.array(fieldDefinition),
    layoutHash: v.string(),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_agreementId", ["agreementId"]),
  signingFrozenPreparations: defineTable({
    eventSequence: v.number(),
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    revisionId: v.id("signingRevisions"),
    bundleId: v.id("signingBundles"),
    layoutId: v.id("signingLayouts"),
    approvalId: v.id("signingApprovals"),
    decisionId: v.id("signingApprovalDecisions"),
    policyRevision: v.number(),
    preparationHash: v.string(),
    snapshot: v.string(),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_agreementId", ["agreementId"]),
  signingApprovals: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    revisionId: v.id("signingRevisions"),
    contentHash: v.string(),
    bundleId: v.id("signingBundles"),
    manifestHash: v.string(),
    pdfHash: v.string(),
    artifactKey: v.string(),
    storageVersion: v.string(),
    policyRevision: v.number(),
    policyHash: v.string(),
    requestedBy: v.id("users"),
    requestedAt: v.number(),
    bindingHash: v.string(),
    eventSequence: v.number(),
    layoutId: v.optional(v.id("signingLayouts")),
    layoutHash: v.optional(v.string()),
    preparationHash: v.optional(v.string()),
  }).index("by_agreementId", ["agreementId"]),
  signingApprovalDecisions: defineTable({
    approvalId: v.id("signingApprovals"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    decidedBy: v.id("users"),
    decidedAt: v.number(),
    reason: v.string(),
  }).index("by_approvalId", ["approvalId"]),
  signingCheckpoints: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    sequence: v.number(),
    headHash: v.string(),
    snapshot: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("stored"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    claimExpiresAt: v.optional(v.number()),
    error: v.optional(v.string()),
    objectVersion: v.optional(v.string()),
    retainUntil: v.optional(v.number()),
  })
    .index("by_agreementId_and_sequence", ["agreementId", "sequence"])
    .index("by_status", ["status"]),
  // Finalisation attempts own one remote job and one artifact prefix; only the current attempt may publish.
  signingFinalisations: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    transactionId: v.id("signingTransactions"),
    attempt: v.number(),
    inputDigest: v.string(),
    evidence: v.string(),
    status: finalisationStatus,
    error: v.optional(finalisationError),
    jobId: v.optional(v.string()),
    checks: v.number(),
    createdAt: v.number(),
    requestedBy: v.optional(v.id("users")),
    completionId: v.optional(v.id("signingCompletions")),
  })
    .index("by_agreementId", ["agreementId"])
    .index("by_status", ["status"]),
  // Published, retained artifacts. Written once by a verified finalisation result.
  signingCompletions: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    transactionId: v.id("signingTransactions"),
    finalisationId: v.id("signingFinalisations"),
    evidenceHash: v.string(),
    evidenceKey: v.string(),
    evidenceVersion: v.string(),
    pdfKey: v.string(),
    pdfVersion: v.string(),
    pdfHash: v.string(),
    sizeBytes: v.number(),
    pageCount: v.number(),
    certificatePageCount: v.number(),
    recordKey: v.string(),
    recordVersion: v.string(),
    recordHash: v.string(),
    retainUntil: v.number(),
    validation: v.string(),
    sealedAt: v.number(),
    completedAt: v.number(),
  }).index("by_agreementId", ["agreementId"]),
  // Template and clause libraries. Approved versions are immutable; edits create new versions.
  signingTemplates: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    kind: templateKind,
    category: signingCategory,
    retiredAt: v.optional(v.number()),
    latestVersion: v.number(),
    approvedVersionId: v.optional(v.id("signingTemplateVersions")),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_tenantId", ["tenantId"]),
  signingTemplateVersions: defineTable({
    tenantId: v.id("tenants"),
    templateId: v.id("signingTemplates"),
    version: v.number(),
    status: versionStatus,
    content: v.string(),
    fields: v.array(templateField),
    conditions: v.array(templateCondition),
    revision: v.number(),
    contentHash: v.string(),
    clausePins: v.optional(
      v.array(
        v.object({
          clauseId: v.id("signingClauses"),
          versionId: v.id("signingClauseVersions"),
          contentHash: v.string(),
        }),
      ),
    ),
    legalReference: v.optional(v.string()),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.id("users")),
  }).index("by_templateId_and_version", ["templateId", "version"]),
  signingClauses: defineTable({
    tenantId: v.id("tenants"),
    title: v.string(),
    retiredAt: v.optional(v.number()),
    latestVersion: v.number(),
    approvedVersionId: v.optional(v.id("signingClauseVersions")),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_tenantId", ["tenantId"]),
  signingClauseVersions: defineTable({
    tenantId: v.id("tenants"),
    clauseId: v.id("signingClauses"),
    version: v.number(),
    status: versionStatus,
    content: v.string(),
    revision: v.number(),
    contentHash: v.string(),
    legalReference: v.optional(v.string()),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.id("users")),
  }).index("by_clauseId_and_version", ["clauseId", "version"]),
  // A generation fixes template/clause versions, inputs, HTML and renderer identity forever.
  signingGenerations: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    revisionId: v.id("signingRevisions"),
    templateId: v.id("signingTemplates"),
    templateVersionId: v.id("signingTemplateVersions"),
    templateContentHash: v.string(),
    rendererVersion: v.string(),
    inputs: v.string(),
    inputHash: v.string(),
    html: v.string(),
    htmlHash: v.string(),
    fileRevision: v.number(),
    uploadId: v.id("signingUploads"),
    status: v.union(
      v.literal("rendering"),
      v.literal("attached"),
      v.literal("failed"),
      v.literal("superseded"),
    ),
    error: v.optional(v.string()),
    fileId: v.optional(v.id("signingFiles")),
    pdfHash: v.optional(v.string()),
    pdfRenderer: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    pageCount: v.optional(v.number()),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_agreementId", ["agreementId"]),
  // Per-company release record: the second key, with the deployment release mode, for external sending.
  signingReleases: defineTable({
    tenantId: v.id("tenants"),
    revision: v.number(),
    mode: releaseMode,
    pilotRecipients: v.array(v.string()),
    legalSignOffReference: v.string(),
    acceptanceReference: v.string(),
    recordedAt: v.number(),
    recordedBy: v.id("users"),
    suspendedAt: v.optional(v.number()),
    suspendedBy: v.optional(v.id("users")),
    suspensionReason: v.optional(v.string()),
  }).index("by_tenantId", ["tenantId"]),
  // Operational alerts carry identifiers and codes only, never participant PII or document content.
  signingAlerts: defineTable({
    key: v.string(),
    kind: v.string(),
    severity: v.union(v.literal("warning"), v.literal("critical")),
    tenantId: v.optional(v.id("tenants")),
    agreementId: v.optional(v.id("signingAgreements")),
    message: v.string(),
    status: v.union(v.literal("open"), v.literal("resolved")),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    resolvedAt: v.optional(v.number()),
    notifiedAt: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_status", ["status"])
    .index("by_agreementId_and_status", ["agreementId", "status"]),
  signingLegalHolds: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    reason: v.string(),
    placedAt: v.number(),
    placedBy: v.id("users"),
    releasedAt: v.optional(v.number()),
    releasedBy: v.optional(v.id("users")),
    releaseReason: v.optional(v.string()),
  }).index("by_agreementId", ["agreementId"]),
  // Signer portal records are bound to one invitation version; none of them is a signature until a submission.
  signingConsents: defineTable({
    transactionId: v.id("signingTransactions"),
    invitationId: v.id("signingInvitations"),
    invitationVersion: v.number(),
    participantKey: v.string(),
    sessionId: v.id("signingSignerSessions"),
    platformConsentVersion: v.string(),
    policyConsentVersion: v.string(),
    consentHash: v.string(),
    acceptedAt: v.number(),
  }).index("by_invitationId_and_invitationVersion", [
    "invitationId",
    "invitationVersion",
  ]),
  signingDrafts: defineTable({
    transactionId: v.id("signingTransactions"),
    invitationId: v.id("signingInvitations"),
    invitationVersion: v.number(),
    participantKey: v.string(),
    revision: v.number(),
    values: v.string(),
    updatedAt: v.number(),
    sessionId: v.id("signingSignerSessions"),
  }).index("by_invitationId_and_invitationVersion", [
    "invitationId",
    "invitationVersion",
  ]),
  signingMarks: defineTable({
    transactionId: v.id("signingTransactions"),
    invitationId: v.id("signingInvitations"),
    invitationVersion: v.number(),
    participantKey: v.string(),
    kind: signerMarkKind,
    method: signerMarkMethod,
    typedText: v.optional(v.string()),
    png: v.string(),
    imageHash: v.string(),
    width: v.number(),
    height: v.number(),
    createdAt: v.number(),
  })
    .index("by_invitationId_and_imageHash", ["invitationId", "imageHash"])
    .index("by_invitationId_and_kind", ["invitationId", "kind"]),
  // Immutable participant outcomes. Accepted values/evidence are never edited after insert.
  signingSubmissions: defineTable({
    tenantId: v.id("tenants"),
    agreementId: v.id("signingAgreements"),
    transactionId: v.id("signingTransactions"),
    invitationId: v.id("signingInvitations"),
    invitationVersion: v.number(),
    participantKey: v.string(),
    intent: signerIntent,
    requestKey: v.string(),
    stage: v.number(),
    preparationHash: v.string(),
    evidence: v.string(),
    submissionHash: v.string(),
    acceptedAt: v.number(),
    eventSequence: v.number(),
  })
    .index("by_requestKey", ["requestKey"])
    .index("by_invitationId", ["invitationId"])
    .index("by_transactionId", ["transactionId"]),

  sourcingBriefs: defineTable({
    tenantId: v.id("tenants"),
    createdBy: v.id("users"),
    requestId: v.string(),
    propertyType: v.union(
      v.literal("office"),
      v.literal("logistics"),
      v.literal("warehouse"),
      v.literal("retail"),
    ),
    location: v.string(),
    sizeSqm: v.number(),
    notes: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    warnings: v.array(v.string()),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_requestId", ["tenantId", "requestId"]),

  propertyCandidates: defineTable({
    tenantId: v.id("tenants"),
    briefId: v.id("sourcingBriefs"),
    name: v.string(),
    propertyType,
    sourceUrl: v.string(),
    location: v.string(),
    sizeSqm: v.union(v.number(), v.null()),
    rentalPerSqm: v.union(v.number(), v.null()),
    monthlyRental: v.union(v.number(), v.null()),
    features: v.array(v.string()),
    typeEvidence: v.string(),
    rentalEvidence: v.string(),
    logisticsUseEvidence: v.union(v.string(), v.null()),
    unverifiedRequirements: v.array(v.string()),
    matchScore: v.number(),
    matchExplanation: v.string(),
    // Photo from the listing page itself (absent on candidates saved before photos existed).
    imageUrl: v.optional(v.union(v.string(), v.null())),
  }).index("by_briefId", ["briefId"]),

  // Convex Auth users table, extended with app-level profile fields.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    lastSeenAt: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  tenants: defineTable({
    slug: v.string(),
    displayName: v.string(),
    status: tenantStatus,
    primaryRegion: v.string(),
    settingsId: v.optional(v.id("tenantSettings")),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_slug", ["slug"]),

  tenantSettings: defineTable({
    tenantId: v.id("tenants"),
    renewalHorizonDays: v.number(),
    publishConfidenceThreshold: v.number(),
    retentionPolicyKey: v.string(),
    defaultDocumentRegion: v.string(),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  }).index("by_tenantId", ["tenantId"]),

  organizations: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    slug: v.string(),
    status: organizationStatus,
    primaryContactName: v.string(),
    primaryContactEmail: v.string(),
    // Client profile (one organization per client tenant).
    industry: v.optional(v.string()),
    clientType: v.optional(clientType),
    relationshipStatus: v.optional(clientRelationshipStatus),
    accountManagerName: v.optional(v.string()),
    clientSince: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
    createdAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_slug", ["tenantId", "slug"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["tenantId"],
    }),

  roles: defineTable({
    key: roleKey,
    scope: roleScope,
    label: v.string(),
    description: v.string(),
    isSystem: v.boolean(),
  })
    .index("by_key", ["key"])
    .index("by_scope", ["scope"]),

  memberships: defineTable({
    tenantId: v.id("tenants"),
    organizationId: v.optional(v.id("organizations")),
    userId: v.id("users"),
    principalType,
    roleKey,
    status: membershipStatus,
    createdAt: v.number(),
    createdBy: v.id("users"),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.id("users")),
  })
    .index("by_userId", ["userId"])
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_userId", ["tenantId", "userId"])
    .index("by_tenantId_and_status", ["tenantId", "status"])
    .index("by_organizationId", ["organizationId"]),

  membershipInvitations: defineTable({
    tenantId: v.id("tenants"),
    organizationId: v.optional(v.id("organizations")),
    email: v.string(),
    fullName: v.optional(v.string()),
    principalType,
    roleKey,
    status: invitationStatus,
    invitedBy: v.id("users"),
    fulfilledByUserId: v.optional(v.id("users")),
    providerHint: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_status", ["tenantId", "status"])
    .index("by_email_and_status", ["email", "status"]),

  properties: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    addressLine: v.string(),
    suburb: v.optional(v.string()),
    city: v.string(),
    province: v.optional(v.string()),
    propertyType,
    status: propertyStatus,
    sizeSqm: v.optional(v.number()),
    rentalPerSqm: v.optional(v.number()),
    landlord: v.optional(v.string()),
    features: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    createdBy: v.id("users"),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
    archivedAt: v.optional(v.number()),
  })
    .index("by_tenantId", ["tenantId"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["tenantId"],
    }),

  leases: defineTable({
    tenantId: v.id("tenants"),
    propertyId: v.id("properties"),
    // ISO dates (YYYY-MM-DD).
    startDate: v.string(),
    endDate: v.string(),
    monthlyRental: v.number(),
    escalationPercent: v.optional(v.number()),
    noticePeriodMonths: v.optional(v.number()),
    breakClause: v.optional(v.string()),
    renewalOption: v.optional(v.string()),
    accountManagerName: v.optional(v.string()),
    status: leaseStatus,
    signingApplicationId: v.optional(v.id("signingApplications")),
    portfolioContext: v.optional(portfolioContext),
    depositCents: v.optional(v.number()),
    predecessorLeaseId: v.optional(v.id("leases")),
    successorLeaseId: v.optional(v.id("leases")),
    signingRenewalReminders: v.optional(v.boolean()),
    // Set when approved document fields were applied (human-approved values).
    sourceDocumentId: v.optional(v.id("documents")),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    createdBy: v.id("users"),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
    archivedAt: v.optional(v.number()),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_propertyId", ["propertyId"])
    .index("by_tenantId_and_endDate", ["tenantId", "endDate"]),

  leaseClauses: defineTable({
    tenantId: v.id("tenants"),
    leaseId: v.id("leases"),
    title: v.string(),
    detail: v.string(),
    createdAt: v.number(),
    createdBy: v.id("users"),
  }).index("by_leaseId", ["leaseId"]),

  documents: defineTable({
    tenantId: v.id("tenants"),
    propertyId: v.optional(v.id("properties")),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    storageId: v.id("_storage"),
    previewId: v.optional(v.id("documentPreviews")),
    source: documentSource,
    // Type chosen by the uploader; `documentType` is the classified type once processed.
    declaredType: v.optional(documentType),
    documentType: v.optional(documentType),
    status: documentStatus,
    statusMessage: v.optional(v.string()),
    uploadedBy: v.id("users"),
    uploaderPrincipal: v.union(v.literal("staff"), v.literal("client")),
    // Processing (Windmill f/docling/process_document_for_app).
    activeAttemptId: v.optional(v.id("processingAttempts")),
    activeRecoveryAttemptId: v.optional(v.id("processingAttempts")),
    processingRemoteUnresolved: v.optional(v.boolean()),
    processingStages: v.optional(processingStages),
    processingIncomplete: v.optional(v.boolean()),
    processingWarnings: v.optional(v.array(v.string())),
    processingContractVersion: v.optional(v.number()),
    incompleteAcknowledgedAt: v.optional(v.number()),
    incompleteAcknowledgedBy: v.optional(v.id("users")),
    incompleteAcknowledgementReason: v.optional(v.string()),
    windmillJobId: v.optional(v.string()),
    processingAttempts: v.number(),
    processingStartedAt: v.optional(v.number()),
    processedAt: v.optional(v.number()),
    parsedJsonKey: v.optional(v.string()),
    okfBundleRoot: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    ocrConfidence: v.optional(v.number()),
    typeConfidence: v.optional(v.number()),
    summary: v.optional(v.string()),
    textPreview: v.optional(v.string()),
    missingFields: v.array(v.string()),
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("users")),
    // Lifecycle.
    replacesDocumentId: v.optional(v.id("documents")),
    replacedByDocumentId: v.optional(v.id("documents")),
    deletionRequestedAt: v.optional(v.number()),
    deletionRequestedBy: v.optional(v.id("users")),
    deletionReason: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_status", ["tenantId", "status"])
    .index("by_propertyId", ["propertyId"])
    .searchIndex("search_filename", {
      searchField: "filename",
      filterFields: ["tenantId"],
    })
    .searchIndex("search_text", {
      searchField: "textPreview",
      filterFields: ["tenantId"],
    }),

  documentPreviews: defineTable({
    documentId: v.id("documents"),
    sourceStorageId: v.id("_storage"),
    rendererVersion: v.number(),
    status: v.union(
      v.literal("preparing"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
    jobId: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    error: v.optional(v.string()),
  }).index("by_documentId", ["documentId"]),

  processingAttempts: defineTable({
    tenantId: v.id("tenants"),
    documentId: v.id("documents"),
    submissionJobId: v.string(),
    retryStage: v.optional(processingStageName),
    sourceAttemptId: v.optional(v.id("processingAttempts")),
    reuseParsedJsonKey: v.optional(v.string()),
    reuseParsedJsonBucket: v.optional(v.string()),
    reuseKnowledgeStage: v.optional(processingStage),
    timedOut: v.optional(v.boolean()),
    windmillJobId: v.optional(v.string()),
    state: v.union(
      v.literal("claimed"),
      v.literal("submitting"),
      v.literal("submission_unknown"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("abandoned"),
    ),
    claimedAt: v.number(),
    updatedAt: v.number(),
    submittedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    resultVersion: v.optional(v.number()),
    incomplete: v.optional(v.boolean()),
    warnings: v.optional(v.array(v.string())),
    // Compact versioned stage/provenance contract; original content stays in MinIO.
    resultMetadata: v.optional(v.any()),
  }).index("by_documentId", ["documentId"]),

  invoices: defineTable({
    tenantId: v.id("tenants"),
    documentId: v.id("documents"),
    propertyId: v.optional(v.id("properties")),
    kind: invoiceKind,
    supplier: v.string(),
    // Normalised supplier name used to group invoices for the baseline.
    supplierKey: v.string(),
    invoiceNumber: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    periodLabel: v.optional(v.string()),
    // ISO date used for ordering (invoice/statement date, else due date).
    periodDate: v.string(),
    amount: v.number(),
    vatAmount: v.optional(v.number()),
    dueDate: v.optional(v.string()),
    consumption: v.optional(v.string()),
    // Rolling baseline from up to 6 earlier invoices (same client, property, supplier, kind).
    baseline: v.optional(v.number()),
    baselineSampleSize: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_documentId", ["documentId"])
    .index("by_tenantId_and_supplierKey", ["tenantId", "supplierKey"]),

  anomalies: defineTable({
    tenantId: v.id("tenants"),
    invoiceId: v.id("invoices"),
    documentId: v.id("documents"),
    propertyId: v.optional(v.id("properties")),
    kind: anomalyKind,
    supplier: v.string(),
    amount: v.number(),
    baseline: v.optional(v.number()),
    delta: v.optional(v.number()),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    cause: v.string(),
    status: anomalyStatus,
    // Clients only see anomalies staff chose to share.
    sharedWithClient: v.boolean(),
    actionId: v.optional(v.id("actions")),
    insightId: v.optional(v.id("insights")),
    note: v.optional(v.string()),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_status", ["tenantId", "status"])
    .index("by_invoiceId", ["invoiceId"]),

  extractedFields: defineTable({
    tenantId: v.id("tenants"),
    documentId: v.id("documents"),
    attemptId: v.optional(v.id("processingAttempts")),
    key: v.string(),
    label: v.string(),
    kind: v.union(v.literal("text"), v.literal("date"), v.literal("number")),
    value: v.string(),
    confidence: v.number(),
    evidence: v.optional(v.string()),
    page: v.optional(v.number()),
    state: extractedFieldState,
    windmillJobId: v.string(),
    // Staff review: the approved value may differ from what was extracted.
    originalValue: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_documentId", ["documentId"])
    .index("by_documentId_and_attemptId", ["documentId", "attemptId"])
    .index("by_documentId_and_windmillJobId", ["documentId", "windmillJobId"]),

  insights: defineTable({
    tenantId: v.id("tenants"),
    propertyId: v.optional(v.id("properties")),
    leaseId: v.optional(v.id("leases")),
    // Evidence: the source document(s) the insight is based on.
    documentIds: v.array(v.id("documents")),
    title: v.string(),
    body: v.string(),
    recommendedAction: v.optional(v.string()),
    category: insightCategory,
    priority,
    status: insightStatus,
    draftedBy: v.union(
      v.literal("staff"),
      v.literal("ai"),
      v.literal("system"),
    ),
    createdBy: v.id("users"),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_status", ["tenantId", "status"]),

  actions: defineTable({
    tenantId: v.id("tenants"),
    title: v.string(),
    description: v.optional(v.string()),
    propertyId: v.optional(v.id("properties")),
    documentId: v.optional(v.id("documents")),
    status: actionStatus,
    priority,
    dueDate: v.optional(v.string()),
    assignedTo: v.optional(v.id("users")),
    source: actionSource,
    // Internal staff tasks are hidden from the client portal.
    visibleToClient: v.boolean(),
    // Dedupe key for automatic actions, e.g. "document:<id>:missing".
    autoKey: v.optional(v.string()),
    requestedBy: v.optional(v.id("users")),
    requestedByPrincipal: v.union(
      v.literal("staff"),
      v.literal("client"),
      v.literal("system"),
    ),
    completedAt: v.optional(v.number()),
    // Last overdue reminder sent to the client (overdue_reminders automation).
    lastReminderAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_status", ["tenantId", "status"])
    .index("by_autoKey", ["autoKey"]),

  actionComments: defineTable({
    tenantId: v.id("tenants"),
    actionId: v.id("actions"),
    authorId: v.id("users"),
    authorPrincipal: v.union(v.literal("staff"), v.literal("client")),
    body: v.string(),
    documentId: v.optional(v.id("documents")),
    internal: v.boolean(),
    createdAt: v.number(),
  }).index("by_actionId", ["actionId"]),

  notifications: defineTable({
    userId: v.id("users"),
    tenantId: v.optional(v.id("tenants")),
    kind: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    // In-app path, e.g. "/documents/<id>" or "/portal/<slug>/actions".
    link: v.optional(v.string()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Platform-wide automation settings (definitions live in convex/lib/automations.ts).
  automations: defineTable({
    key: automationKey,
    enabled: v.boolean(),
    runCount: v.number(),
    lastRunAt: v.optional(v.number()),
    lastRunStatus: v.optional(
      v.union(v.literal("succeeded"), v.literal("failed")),
    ),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  }).index("by_key", ["key"]),

  automationRuns: defineTable({
    automationKey,
    mode: automationRunMode,
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    startedAt: v.number(),
    finishedAt: v.number(),
    triggeredBy: v.optional(v.id("users")),
    summary: v.string(),
    stats: v.record(v.string(), v.number()),
    // Up to 50 notable items (what fired, or would fire on a dry run).
    items: v.array(
      v.object({
        tenantId: v.optional(v.id("tenants")),
        label: v.string(),
        detail: v.string(),
      }),
    ),
    // Set when a run is executed by a Windmill job (none of the built-in automations are).
    windmillJobId: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_automationKey_and_startedAt", ["automationKey", "startedAt"]),

  // One row per lease, end date and renewal step that the cadence handled.
  renewalMilestones: defineTable({
    tenantId: v.id("tenants"),
    leaseId: v.id("leases"),
    leaseEndDate: v.string(),
    daysBefore: v.number(),
    status: v.union(v.literal("fired"), v.literal("skipped")),
    actionId: v.optional(v.id("actions")),
    insightId: v.optional(v.id("insights")),
    runId: v.optional(v.id("automationRuns")),
    createdAt: v.number(),
  }).index("by_leaseId", ["leaseId"]),

  auditChains: defineTable({
    tenantId: v.id("tenants"),
    lastEventId: v.optional(v.id("auditEvents")),
    lastHash: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_tenantId", ["tenantId"]),

  auditEvents: defineTable({
    tenantId: v.id("tenants"),
    eventType: v.string(),
    actorType: auditActorType,
    actorId: v.optional(v.id("users")),
    targetType: v.string(),
    targetId: v.string(),
    correlationId: v.string(),
    sourceSystem,
    occurredAt: v.number(),
    payloadBefore: v.optional(v.string()),
    payloadAfter: v.optional(v.string()),
    reason: v.optional(v.string()),
    prevHash: v.optional(v.string()),
    eventHash: v.string(),
  })
    .index("by_tenantId_and_occurredAt", ["tenantId", "occurredAt"])
    .index("by_tenantId_and_eventType", ["tenantId", "eventType"])
    .index("by_correlationId", ["correlationId"]),

  exportJobs: defineTable({
    tenantId: v.id("tenants"),
    requestedBy: v.id("users"),
    exportType: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    artifactStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_status", ["tenantId", "status"]),

  // Voice transcription/assistant usage counters (one row per user per UTC day).
  // Counts only: audio and transcripts are never stored.
  voiceUsage: defineTable({
    userId: v.id("users"),
    day: v.string(),
    dayCount: v.number(),
    minuteBucket: v.number(),
    minuteCount: v.number(),
    updatedAt: v.number(),
  }).index("by_userId_and_day", ["userId", "day"]),
});
