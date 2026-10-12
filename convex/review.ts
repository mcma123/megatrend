import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";
import { appendAuditEvent } from "./lib/audit";
import {
  listStaffTenants,
  requireStaff,
  requireTenantWriter,
} from "./lib/auth";
import { closeAutoAction } from "./lib/autoActions";
import { recordInvoiceFromDocument } from "./lib/invoices";
import { clientRecipients, notify, tenantSlug } from "./lib/notifications";
import { getClientLabel } from "./lib/portfolio";
import { isCurrentField, readCurrentFields } from "./lib/documentFields";

// Staff review of processed documents: approve / edit / reject extracted fields, finish the
// review, and apply approved lease fields to the lease record. Low-confidence values are never
// approved implicitly.

const PENDING_STATES = new Set(["detected", "low_confidence_review"]);

function requireCoverageAcknowledgement(document: Doc<"documents">) {
  if (
    !["review_required", "extraction_complete", "approved"].includes(
      document.status,
    )
  ) {
    throw new ConvexError(
      "This document is not ready for review or record updates",
    );
  }
  if (document.processingIncomplete && !document.incompleteAcknowledgedAt) {
    throw new ConvexError(
      "Check the original document and acknowledge incomplete source coverage before completing review or applying values",
    );
  }
}

/** Acknowledgement records a staff decision; it never changes source completeness. */
export const acknowledgeIncomplete = mutation({
  args: {
    documentId: v.id("documents"),
    attemptId: v.optional(v.id("processingAttempts")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.deletedAt || document.replacedByDocumentId)
      throw new ConvexError("Document not found");
    const access = await requireTenantWriter(ctx, document.tenantId);
    if (document.activeAttemptId !== args.attemptId)
      throw new ConvexError(
        "Processing changed; reload the document before acknowledging coverage",
      );
    if (
      !document.processingIncomplete ||
      !["review_required", "extraction_complete"].includes(document.status)
    ) {
      throw new ConvexError(
        "This document is not awaiting an incomplete-coverage decision",
      );
    }
    const reason = args.reason.trim();
    if (reason.length < 10 || reason.length > 500)
      throw new ConvexError(
        "Explain your source check in 10 to 500 characters",
      );
    const now = Date.now();
    await ctx.db.patch(document._id, {
      incompleteAcknowledgedAt: now,
      incompleteAcknowledgedBy: access.user._id,
      incompleteAcknowledgementReason: reason,
      updatedAt: now,
    });
    await appendAuditEvent(ctx, {
      tenantId: document.tenantId,
      eventType: "document.incomplete_coverage_acknowledged",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "document",
      targetId: document._id,
      correlationId: `document:${document._id}`,
      sourceSystem: "convex",
      occurredAt: now,
      reason,
      payloadAfter: JSON.stringify({
        attemptId: document.activeAttemptId ?? null,
        warnings: document.processingWarnings ?? [],
      }),
    });
    return { documentId: document._id };
  },
});

/** Review inbox: documents awaiting review and insights awaiting publication, most urgent first. */
export const queue = query({
  args: {},
  handler: async (ctx) => {
    const staff = await requireStaff(ctx);
    const tenants = await listStaffTenants(ctx, staff);
    const now = Date.now();
    const items = [];

    for (const tenant of tenants) {
      const client = await getClientLabel(ctx, tenant._id);
      for (const status of [
        "review_required",
        "extraction_complete",
      ] as const) {
        const documents = await ctx.db
          .query("documents")
          .withIndex("by_tenantId_and_status", (q) =>
            q.eq("tenantId", tenant._id).eq("status", status),
          )
          .take(100);
        for (const document of documents) {
          if (document.deletedAt || document.replacedByDocumentId) continue;
          const fields = await readCurrentFields(ctx, document);
          const pending = fields.filter((field) =>
            PENDING_STATES.has(field.state),
          );
          const lowConfidence = fields.filter(
            (field) => field.state === "low_confidence_review",
          ).length;
          const ageDays = (now - document.createdAt) / 86_400_000;
          const type = document.documentType ?? document.declaredType;
          const urgency =
            document.missingFields.length * 3 +
            lowConfidence * 2 +
            (status === "review_required" ? 3 : 0) +
            (type === "lease" ? 2 : 0) +
            (document.uploaderPrincipal === "client" ? 1 : 0) +
            Math.min(ageDays, 14) * 0.5;
          items.push({
            kind: "document" as const,
            id: document._id,
            title: document.filename,
            client,
            documentType: type ?? null,
            status: document.status,
            pendingFields: pending.length,
            lowConfidenceFields: lowConfidence,
            missingFields: document.missingFields,
            createdAt: document.createdAt,
            urgency: Math.round(urgency * 10) / 10,
          });
        }
      }
      const insights = await ctx.db
        .query("insights")
        .withIndex("by_tenantId_and_status", (q) =>
          q.eq("tenantId", tenant._id).eq("status", "under_review"),
        )
        .take(100);
      for (const insight of insights) {
        const ageDays = (now - insight.createdAt) / 86_400_000;
        const priorityWeight = { critical: 6, high: 4, medium: 2, low: 1 }[
          insight.priority
        ];
        items.push({
          kind: "insight" as const,
          id: insight._id,
          title: insight.title,
          client,
          documentType: null,
          status: insight.status,
          pendingFields: 0,
          lowConfidenceFields: 0,
          missingFields: [] as string[],
          createdAt: insight.createdAt,
          urgency:
            Math.round((priorityWeight + Math.min(ageDays, 14) * 0.5) * 10) /
            10,
        });
      }
    }
    return items.sort(
      (a, b) => b.urgency - a.urgency || a.createdAt - b.createdAt,
    );
  },
});

function cleanFieldValue(kind: Doc<"extractedFields">["kind"], raw: string) {
  const value = raw.trim();
  if (!value) throw new ConvexError("Enter a value");
  if (
    kind === "date" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))
  ) {
    throw new ConvexError("Dates must be YYYY-MM-DD");
  }
  if (kind === "number") {
    const number = Number(value.replace(/[\s,]/g, ""));
    if (!Number.isFinite(number)) throw new ConvexError("Enter a number");
    return String(number);
  }
  return value.slice(0, 1000);
}

async function loadFieldForReview(
  ctx: MutationCtx,
  fieldId: Id<"extractedFields">,
) {
  const field = await ctx.db.get(fieldId);
  if (!field || field.state === "superseded")
    throw new ConvexError("Field not found");
  const access = await requireTenantWriter(ctx, field.tenantId);
  const document = await ctx.db.get(field.documentId);
  if (!document || !(await isCurrentField(ctx, document, field)))
    throw new ConvexError(
      "This field belongs to an obsolete extraction; reload the document",
    );
  return { field, access };
}

export const approveField = mutation({
  args: { fieldId: v.id("extractedFields"), value: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { field, access } = await loadFieldForReview(ctx, args.fieldId);
    const value =
      args.value === undefined
        ? field.value
        : cleanFieldValue(field.kind, args.value);
    const now = Date.now();
    const edited = value !== field.value;
    await ctx.db.patch(field._id, {
      state: "approved",
      value,
      originalValue: edited
        ? (field.originalValue ?? field.value)
        : field.originalValue,
      reviewedAt: now,
      reviewedBy: access.user._id,
    });
    await appendAuditEvent(ctx, {
      tenantId: field.tenantId,
      eventType: edited
        ? "extracted_field.edited_and_approved"
        : "extracted_field.approved",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "extracted_field",
      targetId: field._id,
      correlationId: `document:${field.documentId}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadBefore: JSON.stringify({
        value: field.value,
        state: field.state,
        confidence: field.confidence,
      }),
      payloadAfter: JSON.stringify({ value, state: "approved" }),
    });
    return { fieldId: field._id };
  },
});

export const rejectField = mutation({
  args: { fieldId: v.id("extractedFields"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { field, access } = await loadFieldForReview(ctx, args.fieldId);
    const now = Date.now();
    await ctx.db.patch(field._id, {
      state: "rejected",
      reviewedAt: now,
      reviewedBy: access.user._id,
    });
    await appendAuditEvent(ctx, {
      tenantId: field.tenantId,
      eventType: "extracted_field.rejected",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "extracted_field",
      targetId: field._id,
      correlationId: `document:${field.documentId}`,
      sourceSystem: "convex",
      occurredAt: now,
      reason: args.reason?.slice(0, 500),
      payloadBefore: JSON.stringify({ value: field.value, state: field.state }),
    });
    return { fieldId: field._id };
  },
});

/** Approves every high-confidence field still pending. Low-confidence fields stay for a decision. */
export const approveHighConfidence = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.deletedAt || document.replacedByDocumentId)
      throw new ConvexError("Document not found");
    const access = await requireTenantWriter(ctx, document.tenantId);
    const fields = await readCurrentFields(ctx, document);
    const now = Date.now();
    let approved = 0;
    for (const field of fields) {
      if (field.state !== "detected") continue;
      await ctx.db.patch(field._id, {
        state: "approved",
        reviewedAt: now,
        reviewedBy: access.user._id,
      });
      approved += 1;
    }
    if (approved > 0) {
      await appendAuditEvent(ctx, {
        tenantId: document.tenantId,
        eventType: "extracted_field.bulk_approved",
        actorType: "staff_user",
        actorId: access.user._id,
        targetType: "document",
        targetId: document._id,
        correlationId: `document:${document._id}`,
        sourceSystem: "convex",
        occurredAt: now,
        payloadAfter: JSON.stringify({ approved }),
      });
    }
    return { approved };
  },
});

/** Finishes the review once every field has a decision; the document then shows as published. */
export const completeReview = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.deletedAt || document.replacedByDocumentId)
      throw new ConvexError("Document not found");
    const access = await requireTenantWriter(ctx, document.tenantId);
    requireCoverageAcknowledgement(document);
    if (
      document.status !== "review_required" &&
      document.status !== "extraction_complete"
    ) {
      throw new ConvexError("This document is not ready for review");
    }
    const fields = await readCurrentFields(ctx, document);
    const pending = fields.filter((field) =>
      PENDING_STATES.has(field.state),
    ).length;
    if (pending > 0) {
      throw new ConvexError(
        `${pending} field${pending === 1 ? " still needs" : "s still need"} a decision`,
      );
    }
    const now = Date.now();
    await ctx.db.patch(document._id, {
      status: "approved",
      statusMessage: document.processingIncomplete
        ? "Reviewed with acknowledged incomplete source coverage; check the recorded staff decision."
        : undefined,
      reviewedAt: now,
      reviewedBy: access.user._id,
      updatedAt: now,
    });
    await closeAutoAction(ctx, `document:${document._id}:review`);
    await appendAuditEvent(ctx, {
      tenantId: document.tenantId,
      eventType: "document.approved",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "document",
      targetId: document._id,
      correlationId: `document:${document._id}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadAfter: JSON.stringify({
        approved: fields.filter((field) => field.state === "approved").length,
        rejected: fields.filter((field) => field.state === "rejected").length,
      }),
    });
    // Approved invoices / utility statements become invoice records (with anomaly checks).
    const invoice = await recordInvoiceFromDocument(
      ctx,
      { ...document, status: "approved" },
      access.user._id,
    );

    const slug = await tenantSlug(ctx, document.tenantId);
    await notify(ctx, {
      recipients: await clientRecipients(ctx, document.tenantId),
      tenantId: document.tenantId,
      kind: "document.approved",
      title: `Reviewed: ${document.filename}`,
      body: "Your Cyphersoft team has reviewed this document.",
      link: `/portal/${slug}/documents`,
    });
    return {
      documentId: document._id,
      invoiceRecorded: invoice.recorded,
      anomalies: invoice.recorded ? invoice.anomalies : 0,
      invoiceNote: invoice.recorded
        ? null
        : invoice.reason === "not an invoice"
          ? null
          : invoice.reason,
    };
  },
});

// Approved lease-document fields -> lease / property record.
const LEASE_FIELD_MAP = {
  lease_start_date: "startDate",
  lease_end_date: "endDate",
  monthly_rental: "monthlyRental",
  escalation_percent: "escalationPercent",
  notice_period_months: "noticePeriodMonths",
  break_clause: "breakClause",
  renewal_option: "renewalOption",
} as const;

/**
 * Applies the document's APPROVED fields to a lease (updating `leaseId`, or creating one for the
 * document's property). Pending or rejected values are ignored.
 */
export const applyToLease = mutation({
  args: { documentId: v.id("documents"), leaseId: v.optional(v.id("leases")) },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.deletedAt || document.replacedByDocumentId)
      throw new ConvexError("Document not found");
    const access = await requireTenantWriter(ctx, document.tenantId);
    requireCoverageAcknowledgement(document);
    if (!document.propertyId) {
      throw new ConvexError("Link the document to a property first");
    }
    const property = await ctx.db.get(document.propertyId);
    if (!property || property.archivedAt)
      throw new ConvexError("The linked property no longer exists");

    const fields = await readCurrentFields(ctx, document);
    const approved = new Map(
      fields
        .filter((field) => field.state === "approved")
        .map((field) => [field.key, field.value]),
    );

    const leasePatch: Partial<Doc<"leases">> = {};
    for (const [fieldKey, leaseKey] of Object.entries(LEASE_FIELD_MAP)) {
      const value = approved.get(fieldKey);
      if (value === undefined) continue;
      if (
        leaseKey === "monthlyRental" ||
        leaseKey === "escalationPercent" ||
        leaseKey === "noticePeriodMonths"
      ) {
        const number = Number(value);
        if (Number.isFinite(number))
          (leasePatch as Record<string, unknown>)[leaseKey] = number;
      } else {
        (leasePatch as Record<string, unknown>)[leaseKey] = value;
      }
    }
    if (Object.keys(leasePatch).length === 0) {
      throw new ConvexError(
        "No approved lease fields to apply. Approve fields first.",
      );
    }

    const now = Date.now();
    const provenance = {
      sourceDocumentId: document._id,
      approvedAt: now,
      approvedBy: access.user._id,
    };
    let leaseId: Id<"leases">;
    let before: Doc<"leases"> | null = null;

    if (args.leaseId) {
      const lease = await ctx.db.get(args.leaseId);
      if (!lease || lease.archivedAt || lease.propertyId !== property._id) {
        throw new ConvexError(
          "That lease doesn't belong to the document's property",
        );
      }
      before = lease;
      const merged = { ...lease, ...leasePatch };
      if (merged.endDate <= merged.startDate) {
        throw new ConvexError(
          "The approved end date must be after the start date",
        );
      }
      await ctx.db.patch(lease._id, {
        ...leasePatch,
        ...provenance,
        updatedAt: now,
        updatedBy: access.user._id,
      });
      leaseId = lease._id;
    } else {
      const missing = (
        ["startDate", "endDate", "monthlyRental"] as const
      ).filter((key) => leasePatch[key] === undefined);
      if (missing.length > 0) {
        throw new ConvexError(
          "To create a lease, approve the start date, end date and monthly rental first",
        );
      }
      if (leasePatch.endDate! <= leasePatch.startDate!) {
        throw new ConvexError(
          "The approved end date must be after the start date",
        );
      }
      leaseId = await ctx.db.insert("leases", {
        tenantId: document.tenantId,
        propertyId: property._id,
        startDate: leasePatch.startDate!,
        endDate: leasePatch.endDate!,
        monthlyRental: leasePatch.monthlyRental!,
        escalationPercent: leasePatch.escalationPercent,
        noticePeriodMonths: leasePatch.noticePeriodMonths,
        breakClause: leasePatch.breakClause,
        renewalOption: leasePatch.renewalOption,
        status: "active",
        ...provenance,
        createdAt: now,
        createdBy: access.user._id,
        updatedAt: now,
        updatedBy: access.user._id,
      });
    }

    // Property facts from the same document.
    const propertyPatch: Partial<Doc<"properties">> = {};
    const area = Number(approved.get("lettable_area_sqm"));
    if (approved.has("lettable_area_sqm") && Number.isFinite(area) && area > 0)
      propertyPatch.sizeSqm = area;
    if (approved.get("landlord_name"))
      propertyPatch.landlord = approved.get("landlord_name");
    if (Object.keys(propertyPatch).length > 0) {
      await ctx.db.patch(property._id, {
        ...propertyPatch,
        updatedAt: now,
        updatedBy: access.user._id,
      });
    }

    await appendAuditEvent(ctx, {
      tenantId: document.tenantId,
      eventType: args.leaseId
        ? "lease.updated_from_document"
        : "lease.created_from_document",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "lease",
      targetId: leaseId,
      correlationId: `document:${document._id}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadBefore: before
        ? JSON.stringify({
            startDate: before.startDate,
            endDate: before.endDate,
            monthlyRental: before.monthlyRental,
          })
        : undefined,
      payloadAfter: JSON.stringify({
        ...leasePatch,
        ...propertyPatch,
        documentId: document._id,
      }),
    });

    const slug = await tenantSlug(ctx, document.tenantId);
    await notify(ctx, {
      recipients: await clientRecipients(ctx, document.tenantId),
      tenantId: document.tenantId,
      kind: "lease.updated",
      title: `Lease details verified: ${property.name}`,
      body: "Lease terms were updated from your reviewed lease document.",
      link: `/portal/${slug}/properties/${property._id}/lease`,
    });

    return { leaseId, created: !args.leaseId };
  },
});
