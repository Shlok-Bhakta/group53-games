import { createRoot } from "react-dom/client";
import "@fontsource-variable/oxanium/wght.css";
import "./golf.css";
import appCss from "@/style.css?raw";
import { GolfExplorer } from "@/games/golf/GolfExplorer";
import { BATTLE_GROUNDS } from "@/games/golf/battle";
import { BUMPER_PLAINS } from "@/games/golf/plains";
import { SANDBOX } from "../../convex/golf/sandbox";
import { still } from "@/games/golf/toy";
import { renderOffline } from "@/games/golf/audio";
import { assetSheet } from "./assets";

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
(window as unknown as { __golfStill: unknown }).__golfStill = (i: number, width: number) => still([...BUMPER_PLAINS, ...BATTLE_GROUNDS, SANDBOX][i], width).toDataURL("image/png");
(window as unknown as { __golfAssets: unknown }).__golfAssets = () => {
  const cs = getComputedStyle(document.documentElement);
  return assetSheet(cs.getPropertyValue("--background").trim(), cs.getPropertyValue("--foreground").trim(), cs.getPropertyValue("--muted-foreground").trim()).toDataURL("image/png");
};

// For recordings: the sounds logged in `window.__golfSounds`, rendered offline from `t0` (the log's
// clock, in ms) as 16-bit stereo PCM, base64.
(window as unknown as { __golfRenderSounds: unknown }).__golfRenderSounds = async (t0: number, seconds: number) => {
  const log = (window as unknown as { __golfSounds: Parameters<typeof renderOffline>[0] }).__golfSounds;
  const buf = await renderOffline(log, t0, seconds);
  const l = buf.getChannelData(0), r = buf.getChannelData(1);
  const pcm = new Int16Array(l.length * 2);
  for (let i = 0; i < l.length; i++) {
    pcm[i * 2] = Math.max(-1, Math.min(1, l[i])) * 32767;
    pcm[i * 2 + 1] = Math.max(-1, Math.min(1, r[i])) * 32767;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
