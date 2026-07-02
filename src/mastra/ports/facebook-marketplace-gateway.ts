export type MarketplaceHealthFailureLevel = "stale" | "error";

export type MarketplaceDraftInput = {
  notes: string;
  photoPaths: string[];
  targetPrice?: number;
};

export type MarketplaceDoctorInput = {
  failOn?: MarketplaceHealthFailureLevel;
};

export type MarketplaceGetListingInput = {
  listingId: string;
};

export type MarketplaceMatchesInput = {
  onlyNew: boolean;
};

export type MarketplaceSearchInput = {
  query: string;
  count: number;
  minPrice?: number;
  maxPrice?: number;
  radiusMiles?: number;
  condition?: string;
  daysListedWithin?: number;
  cursor?: string;
};

export type MarketplaceWatchAddInput = {
  name: string;
  query: string;
  minPrice?: number;
  maxPrice?: number;
  radiusMiles?: number;
  mustHaveKeywords: string[];
  rejectKeywords: string[];
};

export interface FacebookMarketplaceGateway {
  doctor(input: MarketplaceDoctorInput): Promise<unknown>;
  search(input: MarketplaceSearchInput): Promise<unknown>;
  getListing(input: MarketplaceGetListingInput): Promise<unknown>;
  draft(input: MarketplaceDraftInput): Promise<unknown>;
  addWatch(input: MarketplaceWatchAddInput): Promise<unknown>;
  getMatches(input: MarketplaceMatchesInput): Promise<unknown>;
}
