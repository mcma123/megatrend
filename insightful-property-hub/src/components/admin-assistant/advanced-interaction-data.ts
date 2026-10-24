import { z } from "zod";
import type { Message } from "@ag-ui/core";
import { resultError } from "./rich-output-data";
export function toolFailed(result: unknown) {
  return resultError(result) || (typeof result === "string" && /^Error:/i.test(result));
}

export const mapSchema = z.object({
  title: z.string().min(1).max(240),
  priceUnit: z.string().max(80).optional(),
  locations: z
    .array(
      z.object({
        title: z.string().min(1).max(240),
        latitude: z.number().finite().min(-85).max(85),
        longitude: z.number().finite().min(-180).max(180),
        source: z.string().min(1).max(2000),
        price: z.number().finite().nonnegative().max(1e12).optional(),
      }),
    )
    .min(1)
    .max(24),
});
export function mapEmbedUrl(latitude: number, longitude: number) {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 85 ||
    Math.abs(longitude) > 180
  )
    throw new Error("Invalid map coordinates.");
  const params = new URLSearchParams({
    bbox: `${Math.max(-180, longitude - 0.04)},${Math.max(-85, latitude - 0.03)},${Math.min(180, longitude + 0.04)},${Math.min(85, latitude + 0.03)}`,
    layer: "mapnik",
    marker: `${latitude},${longitude}`,
  });
  return `https://www.openstreetmap.org/export/embed.html?${params}`;
}
const scenarioValue = z.object({
  value: z.number().finite().nonnegative().max(1e12),
  source: z.string().min(1).max(2000),
});
export const calculatorSchema = z.object({
  title: z.string().min(1).max(240),
  currency: z.string().min(1).max(20),
  purchasePrice: scenarioValue.optional(),
  monthlyRent: scenarioValue.optional(),
  monthlyExpenses: scenarioValue.optional(),
});
export function calculateScenario(
  purchasePrice: string,
  monthlyRent: string,
  monthlyExpenses: string,
) {
  if (![purchasePrice, monthlyRent, monthlyExpenses].every((value) => value.trim())) return null;
  const [price, rent, expenses] = [purchasePrice, monthlyRent, monthlyExpenses].map(Number);
  if (
    [price, rent, expenses].some((value) => !Number.isFinite(value) || value < 0 || value > 1e12) ||
    price <= 0
  )
    return null;
  const result = {
    annualGross: rent * 12,
    annualNet: (rent - expenses) * 12,
    grossYield: ((rent * 12) / price) * 100,
    netYield: (((rent - expenses) * 12) / price) * 100,
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}
export const choiceSchema = z.object({
  title: z.string().min(1).max(240),
  question: z.string().min(1).max(2000),
  options: z
    .array(
      z.object({
        id: z.string().min(1).max(500),
        label: z.string().min(1).max(240),
        description: z.string().max(1000).optional(),
      }),
    )
    .min(2)
    .max(8),
});
export function researchSteps(messages: Message[]) {
  let start = 0;
  messages.forEach((message, index) => {
    if (message.role === "user") start = index + 1;
  });
  const current = messages.slice(start);
  return current.flatMap((message) =>
    message.role !== "assistant"
      ? []
      : (message.toolCalls || []).map((call) => {
          const result = current.find(
            (item) => item.role === "tool" && item.toolCallId === call.id,
          );
          const name = call.function.name;
          const label =
            name === "ask_choice"
              ? "Choose an option"
              : name.startsWith("show_")
                ? "Preparing the response"
                : /search|discover|list/.test(name)
                  ? "Finding sources"
                  : /read|get|fetch|scrape|extract/.test(name)
                    ? "Reading evidence"
                    : "Working on your request";
          return {
            id: call.id,
            label,
            waiting: name === "ask_choice" && !result,
            complete: !!result,
            failed: result?.role === "tool" && toolFailed(result.content),
          };
        }),
  );
}
