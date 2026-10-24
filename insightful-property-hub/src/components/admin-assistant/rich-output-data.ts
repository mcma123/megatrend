/** Provider payloads are untrusted. Only project known fields into presentation data. */
export type ResultCard = {
  title: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  label?: string;
  evidence?: string;
  reference?: string;
};

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function text(value: unknown, limit = 4000): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseResult(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return { content: value };
  }
}

export function resultError(value: unknown): boolean {
  const item = record(parseResult(value));
  return (
    item.success === false || item.ok === false || item.isError === true || Boolean(item.error)
  );
}

function items(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const item = record(value);
  for (const key of [
    "results",
    "matches",
    "bundles",
    "documents",
    "listings",
    "items",
    "web",
    "edges",
  ]) {
    if (Array.isArray(item[key])) return item[key] as unknown[];
  }
  if (item.data) return items(item.data);
  return ["title", "name", "content", "markdown", "object_key", "bundle_root", "listing"].some(
    (key) => item[key] != null,
  )
    ? [item]
    : [];
}

export function normalizeResultCards(toolName: string, value: unknown): ResultCard[] {
  const parsed = parseResult(value);
  if (resultError(parsed)) return [];
  return items(parsed)
    .filter((entry) => Object.keys(record(entry)).length > 0)
    .slice(0, 24)
    .map((entry) => {
      const outer = record(entry);
      const item = record(outer.node ?? entry);
      const listing = record(item.listing ?? item);
      const image = record(listing.primary_listing_photo ?? listing.image);
      const price = record(listing.listing_price ?? listing.price);
      const reference = text(
        listing.object_key ?? listing.key ?? listing.bundle_root ?? listing.root,
        500,
      );
      return {
        title:
          text(
            listing.title ??
              listing.marketplace_listing_title ??
              listing.name ??
              record(listing.metadata).title,
            240,
          ) ||
          reference ||
          "Result",
        description: text(
          listing.description ??
            listing.snippet ??
            listing.excerpt ??
            listing.markdown ??
            listing.content,
          1000,
        ),
        url: safeUrl(
          listing.url ??
            listing.sourceUrl ??
            listing.pageUrl ??
            listing.link ??
            record(listing.metadata).sourceURL,
        ),
        imageUrl: safeUrl(
          listing.imageUrl ??
            listing.thumbnailUrl ??
            listing.image_url ??
            (typeof image.image === "string" ? image.image : record(image.image).uri) ??
            image.uri,
        ),
        label: text(
          price.formatted_amount ??
            (typeof listing.price === "string" ? listing.price : listing.location),
          160,
        ),
        evidence: toolName.startsWith("okf_")
          ? text(listing.content ?? listing.snippet, 12000)
          : undefined,
        reference: reference || undefined,
      };
    });
}

export const presentationNames = [
  "show_summary",
  "show_comparison",
  "show_chart",
  "show_listing_draft",
] as const;

export function isRichTool(name: string): boolean {
  return (
    name.startsWith("windmill_") ||
    name.startsWith("okf_") ||
    name.startsWith("facebook_marketplace_") ||
    presentationNames.some((item) => item === name)
  );
}
