import { defineConfig } from "vitest/config";

// Convex function tests (convex/**/*.test.ts) run in the edge runtime like Convex itself.
// Pure Mastra application tests (src/mastra/**/*.test.ts) run there too.
export default defineConfig({
  test: {
    include: ["convex/**/*.test.ts", "src/mastra/**/*.test.ts"],
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
