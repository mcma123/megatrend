import { z } from "zod";

/** Shared by the Convex processor and Mastra endpoint; no provider dependencies. */
export const sourcingInputSchema = z.object({
  propertyType: z.enum(["office", "logistics", "warehouse", "retail"]),
  location: z.string().trim().min(1).max(200),
  sizeSqm: z.number().int().min(500).max(25000),
  notes: z.string().trim().max(2000),
});
export type SourcingInput = z.infer<typeof sourcingInputSchema>;

const knownNumber = z.number().finite().positive().nullable();
export const candidateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  propertyType: z.enum([
    "office",
    "logistics",
    "warehouse",
    "retail",
    "distribution",
    "industrial",
    "other",
  ]),
  sourceUrl: z.string().url().max(2000),
  location: z.string().trim().min(1).max(300),
  sizeSqm: knownNumber,
  rentalPerSqm: knownNumber,
  monthlyRental: knownNumber,
  features: z.array(z.string().trim().min(1).max(200)).max(12),
  typeEvidence: z.string().trim().min(1).max(1000),
  rentalEvidence: z.string().trim().min(1).max(1000),
  logisticsUseEvidence: z.string().trim().min(1).max(1000).nullable(),
  unverifiedRequirements: z.array(z.string().trim().min(1).max(300)).max(12),
  matchScore: z.number().int().min(0).max(100),
  matchExplanation: z.string().trim().min(1).max(1500),
  /** Photo published on the listing page itself; attached by code, never chosen by the LLM. */
  imageUrl: z.string().url().max(2000).nullable().optional(),
});
export type SourcingCandidate = z.infer<typeof candidateSchema>;
export const sourcingResultSchema = z.object({
  candidates: z.array(candidateSchema).max(12),
  warnings: z.array(z.string().trim().min(1).max(500)).max(6),
});
/**
 * What the structuring LLM pass may return: no image field (so it cannot invent photos) and
 * looser list/text limits, because one over-long list must not fail a whole search. Results are
 * trimmed to the stored limits with `clampStructuredResult`.
 */
const looseText = (max: number) => z.string().trim().min(1).max(max);
export const structuringResultSchema = z.object({
  candidates: z
    .array(
      candidateSchema.omit({ imageUrl: true }).extend({
        name: looseText(1000),
        location: looseText(1000),
        features: z.array(looseText(1000)).max(60),
        typeEvidence: looseText(5000),
        rentalEvidence: looseText(5000),
        logisticsUseEvidence: looseText(5000).nullable(),
        unverifiedRequirements: z.array(looseText(1000)).max(60),
        matchExplanation: looseText(6000),
      }),
    )
    .max(30),
  warnings: z.array(looseText(2000)).max(30),
});

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Trim a structuring result to the stored contract (`sourcingResultSchema`) limits. */
export function clampStructuredResult(result: z.infer<typeof structuringResultSchema>) {
  return {
    candidates: result.candidates.slice(0, 12).map((candidate) => ({
      ...candidate,
      name: clip(candidate.name, 200),
      location: clip(candidate.location, 300),
      features: candidate.features.slice(0, 12).map((feature) => clip(feature, 200)),
      typeEvidence: clip(candidate.typeEvidence, 1000),
      rentalEvidence: clip(candidate.rentalEvidence, 1000),
      logisticsUseEvidence:
        candidate.logisticsUseEvidence === null ? null : clip(candidate.logisticsUseEvidence, 1000),
      unverifiedRequirements: candidate.unverifiedRequirements
        .slice(0, 12)
        .map((item) => clip(item, 300)),
      matchExplanation: clip(candidate.matchExplanation, 1500),
    })),
    warnings: result.warnings.slice(0, 6).map((warning) => clip(warning, 500)),
  };
}

const NON_PHOTO = /(logo|icon|sprite|avatar|favicon|placeholder|spinner|loader|badge|banner-ad|pixel|tracking|blank|spacer)/i;

function safeImageUrl(raw: unknown, pageUrl: string): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim(), pageUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (/\.svg(\?|$)/i.test(url.pathname)) return null;
    const text = url.toString();
    return text.length <= 2000 ? text : null;
  } catch {
    return null;
  }
}

/**
 * The listing's own photo from a Firecrawl scrape: the page's og/twitter share image, else the
 * first content image in the markdown that doesn't look like a logo/icon. Null when none.
 */
export function listingImageFromScrape(result: unknown, pageUrl: string): string | null {
  if (!result || typeof result !== "object") return null;
  const page = result as { metadata?: unknown; markdown?: unknown };
  const metadata = (page.metadata && typeof page.metadata === "object" ? page.metadata : {}) as Record<
    string,
    unknown
  >;
  for (const key of ["ogImage", "og:image", "og:image:url", "twitter:image", "twitterImage"]) {
    const value = metadata[key];
    for (const candidate of Array.isArray(value) ? value : [value]) {
      const url = safeImageUrl(candidate, pageUrl);
      if (url && !NON_PHOTO.test(url)) return url;
    }
  }
  if (typeof page.markdown === "string") {
    for (const match of page.markdown.matchAll(/!\[([^\]]{0,300})\]\(\s*<?([^\s)>]+)>?/g)) {
      const [, alt, src] = match;
      if (NON_PHOTO.test(alt) || NON_PHOTO.test(src) || src.startsWith("data:")) continue;
      const url = safeImageUrl(src, pageUrl);
      if (url) return url;
    }
  }
  return null;
}

export function canonicalListingUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeCandidates(
  type: SourcingInput["propertyType"],
  candidates: SourcingCandidate[],
  sourceUrls?: ReadonlySet<string>,
): SourcingCandidate[] {
  const seen = new Set<string>();
  return [...candidates]
    .sort(
      (a, b) =>
        b.matchScore - a.matchScore || a.sourceUrl.localeCompare(b.sourceUrl),
    )
    .filter((candidate) => {
      const sameType = candidate.propertyType === type;
      const logisticsWarehouse =
        type === "logistics" &&
        ["warehouse", "distribution"].includes(candidate.propertyType) &&
        Boolean(candidate.logisticsUseEvidence?.trim());
      if (!sameType && !logisticsWarehouse) return false;
      const url = canonicalListingUrl(candidate.sourceUrl);
      if (!url || seen.has(url) || (sourceUrls && !sourceUrls.has(url)))
        return false;
      seen.add(url);
      return true;
    })
    .slice(0, 6);
}
