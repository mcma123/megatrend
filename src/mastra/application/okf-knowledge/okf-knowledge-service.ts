import type { OkfBundleFetchInput, OkfDocumentFetchInput, OkfKnowledgeGateway, OkfSearchInput } from "../../ports/okf-knowledge-gateway";

export class OkfKnowledgeService {
  constructor(private readonly gateway: OkfKnowledgeGateway) {}

  listBundles() {
    return this.gateway.listBundles();
  }

  search(input: OkfSearchInput) {
    return this.gateway.search(input);
  }

  getBundle(input: OkfBundleFetchInput) {
    return this.gateway.getBundle(input);
  }

  getDocument(input: OkfDocumentFetchInput) {
    return this.gateway.getDocument(input);
  }
}
