import { createRoot } from "react-dom/client";
import "@fontsource-variable/oxanium/wght.css";
import "./golf.css";
import { GolfExplorer } from "@/games/golf/GolfExplorer";
import { generate } from "@/games/golf/gen";
import { sunAt } from "@/games/golf/light";
import { still } from "@/games/golf/render";

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

// For review screenshots: a whole hole as one picture.
(window as unknown as { __golfStill: unknown }).__golfStill = (seed: number, width: number, hour: number) => {
  const h = generate(seed);
  return h ? still(h, width, sunAt(new Date(), hour)).toDataURL("image/png") : null;
};
