# Purpose

- Owns concrete Mastra infrastructure adapters for external runtimes such as CLI tools and MCP-backed integrations.

# Ownership

- Owns every file under `src/mastra/infrastructure/`.

# Local Contracts

- Infrastructure implements ports from `../ports/`.
- External provider details, environment variables, payload translations, and low-level parsing belong here.
- Do not move agent instructions or application orchestration into this layer.

# Work Guidance

- Keep provider-specific error handling and transport concerns local to the adapter.
- When an external integration changes shape, update the adapter here before widening upstream contracts.

# Verification

- Run `npm run build` from the repository root when infrastructure adapters change.

# Child DOX Index

- No child DOX docs yet.
