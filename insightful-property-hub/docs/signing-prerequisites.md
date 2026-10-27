# Signing Phase 0 — review and provisioning pack

Status: **awaiting external approvals and service acceptance**. This document is
an intake/runbook, not an approved legal policy. Track evidence in root
`signing_module.md`; never substitute test fixtures for real acceptance.

## Review packet for the company and legal reviewer

Record the reviewing lawyer/firm, authorised company decision-maker, review date,
policy version, permitted agreement categories and the location of the signed review.
Do not tick approval merely because a document was drafted or uploaded.

The reviewer must confirm:

- Applicability of the current ECTA signature provisions and excluded transactions;
  ordinary residential/commercial leases, renewals and general contracts are only
  eligible after review. Property sales, long-term leases, wills, bills of exchange,
  suretyships and documents with unsupported witnessing/formalities stay blocked.
- Signer capacity/authority, representation, co-tenants, guarantors and witnesses.
- Electronic consent wording/version, actual signature intent, access to the full
  agreement/annexures, decline/correction and replacement-version procedures.
- Whether the proposed mailbox verification and evidence are appropriate for each
  category. Email OTP does not establish government-verified identity.
- The difference between participant electronic signatures and the platform PDF
  seal. No claim of accredited advanced signing without an accepted integration.
- Whether separate preparation/approval is required. Self-approval is off by default;
  an explicit company policy and an MFA-verified administrator change are required
  to permit it.

References for review (not a consolidated legal opinion):
[ECTA original publication](https://www.gov.za/sites/default/files/gcis_document/201409/a25-02.pdf),
[POPIA](https://www.gov.za/sites/default/files/gcis_document/201409/3706726-11act4of2013protectionofpersonalinforcorrect.pdf).

## Privacy, retention and operational decisions

Supply approved references for the privacy notice, consent version, retention and
legal-hold policy. Record the responsible party/information officer, processors and
subprocessors, hosting regions, cross-border safeguards, participant notices,
IP/browser metadata purpose/retention, correction/access requests, incident response
and lawful deletion procedures. Set actual retention periods with legal review;
Object Lock COMPLIANCE retention cannot be shortened by ordinary deletion.

Include all storage copies and backups in the policy. Decide restore RPO/RTO,
independent backup ownership, retention expiry, certificate/TSA renewal, archive
validation and incident contacts. Restore a synthetic evidence bundle and retain
the safe test reference and result before acceptance.

## MFA configuration

`node scripts/create-signing-mfa-key.mjs` creates the root gitignored file
`.env.signing-mfa-keys.local` using a 256-bit random key, restricts file access, does
not print the key, and refuses to replace an existing file. Securely back it up.
Local generation does not configure or deploy Convex.

Configure these **Convex server secrets** using the deployment secret manager:

- `SIGNING_MFA_ACTIVE_KEY_ID`: the keyring's `activeKeyId`.
- `SIGNING_MFA_KEYS_JSON`: the serialized `keys` object, not the outer keyring object.

Never put these in Vite variables, Git, screenshots or chat. Retain older key IDs
during rotation: stored ciphertext names its encryption key ID. Changing the active
key only affects new enrollments; removing an old key can make an authenticator
unreadable. Test restoration before rotation. Private certificate keys are separate
from MFA encryption keys.

Administrators enroll at `/agreements`, privately save the eight one-time recovery
codes and confirm a real TOTP. Privileged signing writes require a five-minute grant
bound to the live Convex Auth session and current authenticator version. Five failed
attempts lock verification for fifteen minutes; replacing an unconfirmed enrollment
does not clear lockout. Recovery/reset revokes the old credential's grants. No staff
MFA bypass or general password-auth migration is included.

## Resend account and sender domain

- Choose the company-owned account, approved sender domain/from address, reply-to
  address, billing owner, processor terms and incident contacts.
- Verify domain ownership and publish the provider's exact SPF/DKIM records. Add a
  reviewed DMARC policy; do not guess DNS values or duplicate conflicting SPF records.
- Store the minimum-scope API key in Windmill secrets for signing email jobs.
- Verify provider domain status, then use synthetic/authorised recipients to prove
  delivery, failure/bounce handling and signed webhook replay/deduplication.
- No real invitation, test email, account purchase or DNS change has been made by
  development work. Phase 4 provides local invitation jobs/webhooks, without provisioning or release.

### Phase 4 email/access configuration and acceptance

Nothing below is installed by the code change. Configure only as part of a reviewed
release, retaining the Phase 7 issuance block until all dependencies pass.

Convex server configuration:

- `SIGNING_ACCESS_KEYS_JSON`: object of versioned key IDs to independently generated
  256-bit hex keys; `SIGNING_ACCESS_ACTIVE_KEY_ID`: active entry. Keep these separate
  from MFA/certificate keys. HKDF separates invitation/session HMAC, OTP HMAC,
  recipient/network HMAC and AES-GCM email-envelope purposes. Retain historical
  IDs while any invitation, challenge, encrypted payload or webhook binding needs them.
- `SIGNING_PORTAL_SERVICE_TOKEN`: independent random secret of at least 32 characters,
  shared only with the frontend server, never Vite/browser configuration.
- `SIGNING_PORTAL_ORIGIN`: exact HTTPS public origin (no path/query); and
  `SIGNING_SENDER_ADDRESS`: approved exact from address, optionally a display name.
- `WINDMILL_SIGNING_EMAIL_TOKEN`: separate least-privilege token, execute only
  `f/signing/deliver_email` and read its jobs. Uses the existing signing-only HTTPS
  `SIGNING_WINDMILL_BASE_URL` and `WINDMILL_WORKSPACE` settings.
- `RESEND_SIGNING_WEBHOOK_SECRET`: Resend/Svix signing secret for the dedicated endpoint.

Frontend server configuration (Dokploy runtime, never `VITE_*`):

- `SIGNING_CONVEX_SITE_URL`: HTTPS Convex HTTP-actions site origin (`.convex.site`,
  not the `.convex.cloud` client API); no paths, query strings or embedded credentials.
- `SIGNING_PORTAL_ORIGIN` and `SIGNING_PORTAL_SERVICE_TOKEN`: match the Convex settings.
  Signer document views also use the Convex `WINDMILL_SIGNING_DOCUMENTS_TOKEN` download
  operation; the portal server must be able to reach the private storage HTTPS endpoint
  returned in the 60-second link (the browser never receives it).
- `SIGNING_TRUSTED_PROXY_HOPS` (required): explicitly verified trusted X-Forwarded-For hop
  count (1–4). The proxy selects from the right and ignores malformed addresses. If unset or
  invalid, `/api/signing` refuses to operate, because a single shared rate bucket would let
  one client exhaust every signer's limits. Verify Dokploy's actual
  header stripping/appending and prohibit direct upstream access before setting it;
  do not guess or trust arbitrary client-supplied leftmost values.

Create the private Windmill resource `f/signing/email_delivery` with:

- `resend_api_key`, optional separate `domain_read_api_key` (domain verification read
  permission), `domain_id` (provider UUID), exact `from_address`, optional approved
  `reply_to`, and `signing_origin` matching the HTTPS portal origin.
- `envelope_keys`: derived email-envelope keys per key ID, never the master access keys.
  Generate them from the Convex keyring with
  `node scripts/derive-signing-envelope-keys.mjs <keyring.json>` on an operator machine and
  paste the output directly into the secret. Re-derive after every access-key rotation,
  keeping old key IDs while queued messages may still use them.
  Restrict this worker/resource/operator access: decrypting an envelope reveals a
  recipient and temporary link/code. No key, body, URL, OTP or recipient is returned
  or logged by the adapter. Application rows retain hashes plus temporary AES-GCM
  ciphertext; acceptance/rejection/expiry clears that ciphertext. Jobs must have an
  approved bounded retention period and restricted access to encrypted arguments.

Before any later sync, represent provisioned resources in the repository using
secret references only, or use `--skip-resources` on both the dry run and push.
Resources created only in the workspace can otherwise appear as deletions under
`f/signing/**`. Never apply such deletions or export inline credentials. Inspect
every signing-only dry run after provisioning; preserve other projects' resources.

Disable **both** open and click tracking for this sender domain in Resend. The
adapter retrieves the domain before every send and requires exact domain identity,
verified status, `open_tracking: false` and `click_tracking: false`. Missing/unknown
tracking configuration blocks sending. Recheck actual received mail for rewritten
links/tracking pixels and confirm processor retention/region requirements.

Register `POST <SIGNING_CONVEX_SITE_URL>/signing/resend-webhook` with Resend. Preserve
the raw body and Svix headers through proxies. Subscribe to sent, delivered,
delivery-delayed, bounced, complained, failed and suppressed events supported by
the account; do not infer portal viewing from opened/clicked events. Official Svix
verification rejects changed raw bodies and stale signatures before recording facts.
The adapter tags every message with its non-secret `signing_delivery` UUID.

Resend's idempotency window is only **24 hours**. Application delivery/request IDs
are permanent deduplication keys; reserve the Windmill job UUID before POST. A
timeout or failed job can follow successful sending: leave `unknown`, reconcile
that exact job, await its signed webhook or investigate the provider with its known
message ID. A 404, payload expiry or elapsed 24 hours never authorizes a blind resend.
Provider lookups do not invent historical delivery timestamps. New reminders need
an explicit outstanding participant action; reissue needs a recorded reason and
rotates access, rather than replacing the signer or changing signing authority.

Local checks: root `npm test`; `python scripts/test-signing-email.py` using the
worker's pinned cryptography/requests dependencies; metadata generation; and the
signing-only Windmill dry run. Do not live-preview the mail worker as an offline test.
The script's 120-second timeout and private resource do not configure the service.

Live acceptance remains pending: authorised synthetic recipients, SPF/DKIM/DMARC,
disabled tracking, delivery/bounce/complaint handling, signature/replay/identity
conflicts, ambiguous sends across the provider window, forwarding without mailbox
verification, revoke/reissue/expiry across devices, lost responses, verified proxy
headers, mobile cookie/resume behavior and inspection of access/application/provider
logs. Never log URL fragments, API bodies, cookies or credentials, and keep external
telemetry/assistant/fonts off `/sign` and `/api/signing`.

Reference contracts: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys),
[domain settings](https://resend.com/docs/api-reference/domains/get-domain),
[raw webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests).

## Signing certificate and trusted timestamps

Obtain an appropriate document-sealing certificate and approved RFC 3161 TSA with
documented billing/account ownership, processor terms, trust roots and renewal/
revocation contacts. Keep the private key in the protected signing service or HSM;
never in browser/Convex documents, source or job arguments.

Acceptance must verify certificate chain, intended key usage, validity, revocation,
TSA trust, timestamp validation and retained validation material. A self-signed test
certificate or a reachable TSA URL does not meet this gate. Phase 6 applies the seal;
provisioning it does not establish the identity of a human signer.

### Phase 6 finalisation configuration

Windmill resource `f/signing/platform_seal` (secret values, workspace only, never in the
repository; read only by `f/signing/finalise_agreement`):

- `key_pem`: PKCS#8 PEM private key of the document-sealing certificate, optionally
  encrypted with `key_passphrase`. The current worker loads the key from this secret
  resource. If the approved key-protection policy requires an HSM/remote signer, that
  integration is an acceptance blocker; do not weaken the policy to fit the worker.
- `certificate_pem` (one leaf), optional `chain_pem` (intermediates), `trust_roots_pem`
  (roots the seal must chain to), `tsa_trust_roots_pem` (TSA roots).
- `tsa_url`: HTTPS RFC 3161 endpoint; optional `tsa_username`/`tsa_password`.

The key must match the certificate, be within validity and allow digital signature or
non-repudiation. Signing fetches OCSP/CRL data; validation then uses only material embedded
in the PDF with fetching disabled, so an unavailable responder fails closed
(`revocation_unavailable`) rather than producing a weaker file. Artifacts are written to the
existing `f/signing/document_storage` frozen bucket under `completed/<company>/<agreement>/<attempt>/`.

Convex deployment env `WINDMILL_SIGNING_FINALISE_TOKEN`: a separate token allowed only to
run `f/signing/finalise_agreement` and read its jobs (with the existing
`SIGNING_WINDMILL_BASE_URL`/`WINDMILL_WORKSPACE`). Without it, completed signing stays
Finalising and staff see "not configured".

Acceptance (synthetic agreement, real services): sealed PDF validates in an independent
validator (for example Adobe Acrobat and pyHanko CLI) with trusted chain and timestamp and
embedded revocation data; tampering is detected; TSA/OCSP outage, wrong key and storage
denial each leave the agreement Finalising; staff **Verify integrity** passes.

### Phase 8 template renderer

Deploy `docker-compose.signing-renderer.yml` as a separate private Dokploy compose (internal
network `signing-renderer`, no ports or domain) and attach the Windmill workers to it. Verify
its flags against the pinned Gotenberg release: Chromium HTML only, JavaScript disabled, only
local files allowed, LibreOffice routes disabled, basic auth on.

Windmill resource `f/signing/template_renderer` (workspace secret): `url` (internal renderer URL,
no credentials or query), `username`, `password`. The existing `WINDMILL_SIGNING_DOCUMENTS_TOKEN`
must also be allowed to run `f/signing/render_template`. Acceptance: render the same synthetic
template twice and confirm identical PDF hashes; confirm a template containing a remote image or
script reference is rejected and that the renderer cannot reach the network.

### Certificate renewal and archive procedure

- Renew the sealing certificate at least 30 days before expiry. Replace `key_pem`,
  `certificate_pem`, `chain_pem` and trust roots together in one resource update, then run
  the synthetic acceptance above before any real finalisation. Record the new certificate
  SHA-256 (shown on completed agreements) in the operational log.
- Never revoke or delete the previous key material record until all its sealed documents
  are covered by long-term validation; completed PDFs embed their own chain, timestamp and
  revocation data (PAdES B-LT), so they remain verifiable after expiry.
- On key compromise: revoke with the CA, stop finalisation (remove the Convex token), rotate,
  and list affected completions by seal certificate SHA-256 for re-verification and notice.
- Long-term archive extension (PAdES-LTA document timestamps before TSA/CA certificates
  expire) is not yet automated; schedule it as an operational task within the retention
  period and track it in Phase 7 operations.
- Retained artifacts follow the COMPLIANCE retention of the frozen bucket; deletion before
  expiry is impossible by design. Legal-hold extension follows the retention policy.

## Independent checkpoint storage

Provision a dedicated **private HTTPS S3-compatible bucket** with versioning,
encryption at rest and Object Lock. Set the legally approved retention period and
COMPLIANCE retention. Administration and backups must be controlled separately
from database/application administrators; record the responsible owner and review.

Create the workspace resource `f/signing/checkpoint_storage` through the normal
Windmill resource workflow. Its resolved value must contain:

| Field | Required value |
|---|---|
| `endpoint` | Trusted HTTPS object-storage base URL |
| `bucket` | Dedicated audit-anchor bucket |
| `region` | Storage region (defaults to `us-east-1` only for protocol compatibility) |
| `access_key`, `secret_key` | Secret-backed bucket-scoped credentials |
| `retention_days` | Actual approved integer retention period, not an example default |
| `independent_admin_reference` | Location of the reviewed separation-of-administration evidence |

The credential needs bucket versioning/encryption/policy/Object Lock inspection,
bounded prefix listing, object put/get and retention read. Do not grant deletion,
retention bypass or unrelated buckets. Never reuse Docling/preview/scanner keys.

The worker enforces privacy/configuration checks, conditional sequence/hash writes,
COMPLIANCE retention and read-back verification. Its latest read enumerates storage
directly, so removing database receipts cannot conceal a newer anchor. The reference
field is an attestation; separately verify actual IAM/admin separation and backups.

Configure Convex `SIGNING_WINDMILL_BASE_URL` as a trusted **HTTPS** Windmill base URL,
the existing `WINDMILL_WORKSPACE`, and a distinct `WINDMILL_SIGNING_TOKEN` scoped to
`jobs:run:scripts:f/signing/audit_checkpoint`. Existing plaintext HTTP automation
configuration is not used for signing credentials.

Generate/deploy the scoped script through the established Windmill workflow after
inspection of a dry run. A full-workspace dry run found unrelated existing drift;
signing releases must use the signing-only include in both dry run and any later
explicitly authorised push. Do not widen sync to `f/**`. Local checks:

```text
python scripts/test-signing-checkpoints.py
npm test
npm run wmill:push -- --dry-run --includes 'f/signing/**'
```

Live acceptance requires an authorised synthetic write/read, verified object-version
identity and COMPLIANCE retention, duplicate-write read-back, denial of deletion/
retention bypass, rollback detection, and backup restore. Offline fakes do not prove
that a real bucket has these controls. Checkpoints whose service is unavailable stay
pending/failed; an unprotected receipt must never report successful anchoring.
Bucket policy must enforce conditional append-only writes and forbid deletion or
retention bypass by the application credential. Conflicting retained anchors for
one sequence are treated as tampering and require investigation, never a silent
choice between branches.

## Document storage and malware scanning

Provision separate private versioned signing-document storage, with approved
encryption, access, retention, backup and restoration. Provision a maintained scanner
with signature updates and an isolated quarantine area. Phase 2 must prove scan-before-
release using clean/malicious fixtures, fail closed when scanning fails, and preserve
the exact issued artifact. No parser or scanner may publish a mutable approved PDF.

Phase 2's adapter now expects the following fixed Windmill resources, managed by an
authorized operator through Windmill secrets. Do not put credentials into source,
job arguments, frontend env or shared Docling/checkpoint resources.

- `f/signing/document_storage`: `endpoint` (HTTPS), `region` (default `us-east-1`),
  `access_key`, `secret_key`, distinct `quarantine_bucket` and `frozen_bucket`, and
  legally approved integer `retention_days` (no implicit retention default).
- `f/signing/pdf_scanner`: either `transport: unix` with absolute `socket_path`, or
  `transport: tls` with `host`, `port` (default 3310), optional `server_name` and
  trusted `ca_pem`. Use a maintained clamd behind a TLS tunnel for TLS mode; clamd
  itself is not assumed to provide TLS. Keep daemon database timestamps in UTC,
  run freshclam, allow at least 50 MiB `StreamMaxLength`, and verify clean, EICAR,
  stale-database, service-down and timeout outcomes with authorized synthetic fixtures.
- Convex `WINDMILL_SIGNING_DOCUMENTS_TOKEN`: separate least-privilege token for
  `f/signing/prepare_bundle` execution plus job reads; reuse only the already specified
  HTTPS `SIGNING_WINDMILL_BASE_URL` and `WINDMILL_WORKSPACE`. Checkpoint token stays separate.

Both buckets must deny public ACL/policies and have encryption/versioning enabled.
The frozen bucket additionally needs Object Lock enabled and COMPLIANCE retention.
Enforce conditional creation and deny delete/retention bypass for the application
credential. Validate actual MinIO/S3 compatibility with `If-None-Match`, object
checksums, retention and exact-version read-back; there is no mutable-storage fallback.
Use separate bucket-scoped keys and narrowly scoped operator access to private
Windmill job results (short-lived presigned upload/download material appears there).

Quarantine CORS: allow only approved portal origins, POST and required form headers.
Frozen bucket CORS: allow only approved origins and GET for versioned prepared PDFs.
Configure safe quarantine cleanup for expired tickets, rejected uploads, superseded
versions and incomplete attempts, respecting company/legal holds and retention.
Never clean up by blindly deleting an entire company/agreement prefix.

Windmill workers require Linux, subprocess/resource-limit support and the scanner
socket mount or verified TLS network route. The metadata caps jobs at 300 seconds;
confirm worker hard termination, memory controls and absence of document/credential
logs. Offline Windows fixtures exercise PDF logic, not the production Linux sandbox.

Live acceptance also requires: actual POST upload and disconnect/resume, concurrent
annexure attachments, pinning despite repeated uploads, malicious/encrypted/corrupt/
signed fixtures never released, ordered mixed-size/rotated page preview on mobile,
exact hash/version read-back, expired/MFA-revoked/cross-company denial, ambiguous-job
reconciliation, duplicate/late completion, failure recovery, deletion-denial and
backup restore. Keep all these pending until real evidence is recorded.

## Acceptance record

Phase 10 adds a separate Convex `WINDMILL_SIGNING_EXPORT_TOKEN`, restricted to running
`f/signing/export_company` and reading its owned jobs. It must not grant platform-seal access.
The worker uses the existing dedicated `f/signing/document_storage` resource: read pinned
`quarantine/`, `prepared/`, `completed/` and `attachments/` versions and write/read retained
`exports/<company>/<export>/<snapshot-hash>/` objects. No resource is provisioned by source
or metadata generation. Review the data processor/operator access to private job arguments
(approved metadata/evidence snapshots), suppress body logging, and record an export-copy retention
policy for both Convex snapshots and retained archive volumes before activation.

Accept export byte/version/hash verification, private bucket/COMPLIANCE retention, token-prefix
permissions, no cross-company downloads, 60-second HTTPS links, storage CORS for the portal's
SHA-256 verification, reconnect/reconciliation and interrupted write-once packaging. Perform a
real synthetic full-company handover, inspect every JSON/CSV/artifact/manifest entry and verify
hashes independently. Validate the current snapshot/artifact limits against each pilot company;
oversized companies remain blocked until partitioned snapshots are supported. Do not release an
export with silently omitted data. Authenticated desktop/mobile review/application, separate
activation/occupation decisions and manual payment evidence also need recorded acceptance.

For each external requirement record: owner, evidence location, date, result, next
review/expiry, and production environment. Leave absent evidence pending. The app
returns `canIssue: false` until the two-key release gate passes (deployment
`SIGNING_RELEASE_MODE`, a recorded company release with evidence references, policy and
configured services; see signing-operations.md). Policy references, successful MFA or a
checkpoint alone cannot turn on external signing.
