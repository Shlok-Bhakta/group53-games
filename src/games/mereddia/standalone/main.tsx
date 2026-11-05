import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "@/style.css";
import { MereddiaGame } from "../MereddiaGame";

const settings = new URLSearchParams(location.hash.slice(1));
const root = document.documentElement;
root.classList.toggle("dark", settings.get("dark") !== "0");
root.dataset.palette = settings.get("palette") ?? "felt";
root.dataset.font = settings.get("font") ?? "oxanium";

createRoot(document.getElementById("root")!).render(
  <MotionConfig reducedMotion="user">
    <MereddiaGame />
  </MotionConfig>,
);
parent.postMessage({ type: "ready" }, "*");
