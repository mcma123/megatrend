import { ConvexError } from "convex/values";
import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { appendAuditEvent } from "./audit";
import { normalizeEmail } from "./auth";

export const DEFAULT_ROLES = [
  { key: "platform_admin", scope: "staff", label: "Platform Admin", description: "Global administration, tenancy setup, and policy control." },
  { key: "tenant_admin", scope: "staff", label: "Tenant Admin", description: "Tenant-scoped governance, memberships, and settings." },
  { key: "account_manager", scope: "staff", label: "Account Manager", description: "Portfolio review, publication, and client relationship work." },
  { key: "operations_analyst", scope: "staff", label: "Operations Analyst", description: "Document triage, extraction review, and workflow operations." },
  { key: "finance_reviewer", scope: "staff", label: "Finance Reviewer", description: "Invoice, utility, and financial anomaly review." },
  { key: "read_only_staff", scope: "staff", label: "Read Only Staff", description: "Inspection access without mutation rights." },
  { key: "client_admin", scope: "client", label: "Client Admin", description: "Team membership, portal access, and client governance." },
  { key: "property_manager", scope: "client", label: "Property Manager", description: "Property operations, renewals, and action handling." },
  { key: "finance_user", scope: "client", label: "Finance User", description: "Invoice, utility, and payment review access." },
  { key: "legal_reviewer", scope: "client", label: "Legal Reviewer", description: "Lease and obligations review access." },
  { key: "executive_viewer", scope: "client", label: "Executive Viewer", description: "Read-only executive portfolio and insight access." },
] as const;

/** Idempotent: inserts any system roles that are missing. */
export async function seedRoles(ctx: MutationCtx) {
  let inserted = 0;
  for (const role of DEFAULT_ROLES) {
    const existing = await ctx.db
      .query("roles")
      .withIndex("by_key", (q) => q.eq("key", role.key))
      .unique();
    if (!existing) {
      await ctx.db.insert("roles", { ...role, isSystem: true });
      inserted += 1;
    }
  }
  return { inserted, total: DEFAULT_ROLES.length };
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export type ClientProfileFields = {
  industry?: string;
  clientType?: "managed" | "tenant_rep";
  relationshipStatus?: "active" | "prospect" | "dormant";
  accountManagerName?: string;
  clientSince?: string;
};

export type ClientRoleKey =
  | "client_admin"
  | "property_manager"
  | "finance_user"
  | "legal_reviewer"
  | "executive_viewer";

/**
 * Creates a client workspace: tenant + settings + organization, and gives the
 * creating staff user a platform_admin membership so it shows in their staff views.
 */
export async function provisionClientTenant(
  ctx: MutationCtx,
  actor: Doc<"users">,
  args: {
    slug: string;
    displayName: string;
    primaryRegion: string;
    primaryContactName: string;
    primaryContactEmail: string;
    profile?: ClientProfileFields;
  },
) {
  const slug = slugify(args.slug);
  if (!slug) {
    throw new ConvexError("Enter a portal code using letters or numbers");
  }
  const displayName = args.displayName.trim();
  if (!displayName) {
    throw new ConvexError("Client name is required");
  }
  const contactEmail = normalizeEmail(args.primaryContactEmail);
  if (!contactEmail) {
    throw new ConvexError("Primary contact email is required");
  }

  const existingTenant = await ctx.db
    .query("tenants")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (existingTenant) {
    throw new ConvexError(`The portal code "${slug}" is already in use`);
  }

  await seedRoles(ctx);
  const now = Date.now();

  const tenantId = await ctx.db.insert("tenants", {
    slug,
    displayName,
    status: "active",
    primaryRegion: args.primaryRegion,
    createdAt: now,
    createdBy: actor._id,
  });

  const settingsId = await ctx.db.insert("tenantSettings", {
    tenantId,
    renewalHorizonDays: 180,
    publishConfidenceThreshold: 90,
    retentionPolicyKey: "default-7y",
    defaultDocumentRegion: args.primaryRegion,
    updatedAt: now,
    updatedBy: actor._id,
  });
  await ctx.db.patch(tenantId, { settingsId });

  const organizationId = await ctx.db.insert("organizations", {
    tenantId,
    name: displayName,
    slug,
    status: "active",
    primaryContactName: args.primaryContactName.trim(),
    primaryContactEmail: contactEmail,
    ...args.profile,
    createdAt: now,
    createdBy: actor._id,
  });

  await ctx.db.insert("memberships", {
    tenantId,
    organizationId,
    userId: actor._id,
    principalType: "staff",
    roleKey: "platform_admin",
    status: "active",
    createdAt: now,
    createdBy: actor._id,
  });

  await appendAuditEvent(ctx, {
    tenantId,
    eventType: "tenant.created",
    actorType: "staff_user",
    actorId: actor._id,
    targetType: "tenant",
    targetId: tenantId,
    correlationId: `tenant:${tenantId}`,
    sourceSystem: "convex",
    occurredAt: now,
    payloadAfter: JSON.stringify({ slug, displayName, organizationId }),
  });

  return { tenantId, organizationId, settingsId, slug };
}

/** Creates a pending client invitation for a tenant (rejects duplicates). */
export async function createClientInvitation(
  ctx: MutationCtx,
  args: {
    tenantId: Id<"tenants">;
    organizationId: Id<"organizations">;
    email: string;
    fullName?: string;
    roleKey: ClientRoleKey;
    invitedBy: Id<"users">;
    actorType: "staff_user" | "client_user";
  },
) {
  const email = normalizeEmail(args.email);
  if (!email) {
    throw new ConvexError("Enter a valid email address");
  }
  const pending = await ctx.db
    .query("membershipInvitations")
    .withIndex("by_email_and_status", (q) => q.eq("email", email).eq("status", "pending"))
    .take(25);
  if (pending.some((invitation) => invitation.tenantId === args.tenantId)) {
    throw new ConvexError("A pending invitation already exists for this email");
  }

  const now = Date.now();
  const invitationId = await ctx.db.insert("membershipInvitations", {
    tenantId: args.tenantId,
    organizationId: args.organizationId,
    email,
    fullName: args.fullName?.trim() || undefined,
    principalType: "client",
    roleKey: args.roleKey,
    status: "pending",
    invitedBy: args.invitedBy,
    providerHint: "password",
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 1000 * 60 * 60 * 24 * 7,
  });

  await appendAuditEvent(ctx, {
    tenantId: args.tenantId,
    eventType: "membership.invited",
    actorType: args.actorType,
    actorId: args.invitedBy,
    targetType: "membership_invitation",
    targetId: invitationId,
    correlationId: `membership-invitation:${invitationId}`,
    sourceSystem: "portal",
    occurredAt: now,
    payloadAfter: JSON.stringify({ email, roleKey: args.roleKey }),
  });

  return { invitationId, email };
}
