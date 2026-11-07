import { useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import type { Placement, Tile } from "../../../convex/scrabble/engine";
import { sfx } from "@/sound";
import type { BoardHandle } from "./Board";
import { key } from "./useScrabbleDraft";

// Dragging a tile, from the rack or the board: onto a square, or back into the rack at a place of your choosing.
// A tap instead picks a rack tile up, or sends a board tile home. The held tile (`ghost`) follows the finger
// straight in the DOM.
export function useTileDrag({
  playing,
  swapping,
  setSwapping,
  setSelected,
  occupied,
  placed,
  inRack,
  rackSize,
  putDown,
  recall,
  setOrder,
}: {
  playing: boolean;
  swapping: number[] | null;
  setSwapping: Dispatch<SetStateAction<number[] | null>>;
  setSelected: Dispatch<SetStateAction<number | null>>;
  occupied: Set<string>;
  placed: Placement[];
  inRack: Tile[];
  rackSize: number;
  putDown: (id: number, x: number, y: number) => void;
  recall: (id: number) => void;
  setOrder: (order: number[]) => void;
}) {
  const board = useRef<BoardHandle>(null);
  const rackEl = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: number; from: "rack" | "board" } | null>(null);
  const [target, setTarget] = useState<[number, number] | null>(null);
  const [slot, setSlot] = useState<number | null>(null);

  const rackSlotAt = (clientX: number, clientY: number) => {
    const el = rackEl.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (clientY < r.top - 24 || clientY > r.bottom + 24) return null;
    const n = Math.max(1, rackSize);
    return Math.max(0, Math.min(inRack.length, Math.round(((clientX - r.left) / r.width) * n - 0.5)));
  };

  const startDrag = (id: number, from: "rack" | "board", e: ReactPointerEvent) => {
    if (!playing || swapping) {
      if (swapping && from === "rack") setSwapping((s) => (s!.includes(id) ? s!.filter((x) => x !== id) : [...s!, id]));
      return;
    }
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let cell: [number, number] | null = null;
    let at: number | null = null;
    // The tile leans into the direction you drag it, and settles when you stop.
    let lastX = x0;
    let tilt = 0;
    const place = (cx: number, cy: number) => {
      tilt = Math.max(-14, Math.min(14, tilt * 0.6 + (cx - lastX) * 0.9));
      lastX = cx;
      if (ghost.current) ghost.current.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%) rotate(${tilt}deg)`;
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!moved) {
        moved = true;
        setSelected(null);
        setDrag({ id, from });
        sfx("pick");
      }
      place(ev.clientX, ev.clientY);
      const c = board.current?.cellAt(ev.clientX, ev.clientY) ?? null;
      const free = c && !occupied.has(key(c[0], c[1])) && !placed.some((p) => p.x === c[0] && p.y === c[1] && p.id !== id) ? c : null;
      if (free?.[0] !== cell?.[0] || free?.[1] !== cell?.[1]) setTarget((cell = free));
      const s = free ? null : rackSlotAt(ev.clientX, ev.clientY);
      if (s !== at) setSlot((at = s));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      setTarget(null);
      setSlot(null);
      if (!moved) {
        // A tap: rack tiles get picked up, board tiles go home.
        if (from === "board") recall(id);
        else {
          setSelected((s) => (s === id ? null : id));
          sfx("pick");
        }
        return;
      }
      if (ev.type === "pointercancel") return;
      if (cell) putDown(id, cell[0], cell[1]);
      else if (at !== null) {
        const ids = inRack.map((t) => t.id).filter((x) => x !== id);
        ids.splice(Math.min(at, ids.length), 0, id);
        setOrder([...ids, ...placed.filter((p) => p.id !== id).map((p) => p.id)]);
        if (from === "board") recall(id);
        else sfx("place");
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    requestAnimationFrame(() => place(x0, y0));
  };

  return { board, rackEl, ghost, drag, target, slot, startDrag };
}
