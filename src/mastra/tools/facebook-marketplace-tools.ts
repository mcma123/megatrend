import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { FacebookMarketplaceService } from "../application/facebook-marketplace/facebook-marketplace-service";
import { printingPressFacebookMarketplaceGateway } from "../infrastructure/facebook-marketplace/printing-press-facebook-marketplace-gateway";

const facebookMarketplaceService = new FacebookMarketplaceService(
  printingPressFacebookMarketplaceGateway
);

export const facebookMarketplaceTools = {
  facebook_marketplace_doctor: createTool({
    id: "facebook_marketplace_doctor",
    description:
      "Check whether the Facebook Marketplace Printing Press CLI is configured correctly, including auth state, config path, and missing prerequisites.",
    inputSchema: z.object({
      failOn: z.enum(["stale", "error"]).optional().describe("Optionally return a failing exit code when this health level is reached."),
    }),
    outputSchema: z.any(),
    execute: async ({ failOn }) => facebookMarketplaceService.doctor({ failOn }),
  }),
  facebook_marketplace_search: createTool({
    id: "facebook_marketplace_search",
    description:
      "Search Facebook Marketplace listings through the Printing Press CLI. Use this for live Marketplace discovery after auth is configured.",
    inputSchema: z.object({
      query: z.string().min(1).describe("The Marketplace search query."),
      count: z.number().int().min(1).max(100).default(24).describe("How many results to request."),
      minPrice: z.number().nonnegative().optional().describe("Minimum price in dollars."),
      maxPrice: z.number().nonnegative().optional().describe("Maximum price in dollars."),
      radiusMiles: z.number().int().positive().optional().describe("Search radius in miles."),
      condition: z.string().optional().describe("Optional Marketplace condition filter value."),
      daysListedWithin: z.number().int().positive().optional().describe("Only show listings newer than this many days."),
      cursor: z.string().optional().describe("Optional pagination cursor."),
    }),
    outputSchema: z.any(),
    execute: async input =>
      facebookMarketplaceService.search({
        ...input,
        count: input.count ?? 24,
      }),
  }),
  facebook_marketplace_get_listing: createTool({
    id: "facebook_marketplace_get_listing",
    description:
      "Fetch the detail payload for a specific Facebook Marketplace listing by listing id.",
    inputSchema: z.object({
      listingId: z.string().min(1).describe("The Marketplace listing id."),
    }),
    outputSchema: z.any(),
    execute: async ({ listingId }) => facebookMarketplaceService.getListing({ listingId }),
  }),
  facebook_marketplace_draft: createTool({
    id: "facebook_marketplace_draft",
    description:
      "Draft Marketplace listing copy from notes and optional photo paths. This does not publish anything to Facebook.",
    inputSchema: z.object({
      notes: z.string().min(1).describe("Seller notes about the item."),
      photoPaths: z.array(z.string()).default([]).describe("Optional local photo paths to include."),
      targetPrice: z.number().nonnegative().optional().describe("Optional target listing price in dollars."),
    }),
    outputSchema: z.any(),
    execute: async ({ notes, photoPaths, targetPrice }) =>
      facebookMarketplaceService.draft({
        notes,
        photoPaths: photoPaths ?? [],
        targetPrice,
      }),
  }),
  facebook_marketplace_watch_add: createTool({
    id: "facebook_marketplace_watch_add",
    description:
      "Create a local Facebook Marketplace watch in the Printing Press CLI so future matches can be monitored automatically.",
    requireApproval: true,
    inputSchema: z.object({
      name: z.string().min(1).describe("Short name for the saved watch."),
      query: z.string().min(1).describe("Marketplace search query to monitor."),
      minPrice: z.number().nonnegative().optional().describe("Minimum price in dollars."),
      maxPrice: z.number().nonnegative().optional().describe("Maximum price in dollars."),
      radiusMiles: z.number().int().positive().optional().describe("Maximum search radius in miles."),
      mustHaveKeywords: z.array(z.string()).default([]).describe("Keywords that must appear in the title."),
      rejectKeywords: z.array(z.string()).default([]).describe("Keywords that should exclude a listing."),
    }),
    outputSchema: z.any(),
    execute: async input =>
      facebookMarketplaceService.addWatch({
        ...input,
        mustHaveKeywords: input.mustHaveKeywords ?? [],
        rejectKeywords: input.rejectKeywords ?? [],
      }),
  }),
  facebook_marketplace_matches: createTool({
    id: "facebook_marketplace_matches",
    description:
      "Read locally stored Marketplace watch matches from the Printing Press CLI.",
    inputSchema: z.object({
      onlyNew: z.boolean().default(true).describe("Whether to only show new matches."),
    }),
    outputSchema: z.any(),
    execute: async ({ onlyNew }) => facebookMarketplaceService.getMatches({ onlyNew }),
  }),
};
