import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { FONTS, PALETTES, type FontId, type PaletteId } from "./themes";

export type ThemeChoice = "system" | "light" | "dark";

const media = window.matchMedia("(prefers-color-scheme: dark)");

type ThemeContext = {
  theme: ThemeChoice;
  resolved: "light" | "dark";
  palette: PaletteId;
  font: FontId;
  setTheme: (t: ThemeChoice) => void;
  setPalette: (p: PaletteId) => void;
  setFont: (f: FontId) => void;
};
const Ctx = createContext<ThemeContext | null>(null);

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const saved = localStorage.getItem(key);
  return allowed.includes(saved as T) ? (saved as T) : fallback;
}

// iOS reads theme-color for the status bar, and may not parse oklch, so convert through a canvas.
function toHex(color: string) {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return color;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(() => read("theme", ["system", "light", "dark"], "system"));
  const [palette, setPaletteState] = useState<PaletteId>(() => read("palette", PALETTES.map((p) => p.id), "felt"));
  const [font, setFontState] = useState<FontId>(() => read("font", FONTS.map((f) => f.id), "oxanium"));
  const [systemDark, setSystemDark] = useState(media.matches);
  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.dataset.palette = palette;
    root.dataset.font = font;
    const bg = toHex(getComputedStyle(document.body).backgroundColor);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
    localStorage.setItem("theme-color", bg);
  }, [resolved, palette, font]);

  function persist<T extends string>(key: string, set: (v: T) => void) {
    return (v: T) => {
      localStorage.setItem(key, v);
      set(v);
    };
  }

  return (
    <Ctx.Provider
      value={{
        theme,
        resolved,
        palette,
        font,
        setTheme: persist<ThemeChoice>("theme", setThemeState),
        setPalette: persist<PaletteId>("palette", setPaletteState),
        setFont: persist<FontId>("font", setFontState),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
