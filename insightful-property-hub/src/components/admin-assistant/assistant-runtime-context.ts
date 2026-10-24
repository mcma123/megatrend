import { createContext } from "react";

export const AssistantConnectionContext = createContext<Error | null>(null);
export const RichOutputContext = createContext({
  followUp: (_prompt: string) => {},
  busy: false,
  showReasoning: false,
});
