import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AuthStatus = "loading" | "anonymous" | "authenticated";

type PendingAuthState = {
  codeVerifier: string;
  state: string;
  portalSlug?: string;
  returnTo: string;
};

type StoredSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  portalSlug?: string;
};

type TokenResponse = {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type OidcDiscoveryDocument = {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
};

type AuthProfile = {
  subject: string;
  email: string | null;
  name: string | null;
};

type AuthContextValue = {
  status: AuthStatus;
  isConfigured: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  profile: AuthProfile | null;
  portalSlug: string | null;
  error: string | null;
  login: (args: { portalSlug?: string; returnTo?: string }) => Promise<void>;
  logout: (args?: { returnTo?: string }) => Promise<void>;
  handleCallback: (url?: string) => Promise<string>;
  getAccessToken: (args?: { forceRefreshToken?: boolean }) => Promise<string | null>;
};

const AUTH_SESSION_KEY = "mtos.auth.session";
const AUTH_PENDING_KEY = "mtos.auth.pending";

const authIssuer = import.meta.env.VITE_AUTH_ISSUER?.trim();
const authClientId = import.meta.env.VITE_AUTH_CLIENT_ID?.trim();
const authAudience = import.meta.env.VITE_AUTH_AUDIENCE?.trim();
const authRedirectUri =
  import.meta.env.VITE_AUTH_REDIRECT_URI?.trim() ||
  (typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : "");
const authPostLogoutRedirectUri =
  import.meta.env.VITE_AUTH_POST_LOGOUT_REDIRECT_URI?.trim() ||
  (typeof window !== "undefined" ? `${window.location.origin}/portal` : "");

const isConfigured = Boolean(authIssuer && authClientId && authRedirectUri);

const AuthSessionContext = createContext<AuthContextValue | null>(null);

let discoveryPromise: Promise<OidcDiscoveryDocument> | null = null;

function readStorage<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage<T>(key: string, value: T | null) {
  if (typeof window === "undefined") return;
  if (value === null) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function toBase64Url(value: Uint8Array) {
  const chars = Array.from(value, (item) => String.fromCharCode(item)).join("");
  return btoa(chars).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomString(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return toBase64Url(buffer);
}

async function sha256(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toBase64Url(new Uint8Array(digest));
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getProfileFromToken(token: string): AuthProfile | null {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.sub !== "string") return null;
  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}

function getExpiresAt(token: string, expiresIn?: number) {
  const payload = decodeJwtPayload(token);
  if (payload && typeof payload.exp === "number") {
    return payload.exp * 1000;
  }
  if (typeof expiresIn === "number") {
    return Date.now() + expiresIn * 1000;
  }
  return undefined;
}

function isTokenExpired(expiresAt?: number) {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - 60_000;
}

async function getDiscoveryDocument() {
  if (!authIssuer) {
    throw new Error("Missing VITE_AUTH_ISSUER");
  }
  if (!discoveryPromise) {
    const url = `${authIssuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    discoveryPromise = fetch(url).then(async (response) => {
      if (!response.ok) {
        throw new Error("Unable to load OIDC discovery document");
      }
      return (await response.json()) as OidcDiscoveryDocument;
    });
  }
  return discoveryPromise;
}

async function exchangeAuthorizationCode(args: {
  code: string;
  codeVerifier: string;
}): Promise<StoredSession> {
  const discovery = await getDiscoveryDocument();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: authClientId!,
    code: args.code,
    code_verifier: args.codeVerifier,
    redirect_uri: authRedirectUri,
  });
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error("OIDC token exchange failed");
  }
  const tokens = (await response.json()) as TokenResponse;
  const accessToken = tokens.id_token ?? tokens.access_token;
  if (!accessToken) {
    throw new Error("OIDC response did not contain a usable JWT");
  }
  return {
    accessToken,
    refreshToken: tokens.refresh_token,
    expiresAt: getExpiresAt(accessToken, tokens.expires_in),
  };
}

async function refreshAccessToken(refreshToken: string): Promise<StoredSession> {
  const discovery = await getDiscoveryDocument();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: authClientId!,
    refresh_token: refreshToken,
  });
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error("OIDC token refresh failed");
  }
  const tokens = (await response.json()) as TokenResponse;
  const accessToken = tokens.id_token ?? tokens.access_token;
  if (!accessToken) {
    throw new Error("OIDC refresh response did not contain a usable JWT");
  }
  return {
    accessToken,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expiresAt: getExpiresAt(accessToken, tokens.expires_in),
  };
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<StoredSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedSession = readStorage<StoredSession>(AUTH_SESSION_KEY);
    if (!storedSession?.accessToken) {
      setStatus("anonymous");
      return;
    }
    if (isTokenExpired(storedSession.expiresAt) && !storedSession.refreshToken) {
      writeStorage(AUTH_SESSION_KEY, null);
      setStatus("anonymous");
      return;
    }
    setSession(storedSession);
    setStatus("authenticated");
  }, []);

  const persistSession = useCallback((nextSession: StoredSession | null) => {
    setSession(nextSession);
    writeStorage(AUTH_SESSION_KEY, nextSession);
    setStatus(nextSession ? "authenticated" : "anonymous");
  }, []);

  const getAccessToken = useCallback(
    async ({ forceRefreshToken = false }: { forceRefreshToken?: boolean } = {}) => {
      if (!session?.accessToken) {
        return null;
      }
      if (!forceRefreshToken && !isTokenExpired(session.expiresAt)) {
        return session.accessToken;
      }
      if (!session.refreshToken) {
        persistSession(null);
        return null;
      }
      try {
        const refreshed = await refreshAccessToken(session.refreshToken);
        const nextSession = {
          ...refreshed,
          portalSlug: session.portalSlug,
        };
        persistSession(nextSession);
        return nextSession.accessToken;
      } catch (refreshError) {
        persistSession(null);
        setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh session");
        return null;
      }
    },
    [persistSession, session],
  );

  const login = useCallback(
    async ({ portalSlug, returnTo = "/dashboard" }: { portalSlug?: string; returnTo?: string }) => {
      if (!isConfigured) {
        throw new Error("OIDC auth is not configured. Set the VITE_AUTH_* variables first.");
      }
      const discovery = await getDiscoveryDocument();
      const codeVerifier = randomString(64);
      const codeChallenge = await sha256(codeVerifier);
      const state = randomString(32);

      writeStorage<PendingAuthState>(AUTH_PENDING_KEY, {
        codeVerifier,
        state,
        portalSlug,
        returnTo,
      });

      const params = new URLSearchParams({
        client_id: authClientId!,
        redirect_uri: authRedirectUri,
        response_type: "code",
        scope: "openid profile email offline_access",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      if (authAudience) {
        params.set("audience", authAudience);
      }

      window.location.assign(`${discovery.authorization_endpoint}?${params.toString()}`);
    },
    [],
  );

  const logout = useCallback(
    async ({ returnTo = "/portal" }: { returnTo?: string } = {}) => {
      const discovery = isConfigured ? await getDiscoveryDocument().catch(() => null) : null;
      const currentToken = session?.accessToken ?? null;
      persistSession(null);
      writeStorage(AUTH_PENDING_KEY, null);
      setError(null);

      if (discovery?.end_session_endpoint && currentToken) {
        const params = new URLSearchParams({
          post_logout_redirect_uri: authPostLogoutRedirectUri || `${window.location.origin}${returnTo}`,
          id_token_hint: currentToken,
        });
        window.location.assign(`${discovery.end_session_endpoint}?${params.toString()}`);
        return;
      }

      window.location.assign(returnTo);
    },
    [persistSession, session?.accessToken],
  );

  const handleCallback = useCallback(
    async (url = window.location.href) => {
      const pending = readStorage<PendingAuthState>(AUTH_PENDING_KEY);
      if (!pending) {
        throw new Error("Missing PKCE login state");
      }

      const currentUrl = new URL(url);
      const code = currentUrl.searchParams.get("code");
      const returnedState = currentUrl.searchParams.get("state");
      const errorParam = currentUrl.searchParams.get("error");

      if (errorParam) {
        throw new Error(currentUrl.searchParams.get("error_description") ?? errorParam);
      }
      if (!code || !returnedState || returnedState !== pending.state) {
        throw new Error("Invalid OIDC callback state");
      }

      const nextSession = await exchangeAuthorizationCode({
        code,
        codeVerifier: pending.codeVerifier,
      });

      persistSession({
        ...nextSession,
        portalSlug: pending.portalSlug,
      });
      writeStorage(AUTH_PENDING_KEY, null);
      setError(null);
      return pending.returnTo;
    },
    [persistSession],
  );

  const profile = useMemo(
    () => (session?.accessToken ? getProfileFromToken(session.accessToken) : null),
    [session?.accessToken],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      isConfigured,
      isLoading: status === "loading",
      isAuthenticated: status === "authenticated",
      profile,
      portalSlug: session?.portalSlug ?? null,
      error,
      login,
      logout,
      handleCallback,
      getAccessToken,
    }),
    [error, getAccessToken, handleCallback, login, logout, profile, session?.portalSlug, status],
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useMegatrendAuth() {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useMegatrendAuth must be used within AuthSessionProvider");
  }
  return context;
}

export function useConvexAuth() {
  const auth = useMegatrendAuth();
  return useMemo(
    () => ({
      isLoading: auth.isLoading,
      isAuthenticated: auth.isAuthenticated,
      fetchAccessToken: ({ forceRefreshToken }: { forceRefreshToken: boolean }) =>
        auth.getAccessToken({ forceRefreshToken }),
    }),
    [auth],
  );
}
