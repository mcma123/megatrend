import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexAuthSessionProvider, UnconfiguredAuthSessionProvider } from "@/lib/auth-session";

type ConvexContextValue = {
  convexClient: ConvexReactClient | null;
};

const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim() ?? "";
const isConvexConfigured = Boolean(convexUrl);

const ConvexClientContext = createContext<ConvexContextValue>({
  convexClient: null,
});

export function CyphersoftAppProviders({ children }: { children: ReactNode }) {
  const [convexClient] = useState(() =>
    isConvexConfigured ? new ConvexReactClient(convexUrl) : null,
  );

  const contextValue = useMemo(
    () => ({
      convexClient,
    }),
    [convexClient],
  );

  if (!convexClient) {
    return (
      <ConvexClientContext.Provider value={contextValue}>
        <UnconfiguredAuthSessionProvider>{children}</UnconfiguredAuthSessionProvider>
      </ConvexClientContext.Provider>
    );
  }

  return (
    <ConvexClientContext.Provider value={contextValue}>
      <ConvexAuthProvider client={convexClient}>
        <ConvexAuthSessionProvider>{children}</ConvexAuthSessionProvider>
      </ConvexAuthProvider>
    </ConvexClientContext.Provider>
  );
}

export function useOptionalConvexClient() {
  return useContext(ConvexClientContext).convexClient;
}
