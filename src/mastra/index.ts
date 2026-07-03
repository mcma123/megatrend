import { chatRoute } from "@mastra/ai-sdk";
import { Mastra } from "@mastra/core/mastra";

import { facebookMarketplaceAgent } from "./agents/facebook-marketplace-agent";
import { okfAgent } from "./agents/okf-agent";
import { webResearchAgent } from "./agents/web-research-agent";
import { windmillMcpServerProxies } from "./tools/windmill-tools";

export const mastra = new Mastra({
  agents: {
    facebookMarketplaceAgent,
    okfAgent,
    webResearchAgent,
  },
  mcpServers: {
    ...windmillMcpServerProxies,
  },
  server: {
    apiRoutes: [
      chatRoute({
        path: "/chat",
        agent: "web-research-agent",
        version: "v6",
        sendReasoning: true,
      }),
      chatRoute({
        path: "/chat/okf",
        agent: "okf-agent",
        version: "v6",
        sendReasoning: true,
      }),
      chatRoute({
        path: "/chat/facebook-marketplace",
        agent: "facebook-marketplace-agent",
        version: "v6",
        sendReasoning: true,
      }),
    ],
  },
});
