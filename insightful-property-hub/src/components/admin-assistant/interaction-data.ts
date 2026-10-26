import { z } from "zod";
import { safeUrl, type ResultCard } from "./rich-output-data";
export function isIntentionalChoiceAbort(event: {
  code: string;
  error: { message: string };
  context: Record<string, unknown>;
}) {
  return (
    event.code === "tool_handler_failed" &&
    event.context.toolName === "ask_choice" &&
    event.error.message === "Human-in-the-loop interaction aborted"
  );
}

export const searchFormSchema = z.object({
  title: z.string().min(1).max(240),
  query: z
    .string()
    .max(2000)
    .nullish()
    .transform((value) => value ?? undefined),
  location: z
    .string()
    .max(240)
    .nullish()
    .transform((value) => value ?? undefined),
  category: z
    .string()
    .max(160)
    .nullish()
    .transform((value) => value ?? undefined),
  documentReference: z
    .string()
    .max(500)
    .nullish()
    .transform((value) => value ?? undefined),
});
export type SearchCriteria = {
  query: string;
  location?: string;
  category?: string;
  documentReference?: string;
  minimum?: string;
  maximum?: string;
  currency?: string;
};
export function searchPrompt(agentId: string, criteria: SearchCriteria) {
  const query = criteria.query.trim();
  if (!query) throw new Error("Enter what you want to find.");
  const documents = agentId === "okf-agent";
  const min = criteria.minimum?.trim(),
    max = criteria.maximum?.trim();
  if (
    !documents &&
    [min, max].some(
      (value) =>
        value &&
        (!Number.isFinite(Number(value)) ||
          Number(value) < 0 ||
          Number(value) > Number.MAX_SAFE_INTEGER),
    )
  )
    throw new Error("Enter valid, non-negative budget amounts.");
  if (!documents && min && max && Number(min) > Number(max))
    throw new Error("Minimum budget must not exceed maximum budget.");
  const fields = documents
    ? {
        query: query.slice(0, 2000),
        documentReference:
          criteria.documentReference?.trim().slice(0, 500) || "Discover relevant documents",
      }
    : {
        query: query.slice(0, 2000),
        location: criteria.location?.trim().slice(0, 240) || "Not specified",
        category: criteria.category?.trim().slice(0, 160) || "Not specified",
        minimumBudget: min || "Not specified",
        maximumBudget: max || "Not specified",
        currency: criteria.currency?.trim().slice(0, 20) || "Not specified",
      };
  return `Search using these user-selected criteria:\n${JSON.stringify(fields, null, 2)}\nRetrieve relevant sources and present sourced results. Mark unavailable facts as Unknown.`;
}
export function resultIdentity(card: ResultCard) {
  return safeUrl(card.url) || card.reference?.trim() || "";
}
export function toggleShortlist(cards: ResultCard[], card: ResultCard): ResultCard[] {
  const id = resultIdentity(card);
  if (!id) return cards;
  if (cards.some((item) => resultIdentity(item) === id))
    return cards.filter((item) => resultIdentity(item) !== id);
  return cards.length < 8 ? [...cards, card] : cards;
}
export function shortlistPrompt(cards: ResultCard[], compare: boolean) {
  if (cards.length < (compare ? 2 : 1))
    throw new Error(compare ? "Select at least two results to compare." : "Select a result first.");
  const selected = cards.slice(0, 8).map((card) => ({
    title: card.title,
    source: resultIdentity(card),
    detail: card.label || "Unknown",
    excerpt: card.description?.slice(0, 1000),
  }));
  return `${compare ? "Compare" : "Investigate"} only these user-selected results. Retrieve supporting evidence before adding facts, cite each source, and mark missing values Unknown:\n${JSON.stringify(selected, null, 2)}`;
}
export function highlightedParts(
  content: string,
  query: string,
): { text: string; match: boolean }[] {
  const needle = query.trim().slice(0, 120).toLowerCase();
  if (!needle) return [{ text: content, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  const haystack = content.toLowerCase();
  let cursor = 0,
    index = haystack.indexOf(needle),
    count = 0;
  while (index >= 0 && count++ < 100) {
    parts.push(
      { text: content.slice(cursor, index), match: false },
      { text: content.slice(index, index + needle.length), match: true },
    );
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
  }
  parts.push({ text: content.slice(cursor), match: false });
  return parts;
}
