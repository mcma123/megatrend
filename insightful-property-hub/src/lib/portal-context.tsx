import { createContext, useContext, type ReactNode } from "react";
import type { Id } from "../../../convex/_generated/dataModel";

/** The client workspace resolved by the portal shell from Convex (`portal.getPortalContext`). */
export type PortalClient = {
  tenantId: Id<"tenants">;
  organizationId: Id<"organizations"> | null;
  slug: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  accountManagerName: string | null;
};

export type PortalViewer = {
  principalType: "staff" | "client";
  roleKey: string;
  isPlatformAdmin: boolean;
  canManageTeam: boolean;
  fullName: string;
};

type PortalContextValue = { client: PortalClient; viewer: PortalViewer };

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalContextProvider({
  value,
  children,
}: {
  value: PortalContextValue;
  children: ReactNode;
}) {
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal() {
  const context = useContext(PortalContext);
  if (!context) {
    throw new Error("usePortal must be used inside the client portal shell");
  }
  return context;
}

export function usePortalClient() {
  return usePortal().client;
}
