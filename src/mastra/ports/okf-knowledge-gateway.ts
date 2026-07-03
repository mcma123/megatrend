export type OkfBundleFetchInput = {
  bundleRoot: string;
  includeMetadata: boolean;
  includeFullContent: boolean;
};

export type OkfDocumentFetchInput = {
  objectKey: string;
  includeFullContent: boolean;
};

export type OkfSearchInput = {
  query: string;
  bundleRoot?: string;
  includeMetadata: boolean;
  includeFullContent: boolean;
  maxResults: number;
  maxObjectsToScan: number;
};

export interface OkfKnowledgeGateway {
  listBundles(): Promise<unknown>;
  search(input: OkfSearchInput): Promise<unknown>;
  getBundle(input: OkfBundleFetchInput): Promise<unknown>;
  getDocument(input: OkfDocumentFetchInput): Promise<unknown>;
}
