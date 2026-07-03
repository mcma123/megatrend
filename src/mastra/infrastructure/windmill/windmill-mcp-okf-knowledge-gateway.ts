import type { OkfBundleFetchInput, OkfDocumentFetchInput, OkfKnowledgeGateway, OkfSearchInput } from "../../ports/okf-knowledge-gateway";
import { getRemoteTool, parseMcpToolResult } from "./windmill-mcp-client";

const remoteToolIds = {
  readOkfBucket: "s-f_docling_read__okf__bucket",
} as const;

class WindmillMcpOkfKnowledgeGateway implements OkfKnowledgeGateway {
  async listBundles() {
    const remoteTool = await getRemoteTool(remoteToolIds.readOkfBucket);
    const result = await remoteTool.execute({ list_only: true });
    return parseMcpToolResult(result);
  }

  async search(input: OkfSearchInput) {
    const remoteTool = await getRemoteTool(remoteToolIds.readOkfBucket);
    const result = await remoteTool.execute({
      query: input.query,
      bundle_root: input.bundleRoot,
      include_metadata: input.includeMetadata,
      include_full_content: input.includeFullContent,
      max_results: input.maxResults,
      max_objects_to_scan: input.maxObjectsToScan,
    });
    return parseMcpToolResult(result);
  }

  async getBundle(input: OkfBundleFetchInput) {
    const remoteTool = await getRemoteTool(remoteToolIds.readOkfBucket);
    const result = await remoteTool.execute({
      bundle_root: input.bundleRoot,
      include_metadata: input.includeMetadata,
      include_full_content: input.includeFullContent,
    });
    return parseMcpToolResult(result);
  }

  async getDocument(input: OkfDocumentFetchInput) {
    const remoteTool = await getRemoteTool(remoteToolIds.readOkfBucket);
    const result = await remoteTool.execute({
      object_key: input.objectKey,
      include_full_content: input.includeFullContent,
    });
    return parseMcpToolResult(result);
  }
}

export const windmillMcpOkfKnowledgeGateway = new WindmillMcpOkfKnowledgeGateway();
