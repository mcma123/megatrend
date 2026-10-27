# Cyphersoft Contract and Lease Signing — Execution Plan

## Objective and agreed decisions

Build a signing module inside Cyphersoft: prepare agreements, send individual email
invitations, let participants review/sign without permanent accounts, track activity,
and retain completed documents and verifiable evidence.

Current delivery: Phase 0 provisioning/review pack and Phases 1–10 technical implementation:
MFA-protected drafts/policies, content-bound approval contracts, guarded workflow
transitions, an independent checkpoint adapter, quarantined PDF uploads, malware/
static-content validation, ordered retained bundles, private verified previews,
field placement, participant/stage preparation, atomic internal approval/freezing,
encrypted notification delivery, durable delivery tracking, account-free email verification
the responsive signer portal with immutable submissions, and sealed/timestamped PAdES B-LT
finalisation with retained evidence, plus tracking, exceptions, monitoring, retention and a
two-key controlled release that ships closed, template/clause-based document generation, and
choice/conditional fields, scanned supporting uploads, in-person sessions and gated witnessing/
SMS/WhatsApp/advanced-signature options, reviewed portfolio applications and linked renewals,
independent operational approvals, internal payment requests, reports and private company handovers.
Real service/legal acceptance remains pending. Software deployment is recorded separately
below; no customer signing pilot, real invitation, external signature or finalisation
has been performed.

- Initial jurisdiction: South Africa. Initial production release: uploaded PDFs.
- Templates and generation follow the upload/sign release.
- Application: active `insightful-property-hub/`; company/business state: Convex;
  backend jobs: Windmill `f/signing/`; no signing authority delegated to Mastra.
- Resend handles email. Maintained cryptographic libraries and external certificate/
  timestamp services protect final PDFs. No custom cryptographic primitives.
- Unsupported legal categories are blocked pending review/advanced signing.
- A workspace `tenant` is a company, not a renter. Participants are separate records.
- Private, versioned MinIO signing storage must have retention controls and independent
  audit checkpoints. Existing OCR storage and document statuses remain separate.
- No automatic OCR/AI ingestion of signing files or automatic changes to lease records.

## Execution rules

- Work in phase order. Tick tasks only after implementation and relevant checks pass.
- Phase 0 external prerequisites gate production, not isolated development of Phases 1–4.
  Keep prerequisites open until documentary evidence and operational checks exist.
- Complete and verify the foundation before enabling dependent production features.
- Record commands/results, safe fixture references, limitations and blockers below.
  Never record keys, invitation tokens, OTPs, or private document contents.
- Track implementation separately from production. This implementation request does
  not authorize sending real invitations, buying services, or signing for participants.
- Read/update the applicable DOX contracts with each phase. Preserve unrelated work.
- Every phase records: implementation complete `[ ]`, acceptance passed `[ ]`,
  production rollout complete `[ ]` (or not applicable), evidence and blockers.
- New Windmill jobs belong in the user-approved `f/signing/`. Add only that explicit
  scope when jobs exist; never widen `wmill.yaml` to `f/**`. Dry-run before each sync.

## Permanent contracts

- Freeze the document/annexure bundle, field assignments, parties, signing order,
  consent version and approved terms before sending. Edits create a replacement.
- Each submission binds identity, role, authentication outcome, consent, exact
  presented version/hash, submitted values, explicit intent and server time.
- A platform PDF seal protects an artifact; it is not a participant certificate or
  an accredited advanced electronic signature.
- Read-only approved terms (rent/deposit etc.) are never participant-editable.
- `Completed` requires all artifacts to be durably stored and cryptographically
  validated. Failure stays `Finalising` with safe retry/reconciliation.
- Agreement status: Draft, Awaiting approval, Ready to send, Awaiting signatures,
  Partially signed, Finalising, Completed, Declined, Expired, Voided, Superseded.
- Track participant delivery, access, verification, consent and signing independently.
  Correction requests pause signing without pretending the agreement is completed.
- Lease active, fully signed, deposit paid and occupation authorised remain separate.

## Phase tracker

| Complete | Phase | Outcome |
|---|---|---|
| [ ] | 0 | Legal policy, external services and launch prerequisites |
| [ ] | 1 | State, company permissions, MFA and audit foundation |
| [ ] | 2 | Secure PDF ingestion and frozen bundles — implementation complete; live acceptance pending |
| [ ] | 3 | Staff preparation, fields, participants and approval UI — implementation complete; live acceptance pending |
| [ ] | 4 | Invitations, email delivery and account-free access — implementation complete; live acceptance pending |
| [ ] | 5 | Responsive signing portal — implementation complete; live acceptance pending |
| [ ] | 6 | Finalisation, evidence and integrity verification — implementation complete; live acceptance pending |
| [ ] | 7 | Exceptions, operations and first production release — implementation complete; acceptance, pilot and rollout pending |
| [ ] | 8 | Templates, clauses and document generation — implementation complete; legal wording, renderer provisioning and acceptance pending |
| [ ] | 9 | Advanced fields, authentication and participant workflows — implementation complete; SMS/WhatsApp/advanced providers not accepted (gated), witnessing legal approval and acceptance pending |
| [ ] | 10 | Portfolio automation and reporting — implementation complete; live service, browser and company handover acceptance pending |

## Phase 0 — Legal policy and production prerequisites

- [x] Prepare the legal/privacy/retention review and service provisioning pack at
  `insightful-property-hub/docs/signing-prerequisites.md` with explicit evidence owners.
- [x] Inspect signing configuration presence without exposing credentials; local and
  frontend production env inventories contain no signing/Resend configuration.
- [x] Generate a private, Git/Docker-excluded local 256-bit MFA keyring, with verified
  current-user-only Windows ACL. Do not overwrite existing keyrings or print keys.
- [ ] Configure/back up the MFA keyring in the Convex deployment secret manager and
  complete a real authorised administrator enrollment after deployment.

- [ ] Legal review: approved South African categories, consent, evidence, signing
  methods, witnessing, suretyships and excluded transactions; confirm current law.
- [ ] Approve privacy notice, retention, legal holds, correction rules, processors,
  hosting regions and cross-border transfers.
- [ ] Provision Resend and verified sender/reply-to domain, SPF/DKIM/DMARC.
- [ ] Provision certificate, protected key access, trusted timestamp endpoint,
  validation trust policy and certificate renewal/incident procedures.
- [ ] Provision encrypted private versioned signing storage, immutable backups,
  independent audit checkpoints and malware scanner.
- [x] Record administrator-attested policy references without treating draft policy
  configuration as legal certification or operational verification.
- [x] Register the execution plan and phase rules in root AGENTS.md.

Acceptance: documented approvals and operational evidence; unsupported categories
cannot be issued. Do not assert that configuration presence proves service health.

Implementation: [ ] Complete · Acceptance: [ ] Passed · Production: [ ] Complete

Evidence / blockers:
- Planning choices confirmed by the user: South Africa, upload/sign first, Resend and
  external certificate/timestamp services permitted, unsupported methods blocked,
  `f/signing/` approved. No accounts, certificates or legal approvals supplied yet.
- `signing.recordPolicy` records bounded company-scoped administrator attestations;
  `signing.readiness` lists policy/implementation/operational blockers and always
  returns `canIssue: false`. A complete test policy does not bypass release gates.
- Read-only Dokploy environment inventory and local inventory found no supplied
  signing/Resend configuration. This does not prove that no external service account
  exists; account ownership and legal/provider details were requested from the user.
- Local keyring created without logging key material; Git ignore and Windows ACL
  checks passed. It is also excluded by `.dockerignore`'s `.env.*` rule. No key was
  installed into production and no account, DNS, bucket or certificate was purchased.
- The independent checkpoint worker and generated dependency locks are prepared in
  `f/signing/`. Provisioning, live retention/deletion denial, backup restoration,
  legal sign-off and certificate/TSA trust acceptance remain external blockers.

## Phase 1 — Agreement state, permissions and audit foundation

- [x] Add additive agreement, revision, participant, policy and event schemas/indexes.
- [x] Enforce draft-only editing/cancellation, company relationships, optimistic
  revision checks and bounded/idempotent draft requests on the server.
- [x] Add the guarded state-transition model for approval/issue/submission/finalisation.
  Side-effectful issue/submission/finalisation endpoints remain in their later phases;
  no generic public status setter is permitted.
- [x] Use shared auth helpers. Initially only platform administrators change signing
  records; company staff can read only their own records; clients cannot browse
  signing evidence through ordinary portfolio permissions.
- [x] Support internal approval bound to the exact content revision and policy
  revision; editing either invalidates approval.
- [x] Add signing-specific staff TOTP MFA, protected enrollment, recovery codes and
  recent verification for privileged operations.
- [x] Add append-only signing events and bounded DB consistency verification.
- [x] Implement the independently retained checkpoint adapter, transactional outbox,
  verified receipts, bounded retry/ownership and direct-storage rollback checks.
  Live independently administered storage is still a Phase 0 acceptance gate;
  database-only checks continue to report unanchored status.
- [x] Gate issuing/external signing as unavailable; preserve portfolio behavior.
- [x] Test isolation, unauthorized writes, draft locks, stale edits, request replay,
  immutable history, relationship validation and audit/content integrity.
- [x] Test MFA, protected-checkpoint validation/rollback and approval invalidation
  with explicit synthetic fixtures; do not represent fixtures as live acceptance.
- [x] Add a reviewable staff draft workspace: create/edit/void drafts, prepare
  participants/stages, inspect history and display release blockers. This is not
  the Phase 3 PDF editor or the public signer portal.

Acceptance: all above checks pass; no path can issue an unverified agreement.

Implementation: [x] Complete · Live acceptance: [ ] Passed · Production: [ ] Complete

Evidence / remaining work (2026-10-26):
- `npm test`: **24 files / 197 tests passed**, including 30 signing-specific backend,
  MFA and isolated SSR checks. Covers mixed-role isolation, retry/stale-write locks,
  immutable revisions, authority/PDF/object-version/policy approval tampering, independent rollback
  detection, TOTP RFC vector, encrypted enrollment, replay/recovery, lockout, live
  session ownership and five-minute grant expiry.
- `python scripts/test-signing-checkpoints.py`: **9 offline storage checks passed**,
  including idempotency, encrypted/private/versioned COMPLIANCE storage, retained
  read-back, changed/expired objects, enumeration bounds and conflicting branches.
- Convex CLI code generation, final backend/frontend TypeScript, targeted frontend
  ESLint, `npm run build:web`, and `npm run build:mastra` passed. Latest checkpoint UI
  was confirmed present in both built client and server artifacts. Generated API/
  route bindings came from their normal generators. `git diff --check` passed.
- Added only OTPAuth 9.5.2 and its dependency to root npm manifests; CopilotKit,
  AG-UI, Mastra and Zod version pins are unchanged.
- Windmill generated script metadata/dependency locks. Signing-only dry run proposed
  **4 additions**, limited to the signing folder and worker files, with no deletion.
  Full-scope dry run found **37 existing changes**, including unrelated preview
  configuration deletion; it was not applied. Use signing-only includes for release.
- Browser setup failed (`Cannot redefine property: process`); no authenticated
  browser/mobile acceptance is claimed. The safe synthetic tests are not a substitute
  for real MFA enrollment, independently administered storage/restore acceptance,
  legal sign-off, or the Phase 2 PDF-worker integration (verified separately below).
- Phase 1 code is complete; overall phase completion remains unchecked until live
  prerequisites/acceptance pass. Phase 0 actual approvals/provisioning remain open.
  No production deployment, real email, service purchase or policy attestation was
  performed. User-owned Docling Python cache changes were preserved.

## Phase 2 — Secure PDF ingestion and frozen document bundles

- [x] Upload agreements and PDF annexures; company required, property/lease optional.
- [x] Quarantine pending real content validation and malware scan; fail closed.
- [x] Reject corrupt/encrypted PDFs and existing digital signatures requiring
  preservation; create stable approved renditions without unsupported active content.
- [x] Record page dimensions/rotation, exact artifact versions and SHA-256 hashes.
- [x] Store ordered bundle manifests and immutable prepared files separately from drafts.
  Issuance remains in later phases; preparation does not mark a document sent or signed.
- [x] Enforce size/page/time limits and safe worker fetch/output handling.

Acceptance: rejected files never reach signers; hashes and manifests identify every
issued byte; no annexure can be silently replaced.

Implementation: [x] Complete · Acceptance: [ ] Passed · Production: [ ] Complete

Phase 2 verification (2026-10-26):

- Root `npm test`: **25 files / 219 tests passed**, including upload/source-version
  ownership, MFA/company denial, ordered-file validation, job reconciliation,
  stale/duplicate/voided results, tampered manifest/snapshot/page evidence, expired
  retention and quarantined/read-only/signed-out UI boundaries.
- `python scripts/test-signing-pdfs.py`: **17 offline checks passed** with
  `pypdf==6.21.2`, `rfc8785==0.1.4` and synthetic reportlab fixtures. Separate test
  environment: `C:/Users/HP22/.cache/signing-pdf-venv/Scripts/python.exe`.
  Checks cover corrupt/encrypted/signed/active PDFs, mixed geometry/crop/rotation,
  scan-before-parse/output scan, ClamAV framing/freshness/errors, conditional protected
  storage, partial-write recovery, version/hash tampering and upload-policy limits.
- `python scripts/test-signing-checkpoints.py`: **9 offline checks passed**.
- Convex codegen/backend TypeScript, frontend TypeScript, targeted frontend ESLint
  and `npm run build:web` passed. No dependency versions for CopilotKit/Mastra changed.
- Synthetic primary/annexure PDFs rendered with PyMuPDF after preparation:
  **both pages pixel-identical to their source renders**, including rotation and
  differing page sizes. Fixture images inspected locally; no client contracts used.
- Windmill metadata and pinned dependency lock generated. Signing-only dry run:
  **7 additions, no deletions**. No real push, Convex runtime deployment, frontend
  deployment, invitation, production upload or signing was performed.

Remaining Phase 2 acceptance/rollout gates:

- Provision dedicated HTTPS private encrypted/versioned quarantine/frozen storage,
  COMPLIANCE retention, approved retention policy, CORS, restricted operator access,
  maintained Unix/TLS ClamAV, Linux worker isolation and separate scoped token.
  Exact resource/env inputs and live checks are in
  `insightful-property-hub/docs/signing-prerequisites.md`.
- Run real synthetic clean/EICAR/outage/stale-signature tests, version-pinning and
  retention/deletion-denial checks, interrupted uploads, ambiguous-job recovery,
  concurrent edits, backup restore and authenticated desktop/mobile PDF preview.
- Prior browser tooling initialization failed (`Cannot redefine property: process`);
  SSR and raster fixtures do not replace authenticated browser acceptance.
  Phase 0 legal/service acceptance and later external-signing release gates remain open.

## Phase 3 — Preparation, participants and approval screens

- [x] Agreement dashboard, creation wizard, PDF field editor, participant editor,
  approval screen and agreement progress/activity page.
- [x] PDF.js pages with draggable/resizable/keyboard-accessible fields; normalized
  page-relative geometry and explicit crop/rotation transforms.
- [x] Signature, initials, full name, signing date, text, numbers and checkboxes.
- [x] Required/optional, validation, read-only, assignment, repeat-initials and preview.
- [x] Ordered stages of parallel participants support sequential/parallel/mixed flows.
- [x] Separate signer/approver/viewer/copy responsibilities from descriptive party roles.
- [x] Validate preparation, legal category and approval before atomically freezing.

Acceptance: exact placement across mobile/zoom/rotation/mixed page sizes; no field
ownership bypass; incomplete or stale preparation cannot be issued.

Implementation: [x] Complete · Acceptance: [ ] Passed · Production: [ ] Complete

Phase 3 verification (2026-10-26):

- Root `npm test`: **28 files / 260 tests passed**. Coverage includes company/MFA
  isolation, field ownership/types/constraints, immutable layouts, stale edits/review
  hashes, missing signatures, mixed participant stages, unsupported categories,
  self-approval denial and successful approval by another authorized administrator.
  Approved snapshots are bound to decision actor/reason/time and the audit event;
  missing or altered decisions, layouts, geometry or snapshots invalidate approval.
- **80 comparisons against actual PDF.js** passed for a synthetic cropped PDF with
  `/UserUnit: 2`, four rotations and four zoom levels. Pure tests also cover responsive
  coordinate round trips, keyboard/pointer boundary clamping, physical size limits
  and repeat-initials page selection. Node uses PDF.js's compatibility build and its
  installed native-canvas bindings; this is geometry verification, not browser UX acceptance.
- Frontend SSR checks cover phase/stage presentation, distinct read-only recipients,
  review/self-approval gates, company staff controls, quarantine and signed-out isolation.
- Convex codegen/backend TypeScript, frontend TypeScript, targeted frontend ESLint,
  `npm run build:web` and `git diff --check` passed. CopilotKit/Mastra versions and
  dependency manifests were not changed by this phase.
- No Windmill assets or worker contracts changed. Phase 2 scanning/retention/live
  setup prerequisites still apply. No runtime deployment, push, real approval,
  invitation or signature was performed.
- DOX updated for Convex, frontend/signing ownership and the frontend child index.
  Root operating rules, Windmill/OCR/Mastra docs and route ownership docs were left
  unchanged for this phase because their workflows, routing and boundaries did not change.

Remaining Phase 3 acceptance/rollout gates:

- The browser connection again failed during initialization (`Cannot redefine
  property: process`). Run authenticated desktop/mobile interaction checks for the
  wizard, property/lease choices, touch/pointer/keyboard drag/resize, zoom, rotated/
  mixed-size pages, signer preview, repeated initials, stale-context reload, MFA
  expiry and private-preview cleanup. Unit/SSR/PDF.js checks do not claim this acceptance.
- Provision and verify the Phase 0/2 services and policies before live use; verify
  the complete upload → prepare → place fields → second-admin approval → return-to-
  draft journey with authorized synthetic fixtures. Coordinate backend deployment
  before frontend rollout so the new API surface exists when the screens are released.
- External invitation release, signature submission and cryptographic finalisation
  remain gated by later release phases. `canIssue: false` remains enforced.

## Phase 4 — Invitations, delivery and secure access

- [x] Branded invitation/reminder/correction/decline/completion emails via Windmill.
  Templates and state guards are ready; decline/completion triggers depend on Phases 5/6.
- [x] Separate high-entropy expiring invitation credentials, hashed at rest.
  A bounded, short-lived encrypted mail outbox transports links/codes to Windmill;
  acceptance/rejection/expiry clears ciphertext. No plaintext credentials in job arguments/results.
- [x] Email OTP followed by revocable, short-lived secure signer sessions.
- [x] Protect links from logs/referrers/analytics/third-party assets; scrub immediately on arrival.
- [x] GET/email scanners never consume invitations, accept consent or sign.
- [x] Rate limits, resend cooldowns, OTP limits, expiry/revocation on every operation.
- [x] Raw-body signed Resend webhooks, event deduplication and durable delivery ledger.
- [x] Reconcile ambiguous sends; provider idempotency alone is not permanent deduplication.
- [x] Require disabled email pixel/click tracking before each send; distinguish delivery
  from verified portal use. Actual sender-domain settings still require provisioning/acceptance.

Acceptance: forwarding still requires verification, revocation/expiry fail closed,
retries and webhook replay create no duplicate agreement/delivery state.

Implementation: [x] Complete · Acceptance: [ ] Passed · Production: [ ] Complete

Evidence / release boundaries:
- `signingInvitations.*`, `signingAccess*`, `signingDeliveries.*` and
  `signingDeliveryEvents.*` implement frozen transaction/stage binding, invitation
  versions, protected external actor events, OTP/session state and durable delivery.
  Staff reads are company-scoped and redacted; administrator controls require recent MFA.
- `f/signing/deliver_email.py` uses official maintained cryptography/requests libraries
  with generated pinned metadata. Envelopes bind delivery UUID/kind via HKDF/AES-GCM.
  Domain preflight requires exact verified sender and tracking disabled; provider
  acceptance has no document-view/signature implication. Reconciliation never sends
  again merely because a job timed out or Resend's 24-hour key retention elapsed.
- `/sign` serves standalone private HTML/local JavaScript outside the application
  shell; `/api/signing` owns scoped Secure/HttpOnly/SameSite=Strict cookies, origin
  checks, server-only service authentication and configurable trusted proxy hops.
  No platform account, assistant, telemetry or external fonts are loaded. Verification
  is mailbox access only; no document submission, consent or signature exists yet.
- New issuance/reminder/reissue entry points and commit mutations remain hard-blocked
  by `SIGNING_ISSUANCE_ENABLED = false` until Phase 7. Synthetic fixtures exercise
  the unregistered issuance helper, not a production or environment bypass. Existing
  invitation revocation, delivery reconciliation and verification check actual state.
- Local verification (2026-10-26): root `npm test` passed **31 files / 298 tests**,
  including 38 new access/delivery/proxy/ledger checks. Fixed synthetic time keeps
  rate-window tests independent of wall-clock quarter-hour boundaries. Offline
  Python checks passed **13 mail + 9 checkpoint + 17 PDF** tests; mail checks include
  actual Web Crypto-to-Python envelope interoperability with synthetic payloads.
- Convex code generation and backend/frontend TypeScript passed. Production web and
  Mastra builds passed separately from regression tests. Changed frontend source
  ESLint passed; full-repository lint remains blocked by existing CRLF/formatting
  and unrelated lint errors. No broad formatting or unrelated source cleanup was applied.
- Built local HTTP smoke checks: `/sign` returned standalone 200 HTML with no-store,
  no-referrer, restrictive CSP and local-only script; `/api/signing` anonymous GET
  returned `{ok:false}` without a backend action; local bootstrap returned 200.
- Generated pinned Windmill metadata and signing-only dry run passed: **10 additions,
  zero deletions**, exclusively `f/signing/**`. No real email, new signing secret/
  resource, DNS change, backend/frontend deployment, commit or Git push was performed.
- Live sender/domain/proxy/webhook/key configuration and authorised delivery/bounce/
  forwarding/reissue/device tests remain pending. Browser connection failed before
  page navigation (`Cannot redefine property: process`); desktop/mobile visual and
  interaction acceptance remains open. Phase 0 legal/storage/certificate prerequisites
  and Phase 5/6 signing/finalisation acceptance still gate production.

## Phase 5 — Responsive signing portal

- [x] Extend Phase 4's hardened account-free route into the full signing journey,
  keeping it outside staff/company membership layouts.
- [x] Branding/contact, title/role, full agreement/annexures, zoom/navigation/download.
- [x] Versioned consent, required-field navigation, remaining count and progress.
- [x] Drawn/typed/uploaded signatures and initials; sanitized images only.
- [x] Transaction-only reuse; explicit preview/confirmation before Initial all.
- [x] Save/resume, reconnect recovery and concurrent draft edit handling.
- [x] Review then explicit Finish and sign; decline reason and correction request.
- [x] Server-check session/version/stage/expiry/consent/fields on immutable submission.
- [x] Idempotent duplicate submissions and safe simultaneous signers.

Acceptance: opening/drawing/saving is never signing; double-clicks/retries create one
accepted event; interruption cannot lose an accepted signature or complete falsely.

Implementation: [x] Complete · Acceptance: [ ] Passed · Production: [ ] Complete

Phase 5 verification (2026-10-26):

- Backend: `convex/signerPortal.ts` (internal functions behind the service-token
  `/signing/access` boundary), `convex/signerMarks.ts` (Node PNG rebuild with CRC and
  exact inflate checks), `convex/lib/signerPortal.ts`, and additive tables
  `signingConsents`, `signingDrafts`, `signingMarks`, `signingSubmissions`; additive
  transaction statuses `declined`/`signed`, optional `signingInvitations.completedAt`
  and optional policy `signerContact`. Only an active verified session writes; outcomes
  are immutable, hash-chained events with external signer actors. The last stage
  moves the agreement to `finalising`, never `completed`; decline → `declined`;
  correction → transaction `paused` only.
- Frontend: `/sign` now continues into `public/signing-portal.js`; `/api/signing` adds
  session-cookie-only signer operations, per-operation body limits, `?view=portal` and
  verified PDF streaming (server-side SHA-256 against the frozen hash; storage URLs never
  reach the browser). CSP adds only `'wasm-unsafe-eval'`, `worker-src 'self'` and
  `img-src data: blob:` for local PDF.js decoders and signature previews. Staff ledger
  shows participant outcomes/reasons; the policy form records signer contact details.
- Root `npm test`: **32 files / 316 tests passed**, including 13 new `signerPortal.test.ts`
  checks (redaction, bundle-bound links, consent-before-entry, draft conflicts and
  ownership, PNG metadata stripping and malformed rejection, server-side field
  validation, version/consent/draft tampering, concurrent double submission → one
  submission/event, parallel stage-1 signers → stage-2 invitation → finalising, decline,
  correction pause, revocation and session expiry) and 5 new proxy checks.
- Convex codegen/backend TypeScript, frontend TypeScript, changed-source ESLint/Prettier,
  `node --check` of both public scripts, `npm run build:web` and `git diff --check` passed.
  `IMPLEMENTATION_BLOCKERS` no longer lists participant review/consent/submission.
- Synthetic browser run (headless Chrome via CDP against the real `/sign` HTML/CSP and
  real public scripts/PDF.js, with a mocked `/api/signing` and generated two-page PDF,
  page 2 rotated 90°): consent gate, PDF render/verify, rotated overlay placement,
  pointer-drawn and typed adoption, inline validation, Initial all confirmation,
  autosave, review gate and a double-clicked Finish producing **one** submit call;
  390 px mobile layout had no horizontal overflow and no CSP violations. This used no
  real backend, session, storage or email and is not authenticated acceptance.
- No Windmill assets changed. No deployment, push, real invitation, signature or
  production data access was performed.

Remaining Phase 5 acceptance/rollout gates:

- Deploy additive Convex schema/functions before the frontend; confirm the portal
  server reaches signing storage HTTPS links and `WINDMILL_SIGNING_DOCUMENTS_TOKEN`
  download works for frozen bundles.
- Authenticated desktop/mobile/touch/keyboard/screen-reader acceptance with real
  synthetic agreements: interrupted networks, two-tab conflicts, expiry mid-entry,
  reissue/revocation during signing, large/mixed-size/rotated bundles and uploads.
- Stage-activation failures (e.g. missing keys) currently need operator retry of
  `signerPortal:activateStage`; monitoring/alerting and correction resume/replacement
  belong to Phase 7. Finalisation (Phase 6) and Phase 0/2/4 service and legal gates
  still block production; `SIGNING_ISSUANCE_ENABLED` remains false.

## Phase 6 — Finalisation, evidence and integrity

- [x] Atomically claim finalisation after all required submissions/approvals exist.
- [x] Compose completed PDFs with accepted values and server signing timestamps.
- [x] Completion certificate and structured evidence manifest: versions/hashes,
  identity/roles/authentication, consent, submissions, audit checkpoints and metadata.
- [x] pyHanko platform seal, trusted RFC 3161 timestamp, PAdES B-LT validation material.
- [x] Cryptographically bind evidence to the sealed PDF or sealed evidence manifest.
- [x] Validate chain/timestamp/permitted changes/hashes before durable publication.
- [x] Remain Finalising on failure; bounded retries, attempt ownership, reconciliation.
- [x] Authorized downloads/verification and certificate renewal/archive procedures.

Acceptance: tampering fails verification; certificate/TSA/worker/storage failures
cannot produce Completed; retries cannot publish competing final artifacts.

Implementation: [x] Complete · Acceptance: [ ] Passed · Production: [ ] Complete

Phase 6 verification (2026-10-26):

- Worker `f/signing/finalise_agreement.py` (`finalise`/`download`/`verify`) with fixed
  resources `f/signing/document_storage` and new `f/signing/platform_seal`; pinned lock
  generated by `wmill generate-metadata` (pyHanko 0.38.0, pyhanko-certvalidator 0.33.0,
  pypdf 6.21.2, reportlab 5.1.0, pillow 13.0.0). Composition draws accepted values in the
  frozen crop/rotation system, appends a completion certificate and binds the evidence
  manifest SHA-256 into the signed revision; the seal is certified (no changes), RFC 3161
  timestamped and B-LT (DSS revocation data). Validation uses only embedded material with
  fetching disabled before any retained write; the record is written last (idempotency).
- Convex: `lib/signingFinalisation.ts`, `signingFinalisation.ts`, tables
  `signingFinalisations`/`signingCompletions`, optional agreement pointers, separate
  `WINDMILL_SIGNING_FINALISE_TOKEN`. Claim re-verifies every accepted submission hash;
  the evidence digest includes the attempt identity. Only the current attempt/job can
  publish after strict result validation; failures stay Finalising, transient codes retry
  three times, others need admin+MFA retry; ambiguous jobs are reconciled, never resubmitted.
  Last-stage completion starts finalisation in a separate transaction.
- Signer access: one read-only rule lets completed participants (and paused transactions)
  refresh/re-verify; completed signers/approvers can download the verified sealed copy for
  at least 14 days after completion. This also fixes a Phase 5 gap where refreshing after
  submitting returned to the start screen.
- Staff: **Finalisation and evidence** card (attempts, errors, seal/timestamp facts, hashes,
  SHA-256-verified download, read-only **Verify integrity**); portal shows finalising state
  and the sealed-copy link; proxy `?view=final` streams only hash-verified bytes.
- `python scripts/test-signing-finalise.py`: **12 offline checks passed** (synthetic PKI,
  dummy TSA, fake retained storage): B-LT seal/trust/timestamp, evidence binding, Convex
  `canonicalJson` ⇔ RFC 8785 hash parity (exponents, `-0`, non-ASCII, U+2028, emoji),
  rotated-page composition, Unicode font policy (no substitution), idempotent retry,
  PDF/evidence/record tampering, post-seal content change, wrong binding/page count, TSA
  outage, untrusted and mismatched certificates, source/mark tampering, storage outage.
  Rendered output inspected: values/marks placed correctly, upright text on a 90° page.
  Existing offline suites: 17 PDF, 9 checkpoint, 13 email checks passed.
- Root `npm test`: **33 files / 327 tests passed** (7 new Convex finalisation tests,
  4 new staff-card SSR tests, proxy sealed-copy test). Convex codegen/backend TypeScript,
  frontend TypeScript, changed-source ESLint/Prettier, `npm run build:web`,
  `npm run build:mastra` and `git diff --check` passed.
- Signing-only Windmill dry run: **13 additions, zero deletions**, exclusively
  `f/signing/**`. No push, deployment, real certificate, TSA call, storage write,
  invitation or signature was performed.

Remaining Phase 6 acceptance/rollout gates:

- Provision a document-sealing certificate (and decide HSM/remote-signer requirements;
  the worker currently reads a PEM key from the secret resource), an approved RFC 3161 TSA,
  OCSP/CRL reachability, `f/signing/platform_seal` and `WINDMILL_SIGNING_FINALISE_TOKEN`.
- Live synthetic acceptance: independent validators (Acrobat, pyHanko CLI) accept the
  seal, chain, timestamp and embedded revocation data; outage/denial journeys stay
  Finalising; retained-object retention and version pinning confirmed; staff verification
  passes; mobile/desktop signer download works.
- Not automated yet: PAdES-LTA archive timestamps before certificate expiry, completion
  emails/copies for viewers and copy recipients, and finalisation monitoring/alerts
  (Phase 7). Linux resource limits for composition are not isolated in a subprocess as
  preparation parsing is; inputs are already sanitized, but review this before release.
- Phase 0 legal/provider prerequisites and Phase 7 release gates still block production;
  `SIGNING_ISSUANCE_ENABLED` remains false.

## Phase 7 — Tracking, exceptions, operations and first release

- [x] Filters, progress, activity timeline, deadlines and actionable delivery failures.
- [x] Remind outstanding eligible participants only.
- [x] Decline, void, expiry, correction pause and replacement preserve earlier evidence.
- [x] Revoke old access; require reason/authorization for authority/signer changes.
- [x] Monitoring for stuck/ambiguous jobs, sanitized logs, alerts and incident runbooks.
- [ ] Configurable retention/legal holds/deletion and tested backup restoration.
  Retention, holds and purge are implemented; a real backup restoration test is pending.
- [ ] Security review plus authenticated desktop/mobile acceptance.
  Code security review done and fixed (below); authenticated acceptance is pending.
- [ ] Company allowlist, synthetic end-to-end pilot, then controlled real rollout.
  Allowlist/two-key release implemented; pilot and rollout are pending.
- [ ] Record production evidence separately. First release requires Phases 0–7.

Acceptance: upload → approve → invite → verify → sign → finalise → download plus
every failure/exception journey demonstrated; launch prerequisites all verified.

Implementation: [x] Complete · Acceptance: [ ] Passed · Production: [ ] Complete

Phase 7 verification (2026-10-27):

- Release gate (`lib/signingRelease.ts`, `signingRelease.ts`) replaces the hard-coded switch:
  deployment `SIGNING_RELEASE_MODE` (`pilot`/`live`, else off) AND an unsuspended company
  release record with legal/acceptance evidence references (admin+MFA) AND complete policy and
  category AND configured services; pilot mode allowlists every recipient (public mailbox
  domains rejected). Checked at issue, reissue, reminder, stage activation and again at send
  time for every queued message; suspension holds later stages and raises an alert. Ships
  closed: no deployment key or release record exists.
- Issue/reissue/remind/revoke/delivery reconciliation require platform admin + tenant writer
  + recent MFA. Reminders: current-stage signers/approvers only, 24-hour interval, no
  unresolved delivery; bulk "remind all outstanding".
- Exceptions (`signingExceptions.ts`): void approved/issued agreements, bounded deadline
  extension (≤30 days), scheduled expiry (15-minute cron), resume after correction,
  replacement drafts with two-way links (open agreements become Superseded), held-stage
  resumption, legal holds. Every action needs a reason, appends signing events and keeps
  submissions/evidence.
- Operations (`signingOperations.ts`): 30-minute scan raising PII-free alerts with admin
  notifications and automatic resolution; daily transient-data retention purge (policy
  30–3650 days, default 90) blocked by legal holds. No logging exists in signing code paths.
- UI: register progress/deadline/needs-attention filter and counts; gated "Release
  invitations" with deadline and confirmation; release panel; operations alerts; exceptions
  card; actionable delivery-failure guidance; policy retention setting.
  Runbook: `insightful-property-hub/docs/signing-operations.md`.
- Independent code security review: no critical/high findings. Fixed: (M) release gate not
  applied to OTP and already-queued mail → send-time gate; (M) unset trusted-proxy hops
  collapsed all signers into one rate bucket → portal refuses to operate until configured;
  (L) category not checked on reissue/reminder/stage → passed; (L) email worker held master
  keys → resource now holds only derived envelope keys (`scripts/derive-signing-envelope-keys.mjs`);
  (L) bounce/failure events showed "accepted" → new `failed` status that later events cannot
  mask. Also fixed: session checked before signature-image processing, pilot recipients shown
  only to platform admins, decline mail status mismatch.
- Root `npm test`: **34 files / 348 tests passed** (Phase 7 backend, send-time gate, failure
  status, proxy configuration and new component tests). Offline Python: 13 email (derived-key
  contract, Node/Python key derivation cross-checked), 12 finalisation, 17 PDF, 9 checkpoint.
  Convex codegen/backend TypeScript, frontend TypeScript, changed-source ESLint/Prettier,
  `npm run build:web` and `git diff --check` passed. Signing-only Windmill dry run:
  13 additions, zero deletions.

Remaining Phase 7 acceptance/rollout gates:

- Open review items needing a decision: first-time MFA enrolment needs only an admin session
  (enrol in a controlled ceremony, or require an out-of-band step); a single administrator can
  record their own release (consider a second approver); per-token rate limiting beyond the
  network bucket.
- Configure `SIGNING_TRUSTED_PROXY_HOPS` and derived `envelope_keys` before any pilot.
- Backup restoration test, authenticated desktop/mobile acceptance, synthetic end-to-end pilot
  and every exception journey against deployed services (runbook "First release procedure").
- Phase 0 legal/provider approvals and Phase 2/4/6 live acceptance remain prerequisites.
  No deployment, push, release record, invitation or real signature was made.

## Production rollout

No customer signing pilot or live rollout has been performed. Record each entry as: date,
company, mode, release revision, operator, evidence reference, outcome (no personal data or credentials).

Software deployment (2026-10-27, explicitly requested by the user):

- Company: platform software only; signing mode: **off** (no signing environment configuration).
  Release: signing phases 1–10; operator: authorised Codex deployment using the existing profiles.
- Convex production `focused-malamute-656`: dry run and typecheck passed, functions/schema
  deployed, 12 additive Phase 10 indexes added, no index deletions. Normal generated bindings
  from deployment are committed with the source.
- Windmill `cyphersoft`: signing-only dry run/push using `--includes 'f/signing/**'`:
  six scripts and the signing folder, 19 added files, zero deletions. Reviewed scoped pull
  preserved server-assigned folder ownership, explicit `has_on_behalf_of: false`, and the
  server-resolved finalisation `wmill==1.850.0` dependency (cryptographic/parser pins unchanged).
  Follow-up signing-only push dry run reports **zero changes**.
- Frontend delivery uses the release commit pushed to GitHub `main`, which auto-deploys
  `cyphersoft-ai` in Dokploy. The previous deployment was confirmed healthy and idle before
  pushing; Dokploy's deployment history records the build outcome and exact commit.
- No signing resource, sender, certificate, renderer service, token, policy/release record
  or live workflow was provisioned or activated. Earlier phase verification records describe
  the pre-deployment implementation state; all live acceptance/pilot gates remain open.

## Phase 8 — Template and clause library

- [x] Residential/commercial/month-to-month/renewal/general template library.
  Starter structures only; clause wording is a marked placeholder pending legal review.
- [x] Tiptap open-source editing: headings/tables/formatting/page breaks/layout.
- [x] Approved versioned clauses, merge fields, conditional sections, multiple parties.
- [x] Populate approved portfolio facts; explicitly collect missing renter/unit/owner data.
- [x] Decimal-safe rent/deposit/charges/escalation/payment/tax schedules.
- [x] Validate missing fields/dates/schedules; preview deterministic Gotenberg PDFs.
  HTML preview in the app; PDF preview through the normal scanned bundle preview after generation.
- [x] Preserve input/template/clause/renderer versions and annexure selections.

Acceptance: historical agreements reproducible; template edits never mutate issued files.

Implementation: [x] Complete · Acceptance: [ ] Passed · Production: [ ] Complete

Phase 8 verification (2026-10-27):

- Backend: `lib/signingTemplates.ts` (closed Tiptap-compatible schema, merge catalog, integer-cent
  schedules, deterministic escaping HTML renderer `cyphersoft-template-html-v1`),
  `lib/signingTemplateStarters.ts` (five placeholder structures and four placeholder clauses),
  `signingTemplates.ts` (libraries, immutable approved versions, second-administrator approval
  with legal reference, clause pinning, preview with fact provenance, generation, completion,
  supersession, reproduction) and tables `signingTemplates`, `signingTemplateVersions`,
  `signingClauses`, `signingClauseVersions`, `signingGenerations`.
- Worker `f/signing/render_template.py` (pinned lock: pypdf 6.21.2, requests 2.34.2) and
  `docker-compose.signing-renderer.yml` (separate private Chromium-only Gotenberg, no JavaScript
  or network). Generated PDFs enter quarantine and the unchanged scan/preparation pipeline.
- Frontend: pinned Tiptap 3.32.0; `template-schema.ts`/`template-editor.tsx`,
  `signing-templates.tsx` (Templates & clauses tab), `signing-generate.tsx` (draft generation,
  sandboxed preview, provenance, explicit missing data, schedule editor, history and
  reproducibility check).
- Tests: root `npm test` **37 files / 363 tests passed** (9 template backend tests including
  exact escalation/VAT rounding, closed schema/escaping, second approver and clause pins,
  provenance/blockers, generation/supersession/failure, reproduction after template and portfolio
  changes; Tiptap-schema compatibility including all starters; library/generation panels).
  `python scripts/test-signing-render.py`: **6 offline checks passed** (byte-identical output
  across converter timestamps/IDs, write-once storage, hash/active/external content rejection,
  limits, converter configuration). Convex codegen, both TypeScript projects, changed-source
  ESLint/Prettier, `npm run build:web`, `npm run build:mastra` and `git diff --check` passed.
  Signing-only Windmill dry run: 16 additions, zero deletions.
- No deployment, push, template approval, real rendering or generated agreement was made.

Remaining Phase 8 acceptance/rollout gates:

- Legal reviewer supplies and approves real template and clause wording (starters are
  placeholders); confirm residential/commercial content against current South African law.
- Provision the signing renderer compose, `f/signing/template_renderer` and token scope; verify
  Gotenberg flags, network isolation and byte-identical repeat renders with the real renderer.
- Authenticated editor acceptance (keyboard, tables, page breaks, long documents) and printed
  layout review of generated PDFs; Unicode font coverage in the renderer image.
- Phase 0 and Phase 7 release gates still apply before generated agreements are sent.

## Phase 9 — Advanced fields and participant workflows

- [x] Radio/dropdown/conditional fields with server-validated conditions.
- [x] Restricted supporting uploads, malware scanning and purpose-based access.
- [x] Identified in-person sessions without staff impersonation.
- [x] Legally approved witnessing, SMS invitations/OTP and opt-in WhatsApp integration.
  Witnessing is implemented and blocked until the policy records a legal approval reference.
  SMS and WhatsApp are provider-neutral and gated: participants can carry an E.164 number,
  channel choice and (WhatsApp) opt-in reference, but approval is blocked because no provider is
  accepted; email remains the only delivery and OTP channel.
- [x] Accredited advanced signing only after provider/legal acceptance.
  Drafts can request an accredited advanced signature; approval is blocked until a provider is
  accepted. No advanced signature is produced and the platform seal is never presented as one.

Acceptance: each method passes identity/consent/authority/failure/evidence checks;
existing version policies cannot be weakened by later configuration changes.

Implementation: [x] Complete · Acceptance: [ ] Passed · Production: [ ] Complete

Phase 9 verification (2026-10-27):

- Fields: `radio`/`dropdown` options, one-level `showIf` conditions and `attachment` fields with a
  declared purpose (`lib/signingFields.ts`); hidden fields are neither required nor recorded on the
  server (`lib/signerPortal.ts`); conditional signatures never satisfy the required signature.
- Participants: `witnessFor`, `phone`, `notifyVia`, `whatsappOptInReference`, draft
  `signatureMethod`, policy `witnessingReference`; `methodBlockers` gate witnessing, SMS, WhatsApp
  and advanced signatures. Absent new fields keep earlier draft/participant hashes unchanged.
  Frozen preparations snapshot these fields, so later configuration changes cannot alter issued
  transactions.
- In-person: `signingInPerson.start` (admin+MFA, document type and last 2–4 characters only,
  attestation) issues a 15-minute single-use kiosk credential; `kiosk_exchange` still sends the
  OTP to the participant's mailbox; sessions and evidence record `in_person_email_otp` and the
  check; the certificate prints it.
- Supporting uploads: same-origin byte upload through the portal server, quarantine form,
  type-before-scan, ClamAV, retained COMPLIANCE copy (`prepare_bundle.py` attachment operations),
  attachment hashes bound into submission evidence, staff metadata list and reason-logged
  60-second access (`signingAttachments.ts`). No OCR or assistant access.
- Tests: root `npm test` **38 files / 374 tests passed** (`signingAdvanced.test.ts`, 7; three
  end-to-end portal workflow tests; proxy attachment forwarding). Python:
  `test-signing-pdfs.py` **21 passed** (4 attachment), `test-signing-finalise.py` **13 passed**
  (witness certificate), checkpoints 9, email 13, render 6. Convex codegen, both TypeScript
  projects, changed-source ESLint/Prettier, `npm run build:web`, `npm run build:mastra` and
  `git diff --check` passed. Signing-only Windmill dry run: 16 additions, zero deletions;
  metadata refreshed with the reviewed dependency locks unchanged.
- No deployment, push, invitation, upload, in-person session or signature was made.

Remaining Phase 9 acceptance/rollout gates:

- Legal approval of witnessing (and recording its reference) before any witnessed agreement.
- Select and accept SMS, WhatsApp (with opt-in/template approval) and accredited advanced
  signature providers before implementing their sending/signing adapters; until then they remain
  blocked by design.
- In-person acceptance: staff identity-check procedure, kiosk device handling, and POPIA review
  of recording document type and ending.
- Supporting documents: live quarantine/retention/scan checks for the `attachments*` prefixes,
  purpose/access review and retention policy for supporting documents.
- Authenticated browser/mobile acceptance of choice, conditional and upload controls.

## Phase 10 — Portfolio automation and reporting

- [x] Explicit company/property/lease/owner/renter/unit relationships, additive records.
- [x] Reviewed lease-register application and linked amendments/renewals.
- [x] Approved payment requests, renewal reminders, move-in tasks and staff notices.
- [x] Signed/active/paid/occupation states independent; durable downstream idempotency.
- [x] Completion/turnaround/outstanding/delivery reports and company departure exports.

Acceptance: duplicate events create no duplicate leases/payments/tasks; signing never
implicitly activates leases or authorizes occupation.

Implementation: [x] Complete · Acceptance: [ ] Passed · Production: [ ] Complete

Phase 10 verification (2026-10-27):

- Additive `portfolioParties`/`portfolioUnits`, optional revision-hashed `portfolioContext`,
  immutable `signingApplications`, `signingPayments`, application-bound `signingLeaseDecisions`,
  permanent `signingEffects` and owned `signingExports`. Existing absent-context hashes remain
  compatible. Draft/return/replacement paths preserve context and earlier participant options.
- `signingPortfolio.ts`: admin+MFA application of completed agreements after exact hash-bound
  preview, raw request replay binding and stale-target rejection. New leases/renewals are pending;
  amendments retain prior values. Renewal activation retires its linked predecessor and rejects
  overlapping active leases for the unit. Activation/occupation each bind the current application
  and require separate reasons; ordinary lease/clauses/archive and OCR application cannot bypass
  the review. Payments are staff-evidenced internal ZAR requests, with no provider or money movement.
- Validated finalisation publication atomically creates one internal review task and staff notice.
  Application effects and permanent receipts share a transaction, including payments/move-in tasks;
  closing a task never makes it eligible for replay. Existing renewal cadence starts only for live
  leases and respects the reviewed reminder choice.
- `signingReports.ts`: indexed, company/date-cohort aggregation across pages, median issuance-to-
  completion, outstanding required participants and separate delivery/verification facts. Current
  outcomes are labelled explicitly; limits fail instead of returning partial totals.
- `signingExports.ts` + `f/signing/export_company.py`: one transactional redacted metadata snapshot,
  atomic submission claim/reserved job ID, read-only unknown-job reconciliation, exact pinned
  source/bundle/manifest/attachment/completion versions/hashes, accepted-version image checks,
  deterministic retained write-once ZIP volumes, JSON/CSV with formula protection, hash manifest
  and receipt written last. Private 60-second downloads require fresh admin MFA, are audited,
  abort on unmount/MFA changes and verify SHA-256 before saving. No data/hold deletion.
- Staff UI: **Portfolio application** and company **Portfolio & reports**; real Convex data,
  explicit participant representation, pinned-generation suggestions, before/after review,
  separate operational/payment controls, report totals and export progress/reconciliation.
- Root `npm test`: **40 files / 389 tests passed**. New Phase 10: 11 backend tests and 4 SSR tests;
  focused report coverage also verified acceptance versus delivery/failure/unknown, outstanding
  participants, exact turnaround and credential redaction. Tests cover company/MFA boundaries,
  concurrent/changed replay, stale amendment/application decisions, independent states, renewal
  history, overlap prevention and owned export reconciliation/tampering/purged mark inventory.
- Offline Python: export **8**, PDFs **21**, finalisation **13**, checkpoints **9**, email **13**,
  rendering **6**. The export checks cover deterministic retry/interrupted resume, metadata and
  artifact manifests, version/hash/company/volume tampering, storage outage, bounded splitting
  and CSV protection. Uses the existing signing PDF venv and injected fake services only.
- Both TypeScript projects, changed-source ESLint/Prettier, `npm run build:web`,
  `npm run build:mastra` and `git diff --check` passed. Added a local generator using the installed
  official Convex templates (`node scripts/codegen-convex-local.mjs`), avoiding remote component
  analysis during implementation. An initial standard codegen staging request was rejected on
  schema evaluation before any release; no deployment completed.
- Generated/rehashed only the new worker metadata/lock. Signing-only Windmill dry run:
  **19 additions, zero deletions**, exclusively `f/signing/**`, with no stale metadata warning.
  DOX contracts/indexes and product/prerequisite/operations docs updated; the frontend root guide
  stays unchanged because its app-shell/runtime ownership did not change. User-owned earlier
  phase work and Docling caches were preserved. No push, release record, real mail, upload,
  payment, occupation approval, signature or live export was performed.

Remaining Phase 10 acceptance/rollout gates:

- Provision `WINDMILL_SIGNING_EXPORT_TOKEN`, scoped worker/job access and dedicated storage
  read/write-prefix permissions; verify private CORS, retention and 60-second downloads.
- Review/export-copy privacy and retention for Convex snapshots, retained volumes and private
  Windmill job arguments; company departure is not permission to delete records or lift holds.
- Current explicit limits: 700 KB canonical snapshot, 2,000 rows per collection, 400 artifacts,
  100 volumes and 50 MiB data/55 MiB total per volume; reports cap at 10,000 cohort agreements
  and 500 deliveries per invitation. Oversized requests fail, never truncate. Validate pilot
  company sizes; larger exports require a later partitioned-snapshot extension before acceptance.
- Authenticated desktop/mobile/keyboard acceptance: draft links, completed PDF review,
  stale/MFA/uncertain retries, amendments/renewals, separate activation/occupation and manual
  payment evidence; live synthetic full-company handover with independent manifest/hash review.
- Phase 0–9 legal/provider/pilot prerequisites remain open. Implementation completion does not
  establish live acceptance or permit external signing; deployment release mode stays unchanged.

## Verification and rollout

- Backend: `npm test` plus isolation, stage/expiry races, stale jobs, duplicate signing,
  correction/replacement, OTP/MFA limits and artifact/audit tampering.
- PDF: synthetic scanned/rotated/mixed-size/Unicode/long fixtures and real crypto checks.
- Frontend: TypeScript, changed-source lint, production build, mobile and keyboard checks.
- Integration: provider test deliveries/webhooks, reconciliation, restoration and
  independently verified completed signatures. Never send real client mail in tests.
- Preserve auth, OCR/review, documents, leases, client portals and assistant behavior.
- Additive Convex/private infrastructure before frontend activation; inspect Dokploy
  before triggering builds; scoped Windmill dry-run before sync.

## Defaults and research

- Invitation deadline 14 days; OTP 10 minutes/five failed attempts (company policy).
- Email OTP demonstrates mailbox control, not government-verified identity.
- Portal membership alone grants no signing authority; explicit participant linkage.
- Internal approval configurable, bound to exact agreement and policy revisions.
- Unsupported legal categories fail closed, including stronger-signature requirements.
- No service purchase, real invitations, legal certification or deployment assumed.
- Sign-24 URL returned a hosting error during research; user requirements are baseline.

Sources researched on 2026-10-26 (confirm current applicability before launch):
- ECTA original publication: https://www.gov.za/sites/default/files/gcis_document/201409/a25-02.pdf
- POPIA: https://www.gov.za/sites/default/files/gcis_document/201409/3706726-11act4of2013protectionofpersonalinforcorrect.pdf
- pyHanko: https://docs.pyhanko.eu/en/latest/cli-guide/signing.html
- Resend verification: https://resend.com/docs/webhooks/verify-webhooks-requests
- Resend 24-hour idempotency: https://resend.com/docs/dashboard/emails/idempotency-keys
- Tiptap: https://tiptap.dev/docs/editor/getting-started/overview
- Gotenberg: https://gotenberg.dev/docs/convert-with-chromium/convert-html-to-pdf
