# Purpose

- Owns document viewing, upload, status, field review and application-to-records UI.

# Ownership

- Owns every component in this folder. Backend file access and preview lifecycle belong to `convex/documentPreviews.ts`; auth provider wiring belongs to `src/lib/convex-client.tsx`.

# Local Contracts

- Document clicks open a large in-app overlay for staff and clients. Preserve the current route, filters and scroll position; restore focus to the opener. Clear the selected document on navigation or auth-user changes.
- `DocumentLink` and `useOpenDocument` share `DocumentViewerContext`; mount one `DocumentViewerProvider` inside the configured auth providers. Staff keep a separate details/review link; clients never receive staff review controls.
- Use the lightweight authorized file-view query, never `documents.get` (which includes extracted fields), for the overlay. File visibility does not depend on extraction or approval status.
- PDFs use lazy-loaded PDF.js with a bundled worker and local fonts/decoders. Images render directly. HTML/Markdown/CSV/plain text render as escaped text. Office/TIFF previews request cached private Windmill conversion; never use public Office viewers or execute uploaded HTML.
- Preview errors must retain Retry and Download original controls. Fetch a newly authorized file view before downloading. Converted previews are labeled and never replace originals.
- Existing upload/replacement hooks and field-review/application controls retain their backend authorization and processing ownership checks.

# Work Guidance

- Use the existing Dialog primitives for keyboard navigation and focus trapping. Mobile uses the full viewport; desktop uses a large overlay. Keep page controls excluded from voice dictation.
- Do not add OCR/extraction calls to file viewing. Conversion setup is documented in `insightful-property-hub/docs/document-viewer.md`.

# Verification

- Run the frontend build and lint. Verify PDF navigation/zoom, image/text viewing, escaped HTML, conversion states, errors, focus restoration and preserved page state with synthetic files.
- Run `npm test` when preview backend contracts change and `python scripts/test-document-preview.py` when renderer behavior changes.

# Child DOX Index

- No child DOX docs yet.
