import { SEAT_COLORS } from "./palette";

export { SEAT_COLORS };

export const seatColor = (player: { color?: string } | undefined, out = false) =>
  SEAT_COLORS[out ? "dead" : (player?.color ?? "dead")] ?? SEAT_COLORS.dead;
