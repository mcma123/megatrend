# Purpose

- Owns the `insightful-property-hub/` application subtree, which is the main TanStack Start frontend launched by the root `npm run dev:web` workflow.

# Ownership

- Owns every file and folder under `insightful-property-hub/`.
- Source code conventions live in the closer child doc at `src/AGENTS.md`.

# Local Contracts

- This app is connected to Lovable. Do not rewrite published git history in ways that would break Lovable sync on pushed branches.
- Generated or environment-specific outputs such as `.output/`, `.tanstack/`, `.wrangler/`, and `node_modules/` are part of the subtree but should usually be treated as build artifacts rather than hand-edited source.

# Work Guidance

- Keep app-level tooling, config, and generated-artifact expectations documented here.
- Rich assistant setup and server-only CopilotKit token configuration live in `docs/assistant.md`. Keep its local/runtime environment guidance aligned with the combined frontend/Mastra deployment.
- Agreement preparation, PDF fields/internal approval and release limitations are documented in `docs/signing.md`; `docs/signing-prerequisites.md` owns legal/service intake and secure MFA provisioning. Root `signing_module.md` owns phased execution and verification. `docs/signing-operations.md` owns release procedure, kill switches, alert responses, incident playbooks, retention/holds and backup restoration tests. External sending is released only through the two-key gate described there.
- Tiptap is pinned at 3.32.0 (`@tiptap/core`, `react`, `pm`, `starter-kit`, `extension-table`, `extension-text-align`); keep these versions identical and update `template-schema.ts` plus its test when changing them.
- `public/signing-portal.js` is the standalone signer journey loaded by `signing-access.js` after verification. Same rules: no third-party assets, analytics, `innerHTML`, logging or browser storage; private data only via `/api/signing`. Opening/drawing/saving never signs; Finish reuses one request key across retries. Supporting-document uploads send raw bytes only to same-origin `/api/signing?upload=attachment`; storage URLs never reach the browser. It loads PDF.js from `public/pdfjs/build/`, which `scripts/copy-pdfjs-assets.mjs` copies from the legacy build.
- `public/signing-access.js` is the standalone signer-verification bootstrap. Keep it free of third-party assets, analytics, voice, platform auth and persistent browser storage. Capture and immediately scrub the invitation fragment (or staff-prepared `#in-person:<token>` kiosk fragment, exchanged with `kiosk_exchange`) before requests; GET never sends codes or signs. Only explicit user actions exchange links/request codes/verify/end sessions; credentials after exchange live in scoped HttpOnly cookies managed by `src/lib/signing-access.server.ts`.
- Hosted auth requires `VITE_CONVEX_URL` or `CONVEX_URL` on the frontend server/container, independently of Convex dashboard variables. The portal supports runtime configuration; Docker build args are optional when the runtime URL is supplied. OpenRouter and Windmill credentials remain server-only.
- Route, component, and source-level rules belong in the closer docs under `src/`.
- `predev`, `prebuild`, and `prebuild:dev` run `scripts/copy-pdfjs-assets.mjs` to copy local PDF.js fonts, CMaps, ICC profiles and decoders into generated `public/pdfjs/` (gitignored and excluded from lint). Keep this hook when changing build commands. Viewer setup and rollout instructions live in `docs/document-viewer.md`.

# Verification

- Run `npm run build --prefix insightful-property-hub` when app-level source or config changes.
- Run `npm run lint --prefix insightful-property-hub` when linted source changes.

# Child DOX Index

- `src/` -> `insightful-property-hub/src/AGENTS.md`: Application source, shared components, route files, hooks, and local utilities.
- `public/`, `docs/` (feature guides such as `docs/voice.md`) and top-level config files remain owned by this doc.
