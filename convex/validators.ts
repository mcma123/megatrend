import { v } from "convex/values";

export const processingStageName = v.union(
  v.literal("parse"),
  v.literal("knowledge"),
  v.literal("extract"),
);
export const processingStage = v.object({
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("succeeded"),
    v.literal("failed"),
    v.literal("partial"),
    v.literal("skipped"),
  ),
  attemptId: v.optional(v.id("processingAttempts")),
  sourceAttemptId: v.optional(v.id("processingAttempts")),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  updatedAt: v.number(),
  error: v.optional(v.string()),
  errorKind: v.optional(v.string()),
  retryable: v.boolean(),
  artifactKey: v.optional(v.string()),
  artifactBucket: v.optional(v.string()),
  reused: v.optional(v.boolean()),
});
export const processingStages = v.object({
  parse: processingStage,
  knowledge: processingStage,
  extract: processingStage,
});

export const membershipStatus = v.union(
  v.literal("active"),
  v.literal("suspended"),
  v.literal("revoked"),
);

export const invitationStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("revoked"),
  v.literal("expired"),
);

export const organizationStatus = v.union(
  v.literal("active"),
  v.literal("inactive"),
  v.literal("suspended"),
);

export const tenantStatus = v.union(
  v.literal("active"),
  v.literal("inactive"),
  v.literal("suspended"),
);

export const principalType = v.union(v.literal("staff"), v.literal("client"));

export const staffRoleKey = v.union(
  v.literal("platform_admin"),
  v.literal("tenant_admin"),
  v.literal("account_manager"),
  v.literal("operations_analyst"),
  v.literal("finance_reviewer"),
  v.literal("read_only_staff"),
);

export const clientRoleKey = v.union(
  v.literal("client_admin"),
  v.literal("property_manager"),
  v.literal("finance_user"),
  v.literal("legal_reviewer"),
  v.literal("executive_viewer"),
);

export const roleKey = v.union(staffRoleKey, clientRoleKey);

export const roleScope = v.union(v.literal("staff"), v.literal("client"));

export const auditActorType = v.union(
  v.literal("staff_user"),
  v.literal("client_user"),
  v.literal("system"),
);

export const sourceSystem = v.union(
  v.literal("convex"),
  v.literal("windmill"),
  v.literal("mastra"),
  v.literal("portal"),
  v.literal("megatrend_os"),
);

export const exportType = v.union(
  v.literal("audit_log"),
  v.literal("membership"),
  v.literal("document_metadata"),
  v.literal("published_insight"),
);

export const clientType = v.union(
  v.literal("managed"),
  v.literal("tenant_rep"),
);

export const clientRelationshipStatus = v.union(
  v.literal("active"),
  v.literal("prospect"),
  v.literal("dormant"),
);

export const propertyType = v.union(
  v.literal("office"),
  v.literal("logistics"),
  v.literal("warehouse"),
  v.literal("retail"),
  v.literal("distribution"),
  v.literal("industrial"),
  v.literal("other"),
);

export const propertyStatus = v.union(
  v.literal("active"),
  v.literal("proposed"),
  v.literal("shortlisted"),
  v.literal("rejected"),
  v.literal("expired"),
);

// Stored lease state; "expiring soon" / "renewal window open" are derived from endDate.
export const leaseStatus = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("renewal_in_progress"),
  v.literal("client_decision_pending"),
  v.literal("renewed"),
  v.literal("terminated"),
  v.literal("expired"),
);

export const documentType = v.union(
  v.literal("lease"),
  v.literal("invoice"),
  v.literal("utility_statement"),
  v.literal("addendum"),
  v.literal("correspondence"),
  v.literal("offer"),
  v.literal("other"),
);

// Document pipeline state. "approved" is set by staff review (Phase 4).
export const documentStatus = v.union(
  v.literal("uploaded"),
  v.literal("queued_for_ocr"),
  v.literal("ocr_complete"),
  v.literal("extraction_complete"),
  v.literal("review_required"),
  v.literal("approved"),
  v.literal("processing_failed"),
);

export const documentSource = v.union(
  v.literal("upload"),
  v.literal("scanner"),
);

export const extractedFieldState = v.union(
  v.literal("detected"),
  v.literal("low_confidence_review"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("superseded"),
);

export const insightStatus = v.union(
  v.literal("draft"),
  v.literal("under_review"),
  v.literal("published"),
  v.literal("rejected"),
  v.literal("withdrawn"),
);

export const insightCategory = v.union(
  v.literal("renewal"),
  v.literal("cost"),
  v.literal("document"),
  v.literal("market"),
  v.literal("risk"),
  v.literal("other"),
);

export const priority = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
);

export const actionStatus = v.union(
  v.literal("open"),
  v.literal("in_progress"),
  v.literal("waiting_on_client"),
  v.literal("waiting_on_cyphersoft"),
  v.literal("waiting_on_landlord"),
  v.literal("completed"),
  v.literal("cancelled"),
);

export const actionSource = v.union(
  v.literal("manual"),
  v.literal("client_request"),
  v.literal("document_flag"),
  v.literal("automation"),
);

export const invoiceKind = v.union(
  v.literal("invoice"),
  v.literal("utility_statement"),
);

export const anomalyStatus = v.union(
  v.literal("open"),
  v.literal("investigating"),
  v.literal("resolved"),
  v.literal("dismissed"),
);

export const anomalyKind = v.union(
  v.literal("cost_spike"),
  v.literal("possible_duplicate"),
);

export const automationKey = v.union(
  v.literal("renewal_cadence"),
  v.literal("overdue_reminders"),
  v.literal("invoice_anomaly_check"),
);

export const automationRunMode = v.union(
  v.literal("scheduled"),
  v.literal("manual"),
  v.literal("dry_run"),
  v.literal("event"),
);
