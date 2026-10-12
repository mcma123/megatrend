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
});
export type SourcingCandidate = z.infer<typeof candidateSchema>;
export const sourcingResultSchema = z.object({
  candidates: z.array(candidateSchema).max(12),
  warnings: z.array(z.string().trim().min(1).max(500)).max(6),
});

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
