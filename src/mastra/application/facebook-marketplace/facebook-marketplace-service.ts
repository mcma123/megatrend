import type {
  FacebookMarketplaceGateway,
  MarketplaceDoctorInput,
  MarketplaceDraftInput,
  MarketplaceGetListingInput,
  MarketplaceMatchesInput,
  MarketplaceSearchInput,
  MarketplaceWatchAddInput,
} from "../../ports/facebook-marketplace-gateway";

export class FacebookMarketplaceService {
  constructor(private readonly gateway: FacebookMarketplaceGateway) {}

  doctor(input: MarketplaceDoctorInput) {
    return this.gateway.doctor(input);
  }

  search(input: MarketplaceSearchInput) {
    return this.gateway.search(input);
  }

  getListing(input: MarketplaceGetListingInput) {
    return this.gateway.getListing(input);
  }

  draft(input: MarketplaceDraftInput) {
    return this.gateway.draft(input);
  }

  addWatch(input: MarketplaceWatchAddInput) {
    return this.gateway.addWatch(input);
  }

  getMatches(input: MarketplaceMatchesInput) {
    return this.gateway.getMatches(input);
  }
}
