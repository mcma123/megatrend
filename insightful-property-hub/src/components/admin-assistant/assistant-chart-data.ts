import { z } from "zod";
import type { Message } from "@ag-ui/core";
import { parseResult, record } from "./rich-output-data";

export const chartTypes = ["bar", "line", "area", "pie", "donut", "scatter", "heatmap"] as const;
export type ChartType = (typeof chartTypes)[number];
export const chartSchema = z.object({
  title: z.string().max(240),
  type: z
    .enum(chartTypes)
    .nullish()
    .transform((value) => value ?? undefined)
    .describe("Choose the chart appropriate to the data; defaults to bar for older responses."),
  unit: z.string().max(80),
  xLabel: z
    .string()
    .max(80)
    .nullish()
    .transform((value) => value ?? undefined)
    .describe("Scatter x-axis label including unit."),
  points: z
    .array(
      z.object({
        label: z.string().min(1).max(120).describe("Category, ordered time label, or heatmap row."),
        value: z
          .number()
          .finite()
          .describe("Retrieved numeric value; also the scatter y coordinate."),
        source: z.string().min(1).max(2000),
        group: z
          .string()
          .min(1)
          .max(120)
          .nullish()
          .transform((value) => value ?? undefined)
          .describe("Required for heatmaps: column category. One point per row/column pair."),
        x: z
          .number()
          .finite()
          .nullish()
          .transform((value) => value ?? undefined)
          .describe("Required for scatter: retrieved numeric x coordinate."),
      }),
    )
    .min(1)
    .max(144),
});
export type ChartData = z.infer<typeof chartSchema>;
/** Keep invalid chart geometry out of Recharts and never fill gaps with zero. */
export function chartProblem(data: ChartData, type: ChartType): string | null {
  if (type !== "heatmap" && data.points.length > 24) return "Use at most 24 points for this chart.";
  if (type === "pie" || type === "donut") {
    const total = data.points.reduce((sum, point) => sum + point.value, 0);
    if (data.points.some((point) => point.value < 0) || !Number.isFinite(total) || total <= 0)
      return "Pie and donut charts need non-negative values with a positive total. Choose a bar or line chart for this data.";
  }
  if (type === "scatter" && data.points.some((point) => point.x === undefined))
    return "A scatter plot needs a numeric x value for every point. Ask the assistant to retrieve both measures.";
  if (type === "heatmap") {
    if (data.points.some((point) => !point.group))
      return "A heatmap needs a row and column for every value. Ask the assistant for grouped data.";
    const cells = data.points.map((point) => JSON.stringify([point.label, point.group]));
    if (new Set(cells).size !== cells.length)
      return "This heatmap contains duplicate row/column values. Ask the assistant to clarify the grouping.";
    if (
      new Set(data.points.map((point) => point.label)).size > 12 ||
      new Set(data.points.map((point) => point.group)).size > 12
    )
      return "Use at most 12 rows and 12 columns in a heatmap.";
  }
  return null;
}

export function validateChartArguments(args: unknown, checkGeometry = true) {
  const parsed = chartSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((issue) => ({
      field: issue.path.join("."),
      code: issue.code,
      expected: "expected" in issue ? issue.expected : undefined,
    }));
    const message = issues.some((issue) => issue.field.endsWith(".source"))
      ? "Source references are missing for some chart values."
      : issues.some((issue) => issue.field.endsWith(".value"))
        ? "Some chart values are missing or are not numeric."
        : issues.some((issue) => issue.field === "points")
          ? "The chart needs a supported number of sourced numeric values."
          : "The chart data is not in the expected format.";
    return { success: false as const, message, issues };
  }
  const message = checkGeometry ? chartProblem(parsed.data, parsed.data.type || "bar") : null;
  if (message)
    return {
      success: false as const,
      message,
      issues: [{ field: "points", code: "invalid_chart_data", expected: undefined }],
    };
  return { success: true as const, data: parsed.data };
}

function chartKey(args: unknown) {
  const data = record(args);
  return JSON.stringify([data.type || "bar", data.title || ""]);
}
function currentTurn(messages: Message[]) {
  let start = 0;
  messages.forEach((message, index) => {
    if (message.role === "user") start = index + 1;
  });
  return messages.slice(start);
}

/** Feedback returns to the model, so rejected calls can be repaired without a user retry. */
export function chartToolFeedback(args: unknown, messages: Message[] = []) {
  const parsed = validateChartArguments(args);
  if (parsed.success) return { status: "rendered" as const, chartType: parsed.data.type || "bar" };
  const turn = currentTurn(messages);
  const matching = new Set(
    turn.flatMap((message) =>
      message.role === "assistant"
        ? (message.toolCalls || [])
            .filter(
              (call) =>
                call.function.name === "show_chart" &&
                chartKey(parseResult(call.function.arguments)) === chartKey(args),
            )
            .map((call) => call.id)
        : [],
    ),
  );
  const priorFailures = turn.filter(
    (message) =>
      message.role === "tool" &&
      matching.has(message.toolCallId) &&
      ["invalid_chart", "unavailable"].includes(
        String(record(parseResult(message.content)).status),
      ),
  ).length;
  return {
    status: priorFailures ? ("unavailable" as const) : ("invalid_chart" as const),
    retryAllowed: !priorFailures,
    message: parsed.message,
    issues: parsed.issues,
    instruction: priorFailures
      ? "Do not retry this chart again this turn. Explain which sourced numeric facts are unavailable; do not claim a chart was displayed."
      : "Correct these fields and call show_chart once more, preserving title and type. Use only numeric values and exact source URLs/document references already supplied or retrieved. Never replace missing values with zero or invent sources. If data is unavailable, explain that instead of calling again.",
    requiredShape: {
      title: "string",
      type: "bar|line|area|pie|donut|scatter|heatmap",
      unit: "string",
      points:
        "array of {label:string,value:finite number,source:exact URL or document reference}; scatter adds x, heatmap adds group",
    },
  };
}

/** Keep only the latest outcome per chart in this turn; a successful repair clears its notice. */
export function chartFailures(messages: Message[]) {
  const turn = currentTurn(messages);
  const results = new Map(
    turn.flatMap((message) =>
      message.role === "tool" ? [[message.toolCallId, message.content] as const] : [],
    ),
  );
  const latest = new Map<string, string>();
  for (const message of turn) {
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls || []) {
      if (call.function.name !== "show_chart" || !results.has(call.id)) continue;
      const args = parseResult(call.function.arguments);
      const parsed = validateChartArguments(args);
      if (parsed.success) latest.delete(chartKey(args));
      else latest.set(chartKey(args), parsed.message);
    }
  }
  return [...new Set(latest.values())];
}
