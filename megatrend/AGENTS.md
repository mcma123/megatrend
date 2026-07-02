# Purpose

- Owns the standalone `megatrend/` TanStack Start application subtree.

# Ownership

- Owns every file and folder under `megatrend/`.
- Source-level rules live in the closer child doc at `src/AGENTS.md`.

# Local Contracts

- This folder is a separate app from the repository-root Mastra workspace and from `insightful-property-hub/`.
- Generated outputs and dependencies such as `node_modules/` remain part of the subtree but are usually artifacts, not hand-authored source.

# Work Guidance

- Keep app-level config, dependency, and build expectations documented here.
- Put source conventions and route ownership in the closer docs under `src/`.

# Verification

- Run `npm run build --prefix megatrend` when app-level source or config changes.
- Run `npm run lint --prefix megatrend` when linted source changes.

# Child DOX Index

- `src/` -> `megatrend/src/AGENTS.md`: Source routing, shared router setup, and application styles.
- `public/` and top-level config files remain owned by this doc.
