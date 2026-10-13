import { createServerFn } from "@tanstack/react-start";

// Explicitly expose only the public deployment URL, never server credentials.
export const getPublicConfig = createServerFn({ method: "GET" }).handler(() => ({
  convexUrl:
    process.env.VITE_CONVEX_URL?.trim() ||
    process.env.CONVEX_URL?.trim() ||
    import.meta.env.VITE_CONVEX_URL?.trim() ||
    "",
}));
