import { cn } from "@/lib/utils";
import type { NpcKind } from "./world";

// Journey Across Mereddia's pictures. The heads and items are the project's own pixel art, drawn
// crisp; the things it has no picture for (slime, golem, chest, gate) are small flat shapes.

const SRC = "/mereddia/sprites";

export const HEAD = {
  hero: "wilfred",
  vastios: "vastios",
  dwarf: "drawf_dialogue",
  keeper: "secret-master",
  mallakoth: "mallakoth_red",
} as const;

export const ITEM = {
  sword: "sword",
  potion: "health",
  shield: "shield",
  key: "key",
  coin: "coin",
  crystal: "fire_crystal",
} as const;

export function Sprite({ name, className, label = "" }: { name: string; className?: string; label?: string }) {
  return <img src={`${SRC}/${name}.png`} alt={label} draggable={false} className={cn("pointer-events-none select-none [image-rendering:pixelated]", className)} />;
}

export const WORLD = {
  grass: "#7a9a58",
  grassDark: "#6f8f50",
  wall: "#2f4a35",
  wallLight: "#3d5e43",
  water: "#4f86ad",
  waterLight: "#6aa0c4",
};

export function Slime({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} role="img" aria-label="Slime" shapeRendering="crispEdges">
      <path d="M2 14h12v-3h-1V8h-1V6h-1V5H5v1H4v2H3v3H2z" fill="#5fb86a" />
      <path d="M5 6h3v1H5zM3 11h10v3H3z" fill="#7fd48a" opacity=".55" />
      <path d="M5 8h2v3H5zM9 8h2v3H9z" fill="#1f3a26" />
      <path d="M5 8h1v1H5zM9 8h1v1H9z" fill="#fff" />
    </svg>
  );
}

export function Golem({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} role="img" aria-label="Stone Golem" shapeRendering="crispEdges">
      <path d="M4 2h8v5H4zM2 7h12v6H2zM3 13h3v2H3zM10 13h3v2h-3z" fill="#8a8f98" />
      <path d="M4 2h8v1H4zM2 7h12v1H2z" fill="#aeb3bb" />
      <path d="M6 4h1v2H6zM9 4h1v2H9z" fill="#ffb347" />
      <path d="M5 9h2v1H5zM9 10h3v1H9z" fill="#6a6f78" />
    </svg>
  );
}

export function Chest({ open, className }: { open?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} role="img" aria-label={open ? "Open chest" : "Chest"} shapeRendering="crispEdges">
      <path d="M2 7h12v7H2z" fill="#9a6a3a" />
      <path d="M2 7h12v2H2z" fill="#b98350" />
      {open ? <path d="M2 3h12v3H2z" fill="#7d542c" /> : <path d="M2 4h12v3H2z" fill="#b98350" />}
      <path d="M7 8h2v3H7z" fill="#f2c94c" />
      <path d="M2 13h12v1H2z" fill="#6b4524" />
    </svg>
  );
}

export function Gate({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} role="img" aria-label="Gate" shapeRendering="crispEdges">
      <path d="M1 3h14v12H1z" fill="#55585f" />
      <path d="M3 5h10v10H3z" fill="#2c2e33" />
      <path d="M5 5h1v10H5zM8 5h1v10H8zM11 5h1v10h-1z" fill="#8c9098" />
      <path d="M7 9h2v3H7z" fill="#f2c94c" />
    </svg>
  );
}

export function EnemyArt({ kind, className }: { kind: string; className?: string }) {
  if (kind === "slime") return <Slime className={className} />;
  if (kind === "golem") return <Golem className={className} />;
  if (kind === "keeper") return <Sprite name={HEAD.keeper} label="Keeper of the Gate" className={className} />;
  return <Sprite name={HEAD.mallakoth} label="Mallakoth" className={className} />;
}

export function NpcArt({ npc, className }: { npc: NpcKind; className?: string }) {
  return <Sprite name={HEAD[npc]} label={npc === "vastios" ? "Vastios" : "The Dwarf"} className={className} />;
}

// The Games card: the hero, a slime, and the dark lord, side by side on a strip of grass.
export function MereddiaBanner() {
  return (
    <div className="flex items-end gap-4 rounded-lg px-5 pt-3 pb-2" style={{ background: WORLD.grass }} aria-label="Journey Across Mereddia" role="img">
      <Sprite name={HEAD.hero} className="size-16" />
      <Sprite name={ITEM.sword} className="mb-1 size-10" />
      <Slime className="mb-1 size-12" />
      <Sprite name={ITEM.crystal} className="mb-2 size-8" />
      <Sprite name={HEAD.mallakoth} className="size-16" />
    </div>
  );
}
