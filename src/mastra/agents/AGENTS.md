# Purpose

- Owns durable Mastra agent definitions under `src/mastra/agents/`.

# Ownership

- Owns every agent file in this folder, including `facebook-marketplace-agent.ts`, `okf-agent.ts`, and `web-research-agent.ts`.

# Local Contracts

- Each file should export a stable agent surface that can be registered from `../index.ts`.
- Agent files may depend on `../tools/*` but should not duplicate shared tool transport or provider setup.
- Prompt and behavior changes that alter external expectations should be reflected in the nearest owning AGENTS.md.
- `okf-agent.ts` is the document-questioning agent for OKF bundles stored behind the Windmill-backed knowledge gateway. Keep its tool access focused on bundle discovery, retrieval, and grounded summarization rather than raw provider plumbing.

# Work Guidance

- Keep tool access explicit in each agent definition.
- Prefer shared helper logic in adjacent modules over copying instructions or integration code across agents.
- When adding another agent-facing document domain, model it after the `okf-agent` split: agent definition here, orchestration in `application/`, stable contract in `ports/`, and provider translation in `infrastructure/`.

# Verification

- Run `npm run build` from the repository root when agent exports, imports, or tool wiring change.

# Child DOX Index

- No child DOX docs yet.
