import { useEffect, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { useLocation, useNavigationType } from "react-router";
import { useQuery } from "convex/react";
import { animate, motion, useMotionValue, type MotionValue } from "motion/react";
import { api } from "../convex/_generated/api";

// Screens come in like a native navigation stack: tabs switch instantly, a screen pushed on top of a tab
// slides in from the right, and Back (or a swipe from the left edge) slides it away again.

export const TAB_ROUTES = ["/", "/crew", "/you"];
const isTab = (path: string) => TAB_ROUTES.includes(path);
const SLIDE = { type: "spring", bounce: 0, duration: 0.42 } as const;

// 1 for a push, -1 for a pop, 0 for a tab switch (no animation).
export function useNavDirection() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  const prev = useRef(pathname);
  const from = prev.current;
  useEffect(() => {
    prev.current = pathname;
  }, [pathname]);
  if (from === pathname) return 0;
  if (isTab(from) && isTab(pathname)) return 0;
  if (isTab(from)) return 1;
  if (isTab(pathname)) return -1;
  return navType === "POP" ? -1 : 1;
}

const variants = {
  enter: (d: number) => (d === 0 ? { x: 0, zIndex: 1 } : { x: d > 0 ? window.innerWidth : -window.innerWidth * 0.3, zIndex: d > 0 ? 2 : 0 }),
  center: { x: 0, zIndex: 1, transition: SLIDE },
  exit: (d: number) =>
    d === 0 ? { opacity: 0, transition: { duration: 0 } } : { x: d > 0 ? -window.innerWidth * 0.3 : window.innerWidth, zIndex: d > 0 ? 0 : 2, transition: SLIDE },
};

// One screen in the stack. Pushed screens can be swiped back from the left edge.
export function Page({ children, direction, onBack, ref }: { children: ReactNode; direction: number; onBack: (() => void) | null; ref?: Ref<HTMLDivElement> }) {
  const x = useMotionValue(0);
  useEdgeSwipe(x, onBack);
  return (
    <motion.div
      ref={ref}
      custom={direction}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      style={{ x }}
      className="relative -mx-4 min-h-[100lvh] bg-background px-4"
    >
      {children}
    </motion.div>
  );
}

const EDGE = 24;

// Swipe right from the left edge to go back, tracking the finger 1:1. Past a third of the screen, or with a
// quick flick, it commits; otherwise it springs back. Boards and sheets keep their own touches.
function useEdgeSwipe(x: MotionValue<number>, onBack: (() => void) | null) {
  const back = useRef(onBack);
  back.current = onBack;
  const enabled = onBack !== null;
  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    let engaged = false;
    let samples: { x: number; t: number }[] = [];
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = null;
      if (e.touches.length !== 1 || t.clientX > EDGE) return;
      if ((e.target as Element | null)?.closest?.("[role=grid], [role=dialog], [role=alertdialog], [data-vaul-drawer]")) return;
      start = { x: t.clientX, y: t.clientY };
      engaged = false;
      samples = [{ x: t.clientX, t: e.timeStamp }];
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!engaged) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > dx) {
          start = null;
          return;
        }
        if (dx < 10) return;
        engaged = true;
      }
      e.preventDefault();
      x.set(Math.max(0, dx));
      samples = [...samples, { x: t.clientX, t: e.timeStamp }].slice(-5);
    };
    const onEnd = () => {
      if (!start || !engaged) {
        start = null;
        return;
      }
      start = null;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const velocity = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0; // px per ms
      if (x.get() > window.innerWidth / 3 || velocity > 0.5) back.current?.();
      else animate(x, 0, SLIDE);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, x]);
}

// Each history entry keeps its scroll position: a pushed screen starts at the top, and going back returns
// to where you were.
export function useScrollMemory(direction: number) {
  const { key } = useLocation();
  const positions = useRef(new Map<string, number>());
  const current = useRef(key);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => positions.current.set(current.current, window.scrollY));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    if (current.current === key) return;
    current.current = key;
    window.scrollTo(0, direction < 0 ? (positions.current.get(key) ?? 0) : 0);
  }, [key, direction]);
}

// The number on the home screen icon: games waiting on my move plus challenges to answer. Pushes set it
// while the app is closed (public/sw.js); this keeps it right while it's open.
export function useAppBadge() {
  const attention = useQuery(api.matches.attention);
  useEffect(() => {
    if (!attention || !("setAppBadge" in navigator)) return;
    const n = attention.myTurn + attention.invites;
    void (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }, [attention]);
}
