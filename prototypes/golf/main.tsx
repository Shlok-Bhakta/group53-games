import { createRoot } from "react-dom/client";
import "@fontsource-variable/oxanium/wght.css";
import "./golf.css";
import { GolfExplorer } from "@/games/golf/GolfExplorer";

// The golf explorer on its own, built into a single HTML file (npm run golf:build). Inside a frame it
// takes a fixed height; opened directly on a phone it takes the whole screen.
let framed = true;
try {
  framed = window.self !== window.top;
} catch {
  // A cross-origin parent: framed.
}
document.documentElement.dataset.framed = String(framed);
createRoot(document.getElementById("root")!).render(<GolfExplorer />);
