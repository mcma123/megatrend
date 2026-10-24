import { useEffect, useRef, useState, type ReactNode } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { useCopilotKit } from "@copilotkit/react-core/v2/headless";
import { useAuthToken } from "@convex-dev/auth/react";
import { useCyphersoftAuth } from "@/lib/auth-session";
import { RichOutputRegistry } from "./rich-output";

import { AssistantConnectionContext } from "./assistant-runtime-context";

function SessionCleanup() {
  const { copilotkit } = useCopilotKit();
  useEffect(
    () => () => {
      for (const agent of Object.values(copilotkit.agents)) {
        copilotkit.stopAgent({ agent });
        agent.setMessages([]);
        agent.setState({});
      }
    },
    [copilotkit],
  );
  return null;
}

export function AssistantCopilotProvider({ children }: { children: ReactNode }) {
  const auth = useCyphersoftAuth();
  const token = useAuthToken();
  const tokenRef = useRef(token);
  const [connectionError, setConnectionError] = useState<Error | null>(null);
  tokenRef.current = token;
  return (
    <CopilotKitProvider
      key={auth.profile?.userId ?? "anonymous"}
      runtimeUrl="/api/copilotkit"
      agentId="web-research-agent"
      useSingleEndpoint
      onError={() =>
        setConnectionError(
          new Error(
            "The assistant connection failed. Check the portal/Mastra configuration and refresh to reconnect.",
          ),
        )
      }
      headers={() => {
        let model = "openai/gpt-4.1-mini";
        let images = "false";
        try {
          model = localStorage.getItem("megatrend-assistant:selected-model") || model;
          images = localStorage.getItem("megatrend-assistant:show-images") || images;
        } catch {
          /* Browser storage may be unavailable. */
        }
        return {
          Authorization: `Bearer ${tokenRef.current ?? ""}`,
          "X-Cyphersoft-Model": model,
          "X-Cyphersoft-Images": images,
        };
      }}
      enableInspector={false}
      showDevConsole={false}
    >
      <AssistantConnectionContext.Provider value={connectionError}>
        <SessionCleanup />
        <RichOutputRegistry agentId="web-research-agent" />
        <RichOutputRegistry agentId="okf-agent" />
        <RichOutputRegistry agentId="facebook-marketplace-agent" />
        {children}
      </AssistantConnectionContext.Provider>
    </CopilotKitProvider>
  );
}
