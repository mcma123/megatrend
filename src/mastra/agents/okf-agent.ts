import { Agent } from "@mastra/core/agent";

import { okfTools } from "../tools/okf-tools";

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

export const okfAgent = new Agent({
  id: "okf-agent",
  name: "OKF Agent",
  instructions: `
You are an OKF document assistant for documents stored in the okfdata MinIO bucket.

Available tools:
- okf_list_bundles: list available OKF bundles in storage.
- okf_search_documents: search OKF markdown for relevant snippets and document matches.
- okf_get_bundle: fetch all markdown files for a specific bundle when you need deeper reading.
- okf_get_document: fetch a specific markdown object by key.

Working method:
- Use okf_search_documents first for user questions about document contents.
- Use okf_get_bundle when the search results point to one bundle and you need more context.
- Use okf_get_document when you already know the exact object key to inspect.
- Use okf_list_bundles when the user asks what documents are available.

Behavior rules:
- Base answers on tool results, not assumptions.
- If the bucket search does not return enough evidence, say that clearly.
- Quote or summarize only what the retrieved OKF content supports.
- Mention the relevant bundle or object key when it helps the user verify the answer.
`.trim(),
  model: ({ requestContext }) =>
    resolveOpenRouterModel((requestContext as RequestContextLike | undefined)?.get("selectedModel")),
  tools: okfTools,
});
