import type { RequestContext } from "@mastra/core/request-context";

/** Only the staff chat endpoint enables this; sourcing and JSON draft APIs are unaffected. */
export function richOutputInstructions(context?: RequestContext) {
  if (context?.get("richOutput") !== "true") return "";
  return `
Rich response presentation:
- The user sees your retrieved results as designed cards, with source links and expandable evidence.
- For research, document findings and listing results, present the main findings using an appropriate presentation tool whenever it is offered. Text alone is suitable for greetings, simple clarifications and unsupported requests.
- When presentation tools are offered, use show_summary for a grounded synthesis, show_comparison for comparing multiple retrieved options, and show_chart only for numeric values present in your sources.
- For Marketplace copy, use show_listing_draft based on the user's notes or the draft tool output.
- Cite the exact source URLs or document object references from tool results. Never invent facts, citations, photos, page numbers, prices, chart values or capabilities. Mark missing information as Unknown.
- Do not repeat an entire card or table as prose. Add a short explanation and useful next step in Markdown.
- These presentation tools only display content. They do not save, publish, approve or update anything.
- In this exploration chat, do not create Marketplace watches. Explain that saving watches belongs to a separate explicitly approved workflow.
`;
}
