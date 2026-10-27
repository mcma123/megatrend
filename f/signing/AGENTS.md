# Purpose

- Owns signing security automation. The root `signing_module.md` owns phased implementation and rollout.

# Ownership

- `export_company.py` owns private company handover packaging and verified download links using only `f/signing/document_storage`. Convex supplies a transactional approved snapshot and pinned artifact identities; the worker derives fixed source/prepared/completed/attachment keys itself. Outputs live under `exports/<tenant>/<export>/<snapshot-hash>/`, with write-once retained ZIP volumes and a receipt written last. Dedicated Convex token: `WINDMILL_SIGNING_EXPORT_TOKEN`; it does not need platform-seal/key access.

- `audit_checkpoint.py` writes and independently retrieves non-PII audit anchors through the fixed workspace resource `f/signing/checkpoint_storage`.
- `prepare_bundle.py` also owns participant supporting documents (`attachment_upload`/`attachment_scan`/`attachment_download`): quarantine key `attachments-quarantine/<tenant>/<agreement>/<attachment>`, declared type must match the leading bytes (`unsupported_file`) before ClamAV, then a retained COMPLIANCE copy under `attachments/`; downloads re-verify SHA-256. Attachments are never parsed, rendered or OCR'd.
- `prepare_bundle.py` owns private quarantine transfers, ClamAV scanning, bounded static PDF bundles/manifests and verified prepared downloads. Fixed resources: `f/signing/document_storage` and `f/signing/pdf_scanner`; setup/acceptance is in `../../insightful-property-hub/docs/signing-prerequisites.md`.
- `finalise_agreement.py` owns finalisation (`finalise`), sealed-copy links (`download`) and independent re-validation (`verify`) through fixed resources `f/signing/document_storage` (frozen bucket, `completed/` prefix) and `f/signing/platform_seal`. It imports storage helpers from `prepare_bundle.py`.
- `render_template.py` renders Convex-generated agreement HTML through the private signing renderer (fixed resource `f/signing/template_renderer`, Chromium HTML route only), rejects scripts/external references and hash mismatches, normalises volatile PDF metadata and IDs, and writes each generation once into the signing quarantine bucket. It never serves files; generated PDFs are scanned and prepared by `prepare_bundle.py` like uploads.
- `deliver_email.py` owns Resend sending/read-only lookup through fixed resource `f/signing/email_delivery`, which holds only derived `envelope_keys` (`scripts/derive-signing-envelope-keys.mjs`), never master access keys. Six templates cover invitations, reminders, corrections, declines, completion and email OTP; later workflow phases own decline/completion triggers.

# Local Contracts

- Handover exports verify the RFC 8785 snapshot hash, company/agreement ownership, every source version/SHA-256 and retained-object protection. Use deterministic ZIP headers, safe fixed filenames, and spreadsheet-formula protection in CSV. Bound volume data to 50 MiB (55 MiB including archive overhead), at most 100 volumes/400 artifacts, and a 300-second worker timeout. The index volume hashes metadata and inventories unavailable unvalidated quarantine files; missing/corrupt required artifacts fail closed. Retrying the same approved snapshot verifies the retained receipt/volumes; it never overwrites bytes. Downloads verify all volumes before returning private 60-second links. Never log snapshot contents or provider errors.

- Only the specifically approved `f/signing/**` scope is added to Windmill sync. Dry-run before push; do not deploy just to test local changes.
- Resource credentials stay in Windmill secrets; no source file, job argument or result contains them. The resource is not provisioned by committing the script.
- Before later syncs, preserve provisioned resource definitions through repository metadata containing only secret references, or explicitly skip resources in both dry run and push. Workspace-only resources under this scope must never be deleted by a script release.
- Checkpoints require HTTPS, private encrypted versioned storage, COMPLIANCE Object Lock and an approved retention period. Do not fall back to ordinary mutable storage.
- The independently controlled bucket/credentials must be managed separately from application/database administrators. A configuration reference alone does not prove that separation; operational acceptance is mandatory.
- Repeated writes use the same sequence/hash key and verify stored contents. Latest-checkpoint verification enumerates storage directly so database receipt rollback cannot conceal a newer anchor.
- Never accept browser-selected resource paths, buckets, artifact URLs or credentials.
- Scan originals before parsing and scan the output; unavailable/stale scanner blocks publication. Reject encryption, prior digital signatures, forms/layers/attachments/dynamic content and annotations requiring flattening. Preserve visible flat content and page geometry; no OCR, public converter or assistant ingestion.
- Source versions are pinned. Prepared PDF and canonical manifest use separate retained conditional writes, version/hash read-back and idempotent attempt identity. Existing artifacts cannot be overwritten. Never log provider/parser exceptions or private document content. Short-lived transfer material in private job results requires restricted operator access.
- Parser/merger production execution requires Linux resource limits and scrubbed credentials; keep the 300-second script timeout and pinned dependency lock. No operational sandbox/scanner bypass flag. Tests use trusted synthetic inputs and injected fake services only.
- Mail job arguments contain only encrypted bounded envelopes and non-secret identities/digests. AES-GCM AAD binds delivery UUID/kind; HKDF key purpose matches Convex. Never return/log message bodies, links, OTPs, recipients, keys or provider exception text. Keep the 120-second email timeout and dependency lock.
- Before each send, verify the exact sender domain is verified and open/click tracking are explicitly disabled. Recheck expiry after preflight. SMTP/API POST failures may have sent: return `unknown`; do not retry sending. Read-only lookup requires a known provider message ID. Permanent application deduplication supplements Resend's 24-hour key retention. No live preview against real credentials during offline verification.

- Finalisation must reproduce Convex's exact evidence digest (RFC 8785), verify bundle and mark hashes, and never substitute characters. The seal is certified with no changes permitted, timestamped and B-LT; validation uses only embedded material with fetching disabled. Publish nothing unless validation passes; the record is written last and is the idempotency receipt. Return only error codes, never key, TSA, storage or PDF exception text. Keep the 300-second timeout and pinned lock (pyHanko 0.38.0, certvalidator 0.33.0).
- The platform seal protects the artifact; never describe it as a participant certificate or advanced electronic signature.
- The completion certificate names witnessed signers ("Witness for …") and in-person identity checks (document type and ending, code sent to the participant's own mailbox) only from the evidence manifest.

# Work Guidance

- After deployment, preserve server-assigned folder ownership, explicit script `has_on_behalf_of` metadata and server-resolved dependency locks. Review a signing-only pull dry run before pulling these defaults; follow with a signing-only push dry run to verify zero drift. Do not push empty owner defaults over the assigned owner.

- Use the Windmill Python skill for scripts and resource skill for actual resource management. Do not reuse Docling/preview/scanner credentials.

# Verification

- `python scripts/test-signing-export.py` with the signing PDF venv: offline complete metadata/artifact manifests, deterministic write-once replay/interrupted resume, source/version/volume/snapshot tampering, company boundaries, storage outage, bounded splitting and CSV formula protection. Live full-company handover and private storage/CORS/token-scope checks remain acceptance gates.

- `python scripts/test-signing-email.py`: offline authenticated envelope, six templates, sender/tracking preflight, expiry, safe ambiguous outcomes and read-only lookup. Uses synthetic injected services; does not send email or prove live delivery.
- `python scripts/test-signing-render.py`: offline determinism across converter timestamps/IDs, write-once storage, hash/active-content/external-reference rejection, identity and page limits and converter configuration.
- `python scripts/test-signing-finalise.py` (signing PDF venv with pyHanko 0.38.0): synthetic PKI and dummy RFC 3161 TSA; B-LT seal/validation, evidence binding, Convex/RFC 8785 hash parity, rotated-page composition, Unicode font policy, idempotent retry, PDF/evidence/record/content tampering, TSA outage, untrusted/mismatched certificates, source/mark tampering and storage outage.
- `python scripts/test-signing-checkpoints.py`: offline Object Lock, idempotency, tampering and enumeration checks.
- `python scripts/test-signing-pdfs.py` with locked worker dependencies and reportlab: offline PDF, geometry/order, scan-before-parse/output scan, protocol/freshness, immutable storage, hashes and tampering checks, plus attachment form binding, type-before-scan, malware blocking and verified retained downloads.
- Live write/read/retention and separation-of-administration checks remain prerequisites before production activation.

# Child DOX Index

- No child DOX docs yet.
