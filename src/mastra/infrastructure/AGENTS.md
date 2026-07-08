# Purpose

- Owns concrete Mastra infrastructure adapters for external runtimes such as CLI tools and MCP-backed integrations.

# Ownership

- Owns every file under `src/mastra/infrastructure/`.

# Local Contracts

- Infrastructure implements ports from `../ports/`.
- External provider details, environment variables, payload translations, and low-level parsing belong here.
- Do not move agent instructions or application orchestration into this layer.
- The Windmill-backed adapters in `windmill/` are the only place in this subtree that should know about Windmill MCP tool shapes, remote bucket names, or MinIO-backed OKF storage layouts.

# Work Guidance

- Keep provider-specific error handling and transport concerns local to the adapter.
- When an external integration changes shape, update the adapter here before widening upstream contracts.

# Verification

- Run `npm run build` from the repository root when infrastructure adapters change.

# Child DOX Index

- `windmill/` -> `src/mastra/infrastructure/windmill/AGENTS.md`: Windmill MCP adapters, shared client wiring, and OKF/web-research provider translations.
- `facebook-marketplace/` remains owned by this doc until it needs more specific local contracts.
