import { useEffect, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { useLocation, useNavigationType } from "react-router";
import { useQuery } from "convex/react";
import { animate, motion, useIsPresent, useMotionValue, type MotionValue } from "motion/react";
import { api } from "../convex/_generated/api";

export const TAB_ROUTES = ["/", "/games", "/crew", "/you"];
const isTab = (path: string) => TAB_ROUTES.includes(path);
const SLIDE = { type: "spring", bounce: 0, duration: 0.42 } as const;

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
  enter: (d: number) =>
    d === 0 ? { x: 0, zIndex: 1 } : { x: d > 0 ? window.innerWidth : -window.innerWidth * 0.3, zIndex: d > 0 ? 2 : 0 },
  center: { x: 0, zIndex: 1, transition: SLIDE },
  exit: (d: number) =>
    d === 0
      ? { opacity: 0, transition: { duration: 0 } }
      : { x: d > 0 ? -window.innerWidth * 0.3 : window.innerWidth, zIndex: d > 0 ? 0 : 2, transition: SLIDE },
};

export function Page({
  children,
  direction,
  onBack,
  ref,
}: {
  children: ReactNode;
  direction: number;
  onBack: (() => void) | null;
  ref?: Ref<HTMLDivElement>;
}) {
  const x = useMotionValue(0);
  const present = useIsPresent();
  useEdgeSwipe(x, present ? onBack : null);
  return (
    <motion.div
      ref={ref}
      data-screen
      inert={!present}
      aria-hidden={present ? undefined : true}
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
      if ((e.target as Element | null)?.closest?.("[role=grid], [data-board], [role=dialog], [role=alertdialog], [data-vaul-drawer]"))
        return;
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
      const velocity = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
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

export function useAppBadge() {
  const attention = useQuery(api.matches.attention);
  useEffect(() => {
    if (!attention || !("setAppBadge" in navigator)) return;
    const n = attention.myTurn + attention.invites;
    void (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }, [attention]);
}

const SETTLE_MS = [0, 250, 750];
const QUIET_MS = 200;

function viewportGap(probe: HTMLElement) {
  const pinned = probe.getBoundingClientRect().top;
  const vv = window.visualViewport;
  const seen = vv ? vv.offsetTop + vv.height : window.innerHeight;
  return Math.max(0, Math.round(seen - pinned));
}

// platform: iOS standalone apps can keep a stale layout viewport after a rotation, the keyboard or coming back from the background, and position:fixed bottom:0 then lands above the real bottom edge.
// platform: while a finger drags or the page rubber-bands, iOS reports a moving viewport and a scrollTo cancels the bounce, so nothing is measured until the finger is up and scrolling has stopped.
export function useViewportGap() {
  useEffect(() => {
    const root = document.documentElement;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed;bottom:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none";
    document.body.append(probe);
    let timers: ReturnType<typeof setTimeout>[] = [];
    let retry: ReturnType<typeof setTimeout> | undefined;
    let nudged = false;
    let disposed = false;
    let touches = 0;
    let lastScroll = -Infinity;
    const later = () => {
      clearTimeout(retry);
      retry = setTimeout(() => requestAnimationFrame(apply), QUIET_MS);
    };
    const apply = () => {
      if (disposed) return;
      if (touches > 0 || performance.now() - lastScroll < QUIET_MS) {
        root.dataset.viewportSettling = "";
        if (touches === 0) later();
        return;
      }
      delete root.dataset.viewportSettling;
      const gap = viewportGap(probe);
      if (gap > 0 && !nudged) {
        nudged = true;
        const { scrollX, scrollY } = window;
        window.scrollTo(scrollX, scrollY + 1);
        window.scrollTo(scrollX, scrollY);
        return apply();
      }
      root.style.setProperty("--viewport-gap", `${gap}px`);
      root.dataset.viewportGap = String(gap);
    };
    const resync = () => {
      nudged = false;
      timers.forEach(clearTimeout);
      timers = SETTLE_MS.map((ms) => setTimeout(() => requestAnimationFrame(apply), ms));
    };
    const visible = () => document.visibilityState === "visible" && resync();
    const onScroll = () => {
      lastScroll = performance.now();
    };
    const onTouch = (e: TouchEvent) => {
      touches = e.touches.length;
      if (touches === 0 && root.dataset.viewportSettling !== undefined) later();
    };
    const vv = window.visualViewport;
    const onWindow = ["resize", "orientationchange", "pageshow", "focusout"] as const;
    const onTouches = ["touchstart", "touchend", "touchcancel"] as const;
    onWindow.forEach((e) => window.addEventListener(e, resync));
    onTouches.forEach((e) => document.addEventListener(e, onTouch, { passive: true }));
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", visible);
    vv?.addEventListener("resize", resync);
    resync();
    return () => {
      disposed = true;
      timers.forEach(clearTimeout);
      clearTimeout(retry);
      onWindow.forEach((e) => window.removeEventListener(e, resync));
      onTouches.forEach((e) => document.removeEventListener(e, onTouch));
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", visible);
      vv?.removeEventListener("resize", resync);
      probe.remove();
      delete root.dataset.viewportSettling;
      root.style.removeProperty("--viewport-gap");
    };
  }, []);
}

// platform: iOS ignores user-scalable=no, so a pinch that lands partly off a board zooms the whole app and every screen after it stays zoomed.
export function useNoPageZoom() {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop);
    return () => document.removeEventListener("gesturestart", stop);
  }, []);
}
