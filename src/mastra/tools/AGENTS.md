# Purpose

- Owns reusable Mastra tool adapter definitions under `src/mastra/tools/`.

# Ownership

- Owns every file in this folder, including `facebook-marketplace-tools.ts`, `okf-tools.ts`, and `windmill-tools.ts`.

# Local Contracts

- Tool definitions here are adapter surfaces, not the home for core orchestration or provider-specific infrastructure.
- Tool exports should stay stable enough for agents in `../agents/` and registration in `../index.ts`.
- Provider-specific transport belongs in `../infrastructure/`; orchestration belongs in `../application/`.
- `okf-tools.ts` is the tool surface for the OKF knowledge flow. It should expose explicit bundle-listing, bundle-search, and bundle-file retrieval actions backed by the OKF knowledge service rather than direct MinIO or Windmill calls.

# Work Guidance

- Keep tool schemas and descriptions explicit, then delegate execution to the smallest relevant application service.
- When a tool gains side effects, auth requirements, or new runtime dependencies, document that change here and in the closer infrastructure or application doc if needed.

# Verification

- Run `npm run build` from the repository root when tool exports, imports, or wiring change.

# Child DOX Index

- No child DOX docs yet.
