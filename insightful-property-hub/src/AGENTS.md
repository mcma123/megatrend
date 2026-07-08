# Purpose

- Owns the application source for `insightful-property-hub`, including routing, shared UI, hooks, and local utilities.

# Ownership

- Owns `components/`, `hooks/`, `lib/`, `routes/`, and source entry files in this folder.

# Local Contracts

- TanStack Start uses file-based routing here.
- `routeTree.gen.ts` is generated; do not hand-edit it.
- Shared UI primitives belong in `components/ui/`; domain-specific assistant UI belongs in `components/admin-assistant/`.

# Work Guidance

- Keep route conventions and route ownership in the closer `routes/AGENTS.md` doc.
- Prefer `lib/` for reusable source-local utilities and error helpers rather than embedding them in route files.
- Keep frontend auth wiring centralized in source-local providers and hooks under `lib/`; route files should consume auth state rather than implement token or PKCE mechanics inline.
- If a source subfolder gains its own durable workflow or operating rules, add a closer child AGENTS.md.

# Verification

- Run `npm run build --prefix insightful-property-hub` when source changes affect routing, shared UI, or application wiring.
- Run `npm run lint --prefix insightful-property-hub` when linted source changes.

# Child DOX Index

- `routes/` -> `insightful-property-hub/src/routes/AGENTS.md`: File-based route conventions, route families, and generated route-tree constraints.
- `components/admin-assistant/` -> `insightful-property-hub/src/components/admin-assistant/AGENTS.md`: Assistant panel state, agent selection, sidebar/full-page behavior, and Mastra chat UI wiring.
- `components/`, `hooks/`, and `lib/` remain owned by this doc until they need more specific local contracts.
