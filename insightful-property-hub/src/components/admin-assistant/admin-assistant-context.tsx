import { createContext, useContext, useMemo, useState } from "react";

type AdminAssistantContextValue = {
  open: boolean;
  expanded: boolean;
  openSidebar: () => void;
  openFullPage: () => void;
  close: () => void;
  toggleOpen: () => void;
  toggleExpanded: () => void;
};

const AdminAssistantContext = createContext<AdminAssistantContextValue | null>(null);

export function AdminAssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
    }),
    [expanded, open],
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
