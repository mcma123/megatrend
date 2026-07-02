# Purpose

- Owns durable Mastra agent definitions under `src/mastra/agents/`.

# Ownership

- Owns every agent file in this folder, including `facebook-marketplace-agent.ts` and `web-research-agent.ts`.

# Local Contracts

- Each file should export a stable agent surface that can be registered from `../index.ts`.
- Agent files may depend on `../tools/*` but should not duplicate shared tool transport or provider setup.
- Prompt and behavior changes that alter external expectations should be reflected in the nearest owning AGENTS.md.

# Work Guidance

- Keep tool access explicit in each agent definition.
- Prefer shared helper logic in adjacent modules over copying instructions or integration code across agents.

# Verification

- Run `npm run build` from the repository root when agent exports, imports, or tool wiring change.

# Child DOX Index

- No child DOX docs yet.
