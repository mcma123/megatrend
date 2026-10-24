import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Convex function tests (convex/**/*.test.ts) run in the edge runtime like Convex itself.
// Pure Mastra application tests (src/mastra/**/*.test.ts) run there too.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(
        new URL("./insightful-property-hub/src", import.meta.url),
      ),
    },
  },
  test: {
    // Cold SDK imports alongside Convex fixtures can overwhelm desktop workers.
    maxWorkers: 2,
    include: [
      "convex/**/*.test.ts",
      "src/mastra/**/*.test.ts",
      "insightful-property-hub/src/**/*.test.ts",
    ],
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
