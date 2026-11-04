import { useEffect, useRef, useState } from "react";
import { MapTrifoldIcon } from "@phosphor-icons/react";
import { groundAt, type State } from "./engine";
import { sizeOf } from "./world";

// A small map of the area you are in. It shows only what you have seen: each step reveals the cells around you that
// you could actually see (a wall stops the view), so rooms behind walls, the Secret Master's doors and the other
// secrets stay off it until you find them yourself. Markers are for things anyone would see: roads, people, signs.

const KEY = "mereddia:seen";
const RADIUS = 9;
// Exits that are secrets, not roads.
const SECRET_EXIT = new Set(["tree_tele", "spike_hatch"]);
const HIDDEN_NPC = new Set(["master", "ricky"]);

type Seen = Record<string, string>;
const read = (): Seen => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Seen;
  } catch {
    return {};
  }
};
const write = (seen: Seen) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    /* private window: the map just starts blank next time */
  }
};
export const resetSeen = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
};

const wall = (area: State["area"], x: number, y: number) => groundAt({ area }, x, y) === "#";

// Cells within RADIUS that have a clear line from (px, py): the cell where the line hits a wall is seen, not what is behind it.
function reveal(area: State["area"], px: number, py: number, w: number, h: number, mask: string[]) {
  for (let y = Math.max(0, py - RADIUS); y <= Math.min(h - 1, py + RADIUS); y++)
    for (let x = Math.max(0, px - RADIUS); x <= Math.min(w - 1, px + RADIUS); x++) {
      if ((x - px) ** 2 + (y - py) ** 2 > RADIUS * RADIUS + 1) continue;
      const n = Math.max(Math.abs(x - px), Math.abs(y - py));
      let clear = true;
      for (let i = 1; i < n; i++) {
        const cx = Math.round(px + ((x - px) * i) / n);
        const cy = Math.round(py + ((y - py) * i) / n);
        if (wall(area, cx, cy)) {
          clear = false;
          break;
        }
      }
      if (clear) mask[y * w + x] = "1";
    }
}

const COLOR = { floor: "#cfdcb9", wall: "#46444d", water: "#6fa8dc", bridge: "#a9825a", fall: "#bfe3f5" } as const;

export function MiniMap({ s }: { s: State }) {
  const [open, setOpen] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width: w, height: h } = sizeOf(s.area);
  const cell = Math.max(2, Math.min(8, Math.floor(150 / Math.max(w, h))));

  useEffect(() => {
    const seen = read();
    const mask = (seen[s.area] ?? "").padEnd(w * h, "0").slice(0, w * h).split("");
    reveal(s.area, s.pos.x, s.pos.y, w, h, mask);
    seen[s.area] = mask.join("");
    write(seen);
    const c = canvas.current;
    if (!c || !open) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * cell * dpr;
    c.height = h * cell * dpr;
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w * cell, h * cell);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x] !== "1") continue;
        const t = groundAt(s, x, y);
        g.fillStyle = t === "#" ? COLOR.wall : t === "~" ? COLOR.water : t === "=" ? COLOR.bridge : t === "w" ? COLOR.fall : t === "s" ? COLOR.water : COLOR.floor;
        g.fillRect(x * cell, y * cell, cell, cell);
      }
    const dot = (x: number, y: number, color: string, r: number) => {
      if (mask[y * w + x] !== "1") return;
      g.fillStyle = color;
      g.beginPath();
      g.arc((x + 0.5) * cell, (y + 0.5) * cell, Math.max(r, cell * 0.45), 0, Math.PI * 2);
      g.fill();
    };
    // A way out that is the whole edge of the area (the field's three roads) is one dot, at the middle of it.
    const exits = new Map<string, typeof s.entities>();
    for (const e of s.entities) if (e.area === s.area && e.kind === "exit" && !SECRET_EXIT.has(e.ask ?? "")) exits.set(`${e.what}|${e.ask}`, [...(exits.get(`${e.what}|${e.ask}`) ?? []), e]);
    for (const group of exits.values()) {
      // The seen cell nearest the middle of it, so the dot shows as soon as any of that edge has been seen.
      const mid = group[Math.floor(group.length / 2)];
      const near = group.filter((e) => mask[e.y * w + e.x] === "1").sort((a, b) => Math.abs(a.x - mid.x) + Math.abs(a.y - mid.y) - (Math.abs(b.x - mid.x) + Math.abs(b.y - mid.y)))[0];
      if (near) dot(near.x, near.y, "#ffffff", 2.4);
    }
    for (const e of s.entities) {
      if (e.area !== s.area) continue;
      if (e.kind === "exit") continue;
      else if (e.kind === "npc" && !HIDDEN_NPC.has(e.what)) dot(e.x, e.y, "#2aa6c9", 2.2);
      else if (e.kind === "prop" && e.what === "sign") dot(e.x, e.y, "#8a5a2b", 1.8);
      else if (e.kind === "enemy") dot(e.x, e.y, "#d9334a", 2);
    }
    g.lineWidth = 1.5;
    g.strokeStyle = "#1b1b1b";
    dot(s.pos.x, s.pos.y, "#ffd23f", 3.2);
    g.beginPath();
    g.arc((s.pos.x + 0.5) * cell, (s.pos.y + 0.5) * cell, Math.max(3.2, cell * 0.45), 0, Math.PI * 2);
    g.stroke();
  }, [s, w, h, cell, open]);

  return (
    <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
      <button type="button" aria-label={open ? "Hide map" : "Show map"} aria-pressed={open} onClick={() => setOpen((v) => !v)} className="grid size-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
        <MapTrifoldIcon size={18} weight="bold" />
      </button>
      {open && (
        <div className="rounded-md bg-black/55 p-1 backdrop-blur-sm">
          <canvas ref={canvas} role="img" aria-label="Map of what you have explored" style={{ width: w * cell, height: h * cell }} className="block [image-rendering:pixelated]" />
        </div>
      )}
    </div>
  );
}
