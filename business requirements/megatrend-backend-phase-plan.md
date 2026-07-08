# Megatrend Backend Phase Plan

Date: 2026-07-08

## Stack Decisions

- Active UI baseline: `insightful-property-hub/`
- Quarantined UI: `megatrend/`
- Workflow automation: Windmill
- OCR and structured extraction: Docling, executed from Windmill
- Agentic reasoning: Mastra
- System-of-record application state: Convex

## D1-D11 Shaping Decisions

### D1 - Client portal form factor

Choice: Responsive web for MVP, with PWA readiness as a Phase 2 enhancement.

Rationale:
- Fastest route to production.
- Matches the current TanStack Start portal baseline.
- Keeps document-upload, insight-review, and action-centre UX in one codebase.
- Mobile-camera UX can be improved later without blocking backend foundations.

### D2 - OCR strategy

Choice: Hybrid OCR using Docling through Windmill as the primary path, with room for model-assisted fallback later.

Rationale:
- Keeps OCR in a controlled workflow layer.
- Aligns with the user's instruction to use Windmill + Docling.
- Lets document validation, OCR, extraction, retry, and failure handling live in one orchestration system.
- Avoids embedding OCR logic directly into portal apps or Convex actions.

### D3 - AI model strategy

Choice: Split strategy.
- Classification and extraction support: Windmill tasks and targeted model calls.
- Agent reasoning and exception handling: Mastra.
- Forecasting: non-LLM numeric methods in Windmill jobs.
- Embeddings/search enrichment: deferred until search design is finalized.

Rationale:
- Keeps deterministic pipeline steps out of agents.
- Uses Mastra only where tool selection, narrative synthesis, or exception reasoning adds value.
- Avoids using LLMs for numeric forecasting where classical methods are stronger.

### D4 - Property data sources

Choice: Partner-API-first design, with compliant scraping abstracted behind Windmill flows later.

Rationale:
- Keeps source ingestion isolated from product business logic.
- Supports legal review, kill switches, and source-specific monitoring in Windmill.
- Avoids coupling the product domain model to any single source format.

### D5 - Workflow orchestration

Choice: Windmill for MVP and near-term scale paths.

Rationale:
- This repo is already wired for Windmill sync and workspace assets.
- Windmill is the right place for retries, schedules, fan-out/fan-in, failure handling, and job inspection.
- Keeps asynchronous AI work outside Convex transactions.

### D6 - Real-time delivery

Choice: Convex-backed product state with client polling first, then tenant-scoped realtime subscriptions where justified.

Rationale:
- Avoids overdesigning a separate event bus before core state exists.
- Lets Windmill produce durable state changes while Convex exposes them to portals.
- Realtime semantics should be layered on top of durable state, not replace it.

### D7 - Identity and SSO

Choice: External B2B identity provider for staff and clients, integrated into Convex auth.

Rationale:
- The current localStorage auth must be retired.
- Staff MFA and possible enterprise SSO should be handled by a proper identity layer.
- Convex should resolve identity and tenant context server-side.

### D8 - Database, object storage, and search

Choice:
- Database: Convex for application state and business logic.
- Object storage: Windmill-managed or compatible object storage for original files and derived artifacts.
- Search: staged approach, starting with structured lookup and full-text planning, then semantic search when document volume justifies it.

Rationale:
- Convex fits app-state queries, tenant-aware APIs, and workflow projections.
- Original binary files do not belong in Convex documents.
- Search should follow actual query patterns rather than be overbuilt now.

### D9 - Observability

Choice: Windmill job history + structured application logging + explicit audit/event models in Convex.

Rationale:
- Windmill already provides job execution visibility.
- Convex should expose domain-level events and audit records.
- Operational observability and business auditability must be separate concerns.

### D10 - Hosting and infrastructure

Choice: In-region primary deployment target remains required; detailed vendor choice deferred, but the architecture assumes separate dev, staging, prod, and audit concerns.

Rationale:
- The ADR requires SA-aligned residency.
- Final cloud/vendor choice is still a shaping decision, but the system boundaries can be designed now.
- IaC remains mandatory once implementation begins.

### D11 - Multi-tenancy isolation model

Choice: Shared application model with strict tenant-aware state design and server-side identity resolution, while keeping room for enterprise exceptions later.

Rationale:
- Supports MVP velocity.
- Matches the need for a single operational product surface.
- Tenant isolation must be enforced through the backend model and APIs, never through frontend filtering.

## Phase Plan

### Phase 0 - Scope Lock

Outcome:
- One active UI baseline.
- One mandated backend workflow stack.
- No ambiguity about which app drives backend design.

Execution:
- [x] Quarantine `megatrend/`.
- [x] Declare `insightful-property-hub/` as the baseline.
- [x] Record Windmill + Docling + Mastra + Convex as the architecture direction.

### Phase 1 - Domain And State Design

Outcome:
- Stable nouns, relationships, and lifecycle states before codegen or schema work.

Deliverables:
- [x] Domain model.
- [x] Shared status enums.
- [x] State machines.
- [x] Event taxonomy.
- [x] Audit taxonomy.

### Phase 2 - Tenancy, Identity, And Audit

Outcome:
- The platform becomes safe to build on.

Deliverables:
- [x] tenant
- [x] organization
- [x] membership
- [x] staff role model
- [x] client role model
- [x] auth integration contract using Convex Auth
- [x] audit chain model
- [x] export and retention model

## Phase 2 Deliverables

### Tenant model

`Tenant` is the hard isolation boundary for all business data.

Required fields:
- `tenantId`
- `slug`
- `displayName`
- `status`
- `createdAt`
- `createdBy`
- `primaryRegion`
- `settingsId`

Rules:
- Every business record must resolve to one and only one tenant.
- Tenant context is derived server-side from authenticated identity and membership, never from client-supplied tenant IDs.
- Staff access to a tenant is explicit and revocable.
- Client users can only belong to one tenant in the MVP model.

### Organization model

`Organization` is the tenant-facing company container inside a tenant.

Required fields:
- `organizationId`
- `tenantId`
- `name`
- `slug`
- `status`
- `primaryContactName`
- `primaryContactEmail`
- `createdAt`
- `createdBy`

Rules:
- For MVP, one tenant maps to one client organization for portal access.
- Future support for multiple organizations under one tenant is allowed without breaking the core model.
- Organization records own client-facing memberships and tenant-visible contact governance.

### Membership model

`Membership` links an identity to a tenant and optionally to an organization.

Required fields:
- `membershipId`
- `tenantId`
- `organizationId` nullable
- `principalType` = `staff` or `client`
- `principalId`
- `roleKey`
- `status`
- `createdAt`
- `createdBy`
- `revokedAt` nullable
- `revokedBy` nullable

Rules:
- Membership is the source of authorization.
- A user may have multiple memberships as staff across tenants.
- A client user should have one active membership per tenant in MVP.
- Suspended or revoked memberships must immediately block access in Convex authorization checks.

### Staff role model

Staff roles are Megatrend-internal and cross-tenant by assignment.

Initial role set:
- `platform_admin`
- `tenant_admin`
- `account_manager`
- `operations_analyst`
- `finance_reviewer`
- `read_only_staff`

Role intent:
- `platform_admin`: global administration, tenancy setup, policy control.
- `tenant_admin`: tenant-scoped governance, membership changes, thresholds, visibility.
- `account_manager`: review, publish, relationship management, sourcing oversight.
- `operations_analyst`: document triage, extraction review, workflow operations.
- `finance_reviewer`: invoice, utility, anomaly, and financial review workflows.
- `read_only_staff`: inspection without mutation rights.

### Client role model

Client roles are tenant-local and organization-facing.

Initial role set:
- `client_admin`
- `property_manager`
- `finance_user`
- `legal_reviewer`
- `executive_viewer`

Role intent:
- `client_admin`: manage team membership, access, and portal governance.
- `property_manager`: handle property actions, renewal decisions, and operational requests.
- `finance_user`: review invoice, utility, and payment-related records.
- `legal_reviewer`: review lease, annexure, and document obligations.
- `executive_viewer`: read-only access to high-level portfolio and insight views.

### Auth integration contract using Convex Auth

Architecture choice:
- Use `convex/auth.config.ts` for JWT-based authentication provider registration.
- Use an external identity provider for staff and clients.
- Use `ctx.auth.getUserIdentity()` in Convex functions.
- Use `identity.tokenIdentifier` as the canonical stable identity key.
- Use `ConvexProviderWithAuth` on the client when authenticated product calls are required.

Required backend auth files and contracts:
- `convex/auth.config.ts`
- `convex/schema.ts` auth-related tables
- `convex/<module>.ts` auth-aware queries and mutations
- tenant-resolution helper that maps `tokenIdentifier` to active memberships

Required client contract:
- portal and Megatrend apps must not trust route params for access control.
- authenticated frontend calls must rely on server-side tenant resolution.
- route params may select UI context only after authorization succeeds.

Authorization rules:
- Never pass `userId` or `tenantId` from the client for authorization.
- Every protected query or mutation resolves identity from Convex auth.
- Every protected query or mutation resolves active membership before reading tenant data.
- Cross-tenant access must fail closed.

### Audit chain model

`AuditEvent` is append-only and tamper-evident at the application level.

Required fields:
- `auditEventId`
- `tenantId`
- `eventType`
- `actorType`
- `actorId`
- `targetType`
- `targetId`
- `correlationId`
- `sourceSystem`
- `occurredAt`
- `payloadBefore` nullable
- `payloadAfter` nullable
- `reason` nullable
- `prevHash`
- `eventHash`

Hashing model:
- `eventHash` is computed from the normalized event body plus `prevHash`.
- `prevHash` points to the previous audit event in the tenant-scoped chain.
- The chain is append-only; no in-place mutation of prior events.

Write rules:
- Publish/reject decisions must emit audit events.
- Membership and role changes must emit audit events.
- Manual reruns, cancellations, and reprocessing requests must emit audit events.
- Access-denied and security-relevant events should emit audit events or security events depending on retention policy.

### Export and retention model

Export capabilities:
- tenant-scoped audit export
- tenant-scoped document metadata export
- tenant-scoped published insight export
- tenant-scoped membership export

Retention model by class:
- audit events: 7-year default retention
- source documents: retained by class and contract policy
- extracted artifacts: retained while operationally useful and policy-compliant
- authentication/access logs: retained according to security and compliance policy
- deleted membership and role-change records: preserved in audit history

Operational rules:
- exports must be tenant-scoped and authorization-checked.
- deletion workflows must preserve required audit evidence.
- retention should be policy-driven, not hard-coded per screen.
- document retention schedules belong in tenant settings and document-class policy.

### Convex implementation boundary for later phases

This phase now has initial Convex scaffolding in place:
- `convex/schema.ts` defines tenant, organization, membership, role, audit, and export-job tables.
- `convex/auth.config.ts` defines the Convex Auth registration contract with placeholder OIDC values.
- `convex/users.ts` and `convex/tenancy.ts` provide the first auth-aware user and tenancy APIs.
- `convex/lib/auth.ts` and `convex/lib/audit.ts` provide shared authorization and append-only audit helpers.

Remaining implementation work before production rollout:
- replace placeholder OIDC issuer and audience values with the selected identity provider configuration
- seed and govern role records consistently from backend policy
- implement export execution and retention enforcement workflows
- wire authenticated frontend clients through `ConvexProviderWithAuth`

### Phase 3 - Document Intake And OCR

Outcome:
- Documents move through a real ingestion pipeline.

Windmill responsibilities:
- file intake
- validation
- malware or file safety hook
- object storage write
- Docling OCR and extraction
- retries
- dead-letter handling
- job telemetry

Mastra responsibilities:
- reasoning over ambiguous extraction cases
- narrative synthesis when needed
- tool-driven review support

Convex responsibilities:
- document metadata
- processing state
- extracted-field state
- review queues
- publication state

### Phase 4 - Inbox, Curation, And Insight Publishing

Outcome:
- Megatrend gets the operating console the client portal already implies.

Deliverables:
- operational inbox
- curation queue
- approve/reject/publish flow
- client-visible published insights
- source linkage and review notes

### Phase 5 - Automation And Notifications

Outcome:
- Windmill workflows become visible as durable product actions.

Deliverables:
- workflow-run projection into Convex
- notification model
- renewal reminders
- anomaly escalations
- stalled-job alerts
- client and staff timeline events

### Phase 6 - Property Scout

Outcome:
- Lease watcher and matching engine become real product capabilities.

Deliverables:
- sourcing brief schema
- comparable-property schema
- candidate scoring
- shortlist lifecycle
- business-case report generation
- review/publish path into client and Megatrend portals

## Backend Domain Model

### Core entities

- Tenant
- Organization
- StaffUser
- ClientUser
- Membership
- Role
- PermissionGrant
- ClientAccount
- Property
- Lease
- LeaseClause
- SourceDocument
- DocumentArtifact
- DocumentProcessingJob
- ExtractedField
- ExtractedTable
- InsightDraft
- InsightPublication
- ActionItem
- Invoice
- UtilityStatement
- AnomalyFinding
- SourcingBrief
- PropertyCandidate
- CandidateScore
- WorkflowDefinition
- WorkflowRun
- Notification
- AuditEvent

### Ownership model

- `Tenant` is the isolation boundary.
- `Organization` belongs to one `Tenant`.
- `ClientUser` and client-facing records are tenant-scoped.
- `StaffUser` can have access to multiple tenants through explicit assignment.
- Every business record must carry a tenant-resolvable ownership path.

### Document model

- `SourceDocument` stores the original uploaded file metadata.
- `DocumentArtifact` stores derived outputs such as OCR text, extracted JSON, or rendered previews.
- `DocumentProcessingJob` tracks Windmill execution state.
- `ExtractedField` stores structured extractions with confidence and review state.

### Insight model

- `InsightDraft` is internal.
- `InsightPublication` is client-visible.
- Publication must reference reviewer identity and source evidence.

### Workflow model

- `WorkflowDefinition` describes business workflow type and configuration.
- `WorkflowRun` stores execution instances and external job references.
- Windmill job IDs should be projected into `WorkflowRun` for traceability.

## State Machines

### Document processing

`uploaded -> validating -> accepted -> queued_for_ocr -> ocr_complete -> extraction_complete -> review_required -> approved -> published`

Failure side states:
- `validation_failed`
- `ocr_failed`
- `extraction_failed`
- `dead_lettered`

### Extracted field review

`detected -> low_confidence_review -> approved -> superseded`

Optional rejection branch:
- `rejected`

### Insight lifecycle

`drafted -> under_review -> approved_for_publish -> published`

Exception states:
- `rejected`
- `sent_back_for_revision`
- `withdrawn`

### Action item lifecycle

`open -> in_progress -> waiting_on_client -> waiting_on_megatrend -> completed`

Exception states:
- `overdue`
- `cancelled`

### Sourcing brief lifecycle

`draft -> submitted -> matching -> shortlist_ready -> under_megatrend_review -> published_to_client -> closed`

### Workflow run lifecycle

`queued -> running -> succeeded`

Failure side states:
- `retrying`
- `failed`
- `dead_lettered`
- `cancelled`

## Standard Status Enum Direction

These should be reused across internal and client surfaces where applicable.

### Document status

- `uploaded`
- `validating`
- `processing`
- `under_review`
- `approved`
- `published`
- `failed`

### Insight status

- `draft`
- `under_review`
- `approved`
- `published`
- `rejected`

### Action status

- `open`
- `in_progress`
- `waiting_on_client`
- `waiting_on_megatrend`
- `completed`
- `overdue`

## Event Taxonomy

### Domain events

- `tenant.created`
- `organization.created`
- `organization.membership_added`
- `organization.membership_removed`
- `client_account.created`
- `property.created`
- `property.updated`
- `lease.created`
- `lease.updated`
- `lease.renewal_window_opened`

### Document pipeline events

- `document.uploaded`
- `document.validation_passed`
- `document.validation_failed`
- `document.queued_for_ocr`
- `document.ocr_completed`
- `document.ocr_failed`
- `document.extraction_completed`
- `document.extraction_failed`
- `document.review_required`
- `document.approved`
- `document.published`

### Insight and curation events

- `insight.drafted`
- `insight.sent_for_review`
- `insight.approved`
- `insight.rejected`
- `insight.published`
- `insight.withdrawn`

### Action and workflow events

- `action_item.created`
- `action_item.reassigned`
- `action_item.overdue`
- `action_item.completed`
- `workflow_run.queued`
- `workflow_run.started`
- `workflow_run.retried`
- `workflow_run.failed`
- `workflow_run.dead_lettered`
- `workflow_run.succeeded`

### Notification events

- `notification.queued`
- `notification.sent`
- `notification.failed`
- `notification.read`

## Audit Taxonomy

### Identity and access audit events

- `auth.login_succeeded`
- `auth.login_failed`
- `auth.logout`
- `auth.mfa_challenged`
- `auth.mfa_satisfied`
- `access.denied`
- `membership.role_changed`

### Administrative audit events

- `tenant.configuration_changed`
- `organization.provisioned`
- `organization.settings_changed`
- `user.invited`
- `user.deactivated`

### Data and workflow audit events

- `document.upload_requested`
- `document.review_decision_recorded`
- `document.reprocess_requested`
- `insight.review_decision_recorded`
- `insight.publish_requested`
- `insight.publish_completed`
- `workflow.manual_rerun_requested`
- `workflow.manual_cancel_requested`

### Audit record minimum fields

- `event_type`
- `tenant_id`
- `actor_type`
- `actor_id`
- `target_type`
- `target_id`
- `occurred_at`
- `correlation_id`
- `source_system`
- `before`
- `after`
- `reason`

## Internal Inbox And Curation Workflow Design

### Inbox lanes

- New uploads
- Extraction exceptions
- Draft insights awaiting review
- Renewal alerts
- Client action requests
- Failed automation runs

### Core inbox actions

- assign
- review extraction
- request missing evidence
- approve
- reject
- publish
- escalate
- re-run workflow

### Curation rules

- No client-visible publication without human review.
- Every published insight must link to evidence.
- Low-confidence extractions cannot directly update approved lease intelligence.
- All publish and reject decisions emit audit events.

## Execution Order

1. Tenancy, identity, and audit.
2. Documents and OCR pipeline.
3. Inbox and curation.
4. Insights and notification workflows.
5. Property scout and matching.

## Immediate Completed Work In This Phase

- Quarantined the starter app at the documentation level.
- Declared the active UI baseline.
- Selected Windmill, Docling, Mastra, and Convex roles.
- Produced the shaping decisions.
- Produced the backend domain model.
- Produced the shared status enum direction.
- Produced the first-pass state machine spec.
- Produced the event taxonomy.
- Produced the audit taxonomy.
- Produced the execution tracker.
- Implemented the initial Convex Phase 2 schema for tenancy, membership, audit, and export models.
- Implemented shared Convex validators for role, status, and source-system enums.
- Implemented auth-aware user sync and tenancy queries or mutations.
- Implemented append-only audit chain hashing helpers.
- Regenerated Convex bindings and passed `npx tsc -p convex/tsconfig.json`.
