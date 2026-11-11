import { useEffect, useRef } from "react";
import type { ModeKey } from "../../../convex/modes";
import { SEAT_COLORS } from "@/games/seats";
import { drawBall, drawBoard, drawBumper, drawCup, drawFlag } from "./toy";

// Each golf mode's card: a little green with the balls on it. Turn-based has one ball rolling and the rest
// waiting their turn, with a dotted line for the next shot; Live has everyone on the move at once. Still.
const W = 26, H = 14;
const CUP = { x: 21, y: 5 };
const BOARD = [{ x: 1, y: 1 }, { x: W - 1, y: 1 }, { x: W - 1, y: H - 1 }, { x: 1, y: H - 1 }];
const BALLS = {
  "golf:turns": [{ x: 6, y: 10, c: "yellow" }, { x: 13, y: 7.5, c: "blue", dir: -0.4, go: 1 }, { x: 18.5, y: 9.5, c: "pink" }],
  "golf:live": [{ x: 7, y: 9, c: "yellow", dir: -0.3, go: 1 }, { x: 11, y: 11, c: "blue", dir: -0.6, go: 1 }, { x: 16, y: 7, c: "pink", dir: 0.1, go: 1 }, { x: 9, y: 5, c: "teal", dir: 0.2, go: 1 }],
} as const;

export function GolfModeArt({ mode }: { mode: ModeKey }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = cv.current!;
    const ctx = el.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = el.clientWidth || 160;
    el.width = Math.round(px * dpr);
    el.height = Math.round(((px * H) / W) * dpr);
    const s = (px / W) * dpr;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(1, 1, W - 2, H - 2, 1.4);
    ctx.clip();
    drawBoard(ctx, [BOARD], CUP, { x0: 0, y0: 0, x1: W, y1: H });
    ctx.restore();
    ctx.beginPath();
    ctx.roundRect(1, 1, W - 2, H - 2, 1.4);
    ctx.strokeStyle = "#ece4d0";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    drawBumper(ctx, { x: 15, y: 4 }, 0.85);
    drawCup(ctx, CUP, 0.72);
    drawFlag(ctx, CUP, 0.4, 1, 0);
    const balls = BALLS[mode as keyof typeof BALLS] ?? BALLS["golf:turns"];
    if (mode === "golf:turns") {
      // The next shot, dotted toward the cup.
      ctx.setLineDash([0.35, 0.45]);
      ctx.strokeStyle = "rgba(251,249,243,0.85)";
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.moveTo(6, 10);
      ctx.lineTo(10.5, 8.6);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const b of balls) {
      const moving = "go" in b;
      if (moving) {
        // A streak behind whatever's rolling.
        const dir = ("dir" in b ? b.dir : 0) + Math.PI;
        ctx.strokeStyle = "rgba(251,249,243,0.35)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x + Math.cos(dir) * 2.6, b.y + Math.sin(dir) * 2.6);
        ctx.stroke();
      }
      drawBall(ctx, b.x, b.y, 0.5, { ring: SEAT_COLORS[b.c], dir: "dir" in b ? b.dir : 0, stretch: moving ? 1.2 : 1 });
    }
  }, [mode]);
  return <canvas ref={cv} role="img" aria-label={mode === "golf:live" ? "Everyone putting at once" : "Balls waiting their turn"} className="aspect-[26/14] w-full" />;
}
