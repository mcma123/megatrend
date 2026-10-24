# Purpose

- Owns the staff assistant shell, CopilotKit connection, message rendering and designed response components.

# Ownership

- `admin-assistant-context.tsx` owns closed/sidebar/expanded state and pending prompts.
- `copilot-provider.tsx` owns the authenticated CopilotKit v2 provider and in-session agent conversations; it stays mounted when the panel closes and clears on sign-out/user change.
- `admin-assistant-sheet.tsx` owns the viewport-bound sidebar/full-page container and lazy-loads `assistant-workspace.tsx` on first open; keep that workspace mounted afterward so its provider and presentation tools survive closing.
- `admin-assistant-panel.tsx` owns controls, suggestions, auto-scrolling messages and pinned composer. `use-assistant-chat.ts` owns AG-UI sending/cancellation; `assistant-message.tsx` renders messages through registered tool renderers. Shared runtime contexts live in `assistant-runtime-context.ts`.
- `rich-output.tsx` owns presentation component schemas and rendering; `rich-output-data.ts` projects untrusted provider results into bounded safe display data.

# Local Contracts

- Preserve the ChatGPT-style layout: header, scrolling messages, bottom composer; Enter sends, Shift+Enter inserts a newline, Stop aborts the active agent. Suggestions appear only in empty conversations.
- Preserve sidebar/full-page/close behavior. The sheet stays `sticky top-14`, `h-[calc(100svh-3.5rem)]` below the header.
- Agent IDs match the three allowlisted Mastra CopilotKit agents: `web-research-agent`, `okf-agent`, `facebook-marketplace-agent`.
- Use CopilotKit v2 `useAgent`, `useComponent`, `useRenderTool` and `useRenderToolCall`; do not mix v1 hook signatures or the legacy AI SDK transport into the active panel.
- Each agent singleton uses a `<staff-user-id>:<agent-id>:<uuid>` thread ID, retained across panel remounts. The server verifies this namespace and blocks history controls. Stop through `copilotkit.stopAgent` so both the run and pending frontend-tool continuations stop.
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

# Verification

- Run frontend TypeScript, targeted ESLint for this folder and `src/routes/api.copilotkit.ts`, frontend build and root `npm test` (includes normalization and proxy tests).
- Verify streamed cards, source links, agent switching, close/reopen, sign-out cleanup, Stop, toggles and sidebar/expanded layouts.

# Child DOX Index

- No child DOX docs.
