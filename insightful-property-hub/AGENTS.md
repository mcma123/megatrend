# Purpose

- Owns the `insightful-property-hub/` application subtree, which is the main TanStack Start frontend launched by the root `npm run dev:web` workflow.

# Ownership

- Owns every file and folder under `insightful-property-hub/`.
- Source code conventions live in the closer child doc at `src/AGENTS.md`.

# Local Contracts

- This app is connected to Lovable. Do not rewrite published git history in ways that would break Lovable sync on pushed branches.
- Generated or environment-specific outputs such as `.output/`, `.tanstack/`, `.wrangler/`, and `node_modules/` are part of the subtree but should usually be treated as build artifacts rather than hand-edited source.

# Work Guidance

- Keep app-level tooling, config, and generated-artifact expectations documented here.
- Route, component, and source-level rules belong in the closer docs under `src/`.

# Verification

- Run `npm run build --prefix insightful-property-hub` when app-level source or config changes.
- Run `npm run lint --prefix insightful-property-hub` when linted source changes.

# Child DOX Index

- `src/` -> `insightful-property-hub/src/AGENTS.md`: Application source, shared components, route files, hooks, and local utilities.
- `public/` and top-level config files remain owned by this doc.
