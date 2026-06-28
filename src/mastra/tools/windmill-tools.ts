import { createTool } from "@mastra/core/tools";
import { MCPClient } from "@mastra/mcp";
import { z } from "zod";

const windmillMcpUrl = process.env.WINDMILL_MCP_URL;
const windmillMcpTimeoutMs = Number(process.env.WINDMILL_MCP_TIMEOUT_MS ?? "120000");

const windmillMcp = windmillMcpUrl
  ? new MCPClient({
      id: "windmill-megatrend",
      servers: {
        windmill: {
          url: new URL(windmillMcpUrl),
          timeout: windmillMcpTimeoutMs,
        },
      },
      timeout: windmillMcpTimeoutMs,
    })
  : null;

let windmillToolsPromise: Promise<Record<string, any>> | null = null;

const remoteToolIds = {
  firecrawlScrape: "S-f_firecrawl_firecrawl_9ad15b6b2d1f5c55",
  firecrawlSearch: "S-f_firecrawl_firecrawl_6ef120f03815b194",
  searxngSearch: "S-f_firecrawl_searxng__s4af63e1cc69a80a9",
} as const;

function parseMcpToolResult(result: any) {
  const textPart = Array.isArray(result?.content)
    ? result.content.find((part: any) => part?.type === "text" && typeof part?.text === "string")
    : null;

  if (!textPart) {
    return result;
  }

  try {
    return JSON.parse(textPart.text);
  } catch {
    return {
      rawText: textPart.text,
    };
  }
}

async function loadWindmillTools() {
  if (!windmillMcp) {
    throw new Error("WINDMILL_MCP_URL is not configured.");
  }

  if (!windmillToolsPromise) {
    windmillToolsPromise = windmillMcp.listTools().catch(error => {
      windmillToolsPromise = null;
      throw error;
    });
  }

  return windmillToolsPromise;
}

async function getRemoteTool(toolId: string) {
  const windmillTools = await loadWindmillTools();
  const namespacedToolId = `windmill_${toolId}`;
  const tool = windmillTools[namespacedToolId] ?? windmillTools[toolId];
  if (!tool) {
    const availableTools = Object.keys(windmillTools).sort().join(", ");
    throw new Error(`Windmill MCP tool '${namespacedToolId}' was not found. Available tools: ${availableTools}`);
  }

  return tool;
}

export const windmillResearchTools = {
  windmill_firecrawl_search: createTool({
    id: "windmill_firecrawl_search",
    description:
      "Search the web with Firecrawl. Use this first for broad discovery when you need current pages, titles, snippets, and URLs.",
    inputSchema: z.object({
      query: z.string().min(1).describe("The web search query."),
    }),
    outputSchema: z.any(),
    execute: async ({ query }, options) => {
      const remoteTool = await getRemoteTool(remoteToolIds.firecrawlSearch);
      const result = await remoteTool.execute({ query }, options);
      return parseMcpToolResult(result);
    },
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
    execute: async ({ url, formats, onlyMainContent }, options) => {
      const remoteTool = await getRemoteTool(remoteToolIds.firecrawlScrape);
      const result = await remoteTool.execute(
        {
          url,
          formats,
          onlyMainContent,
        },
        options
      );

      return parseMcpToolResult(result);
    },
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
    execute: async ({ query, limit, categories, maxPages }, options) => {
      const remoteTool = await getRemoteTool(remoteToolIds.searxngSearch);
      const result = await remoteTool.execute(
        {
          query,
          limit,
          categories,
          maxPages,
        },
        options
      );

      return parseMcpToolResult(result);
    },
  }),
};

export const windmillMcpServerProxies = windmillMcp ? windmillMcp.toMCPServerProxies() : {};
