import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { HEARTBEAT_MS, ONLINE_WINDOW_MS } from "../convex/presenceConfig";
import { PlayerAvatar } from "@/components/PlayerAvatar";

const TAP_THROTTLE_MS = 200;

// Reports that this player has the app open, which screen they're on, and where they tap.
export function usePresenceReporter({ shareTaps }: { shareTaps: boolean }) {
  const { pathname } = useLocation();
  const heartbeat = useMutation(api.presence.heartbeat);
  const tap = useMutation(api.presence.tap);
  const path = useRef(pathname);
  path.current = pathname;

  useEffect(() => {
    const beat = () => void heartbeat({ path: path.current, online: document.visibilityState === "visible" }).catch(() => {});
    beat();
    const timer = setInterval(() => document.visibilityState === "visible" && beat(), HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    window.addEventListener("pagehide", beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
      window.removeEventListener("pagehide", beat);
    };
  }, [heartbeat]);

  useEffect(() => {
    void heartbeat({ path: pathname, online: true }).catch(() => {});
  }, [pathname, heartbeat]);

  useEffect(() => {
    if (!shareTaps) return;
    let last = 0;
    const onDown = (e: PointerEvent) => {
      const now = performance.now();
      if (now - last < TAP_THROTTLE_MS) return;
      last = now;
      void tap({ x: e.clientX / window.innerWidth, y: e.clientY + window.scrollY, path: path.current }).catch(() => {});
    };
    document.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    return () => document.removeEventListener("pointerdown", onDown, { capture: true });
  }, [shareTaps, tap]);
}

// Live presence for everyone. Re-evaluates the online window on a timer, because queries only
// re-run when data changes, not when time passes.
export function usePresence() {
  const rows = useQuery(api.presence.list);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);
  return useMemo(() => {
    const byUser = new Map((rows ?? []).map((r) => [r.userId, r]));
    const isOnline = (userId: Id<"users">) => {
      const r = byUser.get(userId);
      return !!r && r.online && now - r.lastSeen < ONLINE_WINDOW_MS;
    };
    return { rows: rows ?? [], byUser, isOnline, loaded: rows !== undefined };
  }, [rows, now]);
}

// A steady green dot for someone with the app open. Offline shows nothing: red would read as an error.
export function OnlineDot({ online }: { online: boolean }) {
  if (!online) return null;
  return <span className="online-dot block" role="img" aria-label="Online" />;
}

export function lastSeenText(online: boolean, lastSeen: number | undefined) {
  if (online) return "On now";
  if (!lastSeen) return "Hasn't opened the app yet";
  const mins = Math.round((Date.now() - lastSeen) / 60_000);
  if (mins < 60) return `Last on ${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Last on ${hours}h ago`;
  return `Last on ${Math.round(hours / 24)}d ago`;
}

type Ripple = { key: string; x: number; y: number; userId: Id<"users"> };

// Shows other players' taps on the screen you're both looking at, as a ripple with their avatar.
export function TapLayer({ meId }: { meId: Id<"users"> | undefined }) {
  const { pathname } = useLocation();
  const { rows } = usePresence();
  const crew = useQuery(api.profiles.crew);
  const seen = useRef<Map<string, number> | null>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);

  useEffect(() => {
    // On first load, remember everyone's current tap so old taps don't replay.
    if (seen.current === null) {
      if (rows.length === 0) return;
      seen.current = new Map(rows.map((r) => [r.userId, r.tap?.seq ?? 0]));
      return;
    }
    const fresh: Ripple[] = [];
    for (const r of rows) {
      if (!r.tap || r.userId === meId) continue;
      if ((seen.current.get(r.userId) ?? 0) >= r.tap.seq) continue;
      seen.current.set(r.userId, r.tap.seq);
      if (r.tap.path !== pathname) continue;
      fresh.push({ key: `${r.userId}:${r.tap.seq}`, x: r.tap.x, y: r.tap.y, userId: r.userId });
    }
    if (fresh.length === 0) return;
    setRipples((rs) => [...rs, ...fresh].slice(-12));
    const keys = new Set(fresh.map((f) => f.key));
    setTimeout(() => setRipples((rs) => rs.filter((r) => !keys.has(r.key))), 1600);
  }, [rows, meId, pathname]);

  const people = useMemo(() => new Map((crew ?? []).map((p) => [p._id, p])), [crew]);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden="true">
      <AnimatePresence>
        {ripples.map((r) => {
          const p = people.get(r.userId);
          if (!p) return null;
          const left = r.x * window.innerWidth;
          const top = r.y - window.scrollY;
          return (
            <motion.div key={r.key} className="absolute" style={{ left, top }} initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }}>
              <motion.span
                className="absolute -left-7 -top-7 size-14 rounded-full border-2"
                style={{ borderColor: p.frameColor }}
                initial={{ scale: 0.2, opacity: 0.9 }}
                animate={{ scale: 1.6, opacity: 0 }}
                transition={{ duration: 0.9, ease: "easeOut" }}
              />
              <motion.span
                className="absolute -left-[18px] -top-[18px] block"
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 520, damping: 22 }}
              >
                <PlayerAvatar name={p.name} image={p.image} frame={p.frame === "none" ? "solid" : p.frame} frameColor={p.frameColor} size={36} />
              </motion.span>
              <motion.span
                className="absolute left-5 top-3 whitespace-nowrap rounded-full bg-foreground px-2 py-0.5 text-caption font-semibold text-background shadow-md"
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.08 }}
              >
                {p.name}
              </motion.span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// Everyone else who has the app open right now.
export function useOnlineOthers() {
  const me = useQuery(api.users.me);
  const crew = useQuery(api.profiles.crew);
  const { isOnline } = usePresence();
  return useMemo(() => (crew ?? []).filter((p) => p._id !== me?._id && isOnline(p._id)), [crew, me?._id, isOnline]);
}

// Players who are online and currently on a game's screens (their path starts with the game's path).
export function usePlayingIn(gamePath: string) {
  const crew = useQuery(api.profiles.crew);
  const { isOnline, byUser } = usePresence();
  return useMemo(
    () =>
      (crew ?? []).filter((p) => {
        const path = byUser.get(p._id)?.path ?? "";
        return isOnline(p._id) && (path === gamePath || path.startsWith(`${gamePath}/`));
      }),
    [crew, isOnline, byUser, gamePath],
  );
}

type Arrival = { key: string; name: string; image?: string; frame: string; frameColor: string };

// A Dynamic Island style pill that drops in when someone opens the app.
export function ArrivalPills() {
  const others = useOnlineOthers();
  const { loaded } = usePresence();
  const seen = useRef<Set<string> | null>(null);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);

  useEffect(() => {
    if (!loaded) return;
    const now = new Set(others.map((p) => p._id as string));
    // The first pass only records who's already here, so opening the app doesn't announce everyone.
    if (seen.current === null) {
      seen.current = now;
      return;
    }
    const fresh = others.filter((p) => !seen.current!.has(p._id));
    seen.current = now;
    if (fresh.length === 0) return;
    const items = fresh.map((p) => ({ key: `${p._id}:${Date.now()}`, name: p.name, image: p.image, frame: p.frame, frameColor: p.frameColor }));
    setArrivals((a) => [...a, ...items].slice(-3));
    const keys = new Set(items.map((i) => i.key));
    setTimeout(() => setArrivals((a) => a.filter((x) => !keys.has(x.key))), 3200);
  }, [others, loaded]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+36px)] z-50 flex flex-col items-center gap-2" aria-live="polite">
      <AnimatePresence>
        {arrivals.map((a) => (
          <motion.div
            key={a.key}
            layout
            initial={{ opacity: 0, y: -28, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.92, transition: { duration: 0.22 } }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="flex items-center gap-2.5 rounded-full bg-foreground py-1.5 pl-1.5 pr-4 text-background shadow-xl shadow-black/25"
          >
            <PlayerAvatar name={a.name} image={a.image} frame={a.frame} frameColor={a.frameColor} size={28} />
            <span className="text-callout font-semibold">
              {a.name} <span className="font-medium opacity-70">hopped on</span>
            </span>
            <span className="size-2 rounded-full bg-online" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
