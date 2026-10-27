# Agreement signing module

The execution tracker is [`signing_module.md`](../../signing_module.md). Work is
currently an MFA-protected preparation foundation, not a production electronic-signature
service. Private PDF preparation, field placement, internal approval, invitation/delivery
infrastructure, email verification and the account-free signer portal (review, consent,
entries, signature adoption and immutable submissions) and certificate-backed finalisation
(composition, completion certificate, platform seal, trusted timestamp, PAdES B-LT
validation and retained publication) are implemented locally, with Phase 7 tracking,
exceptions, monitoring, retention and a two-key controlled release. External sending
stays closed until an operator sets the deployment release key and a company release is
recorded. Storage/scanner/email/seal/timestamp provisioning and live
acceptance are still required before using the workflow in production.

## Current workspace

Staff open **Agreements** (`/agreements`) and select a client company. Platform
administrators with recent signing MFA can create, edit or cancel drafts, place fields and approve prepared agreements, and prepare named participants
with email, role, responsibility and intended signing stage. Other company staff
can read authorized drafts. Client membership does not grant signing-record access.

Each save creates an immutable revision and participant snapshot. Edits carry the
loaded revision number. A concurrent change requires an explicit reload rather
than overwriting another user's changes. Cancellation requires a reason and locks
the draft. Activity records identify the revision and server timestamp.

The sidebar lists outstanding policy, implementation and operational checks.
Internal approval is a real preparation operation; invitation release, participant signing
and completed-document finalisation remain gated by later phases. The workspace
uploads signing PDFs through a separate private quarantine, without creating operational
leases, sending messages or ingesting data into AI agents.

## Backend contracts

- `signing.createDraft` / `updateDraft`: company-admin writes with bounded payloads
  and durable company/actor/request-ID replay protection. Request IDs must be unique
  for distinct edits. Reusing an ID with another payload is rejected.
- `signing.voidDraft`: drafts only; issued cancellation needs later invitation/session
  revocation and must use a separate workflow.
- `signing.list`, `get`, `revisions`, `events`: company-staff reads. Lists/history
  paginate; get verifies current revision ownership and content consistency.
- `signing.recordPolicy`: an administrator records real review/notice/retention/
  consent references and permitted ordinary signing categories. These are
  attestations, not legal certification. No real policy was recorded by this change.
- `signing.requestApproval` / `decideApproval` / `returnToDraft`: bind a worker-validated
  immutable bundle/object version, content/PDF/manifest hashes and exact policy revision/hash.
  Without a real Phase 2 bundle the request fails closed. Self-approval defaults off.
  Returning to draft creates a new revision and drops its current approval pointer;
  historical requests/decisions stay preserved. Policy changes invalidate approval.
- `signingFields.get` / `save`: staff reads and administrator/MFA writes for immutable
  field-layout revisions. Save requires the loaded draft/layout revision and current
  bundle identity. Fields can belong only to signers in that exact draft revision.
  Read-only approved values and validation rules are checked on the server.
- Requesting approval also requires the exact reviewed `expectedPreparationHash`.
  The hash covers PDF/manifest/object versions, page geometry, fields, participants,
  stages, coordinate version, policy copy and consent version. Every signer needs a
  required signature; initials alone do not satisfy that gate. Existing approval
  records without the Phase 3 field/preparation binding cannot authorize freezing.
- Approval decisions atomically append a `signingFrozenPreparations` snapshot and
  decision/audit references. Approved snapshots are immutable preparation evidence,
  not signatures. `approvalCurrent` verifies binding, current context, decision and
  protected-event consistency; missing/altered decisions or snapshots fail closed.
- `signing.readiness`: `canIssue` and `releaseBlockers` from the two-key release gate
  (deployment key, company release record, policy, services, pilot allowlist). Policy
  configuration or a UI change alone cannot enable external signing.
- `signing.verifyAudit`: bounded hash-chain consistency check, explicitly
  `consistent_unanchored` when consistent. An inconsistent chain or missing tail
  fails; more than 1,000 events returns an explicit limit result. A database-only
  chain cannot protect against an administrator rewriting the chain and its head.

Company `tenantId` never identifies a renter. Participants have revision-scoped
keys and separate records; no permanent account or signing authority is inferred
from an email or portfolio membership.

## Security and remaining operational gates

MFA setup/verification/recovery is implemented through `signingMfa.*` with encrypted
secrets, bounded attempts, replay protection and session-bound five-minute grants.
Read-only MFA status never returns stored secrets. Privileged operations require a
live authenticated session and recent MFA; resetting credentials invalidates old grants.

Signing changes atomically create a checkpoint outbox row. The Windmill worker
`f/signing/audit_checkpoint` requires separately administered HTTPS storage with
versioning/encryption/COMPLIANCE retention, verifies read-back and never silently
downgrades to mutable storage. Independent verification enumerates storage directly
instead of trusting potentially rolled-back database receipts. Unconfigured service
leaves checkpoints pending; failures stay visible and retry attempts are bounded.

The setup/review pack is [signing-prerequisites.md](./signing-prerequisites.md).
Real external storage and MFA-enrollment acceptance remain pending. PDF approval
depends on a current validated immutable bundle; do not
approve editable notes or references to mutable source files as final contract bytes.

Production also requires approved South African policies, Resend/domain setup,
certificate and timestamp provisioning, private retained storage, malware scanning,
restore tests and the later signer/finalisation acceptance journeys. None of those
services was provisioned or paid for by this change.

## Verification and release

### PDF workflow (Phase 2)

1. Create a draft in a company; property/lease associations are optional in the creation wizard.
2. With recent signing MFA, upload one primary PDF and any PDF annexures under
   **Agreement PDF and annexures**. Uploads expire after five minutes. A failed
   connection may have completed the upload: use **Check uploaded file** before retrying.
3. Order annexures and choose **Prepare and validate PDF bundle**. Original files
   are never exposed for preview or to participants. They stay quarantined.
4. Once preparation succeeds, **View prepared PDF** opens an in-app PDF.js overlay
   with navigation/zoom and a prepared-PDF download. The browser verifies SHA-256
   before rendering and revokes its temporary blob URL on close/identity change.
5. Changes to metadata, participants, files or order invalidate the current bundle.
   Prepare again before approval. Existing artifact versions and evidence remain retained.

`signingFiles.*` owns upload tickets, pinned source versions, file ordering and
authorized prepared downloads. `signingPreparations.*` owns durable job identity,
reconciliation and verified completion. Neither accepts client-selected storage keys,
versions, resource paths or ready-bundle receipts. A recent administrator MFA grant
is required for writes; authorized company staff can read prepared bundles.

The worker `f/signing/prepare_bundle` supports `upload`, `stat`, `prepare`, and
`download`. It reads only dedicated resources `f/signing/document_storage` and
`f/signing/pdf_scanner`. Fresh ClamAV signatures (48 hours maximum age) and a clean
INSTREAM result are required before parsing each source and before publishing the output.
Clamd uses a local Unix socket or certificate-verified TLS tunnel; no public plaintext TCP.

Limits: 25 MiB per input PDF, 10 files, 75 MiB total input, 200 pages, 50 MiB output,
300-second Windmill timeout. On Linux the parser/merger runs separately with a
90-second wall limit, 60-second CPU limit, 1 GiB address-space cap, output-size cap
and scrubbed credential environment. Non-Linux production preparation fails closed.

The static renderer preserves page content, media/crop boxes, rotation and user units.
It rejects corrupt/encrypted/already digitally signed PDFs, interactive forms, layers,
embedded attachments, dynamic actions and visible annotations requiring flattening.
Export these to a flat, unsigned PDF first; terms and form values are not silently dropped.
Link annotations are removed while their visible page content remains.

Quarantine and prepared objects live in separate private encrypted/versioned buckets.
Prepared PDF and RFC 8785 canonical manifest use conditional append-only writes with
COMPLIANCE retention and exact-version/hash read-back. Manifests record ordered source
hashes/versions, scan results and every page's geometry. A digest binds the manifest
to the exact draft revision, filenames and file order. Prepared artifacts are not
issued or signed agreements; later phases own issuance and final cryptographic sealing.

Preparation reserves its remote job ID before submitting and verifies job path, ID
and context before consuming a result. Ambiguous submission/status failures retain
ownership and block new preparation/edits. Reconciliation checks that same job; it
never blindly resubmits. Automatic polls stop after 120 checks. Administrators can
request another bounded lookup. A genuinely missing remote job requires an operator
to establish non-submission/termination before marking the internal attempt failed.
Confirmed failures allow a new attempt; late/superseded or duplicate results cannot
publish a second bundle. Failed-attempt artifacts remain subject to approved retention.

Offline worker checks use Python with the worker's pinned `pypdf`/`rfc8785` dependencies
and `reportlab` for synthetic fixtures: `python scripts/test-signing-pdfs.py`.
This does not prove real scanner updates, retention enforcement, Linux isolation,
bucket CORS, authenticated browser/mobile behavior or production service availability.

### Staff preparation and approval (Phase 3)

1. Select a company and choose **New draft**. The three-step wizard captures agreement
   details, optional existing property/lease, participants/responsibilities/stages,
   and a final review. Saving creates a draft; the next steps upload and validate PDFs.
2. Once the PDF bundle is ready, choose **Prepare signing fields**. Select a signer,
   a field type, and **Add field on page**. Signature, initials, full name, server
   signing date, text, number and checkbox fields are supported.
3. Drag a field to position it; drag its resize handle to change its size. Arrow
   keys move the focused field by one PDF point; Shift uses ten points. The resize
   handle's arrows change its size. The field list and numeric properties provide
   keyboard alternatives. Position/size use the unrotated crop area's percentages.
4. Set required/optional, assigned signer, allowed length/range/precision, or locked
   approved values. Dates are server-owned; signatures/initials cannot be locked
   administrator values. Locked names derive from the participant revision.
5. For initials, enter pages such as `1, 3-5`, review the proposed new placements,
   then confirm. This adds field definitions without applying anyone's initials.
6. Select a **Participant preview** to view that signer's fields and navigate required
   fields. The entire PDF remains available. Preview does not submit answers or sign.
7. Save field preparation, close the editor, review the server's blockers, and affirm
   review of the current PDF, fields and parties before **Request internal approval**.
   Any changed snapshot invalidates that acknowledgement. A permitted administrator
   reviews again, records a reason and confirms **approval and freeze** or rejection.
   Self-approval is disabled unless explicitly permitted by the company's policy.
8. Approved preparation shows its frozen evidence hash. **Return to draft for changes**
   requires a reason, creates a fresh draft revision and clears current PDF/layout/
   approval pointers. Historical files, layouts and frozen snapshots remain retained.

Participants in the same numbered stage act in parallel; subsequent stages follow
in ascending order. `signer`, `approver`, `viewer` and `copy` are responsibilities,
separate from descriptive party roles. Viewers/copy recipients have no signing fields;
internal preparation approval is restricted to an authenticated administrator, not
inferred from a participant email/role. Stage advancement follows participant signing
in later phases. Dashboard counts describe loaded/filtered records and do not pretend
to be company-wide totals when older pages have not been loaded.

Geometry contract: `crop-top-left-unrotated-v1`. `x/y/width/height` are fractions of
the unrotated crop box, with top-left origin. `fieldToPdfRect` converts to raw PDF
bottom-left coordinates including crop offsets. `/UserUnit` determines physical
size; 90/180/270 degree display transforms operate on the complete rectangle, not
only its origin. Zoom/responsive canvas dimensions do not change stored positions.
The renderer checks page crop, rotation and units against the manifest and caps
canvas dimensions/pixel count. Original PDF bytes remain unchanged by layout edits.

Limits: 400 fields and 200 KB canonical field evidence per layout; minimum field
size eight physical points in each dimension. Text constraints are bounded; numeric
ranges/precision are bounded and validated. No arbitrary client-supplied regex runs.
Edits and saves require recent MFA; expiry preserves unsaved placements. Stale
draft/bundle/layout state blocks saving and requires explicit discard/reload. A
changed bundle aborts private rendering while preserving unsaved field definitions.
No field values, PDF contents or private URLs enter the assistant or browser storage.

Run root `npm test`, `python scripts/test-signing-checkpoints.py`, backend/frontend TypeScript, targeted frontend ESLint, and
`npm run build:web`. Browser acceptance must exercise administrator draft creation,
participant edits, concurrent-edit rejection, cancellation, read-only company staff,
and a client/other-company denial. Record unperformed checks as pending.

The schema is additive; there is no existing signing data to backfill. Generate
Convex bindings through the normal CLI, never by editing `_generated/`. Release the
backend before frontend activation. A local build is not a deployment. Windmill
jobs and secrets require the separate scoped release documented in the prerequisites runbook.

## Invitations and email verification (Phase 4)

The staff **Invitations and secure access** card shows the transaction, each
participant's access version, delivery facts and email verification independently.
Provider acceptance means the API accepted mail; delivery means the recipient mail
server accepted it. Neither proves that someone opened a document or signed.
Administrator/MFA controls revoke a participant's link/sessions with a reason or
reconcile an existing delivery. Reminder/reissue/release require the release gate.
Personal links, codes, hashes and encrypted mail payloads never appear in this card.

The account-free `/sign` route is a standalone page outside all application shells.
Its local script immediately removes the URL fragment before making requests.
Opening a link or email-scanner GET does not send a code, consume access, consent or
sign. **Verify access** exchanges the personal link for an HttpOnly challenge cookie;
**Send email code** explicitly requests an eight-digit code to the frozen participant
address. **Verify email** creates a short-lived HttpOnly session. Verification alone
does not produce a signature; after verification the same page opens the signer portal
described below. The page supports cookie-based resume and explicit session termination.

Each operation checks active company/transaction, current frozen hash/pointer,
participant role/stage, version, revocation and deadlines. Codes expire after ten
minutes, challenges after fifteen, sessions after thirty, all clamped to invitation
expiry. Five failed attempts across challenges lock the invitation for fifteen
minutes. Requests have per-network/per-invitation limits and a one-minute resend
cooldown. Exact successful verification retries return the same session without
extending it or duplicating evidence. Email OTP proves mailbox access only.

`signingInvitations.*` owns staff controls; `signingAccess*` owns the server-only
verification boundary and atomic counters/session state. `signingDeliveries.*`
reserves durable Windmill jobs before network calls. `f/signing/deliver_email`
decrypts short-lived authenticated envelopes, checks sender/tracking configuration,
and renders all six notification templates. Decline/completion workflow triggers
depend on Phases 5/6. Unknown provider outcomes remain held for reconciliation;
never send again merely because Resend's 24-hour idempotency retention has passed.

Signed raw-body webhooks permanently deduplicate provider event ID/body hash and
match delivery tag, provider message ID, sender and recipient HMAC. Out-of-order
facts never erase known delivery/bounce/complaint times. Read-only provider lookups
record observations separately from webhook event times. Opens/clicks are ignored.
Email verification/provider events use external actor kinds in the protected audit
chain without falsely attributing them to an administrator; legacy hashes remain valid.

The signing access keys, shared service token, sender/domain, worker resource and
proxy setup are specified in [signing-prerequisites.md](./signing-prerequisites.md).
Local synthetic checks do not provision services, prove deliverability or enable
external issuance. External sending is governed by the Phase 7 release gate below.

## Signer portal (Phase 5)

After email verification `/sign` loads `public/signing-portal.js`, a same-origin module
with no platform shell, analytics, external fonts or browser storage. It shows company
branding and the optional policy **signer contact**, title/role/reference/deadline,
participant progress, the complete frozen bundle (local PDF.js from `/pdfjs/build/`,
zoom, page navigation and download) and the participant's own fields plus locked
approved values. The PDF is fetched through `/api/signing?view=document|download`:
the portal server obtains a 60-second private link from `f/signing/prepare_bundle`,
downloads the exact frozen version and verifies its SHA-256 before streaming. The
browser checks the hash again and compares page geometry with the frozen manifest.

- **Consent**: signers/approvers accept versioned platform wording
  (`cyphersoft-signer-consent-v1`) bound to the company's policy consent version and
  privacy notice reference before any entry is saved. Viewers only view.
- **Entries**: required-field navigation, remaining count and inline validation.
  Signing dates are server-owned; locked approved values and read-only names always
  come from the frozen snapshot and cannot be saved by a participant.
- **Signatures and initials**: drawn, typed or uploaded marks are re-encoded in the
  browser and rebuilt server-side (`convex/signerMarks.ts`, Node zlib) from IHDR/IDAT/
  IEND only, with CRC and exact inflated-length checks. Marks are scoped to one
  invitation version; every placement of a kind uses one adopted mark. **Initial all**
  previews every target field and requires explicit confirmation.
- **Save/resume**: drafts autosave with revision numbers. Another window's change
  produces a conflict choice instead of an overwrite; network failures keep entries
  on screen and retry with backoff. Drafts survive session expiry and re-verification.
- **Finish**: review lists every entry; **Finish and sign/approve** requires an explicit
  confirmation and one request key reused across retries. The server re-checks session,
  invitation version, stage, expiry, consent hash, presented preparation/PDF hashes,
  the reviewed draft revision and every field before inserting an immutable
  `signingSubmissions` row whose evidence hash is appended to the agreement event chain.
  Repeats return the existing receipt. Completing a stage activates the next stage's
  invitations (`signerPortal.activateStage`, idempotent request keys); the last stage
  moves the agreement to **Finalising**, never **Completed** (see Phase 6 below).
- **Decline** (reason required) ends the agreement as **Declined**. **Request a
  correction** pauses the transaction without completing or declining it; resuming
  or replacing is a Phase 7 exception workflow. Staff see outcomes and reasons in the
  invitations card.

Opening, viewing, drawing, adopting and saving never create a submission.

## Finalisation and evidence (Phase 6)

When the last stage completes, a separate transaction claims finalisation
(`signingFinalisation.begin` → `lib/signingFinalisation.startFinalisation`). It re-checks
that every signer/approver has exactly one intact accepted submission bound to the frozen
preparation hash, then fixes a canonical **evidence manifest**: agreement/attempt identity,
frozen approval/policy/consent references, prepared bundle versions and hashes, page
geometry, fields, participants, every submission's full evidence (identity, role, email
OTP verification time, consent, presented hashes, accepted values, server signing time),
adopted mark hashes and the audit head plus latest independent checkpoint. Its SHA-256 is
the attempt's `inputDigest`; the attempt identity is inside it, so each attempt has its
own digest and artifact prefix.

`f/signing/finalise_agreement` (`finalise`) verifies that digest (RFC 8785, identical to
Convex `canonicalJson`), reads the version-pinned bundle and checks its hash, verifies each
mark's hash and PNG, draws accepted values in the frozen crop/rotation coordinate system
(text upright on rotated pages; non-Latin-1 text needs a real Unicode font or fails with
`unsupported_text`, never substitution), appends a completion certificate, writes the
evidence hash into the document information, and applies a certified (no-changes) PAdES
platform seal with an RFC 3161 timestamp and embedded revocation data. It validates the
result using only embedded material (trusted chain, intact signature, trusted timestamp,
only LTA-type updates after signing, single seal, matching certificate, bound evidence
hash and page count) before writing the sealed PDF, evidence manifest and completion record
with retained conditional writes. A retained record makes retries idempotent.

Convex accepts a result only for the agreement's current attempt and job, with exact
keys, hashes, page count, timestamp and B-LT validation facts; then it records a
`signingCompletions` row and moves transaction/agreement to completed. Any failure leaves
**Finalising**: transient faults (worker transfer, storage, TSA, revocation) retry
automatically up to three times (5 min, 30 min, 2 h); configuration/content faults wait
for a platform administrator with recent MFA to **Retry finalisation** after fixing the
cause. Ambiguous jobs keep ownership; **Check existing job** polls the reserved job and
never submits a second one. Late or duplicate results cannot publish.

Company staff see the **Finalisation and evidence** card: attempts with plain-language
errors, seal/timestamp details and hashes, a SHA-256-verified sealed PDF download and
**Verify integrity**, which re-reads the retained versions and re-validates the seal
without changing records. Participants who completed their own action can re-verify their
email (for at least 14 days after completion) and download the sealed copy through the
portal; viewers, copy recipients and decliners cannot. Configuration, renewal and archive
procedures are in [signing-prerequisites.md](./signing-prerequisites.md).

## Tracking, exceptions and controlled release (Phase 7)

- **Register**: counts by status, per-agreement progress (finished/total), stage, deadline and
  a **Needs attention** badge/filter from open operational alerts.
- **Release invitations** appears on an approved agreement only when the release gate passes;
  it needs a deadline (1–30 days) and explicit confirmation, and reuses one request identity
  across retries. Blockers are listed when sending is not possible.
- **Reminders**: per participant or **Remind all outstanding participants** — only current-stage
  signers/approvers, not emailed in 24 hours, with no unresolved delivery.
- **Exceptions and records**: extend deadline, resume after correction, replacement draft,
  cancel, legal holds and sending held stage invitations, each with a recorded reason.
- **Signing operations** (platform administrators): open alerts with severity and codes.
- **External sending release** (signing readiness card): deployment mode, company pilot/live
  record, pilot allowlist, blockers, record/suspend controls.

Procedures, alert responses, incident playbooks, retention/holds and the backup restoration
test are in [signing-operations.md](./signing-operations.md).

## Templates, clauses and generated agreements (Phase 8)

**Agreements → Templates & clauses** holds each company's template and clause libraries. The
Tiptap editor supports headings, formatting, lists, tables, page breaks, merge fields,
conditional sections, clause references and a generated payment-schedule table. Approved
versions never change; editing creates a new version. Approval needs a platform administrator
with recent MFA, a legal approval reference and (unless the policy allows self-approval) a
different administrator from the last editor. Template approval pins the approved version of
every referenced clause. **Install starter structures** adds residential, commercial,
month-to-month, renewal and general-contract skeletons whose clause text is a marked placeholder:
real wording must be supplied and approved before use.

On a draft agreement, **Generate from a template** lists approved templates for its category,
shows every merge field with its source (portfolio record, approved lease data, agreement draft,
entered here), and requires missing renter, unit and owner details to be entered explicitly.
Rent, deposit, escalation, charges, VAT and payment day are entered as exact rand amounts and
percentages; the server computes the schedule in whole cents (annual compounding escalation,
half-up rounding, VAT per period). Dates, required fields and the schedule are validated before
generation. The preview is a sandboxed rendering of the exact server HTML.

Generating records the template version and content hash, pinned clause versions, a snapshot
of all facts and entries, the generation date, annexure selections, the input and HTML hashes and
the renderer versions, then renders a normalised PDF through the private renderer and attaches it
as the primary file. It is scanned, prepared and previewed through the normal bundle pipeline.
**Check reproducibility** re-renders a past generation from its stored snapshot; later template
or portfolio edits never change earlier generations or issued files.

## Portfolio application and independent approvals (Phase 10)

Use **Agreements → Portfolio & reports** to add company-scoped owners/renters (with stable
references) and property units. The workspace company is separate from its renters. On a draft,
select its property, owner, renter and unit, explicitly map the representing participants, then
**Save relationships in draft revision**. These links become part of the reviewed content;
later changes require a new draft revision/bundle/approval. Existing agreements without links
remain readable; completed legacy agreements receive a separately audited application mapping.

On a completed agreement, review the sealed PDF and use **Portfolio application** to create a
pending lease, amend an existing lease or create a linked renewal. Enter exact rent/deposit,
dates, escalation and notice terms, plus the review reference. A pinned generation can suggest
terms, but the operator still reviews them. Select any internal payment requests, a move-in
preparation task and whether the existing renewal cadence should apply. Preview shows prior
terms, proposed terms and the exact review SHA-256. Confirming requires administrator access
with recent MFA; a changed lease or request invalidates the review. Amendments retain prior
values; renewals retain predecessor/successor links. Completion itself creates only one internal
review task and staff notice. Replays never recreate closed tasks, leases or payments.

The four facts remain separate: **signed**, **lease active**, **payment recorded** and
**occupation authorised**. New/renewed leases start **Pending activation**, contribute no live
rent and trigger no renewal cadence until separately activated. **Approve lease activation**
and **Authorise occupation separately** each require their own explicit reason/reference and
recent administrator MFA. Renewal activation marks its predecessor renewed; overlapping live
leases for the same linked unit block activation. Payment and move-in task completion never
grant either authorisation. Payment requests are internal ZAR records, not bank instructions;
staff record payment evidence after independent confirmation. Ordinary lease/OCR editing cannot
amend, archive or change clauses on signing-managed leases: use a reviewed signed amendment.

## Signing reports and departure handovers

**Portfolio & reports** reports agreements created within the selected SAST dates, current
completion/outstanding/verification counts and message delivery outcomes across all report pages.
Median turnaround measures issuance to completed finalisation for completed transactions only.
Provider acceptance, mail-server delivery, mailbox verification and signing remain distinct;
delivery counts include OTPs and reminders. Outcomes are read across pages, not a historical
point-in-time report. A report exceeding 10,000 cohort agreements or 500 deliveries per invitation
fails explicitly rather than showing a partial total.

An administrator with recent MFA and an export reason can **Request private handover**. It
captures one transactional company snapshot: portfolio relationships/leases/applications/payments,
agreement revisions/participants/approval and layout history, template/clause versions,
generation inputs, accepted signature images still retained, delivery facts, holds, audit
checkpoints and submissions. Credential tables, invitation tokens/nonces, sessions, OTPs and
encrypted email payloads are excluded. The private Windmill worker packages JSON/CSV metadata,
validated source PDFs/annexures, scanned supporting uploads, completed PDFs and evidence/record
JSON. It verifies exact object versions and SHA-256 before publication. Unvalidated quarantine
and legitimately purged transient images are inventoried as unavailable; missing or corrupt
required artifacts block the export. This is a signing/portfolio handover, not an OCR-document
or full database backup.

Save every volume using **Get verified volume downloads** and **Verify and save volume**.
Links expire after 60 seconds and each archive is hash-verified before saving. The final volume
contains `manifest.json`, which identifies the metadata/artifact volume, object version and hash.
CSV values are protected against spreadsheet formula execution. Export requests/downloads are
audited; nothing is deleted and legal holds/retention remain in effect.

Current explicit limits: 700 KB canonical metadata per snapshot, 2,000 rows per collection,
400 artifacts, 100 volumes, and 50 MiB data per volume (55 MiB with archive overhead). A limit
failure creates no successful partial handover. Large-company exports need a later snapshot
partitioning extension before their acceptance; do not relabel them complete. Unknown jobs keep
their reserved identity; **Check existing export** only reconciles that job after automatic
checks stop. After a confirmed failure, request a new handover with a fresh request identity.
