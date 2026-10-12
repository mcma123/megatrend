import { defineConfig } from "vitest/config";

// Convex function tests (convex/**/*.test.ts) run in the edge runtime like Convex itself.
export default defineConfig({
  test: {
    include: ["convex/**/*.test.ts"],
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
