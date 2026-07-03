import type {
  FirecrawlScrapeInput,
  SearchExecutionOptions,
  SearchInput,
  SearxngSearchInput,
  WebResearchGateway,
} from "../../ports/web-research-gateway";
import { getRemoteTool, parseMcpToolResult, windmillMcpServerProxies } from "./windmill-mcp-client";

const remoteToolIds = {
  firecrawlScrape: "S-f_firecrawl_firecrawl_9ad15b6b2d1f5c55",
  firecrawlSearch: "S-f_firecrawl_firecrawl_6ef120f03815b194",
  searxngSearch: "S-f_firecrawl_searxng__s4af63e1cc69a80a9",
} as const;

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
export { windmillMcpServerProxies };
