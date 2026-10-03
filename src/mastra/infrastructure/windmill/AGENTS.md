# Purpose

- Owns Windmill-backed Mastra infrastructure adapters under `src/mastra/infrastructure/windmill/`.

# Ownership

- Owns `windmill-mcp-client.ts`, `windmill-mcp-okf-knowledge-gateway.ts`, and `windmill-mcp-web-research-gateway.ts`.

# Local Contracts

- `windmill-mcp-client.ts` is the shared JSON-RPC transport for talking to the Windmill MCP surface.
- Gateway files in this folder implement application ports from `../../ports/` and translate between Mastra-side contracts and Windmill script/tool payloads.
- `windmill-mcp-okf-knowledge-gateway.ts` is the adapter that reaches the OKF knowledge script over Windmill and indirectly reads OKF bundles stored in MinIO-backed object storage. Keep bucket names, object key handling, and Windmill tool names local to this folder.
- Do not move agent prompts, bundle summarization policy, or UI-facing text into this layer.
- `WINDMILL_MCP_URL` (root `.env.local`) targets the `cyphersoft` workspace MCP endpoint and carries a token; never commit it.
- Remote tool IDs such as `S-f_firecrawl_searxng__s4af63e1cc69a80a9` are derived by Windmill from the script path, so they survive moving workspaces but change if a script is renamed or moved. A tool only resolves once its script is deployed to the workspace.

# Work Guidance

- Prefer extending the shared MCP client before duplicating request plumbing across gateway files.
- If Windmill resource names, script paths, or response envelopes change, update this folder before changing upstream ports or services.

# Verification

- Run `npm run build` from the repository root when Windmill adapters or their imports change.

# Child DOX Index

- No child DOX docs yet.
