import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
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

  sourcingBriefs: defineTable({
    tenantId: v.id("tenants"),
    createdBy: v.id("users"),
    requestId: v.string(),
    propertyType: v.union(v.literal("office"), v.literal("logistics"), v.literal("warehouse"), v.literal("retail")),
    location: v.string(),
    sizeSqm: v.number(),
    notes: v.string(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("failed")),
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
    status: v.union(v.literal("preparing"), v.literal("ready"), v.literal("failed")),
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
