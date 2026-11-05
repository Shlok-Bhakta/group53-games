import { useId } from "react";

// Journey Across Mereddia's card art. It's all the app holds of the game: the game itself is a separate build
// hosted from Convex (convex/hosted.ts) and opened in an iframe (src/games/HostedGame.tsx).
const SLIME_COLOR: Record<string, string> = { green: "#5fb86a", blue: "#4f8fd8", orange: "#f0922b", red: "#d9534f", purple: "#9b59b6", rainbow: "#c46bff" };

const svg = (label: string, children: React.ReactNode, className?: string, view = "0 0 16 16") => (
  <svg viewBox={view} className={className} role="img" aria-label={label} shapeRendering="crispEdges">
    {children}
  </svg>
);

function Slime({ color = "green", className }: { color?: string; className?: string }) {
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

const Sprite = ({ name, className }: { name: string; className: string }) => <img src={`/mereddia-card/${name}.png`} alt="" draggable={false} className={`pointer-events-none select-none [image-rendering:pixelated] ${className}`} />;

export function MereddiaBanner() {
  return (
    <div className="flex items-end gap-4 rounded-lg bg-[#7a9a58] px-5 pt-3 pb-2" aria-label="Journey Across Mereddia" role="img">
      <Sprite name="mallakoth_red" className="size-16" />
      <Sprite name="sword" className="mb-1 size-10" />
      <Slime color="green" className="mb-1 size-12" />
      <Slime color="rainbow" className="mb-1 size-12" />
    </div>
  );
}
