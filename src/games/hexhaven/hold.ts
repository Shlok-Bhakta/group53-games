import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

const HOLD_MS = 450;
const SLOP_PX = 10;

export function useHold(onHold: (x: number, y: number) => void) {
  const pending = useRef<{ timer: number; x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
  };
  useEffect(() => clear, []);
  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false;
      clear();
      const { clientX: x, clientY: y } = e;
      const timer = window.setTimeout(() => {
        pending.current = null;
        fired.current = true;
        navigator.vibrate?.(8);
        onHold(x, y);
      }, HOLD_MS);
      pending.current = { timer, x, y };
    },
    onPointerMove: (e: PointerEvent) => {
      const at = pending.current;
      if (at && Math.abs(e.clientX - at.x) + Math.abs(e.clientY - at.y) > SLOP_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onClickCapture: (e: MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  };
}
