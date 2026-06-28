import { Agent } from "@mastra/core/agent";

import { windmillResearchTools } from "../tools/windmill-tools";

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

type RequestContextLike = {
  get(key: string): string | undefined;
};

function resolveOpenRouterModel(selectedModel?: string) {
  return {
    id: (selectedModel || DEFAULT_MODEL) as `${string}/${string}`,
    url: OPENROUTER_URL,
    apiKey: OPENROUTER_API_KEY,
  };
}

export const webResearchAgent = new Agent({
  id: "web-research-agent",
  name: "Web Research Agent",
  instructions: `
You are a web research assistant with three Windmill-backed research tools.

Available tools:
- windmill_firecrawl_search: broad web search for current pages and snippets.
- windmill_firecrawl_scrape: scrape a specific URL and extract readable page content.
- windmill_searxng_search: alternate web search source for broader coverage.

Research workflow:
- Start with a search tool when you need current information or candidate sources.
- Use the scrape tool after you have a specific URL you want to read in detail.
- Cross-check with the second search tool when results look thin or inconsistent.

General behavior:
- Answer clearly and concisely.
- For current or live information, prefer tool results over general knowledge.
- Do not invent citations, links, or claims of verification if the tools did not provide them.
- If a tool fails, say so briefly and continue with the best available result.
`.trim(),
  model: ({ requestContext }) =>
    resolveOpenRouterModel((requestContext as RequestContextLike | undefined)?.get("selectedModel")),
  tools: windmillResearchTools,
});
