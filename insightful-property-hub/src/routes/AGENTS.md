# Purpose

- Owns file-based route definitions for `insightful-property-hub`.

# Ownership

- Owns every route file in this folder plus the route-specific `README.md`.

# Local Contracts

- Follow the file-based routing rules documented in `README.md`.
- `__root.tsx` is the app shell and must continue to wrap descendant routes correctly.
- Do not hand-edit generated route-tree artifacts outside the route files that produce them.
- `api.chat.ts` is the server-side proxy that maps `requestContext.selectedAgent` from the assistant UI to the correct Mastra chat endpoint. Keep that routing table synchronized with the registered Mastra chat routes.
- `api.insights.draft.ts` is the staff-only proxy to the Mastra `insight-drafter-agent`; it must keep reading facts from Convex with the caller's token (never trust facts sent by the browser).
- `/sourcing` reads `api.sourcing.*` and real Convex clients. Generate saves a rental brief and starts background research; filter changes never relabel existing results. Saved packs display their submitted type, each candidate's actual type, source links, AI suitability assessment, and unverified requirements. Logistics includes warehouses/distribution facilities only with listing evidence of logistics use. History is tenant-scoped and staff-only; publication, shortlist and PDF controls remain absent until implemented.

# Work Guidance

- Keep API routes, app-shell routes, portal routes, and document-detail routes understandable from filenames alone.
- Preserve TanStack Start naming conventions for dynamic, optional, and layout segments.
- `/documents/$id` shows each processing stage, staff recovery controls, and reconciliation for held jobs. `/portal/$clientSlug/documents` shows safe stage guidance and search/coverage warnings even when extraction or publication succeeded. Consume the backend's `stageSummary`, `processingHeld`, and `canRetryProcessing`; do not expose staff errors or permit retries while remote work is unresolved.

# Verification

- Run `npm run build --prefix insightful-property-hub` when route files change.
- Run `npm run lint --prefix insightful-property-hub` when route files change.

# Child DOX Index

- No child DOX docs yet.
