# Purpose

- Owns the application source for the standalone `megatrend` app.

# Ownership

- Owns `routes/`, `styles/`, `router.tsx`, `routeTree.gen.ts`, and other source entry files in this folder.

# Local Contracts

- TanStack Start uses file-based routing here.
- `routeTree.gen.ts` is generated; do not hand-edit it.
- `router.tsx` owns router creation and query-client integration for this app.

# Work Guidance

- Keep page routing in `routes/` and global styling in `styles/`.
- Preserve generated-file boundaries and keep router defaults understandable from this doc.

# Verification

- Run `npm run build --prefix megatrend` when source routing or app wiring changes.
- Run `npm run lint --prefix megatrend` when linted source changes.

# Child DOX Index

- No child DOX docs yet.
