# In-app document viewer

Document filenames open a shared overlay in staff and client modules. PDFs have page
navigation, zoom and fit-to-width; images have zoom controls; text, CSV, Markdown and
HTML display as escaped text. Staff can navigate separately to Document details / review.
Download original always downloads the source upload. Viewing does not run extraction.

Office files (`doc`, `docx`, `xls`, `xlsx`, `pptx`) use a private Gotenberg PDF conversion;
multipage TIFF uses Pillow in Windmill. Originals remain unchanged. Layout follows
LibreOffice's rendering, including its font substitution and spreadsheet print areas;
complex Office layouts may differ. Corrupt or encrypted files show a preview failure
and retain the original download. No public viewer/CDN receives document data.

## Configuration and activation

Implementation and production activation are separate. Deploy only when explicitly requested.

1. Start the pinned converter using root `docker-compose.preview.yml` in the existing
   Dokploy infrastructure. Supply `PREVIEW_GOTENBERG_USERNAME` and
   `PREVIEW_GOTENBERG_PASSWORD` from secrets. Do not expose ports or attach a public domain.
   Attach every Windmill worker that can run the script to the Compose-created
   `document-preview` internal Docker network **in addition to** its normal network.
   Persist that network attachment in the Windmill service configuration.
2. Set Windmill workspace variable `f/docling/PREVIEW_GOTENBERG_URL` to
   `http://document-preview:3000`; set workspace secrets
   `f/docling/PREVIEW_GOTENBERG_USERNAME` and `f/docling/PREVIEW_GOTENBERG_PASSWORD`
   to match the converter. These credentials stay workspace-only. Macros are disabled by
   Gotenberg; deny all LibreOffice outbound URLs. The internal network also blocks egress.
3. Preview the local renderer with `wmill script preview f/docling/render_document_preview`
   and synthetic inputs. Inputs are a Convex original storage URL, filename, and a fresh
   Convex storage upload URL from the **same** deployment. Preview execution uploads a
   generated file; use a disposable fixture and delete the output after checking it.
4. Follow root scoped Windmill deployment rules: `npm run wmill:push -- --dry-run`,
   review the diff, then `npm run wmill:push`. Never widen the configured includes.
5. Create a dedicated Windmill token scoped to run `f/docling/render_document_preview`
   and read its jobs. Set Convex `WINDMILL_PREVIEW_TOKEN`; use the existing
   `WINDMILL_BASE_URL` and `WINDMILL_WORKSPACE`. Do not broaden the extraction token.
6. Deploy the additive Convex schema/functions, then the frontend through its normal
   deployment path. No backfill is required: old documents generate previews on demand.
   Check existing Dokploy deployment status before triggering another build.

The original upload limit remains 25 MB; converted outputs are capped at 50 MB.
TIFF conversion supports up to 200 pages / 100 million total pixels and fails explicitly
beyond those limits. Gotenberg requests have a 180-second timeout and a queue of four.
Windmill source/download and output/upload URLs are validated and never printed.

## Lifecycle

`documents.previewId` points to a `documentPreviews` row. Cache identity is source storage
ID plus renderer version. Requests claim conversion atomically; concurrent opens reuse it.
The reserved Windmill UUID and polling are stored before submission, so an ambiguous
submission is never blindly repeated. A five-minute watchdog fails stuck preparation;
retry is explicit. Polling continues for up to one hour to collect and delete late outputs.
Outputs only attach to the matching current claim/source and must be bounded PDFs.
Deleted documents cannot be viewed or receive outputs. Replaced originals retain the
same historical access as the existing original-file API; replacement uploads get a
separate preview. Original-file retention remains unchanged.

Missing converter configuration affects Office/TIFF previews only. Native PDF/image/text
viewing and original downloads continue to work. Restore configuration, then Retry preview.
Inspect failed `f/docling/render_document_preview` jobs for conversion/service failures;
never copy signed input URLs or credentials into logs/issues. For jobs unresolved beyond
the cleanup window, investigate the reserved job ID and any generated storage orphan.

## Verification

- `npm test`: preview lifecycle, cache reuse, tenant isolation, retries, stale outputs,
  deletion/source changes, configuration errors and unchanged extraction state.
- `python scripts/test-document-preview.py`: offline fake-HTTP Office request/validation,
  real three-page TIFF-to-PDF conversion, size/deadline failures and sanitized errors.
- `npm run build --prefix insightful-property-hub` and frontend TypeScript/lint checks.
- Browser checks use synthetic fixtures. Live acceptance after activation must include
  original PDFs/scanned PDFs, TIFF, every accepted Office extension, page clipping/fonts,
  converter failure/retry, and authenticated staff/client links in each module.

The private converter, Windmill renderer/secrets and Convex preview token/functions
are active in production. The frontend is released through GitHub `main` and Dokploy.
Authenticated module-to-viewer journeys and full Office-layout acceptance with real
records remain separate acceptance checks.

Local verification on 2026-10-16: 110 application/backend tests and six renderer checks
passed; Convex code generation, backend/frontend TypeScript and the production build
passed. Changed frontend source has no lint errors (one existing Fast Refresh warning);
whole-project lint retains its existing formatting backlog. Isolated browser fixtures
verified PDF pages/zoom, images, escaped HTML, original download, converted-preview
states, corrupt/missing files, client controls, focus/filter preservation and a 390px
mobile viewport. The built portal sign-in shell also loaded. These checks do not replace
the pending authenticated production journeys or real Office-layout acceptance.

Production infrastructure verification on 2026-10-16: converter compose
`voYPBjctefOyoaz1Ujprr` deployed successfully with no published ports and only the
internal `document-preview` network. Four Windmill workers were connected without
restart; their existing network was retained and the extra external network declaration
was persisted in Windmill's raw Compose configuration. Converter health returned 200.
The dedicated token is workspace-scoped to `jobs:run:scripts:f/docling/render_document_preview`
and `jobs:read`; no extraction token was changed.

Internal `documentPreviews:checkConnection` live tests returned bounded PDF outputs and
deleted their temporary source/output files, without application-record writes:

| Fixture | Windmill job | PDF bytes |
| --- | --- | ---: |
| DOCX (two pages) | `c9367057-8c90-45ea-a9b9-d0834773fa4c` | 24,320 |
| XLSX | `d8201575-51e7-4d77-b738-cac25ffd0c11` | 13,561 |
| PPTX (two slides) | `1a560831-7b06-4ffc-abbc-c7aa74a46fb7` | 18,954 |
| TIFF (three pages) | `f9bf0fac-43dc-48ea-8af1-c2c486c6ef16` | 9,434 |

Operators can rerun `npx convex run documentPreviews:checkConnection` on the production
deployment with JSON `{filename, inputBase64}` from a synthetic fixture. The action is
internal and does not create tenants, documents, extraction attempts or review decisions.
