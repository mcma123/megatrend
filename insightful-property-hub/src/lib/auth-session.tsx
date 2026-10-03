import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";

type AuthStatus = "loading" | "anonymous" | "authenticated";

type AuthProfile = {
  userId: string;
  email: string | null;
  name: string | null;
  isPlatformAdmin: boolean;
};

export type PasswordSignInArgs = {
  flow: "signIn" | "signUp";
  email: string;
  password: string;
  name?: string;
  portalSlug?: string;
};

type AuthContextValue = {
  status: AuthStatus;
  isConfigured: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  profile: AuthProfile | null;
  portalSlug: string | null;
  error: string | null;
  /** Sends the user to the sign-in page, returning to `returnTo` afterwards. */
  login: (args: { portalSlug?: string; returnTo?: string }) => Promise<void>;
  signInWithPassword: (args: PasswordSignInArgs) => Promise<void>;
  logout: (args?: { returnTo?: string }) => Promise<void>;
};

const PORTAL_SLUG_KEY = "mtos.auth.portalSlug";

const AuthSessionContext = createContext<AuthContextValue | null>(null);

function readPortalSlug() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PORTAL_SLUG_KEY);
  } catch {
    return null;
  }
}

function writePortalSlug(slug: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (slug) {
      window.localStorage.setItem(PORTAL_SLUG_KEY, slug);
    } else {
      window.localStorage.removeItem(PORTAL_SLUG_KEY);
    }
  } catch {
    // Storage unavailable (private mode); portal pinning is a convenience only.
  }
}

// Production Convex only exposes ConvexError messages; other failures (wrong password,
// duplicate account) arrive as a generic "Server Error", so the fallbacks cover those.
function toFriendlyAuthError(error: unknown, flow: PasswordSignInArgs["flow"]) {
  const message =
    error instanceof ConvexError
      ? String(error.data)
      : error instanceof Error
        ? error.message
        : String(error);
  if (message.includes("has not been invited")) {
    return "This email has not been invited to Cyphersoft. Ask your Cyphersoft contact for an invitation.";
  }
  if (
    message.includes("InvalidSecret") ||
    message.includes("Invalid credentials") ||
    message.includes("InvalidAccountId")
  ) {
    return "Incorrect email or password.";
  }
  if (message.includes("already exists")) {
    return "An account with this email already exists. Sign in instead.";
  }
  if (message.toLowerCase().includes("password")) {
    return "Password must be at least 8 characters.";
  }
  return flow === "signUp"
    ? "Could not create your account. If you already have one, sign in instead."
    : "Incorrect email or password.";
}

function useLoginRedirect() {
  const router = useRouter();
  return useCallback(
    async ({ portalSlug, returnTo = "/dashboard" }: { portalSlug?: string; returnTo?: string }) => {
      await router.navigate({
        to: "/sign-in",
        search: { returnTo, ...(portalSlug ? { portal: portalSlug } : {}) },
      });
    },
    [router],
  );
}

/** Auth context backed by Convex Auth (email + password). */
export function ConvexAuthSessionProvider({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const syncCurrentUser = useMutation(api.users.syncCurrentUser);
  const currentUser = useQuery(api.users.currentUser, isAuthenticated ? {} : "skip");
  const login = useLoginRedirect();
  const [portalSlug, setPortalSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasSynced = useRef(false);

  useEffect(() => {
    setPortalSlug(readPortalSlug());
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      hasSynced.current = false;
      return;
    }
    if (hasSynced.current) return;
    hasSynced.current = true;
    void syncCurrentUser({}).catch((syncError) => {
      console.error("Convex user sync failed", syncError);
    });
  }, [isAuthenticated, syncCurrentUser]);

  const signInWithPassword = useCallback(
    async ({ flow, email, password, name, portalSlug: nextPortalSlug }: PasswordSignInArgs) => {
      setError(null);
      try {
        await signIn("password", {
          flow,
          email: email.trim().toLowerCase(),
          password,
          ...(flow === "signUp" && name?.trim() ? { name: name.trim() } : {}),
        });
      } catch (signInError) {
        const friendly = toFriendlyAuthError(signInError, flow);
        setError(friendly);
        throw new Error(friendly);
      }
      const slug = nextPortalSlug?.trim().toLowerCase() || null;
      writePortalSlug(slug);
      setPortalSlug(slug);
    },
    [signIn],
  );

  const logout = useCallback(
    async ({ returnTo = "/portal" }: { returnTo?: string } = {}) => {
      await signOut();
      writePortalSlug(null);
      setPortalSlug(null);
      setError(null);
      window.location.assign(returnTo);
    },
    [signOut],
  );

  const profile = useMemo<AuthProfile | null>(
    () =>
      currentUser
        ? {
            userId: currentUser._id,
            email: currentUser.email,
            name: currentUser.name,
            isPlatformAdmin: currentUser.isPlatformAdmin,
          }
        : null,
    [currentUser],
  );

  const status: AuthStatus = isLoading
    ? "loading"
    : isAuthenticated
      ? "authenticated"
      : "anonymous";

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      isConfigured: true,
      isLoading: status === "loading",
      isAuthenticated: status === "authenticated",
      profile,
      portalSlug,
      error,
      login,
      signInWithPassword,
      logout,
    }),
    [error, login, logout, portalSlug, profile, signInWithPassword, status],
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

/** Fallback context when VITE_CONVEX_URL is not set: everyone is anonymous. */
export function UnconfiguredAuthSessionProvider({ children }: { children: ReactNode }) {
  const login = useLoginRedirect();
  const value = useMemo<AuthContextValue>(
    () => ({
      status: "anonymous",
      isConfigured: false,
      isLoading: false,
      isAuthenticated: false,
      profile: null,
      portalSlug: null,
      error: null,
      login,
      signInWithPassword: async () => {
        throw new Error("Sign-in is not configured. Set VITE_CONVEX_URL first.");
      },
      logout: async ({ returnTo = "/portal" } = {}) => {
        window.location.assign(returnTo);
      },
    }),
    [login],
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useCyphersoftAuth() {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useCyphersoftAuth must be used within an auth session provider");
  }
  return context;
}
