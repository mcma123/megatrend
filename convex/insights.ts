import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAuditEvent } from "./lib/audit";
import {
  getTenantAccess,
  listStaffTenants,
  requireStaff,
  requireTenantAccess,
  requireTenantWriter,
} from "./lib/auth";
import { clientRecipients, notify, tenantSlug } from "./lib/notifications";
import { getClientLabel, optionalText, requireText } from "./lib/portfolio";
import { insightCategory, insightStatus, priority } from "./validators";

// Insights: staff (optionally AI-assisted) drafts that reach clients only when a staff member
// publishes them. Every published insight must cite evidence (a document or a lease).

const insightFields = {
  title: v.string(),
  body: v.string(),
  recommendedAction: v.optional(v.string()),
  category: insightCategory,
  priority,
  propertyId: v.optional(v.id("properties")),
  leaseId: v.optional(v.id("leases")),
  documentIds: v.array(v.id("documents")),
};

type InsightInput = {
  title: string;
  body: string;
  recommendedAction?: string;
  category: Doc<"insights">["category"];
  priority: Doc<"insights">["priority"];
  propertyId?: Id<"properties">;
  leaseId?: Id<"leases">;
  documentIds: Id<"documents">[];
};

/** Validates links stay inside the tenant. */
async function cleanInsightInput(ctx: MutationCtx, tenantId: Id<"tenants">, input: InsightInput) {
  if (input.propertyId) {
    const property = await ctx.db.get(input.propertyId);
    if (!property || property.tenantId !== tenantId) throw new ConvexError("Property not found for this client");
  }
  if (input.leaseId) {
    const lease = await ctx.db.get(input.leaseId);
    if (!lease || lease.tenantId !== tenantId) throw new ConvexError("Lease not found for this client");
  }
  const documentIds = [...new Set(input.documentIds)].slice(0, 5);
  for (const documentId of documentIds) {
    const document = await ctx.db.get(documentId);
    if (!document || document.tenantId !== tenantId || document.deletedAt) {
      throw new ConvexError("Evidence document not found for this client");
    }
  }
  return {
    title: requireText(input.title, "Title").slice(0, 200),
    body: requireText(input.body, "Insight text").slice(0, 4000),
    recommendedAction: optionalText(input.recommendedAction)?.slice(0, 500),
    category: input.category,
    priority: input.priority,
    propertyId: input.propertyId,
    leaseId: input.leaseId,
    documentIds,
  };
}

async function toInsightRow(ctx: QueryCtx, insight: Doc<"insights">) {
  const property = insight.propertyId ? await ctx.db.get(insight.propertyId) : null;
  const documents = [];
  for (const documentId of insight.documentIds) {
    const document = await ctx.db.get(documentId);
    if (document && !document.deletedAt) documents.push({ documentId, filename: document.filename });
  }
  const reviewer = insight.reviewedBy ? await ctx.db.get(insight.reviewedBy) : null;
  return {
    ...insight,
    client: await getClientLabel(ctx, insight.tenantId),
    property: property ? { propertyId: property._id, name: property.name } : null,
    documents,
    reviewerName: reviewer?.name ?? reviewer?.email ?? null,
  };
}

/** Staff see every status; client users see only published insights of their own tenant. */
export const list = query({
  args: { tenantId: v.optional(v.id("tenants")), status: v.optional(insightStatus) },
  handler: async (ctx, args) => {
    let tenantIds: Id<"tenants">[];
    let clientView = false;
    if (args.tenantId) {
      const access = await requireTenantAccess(ctx, args.tenantId);
      clientView = access.principalType === "client";
      tenantIds = [args.tenantId];
    } else {
      const staff = await requireStaff(ctx);
      tenantIds = (await listStaffTenants(ctx, staff)).map((tenant) => tenant._id);
    }
    const status = clientView ? "published" : args.status;

    const rows = [];
    for (const tenantId of tenantIds) {
      const insights = status
        ? await ctx.db
            .query("insights")
            .withIndex("by_tenantId_and_status", (q) => q.eq("tenantId", tenantId).eq("status", status))
            .order("desc")
            .take(200)
        : await ctx.db
            .query("insights")
            .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
            .order("desc")
            .take(200);
      for (const insight of insights) rows.push(await toInsightRow(ctx, insight));
    }
    return rows.sort((a, b) => (b.publishedAt ?? b.updatedAt) - (a.publishedAt ?? a.updatedAt));
  },
});

export const get = query({
  args: { insightId: v.id("insights") },
  handler: async (ctx, args) => {
    const insight = await ctx.db.get(args.insightId);
    if (!insight) return null;
    const access = await getTenantAccess(ctx, insight.tenantId);
    if (!access || (access.principalType === "client" && insight.status !== "published")) return null;
    return await toInsightRow(ctx, insight);
  },
});

export const create = mutation({
  args: { tenantId: v.id("tenants"), draftedBy: v.union(v.literal("staff"), v.literal("ai")), ...insightFields },
  handler: async (ctx, args) => {
    const { tenantId, draftedBy, ...input } = args;
    const access = await requireTenantWriter(ctx, tenantId);
    const fields = await cleanInsightInput(ctx, tenantId, input);
    const now = Date.now();
    const insightId = await ctx.db.insert("insights", {
      tenantId,
      ...fields,
      status: "draft",
      draftedBy,
      createdBy: access.user._id,
      createdAt: now,
      updatedAt: now,
    });
    await appendAuditEvent(ctx, {
      tenantId,
      eventType: "insight.drafted",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "insight",
      targetId: insightId,
      correlationId: `insight:${insightId}`,
      sourceSystem: draftedBy === "ai" ? "mastra" : "convex",
      occurredAt: now,
      payloadAfter: JSON.stringify({ title: fields.title, category: fields.category, draftedBy }),
    });
    return { insightId };
  },
});

export const update = mutation({
  args: { insightId: v.id("insights"), ...insightFields },
  handler: async (ctx, args) => {
    const { insightId, ...input } = args;
    const insight = await ctx.db.get(insightId);
    if (!insight) throw new ConvexError("Insight not found");
    const access = await requireTenantWriter(ctx, insight.tenantId);
    if (insight.status === "published") {
      throw new ConvexError("Withdraw the insight before editing it");
    }
    const fields = await cleanInsightInput(ctx, insight.tenantId, input);
    const now = Date.now();
    await ctx.db.patch(insightId, { ...fields, updatedAt: now });
    await appendAuditEvent(ctx, {
      tenantId: insight.tenantId,
      eventType: "insight.edited",
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "insight",
      targetId: insightId,
      correlationId: `insight:${insightId}`,
      sourceSystem: "convex",
      occurredAt: now,
      payloadBefore: JSON.stringify({ title: insight.title, body: insight.body }),
      payloadAfter: JSON.stringify({ title: fields.title, body: fields.body }),
    });
    return { insightId };
  },
});

const TRANSITIONS: Record<Doc<"insights">["status"], Doc<"insights">["status"][]> = {
  draft: ["under_review", "published", "rejected"],
  under_review: ["published", "rejected", "draft"],
  rejected: ["draft"],
  published: ["withdrawn"],
  withdrawn: ["draft"],
};

/** Workflow: submit for review, publish, reject (send back), withdraw. */
export const setStatus = mutation({
  args: { insightId: v.id("insights"), status: insightStatus, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const insight = await ctx.db.get(args.insightId);
    if (!insight) throw new ConvexError("Insight not found");
    const access = await requireTenantWriter(ctx, insight.tenantId);
    if (!TRANSITIONS[insight.status].includes(args.status)) {
      throw new ConvexError(`An insight that is ${insight.status.replace("_", " ")} can't be moved to ${args.status.replace("_", " ")}`);
    }
    if (args.status === "published" && insight.documentIds.length === 0 && !insight.leaseId) {
      throw new ConvexError("Link a source document or lease as evidence before publishing");
    }

    const now = Date.now();
    const note = optionalText(args.note)?.slice(0, 500);
    const reviewed = args.status === "published" || args.status === "rejected";
    await ctx.db.patch(insight._id, {
      status: args.status,
      updatedAt: now,
      ...(reviewed ? { reviewedBy: access.user._id, reviewedAt: now, reviewNote: note } : {}),
      ...(args.status === "published" ? { publishedAt: now } : {}),
    });

    await appendAuditEvent(ctx, {
      tenantId: insight.tenantId,
      eventType: `insight.${args.status === "under_review" ? "submitted_for_review" : args.status}`,
      actorType: "staff_user",
      actorId: access.user._id,
      targetType: "insight",
      targetId: insight._id,
      correlationId: `insight:${insight._id}`,
      sourceSystem: "convex",
      occurredAt: now,
      reason: note,
      payloadBefore: JSON.stringify({ status: insight.status }),
      payloadAfter: JSON.stringify({ status: args.status }),
    });

    if (args.status === "published") {
      const slug = await tenantSlug(ctx, insight.tenantId);
      await notify(ctx, {
        recipients: await clientRecipients(ctx, insight.tenantId),
        tenantId: insight.tenantId,
        kind: "insight.published",
        title: `New insight: ${insight.title}`,
        body: insight.recommendedAction,
        link: `/portal/${slug}/insights`,
      });
    }
    return { insightId: insight._id };
  },
});
