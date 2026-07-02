export type FirecrawlScrapeInput = {
  url: string;
  formats: string[];
  onlyMainContent: boolean;
};

export type SearchExecutionOptions = unknown;

export type SearchInput = {
  query: string;
};

export type SearxngSearchInput = {
  query: string;
  limit: number;
  categories: string;
  maxPages: number;
};

export interface WebResearchGateway {
  search(input: SearchInput, options?: SearchExecutionOptions): Promise<unknown>;
  scrape(input: FirecrawlScrapeInput, options?: SearchExecutionOptions): Promise<unknown>;
  searchAlternate(input: SearxngSearchInput, options?: SearchExecutionOptions): Promise<unknown>;
}
