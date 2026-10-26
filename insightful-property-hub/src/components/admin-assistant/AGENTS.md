# Purpose

- Owns the staff assistant shell, CopilotKit connection, message rendering and designed response components.

# Ownership

- `admin-assistant-context.tsx` owns closed/sidebar/expanded state and pending prompts.
- `copilot-provider.tsx` owns the authenticated CopilotKit v2 provider and in-session agent conversations; it stays mounted when the panel closes and clears on sign-out/user change.
- `admin-assistant-sheet.tsx` owns the viewport-bound sidebar/full-page container and lazy-loads `assistant-workspace.tsx` on first open; keep that workspace mounted afterward so its provider and presentation tools survive closing.
- `admin-assistant-panel.tsx` owns controls, suggestions, auto-scrolling messages and pinned composer. `use-assistant-chat.ts` owns AG-UI sending/cancellation; `assistant-message.tsx` renders messages through registered tool renderers. Shared runtime contexts live in `assistant-runtime-context.ts`.
- `rich-output.tsx` owns presentation component schemas and rendering; `rich-output-data.ts` projects untrusted provider results into bounded safe display data.
- `assistant-chart-data.ts` owns the chart schema, validation feedback, bounded repair policy and current-turn failure projection. `assistant-chart.tsx` renders bar/line/area/pie/donut/scatter/heatmap views and one consolidated failure notice. Missing `type` preserves legacy bars; users can switch compatible views. Scatter requires numeric `x`; heatmaps use `label` rows and `group` columns. Every point retains a source; reject negative pie slices, duplicate cells and oversized matrices.
- `assistant-interactions.tsx` owns guided search forms, per-agent shortlists and searchable evidence dialogs; `interaction-data.ts` owns their bounded prompt/data transformations. `interaction-context.ts` holds shortlist and logical-run contexts. The staff-keyed provider retains shortlists and active logical runs across panel close/reopen, then clears on sign-out. A shortlist holds at most eight sourced results; source identity deduplicates selections.
- `advanced-interactions.tsx` owns sourced OpenStreetMap previews, editable rental scenarios, human-in-the-loop choice cards and progress derived from actual current-turn tool events. `advanced-interaction-data.ts` owns schemas, geometry, calculations and event projection.

# Local Contracts

- Preserve the ChatGPT-style layout: header, scrolling messages, bottom composer; Enter sends, Shift+Enter inserts a newline, Stop aborts the active agent. Suggestions appear only in empty conversations.
- Preserve sidebar/full-page/close behavior. The sheet stays `sticky top-14`, `h-[calc(100svh-3.5rem)]` below the header.
- Agent IDs match the three allowlisted Mastra CopilotKit agents: `web-research-agent`, `okf-agent`, `facebook-marketplace-agent`.
- Use CopilotKit v2 `useAgent`, `useComponent`, `useRenderTool` and `useRenderToolCall`; do not mix v1 hook signatures or the legacy AI SDK transport into the active panel.
- Optional presentation metadata accepts omitted fields or JSON `null` and normalizes null to undefined, matching Mastra's strict tool conversion. This includes chart coordinates/group/xLabel/type, summary citation metadata, guided-form defaults, optional map prices/scenario inputs and choice descriptions. Required chart values and source references remain strict; never coerce missing numbers to zero.
- Register `show_chart` with v2 `useFrontendTool`, returning `rendered` only after validation, or bounded `invalid_chart`/`unavailable` feedback for the agent to correct once per title/type. Invalid attempts do not paint repeated error cards; one current-turn notice remains if repair fails, and a successful repair clears it. Tests cover nullable strict-mode payloads plus real CopilotKit validation/correction lifecycle.
- Each agent singleton uses a `<staff-user-id>:<agent-id>:<uuid>` thread ID, retained across panel remounts. The server verifies this namespace and blocks history controls. Stop through `copilotkit.stopAgent` so both the run and pending frontend-tool continuations stop.
- Busy state covers the complete `copilotkit.runAgent` promise, including pending human choices and frontend tools, not just the backend stream. The provider prevents overlapping sends; Stop aborts pending choice handlers and continuations. Register `ask_choice` with v2 `useHumanInTheLoop`, one pending choice per agent. Choice and cancellation results resume the existing run; they never authorize record changes.
- `show_search_form` submits user criteria as an ordinary follow-up. `show_map` requires retrieved coordinates and sources, with optional prices in one stated unit; never infer coordinates from titles. `show_calculator` prefills sourced values only, keeps missing values blank and labels changed/user-entered values as assumptions. Draft edits and tone refinement are copy-only; local unsent form/draft edits reset when their card unmounts.
- Evidence dialogs show actual retrieved text or snippets as escaped text, searchable with bounded highlights; display exact references/page metadata when provided. Metadata-only results offer retrieval rather than invented excerpts. Source links remain restricted to safe HTTP(S).
- Reasoning preference (`megatrend-assistant:show-reasoning`, default off) hides reasoning/raw diagnostics only. Rich cards, tables, charts, evidence and galleries always remain visible.
- Web Research image preference (`megatrend-assistant:show-images`, default off) is forwarded as request context; explicit image requests still work. Preserve the image-search tool result shape.
- Preserve selected model/agent localStorage keys. `page-context.ts` supplies suggestions, not routing truth.
- Keep agent/model pickers disabled during an active response; consume cross-page pending prompts after it finishes or stops so one turn keeps its agent and model context.
- Presentation tools only explore/copy/navigate/ask follow-ups. No record-changing actions. Summaries, comparisons and numeric charts must cite retrieved sources/references; unknown values are not inferred.
- Escape HTML in Markdown and permit only credential-free HTTP(S) source/image URLs. Never expose raw provider payloads unless reasoning is enabled.

# Work Guidance

- Reuse shared UI primitives and app styling. Keep loading, empty, malformed and failed results readable in narrow and expanded layouts.
- Update `docs/assistant.md` when endpoint, environment or presentation contracts change.
- User preference: designed components for all three chat agents, with exploration and follow-up interactions.
- User preference: offer varied charts, including pie charts and heatmaps, and choose the visualization to suit the data rather than always returning bars.
- User preference: interactive forms, selectable comparisons, inspectable evidence, maps, editable drafts, scenario inputs, real progress and choice cards across the three chat agents.

# Verification

- Run frontend TypeScript, targeted ESLint for changed assistant files and `src/routes/api.copilotkit.ts`, frontend build and root `npm test` (includes normalization, proxy, interaction rendering and real CopilotKit choice continuation/Stop lifecycle checks).
- Verify streamed cards, source links, agent switching, close/reopen, sign-out cleanup, Stop, toggles and sidebar/expanded layouts.

# Child DOX Index

- No child DOX docs.
