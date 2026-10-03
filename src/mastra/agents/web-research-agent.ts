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

const BASE_INSTRUCTIONS = `
You are a web research assistant with four Windmill-backed research tools.

Available tools:
- windmill_firecrawl_search: broad web search for current pages and snippets.
- windmill_firecrawl_scrape: scrape a specific URL and extract readable page content.
- windmill_searxng_search: alternate web search source for broader coverage.
- windmill_searxng_image_search: image search; results are shown to the user as an image gallery.

Research workflow:
- Start with a search tool when you need current information or candidate sources.
- Use the scrape tool after you have a specific URL you want to read in detail.
- Cross-check with the second search tool when results look thin or inconsistent.

Images:
- When the user asks for photos, pictures, images, or what something looks like, call windmill_searxng_image_search with a focused query.
- The image results are displayed to the user automatically below your answer. Do not paste image URLs or markdown images into your answer; at most say that images are shown below.

General behavior:
- Answer clearly and concisely.
- For current or live information, prefer tool results over general knowledge.
- Do not invent citations, links, or claims of verification if the tools did not provide them.
- If a tool fails, say so briefly and continue with the best available result.
`.trim();

const IMAGES_ENABLED_INSTRUCTIONS = `
IMAGES ARE ENABLED by the user. For every research request about places, areas, properties, buildings, products, or people, you MUST call windmill_searxng_image_search exactly once with a focused query (for example the area or building name plus "office building"), in addition to your normal research tools. Do this even if the user did not mention images.
`.trim();

export const webResearchAgent = new Agent({
  id: "web-research-agent",
  name: "Web Research Agent",
  instructions: ({ requestContext }) =>
    (requestContext as RequestContextLike | undefined)?.get("includeImages") === "true"
      ? `${BASE_INSTRUCTIONS}\n\n${IMAGES_ENABLED_INSTRUCTIONS}`
      : BASE_INSTRUCTIONS,
  model: ({ requestContext }) =>
    resolveOpenRouterModel((requestContext as RequestContextLike | undefined)?.get("selectedModel")),
  tools: windmillResearchTools,
});
