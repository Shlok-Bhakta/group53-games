import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { drawBall, drawBoard, drawBox, drawBumper, drawCup, drawFlag, popIn } from "./toy";

// Golf's card art on the Games tab: a little green, and a putt that rolls in once.
const W = 26, H = 9; // in course units
const CUP = { x: 21, y: 4.5 };
const START = { x: 4.5, y: 4.5 };
const BOARD = [{ x: 1, y: 1 }, { x: W - 1, y: 1 }, { x: W - 1, y: H - 1 }, { x: 1, y: H - 1 }];
const LENGTH = 2.4; // seconds

export function GolfBanner() {
  const cv = useRef<HTMLCanvasElement>(null);
  const still = useReducedMotion();

  useEffect(() => {
    const el = cv.current!;
    const ctx = el.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = el.clientWidth;
    el.width = Math.round(px * dpr);
    el.height = Math.round(((px * H) / W) * dpr);
    const s = (px / W) * dpr;
    let raf = 0;
    const t0 = performance.now();
    const draw = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, el.width, el.height);
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(1, 1, W - 2, H - 2, 1.2);
      ctx.clip();
      drawBoard(ctx, [BOARD], CUP, { x0: 0, y0: 0, x1: W, y1: H });
      ctx.restore();
      ctx.beginPath();
      ctx.roundRect(1, 1, W - 2, H - 2, 1.2);
      ctx.strokeStyle = "#ece4d0";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      drawBumper(ctx, { x: 12, y: 2.9 }, 0.8 * popIn((t - 0.1) / 0.35));
      ctx.save();
      ctx.translate(15.5, 6.4);
      const g = popIn((t - 0.2) / 0.35);
      ctx.scale(g, g);
      drawBox(ctx, { x: 0, y: 0 }, t, 0);
      ctx.restore();
      drawCup(ctx, CUP, 0.72);
      // The putt: out fast, slowing, a curl round the rim, and in.
      const roll = Math.max(0, Math.min(1, (t - 0.45) / 1.1));
      const k = 1 - (1 - roll) ** 2.2;
      const x = START.x + (CUP.x - START.x) * k;
      const y = START.y + Math.sin(k * Math.PI) * 0.9;
      const sunk = roll >= 1;
      const flagOut = sunk ? Math.min(1, (t - 1.55) / 0.5) : 0;
      const flagBack = t > 2.05 ? popIn((t - 2.05) / 0.35) : 1;
      if (!sunk) drawBall(ctx, x, y, 0.38, { scale: popIn(t / 0.35), dir: 0, stretch: 1 + (1 - roll) * 0.25 * (roll > 0 ? 1 : 0) });
      if (flagOut < 1) drawFlag(ctx, CUP, t, 1, flagOut);
      else {
        ctx.save();
        ctx.translate(CUP.x, CUP.y);
        ctx.scale(flagBack, flagBack);
        ctx.translate(-CUP.x, -CUP.y);
        drawFlag(ctx, CUP, t, 1, 0);
        ctx.restore();
      }
    };
    if (still) draw(LENGTH);
    else {
      const frame = (now: number) => {
        const t = (now - t0) / 1000;
        draw(Math.min(t, LENGTH));
        // Plays once, then holds still (the flag keeps fluttering only while it's playing).
        if (t < LENGTH) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }
    return () => cancelAnimationFrame(raf);
  }, [still]);

  return <canvas ref={cv} role="img" aria-label="A putt rolling into the cup" className="aspect-[26/9] w-full max-w-72" />;
}
