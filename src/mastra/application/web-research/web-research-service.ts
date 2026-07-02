import type {
  FirecrawlScrapeInput,
  SearchExecutionOptions,
  SearchInput,
  SearxngSearchInput,
  WebResearchGateway,
} from "../../ports/web-research-gateway";

export class WebResearchService {
  constructor(private readonly gateway: WebResearchGateway) {}

  search(input: SearchInput, options?: SearchExecutionOptions) {
    return this.gateway.search(input, options);
  }

  scrape(input: FirecrawlScrapeInput, options?: SearchExecutionOptions) {
    return this.gateway.scrape(input, options);
  }

  searchAlternate(input: SearxngSearchInput, options?: SearchExecutionOptions) {
    return this.gateway.searchAlternate(input, options);
  }
}
