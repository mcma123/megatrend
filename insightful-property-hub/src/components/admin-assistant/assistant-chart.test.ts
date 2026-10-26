// @vitest-environment node
import { cloneElement, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@ag-ui/core";

// Give the real Recharts primitives a viewport in server rendering.
vi.mock("recharts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement }) =>
    cloneElement(children as ReactElement<{ width: number; height: number }>, {
      width: 640,
      height: 256,
    }),
}));
import { ChartCard, ChartToolResult, ChartFailureNotice } from "./assistant-chart";
import {
  chartProblem,
  chartSchema,
  chartTypes,
  chartToolFeedback,
  chartFailures,
} from "./assistant-chart-data";

const points = [
  { label: "Jan", value: 10, x: 1, group: "Rent", source: "https://example.com/jan" },
  { label: "Feb", value: 20, x: 2, group: "Rent", source: "document:lease/page-2" },
];
const data = { title: "Portfolio findings", unit: "ZAR", points };
const render = (props: Parameters<typeof ChartCard>[0]) =>
  renderToStaticMarkup(createElement(ChartCard, props));

describe("assistant charts", () => {
  it.each(["pie", "line", "donut"] as const)(
    "renders Mastra strict-mode %s arguments with null optional metadata",
    (type) => {
      const raw = {
        ...data,
        type,
        xLabel: null,
        points: points.map((point) => ({ ...point, group: null, x: null })),
      };
      const parsed = chartSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      const html = render(raw as unknown as Parameters<typeof ChartCard>[0]);
      expect(html).toContain("<svg");
      expect(html).not.toContain("incomplete");
      expect(html).toContain('href="https://example.com/jan"');
    },
  );
  it.each(chartTypes)("renders %s with original values, accessible labels and evidence", (type) => {
    const html = render({ ...data, type, xLabel: "Month index" });
    expect(html).toContain("Portfolio findings");
    expect(html).toContain('aria-label="Chart type"');
    expect(html).toContain("View values and sources");
    expect(html).toContain('href="https://example.com/jan"');
    expect(html).toContain("document:lease/page-2");
    expect(html).not.toContain("incomplete");
    if (type === "heatmap") expect(html).toContain("<table");
    else expect(html).toContain("<svg");
  });
  it("preserves old chart responses without a type", () => {
    const html = render(data);
    expect(html).toContain("Bar chart: Portfolio findings");
    expect(html).not.toContain("A heatmap needs");
  });
  it("keeps missing heatmap combinations unknown while showing actual zeros", () => {
    const html = render({
      ...data,
      type: "heatmap",
      points: [points[0], { ...points[1], group: "Costs", value: 0 }],
    });
    expect(html).toContain("Jan / Costs: Unknown");
    expect(html).toContain("Feb / Rent: Unknown");
    expect(html).toContain("Feb / Costs: 0 ZAR");
    expect(html).toContain("Heatmap scale: 0 to 10 ZAR");
  });
  it.each([
    [-1, 10],
    [0, 0],
    [Number.MAX_VALUE, Number.MAX_VALUE],
  ])("rejects invalid pie totals %j", (a, b) => {
    expect(
      chartProblem(
        {
          ...data,
          points: [
            { ...points[0], value: a },
            { ...points[1], value: b },
          ],
        },
        "pie",
      ),
    ).toContain("positive total");
  });
  it("offers compatible views and readable guidance when a requested chart lacks dimensions", () => {
    const plain = {
      ...data,
      points: points.map(({ label, value, source }) => ({ label, value, source })),
    };
    const html = render({ ...plain, type: "heatmap" });
    expect(html).toContain("A heatmap needs a row and column");
    expect(html).toContain('value="pie"');
    expect(html).not.toContain('value="scatter"');
    expect(chartProblem(plain, "scatter")).toContain("numeric x value");
  });
  it("rejects duplicate and oversized heatmaps instead of silently overwriting values", () => {
    expect(chartProblem({ ...data, points: [points[0], points[0]] }, "heatmap")).toContain(
      "duplicate",
    );
    expect(
      chartProblem(
        {
          ...data,
          points: Array.from({ length: 13 }, (_, i) => ({ ...points[0], label: String(i) })),
        },
        "heatmap",
      ),
    ).toContain("12 rows");
  });
  it("bounds geometry and rejects non-finite values or missing evidence", () => {
    expect(
      chartSchema.safeParse({ ...data, points: [{ ...points[0], value: Infinity }] }).success,
    ).toBe(false);
    expect(chartSchema.safeParse({ ...data, points: [{ ...points[0], source: "" }] }).success).toBe(
      false,
    );
    expect(chartSchema.safeParse({ ...data, points: Array(145).fill(points[0]) }).success).toBe(
      false,
    );
    expect(chartProblem({ ...data, points: Array(25).fill(points[0]) }, "bar")).toContain(
      "24 points",
    );
    expect(
      chartSchema.safeParse({ ...data, points: [{ ...points[0], value: null }] }).success,
    ).toBe(false);
    expect(
      chartSchema.safeParse({ ...data, points: [{ ...points[0], source: null }] }).success,
    ).toBe(false);
    expect(
      chartToolFeedback({ ...data, type: "scatter", points: [{ ...points[0], x: null }] }).status,
    ).toBe("invalid_chart");
    expect(
      chartToolFeedback({ ...data, type: "heatmap", points: [{ ...points[0], group: null }] })
        .status,
    ).toBe("invalid_chart");
  });
  it("returns actionable validation feedback and limits automatic repair to one attempt", () => {
    const invalid = { ...data, type: "pie", points: [{ ...points[0], source: null }] };
    const first = chartToolFeedback(invalid);
    expect(first).toMatchObject({ status: "invalid_chart", retryAllowed: true });
    const messages: Message[] = [
      { id: "user", role: "user", content: "Chart these facts" },
      {
        id: "assistant",
        role: "assistant",
        toolCalls: [
          {
            id: "bad",
            type: "function",
            function: { name: "show_chart", arguments: JSON.stringify(invalid) },
          },
        ],
      },
      { id: "result", role: "tool", toolCallId: "bad", content: JSON.stringify(first) },
    ];
    expect(chartToolFeedback(invalid, messages)).toMatchObject({
      status: "unavailable",
      retryAllowed: false,
    });
    expect(chartToolFeedback({ ...data, type: "pie" }, messages)).toMatchObject({
      status: "rendered",
    });
  });
  it("shows one failure notice and clears it once the same chart is repaired", () => {
    const invalid = { ...data, type: "pie", points: [] };
    const messages: Message[] = [{ id: "u", role: "user", content: "Chart these facts" }];
    for (const id of ["bad1", "bad2"])
      messages.push(
        {
          id,
          role: "assistant",
          toolCalls: [
            {
              id,
              type: "function",
              function: { name: "show_chart", arguments: JSON.stringify(invalid) },
            },
          ],
        },
        {
          id: id + "result",
          role: "tool",
          toolCallId: id,
          content: JSON.stringify(chartToolFeedback(invalid)),
        },
      );
    expect(
      renderToStaticMarkup(createElement(ChartToolResult, { args: invalid, status: "complete" })),
    ).toBe("");
    expect(chartFailures(messages)).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(ChartFailureNotice, { messages, busy: false }));
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).not.toContain("Ask the assistant to try again");
    messages.push(
      {
        id: "repair",
        role: "assistant",
        toolCalls: [
          {
            id: "good",
            type: "function",
            function: { name: "show_chart", arguments: JSON.stringify({ ...data, type: "pie" }) },
          },
        ],
      },
      { id: "goodresult", role: "tool", toolCallId: "good", content: '{"status":"rendered"}' },
    );
    expect(chartFailures(messages)).toEqual([]);
    expect(renderToStaticMarkup(createElement(ChartFailureNotice, { messages, busy: false }))).toBe(
      "",
    );
  });
  it("preserves evidence text without making unsafe URLs clickable", () => {
    const html = render({
      ...data,
      type: "donut",
      points: [{ ...points[0], source: "javascript:alert(1)" }],
    });
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("javascript:alert(1)");
  });
});
