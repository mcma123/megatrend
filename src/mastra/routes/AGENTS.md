# Purpose

- Owns custom Mastra HTTP endpoints.

# Ownership

- Owns `property-sourcing.ts`; agent registration stays in `../index.ts`.

# Local Contracts

- `POST /sourcing/research` accepts the shared `convex/lib/sourcing.ts` brief contract and returns candidates/warnings.
- Require the server-only `MASTRA_SOURCING_SERVICE_TOKEN` bearer token before validating inputs or invoking agents. Missing configuration returns 503; invalid authentication returns 401; invalid brief returns 400; research failure returns a sanitized 502.
- Use the registered `webResearchAgent` and the application sourcing service. Abort research after four minutes or a client disconnect. Never expose provider errors or secrets.

# Work Guidance

- Keep route handlers thin; research and source validation belong in the application service.

# Verification

- Run `npm test -- convex/sourcing.test.ts` for authentication, validation and sourcing behavior.
- Run `npm run build:mastra` for runtime wiring.

# Child DOX Index

- No child DOX docs.
