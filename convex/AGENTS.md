# Purpose

- Owns the Convex backend subtree, including handwritten modules, generated types, and Convex-specific operating rules.

# Ownership

- Owns every file and folder under `convex/`.

# Local Contracts

- Read `convex/_generated/ai/guidelines.md` before editing handwritten Convex code.
- Treat `convex/_generated/` as generated output unless a documented Convex workflow explicitly requires regeneration artifacts to be committed.
- Keep handwritten Convex code compatible with the generated API and data model surface in this subtree.
- Phase 2 tenancy/auth/audit foundation currently lives in `schema.ts`, `validators.ts`, `users.ts`, `tenancy.ts`, `auth.config.ts`, `convex.config.ts`, and `lib/`.
- `auth.config.ts` currently carries placeholder OIDC values and must be replaced with the selected real issuer and audience before production authentication is enabled.

# Work Guidance

- Put durable handwritten Convex code in non-generated files and let Convex regenerate `_generated/`.
- Document new schema, migration, auth, or data-shape constraints here if they become stable local rules.
- Resolve authorization server-side from `ctx.auth.getUserIdentity()` plus active membership lookup helpers; never trust frontend tenant context for access control.
- Keep audit events append-only and tenant-scoped through shared helpers rather than ad hoc per-feature writes.

# Verification

- Run the existing Convex generation or validation workflow relevant to the edited code when Convex files change.

# Child DOX Index

- No child DOX docs yet. `_generated/` remains covered here as generated material.
