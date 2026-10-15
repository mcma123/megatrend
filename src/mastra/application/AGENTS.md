# Purpose

- Owns Mastra application-layer services that orchestrate approved actions through stable ports.

# Ownership

- Owns every file under `src/mastra/application/`.

# Local Contracts

- Application services coordinate work, but should not contain provider-specific transport details.
- `web-research/property-sourcing-service.ts` invokes the supplied Web Research Agent for live discovery and then validated structuring. Candidates must match the selected type and cite a successfully scraped page with readable content; Logistics allows warehouses/distribution facilities with explicit use evidence. Keep the shared contract in `convex/lib/sourcing.ts` synchronized with the endpoint and Convex processor. Search-tool failure is an error; partial research is surfaced as warnings.
- Depend on interfaces from `../ports/`, not directly on CLI, MCP, or other concrete runtimes.
- Keep agent-facing actions explicit and named by use case or capability.
- `okf-knowledge/okf-knowledge-service.ts` is the orchestration layer for OKF bundle discovery and retrieval. It should stay responsible for shaping grounded agent-facing responses while delegating all Windmill and MinIO specifics to the OKF knowledge gateway.

- `voice-assistant/` runs one assistant turn (`voice-assistant-service.ts`) with a `VoiceSession` that holds the request's forms, commands and records and collects actions (ordered navigate → fill → view commands → confirmations → questions). `form-values.ts` validates values and command params (field exists, type, number min/max, select option by value/label/unique partial label, YYYY-MM-DD dates). Navigation is limited to `VOICE_MODULES` routes and record detail routes for ids present in `records`; a catalog command for another page is accepted only after this turn navigates to that page. Both files are unit-tested.

# Work Guidance

- Put orchestration here when more than one adapter or boundary is involved.
- Keep these services small and testable so tools remain thin adapters.
- When document knowledge behavior changes, update the matching port and Windmill adapter together with the OKF service.

# Verification

- Run `npm run build:mastra` from the repository root when application services or their contracts change.

# Child DOX Index

- No child DOX docs yet.
