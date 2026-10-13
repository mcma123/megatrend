import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";

// Server-only helpers for API routes: verify the caller's Convex Auth token by asking
// Convex who it belongs to. The browser sends the token as `Authorization: Bearer ...`.

function convexUrl() {
  return (
    process.env.VITE_CONVEX_URL?.trim() ||
    process.env.CONVEX_URL?.trim() ||
    (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim() ||
    null
  );
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** A Convex client acting as the caller (null when not signed in). */
export function authedClient(request: Request) {
  const url = convexUrl();
  const token = bearerToken(request);
  if (!url || !token) {
    return null;
  }
  const client = new ConvexHttpClient(url);
  client.setAuth(token);
  return client;
}

export async function getRequestUser(request: Request) {
  const client = authedClient(request);
  if (!client) {
    return null;
  }
  try {
    return await client.query(api.users.currentUser, {});
  } catch {
    return null;
  }
}

/** True when the caller can open the given client portal (member or staff). */
export async function canAccessPortal(request: Request, slug: string | null) {
  const client = authedClient(request);
  if (!client || !slug) {
    return false;
  }
  try {
    const context = await client.query(api.portal.getPortalContext, { slug });
    return context.status === "ok";
  } catch {
    return false;
  }
}

export function unauthorized(message: string, status = 401) {
  return Response.json({ success: false, error: message }, { status });
}
