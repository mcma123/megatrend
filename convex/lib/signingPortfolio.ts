import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const portfolioContext = v.object({
  unitId: v.id("portfolioUnits"),
  ownerId: v.id("portfolioParties"),
  renterId: v.id("portfolioParties"),
  participantLinks: v.array(
    v.object({ key: v.string(), partyId: v.id("portfolioParties") }),
  ),
});
export const applicationMode = v.union(
  v.literal("create"),
  v.literal("amend"),
  v.literal("renew"),
);
export async function validatePortfolioContext(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  propertyId: Id<"properties"> | undefined,
  context: Infer<typeof portfolioContext>,
  keys: string[],
) {
  const property = propertyId ? await ctx.db.get(propertyId) : null;
  const unit = await ctx.db.get(context.unitId);
  const owner = await ctx.db.get(context.ownerId),
    renter = await ctx.db.get(context.renterId);
  if (
    !property ||
    property.tenantId !== tenantId ||
    property.archivedAt ||
    !unit ||
    unit.tenantId !== tenantId ||
    unit.propertyId !== propertyId ||
    !owner ||
    owner.tenantId !== tenantId ||
    owner.kind !== "owner" ||
    !renter ||
    renter.tenantId !== tenantId ||
    renter.kind !== "renter"
  )
    throw new ConvexError(
      "Choose a property, unit, owner and renter belonging to this company",
    );
  if (
    context.participantLinks.length > 20 ||
    new Set(context.participantLinks.map((p) => p.key)).size !==
      context.participantLinks.length ||
    context.participantLinks.some(
      (p) =>
        !keys.includes(p.key) ||
        ![context.ownerId, context.renterId].includes(p.partyId),
    ) ||
    !context.participantLinks.some((p) => p.partyId === context.ownerId) ||
    !context.participantLinks.some((p) => p.partyId === context.renterId)
  )
    throw new ConvexError(
      "Participant links must explicitly match these parties and agreement participants",
    );
}
export const leaseTerms = v.object({
  startDate: v.string(),
  endDate: v.string(),
  monthlyRent: v.string(),
  deposit: v.string(),
  escalationPercent: v.number(),
  noticePeriodMonths: v.number(),
});
export const downstreamPlan = v.object({
  payments: v.array(
    v.object({ purpose: v.string(), amount: v.string(), dueDate: v.string() }),
  ),
  moveInDueDate: v.optional(v.string()),
  renewalReminders: v.boolean(),
});
