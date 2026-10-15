import { chatRoute } from "@mastra/ai-sdk";
import { Mastra } from "@mastra/core/mastra";

import { facebookMarketplaceAgent } from "./agents/facebook-marketplace-agent";
import { insightDrafterAgent } from "./agents/insight-drafter-agent";
import { okfAgent } from "./agents/okf-agent";
import { voiceAssistantAgent } from "./agents/voice-assistant-agent";
import { webResearchAgent } from "./agents/web-research-agent";
import { windmillMcpServerProxies } from "./tools/windmill-tools";
import { propertySourcingRoute } from "./routes/property-sourcing";
import { voiceAssistantRoute } from "./routes/voice-assistant";

export const mastra = new Mastra({
  agents: {
    facebookMarketplaceAgent,
    insightDrafterAgent,
    okfAgent,
    voiceAssistantAgent,
    webResearchAgent,
  },
  mcpServers: {
    ...windmillMcpServerProxies,
  },
  server: {
    apiRoutes: [
      propertySourcingRoute,
      voiceAssistantRoute,
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
