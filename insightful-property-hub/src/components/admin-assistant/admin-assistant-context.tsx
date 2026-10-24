import { createContext, useContext, useMemo, useState } from "react";

type AdminAssistantContextValue = {
  open: boolean;
  expanded: boolean;
  openSidebar: () => void;
  openFullPage: () => void;
  close: () => void;
  toggleOpen: () => void;
  toggleExpanded: () => void;
  /** A request to open with a given agent and a pre-filled message (consumed by the panel). */
  pendingPrompt: { agentId: string; text: string; nonce: number } | null;
  openWithPrompt: (agentId: string, text: string) => void;
  clearPendingPrompt: () => void;
};

const AdminAssistantContext = createContext<AdminAssistantContextValue | null>(null);

export function AdminAssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pendingPrompt, setPendingPrompt] =
    useState<AdminAssistantContextValue["pendingPrompt"]>(null);

  const value = useMemo<AdminAssistantContextValue>(
    () => ({
      open,
      expanded,
      openSidebar: () => {
        setOpen(true);
        setExpanded(false);
      },
      openFullPage: () => {
        setOpen(true);
        setExpanded(true);
      },
      close: () => {
        setOpen(false);
        setExpanded(false);
      },
      toggleOpen: () => {
        setOpen((currentOpen) => {
          if (currentOpen) {
            setExpanded(false);
            return false;
          }

          return true;
        });
      },
      toggleExpanded: () => {
        setOpen(true);
        setExpanded((currentExpanded) => !currentExpanded);
      },
      pendingPrompt,
      openWithPrompt: (agentId: string, text: string) => {
        setPendingPrompt({ agentId, text, nonce: Date.now() });
        setOpen(true);
      },
      clearPendingPrompt: () => setPendingPrompt(null),
    }),
    [expanded, open, pendingPrompt],
  );

  return <AdminAssistantContext.Provider value={value}>{children}</AdminAssistantContext.Provider>;
}

export function useAdminAssistant() {
  const context = useContext(AdminAssistantContext);
  if (!context) {
    throw new Error("useAdminAssistant must be used within AdminAssistantProvider.");
  }

  return context;
}
