import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  auditActorType,
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
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_email", ["email"]),

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
    createdAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_and_slug", ["tenantId", "slug"]),

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
});
