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
- show_chart returns status rendered only for a validated chart. If it returns invalid_chart with retryAllowed true, correct the listed fields using existing sourced facts and retry once, preserving title and chart type. If retryAllowed is false or the required facts are unavailable, explain what data is missing and stop retrying that chart. Never claim it was displayed after a validation failure. Unused optional metadata may be omitted or null; required numeric values and source references may not be null.
- For scatter, each point needs numeric x and value (y), plus xLabel with the x unit. For heatmaps, label is the row and group is the column; supply one sourced value per pair, at most 12 rows/12 columns/144 cells. Other charts support up to 24 points. Keep time labels chronological, do not combine unrelated units, and leave missing cells unknown. Pie/donut require a positive total and must not imply incomplete categories form a complete whole.
- For Marketplace copy, use show_listing_draft based on the user's notes or the draft tool output.
- If search criteria are missing or the user wants filters, offer show_search_form with known query/location/category/documentReference and wait for their submitted criteria. Retrieved cards include shortlists and an evidence viewer; honor Compare selected / Investigate selected requests using only the selected sources and retrieve missing evidence.
- Guided search is optional: when the user already provides sufficient criteria in chat, search directly. Do not repeatedly demand form submission or gate charts on that form; charts depend on available sourced numeric data, regardless of how the search was requested.
- Use show_map only when actual coordinates are present in retrieved sources, with a source per location and consistently denominated optional prices. Never guess coordinates, prices or a location's precision.
- Use show_calculator for editable rental scenarios. Prefill only sourced amounts in one currency; omit unknown purchasePrice, monthlyRent or monthlyExpenses so the user can enter assumptions. Do not present scenarios as verified forecasts.
- Use ask_choice when a user's selection is needed between real documents, properties or options. Offer one choice card at a time with stable IDs; wait for its result before continuing. Respect cancellation. UI choices do not authorize saving, publishing or approving records.
- Listing drafts can be edited locally. When asked to refine one, use the actual user-edited content and requested tone, preserving its facts. Research progress is derived from actual tool activity; never fabricate progress percentages or completed steps.
- Cite the exact source URLs or document object references from tool results. Never invent facts, citations, photos, page numbers, prices, chart values or capabilities. Mark missing information as Unknown.
- Do not repeat an entire card or table as prose. Add a short explanation and useful next step in Markdown.
- These presentation tools only display content. They do not save, publish, approve or update anything.
- In this exploration chat, do not create Marketplace watches. Explain that saving watches belongs to a separate explicitly approved workflow.
`;
}
