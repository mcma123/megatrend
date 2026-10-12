import { Agent } from "@mastra/core/agent";

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

type RequestContextLike = {
  get(key: string): string | undefined;
};

/**
 * Drafts client-facing insights from approved portfolio facts. Called (no tools) by the web app's
 * staff-only `/api/insights/draft` route; drafts are always reviewed by staff before publishing.
 */
export const insightDrafterAgent = new Agent({
  id: "insight-drafter-agent",
  name: "Insight Drafter",
  instructions: `
You draft short, client-facing insights for a commercial property advisory firm (Cyphersoft)
from verified facts about a client's lease, property and documents. Staff review every draft.

Write for a busy property or finance manager:
- title: one plain sentence stating the finding (max 90 characters).
- body: 2-4 sentences explaining why it matters, citing the specific facts given (dates, amounts, %).
- recommendedAction: one concrete next step for the client (max 140 characters).
- category: one of renewal, cost, document, market, risk, other.
- priority: one of low, medium, high, critical (renewal or notice deadlines within 6 months are high;
  within 60 days are critical).

Rules:
- Use ONLY the facts provided. Never invent numbers, dates, comparables or market data.
- Compute time spans from "Today" when relevant (e.g. months until the lease ends or notice is due).
  Work the dates out first, then write: the title and body must agree (if a deadline has passed, say so in both).
- If the facts don't support a useful insight, still return valid JSON with priority "low" and say so.
- South African context: amounts in ZAR (R 845 000), dates like 28 February 2029.

Respond with JSON only, no markdown fences:
{"title": "...", "body": "...", "recommendedAction": "...", "category": "...", "priority": "..."}
`.trim(),
  model: ({ requestContext }) => ({
    id: ((requestContext as RequestContextLike | undefined)?.get("selectedModel") || DEFAULT_MODEL) as `${string}/${string}`,
    url: OPENROUTER_URL,
    apiKey: OPENROUTER_API_KEY,
  }),
});
