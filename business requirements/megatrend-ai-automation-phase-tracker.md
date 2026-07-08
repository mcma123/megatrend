# Megatrend Backend And AI Automation Phase Tracker
Date started: 2026-07-08
## Rules
- Track completion here as phases move from planning into implementation.
- Only tick implementation items when code, workflow definitions, and required docs are actually in place.
- Windmill owns AI workflow execution.
- Docling, through Windmill, owns OCR and structured document extraction.
- Mastra owns agent reasoning and calls Windmill scripts or flows as tools when agentic behavior is required.
- Convex owns application data, tenancy-aware business state, and query or mutation APIs.
## Phase 0 - Scope Lock
- [x] Quarantine megatrend/ starter app from active product scope.
- [x] Declare insightful-property-hub/ as the active product UI baseline.
- [x] Record the stack decision: Windmill + Docling + Mastra + Convex.
- [ ] Remove or archive unused starter-app references from product-facing docs and workflows.
## Phase 1 - Shaping And Architecture Decisions
- [x] Create phased implementation plan.
- [x] Produce ADR shaping decisions D1-D11.
- [x] Choose Windmill for workflow orchestration.
- [x] Choose Docling via Windmill for OCR strategy.
- [x] Choose Mastra only where agent reasoning is necessary.
- [ ] Confirm pilot-client assumptions and migration constraints with stakeholders.
- [ ] Confirm in-region hosting, identity provider, and compliance constraints.
## Phase 2 - Domain And State Design
- [x] Produce backend domain model.
- [x] Produce core state machine specification.
- [ ] Review domain model against existing UI routes and data requirements.
- [x] Finalize shared status enums for client and internal portals.
- [x] Finalize event taxonomy and audit-event taxonomy.
## Phase 3 - Tenancy, Identity, And Audit Foundation
- [x] Design tenant isolation model.
- [x] Design organization, staff, and client-user model.
- [x] Define RBAC matrix.
- [x] Define auth provider integration contract.
- [x] Define audit-chain model and retention/export behavior.
- [x] Define Convex schema and APIs for tenancy/auth/audit.
- [ ] Replace placeholder Convex auth provider values with the selected OIDC issuer and application ID.
- [x] Wire authenticated frontend clients through Convex Auth-aware providers.
## Phase 4 - Document Intake And OCR Automation
- [ ] Define document intake schema and storage model.
- [ ] Define Windmill intake flow: validate -> store -> queue -> OCR -> extract.
- [ ] Define Windmill Docling script contract.
- [ ] Define extraction result schema and confidence thresholds.
- [ ] Define exception and dead-letter handling for failed OCR/extraction.
- [ ] Define Mastra tool surfaces for document-processing review or reasoning.
## Phase 5 - Inbox, Curation, And Insight Publishing
- [ ] Design Megatrend inbox and triage queue.
- [ ] Design insight-draft, review, reject, approve, publish workflow.
- [ ] Define client-visible vs internal-only insight states.
- [ ] Define human-review checkpoints before client publication.
- [ ] Define Convex APIs for inbox, curation, and published insights.
## Phase 6 - Workflow, Notifications, And Realtime
- [ ] Define workflow run model and job-state projection into Convex.
- [ ] Define notification model across client and Megatrend portals.
- [ ] Define realtime event channels and fallback behavior.
- [ ] Define schedule-driven automation for renewals, anomalies, and reminders.
- [ ] Define operational monitoring surfaces for failed or stalled workflows.
## Phase 7 - Property Scout And Matching
- [ ] Define sourcing brief model.
- [ ] Define comparable-property ingestion model.
- [ ] Define scoring pipeline and shortlist lifecycle.
- [ ] Define business-case report generation workflow.
- [ ] Define client and Megatrend review touchpoints for property scout outputs.
## Phase 8 - Implementation Readiness Gate
- [ ] Status enums standardized across both portals.
- [ ] Domain model approved.
- [ ] State machines approved.
- [ ] Tenancy/auth/audit contracts approved.
- [ ] Document/OCR automation design approved.
- [ ] Inbox/curation design approved.
- [ ] Property scout design approved.
- [ ] Ready to start backend implementation.
