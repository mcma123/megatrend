// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@copilotkit/react-core/v2/headless", () => ({
  useComponent: vi.fn(),
  useRenderTool: vi.fn(),
  useHumanInTheLoop: vi.fn(),
}));
import { EvidenceContent, GuidedSearchCard, ShortlistTray } from "./assistant-interactions";
import { ChoiceCard, MapCard, ResearchProgress, ScenarioCalculator } from "./advanced-interactions";
import { DraftCard, ResultCards, RichOutputRegistry } from "./rich-output";
import { RichOutputContext } from "./assistant-runtime-context";
import { ShortlistContext } from "./interaction-context";
import {
  highlightedParts,
  searchPrompt,
  shortlistPrompt,
  toggleShortlist,
} from "./interaction-data";
import {
  calculateScenario,
  mapEmbedUrl,
  mapSchema,
  researchSteps,
} from "./advanced-interaction-data";
import type { Message } from "@ag-ui/core";
import type { ResultCard } from "./rich-output-data";
import { useComponent, useHumanInTheLoop } from "@copilotkit/react-core/v2/headless";

const a: ResultCard = {
  title: "Office A",
  url: "https://example.com/a",
  description: "Available office",
  label: "ZAR 1000",
};
const b: ResultCard = {
  title: "Lease B",
  reference: "tenant/lease.md",
  evidence: "Expiry <script>bad()</script> in June",
  page: 2,
};
const render = (
  element: ReturnType<typeof createElement>,
  agentId = "web-research-agent",
  busy = false,
) =>
  renderToStaticMarkup(
    createElement(
      RichOutputContext.Provider,
      { value: { agentId, busy, followUp: vi.fn(), showReasoning: false } },
      element,
    ),
  );
const messages: Message[] = [
  { id: "u", role: "user", content: "Find offices" },
  {
    id: "a",
    role: "assistant",
    toolCalls: [
      { id: "search", type: "function", function: { name: "windmill_search", arguments: "{}" } },
      { id: "choose", type: "function", function: { name: "ask_choice", arguments: "{}" } },
    ],
  },
  { id: "r", role: "tool", toolCallId: "search", content: '{"results":[]}' },
];

describe("interactive assistant responses", () => {
  it("builds search criteria with real zero budgets and validates ranges", () => {
    expect(
      searchPrompt("web-research-agent", {
        query: "Offices",
        minimum: "0",
        maximum: "2000",
        currency: "ZAR",
      }),
    ).toContain('"minimumBudget": "0"');
    expect(() =>
      searchPrompt("web-research-agent", { query: "Offices", minimum: "20", maximum: "10" }),
    ).toThrow("Minimum budget");
    expect(() =>
      searchPrompt("web-research-agent", { query: "Offices", minimum: "Infinity" }),
    ).toThrow("valid");
    expect(() => searchPrompt("okf-agent", { query: " " })).toThrow("Enter");
  });
  it("uses document criteria without injecting property budgets", () => {
    const prompt = searchPrompt("okf-agent", {
      query: "Renewals",
      documentReference: "tenant/lease.md",
      maximum: "10",
    });
    expect(prompt).toContain("tenant/lease.md");
    expect(prompt).not.toContain("maximumBudget");
    const html = render(createElement(GuidedSearchCard, { title: "Document search" }), "okf-agent");
    expect(html).toContain("Document reference");
    expect(html).not.toContain("Min budget");
  });
  it("bounds shortlists, deduplicates by source and supports removal", () => {
    const selected = toggleShortlist([], a);
    expect(toggleShortlist(selected, { ...a, title: "Same URL" })).toEqual([]);
    expect(toggleShortlist([], { title: "No source" })).toEqual([]);
    const full = Array.from({ length: 8 }, (_, i) => ({ title: String(i), reference: `doc/${i}` }));
    expect(toggleShortlist(full, a)).toHaveLength(8);
    expect(() => shortlistPrompt([a], true)).toThrow("two");
    expect(shortlistPrompt([a, b], true)).toContain("tenant/lease.md");
    expect(shortlistPrompt([a, b], true)).toContain("Unknown");
  });
  it("isolates shortlist trays by agent and retains source-linked selection controls", () => {
    const value = { selections: { "web-research-agent": [a, b] }, toggle: vi.fn(), clear: vi.fn() };
    const tray = createElement(ShortlistContext.Provider, { value }, createElement(ShortlistTray));
    expect(render(tray)).toContain("Compare selected");
    expect(render(tray, "okf-agent")).toBe("");
    const cards = render(createElement(ResultCards, { cards: [a, b], toolName: "okf_search" }));
    expect(cards).toContain("Add to shortlist");
    expect(cards).toContain("View evidence");
  });
  it("shows actual evidence safely and highlights text without interpreting HTML or regex", () => {
    const html = render(createElement(EvidenceContent, { card: b }));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Page 2");
    expect(html).toContain("tenant/lease.md");
    expect(
      highlightedParts("A [cost] and [cost]", "[cost]").filter((part) => part.match),
    ).toHaveLength(2);
    expect(highlightedParts("x".repeat(1000), "x").filter((part) => part.match)).toHaveLength(100);
    expect(render(createElement(EvidenceContent, { card: { title: "Metadata" } }))).toContain(
      "metadata only",
    );
  });
  it("shows source-backed map coordinates and rejects impossible geometry", () => {
    const data = {
      title: "Offices",
      priceUnit: "ZAR",
      locations: [
        { title: "Office A", latitude: -26.2, longitude: 28.04, source: a.url!, price: 1000 },
      ],
    };
    const html = render(createElement(MapCard, data));
    expect(html).toContain("openstreetmap.org/export/embed.html");
    expect(html).toContain("Maximum price ZAR");
    expect(html).toContain('href="https://example.com/a"');
    expect(
      mapSchema.safeParse({ ...data, locations: [{ ...data.locations[0], latitude: 91 }] }).success,
    ).toBe(false);
    expect(() => mapEmbedUrl(NaN, 28)).toThrow("coordinates");
  });
  it("calculates scenarios without treating blank values as zero or hiding negative yield", () => {
    expect(calculateScenario("1000000", "10000", "2000")).toMatchObject({
      grossYield: 12,
      netYield: 9.6,
      annualNet: 96000,
    });
    expect(calculateScenario("1000000", "100", "200")).toMatchObject({ netYield: -0.12 });
    expect(calculateScenario("1000000", "100", "")).toBeNull();
    expect(calculateScenario("0", "100", "0")).toBeNull();
    expect(calculateScenario("1e-308", "1000000", "0")).toBeNull();
    const html = render(
      createElement(ScenarioCalculator, {
        title: "Scenario",
        currency: "ZAR",
        purchasePrice: { value: 1000000, source: a.url! },
      }),
    );
    expect(html).toContain("Your assumption");
    expect(html).toContain("Enter all three values");
    expect(html).toContain("Source");
  });
  it("derives progress only from the latest turn's real tool calls and marks interruption", () => {
    expect(researchSteps(messages)).toMatchObject([
      { complete: true },
      { waiting: true, complete: false },
    ]);
    expect(render(createElement(ResearchProgress, { messages, busy: true }))).toContain(
      "Waiting for your choice",
    );
    expect(render(createElement(ResearchProgress, { messages, busy: false }))).toContain(
      "Interrupted",
    );
    expect(
      researchSteps([...messages, { id: "next", role: "user", content: "New question" }]),
    ).toEqual([]);
  });
  it("shows completed or stopped choices without active selection controls", () => {
    const args = {
      title: "Choose a document",
      question: "Which lease?",
      options: [
        { id: "a", label: "Lease A" },
        { id: "b", label: "Lease B" },
      ],
    };
    expect(
      render(createElement(ChoiceCard, { args, status: "complete", result: '{"choiceId":"b"}' })),
    ).toContain("Selected: Lease B");
    expect(
      render(createElement(ChoiceCard, { args, status: "executing", respond: vi.fn() })),
    ).toContain("This interaction has stopped");
    expect(
      render(createElement(ChoiceCard, { args, status: "complete", result: '{"cancelled":true}' })),
    ).toContain("Selection cancelled");
    expect(
      render(
        createElement(ChoiceCard, {
          args,
          status: "complete",
          result: "Error: Human-in-the-loop interaction aborted",
        }),
      ),
    ).toContain("This interaction was interrupted");
  });
  it("offers editable copy-only drafts and registers typed interactions for every agent", () => {
    const html = render(
      createElement(DraftCard, { title: "Desk", body: "Solid wood", price: "ZAR 100" }),
    );
    expect(html).toContain("Edit draft");
    expect(html).toContain("Tone");
    expect(html).not.toContain("Publish");
    vi.mocked(useComponent).mockClear();
    vi.mocked(useHumanInTheLoop).mockClear();
    for (const agentId of ["web-research-agent", "okf-agent", "facebook-marketplace-agent"])
      render(createElement(RichOutputRegistry, { agentId }));
    expect(
      vi.mocked(useComponent).mock.calls.filter(([config]) => config.name === "show_search_form"),
    ).toHaveLength(3);
    expect(
      vi.mocked(useComponent).mock.calls.filter(([config]) => config.name === "show_map"),
    ).toHaveLength(3);
    expect(vi.mocked(useHumanInTheLoop).mock.calls.map(([config]) => config.agentId)).toEqual([
      "web-research-agent",
      "okf-agent",
      "facebook-marketplace-agent",
    ]);
  });
});
