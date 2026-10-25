import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  test: {
    include: ["convex/**/*.test.ts", "src/**/*.test.ts"],
    // Convex functions run in the same edge runtime convex-test emulates; plain logic runs in Node.
    environmentMatchGlobs: [["convex/**", "edge-runtime"]],
    server: { deps: { inline: ["convex-test"] } },
  },
});
