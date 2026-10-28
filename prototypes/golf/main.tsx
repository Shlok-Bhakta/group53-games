import { createRoot } from "react-dom/client";
import "@fontsource-variable/oxanium/wght.css";
import "./golf.css";
import appCss from "@/style.css?raw";
import { GolfExplorer } from "@/games/golf/GolfExplorer";
import { BATTLE_GROUNDS } from "@/games/golf/battle";
import { BUMPER_PLAINS } from "@/games/golf/plains";
import { still } from "@/games/golf/toy";

// The golf explorer on its own, built into a single HTML file (npm run golf:build). Inside a frame it
// takes a fixed height; opened directly on a phone it takes the whole screen.
let framed = true;
try {
  framed = window.self !== window.top;
} catch {
  // A cross-origin parent: framed.
}
document.documentElement.dataset.framed = String(framed);

// The app's themes, straight from its stylesheet: just the palette blocks, without Tailwind.
const start = appCss.indexOf("/* Themes.");
const end = appCss.indexOf("\n:root {", start);
const themes = document.createElement("style");
themes.textContent = appCss.slice(start, end);
document.head.appendChild(themes);
let saved: { palette?: string; dark?: boolean } = {};
try {
  saved = JSON.parse(localStorage.getItem("golf:theme") ?? "{}");
} catch {
  // No storage in a sandboxed frame.
}
document.documentElement.dataset.palette = saved.palette ?? "felt";
document.documentElement.classList.toggle("dark", saved.dark ?? true);
createRoot(document.getElementById("root")!).render(<GolfExplorer />);

// For review screenshots: a whole hole as one picture.
(window as unknown as { __golfStill: unknown }).__golfStill = (i: number, width: number) => still([...BUMPER_PLAINS, ...BATTLE_GROUNDS][i], width).toDataURL("image/png");
