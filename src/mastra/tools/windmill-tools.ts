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
};

export { windmillMcpServerProxies };
