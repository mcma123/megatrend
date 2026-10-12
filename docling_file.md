# Docling Document Processing Execution Plan

## Objective

Make document processing complete, observable, and safe to retry across Convex,
Windmill, Docling, and the active `insightful-property-hub/` application.

Scope covers five issues: long-document truncation, missing stage outcomes,
duplicate processing starts, historical fields hiding current fields, and missing
page provenance. This plan extends `backend functionality.md`; it does not replace it.

## Execution and completion rules

- Execute phases in order. Read the applicable AGENTS.md chain and required skills
  before implementing changes in each subsystem.
- Tick a task `[x]` only after its implementation and relevant verification pass.
- Tick a phase `[x]` in the tracker only when all its tasks and acceptance checks pass.
- Record verification evidence under that phase: command/result, relevant fixture
  or job ID, and any remaining limitation. Never record credentials or private
  document content.
- If a check fails, keep the phase unchecked and record the blocker and next action.
- Track implementation completion separately from production rollout. Deployment
  requires an explicit request to deploy; creating this plan does not deploy changes.
- Update the nearest owning AGENTS.md when a phase changes durable contracts.

## Baseline

- Flow: `f/docling/process_document_for_app`.
- Convex: `convex/processing.ts`, `documents.ts`, `review.ts`, `schema.ts`, and validators.
- Windmill scripts: `f/docling/convert_document_to_markdown.py`,
  `convert_parsed_json_to_okf.py`, `extract_document_fields.py`, and flow `summarize.py`.
- Original files live in Convex storage; parsed JSON and knowledge bundles live in MinIO.
- Deployed self-tests succeeded on 5 October 2026. The inspected sample extracted
  12 lease fields, but had no page count or field page references.
- Those self-tests disabled OCR. Production had no document records at the audit;
  a real application upload/review cycle remains unverified.
- Extraction currently reads at most 60,000 characters. Convex ignores `truncated`,
  `okf_error`, and `docling_status` when applying results.
- Existing backend verification: `npm test` (20 passing tests at the audit).
- Frontend TypeScript passed at the audit. Lint has substantial pre-existing
  formatting/line-ending failures; record that baseline separately from new failures.

## Phase tracker

| Complete | Phase | Outcome | Depends on |
|---|---|---|---|
| [x] | 1. Attempt ownership and safe result contract | One processing owner; incomplete results require review | None |
| [x] | 2. Current-attempt field queries | Current fields remain visible after repeated processing | Phase 1 |
| [x] | 3. Stage outcomes and targeted recovery | Partial failures are visible and failed stages can be retried | Phases 1-2 |
| [ ] | 4. Page metadata and evidence | Real page counts and traceable field sources | Phases 1-3 |
| [ ] | 5. Complete long-document extraction | All sections processed with deterministic merging | Phases 1-4 |
| [ ] | 6. Integration and acceptance verification | Upload-to-review journey demonstrated with failure recovery | Phases 1-5 |

## Phase 1: Attempt ownership and safe result contract

Purpose: establish the identity and lifecycle used by every later phase, and stop
incomplete extraction from appearing complete while chunked extraction is pending.

- [x] Define an additive processing-attempt model: attempt ID, document ID, lifecycle,
  timestamps, Windmill job ID, and a document pointer to the current attempt.
- [x] Claim an attempt in a Convex mutation before submitting a Windmill job.
  Duplicate scheduled starts must find the existing claim and exit.
- [x] Pass the attempt ID through Windmill inputs/results and use it in artifact
  paths so retries cannot overwrite earlier attempts' artifacts.
- [x] Require the current attempt ID on job attachment, progress updates, failures,
  results, and timeout handling. Ignore stale updates and updates to deleted or
  replaced documents; handle duplicate completion idempotently.
- [x] Define recovery for a claim that never receives a job ID. Treat an ambiguous
  submission timeout separately from a confirmed rejection; reconcile before
  submitting another job, using a stable submission identity where supported.
- [x] Introduce a versioned result contract for stage status, completeness,
  warnings, artifact references, and page provenance. Preserve existing field keys.
- [x] Persist `truncated` immediately. Partial parsing, truncation, missing sections,
  or invalid result shape must prevent a normal complete-extraction outcome.
- [x] Require explicit staff acknowledgement of incomplete source coverage before
  completing review or applying those results to records; never silently clear it.
- [x] Use optional fields and a documented legacy fallback so existing records and
  in-flight jobs remain readable during rollout.
- [x] Add tests for concurrent starts, stale failure/success, duplicate completion,
  deletion/replacement during processing, and abandoned claims.

Acceptance: two concurrent starts create one active claim; superseded jobs cannot
change current state; truncated results remain visibly incomplete and require review.

Verification evidence (10 October 2026):

- `npm test`: 38 tests passed across six files, including 18 new attempt/recovery
  and incomplete-coverage tests. The repeated-processing workflow test now exercises
  a real second attempt and confirms stale results cannot change reviewed state.
- `python scripts/test-docling-summary.py`: six summary-contract tests passed.
- Convex code generation/type checking passed; `tsc --noEmit -p convex/tsconfig.json`
  passed after the final backend changes.
- Frontend `tsc --noEmit` and `npm run build --prefix insightful-property-hub` passed.
  ESLint passed for the changed document-detail route. Full-app lint remains blocked
  by the inherited baseline (10,843 errors and 15 warnings); unrelated cleanup is
  outside this phase.
- `wmill lint f/docling/process_document_for_app__flow --locks-required --json`:
  one valid flow, no issues or warnings.
- Windmill local-flow preview of the `summarize` step with sanitized inputs passed:
  attempt `phase1-preview`, contract version 1, extraction `partial`, coverage
  `complete: false`, and `truncated: true`. The preview did not run OCR/extraction
  or write document artifacts. No definitions were deployed.
- `git diff --check` passed.

Implemented contracts and limits:

- Atomic claims own a reserved Windmill submission ID. Attachments, callbacks,
  polling, and completion check the current attempt; artifact paths include it.
  Reserved job IDs follow the [Windmill API contract](https://app.windmill.dev/tsdocs/types/RunFlowByPathData.html).
- Abandoned claims that never began submission can be retried. Ambiguous submissions
  are reconciled by reserved job ID and remain held if ownership cannot be confirmed;
  operators can invoke `processing:recoverSubmission` as documented in
  `convex/AGENTS.md`. Lookup failure alone never authorizes duplicate submission.
- Legacy documents without an attempt pointer accept only their matching existing
  job. Legacy-shaped results arriving on a new attempt require coverage review.
- Incomplete coverage remains visible after approval. Staff must record an explicit
  acknowledgement before completing review or applying results; a new attempt
  clears that acknowledgement.
- The 60,000-character extraction limit remains until Phase 5. Current-field indexing
  is completed in Phase 2 and stage recovery in Phase 3; real page provenance and
  full upload-to-review integration remain assigned to Phases 4-6. Production rollout
  is still pending.
- DOX closeout updated root, Convex, and frontend `src/AGENTS.md` contracts and
  `backend functionality.md`. Frontend root/routes instructions and child indexes
  were left unchanged because ownership, route structure, and their existing
  general contracts did not change.

## Phase 2: Current-attempt field queries

Purpose: remove dependence on historical field ordering and fixed history limits.

- [x] Tag new extracted fields with their attempt ID and add an index suitable for
  querying by document and attempt.
- [x] Introduce a shared current-field reader used by document details, review queue,
  field decisions, bulk approval, completion, lease application, invoice creation,
  and AI insight fact gathering. Audit all consumers, not only `documents.get`.
- [x] Filter by the current attempt before applying limits; paginate when needed.
- [x] Reject decisions targeting fields from an obsolete attempt.
- [x] Preserve historical extraction/review data without mixing it with current fields.
- [x] Support legacy records through their current Windmill job ID; document any
  backfill required before removing that fallback.
- [x] Test more than 200 historical fields across repeated attempts, and more than
  500 historical fields where previous supersession logic was bounded.

Acceptance: the newest attempt's fields are visible and reviewable regardless of
history size; approved values from older attempts cannot enter current record updates.

Verification evidence (10 October 2026):

- `npm test`: 48 tests passed across seven files, including 10 new current-field
  tests in `convex/documentFields.test.ts`.
- Regression fixtures cover 600 historical fields across six jobs, two completed
  owned attempts, exact-job legacy and Phase 1 compatibility, lease/invoice updates,
  report counts, and approved facts returned to the AI drafting route.
- A 233-field current fixture verifies three pagination pages, pending decisions
  beyond row 200, complete bulk approval of eligible fields, and rejection of old
  cursors and decisions after reprocessing. Deleted/replaced documents and tenant
  access are also checked.
- A 1,001-field fixture verifies explicit rejection of oversized full reads/bulk
  completion without partial writes; paged reads and individual decisions work.
- `CONVEX_DEPLOYMENT=prod:focused-malamute-656 npx convex codegen --typecheck enable`
  passed. Final `npx tsc --noEmit -p convex/tsconfig.json` passed.
- Frontend TypeScript and `npm run build --prefix insightful-property-hub` passed.
  No frontend source or Windmill definitions changed in this phase; the known
  full-app lint baseline remains recorded under Phase 1.
- `git diff --check` passed. No backend, frontend, or Windmill deployment performed.

Implemented contracts and limits:

- `extractedFields.attemptId` is additive/optional. New results are indexed by
  document/attempt; legacy results use a document/job index. `lib/documentFields.ts`
  centralizes selection for document details, review queue, decisions, bulk approval,
  completion, lease application, invoices, and reports. AI drafting already obtains
  approved facts through `documents.get`, so it inherits the same selection.
- The former 500-history-row supersession loop is removed. Historical approvals,
  corrections, and review timestamps are retained; current ownership determines
  visibility and eligibility. Fields are hidden while the document is reprocessing.
- Untagged Phase 1 records remain readable via the exact current job when no tagged
  current fields exist. Tagged and untagged results are never mixed. No backfill is
  required for additive rollout; the required backfill before retiring compatibility
  is documented in `convex/AGENTS.md`.
- `documents.listFields` pages at most 100 current rows and validates the caller's
  attempt/job on each request. Full review/record readers support up to 1,000 rows
  and fail explicitly above that bound; the production extractor currently accepts
  at most 100 fields per result. Supporting larger extraction catalogues requires
  increasing that bound or implementing batched completion.
- DOX closeout updated `convex/AGENTS.md` and `backend functionality.md`. Root,
  frontend, and Windmill instructions and child indexes remain unchanged because
  their ownership, structure, and operating contracts did not change. Full live
  integration and production rollout remain pending in their separate checklists.

## Phase 3: Stage outcomes and targeted recovery

Purpose: distinguish parsing, knowledge indexing, and field extraction outcomes.

- [x] Store per-stage states: pending, running, succeeded, failed, partial, or skipped,
  with bounded error details, timestamps, artifact references, and retryability.
- [x] Validate actual Docling response status and errors; a successful HTTP response
  alone must not imply complete parsing. Preserve partial output with a clear warning.
- [x] Persist knowledge-bundle failures and extraction completeness separately.
  Define which failures block processing, which permit staff review, and which
  leave document search unavailable. Preserve the human publication gate.
- [x] Handle failed-stage responses and malformed extraction results explicitly.
  Classify retryable transport/rate-limit failures separately from invalid input.
- [x] Add authorized targeted retries that reuse valid artifacts: knowledge retry
  from parsed JSON; extraction retry from parsed text; parse retry from the original.
- [x] Associate recovery with an owned attempt, explicitly reference reused artifacts,
  and rerun only dependent stages invalidated by the retry. A knowledge-only retry
  must not supersede reviewed extraction fields.
- [x] Display stage progress, partial-processing warnings, and appropriate retry
  actions on staff document details and the client processing queue. Keep technical
  error details on staff surfaces; client messages must explain the needed action.
- [x] Handle missing processing configuration and polling timeout with actionable
  states. Reconcile or cancel remote work where possible; do not claim a job was
  stopped when only local polling ended.
- [x] Test parsing failure, partial parsing, knowledge failure with successful
  extraction, malformed output, retry success, and late updates after timeout.

Acceptance: no stage failure disappears behind a generic successful result;
knowledge failure can be repaired without OCR or loss of reviewed fields.

Verification evidence (10 October 2026):

- `npm test -- --maxWorkers=1 --testTimeout=30000`: 60 tests passed across eight
  files, including 12 stage/recovery regressions. The initial parallel run encountered
  local five-second test timeouts; the controlled-worker rerun passed without changing
  application behavior or the repository's test configuration.
- Tests cover knowledge failure with successful extraction, publication-preserving
  recovery, concurrent retry claims, staff/tenant access, extraction/source reuse,
  parse failure, partial/malformed results, rate limits, configuration loss, safe
  client responses, timeout reconciliation, legacy remote holds, and stale callbacks.
- `python scripts/test-docling-summary.py`: 10 tests passed.
  `python scripts/test-docling-recovery.py`: three tests passed, confirming saved JSON
  reuse preserves parser status/errors and invokes neither OCR nor artifact writes.
- Convex code generation/type checking and final `npx tsc --noEmit -p convex/tsconfig.json`
  passed. Frontend TypeScript and production build passed.
- ESLint passed for both changed document routes. Full-app lint still reports the
  inherited baseline: 10,843 errors and 15 warnings.
- `wmill lint f/docling --locks-required --json`: two valid definitions, no issues
  or warnings. Existing dependency locks remain valid; changed imports are standard
  library modules or dependencies already present in the parser script.
- The app flow's `summarize` step preview passed with attempt `phase3-preview`:
  parsing reused, knowledge succeeded, extraction skipped.
- Whole-flow previews of a sanitized copy of the same flow passed for attempts
  `fixture-knowledge` and `fixture-extract`. Assertion-only upstream modules verified
  conditional skips and reuse in Windmill's actual control flow, without OCR/model
  calls or MinIO writes. Fixtures are under
  `C:/Users/HP22/.cache/codex-docling-phase3__flow/`; preview commands use that directory
  relative to the cache working directory. The real MinIO/OCR integration is still
  reserved for Phase 6 and the authorized production pilot.
- `git diff --check` passed. No backend, frontend, or Windmill definitions deployed.

Implemented contracts and operational limits:

- `documents.processingStages` records each stage independently. Explicit parse or
  extraction failure without usable fields blocks review/record application through
  `processing_failed`; partial usable output keeps the incomplete-coverage gate.
  Knowledge failure leaves extraction and staff publication intact, while clearly
  reporting that document search is unavailable.
- `processing.retryStage` requires a tenant staff writer and the displayed source
  attempt. Parse retries rerun dependent work. Extraction retries reuse validated
  saved JSON/text and the prior knowledge outcome. Knowledge retries have a separate
  owned recovery pointer and preserve current fields, decisions, approval, coverage
  acknowledgement, and processing/review timestamps. Artifacts and their source
  attempts remain traceable; callers cannot choose arbitrary object keys.
- Staff see bounded technical errors and recovery controls; clients receive static
  actionable guidance and safe stage summaries through document reads. Transport
  and rate-limit failures permit recovery; invalid input requires correction, and
  configuration failures can be retried after settings are restored.
- A local waiting timeout retains remote ownership and blocks duplicate submission.
  Slower reconciliation continues for up to four hours; unresolved work remains held
  afterwards. Staff can invoke `processing.reconcile` from the document page to check
  again. Legacy jobs without an attempt ID use the same hold/reconciliation policy.
  Cancellation is not assumed or claimed; the existing processing token needs no
  broader permissions.
- DOX closeout updated root, Convex, and route instructions plus
  `backend functionality.md`. Frontend root/source instructions and child indexes
  remain unchanged because their ownership and existing general contracts still
  apply; route-specific recovery rules live in the closer routes document.
- Page provenance, full long-document coverage, live upload-to-review verification,
  and production rollout remain pending in their separate phases/checklists.

## Phase 4: Page metadata and evidence

Purpose: use parser provenance rather than guessed Markdown page breaks.

- [ ] Inspect real Docling responses for digital and scanned multipage PDFs and
  establish the available page-count and source-item provenance contract.
- [ ] Request/preserve structured page data alongside Markdown, including a mapping
  from text spans or source items to original 1-based page numbers.
- [ ] Derive page count from structured parser metadata. For formats without real
  page boundaries, store unknown explicitly rather than inventing page numbers.
- [ ] Carry page mapping through MinIO artifacts, flow results, and extraction inputs.
- [ ] Validate that extracted evidence occurs in the mapped source and that page
  references are within the document's page range. Mark unverified references.
- [ ] Show evidence and source page in staff field review, with an original-document
  link; offer page navigation where the supported viewer can honor it.
- [ ] Add checks using a known multipage PDF and a scanned PDF; retain correct page
  numbering across table content and multi-page evidence.

Acceptance: known PDF page counts match the source; field evidence points to the
correct page where provenance is available; unknown provenance stays explicit.

Verification evidence: pending.

## Phase 5: Complete long-document extraction

Purpose: replace silent prefix extraction with coverage of the complete document.

- [ ] Split complete parsed text into bounded sections using headings and page
  boundaries, with controlled overlap and stable section IDs/page ranges.
- [ ] Establish document classification from representative content and reuse the
  selected catalogue consistently across sections; flag conflicting classification.
- [ ] Extract sections with bounded concurrency, request budgets, timeouts, and
  section-level retries. Keep execution in Windmill and preserve stable field keys.
- [ ] Merge identical normalized values deterministically, retain evidence/provenance,
  and flag conflicting values for staff resolution rather than choosing silently.
- [ ] Compute missing required fields after merging all sections, not per section.
- [ ] Store coverage: total/completed/failed sections, processed source ranges,
  unresolved conflicts, and whether extraction is complete.
- [ ] Persist section outputs so recovery can retry failed sections and re-merge
  without charging for every previously successful section again.
- [ ] Replace the fixed polling window with a bounded completion budget suitable
  for sectioned work, including queue time and scheduled retries. Surface progress.
- [ ] Treat configured size/cost limits as explicit partial processing or rejection;
  never mark an unprocessed tail as complete.
- [ ] Verify a document longer than 60,000 characters with required fields near the
  end, boundary-spanning evidence, duplicate values, conflicting values, and one
  failed section followed by recovery.
- [ ] Verify short-document extraction still produces the expected catalogue and
  human-review behavior without unnecessary extra model calls.

Acceptance: fields beyond character 60,000 are extracted; complete status requires
all source sections to be covered; conflicts and missing coverage remain visible.

Verification evidence: pending.

## Phase 6: Integration and acceptance verification

Purpose: demonstrate the complete application journey and recovery behaviors.

- [ ] Prepare sanitized fixtures: digital lease, scanned multipage lease, long lease,
  invoice, partial/malformed parser response, and repeated-attempt history.
- [ ] Run backend access/state tests with `npm test`, adding meaningful coverage for
  the new contracts and recovery paths.
- [ ] Run frontend TypeScript, build, and lint checks. Record inherited lint failures
  and confirm changes introduce no new relevant failures.
- [ ] Validate Windmill definitions and script metadata with the required skills;
  use previews for execution checks before any deployment.
- [ ] Verify portal upload -> document record -> owned attempt -> OCR -> stage
  outcomes -> current fields -> staff review -> approved portfolio/invoice data.
- [ ] Verify progress, evidence links, partial warnings, and retries in the UI.
- [ ] Verify duplicate starts, late results, knowledge-only retry, failed-section
  recovery, deletion/replacement, and long-document processing under realistic timing.
- [ ] Verify tenant access and staff/client response boundaries on every changed API.
- [ ] Update owning DOX docs and relevant entries in `backend functionality.md`.
- [ ] Record reproducible verification evidence and any operational limits, including
  tested document sizes, page counts, processing duration, and extraction coverage.

Acceptance: all five scoped issues have passing regression checks and a demonstrated
application upload/review cycle. Successful flow-only self-tests are insufficient.

Verification evidence: pending.

## Production rollout checklist (separate from implementation phases)

- [ ] Obtain explicit deployment authorization and choose a sanitized pilot document.
- [ ] Confirm required credentials and services are available without exposing secrets.
- [ ] Apply additive schema/index changes first; keep compatibility for legacy records
  and already-running jobs, then deploy compatible Windmill and application changes.
- [ ] Preview Windmill sync with `npm run wmill:push -- --dry-run`; inspect the scoped
  diff before the authorized push. Preserve the existing folder scope.
- [ ] Regenerate/typecheck Convex through the documented production workflow and
  deploy authorized backend/frontend changes.
- [ ] Complete a production pilot upload, review, record update, and recovery check;
  record document/attempt/job references without private source content.
- [ ] Confirm rollback retains readable old records and rejects late incompatible results.
- [ ] Mark rollout complete only after the production pilot passes.

Partial rollout evidence (2026-10-12): the user explicitly requested production
deployment. Convex production `focused-malamute-656` accepted the additive schema
and functions with enabled typechecking and no index deletions. Windmill accepted
the app flow and `convert_document_to_markdown` update after a scoped dry run;
unrelated folders, variables, resources and other flows were excluded. The summary
contract and saved-parser recovery checks passed 10 and 3 tests. No production
pilot document or application recovery cycle has been verified; frontend deployment
remains pending Dokploy access, so the rollout checklist remains incomplete.
