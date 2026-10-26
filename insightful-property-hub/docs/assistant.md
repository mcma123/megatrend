# Rich agent responses

The staff assistant uses CopilotKit v2 and AG-UI with the existing Mastra agents.
Web Research, OKF Documents and Facebook Marketplace are the only exposed agents.
Windmill remains responsible for research/document tool execution; Convex still
owns application data and authorization.

## Configuration

- Set `MASTRA_COPILOTKIT_SERVICE_TOKEN` to the same long random secret on the
  portal server and Mastra server. In the combined Dokploy container one env
  value configures both processes. Never use a `VITE_` prefix.
- Local development loads root `.env.local` for Mastra and
  `insightful-property-hub/.env.local` for Vite, so set the same token in both.
- The portal resolves Mastra from `MASTRA_API_URL`, then `MASTRA_CHAT_URL`
  without `/chat`, then `http://127.0.0.1:4111`.
- Existing Convex and OpenRouter configuration remains required. CopilotKit
  runs locally with the application; no hosted CopilotKit account is required.
- Keep `@copilotkit/runtime` external in the Mastra bundler and keep npm
  lockfiles committed. The runtime's OpenAI peer uses a version compatible
  with the root Zod version.

## Request and response contracts

- `/api/copilotkit` accepts the CopilotKit single-endpoint POST protocol,
  verifies Convex staff authentication, and streams `/copilotkit` from Mastra.
  Caller-supplied identities and authorization headers are replaced.
- Mastra requires the shared token and trusted staff ID before discovery or
  agent runs. Agent instances and request context are created per request.
  Internal identity and auth headers are removed before runtime forwarding.
- Thread IDs are namespaced as `<staff-user-id>:<agent-id>:<uuid>` and checked
  against verified identity on run/connect/stop. The OSS runner keeps bounded
  ephemeral run buffers for streaming/cancellation; history list/read/clear
  operations are blocked on this endpoint.
- `X-Cyphersoft-Model` and `X-Cyphersoft-Images` carry presentation preferences;
  these never establish identity or tenant access.
- `richOutput: "true"` enables presentation instructions only in this endpoint.
  Existing chat routes, background sourcing, voice and JSON insight drafting
  retain their existing interfaces. Marketplace watches are unavailable in
  this exploration endpoint; the original approval-based tool is preserved
  outside it.
- Backend tool results are normalized into source/listing/document cards.
  Presentation tools `show_summary`, `show_comparison`, `show_chart`, and
  `show_listing_draft` accept bounded typed props. Chart points/comparison rows
  carry source URLs or exact document references. Missing facts stay unknown.
- Components only expand, sort, copy, follow links or send follow-up questions.
  They do not persist, publish or approve records. Markdown escapes HTML;
  links and images allow only credential-free HTTP(S) URLs.
- `show_chart.type` supports `bar` (legacy default), `line`, `area`, `pie`,
  `donut`, `scatter`, and `heatmap`. The agent chooses a suitable view and users
  can switch compatible views locally. Points retain `label`, `value`, `source`;
  scatter adds numeric `x` and optional `xLabel` (with unit), heatmaps add `group`
  for the column while `label` is the row. Other charts allow 24 points;
  heatmaps allow 144 cells in at most 12 rows/12 columns. Missing cells remain
  Unknown, duplicate cells are rejected, and pie/donut values must be
  non-negative with a positive finite total. All views retain source references.
- Optional UI metadata accepts JSON `null` as absent, matching Mastra strict-mode
  client tools. Null chart x/group/xLabel fields do not invalidate unrelated
  chart types; optional guided-form, source, map, scenario and choice metadata
  follows the same rule. Required numeric values and citations still reject null.
- `show_chart` uses a validating frontend handler. A successful call returns
  `rendered`; invalid data returns field-level feedback for one automatic
  correction per title/type. Unavailable data must be explained without invented
  values. Failed attempts stay out of the normal message UI; one notice shows
  unresolved current-turn failures and clears after a valid repair.
- Rich output is visible with reasoning off. Raw tool diagnostics and reasoning
  are opt-in. Images respect the existing research preference and explicit
  photo requests. Broken images show a placeholder.
- UI conversations live in the staff provider's memory, one per agent.
  Closing or expanding the panel retains them. Signing out or changing staff
  identity destroys the provider and aborts active runs. Reloading clears history.

## Interactive responses

- **Guided search:** the panel's Guided search button and `show_search_form`
  provide query/location/category/budget controls, or document-question/reference
  controls for OKF. Submission sends the selected criteria to the current agent.
  The form is optional: sufficient criteria typed in chat can be used directly.
- **Shortlists:** retrieved cards with a safe source URL or exact document
  reference can be selected. Each agent retains up to eight selections during
  the session. Compare selected requires two; Investigate selected requires one.
  The tray can remove/clear selections without altering application records.
- **Evidence:** View evidence opens a searchable, escaped retrieved excerpt,
  original link and available document reference/page. Missing text is explicit;
  Retrieve more evidence asks the agent to fetch the actual source.
- **Maps:** `show_map` accepts at most 24 sourced coordinates. Selecting a result
  focuses its marker on an OpenStreetMap embed with pan/zoom. Optional price
  filtering uses a single stated unit and preserves unknown prices separately.
  Coordinates must be retrieved, never guessed. The map loads from OpenStreetMap.
- **Drafts:** Edit draft changes title/text/price locally; Copy uses the edited
  content. Tone and Refine draft send the actual edited draft to the agent.
- **Scenarios:** `show_calculator` computes simple annual gross/net yield from
  purchase price and monthly rent/expenses. Prefilled amounts need sources;
  blanks stay blank and edits are assumptions. Financing/taxes/vacancy are
  excluded unless included in expenses. No scenario or draft is persisted.
- **Progress:** Research activity shows actual current-turn tool calls and their
  returned/failed/interrupted/input-needed states, with no invented percentages.
- **Choices:** `ask_choice` uses CopilotKit v2 `useHumanInTheLoop` to pause for
  2–8 real options or cancellation, then continue the same run. The provider
  tracks the full logical run across frontend-tool execution and panel remounts;
  Stop aborts pending choices and follow-up continuations. Choice results do not
  authorize application writes. Unsent local form/draft edits reset on unmount.

## Verification and release

Run `npm test`, frontend TypeScript, targeted assistant lint, `npm run build:web`
and `npm run build:mastra`. Smoke-test the built Mastra endpoint with an
unauthorized request and an authenticated discovery request. Verify all three
agents in sidebar and expanded layouts, source links, follow-ups, agent switching,
Stop, image/reasoning toggles and empty/error states. Use sanitized queries and
do not log credentials or document content.

Deployment is separate: configure the shared token in Dokploy, then follow the
normal authorized frontend/Mastra release workflow. No Convex schema migration
or Windmill sync is required for this integration.
