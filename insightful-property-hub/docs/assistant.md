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
- Rich output is visible with reasoning off. Raw tool diagnostics and reasoning
  are opt-in. Images respect the existing research preference and explicit
  photo requests. Broken images show a placeholder.
- UI conversations live in the staff provider's memory, one per agent.
  Closing or expanding the panel retains them. Signing out or changing staff
  identity destroys the provider and aborts active runs. Reloading clears history.

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
