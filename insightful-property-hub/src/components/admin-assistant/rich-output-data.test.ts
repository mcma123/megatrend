import { describe, expect, it } from "vitest";
import { normalizeResultCards, parseResult, resultError, safeUrl } from "./rich-output-data";

describe("rich response normalization", () => {
  it("allows source links and rejects executable or credential-bearing URLs", () => {
    expect(safeUrl("https://example.com/listing")).toBe("https://example.com/listing");
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "file:///secret",
      "https://user:secret@example.com",
      "/relative",
      null,
    ])
      expect(safeUrl(url)).toBeUndefined();
  });
  it("reads nested Firecrawl results without exposing arbitrary metadata", () => {
    expect(
      normalizeResultCards(
        "windmill_firecrawl_search",
        JSON.stringify({
          data: {
            web: [
              {
                title: "Office",
                url: "https://example.com",
                description: "Available",
                secret: "hidden",
              },
            ],
          },
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        title: "Office",
        url: "https://example.com/",
        description: "Available",
      }),
    ]);
    expect(
      JSON.stringify(
        normalizeResultCards("windmill_firecrawl_search", {
          results: [{ title: "Office", secret: "hidden" }],
        }),
      ),
    ).not.toContain("hidden");
  });
  it("keeps document evidence and its exact object reference", () => {
    expect(
      normalizeResultCards("okf_search_documents", {
        matches: [
          {
            title: "lease.md",
            key: "tenant/doc/documents/lease.md",
            snippet: "A lease",
            content: "Actual evidence",
          },
        ],
      })[0],
    ).toMatchObject({
      title: "lease.md",
      reference: "tenant/doc/documents/lease.md",
      evidence: "Actual evidence",
    });
  });
  it("reads listing cards and image galleries", () => {
    expect(
      normalizeResultCards("facebook_marketplace_search", {
        listings: [
          {
            marketplace_listing_title: "Desk",
            listing_price: { formatted_amount: "$100" },
            primary_listing_photo: { image: { uri: "https://example.com/photo.jpg" } },
          },
        ],
      })[0],
    ).toMatchObject({ title: "Desk", label: "$100", imageUrl: "https://example.com/photo.jpg" });
    expect(
      normalizeResultCards("windmill_searxng_image_search", {
        results: [
          {
            title: "Photo",
            imageUrl: "https://example.com/photo.jpg",
            pageUrl: "https://example.com/source",
          },
        ],
      })[0],
    ).toMatchObject({
      imageUrl: "https://example.com/photo.jpg",
      url: "https://example.com/source",
    });
  });
  it("handles empty, malformed, failed and unsafe output", () => {
    expect(normalizeResultCards("okf_search_documents", { matches: [] })).toEqual([]);
    expect(normalizeResultCards("tool", null)).toEqual([]);
    expect(parseResult("{bad json")).toEqual({ content: "{bad json" });
    expect(resultError('{"ok":false,"error":"private"}')).toBe(true);
    expect(normalizeResultCards("tool", { success: false, results: [{ title: "stale" }] })).toEqual(
      [],
    );
    expect(
      normalizeResultCards("tool", {
        results: [{ url: "javascript:alert(1)", imageUrl: "data:bad" }],
      })[0],
    ).toMatchObject({ url: undefined, imageUrl: undefined });
  });
});
