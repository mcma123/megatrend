# Project AI Agent Instructions

This file is the entry point for AI agents working in this repository. It is
**user-owned** ? `wmill` never overwrites it. Add your project-specific
guidance below the include line.

The line below pulls in Windmill's managed CLI guidance (skills, deploy flow,
debugging jobs, etc.). Refresh it with `wmill refresh prompts`. Remove the
include line if you don't want the managed guidance in this project.

@AGENTS.wmill.md

## Project-specific instructions

Deploy mode: wmill sync push (no CI wiring detected).
- Windmill target: workspace `cyphersoft` on `http://automation-servers-windmill-7973c1-187-124-215-81.sslip.io/` (bound in `wmill.yaml`; CLI profile `cyphersoft`). Use `npm run wmill:push` / `npm run wmill:pull`, always after a `--dry-run`.
- The `cyphersoft` workspace is shared with other projects (e.g. `f/rebsons`). `wmill.yaml` `includes` is scoped to `f/clitools/**`, `f/docling/**`, `f/firecrawl/**`, and the user-approved `f/signing/**`; never widen it to `f/**`, or a push could delete and a pull could import other projects.
- `f/docling/*` reads MinIO from Windmill variables `f/docling/MINIO_ENDPOINT` (in repo) and the secrets `f/docling/MINIO_ACCESS_KEY` / `f/docling/MINIO_SECRET_KEY` (workspace only, a bucket-scoped key for `parsedinjson` and `okfdata`). Never hard-code MinIO credentials in scripts or flow defaults.
- Workspace object storage (`wmill.write_s3_file`, used by `f/docling/scanner/save_scanned_document`) points at resource `f/docling/scanner/minio_storage` (MinIO bucket `scanner`, secret `f/docling/scanner/S3_SECRET_KEY`); keep that resource file in the repo so pushes don't delete it.
- App document pipeline: flow `f/docling/process_document_for_app` (Docling parse → OKF bundle under `<tenant-slug>/<document-id>` → `f/docling/extract_document_fields` → compact summary) is started by Convex (`convex/processing.ts`). Extraction calls OpenRouter with the workspace secret `f/docling/OPENROUTER_API_KEY` (not in the repo). Keep the field keys in `extract_document_fields.py` stable; Convex stores them.
- Roadmap for replacing static/mock data with real Convex data, document upload and processing: `backend functionality.md` (phased checklists). Tick boxes there as phases are completed.
- Document-processing hardening execution plan: `docling_file.md`. Execute its phases in order and tick tasks/phases only after their implementation and acceptance checks pass; record verification evidence and track production rollout separately.
- Contract/lease signing execution plan: `signing_module.md`. Implement and verify phase by phase; track implementation separately from rollout. South Africa and uploaded PDFs first; Resend and certificate/timestamp services are approved architectural choices, not provisioned services. Signing automation is scoped to `f/signing/**`; provisioning and review evidence are documented in `insightful-property-hub/docs/signing-prerequisites.md`. Legal sign-off and verified operational prerequisites gate external signing. Do not represent a platform seal as a participant's accredited advanced signature.
- Signing-only Windmill releases must pass `--includes 'f/signing/**'` to both dry run and push (`npm run wmill:push -- --dry-run --includes 'f/signing/**'`). Do not apply unrelated automation drift as part of a signing release; shared-workspace configuration must be preserved.
- App document flow results use `contract_version: 1` and optional `attempt_id` for legacy callers. New artifact paths include `<tenant-slug>/<document-id>/<attempt-id>`; keep attempt identity aligned with `convex/processing.ts`. Run `python scripts/test-docling-summary.py` when changing the compact summary contract.
- The app flow accepts `retry_stage` (`parse`, `knowledge`, `extract`) and server-selected saved-parser inputs. Knowledge recovery skips field extraction; extraction recovery reuses parsing and the existing knowledge outcome. Keep conditional skips and error summaries aligned with Convex recovery ownership. Run `python scripts/test-docling-recovery.py` when changing saved-parser reuse; dependency locks remain valid when imports are unchanged.
- Active product UI baseline: `insightful-property-hub/`.
- Quarantine `megatrend/` from solution scope until it is explicitly reactivated for product work.
- Use Windmill for backend automation workflows.
- Use Docling through Windmill for OCR and document extraction workflows.
- Use Mastra for agentic behavior only, with Mastra agents/workflows calling Windmill scripts or flows as tools.
- Dokploy deployment for the active portal should target the frontend web app, not the Mastra runtime.
- Frontend deploy mode: GitHub `main` pushes auto-deploy through Dokploy at `https://admin.cyphersoftai.com`; check the existing deployment before triggering another build. Project `megatrend cyphersoft` (`DTHwIkrGDFxRu5PMv7D1O`), production environment `Gh5BE8xK1ajWOZH5Xbi8f`, application `cyphersoft-ai` (`a6APcV1FQrARkiITjO5SM`) serves `https://mega.cyphersoftai.com` on port 3000 using the root Dockerfile. Read the API key from local `.env.local` (`dokploy_API_Key`) without logging or committing it. Windmill deployment remains a separate scoped sync.
- Root `npm run build` and `npm run start` are reserved for the active `insightful-property-hub/` production web deployment; use `npm run build:mastra` and `npm run start:mastra` only for the Mastra service.
- Package manager is npm (`package-lock.json` at root and in `insightful-property-hub/`); the Dockerfile uses `npm ci`. Do not reintroduce pnpm/bun lockfiles: `mastra build` installs `.mastra/output` deps from the root lockfile/ranges, so a stale lock ships an older `@mastra/core` than the CLI that built the bundle. Keep `@mastra/*` ranges in `package.json` at the versions actually locked.
- CopilotKit uses matching `@ag-ui/client` / `@ag-ui/core` versions in root and frontend manifests. Root Zod is pinned to `3.25.76` for CopilotKit's peer compatibility; verify both builds and `npm test` before changing these versions. Rich assistant setup: `insightful-property-hub/docs/assistant.md`.
- Docker deployment can use `npm run start:platform` to run the portal and the built Mastra bundle in one container, with the web app on `PORT` and Mastra on `MASTRA_PORT`.
- Private document previews use Dokploy compose `document-preview` (`voYPBjctefOyoaz1Ujprr`) in the portal's production environment and internal Docker network `document-preview` (managed network `oyioL9Ksh02hBvjA-w38g`). Windmill compose `GWrb7pCXXdox56KucsIgi` persists the worker network attachments in its raw compose file; preserve their existing Windmill network too. No public converter ports/domain. Credentials remain in Dokploy env and Windmill workspace secrets; Convex uses its separate `WINDMILL_PREVIEW_TOKEN`.
- Keep AI document-processing business logic split clearly between:
  - Windmill orchestration and execution
  - Mastra agent reasoning and tool selection
  - Convex application data and business state

<!-- Add anything specific to this repo here. Examples:
     - Deploy commands or environments unique to this project.
     - Domain glossary, naming conventions, or "ask before X" rules.
     - Overrides for the managed guidance above (be explicit that they
       supersede the managed rule). -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:
- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

## Child DOX Index

- `src/mastra/` -> `src/mastra/AGENTS.md`: Root Mastra server, agent registration, tool wiring, and chat API surface.
- `convex/` -> `convex/AGENTS.md`: Convex backend rules, generated API surface, and Convex-specific operating constraints.
- `f/signing/` -> `f/signing/AGENTS.md`: Signing audit anchors, quarantined PDF preparation/scanning, supporting documents, immutable bundles, encrypted delivery, sealed finalisation and private company handover exports.
- `insightful-property-hub/` -> `insightful-property-hub/AGENTS.md`: Main TanStack Start frontend served by the root `dev:web` workflow.
- `megatrend/` -> `megatrend/AGENTS.md`: Quarantined standalone TanStack Start starter app, not part of the active product baseline.

Root-owned without a child AGENTS.md:
- `docker-compose.preview.yml`: Private Gotenberg converter definition; operational setup is documented in `insightful-property-hub/docs/document-viewer.md`.
- `docker-compose.signing-renderer.yml`: Separate private Gotenberg (Chromium HTML only, no JavaScript or network) for signing template rendering; setup is in `insightful-property-hub/docs/signing-prerequisites.md`. Never enable Chromium on the document-preview converter instead.
- Root execution plans: `backend functionality.md`, `docling_file.md`, and `signing_module.md`; maintain phase completion and verification evidence with the corresponding implementation work.
- `f/` except its indexed signing child: Windmill scripts, flows, folder metadata, and deployed automation assets.
- `scripts/`: Runtime wrappers such as `mastra-openrouter.mjs`, private signing MFA key preparation, and offline verification scripts.
- `scripts/codegen-convex-local.mjs`: Local Convex API/server binding generation through the installed official templates; no remote staging request. Supports this app's optional-string env declarations and fails on unsupported shapes. Run from the repository root after backend API/env changes, then typecheck both projects. `npx convex codegen` performs remote component analysis even though it does not release functions; prefer the local generator for offline implementation verification.
- Root manifests and workspace config: `package.json`, `wmill.yaml`, `tsconfig*.json`, `vitest.config.ts` (Convex, Mastra, and pure frontend assistant/proxy tests, `npm test`), lockfiles, env files, `.wmill-config/`.
- `vitest.config.ts` caps test workers at two so cold CopilotKit/Mastra imports do not starve Convex fixtures past the unchanged five-second test timeout. Run production builds separately from regression tests on this workstation.
- Tooling metadata and caches: `.agents/`, `.claude/`, `.mastra/`, `.mastra-temp/`, `.pnpm-store/`, `node_modules/`, and other generated runtime outputs.



