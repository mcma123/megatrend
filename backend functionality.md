# Backend Functionality: Replacing Static Data with Real Data

Roadmap to move Cyphersoft OS (staff app + client portal) off static demo data onto
real Convex data, real document upload, and real Windmill/Mastra processing.
Work phase by phase; tick each box when done and verified.

Legend: [ ] not started · [x] done

## Initial audit (2026-10-05; implementation progress is recorded in the phase checklists)

**Real at initial audit**
- Sign-in / sign-out (Convex Auth, email + password, invite-only)
- Portal Team page: list members, invite, revoke (Convex `portal.*`)
- Portal document scanner: edge detection, enhance, PDF generation (Windmill `f/docling/scanner/*`);
  "Save" writes the PDF to MinIO bucket `scanner` but creates **no record**
- Assistant: web research (Firecrawl/SearXNG + images), OKF knowledge agent (Mastra → Windmill)
- Windmill Docling → parsed JSON (MinIO `parsedinjson`) → OKF bundle (MinIO `okfdata`) flow, run manually only

**Static / fake at initial audit**

| Area | Page(s) | Static source | Fake actions |
|---|---|---|---|
| Dashboard | `/dashboard` | `mock-data.ts` (clients, leases, properties, documents, tasks, invoices, briefs, recentActivity) | — |
| Clients | `/clients`, `/clients/$id` | `clients`, `leases`, `properties`, `documents`, `tasks` | New client |
| Properties | `/properties`, `/properties/$id` | `properties`; map is a mock plot | Shortlist, Add to brief |
| Leases | `/leases`, `/leases/$id` | `leases`, `renewalSteps` (first steps hard-coded "done") | Renew, Open briefing pack |
| Documents (staff) | `/documents`, `/documents/$id` | `documents`; extracted fields hard-coded (same for every doc) | Upload/drop zone discards files; Re-process, View original, Approve |
| Invoices | `/invoices` | `invoices` | — (no upload/status change) |
| Tasks | `/tasks` | `tasks` | New task; no edit/drag |
| Automations | `/automations`, `/automations/$id` | `automations`, `renewalSteps` as run history | Simulate run; switches not saved |
| Reports | `/reports` | `clients`, `leases`, `properties`; system cost hard-coded | — |
| Search | `/search` | always returns DHL leases; templated "AI insight" | Ask, Export CSV |
| Sourcing | `/sourcing` | `briefs`, `properties`; ranking computed client-side (buggy type filter) | Generate, PDF, Send to client, Shortlist |
| Organisations | `/organizations` | `portal-auth.ts` (localStorage, plaintext passwords) | Create org (localStorage only) |
| Header | all staff pages | — | "Ask anything" search, notifications bell |
| Portal login | `/portal` | org list from `portal-auth.ts` | — |
| Portal shell | `/portal/$clientSlug` | client resolved from `mock-data` by slug; tenant access **not enforced** | — |
| Portal dashboard | `/portal/$clientSlug` | `mock-data` | Upload invoice/contract (kept in state only), Request quote |
| Portal actions | `.../actions` | inline `demoActions` | Create request, Reply, Mark complete, Upload, Ask |
| Portal insights | `.../insights` | inline `demoInsights` | Request quote, Ask, Source document |
| Portal documents | `.../documents` | inline `demoDocuments`, `initialQueue` | Upload/Bulk upload (discarded), View, Download, Replace, Delete, Retry |
| Portal property | `.../properties/$id` | mock + inline DHL arrays (same for every property) | Upload, Request quote, Ask |
| Portal lease | `.../properties/$id/lease` | inline DHL lease object for every property | View/Download/Replace contract |

**Missing in Convex at initial audit:** clients, properties, leases, lease clauses, documents, processing jobs,
extracted fields, insights, actions/tasks, comments, invoices, anomalies, sourcing briefs/candidates,
automations/runs, notifications. No file storage use.

**Security gaps:** staff routes have no access guard; portal tenant access not checked against
memberships; `/api/scanner/*` and `/api/chat` have no auth.

---

## Phase 0: Foundations, access control & cleanup
Goal: a real tenant to attach data to, and access rules enforced before real data arrives.

- [x] Seed the role catalog (11 roles seeded in production via `admin:seedRoleCatalogInternal`)
- [ ] Provision the first real client: sign in as a platform admin → Clients → New client (needs the client's real details)
- [x] Staff route guard: `_app` requires sign-in + a staff membership (or platform admin); redirect others
- [x] Portal tenant guard: resolve `$clientSlug` from Convex `tenants` (not `mock-data`) and require an active membership in that tenant
- [x] Shared Convex helpers for tenant-scoped reads/writes (reuse `convex/lib/auth.ts` `requireActiveMembership`)
- [x] Organisations page: create clients via `tenancy:provisionTenant` + invite the client admin via `portal:invitePortalMember` (replace `portal-auth.ts`)
- [x] Portal login: replace the `portal-auth.ts` org list with the user's real memberships
- [x] Protect `/api/scanner/*` and `/api/chat` (require a signed-in session; pass tenant id)
- [x] Fix backend bugs found in audit: duplicate memberships breaking `.unique()`, re-invited revoked users staying revoked, audit `actorType` always `staff_user`
- [x] Team page: handle "not a team manager" gracefully; block self-revoke

**Done when:** a staff user and a client user can sign in and each sees only what their membership allows.

## Phase 1: Core portfolio data (clients, properties, leases)
Goal: the main records come from Convex with create/edit.

- [x] Schema: `properties`, `leases`, `leaseClauses` (tenant-scoped, indexed by tenant/client/expiry); client = tenant + organisation
- [x] Convex queries/mutations: list/get/create/update/archive for clients, properties, leases (with audit events)
- [x] `/clients` + "New client" form; `/clients/$id` tabs (portfolio, leases) from Convex
- [x] `/properties` + `/properties/$id` from Convex; create/edit property form
- [x] `/leases` + `/leases/$id` from Convex; create/edit lease form; expiry and time-to-expiry computed from today (not a fixed date)
- [x] Portal dashboard KPIs, properties table and renewal timeline from Convex
- [x] Portal property page + lease page show the real property/lease (remove inline DHL data)
- [ ] One-off dev seed script that imports the current demo records into a test tenant (optional, for demos; skipped so production holds only real data)

**Done when:** adding a property/lease in the staff app shows up in that client's portal.

## Phase 2: Document upload & storage
Goal: every upload button stores the file and creates a document record.

- [x] Decide storage for originals: Convex file storage (`generateUploadUrl`, signed URLs) for originals; Windmill reads them by URL; MinIO keeps parsed JSON/OKF
- [x] Schema: `documents` (tenant, client, property?, lease?, type, filename, size, mime, storageId, uploadedBy, status, timestamps)
- [x] Upload mutation flow with validation (type, size); audit event `document.uploaded`
- [x] Staff `/documents`: working drop zone + "Choose files"; list from Convex with status filters
- [x] Portal documents: Upload + Bulk upload; register lists real documents; View / Download (signed URL)
- [x] Portal dashboard + property page upload buttons use the same upload flow
- [x] Scanner "Save to documents": store the generated PDF as a document record (real user + tenant, not mock ids); show it in the register
- [x] Replace / request deletion (soft delete + audit)

**Done when:** a file uploaded in the portal appears in the staff Documents list and can be opened.

## Phase 3: Document processing pipeline (Docling + extraction)
Goal: uploaded documents are processed automatically and their status is live.

Hardening is tracked separately in `docling_file.md`. Phase 1 adds atomic attempt
ownership, submission reconciliation, a versioned result contract, and an explicit
staff acknowledgement gate for incomplete source coverage. Phase 2 adds current-attempt
field indexes and shared readers across review, record updates, invoices, reports,
and AI draft facts, preserving historical decisions and exact-job legacy compatibility.
Phase 3 adds independent stage outcomes, saved-source retries, knowledge-only recovery
that preserves reviewed fields, safe client guidance, and reconciliation of held remote
jobs. Long-document sectioning and page provenance remain scheduled in later hardening
phases; the original checklist describes the base pipeline.

- [x] Status state machine on `documents`: uploaded → queued_for_ocr → ocr_complete → extraction_complete → review_required → approved (+ failed states)
- [x] Convex action triggers the Windmill Docling flow (`f/docling/parse_document_to_okf__flow` / `convert_document_to_markdown`) with the document's signed URL and tenant id; store the Windmill job id
- [x] Windmill → Convex result handling: implemented as Convex polling the Windmill job every 10 s (no inbound webhook to secure); stores status, parsed-JSON key, OKF bundle root, page count, OCR confidence
- [x] Classification (lease / invoice / utility statement / addendum / other) and field extraction with confidence scores (Windmill + Mastra/LLM step); schema `extractedFields` (field, value, confidence, page/evidence, state)
- [ ] Per-tenant OKF bundles so the OKF assistant only answers from that client's documents — bundles are now written per client (`<tenant-slug>/<document-id>/…`); limiting the assistant to one client is still open (the assistant is staff-only today)
- [x] Staff `/documents/$id`: real extracted fields, View original, Re-process, live status
- [x] Portal documents processing queue shows real progress; Retry for failed documents
- [x] Low-confidence fields flagged as "Needs review"; missing-document detection

**Done when:** uploading a real lease PDF produces extracted fields on its document page within minutes.

## Phase 4: Review, curation & publishing
Goal: nothing reaches a client without human review; approved data updates the records.

- [x] Staff review queue (inbox): documents and fields needing review, ranked by urgency
- [x] Approve / edit / reject extracted fields; approved lease fields update the `leases` record (low-confidence values never overwrite approved data)
- [x] Schema `insights` (draft → under_review → published, evidence links, reviewer)
- [x] Mastra drafts insights from approved data (renewal exposure, cost changes); staff edit/approve/publish
- [x] Portal insights page reads published insights; "Source document" opens the evidence document
- [x] Portal lease page "Human approved" values come from approved fields
- [x] Every approve/publish/reject writes an audit event

**Done when:** a staff member approves an extracted lease and the client sees the published values and insight.

## Phase 5: Actions, tasks, comments & notifications
Goal: real work items between staff and clients.

- [x] Schema `actions` (open → in_progress → waiting_on_client / waiting_on_cyphersoft / waiting_on_landlord → completed; overdue derived from due date) + `actionComments`
- [x] Staff `/tasks`: create, edit, assign, move between columns (incl. "Waiting on landlord")
- [x] Portal actions: create request, reply, upload linked document, mark complete; counts computed from real due dates
- [x] Auto-create actions from document flags (missing fields, review needed)
- [x] Schema `notifications`; header bell lists unread notifications (new upload, published insight, action reply)
- [ ] Email notifications (optional, later)

**Done when:** a client request in the portal appears as a task for staff, and a staff reply notifies the client.

## Phase 6: Invoices & anomaly detection
Goal: invoices come from uploaded documents and anomalies are calculated.

- [x] Schema `invoices` (invoice + utility statement kinds) populated from approved extractions (supplier, period, amount) when a review is completed
- [x] Baseline per property/supplier (rolling average of up to 6 earlier invoices) and `anomalies` (cost spike / possible duplicate; delta, severity, cause, status)
- [x] Staff `/invoices` from Convex; change status (investigating, resolved, dismissed)
- [x] Portal dashboard anomaly alerts from real anomalies (only those staff share with the client)
- [x] Anomaly → action/insight draft for staff review

**Done when:** uploading an unusually high utility invoice raises an anomaly on the Invoices page.

## Phase 7: Dashboards, search & reports
Goal: overview pages summarise real data.

- [x] Staff dashboard KPIs, renewal alerts, latest documents/tasks from Convex
- [x] Recent activity feed from `auditEvents`
- [x] Portal dashboard fully on Convex
- [x] `/reports`: rental by region, renewals by year, ROI inputs from real data
- [x] `/search`: Convex full-text search over clients/properties/leases/documents + OKF agent for document content; Export CSV
- [x] Header "Ask anything" box opens the assistant / search

**Done when:** no staff or portal overview page imports `mock-data.ts`.

## Phase 8: Automations (renewal cadence & workflows)
Goal: automations actually run and their history is real.

- [x] Schema `automations` + `automationRuns` (mode, status, stats, items, optional Windmill job id) + `renewalMilestones`
- [x] Enable/disable switches persist
- [x] Renewal cadence (T-180 → T-7) via Convex cron (daily 07:00 SAST): creates actions, insight drafts, notifications per lease; plus daily overdue-action reminders
- [x] "Simulate run" triggers a dry run and records it
- [x] Run history page lists real runs; lease renewal timeline shows real progress

**Done when:** a lease entering its renewal window automatically creates the T-180 action and notification.

## Phase 9: Sourcing / Property Scout
Goal: sourcing briefs produce real candidate properties.

- [x] Schema `sourcingBriefs`, `propertyCandidates` (AI suitability scores and explanations embedded on candidates)
- [x] Save briefs from the `/sourcing` form; real clients, staff-only tenant history, immutable filters and idempotent submissions
- [x] "Generate options" invokes the existing web-research agent through its Windmill-backed Firecrawl/SearXNG tools and stores validated candidates with scores and scraped source links
- [ ] Shortlist, add to brief, staff review, send to client (portal view)
- [ ] Options pack PDF export
- [x] Fix ranking (remove client-side mock ranking and the type-filter bug); show selected search type and actual candidate types, permit Logistics warehouses/distribution only with use evidence, and flag unverified requirements

Implementation verification (2026-10-12): full `npm test -- --reporter=dot --testTimeout=30000` passed 78 tests; the updated sourcing suite passed all 18 tests, including endpoint authentication, saved filters, tenant isolation, duplicate submissions, source provenance, type matching, empty results, upstream failures and late-result rejection. These tests use mocked research providers. Convex codegen, `tsc --noEmit -p convex/tsconfig.json`, a strict typecheck of the Mastra sourcing endpoint, `npm run build --prefix insightful-property-hub`, `npm run build:mastra` and sourcing-page lint passed; repository-wide lint remains blocked by pre-existing formatting and unrelated errors.

DOX closeout: Convex, frontend source/routes and Mastra contracts are updated, including the new Mastra routes child index. Root and frontend app-level `AGENTS.md` remain unchanged because project ownership, tooling and deployment policy are unchanged.

Production rollout remains separate:
- [x] Configure `MASTRA_SOURCING_URL` on Convex with the externally reachable research endpoint; configure the same `MASTRA_SOURCING_SERVICE_TOKEN` on Convex and Mastra. Production uses `https://mega.cyphersoftai.com/api/sourcing/research`, a protected portal bridge to the existing Web Research Agent. Keep model and Windmill MCP configuration on Mastra.
- [x] Deploy additive Convex schema/functions to `focused-malamute-656` (2026-10-12; schema validation and enabled TypeScript checks passed; no indexes deleted).
- [ ] Deploy the frontend/Mastra builds through Dokploy.
- [ ] Run live searches for Office, Logistics, Warehouse and Retail; verify listing source pages, correct type labels, saved history after reload, missing-fact guidance and failure handling. Live provider/browser verification has not been performed.

**Done when:** a brief generates real listings that staff can shortlist and publish to the client.

Release status: production Convex deployment succeeded on 2026-10-12. The compatible document-processing script and flow were pushed to Windmill after a scoped dry run (`--extra-includes 'f/docling/convert_document_to_markdown.*,f/docling/process_document_for_app__flow/**'`, skipping folders, variables and resources); document summary/recovery checks passed 10/3 tests. Dokploy access and the portal at `https://mega.cyphersoftai.com` were verified on 2026-10-13. Sourcing endpoint/token configuration is saved; the protected portal bridge passed its build, 18 sourcing tests, and local authentication/forwarding checks. Bridge deployment and live four-type verification remain pending. Generated Python caches and local credentials are excluded from the GitHub release.

## Phase 10: Hardening & clean-up
- [ ] Delete `src/lib/mock-data.ts` (no remaining imports) — `src/lib/portal-auth.ts` already removed in Phase 0
- [ ] Run export jobs (`exportJobs` processor) and retention policy
- [ ] Error/empty/loading states on every page
- [ ] Tests for Convex functions (access control, state transitions) — `npm test` harness and portfolio/access tests added in Phase 0–1; extend per phase
- [ ] Dokploy env + Convex prod deploy checklist; `.env.example` updated
- [ ] Update AGENTS.md docs for new tables, flows and routes
