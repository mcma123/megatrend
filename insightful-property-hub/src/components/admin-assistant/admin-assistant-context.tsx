import { createContext, useContext, useMemo, useState } from "react";

type AdminAssistantContextValue = {
  open: boolean;
  setOpen: (value: boolean) => void;
  toggleOpen: () => void;
};

const AdminAssistantContext = createContext<AdminAssistantContextValue | null>(null);

export function AdminAssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  const value = useMemo<AdminAssistantContextValue>(
    () => ({
      open,
      setOpen,
      toggleOpen: () => setOpen((current) => !current),
    }),
    [open],
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
