import type { Vec } from "./engine";

// The sun, from the phone's own clock: where it is in the sky decides which way shadows fall, how long
// they are, and the color of the light. After dark the moon takes over and the lamps come on.

export type RGB = [number, number, number];
export type Light = {
  shadow: Vec; // the way shadows point, as a unit vector (north is up)
  len: number; // shadow length per unit of height
  lit: RGB; // sunlight
  shade: RGB; // the sky's light, which is all a shadow gets
  night: number; // 0 by day, 1 at night: lamps, lava and neon glow by this much
  altitude: number; // degrees
  hour: number;
  phase: string;
};

const LAT = (35 * Math.PI) / 180;

// Light by the sun's height in degrees: [altitude, sunlight, shadow].
const KEYS: [number, RGB, RGB][] = [
  [-20, [78, 92, 140], [62, 74, 120]],
  [-8, [92, 100, 150], [74, 82, 132]],
  [-2, [190, 150, 180], [120, 112, 160]],
  [2, [255, 196, 160], [150, 138, 178]],
  [8, [255, 222, 190], [160, 156, 190]],
  [18, [255, 242, 224], [166, 172, 206]],
  [40, [255, 252, 244], [170, 182, 214]],
  [90, [255, 253, 248], [172, 184, 216]],
];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function sunAt(now: Date, hourOverride: number | null = null): Light {
  const year = now.getFullYear();
  const day = Math.floor((now.getTime() - new Date(year, 0, 0).getTime()) / 864e5);
  const decl = ((-23.44 * Math.PI) / 180) * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  // Clock time is an hour ahead of the sun during daylight saving.
  const jan = new Date(year, 0, 1).getTimezoneOffset(), jul = new Date(year, 6, 1).getTimezoneOffset();
  const dst = now.getTimezoneOffset() < Math.max(jan, jul) ? 1 : 0;
  const hour = hourOverride ?? now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const H = (((hour - dst - 12) * 15) * Math.PI) / 180;
  const alt = Math.asin(Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(decl) * Math.cos(LAT)) + Math.PI;
  const deg = (alt * 180) / Math.PI;

  let lit = KEYS[0][1], shade = KEYS[0][2];
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [a0, l0, s0] = KEYS[i], [a1, l1, s1] = KEYS[i + 1];
    if (deg >= a0 && deg <= a1) {
      const t = (deg - a0) / (a1 - a0);
      lit = mixRGB(l0, l1, t);
      shade = mixRGB(s0, s1, t);
    } else if (deg > a1 && i === KEYS.length - 2) {
      lit = l1;
      shade = s1;
    }
  }
  // By day shadows point away from the sun. At night the moon, opposite, casts faint ones.
  const sunUp = deg > 0;
  const a = sunUp ? az : az + Math.PI;
  const shadow = { x: -Math.sin(a), y: Math.cos(a) };
  const len = sunUp ? Math.min(2.2, 1 / Math.tan(Math.max(alt, (5 * Math.PI) / 180))) : 0.9;
  const night = 1 - smooth(-6, 5, deg);
  return { shadow, len, lit, shade, night, altitude: deg, hour, phase: phaseName(hour, deg) };
}

function phaseName(hour: number, deg: number) {
  if (deg < -6) return "Night";
  if (deg < 0) return hour < 12 ? "Dawn" : "Dusk";
  if (deg < 10) return hour < 12 ? "Sunrise" : "Golden hour";
  if (hour < 11) return "Morning";
  if (hour < 14) return "Midday";
  return "Afternoon";
}

export function clockLabel(hour: number) {
  const h = Math.floor(hour) % 24, m = Math.floor((hour % 1) * 60);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// Close enough that the static light layer doesn't need redrawing.
export const lightKey = (l: Light) => `${Math.round(l.altitude * 2)}:${Math.round(Math.atan2(l.shadow.y, l.shadow.x) * 60)}`;

// Indoors and in space there's no sun: the server room and the arcade keep their own lights on, and in
// orbit the sun is always up, hard and white, with the dark of space all around.
export function lightFor(theme: string, l: Light): Light {
  if (theme === "server" || theme === "arcade")
    return { ...l, shadow: { x: 0.35, y: 0.94 }, len: 0.7, lit: [236, 238, 248], shade: [150, 156, 184], night: 0.85, altitude: 60 };
  if (theme === "orbit") return { ...l, shadow: { x: 0.6, y: 0.8 }, len: 1.4, lit: [255, 252, 246], shade: [96, 100, 140], night: 0.6, altitude: 35 };
  return l;
}
