import { BALL_R, CUP_R, v } from "@/games/golf/engine";
import { PALETTE, drawBall, drawBox, drawBumper, drawCup, drawFlag, drawFx, drawMine, drawPad, drawRail, drawBoard, type Fx } from "@/games/golf/toy";

// The asset sheet: the palette, then every part of the course and the frames of its animations, drawn
// by the same functions the game uses. For reviewing the look in one place.

const NAMES: Record<keyof typeof PALETTE, string> = {
  grass: "Grass",
  mow: "Mowing stripe",
  putting: "Putting green",
  rail: "Rail",
  railLine: "Rail line",
  bumper: "Bumper",
  bumperRing: "Bumper ring",
  cup: "Cup",
  flag: "Flag",
  box: "Box",
  boxInk: "Box ink",
  pad: "Speed pad",
  ramp: "Ramp",
  sand: "Sand",
  mine: "Mine",
  mineLight: "Mine light",
  ball: "Ball",
  ballShade: "Ball shade",
  ink: "Aim",
};

export function assetSheet(bg: string, fg: string, muted: string): HTMLCanvasElement {
  const W = 760, cell = 120, cols = 6, S = 22; // S: pixels per unit
  const rows: { title: string; cells: { label: string; draw: (ctx: CanvasRenderingContext2D) => void; ground?: boolean }[] }[] = [];
  const tile = (draw: (ctx: CanvasRenderingContext2D) => void, ground = true) => ({ draw, ground });
  const T = 2;
  rows.push({
    title: "Course",
    cells: [
      { label: "Grass", ...tile(() => {}) },
      { label: "Putting green", ...tile((c) => drawBoard(c, [[v(-3, -3), v(3, -3), v(3, 3), v(-3, 3)]], v(0, 0), { x0: -3, y0: -3, x1: 3, y1: 3 }), false) },
      { label: "Rail", ...tile((c) => drawRail(c, [v(-2, 1), v(-2, -1.2), v(2, -1.2)], false, 0.6)) },
      { label: "Cup", ...tile((c) => drawCup(c, v(0, 0.6), CUP_R)) },
      { label: "Flag", ...tile((c) => (drawCup(c, v(0, 1.2), CUP_R), drawFlag(c, v(0, 1.2), T))) },
      { label: "Tee mat", ...tile((c) => ((c.fillStyle = "rgba(0,0,0,0.1)"), c.beginPath(), c.roundRect(-1.1, -1.1, 2.2, 2.2, 0.35), c.fill(), drawBall(c, 0, 0, BALL_R))) },
    ],
  });
  rows.push({
    title: "Ball",
    cells: [
      { label: "Resting", ...tile((c) => drawBall(c, 0, 0, BALL_R * 1.8)) },
      { label: "Fast", ...tile((c) => drawBall(c, 0, 0, BALL_R * 1.8, { dir: -0.6, stretch: 1.35 })) },
      { label: "Hits a wall", ...tile((c) => drawBall(c, 0, 0, BALL_R * 1.8, { squash: 1, n: 0 })) },
      { label: "Pops in", ...tile((c) => [0.3, 0.6, 1].forEach((k, i) => drawBall(c, -1.4 + i * 1.4, 0, BALL_R * 1.4, { scale: 0.3 + k * 0.7 }))) },
      { label: "In the air", ...tile((c) => ((c.fillStyle = "rgba(0,0,0,0.22)"), c.beginPath(), c.arc(0.5, 0.9, BALL_R * 1.4, 0, 7), c.fill(), drawBall(c, 0, -0.3, BALL_R * 1.8))) },
      { label: "Jumbo", ...tile((c) => drawBall(c, 0, 0, BALL_R * 2.2 * 1.4)) },
    ],
  });
  rows.push({
    title: "Bumper",
    cells: [0, 0.15, 0.35, 0.5, 0.75, 1].map((k) => ({ label: k === 1 ? "Resting" : `Hit, ${Math.round(k * 300)}ms`, ...tile((c) => drawBumper(c, v(0, 0), 0.85 * 1.3, k)) })),
  });
  rows.push({
    title: "Pickups and pads",
    cells: [
      { label: "Mystery box", ...tile((c) => drawBox(c, v(0, 0), 0, 0)) },
      { label: "Box opened", ...tile((c) => drawFx(c, [{ kind: "label", x: 0, y: 1.6, t: 0, seed: 1, text: "Jumbo" } as Fx, { kind: "spark", x: 0, y: 0.6, t: 0, seed: 2 } as Fx], 0.35, false)) },
      { label: "Speed pad", ...tile((c) => drawPad(c, [v(-1.3, -1.3), v(1.3, -1.3), v(1.3, 1.3), v(-1.3, 1.3)], v(0, -1), "boost", 0.3)) },
      { label: "Jump ramp", ...tile((c) => drawPad(c, [v(-1.5, -1.5), v(1.5, -1.5), v(1.5, 1.5), v(-1.5, 1.5)], v(0, -1), "ramp", 0)) },
      { label: "Landmine", ...tile((c) => drawMine(c, v(0, 0), 0.2)) },
      { label: "Sand", ...tile((c) => ((c.fillStyle = PALETTE.sand), c.beginPath(), c.ellipse(0, 0, 2, 1.3, 0, 0, 7), c.fill())) },
    ],
  });
  rows.push({
    title: "Moments",
    cells: [
      { label: "Putt dust", ...tile((c) => drawFx(c, [{ kind: "puff", x: 0, y: 0, t: 0, seed: 3 } as Fx], 0.15, true)) },
      { label: "Wall knock", ...tile((c) => (drawRail(c, [v(-2, -1), v(2, -1)], false, 0.6), drawFx(c, [{ kind: "ring", x: 0, y: -0.4, t: 0, seed: 4 } as Fx], 0.15, true))) },
      { label: "Into the cup", ...tile((c) => (drawCup(c, v(0, 0.8), CUP_R), drawBall(c, 0.25, 0.75, BALL_R, { scale: 0.7 }), drawFlag(c, v(0, 0.8), T, 1, 0.4))) },
      { label: "Confetti", ...tile((c) => drawFx(c, [{ kind: "confetti", x: 0, y: 0, t: 0, seed: 5 } as Fx], 0.35, false)) },
      { label: "Mine goes off", ...tile((c) => drawFx(c, [{ kind: "boom", x: 0, y: 0, t: 0, seed: 6 } as Fx], 0.15, true)) },
      { label: "Off the edge", ...tile((c) => [1, 0.6, 0.25].forEach((k, i) => drawBall(c, -1.2 + i * 1.2, 0, BALL_R * 1.4, { scale: k, alpha: k }))) },
    ],
  });

  const swatchRows = Math.ceil(Object.keys(PALETTE).length / 4);
  const H = 70 + swatchRows * 44 + 20 + rows.length * (cell + 64) + 20;
  const el = document.createElement("canvas");
  const dpr = 2;
  el.width = W * dpr;
  el.height = H * dpr;
  const ctx = el.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = fg;
  ctx.font = "800 28px 'Oxanium Variable', system-ui";
  ctx.fillText("Golf: palette and parts", 20, 44);

  // Palette.
  let y = 70;
  Object.entries(PALETTE).forEach(([k, hex], i) => {
    const x = 20 + (i % 4) * 182, yy = y + Math.floor(i / 4) * 44;
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.roundRect(x, yy, 32, 32, 8);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = "600 13px system-ui";
    ctx.fillText(NAMES[k as keyof typeof PALETTE], x + 42, yy + 14);
    ctx.fillStyle = muted;
    ctx.font = "500 12px ui-monospace, monospace";
    ctx.fillText(hex, x + 42, yy + 29);
  });
  y += swatchRows * 44 + 20;

  for (const row of rows) {
    ctx.fillStyle = fg;
    ctx.font = "800 20px 'Oxanium Variable', system-ui";
    ctx.fillText(row.title, 20, y + 20);
    y += 32;
    row.cells.forEach((cellDef, i) => {
      const x = 20 + i * (cell + 3);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, cell, cell, 12);
      ctx.clip();
      ctx.fillStyle = PALETTE.grass;
      ctx.fillRect(x, y, cell, cell);
      if (cellDef.ground) {
        // A little mowing stripe so each part sits on the course as it would in play.
        ctx.fillStyle = PALETTE.mow;
        for (let k = -cell; k < cell * 2; k += 106) {
          ctx.beginPath();
          ctx.moveTo(x + k, y + cell);
          ctx.lineTo(x + k + 53, y + cell);
          ctx.lineTo(x + k + 53 + cell, y);
          ctx.lineTo(x + k + cell, y);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.setTransform(S * dpr, 0, 0, S * dpr, (x + cell / 2) * dpr, (y + cell / 2) * dpr);
      cellDef.draw(ctx);
      ctx.restore();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = muted;
      ctx.font = "500 12px system-ui";
      ctx.fillText(cellDef.label, x + 2, y + cell + 16);
    });
    y += cell + 32;
  }
  return el;
}
