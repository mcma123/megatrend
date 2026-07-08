import { v } from "convex/values";

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
