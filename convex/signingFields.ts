import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  signingFileAccess,
  assertPreparationIdle,
} from "./lib/signingFileAccess";
import { appendSigningEvent } from "./lib/signingAudit";
import {
  fieldDefinition,
  normalizeFields,
  preparationState,
  layoutContent,
} from "./lib/signingFields";
import { signingHash } from "./lib/signing";
import { pageSchema } from "./lib/signingPreparation";

type CurrentData = {
  agreement: Doc<"signingAgreements">;
  revision: Doc<"signingRevisions">;
  participants: Doc<"signingParticipants">[];
};
export const get = query({
  args: { agreementId: v.id("signingAgreements") },
  handler: async (ctx, args) => {
    const { agreement } = await signingFileAccess(ctx, args.agreementId);
    const data: CurrentData = await ctx.runQuery(api.signing.get, args);
    const bundle = agreement.currentBundleId
      ? await ctx.db.get(agreement.currentBundleId)
      : null;
    const policy = await ctx.db
      .query("signingPolicies")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", agreement.tenantId))
      .unique();
    const prepared = await preparationState(
      ctx,
      agreement,
      bundle,
      data.revision,
      data.participants,
      policy,
    );
    const valid =
      bundle &&
      bundle.tenantId === agreement.tenantId &&
      bundle.agreementId === agreement._id &&
      bundle.revisionId === agreement.currentRevisionId &&
      bundle.fileRevision === (agreement.fileRevision ?? 0) &&
      (bundle.retainUntil ?? 0) > Date.now();
    return {
      revision: agreement.revision,
      status: agreement.status,
      layoutRevision: agreement.layoutRevision ?? 0,
      layoutId: prepared.layout?._id ?? null,
      bundle:
        valid && bundle.pages?.length
          ? {
              id: bundle._id,
              pdfHash: bundle.pdfHash,
              manifestHash: bundle.manifestHash,
              pages: bundle.pages.map((p) => pageSchema.parse(p)),
              retainUntil: bundle.retainUntil!,
            }
          : null,
      fields: prepared.fields,
      participants: data.participants.map(
        ({ key, name, email, role, responsibility, stage }) => ({
          key,
          name,
          email,
          role,
          responsibility,
          stage,
        }),
      ),
      blockers: prepared.blockers,
      preparationHash: prepared.preparationHash,
      allowSelfApproval: policy?.allowSelfApproval ?? false,
    };
  },
});
export const save = mutation({
  args: {
    agreementId: v.id("signingAgreements"),
    expectedRevision: v.number(),
    expectedLayoutRevision: v.number(),
    bundleId: v.id("signingBundles"),
    fields: v.array(fieldDefinition),
  },
  handler: async (ctx, args) => {
    const { agreement, user } = await signingFileAccess(
      ctx,
      args.agreementId,
      true,
    );
    await assertPreparationIdle(ctx, agreement);
    if (
      agreement.revision !== args.expectedRevision ||
      (agreement.layoutRevision ?? 0) !== args.expectedLayoutRevision ||
      agreement.currentBundleId !== args.bundleId
    )
      throw new ConvexError(
        "The draft, PDF or field preparation changed. Reload before saving",
      );
    const data: CurrentData = await ctx.runQuery(api.signing.get, {
      agreementId: agreement._id,
    });
    const bundle = await ctx.db.get(args.bundleId);
    if (
      !bundle ||
      bundle.tenantId !== agreement.tenantId ||
      bundle.agreementId !== agreement._id ||
      bundle.revisionId !== agreement.currentRevisionId ||
      bundle.fileRevision !== (agreement.fileRevision ?? 0) ||
      !bundle.pages?.length ||
      !bundle.manifestVersion ||
      (bundle.retainUntil ?? 0) <= Date.now()
    )
      throw new ConvexError("Prepare the current validated PDF bundle first");
    const fields = normalizeFields(
      args.fields,
      bundle.pages.map((p) => pageSchema.parse(p)),
      data.participants,
    );
    const layoutHash = await signingHash(
      layoutContent(agreement, bundle, fields),
    );
    const version = (agreement.layoutRevision ?? 0) + 1;
    const layoutId = await ctx.db.insert("signingLayouts", {
      tenantId: agreement.tenantId,
      agreementId: agreement._id,
      revisionId: data.revision._id,
      bundleId: bundle._id,
      version,
      fields,
      layoutHash,
      createdAt: Date.now(),
      createdBy: user._id,
    });
    await ctx.db.patch(agreement._id, {
      currentLayoutId: layoutId,
      layoutRevision: version,
      frozenPreparationId: undefined,
      approvalId: undefined,
      approvalPolicyRevision: undefined,
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
    await appendSigningEvent(
      ctx,
      agreement,
      user._id,
      "field_preparation_saved",
      {
        layoutId,
        layoutHash,
        version,
        bundleId: bundle._id,
        fieldCount: fields.length,
      },
    );
    return { layoutId, version, layoutHash, fields };
  },
});
