# Purpose

- Owns Mastra application-layer services that orchestrate approved actions through stable ports.

# Ownership

- Owns every file under `src/mastra/application/`.

# Local Contracts

- Application services coordinate work, but should not contain provider-specific transport details.
- Depend on interfaces from `../ports/`, not directly on CLI, MCP, or other concrete runtimes.
- Keep agent-facing actions explicit and named by use case or capability.
- `okf-knowledge/okf-knowledge-service.ts` is the orchestration layer for OKF bundle discovery and retrieval. It should stay responsible for shaping grounded agent-facing responses while delegating all Windmill and MinIO specifics to the OKF knowledge gateway.

# Work Guidance

- Put orchestration here when more than one adapter or boundary is involved.
- Keep these services small and testable so tools remain thin adapters.
- When document knowledge behavior changes, update the matching port and Windmill adapter together with the OKF service.

# Verification

- Run `npm run build` from the repository root when application services or their contracts change.

# Child DOX Index

- No child DOX docs yet.
