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
- Keep frontend auth wiring centralized in source-local providers and hooks under `lib/`; route files should consume auth state rather than implement token mechanics inline.
- Auth is Convex Auth (email + password): `lib/convex-client.tsx` wraps the app in `ConvexAuthProvider`, and `lib/auth-session.tsx` exposes `useCyphersoftAuth()` (`login` redirects to `/sign-in`, `signInWithPassword`, `logout`). The `/sign-in` route (`routes/sign-in.tsx`) is the only sign-in UI and only accepts relative `returnTo` paths.
- `lib/public-config.ts` exposes only the public Convex URL through a server function. The root route loads it before rendering providers so SSR and hydration use the same URL. Resolve nonempty frontend server runtime `VITE_CONVEX_URL`, then `CONVEX_URL`, then the compiled Vite value; keep server API auth resolution aligned. Never serialize secrets or the whole environment.
- `routes/api.scanner.$action.ts` proxies scanner actions to Windmill `run_wait_result/p/f/docling/scanner/*` using the server-only `WINDMILL_SCANNER_*_URL` vars and `WINDMILL_SCANNER_BEARER_TOKEN` (a Windmill token scoped to those four scripts) from `.env.local`; never expose them to the client or use a broader token.
- Access gates: `routes/_app.tsx` `StaffGate` admits signed-in staff only (`profile.isStaff`), sending client users to their portal. `routes/portal.$clientSlug.tsx` resolves the client with `api.portal.getPortalContext` and provides it via `lib/portal-context.tsx` (`usePortal`/`usePortalClient`); portal pages must read the client from that context, not from route loaders or mock data.
- `routes/api.chat.ts` (staff only) and `routes/api.scanner.$action.ts` (portal members, `X-Cyphersoft-Portal` header) verify the caller's Convex Auth token (`Authorization: Bearer`, from `useAuthToken()`) through `lib/server-auth.ts` before proxying.
- Portfolio UI: shared create/edit dialogs live in `components/portfolio/` and labels/formatting/date math in `lib/portfolio.ts`; dates are computed from today, never a fixed date. Product routes read Convex; do not import `lib/mock-data.ts`.
- Documents UI: upload via `lib/use-document-upload.ts` (`useDocumentUpload` upload/replace, `useOpenDocument` opens a fresh signed URL) and `components/documents/` (`DocumentUploadDialog` single/bulk, `DocumentStatusBadge`, `DocumentList`); labels in `lib/documents.ts`. Clients see simplified statuses (`audience="client"`: Processing / Under review / Published / Failed) and never extracted fields; staff see the full pipeline on `/documents/$id`. The scanner's "Save to documents" uploads the generated PDF through the same flow (`source: "scanner"`).
- Review & curation UI: `/review` (urgency-ranked inbox), field decisions on `/documents/$id` (`components/documents/field-review-table.tsx`, `apply-to-records-card.tsx`), `/insights` curation console and `components/insights/insight-editor-dialog.tsx` (pass a state-held `initial` object; it resets when `initial` changes). AI drafts come from `routes/api.insights.draft.ts` (staff token required; reads approved facts from Convex as the caller, calls Mastra at `MASTRA_API_URL`, default derived from `MASTRA_CHAT_URL` or `http://localhost:4111`).
- Work items: staff `/tasks` board (drag between columns) and portal `/portal/$clientSlug/actions` share `components/actions/action-form-dialog.tsx` and `action-detail-dialog.tsx` (`audience` = staff | client; clients never see internal tasks/notes). Labels and due-date helpers live in `lib/workflow.ts`. Both headers render `components/notifications/notification-bell.tsx`.
- Overview pages (`/dashboard`, `/invoices`, `/reports`, `/search`) read only Convex. The header search box navigates to `/search?q=`; "Ask the documents" opens the assistant through `useAdminAssistant().openWithPrompt(agentId, text)` (the panel consumes `pendingPrompt` after restoring the saved agent).
- `/automations` and `/automations/$id` (`$id` = automation key) read `api.automations.*`; the staff lease timeline shows real renewal milestones (`api.automations.leaseMilestones`). Keep `RENEWAL_STEPS` in `lib/portfolio.ts` aligned with `convex/lib/automations.ts`.
- If a source subfolder gains its own durable workflow or operating rules, add a closer child AGENTS.md.
- Staff document details show persistent incomplete-coverage warnings and a reason field for `review.acknowledgeIncomplete`. Acknowledgement is tied to the current attempt and never changes extraction completeness; backend gates enforce it before finishing review or applying values. Source coverage warnings remain visible after approval.

# Verification

- Run `npm run build --prefix insightful-property-hub` when source changes affect routing, shared UI, or application wiring.
- Run `npm run lint --prefix insightful-property-hub` when linted source changes.

# Child DOX Index

- `routes/` -> `insightful-property-hub/src/routes/AGENTS.md`: File-based route conventions, route families, and generated route-tree constraints.
- `components/admin-assistant/` -> `insightful-property-hub/src/components/admin-assistant/AGENTS.md`: Assistant panel state, agent selection, sidebar/full-page behavior, and Mastra chat UI wiring.
- `components/document-scanner/` -> `insightful-property-hub/src/components/document-scanner/AGENTS.md`: Reusable client-portal scanner capture, edit, enhancement, page-management, and PDF export UI.
- `components/`, `hooks/`, and `lib/` remain owned by this doc until they need more specific local contracts.
