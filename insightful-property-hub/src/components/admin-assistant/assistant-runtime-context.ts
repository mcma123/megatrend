import { createContext } from "react";

export const AssistantConnectionContext = createContext<Error | null>(null);
export const RichOutputContext = createContext({
  agentId: "web-research-agent",
  followUp: (_prompt: string) => {},
  busy: false,
  showReasoning: false,
});
