# Signing operations runbook

Operational procedures for the contract/lease signing module. The execution tracker is
[`signing_module.md`](../../signing_module.md); service provisioning is in
[signing-prerequisites.md](./signing-prerequisites.md); product behaviour is in
[signing.md](./signing.md). Record evidence references, never keys, links, codes or contract
contents.

## Release controls (two keys)

External email (invitations, reminders, reissues, next-stage invitations) is allowed only when
**all** of these pass (`convex/lib/signingRelease.ts`):

1. Deployment key: Convex env `SIGNING_RELEASE_MODE` is `pilot` or `live`. Unset or any other
   value is off.
2. Company release record (**Agreements → Signing readiness → External sending release**),
   recorded by a platform administrator with recent MFA, not suspended, with legal sign-off and
   acceptance evidence references. A `live` record needs a `live` deployment key.
3. Complete signing policy and an approved category for the agreement.
4. Configured services: access keys, portal origin/token, sender, email/document/finalisation/
   checkpoint worker tokens, worker URL/workspace and webhook secret.
5. Pilot: every participant address of the agreement matches the allowlist (exact address or
   `@domain`).

The gate is checked again when each message is sent, so mail queued before a suspension or
allowlist change is suppressed. Verification codes for participants who were already invited
are still sent unless the deployment key is off or the company release is suspended, so they
can verify and finish; suspension or deployment off stops codes too.

### Kill switches

- One company: **Suspend sending** (reason required). Immediate; next-stage invitations are held
  and raise a `stage_blocked` alert.
- Whole deployment: set `SIGNING_RELEASE_MODE=off` (or remove it) in the Convex dashboard.
  This also stops verification codes, so no participant can start a new session.
- Finalisation only: remove `WINDMILL_SIGNING_FINALISE_TOKEN`; agreements stay Finalising.
- To lift a suspension, record the release again (new revision) after the cause is fixed, then
  use **Send held stage invitations** on affected agreements.

### First release procedure

1. Phases 0–6 acceptance evidence is complete and referenced (legal sign-off, provider/domain,
   storage/retention/restore, scanner, certificate/TSA, MFA enrolment).
2. Deploy Convex (additive schema/functions) before the portal; run the signing-only Windmill
   dry run then push (`--includes 'f/signing/**'`).
3. Set `SIGNING_RELEASE_MODE=pilot`; record a pilot release with internal test addresses only.
4. Synthetic end-to-end pilot: upload → prepare → place fields → second-admin approval →
   release → verify email → sign (desktop and mobile) → finalise → staff and signer download →
   **Verify integrity**. Then each exception: decline, correction → resume, correction →
   replace, void, deadline extension, expiry, reminder, revoke/reissue, suspended stage.
5. Record the pilot evidence reference; extend the allowlist to the first real company
   contacts for a controlled pilot; monitor alerts daily.
6. Only after review: set `SIGNING_RELEASE_MODE=live` and record a `live` release per company.

## Monitoring and alerts

`signingOperations.scan` runs every 30 minutes; expiry every 15 minutes; retention purge daily
at 02:30 UTC. Alerts appear under **Agreements → Signing operations** for platform
administrators, who also get an in-app notification when an alert first opens. Alert messages
carry codes and counts only.

| Alert | Meaning | Response |
|---|---|---|
| `preparation_stuck` | PDF preparation job unresolved > 1 h | Check the Windmill job; use reconcile on the agreement. Never resubmit an unknown job. |
| `finalisation_stuck` | Finalisation job unresolved > 1 h | **Check existing job** on the agreement; inspect `wmill job get`. |
| `finalisation_failed` | Needs staff action (configuration/content error or retries exhausted) | Read the error, fix configuration (certificate, TSA, storage, font), then **Retry finalisation**. |
| `finalising_overdue` | All signed > 24 h ago, not completed | As above; escalate if TSA/certificate outage persists. |
| `delivery_unresolved` | Email outcome unknown | **Check existing delivery**; never resend blindly. |
| `delivery_rejected` / bounce in ledger | Provider rejected or mailbox bounced | Confirm the address; address changes require **Create replacement draft**. |
| `delivery_stuck` | Email job queued/running > 30 min | Check the email worker token and Windmill queue. |
| `checkpoint_failed` / `checkpoint_pending` | Independent audit anchor not stored | Check checkpoint storage and token; anchors retry automatically. |
| `deadline_soon` | Deadline within 48 h with participants outstanding | Remind outstanding participants or extend the deadline (≤ 30 days). |
| `stage_blocked` | Next-stage invitations held by the release gate | Resolve the release blocker, then **Send held stage invitations**. |

## Incident playbooks

- **Suspected link or mailbox compromise**: revoke the participant's access (reason), then
  reissue to the confirmed address or replace the agreement. Revocation ends sessions.
- **Wrong recipient or terms**: void (cancel) or replace. Never edit issued terms; accepted
  submissions remain as evidence.
- **Email provider outage or abuse**: suspend sending for affected companies; reconcile
  unresolved deliveries after recovery.
- **Signing access key exposure**: rotate `SIGNING_ACCESS_KEYS_JSON`/active key, retaining old
  key IDs needed to verify existing invitations; suspend sending until rotated.
- **Seal key compromise**: follow the certificate procedure in signing-prerequisites.md; remove
  the finalisation token first.
- **Unexpected data in logs/alerts**: alerts must contain no names, emails or document text.
  Treat any occurrence as a privacy incident and record it.

## Exceptions (staff)

Available on an agreement under **Exceptions and records** (platform administrator with recent
MFA; every action requires a reason and is in the audit chain): extend deadline, resume without
changes after a correction request, create a replacement draft (open agreements become
Superseded with access revoked; terminal ones are linked only), cancel an approved/issued
agreement, place/release a legal hold, and send held stage invitations.

## In-person sessions and supporting documents

- In-person: on the participant's invitation row choose **Start in-person session**, inspect the
  original identity document, record its type and last 2–4 characters only, attest, then open the
  single-use link (valid 15 minutes) on the participant's device. The participant receives the
  code at their own email address; staff never enter it. A new check cancels an unused link.
- Supporting documents: participants upload PDF/JPEG/PNG (≤10 MB) into quarantine; only scanned,
  type-matched files are retained. "Scanner unavailable" leaves the upload retryable; malware or a
  mismatched type rejects it. Open a document from **Supporting documents** only for its stated
  purpose and record the reason; every access is in the audit trail.
- Witnessing, SMS, WhatsApp and accredited advanced signatures are blocked until the policy records
  legal approval (witnessing) or a provider is accepted. Do not work around these blockers.

## Retention, legal holds and deletion

- Retained (never purged by the application): submissions and their evidence, consents, signing
  events, sessions, delivery facts, finalisation records and retained storage artifacts
  (COMPLIANCE object lock; deletion before expiry is impossible).
- Purged after the company's **transient retention** period (policy, 30–3650 days, default 90)
  from terminal agreements: unfinished signer drafts, adopted marks not used in an accepted
  submission, and OTP challenge records. An active legal hold blocks the purge.
- Storage-level retention is set by the signing storage resource; legal-hold extension of
  retained objects follows the approved retention policy.

## Backup restoration test (record evidence each quarter)

1. Restore the Convex deployment export to an isolated, non-production deployment with no
   signing env keys (release mode off, no worker tokens).
2. Verify agreement, submission and event counts against the export; run `signing.verifyAudit`
   for a sample of agreements and compare event head hashes with independent checkpoints
   (`signingCheckpoints.verify`).
3. Download a sample of completed artifacts from the retained bucket by recorded version and run
   **Verify integrity** equivalents (pyHanko validation, evidence hash) offline.
4. Record date, operator, sample sizes, results and gaps. A failed restore suspends releases.

## Security review and acceptance record

- Code security review results and their fixes are recorded in `signing_module.md` (Phase 7).
- Authenticated desktop/mobile acceptance (keyboard, screen reader, touch, interrupted network,
  two tabs, session expiry) must be performed against a deployed pilot and recorded there.

## Phase 10 application and handover checks

- Completion creates a deduplicated internal review task/notice, not a lease. On the completed
  agreement, review the sealed PDF and the exact proposed terms/target/relationships before
  confirming application. A stale review must be regenerated. Completed/cancelled tasks must
  remain closed when an event is replayed.
- Approve lease activation and occupation separately with references; record payments only
  after independent staff confirmation. No payment integration is configured. Move-in tasks
  are preparation only. Pending renewals do not carry rent; explicit activation retires the
  predecessor and prevents overlapping active leases for the same unit.
- A private departure request captures its approved snapshot once. For unknown/submitting jobs,
  inspect/reconcile only the reserved job ID: never POST the export again. Automatic read-only
  checks stop after roughly 15 minutes; administrators can then check the existing job. A
  confirmed failed export permits a fresh request/snapshot; retained partial volumes remain
  protected and are not deleted as cleanup.
- Save every archive volume and independently verify receipt/manifest SHA-256, versions,
  source/annexure/supporting files, completed PDF and evidence records. Inspect unavailable
  entries; unvalidated quarantine and legitimately purged transient images are explicit.
  Missing/corrupt required bytes or any resource limit block success. Confirm the company fits
  the limits in `signing.md`; a large company needs snapshot partitioning before acceptance.
- Downloads require current administrator MFA and are audited. Refresh expired 60-second links;
  do not share signed URLs as departure evidence. Review export-copy retention/processor access
  before using production data. Export never deletes company records or lifts legal holds.

## Production evidence log

Record separately from implementation evidence in `signing_module.md` → "Production rollout":
date, company, mode, release revision, operator, evidence reference and outcome. Never record
personal data or credentials.
