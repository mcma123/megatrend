# Purpose

- Owns custom Mastra HTTP endpoints.

# Ownership

- Owns `property-sourcing.ts`, `voice-assistant.ts`, and `copilotkit.ts`; agent registration stays in `../index.ts`.

# Local Contracts

- `POST /sourcing/research` accepts the shared `convex/lib/sourcing.ts` brief contract and returns candidates/warnings.
- Require the server-only `MASTRA_SOURCING_SERVICE_TOKEN` bearer token before validating inputs or invoking agents. Missing configuration returns 503; invalid authentication returns 401; invalid brief returns 400; research failure returns a sanitized 502.
- Use the registered `webResearchAgent` and the application sourcing service. Abort research after four minutes or a client disconnect. Never expose provider errors or secrets.

- `POST /voice/assist` follows the same rules with `MASTRA_VOICE_SERVICE_TOKEN` (503 unconfigured, 401, 400 invalid request, sanitized 502), validates `ports/voice-assistant.ts`, and aborts after 55 seconds or client disconnect.

# Work Guidance

- `/copilotkit` requires `MASTRA_COPILOTKIT_SERVICE_TOKEN` and a trusted staff ID from the authenticated portal bridge. Construct only the three allowlisted chat adapters per request, with per-user resource identity. Never pass auth/identity headers into the runtime's automatic provider forwarding. Model/image preferences are request-scoped; `richOutput` gates presentation-only instructions.
- Limit the single-endpoint protocol to discovery and chat run/connect/stop/status. Bind thread IDs to `<verified-staff-id>:<selected-agent-id>:`; reject other prefixes and all history/list/clear operations because the OSS runner's ephemeral store is process-wide.

- Keep route handlers thin; research and source validation belong in the application service.

# Verification

- Run `npm test -- convex/sourcing.test.ts` for authentication, validation and sourcing behavior.
- Run `npm run build:mastra` for runtime wiring.

# Child DOX Index

- No child DOX docs.
