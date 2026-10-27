import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Builds the golf explorer into one self-contained HTML file: prototypes/golf/dist/golf.html.
// Separate from the app's build, which it doesn't touch.

function inline(): Plugin {
  return {
    name: "inline-into-html",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find((f) => f.fileName.endsWith(".html"));
      if (!html || html.type !== "asset") return;
      let out = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === "chunk") {
          const code = file.code.replace(/<\/script/gi, "<\\/script");
          out = out.replace(new RegExp(`<script[^>]*src="[^"]*${file.fileName}"[^>]*></script>`), () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (file.fileName.endsWith(".css")) {
          out = out.replace(new RegExp(`<link[^>]*href="[^"]*${file.fileName}"[^>]*>`), () => `<style>${String(file.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = out;
      html.fileName = "golf.html";
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react(), inline()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../src") } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
  },
});
