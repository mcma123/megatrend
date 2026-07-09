# Purpose

- Owns the reusable document scanner UI components used by the client portal scanner route.

# Ownership

- Owns every file in this folder.

# Local Contracts

- Keep page orchestration in route files; this folder owns reusable scanner inputs, editors, and export controls.
- Keep scanner state shapes in `src/lib/document-scanner.ts` and pass state into these components via props.

# Work Guidance

- Preserve client-portal visual language: elevated cards, concise operator copy, and clearly surfaced failure states.
- Prefer browser-native APIs for camera and drag interactions unless a dependency already exists in the app.

# Verification

- Run `npm run build --prefix insightful-property-hub` when scanner component props or interactions change.
- Run `npm run lint --prefix insightful-property-hub` when scanner component code changes.

# Child DOX Index

- No child DOX docs yet.
