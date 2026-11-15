import { useId, type ReactNode } from "react";
import { MEADOW, RAINBOW, SLIME_EYE, SLIME_GLINT, SLIME_GREEN, SLIME_SHINE } from "./palette";

const svg = (label: string, children: ReactNode, className?: string, view = "0 0 16 16") => (
  <svg viewBox={view} className={className} role="img" aria-label={label} shapeRendering="crispEdges">
    {children}
  </svg>
);

function Slime({ name, fill, defs, className }: { name: string; fill: string; defs?: ReactNode; className?: string }) {
  return svg(
    `${name} slime`,
    <>
      {defs}
      <path d="M2 14h12v-3h-1V8h-1V6h-1V5H5v1H4v2H3v3H2z" fill={fill} />
      <path d="M5 6h3v1H5zM3 11h10v3H3z" fill={SLIME_SHINE} opacity=".28" />
      <path d="M5 8h2v3H5zM9 8h2v3H9z" fill={SLIME_EYE} />
      <path d="M5 8h1v1H5zM9 8h1v1H9z" fill={SLIME_GLINT} />
    </>,
    className,
  );
}

function RainbowSlime({ className }: { className?: string }) {
  const id = useId();
  return (
    <Slime
      name="Rainbow"
      fill={`url(#${id})`}
      className={className}
      defs={
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            {RAINBOW.map((stop, i) => (
              <stop key={stop} offset={i / (RAINBOW.length - 1)} stopColor={stop} />
            ))}
          </linearGradient>
        </defs>
      }
    />
  );
}

const Sprite = ({ name, className }: { name: string; className: string }) => (
  <img
    src={`/mereddia-card/${name}.png`}
    alt=""
    draggable={false}
    className={`pointer-events-none select-none [image-rendering:pixelated] ${className}`}
  />
);

export function MereddiaBanner() {
  return (
    <div
      className="flex items-end gap-4 rounded-lg px-5 pt-3 pb-2"
      style={{ background: MEADOW }}
      aria-label="Journey Across Mereddia"
      role="img"
    >
      <Sprite name="mallakoth_red" className="size-16" />
      <Sprite name="sword" className="mb-1 size-10" />
      <Slime name="Green" fill={SLIME_GREEN} className="mb-1 size-12" />
      <RainbowSlime className="mb-1 size-12" />
    </div>
  );
}
