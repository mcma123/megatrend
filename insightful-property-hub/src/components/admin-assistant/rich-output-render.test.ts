// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// These checks exercise the actual presentation components without a chat server.
vi.mock("@copilotkit/react-core/v2/headless", () => ({
  useComponent: vi.fn(),
  useFrontendTool: vi.fn(),
  useRenderTool: vi.fn(),
  useHumanInTheLoop: vi.fn(),
}));
import { AssistantMarkdown, ComparisonCard, DraftCard, SummaryCard } from "./rich-output";

describe("designed assistant responses", () => {
  it("shows a readable incomplete state after interrupted or malformed presentation arguments", () => {
    const html = renderToStaticMarkup(
      createElement(SummaryCard, { title: "Incomplete" } as Parameters<typeof SummaryCard>[0]),
    );
    expect(html).toContain("This response is incomplete");
    expect(html).not.toContain("Preparing the response");
  });
  it("renders grounded summary facts and evidence links", () => {
    const html = renderToStaticMarkup(
      createElement(SummaryCard, {
        title: "Lease findings",
        summary: "A **verified** summary.",
        facts: [{ label: "Expiry", value: "Unknown" }],
        sources: [
          { title: "Lease evidence", url: "https://example.com/lease", reference: null },
        ] as unknown as Parameters<typeof SummaryCard>[0]["sources"],
      }),
    );
    expect(html).toContain("Lease findings");
    expect(html).toContain("<strong>verified</strong>");
    expect(html).toContain("Unknown");
    expect(html).toContain('href="https://example.com/lease"');
    expect(html).toContain("Explore the findings");
  });
  it("shows missing comparison cells as unknown and supplies sortable headings", () => {
    const html = renderToStaticMarkup(
      createElement(ComparisonCard, {
        title: "Office comparison",
        columns: ["Size", "Rental"],
        rows: [{ label: "Office A", values: ["400 m²"], source: "https://example.com/a" }],
      }),
    );
    expect(html).toContain("Unknown");
    expect(html).toContain('aria-sort="none"');
    expect(html).toContain("400 m²");
  });
  it("renders drafts as copyable content without publication controls", () => {
    const html = renderToStaticMarkup(
      createElement(DraftCard, { title: "Desk", body: "Solid wood", price: "$100" }),
    );
    expect(html).toContain("Copy");
    expect(html).toContain("Refine draft");
    expect(html).not.toContain("Publish");
  });
  it("escapes HTML and rejects executable links and remote Markdown images", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantMarkdown, {
        children:
          "<script>alert(1)</script>\n\n[unsafe](javascript:alert)\n\n![tracking](https://example.com/tracker.png)\n\n[safe](https://example.com)",
      }),
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://example.com/"');
  });
});
