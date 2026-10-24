# Purpose

- Owns durable Mastra agent definitions under `src/mastra/agents/`.

# Ownership

- Owns every agent file in this folder, including `facebook-marketplace-agent.ts`, `insight-drafter-agent.ts`, `okf-agent.ts`, and `web-research-agent.ts`.

# Local Contracts

- Each file should export a stable agent surface that can be registered from `../index.ts`.
- Agent files may depend on `../tools/*` but should not duplicate shared tool transport or provider setup.
- Prompt and behavior changes that alter external expectations should be reflected in the nearest owning AGENTS.md.
- `okf-agent.ts` is the document-questioning agent for OKF bundles stored behind the Windmill-backed knowledge gateway. Keep its tool access focused on bundle discovery, retrieval, and grounded summarization rather than raw provider plumbing.
- `insight-drafter-agent.ts` has no tools: it turns a list of approved facts into one JSON insight draft (title, body, recommendedAction, category, priority). It is called through Mastra's REST `POST /api/agents/insight-drafter-agent/generate` by the web app's staff-only `/api/insights/draft` route; keep the JSON contract stable. Drafts are never published without staff review.

- `voice-assistant-agent.ts` (`VOICE_ASSISTANT_MODEL`, falls back to `OPENROUTER_MODEL`) uses only `voiceAssistantTools`. It finds/opens records, runs page commands and fills forms; data-changing commands and `submit_form` are prepared for the user's Confirm tap, and it must never claim they already happened. Its instructions forbid inventing values/ids and destructive actions; unmatched spoken facts go into a notes field as `Label: value` lines. It is not registered as a `/chat` agent.

# Work Guidance

- `rich-output-instructions.ts` enables grounded cards/tables/charts/drafts only when the authenticated CopilotKit route sets `richOutput: "true"`. Do not change background sourcing or insight JSON contracts. Marketplace excludes the watch-creation tool in this read-only chat context; retain approval-based watches outside it.
- Rich chat chooses bar, line, area, pie, donut, scatter or heatmap charts to suit the retrieved data and requested visualization. Match the frontend `show_chart` schema; source every numeric value, retrieve required dimensions and keep missing heatmap cells unknown.

- Keep tool access explicit in each agent definition.
- Prefer shared helper logic in adjacent modules over copying instructions or integration code across agents.
- When adding another agent-facing document domain, model it after the `okf-agent` split: agent definition here, orchestration in `application/`, stable contract in `ports/`, and provider translation in `infrastructure/`.

# Verification

- Run `npm run build:mastra` from the repository root when agent exports, imports, or tool wiring change.

# Child DOX Index

- No child DOX docs yet.
