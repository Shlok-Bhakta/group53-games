import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { App } from "./App";
import { ThemeProvider } from "./theme";
import "./style.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

if ("serviceWorker" in navigator) {
  // updateViaCache "none" makes the browser check sw.js over the network on every load, so deploys land right away.
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch((err) => console.error("Service worker registration failed:", err));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ConvexAuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
