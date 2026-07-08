# Megatrend Platform Alignment Report

Date: 2026-07-08

Scope reviewed:
- ADR source: `business requirements/Megatrend-Platform-ADR-VendorNeutral.pdf`
- Main frontend prototype: `insightful-property-hub/`
- Secondary frontend app: `megatrend/`
- Backend workspace state: `convex/`

## Executive Summary

The platform vision in the ADR is clear enough to begin backend planning at the domain level, but not clear enough to start implementation safely without a shaping pass on tenancy, identity, workflow, audit, and data contracts.

The current UI prototype in `insightful-property-hub` is directionally strong:
- it already expresses the two-sided product model,
- it covers many of the major modules,
- it shows a credible client portal and Megatrend staff portal relationship,
- and it demonstrates human-reviewed insight publishing better than the ADR itself explains visually.

However, the implementation is still a prototype:
- nearly all business views run on `mock-data.ts`,
- portal auth and tenant provisioning run on `localStorage`,
- there is no real database schema,
- there are no Convex tables or business functions yet,
- and several ADR-critical capabilities are either missing or only implied in copy.

The separate `megatrend/` app is not aligned to the ADR at all. It is still a starter app and should not be treated as part of the product surface for backend planning.

## High-Level Alignment

| ADR capability | Current state | Alignment |
| --- | --- | --- |
| Client Portal auth and workspace | Login, dashboard, actions, documents, insights, property detail, lease detail, team exist in `insightful-property-hub/src/routes/portal.*` | Partial |
| Megatrend CRM Portal | Dashboard, clients, leases, properties, documents, invoices, sourcing, automations, reports, organizations exist in `insightful-property-hub/src/routes/_app.*` | Partial |
| Document ingestion and OCR UX | Upload and review states are represented in UI | Partial |
| AI insight curation and publish flow | Client UI strongly implies reviewed vs raw data; admin-side curation workflow is not implemented | Partial |
| Property Scout / expiry watcher | Renewal and sourcing views exist; true matching pipeline and business-case workflow are not implemented | Partial |
| Searchable repository | Search page exists, but it is mock and not full-text or semantic | Partial |
| Tenant administration | Organization provisioning and team management exist, but only as mock local state | Partial |
| Audit and compliance | No actual audit explorer, immutable log, retention/export workflow, or admin inspection surface | Missing |
| Real-time event bus | No real-time channel implementation | Missing |
| Identity, MFA, SSO, RBAC | Minimal prototype roles only; no real auth architecture | Missing |
| Data layer | No actual schema or backend model in `convex/` | Missing |
| Workflow orchestration | Automation screens exist, but no orchestration engine or job state model exists | Missing |

## What Is Aligned

### Product structure

The prototype correctly reflects the ADR's dual-sided architecture:
- client-facing portal routes under `portal.$clientSlug.*`
- internal Megatrend workspace routes under `_app.*`

This is a good foundation for backend module planning.

### Major module coverage in the UI

The internal portal already expresses most primary business modules:
- dashboard
- clients
- leases
- properties
- documents
- invoices
- sourcing
- automations
- reports
- organizations / tenant provisioning

The client portal also has a coherent module set:
- portfolio dashboard
- actions
- documents
- insights
- property detail
- lease detail
- team

### Human-in-the-loop publishing

This is one of the strongest aligned areas.

The ADR requires AI not to publish directly to clients. The client portal explicitly distinguishes:
- AI extracted fields
- human-approved lease intelligence
- curated client insights

That matches principle `P3 Human-in-the-loop AI` well at the UX level.

### Renewal and property workflow narrative

The UI already expresses the business intent around:
- expiry horizons
- renewal windows
- sourcing briefs
- ranked options
- client follow-up actions

That matches the ADR's lease watcher and property scout direction, even though the underlying logic is not implemented.

## What Is Not Aligned

### 1. The `megatrend/` app is not part of the actual product

`megatrend/src/routes/index.tsx` is still a starter page with random-number demo state. It does not represent either:
- the Megatrend CRM Portal, or
- the Client Portal

Impact:
- it creates architectural ambiguity,
- it can mislead backend planning,
- and it should not be treated as a valid target for API or schema design.

### 2. Multi-tenancy is not enforced at the data layer

The ADR makes this a hard principle. The current prototype does the opposite:
- tenant access is inferred from route params and `localStorage`
- portal orgs/users/sessions are stored in browser state
- no server-side tenancy boundary exists

This is the single biggest architecture misalignment.

### 3. No real CRM inbox exists

The ADR explicitly calls for:
- an inbox of new uploads
- AI-drafted insights
- urgency ranking

The internal dashboard shows recent activity and document/task cards, but there is no dedicated operational inbox with:
- queue states
- assignment
- urgency ordering
- triage actions
- publish/reject/rework workflow

### 4. No real curation console exists

The ADR requires a curation interface to:
- edit
- approve
- reject
- publish insights

The client portal shows curated output, but the Megatrend side does not yet have a proper review/publish workspace for:
- extracted fields
- insight drafts
- approval thresholds
- version history
- publish destinations

### 5. Search does not match the ADR

The ADR calls for full-text and semantic search across documents and records.

Current search is only a mock UI with hard-coded result logic. There is no:
- document index
- semantic retrieval
- searchable extracted fields
- source-linked result graph

### 6. Audit and compliance capabilities are absent

The ADR requires:
- tamper-evident audit chain
- write-once mirror
- tenant export capability
- CRM audit explorer

None of those are present in the current UI or backend.

### 7. Identity and access are far below ADR requirements

The ADR requires:
- organisations
- roles
- SSO support path
- MFA for staff
- tenant identity propagation

Current prototype supports:
- org slug
- username/password
- `admin` / `member`

That is not enough for backend implementation without a proper auth decision.

### 8. Real-time behavior is only implied, not implemented

The ADR expects live cross-portal updates and graceful degradation. Current UI has no actual:
- event bus
- websocket/push channel
- polling fallback
- notification stream

### 9. MVP boundaries are blurred in the UI

The ADR puts some capabilities in Phase 2:
- automated insight generation
- property scout engine
- PWA/mobile polish

The prototype exposes several of these as if they already exist operationally. This is useful for concepting, but not clean enough for backend scoping unless features are tagged as:
- MVP
- Phase 2
- demo-only

## What Is Missing

### Missing backend/domain contracts

The UI does not yet define stable backend contracts for:
- tenant
- organization
- staff user
- client user
- role and permissions
- client account
- property
- lease
- lease clause / extracted field
- source document
- document processing job
- extracted document payload
- insight draft
- published insight
- action/task
- invoice / utility statement
- anomaly finding
- sourcing brief
- property candidate / comparable
- workflow definition
- workflow run
- notification
- audit event

### Missing lifecycle/state models

Several important states are implied in copy but not formalized:
- document validation states
- extraction review states
- insight draft -> reviewed -> published states
- task ownership and escalation states
- sourcing brief lifecycle
- comparable-property shortlist lifecycle
- notification delivery status
- audit retention/export states

### Missing operational configuration model

The ADR requires per-tenant configuration for things like thresholds and horizons. There is no explicit model yet for:
- renewal horizon per tenant
- publish confidence threshold
- anomaly thresholds by document type
- notification preferences
- document retention policies
- allowed document classes per tenant
- source enablement / kill switches

### Missing migration and system-of-record decisions

The ADR asks an open question about current lease system of record and migration. The frontend does not answer:
- where source data comes from,
- what is authoritative,
- how data is seeded,
- or how historical records get normalized.

## What Needs To Be Added

### Backend architecture artifacts before implementation

Add these before building the database and business logic:
- domain model map
- entity relationship model
- tenant isolation model
- role/permission matrix
- workflow state machine definitions
- event taxonomy
- audit event schema
- document processing contract
- insight curation contract
- notification contract

### Internal Megatrend views that still need to exist

Add dedicated internal views for:
- operational inbox / triage queue
- insight curation and publishing
- audit log explorer
- tenant settings / thresholds
- notification center
- failed jobs / dead-letter queue inspection
- document processing exceptions

### Client portal capabilities that should be added

Add client-facing features for:
- meaningful notifications center
- upload history with retry / replace behavior
- clearer request / quote submission flow
- role distinctions beyond admin/member
- evidence of review status on insights and documents
- activity / history timeline per property or per lease

## What Needs To Be Configured

These ADR decisions need to be made before backend implementation gets deep:
- `D1` client portal form factor
- `D2` OCR strategy
- `D3` AI model strategy
- `D4` property data sources
- `D5` workflow orchestration approach
- `D6` real-time delivery mechanism
- `D7` identity and SSO approach
- `D8` DB, object storage, search stack
- `D9` observability stack
- `D10` hosting and infra model
- `D11` multi-tenancy isolation model

Also configure explicit MVP NFR targets for:
- upload acknowledgement latency
- publish latency
- search latency
- retention window
- audit retention
- failure retry policy
- dead-letter handling

## UI/UX Changes Needed So Client Portal and Megatrend OS Stay Aligned

### 1. Make workflow ownership visible on both sides

The client portal already shows reviewed outputs. The Megatrend side needs mirrored workflow states so both portals refer to the same objects:
- same document statuses
- same insight statuses
- same action states
- same renewal milestones

Right now the client UX is sometimes more mature than the internal curation UX.

### 2. Normalize status language across both portals

Current labels vary across modules. Standardize vocabulary for:
- uploaded
- validating
- processing
- under review
- approved
- published
- failed
- action required

This is important before backend schema design because status enums will harden quickly.

### 3. Add a true Megatrend review-and-publish surface

The client portal makes promises about reviewed data that the internal portal cannot yet operationally fulfill. Add an internal review screen for:
- extracted fields
- insight draft text
- source document linkage
- publish decision
- change notes

### 4. Align navigation by business workflow, not just by data bucket

The current internal nav is useful, but still organized as prototype buckets. Before backend build, decide whether the operating model is centered on:
- inbox/queues first
- records first
- workflows first

The current UI mixes all three.

### 5. Clarify MVP vs later-phase features in the UI

Tag or visually separate:
- live MVP workflows
- planned automation
- demo-only predictive outputs

Without this, backend planning will overbuild for phase-2 behavior too early.

### 6. Improve client/mobile upload experience if mobile capture matters

The ADR explicitly mentions mobile-camera capture. Current client upload UX is desktop-oriented and mock-only. If mobile capture is required for MVP, design:
- camera capture flow
- upload progress
- upload failure recovery
- duplicate detection
- per-file review state

## Backend Readiness Assessment

## Clear enough to start now

You can safely start planning the backend around these bounded domains:
- tenancy and identity
- clients and organizations
- properties
- leases
- documents
- document extraction results
- insights
- actions/tasks
- invoices and anomalies
- sourcing briefs and candidate properties
- automation/workflow runs
- notifications
- audit events

## Not clear enough yet

Do not lock schema or business logic deeply until you define:
- source of truth and migration rules
- role model for Megatrend staff vs client roles
- publish/review workflow states
- tenant configuration model
- search/indexing strategy
- audit retention/export requirements
- eventing model
- infrastructure decisions from ADR section 5

## Recommended Order Before Backend Build

1. Retire or quarantine the `megatrend/` starter app from solution scope.
2. Declare `insightful-property-hub` as the active product UI baseline.
3. Run a shaping pass to fill ADR decisions `D1-D11`.
4. Produce a backend domain model and state machine spec.
5. Standardize status enums across client and internal UIs.
6. Design the internal inbox + curation workflow before implementing documents and insights backend logic.
7. Design tenancy/auth/audit first, then documents, then insights/workflows, then property scout.

## Report of What Is Left

### Must change before backend implementation

- Replace prototype tenant/session logic with real server-side identity and tenant enforcement.
- Define the core database schema and object relationships.
- Add a true internal inbox and insight curation workflow.
- Add an audit/compliance model and explorer.
- Decide the workflow engine, search strategy, and realtime approach.
- Standardize shared statuses and workflow states across both portals.

### Should change before serious integration work

- Remove ambiguity around the unused `megatrend/` app.
- Mark MVP vs Phase 2 capabilities in the UI.
- Add tenant settings and threshold configuration surfaces.
- Add notification UX on both sides.
- Clarify mobile upload expectations.

### Can wait until after backend foundations

- advanced reporting polish
- PWA/mobile packaging
- white-labeling
- payment integration
- public API

## Bottom Line

The current UI is good enough to drive backend planning, but not good enough to wire directly into a database without a shaping layer in between.

The best next step is not database coding yet. The best next step is:
- finalize ADR decisions,
- lock the domain model,
- define workflow states and permissions,
- and bring the internal Megatrend review workflow up to the same clarity the client portal already shows.
