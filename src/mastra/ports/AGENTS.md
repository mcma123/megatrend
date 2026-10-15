# Purpose

- Owns stable Mastra-side ports and request contracts that isolate core orchestration from unstable providers.

# Ownership

- Owns every file under `src/mastra/ports/`.

# Local Contracts

- Ports define what the application layer needs from external systems.
- Keep contracts stable and implementation-agnostic.
- Avoid importing framework, MCP, or CLI-specific runtime types here unless no narrower contract exists.
- `okf-knowledge-gateway.ts` defines the application-facing contract for querying OKF bundles. Keep it centered on knowledge operations such as listing bundles, searching content, and fetching bundle files instead of leaking Windmill MCP or MinIO object-storage details.

- `voice-assistant.ts` is the `/voice/assist` request/response contract and `VoiceAction` union. The browser mirror is `insightful-property-hub/src/lib/voice/types.ts`; change both together.

# Work Guidance

- Prefer narrow capability-oriented interfaces over broad provider-shaped abstractions.
- When changing a port, audit the matching application and infrastructure adapters together.

# Verification

- Run `npm run build:mastra` from the repository root when port contracts change.

# Child DOX Index

- No child DOX docs yet.
