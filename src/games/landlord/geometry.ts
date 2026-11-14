// Where each square sits on the board, in board pixels. Corners are C square; the nine squares along each side
// are W wide and C deep. Square 0 (Start) is the bottom-right corner and play runs clockwise from there: along
// the bottom to jail, up the left, along the top, down the right.

export const W = 76;
export const C = 116;
export const SIDE = 2 * C + 9 * W;

export type Box = { x: number; y: number; w: number; h: number; edge: "bottom" | "left" | "top" | "right" | "corner" };

export function boxOf(pos: number): Box {
  const end = SIDE - C;
  if (pos === 0) return { x: end, y: end, w: C, h: C, edge: "corner" };
  if (pos < 10) return { x: end - pos * W, y: end, w: W, h: C, edge: "bottom" };
  if (pos === 10) return { x: 0, y: end, w: C, h: C, edge: "corner" };
  if (pos < 20) return { x: 0, y: end - (pos - 10) * W, w: C, h: W, edge: "left" };
  if (pos === 20) return { x: 0, y: 0, w: C, h: C, edge: "corner" };
  if (pos < 30) return { x: C + (pos - 21) * W, y: 0, w: W, h: C, edge: "top" };
  if (pos === 30) return { x: end, y: 0, w: C, h: C, edge: "corner" };
  return { x: end, y: C + (pos - 31) * W, w: C, h: W, edge: "right" };
}

export const centerOf = (pos: number) => {
  const b = boxOf(pos);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
};

// Where a player's piece stands: on the square's outer edge, half off the board, so it never covers the name or
// price, with others on the same square spread along that edge. In jail, inside the cell (toward the middle).
export function spotOf(pos: number, index: number, count: number, jailed = false) {
  const b = boxOf(pos);
  const gap = 30;
  const off = (index - (count - 1) / 2) * gap;
  if (pos === 10 && jailed) return { x: b.x + b.w * 0.66 + (index % 2) * 24 - 12, y: b.y + b.h * 0.34 + Math.floor(index / 2) * 24 - 12 };
  switch (b.edge) {
    case "bottom":
      return { x: b.x + b.w / 2 + off * 0.75, y: b.y + b.h - 2 };
    case "top":
      return { x: b.x + b.w / 2 + off * 0.75, y: b.y + 2 };
    case "left":
      return { x: b.x + 2, y: b.y + b.h / 2 + off * 0.75 };
    case "right":
      return { x: b.x + b.w - 2, y: b.y + b.h / 2 + off * 0.75 };
    default: {
      // A corner: along its two outer edges, out from the corner itself.
      const right = b.x > 0;
      const down = b.y > 0;
      const along = 26 + Math.floor(index / 2) * gap;
      const horizontal = index % 2 === 0;
      const x = right ? b.x + b.w - 2 : b.x + 2;
      const y = down ? b.y + b.h - 2 : b.y + 2;
      return horizontal ? { x: right ? b.x + b.w - along : b.x + along, y } : { x, y: down ? b.y + b.h - along : b.y + along };
    }
  }
}
