# Purpose

- Owns the Convex backend subtree, including handwritten modules, generated types, and Convex-specific operating rules.

# Ownership

- Owns every file and folder under `convex/`.

# Local Contracts

- Read `convex/_generated/ai/guidelines.md` before editing handwritten Convex code.
- Treat `convex/_generated/` as generated output unless a documented Convex workflow explicitly requires regeneration artifacts to be committed.
- Keep handwritten Convex code compatible with the generated API and data model surface in this subtree.
- Phase 2 tenancy/auth/audit foundation currently lives in `schema.ts`, `validators.ts`, `auth.ts`, `http.ts`, `users.ts`, `tenancy.ts`, `auth.config.ts`, `convex.config.ts`, and `lib/`.
- Target deployment: production `focused-malamute-656` (team `mcmarsh-fif-gmail-com`, project `megatrend`), URL `https://focused-malamute-656.convex.cloud`. No dev deployment is configured.
- Deploy with `CONVEX_DEPLOYMENT=prod:focused-malamute-656 npx convex deploy` (or `CONVEX_DEPLOY_KEY` in CI). `CONVEX_DEPLOYMENT` is intentionally not stored in `.env.local`.
- `VITE_CONVEX_URL` lives in `insightful-property-hub/.env.local` (Vite env dir) and root `.env.local`; both are gitignored.
- Authentication is Convex Auth (`@convex-dev/auth`) with the email + password provider only, configured in `auth.ts`; `http.ts` must keep `auth.addHttpRoutes(http)`. `auth.config.ts` trusts `CONVEX_SITE_URL` with `applicationID: "convex"`.
- Deployment env required for auth: `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS` (set by `npx @convex-dev/auth --prod`), plus `PLATFORM_ADMIN_EMAILS` (comma-separated).
- Sign-up is invite-only: `auth.ts` `createOrUpdateUser` rejects new accounts unless the email is in `PLATFORM_ADMIN_EMAILS` or has a pending, unexpired `membershipInvitations` row; pending invitations are accepted on account creation and again on `users.syncCurrentUser`.
- The `users` table is the Convex Auth table (keep its fields and `email`/`phone` indexes) extended with `lastSeenAt`. Resolve the current user with `getAuthUserId` via `lib/auth.ts` helpers; never add a parallel identity table.
- `tenancy.provisionTenant` and `admin.seedRoleCatalog` require `requirePlatformAdmin` (email in `PLATFORM_ADMIN_EMAILS`).

# Work Guidance

- Put durable handwritten Convex code in non-generated files and let Convex regenerate `_generated/`.
- Document new schema, migration, auth, or data-shape constraints here if they become stable local rules.
- Resolve authorization server-side from the Convex Auth user (`lib/auth.ts`) plus active membership lookup helpers; never trust frontend tenant context for access control.
- Keep audit events append-only and tenant-scoped through shared helpers rather than ad hoc per-feature writes.

# Verification

- Run the existing Convex generation or validation workflow relevant to the edited code when Convex files change.

# Child DOX Index

- No child DOX docs yet. `_generated/` remains covered here as generated material.
