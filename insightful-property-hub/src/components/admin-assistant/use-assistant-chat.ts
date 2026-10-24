import { useContext, useEffect, useRef, useState } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2/headless";
import { AssistantConnectionContext } from "./assistant-runtime-context";
import { useCyphersoftAuth } from "@/lib/auth-session";

export function useAssistantChat(agentId: string) {
  const { agent, isReady } = useAgent({ agentId });
  const { copilotkit } = useCopilotKit();
  const { profile } = useCyphersoftAuth();
  const [error, setError] = useState<Error | null>(null);
  const connectionError = useContext(AssistantConnectionContext);
  const stopped = useRef(false);
  useEffect(() => setError(null), [agentId]);
  return {
    messages: agent.messages,
    isReady,
    status: agent.isRunning ? "streaming" : "ready",
    stop: () => {
      stopped.current = true;
      copilotkit.stopAgent({ agent });
    },
    error: error ?? connectionError,
    sendMessage: async (content: string) => {
      if (!isReady || agent.isRunning || !profile?.userId) return;
      setError(null);
      stopped.current = false;
      const prefix = `${profile.userId}:${agentId}:`;
      if (!agent.threadId.startsWith(prefix)) {
        agent.threadId = `${prefix}${crypto.randomUUID()}`;
        agent.setMessages([]);
      }
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
      try {
        await copilotkit.runAgent({ agent });
      } catch {
        if (stopped.current) return;
        setError(
          new Error(
            "The assistant could not finish its response. Check the connection and try again.",
          ),
        );
      }
    },
  };
}
