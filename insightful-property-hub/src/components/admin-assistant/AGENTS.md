# Purpose

- Owns the Megatrend assistant UI modules under `insightful-property-hub/src/components/admin-assistant/`.

# Ownership

- Owns `admin-assistant-context.tsx`, `admin-assistant-panel.tsx`, `admin-assistant-sheet.tsx`, and `page-context.ts`.

# Local Contracts

- `admin-assistant-context.tsx` owns the assistant shell state: closed, sidebar-open, and full-page-expanded.
- `admin-assistant-sheet.tsx` is the layout container that renders the assistant either as the right sidebar panel or as the full-page workspace inside the app shell.
- `admin-assistant-panel.tsx` owns the interactive chat surface, including agent selection, model selection, suggestion chips, message rendering, and the expand/collapse/close controls.
- The agent selector must stay synchronized with the supported Mastra chat routes proxied by `src/routes/api.chat.ts`.
- `page-context.ts` provides page-aware defaults only; it must not become the source of routing or agent-state truth.

# Work Guidance

- Keep assistant layout state in the shared context instead of duplicating it in the header, panel, or route components.
- When adding another selectable agent, update the assistant panel copy and the route proxy together so the UI labels, stored agent id, and backend endpoint remain aligned.
- Preserve the current interaction model: users can open the assistant as a sidebar, expand it to a full-page view, collapse it back to the sidebar, or close it entirely.

# Verification

- Run `npx eslint src/components/admin-assistant/admin-assistant-context.tsx src/components/admin-assistant/admin-assistant-sheet.tsx src/components/admin-assistant/admin-assistant-panel.tsx src/routes/_app.tsx src/routes/api.chat.ts` from `insightful-property-hub/` when assistant state, layout, or routing changes.

# Child DOX Index

- No child DOX docs yet.
