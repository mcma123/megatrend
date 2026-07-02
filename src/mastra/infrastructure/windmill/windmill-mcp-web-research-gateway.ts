import { MCPClient } from "@mastra/mcp";

import type {
  FirecrawlScrapeInput,
  SearchExecutionOptions,
  SearchInput,
  SearxngSearchInput,
  WebResearchGateway,
} from "../../ports/web-research-gateway";

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

class WindmillMcpWebResearchGateway implements WebResearchGateway {
  async search(input: SearchInput, options?: SearchExecutionOptions) {
    const remoteTool = await getRemoteTool(remoteToolIds.firecrawlSearch);
    const result = await remoteTool.execute({ query: input.query }, options);
    return parseMcpToolResult(result);
  }

  async scrape(input: FirecrawlScrapeInput, options?: SearchExecutionOptions) {
    const remoteTool = await getRemoteTool(remoteToolIds.firecrawlScrape);
    const result = await remoteTool.execute(
      {
        url: input.url,
        formats: input.formats,
        onlyMainContent: input.onlyMainContent,
      },
      options
    );

    return parseMcpToolResult(result);
  }

  async searchAlternate(input: SearxngSearchInput, options?: SearchExecutionOptions) {
    const remoteTool = await getRemoteTool(remoteToolIds.searxngSearch);
    const result = await remoteTool.execute(
      {
        query: input.query,
        limit: input.limit,
        categories: input.categories,
        maxPages: input.maxPages,
      },
      options
    );

    return parseMcpToolResult(result);
  }
}

export const windmillMcpWebResearchGateway = new WindmillMcpWebResearchGateway();
export const windmillMcpServerProxies = windmillMcp ? windmillMcp.toMCPServerProxies() : {};
