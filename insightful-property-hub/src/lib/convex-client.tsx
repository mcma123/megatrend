import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { AuthSessionProvider, useConvexAuth } from "@/lib/auth-session";

type ConvexContextValue = {
  convexClient: ConvexReactClient | null;
};

const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim() ?? "";
const isConvexConfigured = Boolean(convexUrl);

const ConvexClientContext = createContext<ConvexContextValue>({
  convexClient: null,
});

function ConvexAuthBridge({ children }: { children: ReactNode }) {
  const [convexClient] = useState(
    () => (isConvexConfigured ? new ConvexReactClient(convexUrl) : null),
  );

  const contextValue = useMemo(
    () => ({
      convexClient,
    }),
    [convexClient],
  );

  if (!convexClient) {
    return <ConvexClientContext.Provider value={contextValue}>{children}</ConvexClientContext.Provider>;
  }

  return (
    <ConvexClientContext.Provider value={contextValue}>
      <ConvexProviderWithAuth client={convexClient} useAuth={useConvexAuth}>
        {children}
      </ConvexProviderWithAuth>
    </ConvexClientContext.Provider>
  );
}

export function MegatrendAppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthSessionProvider>
      <ConvexAuthBridge>{children}</ConvexAuthBridge>
    </AuthSessionProvider>
  );
}

export function useOptionalConvexClient() {
  return useContext(ConvexClientContext).convexClient;
}
