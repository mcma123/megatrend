import { ConvexError } from "convex/values";
import type { Id, Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { requireStaff, requireTenantAccess, requireTenantWriter } from "./auth";
import { requireSigningMfa } from "./signingSecurity";
import { ACTIVE_PREPARATION } from "./signingPreparation";

export async function signingFileAccess(
  ctx: QueryCtx | MutationCtx,
  agreementId: Id<"signingAgreements">,
  write = false,
) {
  await requireStaff(ctx);
  const agreement = await ctx.db.get(agreementId);
  if (!agreement) throw new ConvexError("Agreement not found");
  const access = await requireTenantAccess(ctx, agreement.tenantId);
  if (access.principalType !== "staff")
    throw new ConvexError("Signing files require company staff access");
  if (write) {
    await requireTenantWriter(ctx, agreement.tenantId);
    await requireSigningMfa(ctx);
    const company = await ctx.db.get(agreement.tenantId);
    if (!company || company.status !== "active" || agreement.status !== "draft")
      throw new ConvexError(
        "An editable draft in an active company is required",
      );
  }
  return { agreement, user: access.user };
}
export async function assertPreparationIdle(
  ctx: QueryCtx | MutationCtx,
  agreement: Doc<"signingAgreements">,
) {
  const attempt = agreement?.bundleAttemptId
    ? await ctx.db.get(agreement.bundleAttemptId)
    : null;
  if (attempt && ACTIVE_PREPARATION.has(attempt.status))
    throw new ConvexError(
      "PDF preparation is still owned by a running or unresolved job. Reconcile it before making changes",
    );
}
