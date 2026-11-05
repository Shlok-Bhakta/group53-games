import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Journey Across Mereddia on its own, separate from the app: `npm run mereddia:build`, then publish dist-mereddia
// from main (npm run game:publish -- mereddia <this folder>/dist-mereddia). Relative paths, since it's served from
// a folder named after its build. The two stand-ins replace the parts of the game that talk to the app around it.
const here = (p: string) => path.resolve(import.meta.dirname, p);
export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@/components/AppHeader", replacement: here("src/games/mereddia/standalone/host.ts") },
      { find: "@/sound", replacement: here("src/games/mereddia/standalone/host.ts") },
      { find: "@", replacement: here("src") },
    ],
  },
  build: { outDir: "dist-mereddia", emptyOutDir: true, rollupOptions: { input: here("mereddia.html") } },
});
