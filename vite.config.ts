import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Every build gets an ID, baked into the app and published as /version.json. Running clients compare
// the two and reload when a new build ships (see src/version.ts).
const BUILD_ID = process.env.BUILD_ID ?? Date.now().toString(36);

function versionFile(): Plugin {
  return {
    name: "version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ id: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
});
