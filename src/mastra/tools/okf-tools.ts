import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { OkfKnowledgeService } from "../application/okf-knowledge/okf-knowledge-service";
import { windmillMcpOkfKnowledgeGateway } from "../infrastructure/windmill/windmill-mcp-okf-knowledge-gateway";

const okfKnowledgeService = new OkfKnowledgeService(windmillMcpOkfKnowledgeGateway);

export const okfTools = {
  okf_list_bundles: createTool({
    id: "okf_list_bundles",
    description: "List available OKF bundles currently stored in the okfdata MinIO bucket.",
    inputSchema: z.object({}),
    outputSchema: z.any(),
    execute: async () => okfKnowledgeService.listBundles(),
  }),
  okf_search_documents: createTool({
    id: "okf_search_documents",
    description:
      "Search parsed OKF markdown documents in the okfdata bucket for relevant information before answering a user question.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Question or keyword query to search across OKF bundle documents."),
      bundleRoot: z.string().optional().describe("Optional bundle root to limit search to one document bundle."),
      includeMetadata: z.boolean().default(false).describe("Whether to search metadata markdown files too."),
      includeFullContent: z.boolean().default(false).describe("Whether to return the full markdown content for matches."),
      maxResults: z.number().int().min(1).max(10).default(5).describe("Maximum number of matches to return."),
      maxObjectsToScan: z.number().int().min(1).max(500).default(200).describe("Maximum markdown objects to scan."),
    }),
    outputSchema: z.any(),
    execute: async ({ query, bundleRoot, includeMetadata, includeFullContent, maxResults, maxObjectsToScan }) =>
      okfKnowledgeService.search({
        query,
        bundleRoot,
        includeMetadata,
        includeFullContent,
        maxResults,
        maxObjectsToScan,
      }),
  }),
  okf_get_bundle: createTool({
    id: "okf_get_bundle",
    description: "Fetch all markdown documents for a specific OKF bundle root from the okfdata bucket.",
    inputSchema: z.object({
      bundleRoot: z.string().min(1).describe("The OKF bundle root, for example 'MIE PAGE 1 FILLED'."),
      includeMetadata: z.boolean().default(false).describe("Whether to include metadata markdown files."),
      includeFullContent: z.boolean().default(true).describe("Whether to include full markdown content."),
    }),
    outputSchema: z.any(),
    execute: async ({ bundleRoot, includeMetadata, includeFullContent }) =>
      okfKnowledgeService.getBundle({ bundleRoot, includeMetadata, includeFullContent }),
  }),
  okf_get_document: createTool({
    id: "okf_get_document",
    description: "Fetch one exact markdown object from the OKF bucket by object key.",
    inputSchema: z.object({
      objectKey: z.string().min(1).describe("Exact object key such as 'MIE PAGE 1 FILLED/documents/MIE PAGE 1 FILLED.md'."),
      includeFullContent: z.boolean().default(true).describe("Whether to include full markdown content."),
    }),
    outputSchema: z.any(),
    execute: async ({ objectKey, includeFullContent }) =>
      okfKnowledgeService.getDocument({ objectKey, includeFullContent }),
  }),
};
