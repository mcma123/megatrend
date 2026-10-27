# Purpose

- Owns file-based route definitions for `insightful-property-hub`.

# Ownership

- Owns every route file in this folder plus the route-specific `README.md`.

# Local Contracts

- Follow the file-based routing rules documented in `README.md`.
- `__root.tsx` is the app shell and must continue to wrap descendant routes correctly.
- Do not hand-edit generated route-tree artifacts outside the route files that produce them.
- Document filenames/source-file actions open `DocumentLink` or `useOpenDocument` in the shared overlay across staff and client modules. Keep explicit details/review navigation separate. Lease source-file buttons use `sourceDocumentId`; show "No document attached" for leases without one. Never substitute a raw storage URL or new-tab action for normal document viewing.
- `api.chat.ts` is the server-side proxy that maps `requestContext.selectedAgent` from the assistant UI to the correct Mastra chat endpoint. Keep that routing table synchronized with the registered Mastra chat routes.
- The active assistant uses `api.copilotkit.ts` with the v2 single-endpoint POST protocol. `lib/copilotkit-proxy.server.ts` verifies staff access and supplies server-derived identity plus `MASTRA_COPILOTKIT_SERVICE_TOKEN` to Mastra; browser credentials never reach upstream providers. Preserve SSE cancellation and no-buffer response headers. `api.chat.ts` remains a legacy-compatible route.
- `api.insights.draft.ts` is the staff-only proxy to the Mastra `insight-drafter-agent`; it must keep reading facts from Convex with the caller's token (never trust facts sent by the browser).
- `api.sourcing.research.ts` is the Convex-to-Mastra server bridge for property research using the existing Web Research Agent. Require the shared server-only `MASTRA_SOURCING_SERVICE_TOKEN` before forwarding to `/sourcing/research` on `MASTRA_API_URL` (or the local Mastra server). Keep credentials and upstream errors out of responses.
- `/sourcing` reads `api.sourcing.*` and real Convex clients. Generate saves a rental brief and starts background research; filter changes never relabel existing results. Saved packs display their submitted type, each candidate's listing photo (`imageUrl`, loaded with no referrer; a "No photo on the listing" placeholder when missing or blocked), actual type, source links, AI suitability assessment, and unverified requirements. Logistics includes warehouses/distribution facilities only with listing evidence of logistics use. History is tenant-scoped and staff-only; publication, shortlist and PDF controls remain absent until implemented.

- `api.transcribe.ts`: multipart audio to OpenRouter `/audio/transcriptions` (`OPENROUTER_TRANSCRIPTION_MODEL`). Staff, or client users of the portal in `X-Cyphersoft-Portal`; enforces `VOICE_MAX_AUDIO_BYTES` and `api.voice.consume` before calling OpenRouter. Never log audio or transcripts.
- `api.assistant.ts`: staff-only proxy to Mastra `POST /voice/assist` with server-only `MASTRA_VOICE_SERVICE_TOKEN`, after `api.voice.consume`. Body cap 512 KB (forms, commands and up to 300 records per type). Returns `{reply, actions}` for the browser to execute.
- `/properties`, `/leases`, `/tasks`, `/clients` (platform admins) and `/documents` (upload) accept `?new=1` (`lib/voice/new-form-search.ts`) to open their create dialog; the voice assistant navigates there. Closing the dialog clears the param; save handlers close before navigating. Render only one controlled dialog per page (empty states use a plain button that sets the param).

# Work Guidance

- `/agreements?demo=1` selects the separate staff-only, browser-memory client walkthrough before mounting live agreement hooks. Its optional `demo` search flag never reaches a signing backend endpoint or relaxes live authorization. The live `/agreements` page exposes **Start client demo** even when signing MFA/services are unconfigured.

- `/agreements` supports preparation/approval, gated issuance, delivery tracking, finalisation, reviewed portfolio application and company reports/exports. Only platform admins with recent signing MFA see mutation controls. External issuance requires both deployment/company release keys and all prerequisites; a completed agreement never implicitly activates a lease or authorises occupation.
- `/sign` is a standalone server HTML response that bypasses the root application shell as well as `_app` and company membership. `/api/signing` proxies explicit verification and signer-portal POST actions (session cookie only; per-operation body limits) plus GET read/resume, `?view=portal` and `?view=document|download` (and `?view=final` for completed participants' sealed copy), which streams the frozen PDF only after server-side SHA-256 verification and never returns storage URLs. POST `?upload=attachment` accepts only PDF/JPEG/PNG bytes (≤10 MB) for a session cookie and forwards them server-side to the quarantine form, then requests the scan; `kiosk_exchange` is the in-person counterpart of `exchange`. GET has no signing/mail side effects; outcomes are submitted only by explicit POST `submit`/`decline`/`request_correction`. Keep credentials in URL fragments before immediate local scrubbing, never query strings; do not log request bodies/cookies or attach telemetry on this path.

- Keep API routes, app-shell routes, portal routes, and document-detail routes understandable from filenames alone.
- Preserve TanStack Start naming conventions for dynamic, optional, and layout segments.
- Auth redirects in mounted layouts must wait until `location.href` equals `resolvedLocation.href`; pending destinations must never become a new sign-in `returnTo`. Sign-in return URLs must leave `/sign-in`, including links left by older nested redirects.
- `/documents/$id` shows each processing stage, staff recovery controls, and reconciliation for held jobs. `/portal/$clientSlug/documents` shows safe stage guidance and search/coverage warnings even when extraction or publication succeeded. Consume the backend's `stageSummary`, `processingHeld`, and `canRetryProcessing`; do not expose staff errors or permit retries while remote work is unresolved.

# Verification

- Run `npm run build --prefix insightful-property-hub` when route files change.
- Run `npm run lint --prefix insightful-property-hub` when route files change.

# Child DOX Index

- No child DOX docs yet.
