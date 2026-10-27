"use node";
import { inflateSync } from "node:zlib";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { sanitizePng, signerMarkKind } from "./lib/signerPortal";

/** Decodes untrusted signature images in Node; only the rebuilt critical-chunk PNG is stored. */
export const sanitize = internalAction({
  args: { image: v.string(), kind: signerMarkKind },
  handler: async (_ctx, args) =>
    sanitizePng(args.image, args.kind, async (parts, limit) => {
      try {
        return inflateSync(Buffer.concat(parts), { maxOutputLength: limit })
          .byteLength;
      } catch {
        return -1;
      }
    }),
});
