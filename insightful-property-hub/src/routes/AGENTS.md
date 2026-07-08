# Purpose

- Owns file-based route definitions for `insightful-property-hub`.

# Ownership

- Owns every route file in this folder plus the route-specific `README.md`.

# Local Contracts

- Follow the file-based routing rules documented in `README.md`.
- `__root.tsx` is the app shell and must continue to wrap descendant routes correctly.
- Do not hand-edit generated route-tree artifacts outside the route files that produce them.
- `api.chat.ts` is the server-side proxy that maps `requestContext.selectedAgent` from the assistant UI to the correct Mastra chat endpoint. Keep that routing table synchronized with the registered Mastra chat routes.

# Work Guidance

- Keep API routes, app-shell routes, portal routes, and document-detail routes understandable from filenames alone.
- Preserve TanStack Start naming conventions for dynamic, optional, and layout segments.

# Verification

- Run `npm run build --prefix insightful-property-hub` when route files change.
- Run `npm run lint --prefix insightful-property-hub` when route files change.

# Child DOX Index

- No child DOX docs yet.
