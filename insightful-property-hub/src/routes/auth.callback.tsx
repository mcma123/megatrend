import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMegatrendAuth } from "@/lib/auth-session";
import { useOptionalConvexClient } from "@/lib/convex-client";
import { api } from "../../../convex/_generated/api";

const CONVEX_SYNC_TIMEOUT_MS = 2_000;

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [{ title: "Completing sign-in | Megatrend" }],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const auth = useMegatrendAuth();
  const convexClient = useOptionalConvexClient();
  const [error, setError] = useState<string | null>(null);
  const hasStartedCallback = useRef(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    if (hasStartedCallback.current) {
      return;
    }
    hasStartedCallback.current = true;

    const run = async () => {
      try {
        const returnTo = await auth.handleCallback();
        if (convexClient) {
          await Promise.race([
            convexClient.mutation(api.users.syncCurrentUser, {}),
            new Promise((resolve) => setTimeout(resolve, CONVEX_SYNC_TIMEOUT_MS)),
          ]).catch((syncError) => {
            console.error("Convex user sync failed during callback", syncError);
          });
        }
        window.location.replace(returnTo);
      } catch (callbackError) {
        if (isMounted.current) {
          setError(
            callbackError instanceof Error ? callbackError.message : "Could not complete sign-in.",
          );
        }
      }
    };

    void run();

    return () => {
      isMounted.current = false;
    };
  }, [auth, convexClient]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="surface-elevated w-full max-w-md p-8">
        {error ? (
          <div className="space-y-4">
            <div className="text-sm uppercase tracking-[0.18em] text-destructive">Sign-in failed</div>
            <h1 className="font-display text-2xl">We couldn&apos;t establish your session.</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button onClick={() => window.location.assign("/portal")} className="w-full">
              Return to sign-in
            </Button>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-primary" />
            <div className="text-sm uppercase tracking-[0.18em] text-primary">Secure sign-in</div>
            <h1 className="font-display text-2xl">Completing authentication</h1>
            <p className="text-sm text-muted-foreground">
              We&apos;re validating your identity and creating your Convex session.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
