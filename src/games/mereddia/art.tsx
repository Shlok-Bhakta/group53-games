import { useId } from "react";
import { cn } from "@/lib/utils";
import type { Who } from "./story";
import type { Element, Entity, Theme, WeaponId } from "./world";

// Journey Across Mereddia's pictures. The heads and items are the project's own pixel art, drawn
// crisp; everything it has no picture for (slimes, golem, doors, crystals, rocks) is a small flat shape.

const SRC = `${import.meta.env.BASE_URL}mereddia/sprites`;

export const HEAD: Record<Who, string | undefined> = {
  mallakoth: "mallakoth_red",
  vastios: "vastios",
  wilfred: "wilfred",
  drawf: "drawf_dialogue",
  master: "secret-master",
  narrator: undefined,
  note: undefined,
  stefan: undefined,
  alexis: undefined,
  clavicus: undefined,
  joshua: undefined,
  ricky: undefined,
};

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

export const WORLD: Record<Theme, { floor: string; floorAlt: string; wall: string; wallAlt: string; water: string; waterAlt: string }> = {
  field: { floor: "#7a9a58", floorAlt: "#6f8f50", wall: "#2f4a35", wallAlt: "#3d5e43", water: "#4f86ad", waterAlt: "#6aa0c4" },
  cave: { floor: "#6b6258", floorAlt: "#625a50", wall: "#2b2723", wallAlt: "#35302b", water: "#3b6a8c", waterAlt: "#4b7ca0" },
  valley: { floor: "#8fa472", floorAlt: "#859a68", wall: "#6b7480", wallAlt: "#7a8490", water: "#4f86ad", waterAlt: "#7db3d6" },
  temple: { floor: "#b9b0a2", floorAlt: "#aea597", wall: "#58506b", wallAlt: "#645c79", water: "#4f86ad", waterAlt: "#6aa0c4" },
  wood: { floor: "#a9825a", floorAlt: "#9c7650", wall: "#4a3320", wallAlt: "#573d28", water: "#4f86ad", waterAlt: "#6aa0c4" },
};

export const ELEMENT_COLOR: Record<Element, string> = {
  fire: "#f08a24",
  water: "#1f4fa3",
  air: "#8fd3f4",
  earth: "#4c9a45",
  universal: "#eef5ff",
};
export const ELEMENT_NAME: Record<Element, string> = { fire: "Fire", water: "Water", air: "Air", earth: "Earth", universal: "Clear" };

const svg = (label: string, children: React.ReactNode, className?: string, view = "0 0 16 16") => (
  <svg viewBox={view} className={className} role="img" aria-label={label} shapeRendering="crispEdges">
    {children}
  </svg>
);

export const SLIME_COLOR: Record<string, string> = { green: "#5fb86a", blue: "#4f8fd8", orange: "#f0922b", red: "#d9534f", purple: "#9b59b6", rainbow: "#c46bff" };

export function Slime({ color = "green", className }: { color?: string; className?: string }) {
  const id = useId();
  const fill = color === "rainbow" ? `url(#${id})` : (SLIME_COLOR[color] ?? SLIME_COLOR.green);
  return svg(
    `${color[0].toUpperCase()}${color.slice(1)} slime`,
    <>
      {color === "rainbow" && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff5f5f" />
            <stop offset=".25" stopColor="#ffd45f" />
            <stop offset=".5" stopColor="#6fe07a" />
            <stop offset=".75" stopColor="#5fa8ff" />
            <stop offset="1" stopColor="#c46bff" />
          </linearGradient>
        </defs>
      )}
      <path d="M2 14h12v-3h-1V8h-1V6h-1V5H5v1H4v2H3v3H2z" fill={fill} />
      <path d="M5 6h3v1H5zM3 11h10v3H3z" fill="#fff" opacity=".28" />
      <path d="M5 8h2v3H5zM9 8h2v3H9z" fill="#1f2a26" />
      <path d="M5 8h1v1H5zM9 8h1v1H9z" fill="#fff" />
    </>,
    className,
  );
}

export function Golem({ className }: { className?: string }) {
  return svg(
    "Stone Golem",
    <>
      <path d="M4 2h8v5H4zM2 7h12v6H2zM3 13h3v2H3zM10 13h3v2h-3z" fill="#8a8f98" />
      <path d="M4 2h8v1H4zM2 7h12v1H2z" fill="#aeb3bb" />
      <path d="M6 4h1v2H6zM9 4h1v2H9z" fill="#ffb347" />
      <path d="M5 9h2v1H5zM9 10h3v1H9z" fill="#6a6f78" />
    </>,
    className,
  );
}

export function Chest({ open, className, face }: { open?: boolean; className?: string; face?: boolean }) {
  return svg(
    open ? "Open chest" : "Chest",
    <>
      <path d="M2 7h12v7H2z" fill="#9a6a3a" />
      <path d="M2 7h12v2H2z" fill="#b98350" />
      {open ? <path d="M2 3h12v3H2z" fill="#7d542c" /> : <path d="M2 4h12v3H2z" fill="#b98350" />}
      <path d="M7 8h2v3H7z" fill="#f2c94c" />
      <path d="M2 13h12v1H2z" fill="#6b4524" />
      {face && <path d="M4 10h2v2H4zM10 10h2v2h-2z" fill="#fff" />}
      {face && <path d="M5 11h1v1H5zM11 11h1v1h-1z" fill="#222" />}
    </>,
    className,
  );
}

export const Ricky = ({ className }: { className?: string }) => (
  <div className={cn("relative", className)}>
    <Chest face className="size-full" />
  </div>
);

export function Gate({ className }: { className?: string }) {
  return svg(
    "Gate",
    <>
      <path d="M1 3h14v12H1z" fill="#55585f" />
      <path d="M3 5h10v10H3z" fill="#2c2e33" />
      <path d="M5 5h1v10H5zM8 5h1v10H8zM11 5h1v10h-1z" fill="#8c9098" />
      <path d="M7 9h2v3H7z" fill="#f2c94c" />
    </>,
    className,
  );
}

export const Pot = ({ className }: { className?: string }) =>
  svg(
    "Pot",
    <>
      <path d="M5 3h6v2H5zM4 5h8v1H4zM3 6h10v6H3zM4 12h8v2H4z" fill="#b5651d" />
      <path d="M4 7h2v4H4z" fill="#d98a43" />
      <path d="M3 8h10v1H3z" fill="#7a3f10" />
    </>,
    className,
  );

export const Plate = ({ n, className }: { n: string; className?: string }) =>
  svg(
    `Pressure plate ${n}`,
    <>
      <path d="M1 3h14v10H1z" fill="#4d4a45" />
      <path d="M2 4h12v8H2z" fill="#8a847a" />
      <path d="M2 11h12v1H2z" fill="#5f5a52" />
      <text x="8" y="10.8" textAnchor="middle" fontSize="8" fontWeight="700" fill="#2a2724" fontFamily="monospace">
        {n}
      </text>
    </>,
    className,
  );

export const Pickaxe = ({ className }: { className?: string }) =>
  svg(
    "Pickaxe",
    <>
      <path d="M7 6h2v9H7z" fill="#8b5a2b" />
      <path d="M2 4h3v1h2V3h2v2h2V4h3v2h-2V5h-1v2H5V5H4v1H2z" fill="#aeb3bb" />
    </>,
    className,
  );

const BUTTON_COLOR: Record<string, string> = { mountain: "#7a8490", btnGold: "#f2c94c", btnRed: "#d9534f", btnFake: "#d9534f", btnL: "#9aa0a8", reopenA: "#9aa0a8", reopenB: "#9aa0a8" };
export const Button_ = ({ what, className }: { what: string; className?: string }) =>
  svg(
    "Button",
    <>
      <path d="M2 2h12v12H2z" fill="#3b3643" />
      <path d="M4 4h8v8H4z" fill={BUTTON_COLOR[what] ?? "#9aa0a8"} />
      <path d="M4 4h8v2H4z" fill="#fff" opacity=".3" />
      {what === "btnFake" && <path d="M7 6h2v1H7zM6 8h4v2H6z" fill="#fff" opacity=".6" />}
    </>,
    className,
  );

export const Lever = ({ pulled, className }: { pulled?: boolean; className?: string }) =>
  svg(
    "Lever",
    <>
      <path d="M3 11h10v3H3z" fill="#4d4a45" />
      {pulled ? <path d="M7 8h2v3H7zM5 6h6v2H5z" fill="#d9534f" /> : <path d="M7 3h2v8H7zM6 2h4v2H6z" fill="#d9534f" />}
    </>,
    className,
  );

export const Panel = ({ secret, className }: { secret?: boolean; className?: string }) =>
  svg(
    secret ? "Rock" : "Stone panel",
    secret ? <path d="M0 0h16v16H0z" fill="#7a8490" /> : (
      <>
        <path d="M0 0h16v16H0z" fill="#58506b" />
        <path d="M2 2h12v12H2z" fill="#8a8399" />
        <path d="M7 2h2v12H7z" fill="#58506b" />
      </>
    ),
    className,
  );

export const Crystal = ({ el, className }: { el: Element; className?: string }) =>
  svg(
    `${ELEMENT_NAME[el]} crystal`,
    <>
      <path d="M8 1l4 5-4 9-4-9z" fill={ELEMENT_COLOR[el]} stroke={el === "universal" ? "#9bb3d4" : "#0004"} strokeWidth=".6" />
      <path d="M8 1l-1 5 1 9 1-9z" fill="#fff" opacity=".35" />
    </>,
    className,
  );

export const ExitMark = ({ className }: { className?: string }) =>
  svg(
    "Way through",
    <>
      <path d="M2 2h12v12H2z" fill="#000" opacity=".28" />
      <path d="M8 3l5 6H9v4H7V9H3z" fill="#fff" opacity=".8" />
    </>,
    className,
  );

export const Table = ({ className }: { className?: string }) =>
  svg(
    "Table with a note",
    <>
      <path d="M1 5h14v3H1zM3 8h2v6H3zM11 8h2v6h-2z" fill="#8b5a2b" />
      <path d="M6 3h4v3H6z" fill="#f5efe0" />
      <path d="M7 4h2v1H7z" fill="#999" />
    </>,
    className,
  );

export const Shelf = ({ read, className }: { read?: boolean; className?: string }) =>
  svg(
    "Bookshelf",
    <>
      <path d="M0 0h16v16H0z" fill="#5a3e22" />
      <path d="M1 2h14v5H1zM1 9h14v5H1z" fill="#3b2713" />
      {[2, 5, 8, 11].map((x, i) => (
        <path key={x} d={`M${x} 2h2v5H${x}zM${x + 1} 9h2v5H${x + 1}z`} fill={["#a33", "#36a", "#3a6", "#c93"][i]} opacity={read ? 0.45 : 1} />
      ))}
    </>,
    className,
  );

export const Flame = ({ className }: { className?: string }) =>
  svg(
    "The Sacred Flame",
    <>
      <path d="M3 13h10v2H3z" fill="#4d4a45" />
      <path d="M8 1c3 3 5 5 5 8a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-5 1-7z" fill="#a855f7" />
      <path d="M8 6c2 2 3 3 3 5a3 3 0 0 1-6 0c0-1 1-2 1-3 1 1 1 1 2 1z" fill="#e9c6ff" />
    </>,
    className,
  );

export const Statue = ({ className }: { className?: string }) =>
  svg(
    "Statue of Atronius",
    <>
      <path d="M3 13h10v2H3z" fill="#6f747c" />
      <path d="M5 6h6v7H5zM6 2h4v4H6z" fill="#b8bec7" />
      <path d="M11 3h1v8h-1z" fill="#ffe08a" />
      <path d="M4 7h1v4H4z" fill="#8f959d" />
    </>,
    className,
  );

export const Sign = ({ className }: { className?: string }) =>
  svg(
    "Unmarked tunnel",
    <>
      <path d="M0 0h16v16H0z" fill="#000" opacity=".5" />
      <path d="M6 5h4v1H6zM9 6h1v2H9zM7 8h2v1H7zM7 10h2v1H7z" fill="#aaa" />
    </>,
    className,
  );

export const Villager = ({ className, tint = "#6a8caf" }: { className?: string; tint?: string }) =>
  svg(
    "Villager",
    <>
      <path d="M5 2h6v5H5z" fill="#f0c8a0" />
      <path d="M5 2h6v2H5z" fill="#5a3b22" />
      <path d="M4 7h8v7H4z" fill={tint} />
      <path d="M6 4h1v1H6zM9 4h1v1H9z" fill="#222" />
    </>,
    className,
  );

export const Boulder = ({ className }: { className?: string }) =>
  svg(
    "The boulder",
    <>
      <path d="M3 4h10v1h1v7h-1v1H3v-1H2V5h1z" fill="#7a7168" />
      <path d="M4 5h4v2H4zM9 8h3v3H9z" fill="#9a9086" />
      <path d="M3 11h10v1H3z" fill="#554d45" />
    </>,
    className,
  );

export const RockShadow = ({ className, fuse }: { className?: string; fuse: number }) =>
  svg(
    "Falling rock",
    <>
      <path d="M2 6h12v4H2z" fill="#d9534f" opacity={fuse <= 1 ? 0.75 : 0.4} />
      <path d="M4 4h8v1h2v6h-2v1H4v-1H2V5h2z" fill="none" stroke="#d9534f" strokeWidth="1" />
      <path d="M5 7h2v2H5zM9 7h2v2H9z" fill="#fff" opacity=".7" />
    </>,
    className,
  );

export const TrailTile = ({ el, className }: { el: Element; className?: string }) => (
  <div className={cn("size-full", className)} aria-hidden style={{ background: `${ELEMENT_COLOR[el]}`, opacity: el === "universal" ? 0.55 : 0.5, boxShadow: `inset 0 0 6px ${ELEMENT_COLOR[el]}` }} />
);

export function WeaponIcon({ id, className }: { id: WeaponId; className?: string }) {
  if (id === "lightbringer") return <Sprite name="sword" className={className} />;
  if (id === "fists") return svg("Bare hands", <path d="M4 5h8v6H4z M3 7h1v3H3z" fill="#f0c8a0" />, className);
  if (id === "bow") return svg("Bow", <><path d="M5 2c5 2 5 10 0 12" fill="none" stroke="#8b5a2b" strokeWidth="1.4" /><path d="M5 2v12" stroke="#ddd" strokeWidth=".6" /><path d="M3 8h10l-2-1v2z" fill="#c9ced6" /></>, className);
  if (id === "polearm") return svg("Polearm", <><path d="M8 1l2 3H6z" fill="#c9ced6" /><path d="M7.5 4h1v11h-1z" fill="#8b5a2b" /></>, className);
  if (id === "axe") return svg("Axe", <><path d="M7 3h2v12H7z" fill="#8b5a2b" /><path d="M3 3h5v5H3z" fill="#aeb3bb" /></>, className);
  return svg("Prism Blade", <><path d="M7 1h2v10H7z" fill="#e9c6ff" /><path d="M5 11h6v1H5zM7 12h2v3H7z" fill="#8b5a2b" /><path d="M6 3h1v6H6z" fill="#7fd0ff" /></>, className);
}

// One entity on the map.
export function EntityArt({ e, className }: { e: Entity; className?: string }) {
  switch (e.kind) {
    case "enemy":
      if (e.what === "golem") return <Golem className={className} />;
      if (e.what === "bigslime") return <Slime color="green" className={className} />;
      return <Slime color={e.what} className={className} />;
    case "chest":
      return <Chest open={e.done} className={className} />;
    case "pot":
      return <Pot className={className} />;
    case "gate":
      return <Gate className={className} />;
    case "panel":
      return e.open ? null : <Panel secret={e.what === "secret"} className={className} />;
    case "button":
      return <Button_ what={e.what} className={className} />;
    case "lever":
      return <Lever pulled={false} className={className} />;
    case "plate":
      return <Plate n={e.what} className={className} />;
    case "pickup":
      return <Pickaxe className={className} />;
    case "crystal":
      return <Crystal el={e.what as Element} className={className} />;
    case "exit":
      return e.what === "treehouse" ? <Sign className={className} /> : <ExitMark className={className} />;
    case "prop":
      return e.what === "table" ? <Table className={className} /> : e.what === "shelf" ? <Shelf className={className} /> : e.what === "flame" ? <Flame className={className} /> : e.what === "statue" ? <Statue className={className} /> : <Sign className={className} />;
    case "npc":
      return <NpcArt who={e.what as Who} className={className} />;
  }
}

export function NpcArt({ who, className }: { who: Who; className?: string }) {
  const name = HEAD[who];
  if (name) return <Sprite name={name} label={who} className={className} />;
  const tint = { stefan: "#6a8caf", alexis: "#b06a9a", clavicus: "#5b9a6a", joshua: "#c08a4a" }[who as "stefan"] ?? "#6a8caf";
  return <Villager className={className} tint={tint} />;
}

// The Games card: the hero, a slime, a crystal and the villain's old home, side by side on a strip of grass.
export function MereddiaBanner() {
  return (
    <div className="flex items-end gap-4 rounded-lg px-5 pt-3 pb-2" style={{ background: WORLD.field.floor }} aria-label="Journey Across Mereddia" role="img">
      <Sprite name="mallakoth_red" className="size-16" />
      <Sprite name={ITEM.sword} className="mb-1 size-10" />
      <Slime color="green" className="mb-1 size-12" />
      <Crystal el="fire" className="mb-2 size-8" />
      <Slime color="rainbow" className="mb-1 size-12" />
    </div>
  );
}
