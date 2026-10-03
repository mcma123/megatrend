import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { WebResearchService } from "../application/web-research/web-research-service";
import {
  windmillMcpServerProxies,
  windmillMcpWebResearchGateway,
} from "../infrastructure/windmill/windmill-mcp-web-research-gateway";

const webResearchService = new WebResearchService(windmillMcpWebResearchGateway);

export const windmillResearchTools = {
  windmill_firecrawl_search: createTool({
    id: "windmill_firecrawl_search",
    description:
      "Search the web with Firecrawl. Use this first for broad discovery when you need current pages, titles, snippets, and URLs.",
    inputSchema: z.object({
      query: z.string().min(1).describe("The web search query."),
    }),
    outputSchema: z.any(),
    execute: async ({ query }, options) => webResearchService.search({ query }, options),
  }),
  windmill_firecrawl_scrape: createTool({
    id: "windmill_firecrawl_scrape",
    description:
      "Scrape a known URL with Firecrawl and return the page content. Use this after you already have a specific page to read.",
    inputSchema: z.object({
      url: z.string().url().describe("The page URL to scrape."),
      formats: z.array(z.string()).default(["markdown"]).describe("Desired output formats, usually ['markdown']."),
      onlyMainContent: z.boolean().default(true).describe("Whether to extract only the main readable content."),
    }),
    outputSchema: z.any(),
    execute: async ({ url, formats, onlyMainContent }, options) =>
      webResearchService.scrape({ url, formats, onlyMainContent }, options),
  }),
  windmill_searxng_search: createTool({
    id: "windmill_searxng_search",
    description:
      "Search the web with SearXNG. Use this as an alternative search source or fallback when you want broader result coverage.",
    inputSchema: z.object({
      query: z.string().min(1).describe("The web search query."),
      limit: z.number().int().min(1).max(100).default(50).describe("Maximum number of results to return."),
      categories: z.string().default("general").describe("SearXNG categories to search."),
      maxPages: z.number().int().min(1).max(10).default(5).describe("Maximum number of result pages to scan."),
    }),
    outputSchema: z.any(),
    execute: async ({ query, limit, categories, maxPages }, options) =>
      webResearchService.searchAlternate({ query, limit, categories, maxPages }, options),
  }),
  windmill_searxng_image_search: createTool({
    id: "windmill_searxng_image_search",
    description:
      "Search for images with SearXNG. Use when the user wants photos, pictures, or to see what a place, property, product, or person looks like. Results are shown to the user as an image gallery automatically.",
    inputSchema: z.object({
      query: z.string().min(1).describe("A focused image search query, e.g. 'Sandton City office tower'."),
      limit: z.number().int().min(1).max(30).default(12).describe("Maximum number of images to return."),
    }),
    outputSchema: z.any(),
    execute: async ({ query, limit }, options) => {
      const raw = (await webResearchService.searchAlternate(
        { query, limit, categories: "images", maxPages: 1 },
        options,
      )) as { success?: boolean; error?: string | null; results?: unknown } | null;

      // Keep only image fields: the UI gallery reads this output and it keeps model tokens down.
      const results = (Array.isArray(raw?.results) ? raw.results : [])
        .filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null && typeof item.imageUrl === "string",
        )
        .map((item) => ({
          title: typeof item.title === "string" ? item.title : null,
          imageUrl: item.imageUrl as string,
          thumbnailUrl: typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : null,
          pageUrl: typeof item.url === "string" ? item.url : null,
          source: typeof item.source === "string" ? item.source : null,
        }));

      return {
        success: raw?.success ?? results.length > 0,
        query,
        resultCount: results.length,
        results,
        error: raw?.error ?? null,
      };
    },
  }),
};

export { windmillMcpServerProxies };
