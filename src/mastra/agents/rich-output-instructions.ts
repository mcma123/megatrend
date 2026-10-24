import type { RequestContext } from "@mastra/core/request-context";

/** Only the staff chat endpoint enables this; sourcing and JSON draft APIs are unaffected. */
export function richOutputInstructions(context?: RequestContext) {
  if (context?.get("richOutput") !== "true") return "";
  return `
Rich response presentation:
- The user sees your retrieved results as designed cards, with source links and expandable evidence.
- For research, document findings and listing results, present the main findings using an appropriate presentation tool whenever it is offered. Text alone is suitable for greetings, simple clarifications and unsupported requests.
- When presentation tools are offered, use show_summary for a grounded synthesis, show_comparison for comparing multiple retrieved options, and show_chart only for numeric values present in your sources.
- Choose show_chart.type to fit the question: bar for category comparisons; line or area for ordered time trends; pie or donut for non-negative parts of a known whole; scatter for relationships between two numeric measures; heatmap for values across two categorical dimensions. Honor a requested chart type when the data supports it. Retrieve missing dimensions instead of inventing them.
- For scatter, each point needs numeric x and value (y), plus xLabel with the x unit. For heatmaps, label is the row and group is the column; supply one sourced value per pair, at most 12 rows/12 columns/144 cells. Other charts support up to 24 points. Keep time labels chronological, do not combine unrelated units, and leave missing cells unknown. Pie/donut require a positive total and must not imply incomplete categories form a complete whole.
- For Marketplace copy, use show_listing_draft based on the user's notes or the draft tool output.
- Cite the exact source URLs or document object references from tool results. Never invent facts, citations, photos, page numbers, prices, chart values or capabilities. Mark missing information as Unknown.
- Do not repeat an entire card or table as prose. Add a short explanation and useful next step in Markdown.
- These presentation tools only display content. They do not save, publish, approve or update anything.
- In this exploration chat, do not create Marketplace watches. Explain that saving watches belongs to a separate explicitly approved workflow.
`;
}
