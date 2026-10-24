import { createContext } from "react";
import type { ResultCard } from "./rich-output-data";
export const ShortlistContext = createContext({
  selections: {} as Record<string, ResultCard[]>,
  toggle: (_agentId: string, _card: ResultCard) => {},
  clear: (_agentId: string) => {},
});
export const AssistantRunContext = createContext({
  running: {} as Record<string, boolean>,
  begin: (_agentId: string): boolean => true,
  finish: (_agentId: string) => {},
});
