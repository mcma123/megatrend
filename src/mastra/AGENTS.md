# Purpose

- Owns the root Mastra runtime subtree: server composition, agent registration, tool integration, and any files under `src/mastra/`.

# Ownership

- Owns `index.ts`, `application/`, `ports/`, `infrastructure/`, `agents/`, `tools/`, `routes/`, and `public/` inside this folder.
- Does not own frontend application code in `insightful-property-hub/` or `megatrend/`.

# Local Contracts

- Register runtime agents and MCP servers through `index.ts` so the exported Mastra instance remains the single composition root.
- Keep exported agent identifiers aligned with any route or SDK references that invoke them.
- Shared integrations belong behind stable ports and concrete infrastructure adapters.
- Mastra tools are adapter surfaces; use-case orchestration belongs in `application/`.
- Keep the chat route surface in `index.ts` synchronized with the registered agents. The current runtime exposes `/chat` for `web-research-agent`, `/chat/okf` for `okf-agent`, and `/chat/facebook-marketplace` for `facebook-marketplace-agent`.
- `routes/voice-assistant.ts` exposes `POST /voice/assist` for the web app's staff-only `/api/assistant`, authenticated with `MASTRA_VOICE_SERVICE_TOKEN`. It runs `voiceAssistantAgent`, whose tools only record client actions (navigate / fill_form / ask_user) and never persist anything.
- `routes/property-sourcing.ts` exposes `POST /sourcing/research` for Convex background sourcing. It requires `Authorization: Bearer <MASTRA_SOURCING_SERVICE_TOKEN>` and fails closed when unconfigured. It resolves the existing `webResearchAgent`; research remains Windmill-backed. The endpoint shares the brief/result contract in `convex/lib/sourcing.ts`, returns JSON candidates/warnings, and has a four-minute execution deadline.

# Work Guidance

- Prefer extending application services and ports before duplicating transport or provider logic in agent files or tool adapters.
- Keep routing and registration changes synchronized with the actual exported names in this subtree.
- If this folder gains durable HTTP route handlers or static assets, document their contracts here or in a closer child doc.

# Verification

- Run `npm run build:mastra` from the repository root when Mastra wiring, imports, or exported agent registrations change.
- Run `npm test` when `application/voice-assistant/` validation changes (`form-values.test.ts`).

# Child DOX Index

- `application/` -> `src/mastra/application/AGENTS.md`: Use-case services that orchestrate agent-facing actions through ports.
- `ports/` -> `src/mastra/ports/AGENTS.md`: Stable interfaces and request contracts that isolate the core from concrete providers.
- `infrastructure/` -> `src/mastra/infrastructure/AGENTS.md`: Concrete adapters for CLI, MCP, and other provider/runtime integrations.
- `agents/` -> `src/mastra/agents/AGENTS.md`: Agent definitions, prompts, model selection, and per-agent behavior contracts.
- `tools/` -> `src/mastra/tools/AGENTS.md`: Mastra tool adapters that expose approved actions while delegating work to application services.
- `routes/` -> `src/mastra/routes/AGENTS.md`: Custom sourcing HTTP endpoint, service authentication, and response contracts.
- `index.ts` and `public/` remain owned by this doc until they need more specific local contracts.
