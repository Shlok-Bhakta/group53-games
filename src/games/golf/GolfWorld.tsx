import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowFatLinesUpIcon,
  ArrowsOutIcon,
  BasketballIcon,
  BombIcon,
  CaretLeftIcon,
  CarProfileIcon,
  ClockCounterClockwiseIcon,
  CloudIcon,
  CornersInIcon,
  CornersOutIcon,
  CrosshairIcon,
  FlagPennantIcon,
  GhostIcon,
  GolfIcon,
  HamburgerIcon,
  HandPalmIcon,
  LightningIcon,
  MagnetIcon,
  RocketLaunchIcon,
  SneakerMoveIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { BAG_SIZE, INSTANT, TARGETED, compile, groundAt, preview, type Power } from "../../../convex/golf/engine";
import { SANDBOX } from "../../../convex/golf/sandbox";
import { advance, cmdOrder, newWorld, TPS, unpack, type Ball, type Cmd, type Packed, type WorldState } from "../../../convex/golf/world";
import { useGoBack } from "@/components/AppHeader";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { usePlayingIn } from "@/presence";
import { SEAT_COLORS } from "@/games/seats";
import { useServerClock } from "@/games/chess/clock";
import { cn } from "@/lib/utils";
import * as sound from "./audio";
import { allCups, drawFrame, refreshTheme, type Camera, type Fx, type Juice, type Other } from "./toy";

// Golf's open world: everyone's ball on Driftwood Bay at once. Every phone runs the same physics from
// the server's settled snapshot plus everyone's commands (convex/golf.ts), so a shot is one tiny insert
// and the ball flies identically everywhere. Your own shot plays the instant you let go; someone else's
// arrives a moment late, and their ball eases onto where it really is rather than jumping.

const COURSE = SANDBOX;
const WORLD = compile(COURSE);
// Ball colors, in the order players first joined. Seat colors, minus the ones lost on grass.
const BALL_COLORS = [SEAT_COLORS.yellow, SEAT_COLORS.blue, SEAT_COLORS.pink, SEAT_COLORS.orange, SEAT_COLORS.purple, SEAT_COLORS.teal, SEAT_COLORS.red, "#f4f1e8"];
const colorOf = (b: Ball) => BALL_COLORS[b.color % BALL_COLORS.length];
// How long a correction takes to ease out, and the most it eases (past that it snaps).
const EASE_S = 0.14;
const SNAP = 4;

const ITEMS: Record<Power, { name: string; icon: Icon }> = {
  rocket: { name: "Rocket Driver", icon: RocketLaunchIcon },
  ghost: { name: "Ghost", icon: GhostIcon },
  magnet: { name: "Magnet", icon: MagnetIcon },
  brake: { name: "Brake", icon: HandPalmIcon },
  mulligan: { name: "Mulligan", icon: ClockCounterClockwiseIcon },
  bigcup: { name: "Big cup", icon: ArrowsOutIcon },
  jump: { name: "Jump", icon: ArrowFatLinesUpIcon },
  bouncy: { name: "Bouncy", icon: BasketballIcon },
  spring: { name: "Spring Boots", icon: SneakerMoveIcon },
  cart: { name: "Golf Cart", icon: CarProfileIcon },
  jumbo: { name: "Jumbo Burger", icon: HamburgerIcon },
  smoke: { name: "Smoke Bomb", icon: CloudIcon },
  laser: { name: "Orbital Laser", icon: CrosshairIcon },
  mine: { name: "Landmine", icon: BombIcon },
  railgun: { name: "Rail Gun", icon: LightningIcon },
};
const HINT: Partial<Record<Power, string>> = { laser: "Tap where to strike", mine: "Tap where to drop it", railgun: "Tap which way to fire" };

type Hud = { ready: boolean; mode: Ball["mode"] | null; bag: Power[]; armed: Power | null; shot: Power | null; holes: number };
type Vec = { x: number; y: number };

const round = "pointer-events-auto grid size-11 shrink-0 place-items-center rounded-full bg-card/90 shadow-md backdrop-blur-md transition-transform duration-100 active:scale-[0.94]";

export default function GolfWorld() {
  const me = useQuery(api.users.me);
  const meId = me?._id;
  const view = useQuery(api.golf.world);
  const join = useMutation(api.golf.join);
  const [worldId, setWorldId] = useState<Id<"golfWorlds"> | null>(null);
  useEffect(() => {
    join({})
      .then(setWorldId)
      .catch(() => toast.error("Couldn't get into the world."));
  }, [join]);
  const from = view?.snapshot?.tick ?? 0;
  const fromRef = useRef(from);
  fromRef.current = from;
  const cmds = useQuery(api.golf.commands, worldId ? { worldId, from } : "skip");
  const clock = useServerClock();
  const act = useMutation(api.golf.act).withOptimisticUpdate((store, args) => {
    const q = { worldId: args.worldId, from: fromRef.current };
    const list = store.getQuery(api.golf.commands, q);
    if (!list || !meId) return;
    const { worldId: _w, clientTick, ...rest } = args;
    store.setQuery(api.golf.commands, q, [...list, { ...rest, by: meId, tick: Math.floor(clientTick) }]);
  });
  const goBack = useGoBack("/");
  const playing = usePlayingIn("/golf");

  // The world as this phone sees it. Rebuilt from the snapshot whenever the commands change; stepped
  // forward with the clock every frame in between.
  const net = useRef<{
    state: WorldState | null;
    dirty: boolean;
    base: Packed | null;
    cmds: Cmd[];
    startAt: number;
    collide: boolean;
    prev: Map<string, Vec>; // each ball a tick ago, to draw between ticks
    off: Map<string, Vec>; // corrections still easing out
    seen: Map<string, number>; // events already played, by when
    seq: number;
  }>({ state: null, dirty: false, base: null, cmds: [], startAt: 0, collide: true, prev: new Map(), off: new Map(), seen: new Map(), seq: Date.now() % 1_000_000_000 });
  useEffect(() => {
    if (!view || !cmds) return;
    const n = net.current;
    n.base = view.snapshot;
    n.startAt = view.startAt;
    n.collide = view.collide;
    n.cmds = (cmds as Cmd[]).slice().sort(cmdOrder);
    n.dirty = true;
  }, [view, cmds]);
  const names = useMemo(() => new Map((view?.players ?? []).map((p) => [p.id as string, p.name.split(" ")[0]])), [view?.players]);
  const namesRef = useRef(names);
  namesRef.current = names;
  const meRef = useRef(meId);
  meRef.current = meId;

  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ x: COURSE.tee.x, y: COURSE.tee.y, s: 16, ox: 0, oy: 0 });
  const box = useRef({ w: 0, h: 0, fit: 4, play: 16, top: 90, bottom: 120, panned: 0 });
  const [overview, setOverview] = useState(false);
  const overviewRef = useRef(overview);
  overviewRef.current = overview;
  const aim = useRef<{ angle: number; power: number; line: Vec[]; from?: Vec; to?: Vec } | null>(null);
  const fx = useRef<Fx[]>([]);
  const hits = useRef(new Map<number, number>());
  const juice = useRef<Juice>({ start: 0, spawn: 0.3, impact: null });
  const shake = useRef({ t: -9, power: 0, a: 0 });
  const trail = useRef<Vec[]>([]);
  const flagOut = useRef(new Map<number, number>());
  const [target, setTarget] = useState<{ i: number; kind: Power } | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const targetAt = useRef<Vec | null>(null);
  const [hud, setHud] = useState<Hud>({ ready: false, mode: null, bag: [], armed: null, shot: null, holes: 0 });

  // Full screen: the sea runs up under the status bar.
  useEffect(() => {
    document.documentElement.dataset.fullbleed = "";
    sound.listen();
    return () => {
      delete document.documentElement.dataset.fullbleed;
      sound.stop();
    };
  }, []);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.current!.width = Math.round(r.width * dpr);
      cv.current!.height = Math.round(r.height * dpr);
      const b = box.current;
      b.w = r.width;
      b.h = r.height;
      b.top = (top.current?.getBoundingClientRect().bottom ?? 90) - r.top + 8;
      b.bottom = r.bottom - (dock.current?.getBoundingClientRect().top ?? r.bottom - 120) + 8;
      b.fit = Math.min((r.width - 16) / COURSE.w, (r.height - b.top - b.bottom) / COURSE.h);
      b.play = r.width / 24;
      cam.current.ox = r.width / 2;
      cam.current.oy = b.top + (r.height - b.top - b.bottom) / 2;
      if (!overviewRef.current) cam.current.s = b.play;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = cam.current, b = box.current;
    if (overview) {
      c.s = b.fit;
      c.x = COURSE.w / 2;
      c.y = COURSE.h / 2;
    } else c.s = b.play;
  }, [overview]);

  // The loop: step the world to now, play what happened, draw.
  useEffect(() => {
    const ctx = cv.current!.getContext("2d")!;
    refreshTheme();
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let lastHud = "";
    let lastKnock = 0;
    let stoppedAt = -9;
    let wasRolling = false;
    const n = net.current;

    const positions = (s: WorldState) => new Map(s.balls.map((b) => [b.id, { x: b.x, y: b.y }]));
    const myBall = (s: WorldState) => s.balls.find((b) => b.id === meRef.current);

    // "fresh": just happened, play it. "rebuilt": history replayed after a late command; play only what's
    // recent and not heard yet. "arrived": the first build on opening; nothing plays.
    const play = (s: WorldState, how: "fresh" | "rebuilt" | "arrived") => {
      const fresh = how === "fresh";
      const mine = myBall(s);
      for (const { tick, id, ev } of s.events) {
        const key = `${tick}:${id}:${ev.type}:${Math.round(ev.x * 10)}:${Math.round(ev.y * 10)}`;
        if (n.seen.has(key)) continue;
        n.seen.set(key, tick);
        // Rebuilt history only plays what's recent: a late command's first moments, not old news.
        if (how === "arrived" || (!fresh && tick < s.tick - TPS / 2)) continue;
        const isMe = id === meRef.current;
        const near = Math.hypot(ev.x - cam.current.x, ev.y - cam.current.y) < 30;
        const seed = (tick * 31 + ev.x * 7) | 0;
        const now = performance.now();
        switch (ev.type) {
          case "hit":
            if (near) sound.putt(ev.power);
            if (isMe) trail.current = [];
            fx.current.push({ kind: "puff", x: ev.x, y: ev.y, t, seed });
            break;
          case "bounce":
          case "clack":
            if (near && now - lastKnock > 60) sound.knock(ev.type === "clack" ? Math.max(0.5, ev.power) : ev.power);
            lastKnock = now;
            if (isMe && mine) juice.current.impact = { t, n: Math.atan2(mine.vy, mine.vx), power: ev.power };
            if (ev.power > 0.15 || ev.type === "clack") fx.current.push({ kind: "ring", x: ev.x, y: ev.y, t, seed });
            break;
          case "bump": {
            if (near && now - lastKnock > 50) sound.bump();
            lastKnock = now;
            const i = COURSE.bumpers.findIndex((b) => Math.hypot(b.at.x - ev.x, b.at.y - ev.y) < 0.01);
            if (i >= 0) hits.current.set(i, t);
            if (isMe && mine) {
              juice.current.impact = { t, n: Math.atan2(mine.vy, mine.vx), power: 0.5 };
              shake.current = { t, power: 0.12, a: Math.atan2(mine.vy, mine.vx) };
            }
            break;
          }
          case "splash":
            if (near) sound.drop();
            if (isMe && mine) juice.current.outV = { x: mine.vx, y: mine.vy };
            fx.current.push({ kind: "ring", x: ev.x, y: ev.y, t, seed, color: "#dfe9e3" });
            break;
          case "sink": {
            if (near) sound.plunk();
            fx.current.push({ kind: "ring", x: ev.x, y: ev.y, t, seed }, { kind: "ring", x: ev.x, y: ev.y, t: t + 0.12, seed }, { kind: "confetti", x: ev.x, y: ev.y - 1, t: t + 0.15, seed });
            const ci = allCups(COURSE).findIndex((k) => Math.hypot(k.x - ev.x, k.y - ev.y) < 0.01);
            if (ci >= 0 && !isMe) flagOut.current.set(ci, t);
            if (!isMe) toast(`${namesRef.current.get(id) ?? "Someone"} sank one`);
            break;
          }
          case "spawn":
            if (isMe) {
              juice.current.spawn = t;
              juice.current.flag = undefined;
              juice.current.flags = undefined;
            }
            break;
          case "box":
            if (isMe) sound.pickup();
            fx.current.push({ kind: "boxpop", x: ev.x, y: ev.y, t, seed }, { kind: "spark", x: ev.x, y: ev.y, t, seed });
            if (isMe) fx.current.push({ kind: "label", x: ev.x, y: ev.y, t, seed, text: ITEMS[ev.item].name });
            break;
          case "launch":
            if (near) sound.whoosh();
            break;
          case "land":
            if (near) sound.land(ev.power);
            break;
          case "lip":
            if (near) sound.lip();
            break;
          case "boom":
            if (near) sound.blast(1);
            fx.current.push({ kind: "boom", x: ev.x, y: ev.y, t, seed, color: "big" }, { kind: "ring", x: ev.x, y: ev.y, t, seed, big: 2.2 }, { kind: "spark", x: ev.x, y: ev.y, t, seed });
            if (near) shake.current = { t, power: 0.55, a: seed };
            break;
          case "mine":
          case "smash":
            if (near) sound.blast(ev.type === "mine" ? 0.8 : 0.5);
            fx.current.push({ kind: "boom", x: ev.x, y: ev.y, t, seed }, { kind: "ring", x: ev.x, y: ev.y, t, seed, big: 1.3 }, { kind: "spark", x: ev.x, y: ev.y, t: t + 0.02, seed });
            if (near) shake.current = { t, power: ev.type === "mine" ? 0.4 : 0.2, a: seed };
            break;
          case "rail":
            if (near) sound.whoosh();
            fx.current.push({ kind: "rail", x: ev.x, y: ev.y, x2: ev.x2, y2: ev.y2, t, seed });
            break;
          case "stop":
            if (isMe) sound.brake();
            break;
        }
      }
      s.events.length = 0;
      // Forget events too old to come round again.
      for (const [k, tick] of n.seen) if (tick < s.tick - TPS * 3) n.seen.delete(k);
    };

    const frame = (nowMs: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      t += dt;
      if (!clock.ready || n.startAt === 0 || (!n.dirty && !n.state)) return;
      const tf = ((clock.now() - n.startAt) * TPS) / 1000;
      const target = Math.max(0, Math.floor(tf));
      const frac = Math.max(0, Math.min(1, tf - target));

      // New commands or a new snapshot: rebuild from the snapshot, and ease every ball from where it
      // was drawn to where it really is.
      if (n.dirty) {
        n.dirty = false;
        const before = n.state ? positions(n.state) : null;
        const s = n.base ? unpack(n.base) : newWorld(COURSE, { collide: n.collide });
        advance(s, WORLD, Math.max(s.tick, target), n.cmds);
        if (before)
          for (const b of s.balls) {
            const was = before.get(b.id);
            if (!was) continue;
            const o = n.off.get(b.id) ?? { x: 0, y: 0 };
            const dx = was.x + o.x - b.x, dy = was.y + o.y - b.y;
            n.off.set(b.id, Math.hypot(dx, dy) > SNAP ? { x: 0, y: 0 } : { x: dx, y: dy });
          }
        n.state = s;
        n.prev = positions(s);
        play(s, before ? "rebuilt" : "arrived");
      }
      const s = n.state!;
      if (target > s.tick) {
        if (target - 1 > s.tick) advance(s, WORLD, target - 1, n.cmds);
        n.prev = positions(s);
        advance(s, WORLD, target, n.cmds);
        play(s, "fresh");
      }
      const k = 1 - Math.exp(-dt / EASE_S);
      for (const [id, o] of n.off) {
        o.x -= o.x * k;
        o.y -= o.y * k;
        if (Math.abs(o.x) + Math.abs(o.y) < 1e-3) n.off.delete(id);
      }
      const drawn = (b: Ball): Vec => {
        const p = n.prev.get(b.id) ?? b;
        const o = n.off.get(b.id) ?? { x: 0, y: 0 };
        const jumped = Math.hypot(b.x - p.x, b.y - p.y) > 1.5;
        return jumped ? { x: b.x + o.x, y: b.y + o.y } : { x: p.x + (b.x - p.x) * frac + o.x, y: p.y + (b.y - p.y) * frac + o.y };
      };

      const mine = myBall(s);
      if (!mine) return;
      const at = drawn(mine);
      if (mine.mode === "roll") {
        wasRolling = true;
        const tr = trail.current;
        const lp = tr[tr.length - 1];
        if (!lp || Math.hypot(lp.x - at.x, lp.y - at.y) > 0.25) tr.push({ ...at });
        if (tr.length > 24) tr.shift();
      } else if (wasRolling) {
        wasRolling = false;
        stoppedAt = t;
      }
      sound.rolling(mine.mode === "roll" && mine.z <= 0 ? Math.hypot(mine.vx, mine.vy) : 0, mine.mode === "roll" ? groundAt(WORLD, mine) : null);

      // The camera follows my ball, leaning the way it's going (or toward the nearest flag).
      const c = cam.current, bx = box.current;
      if (!overviewRef.current && nowMs - bx.panned > 1500) {
        const cup = allCups(COURSE).reduce((a, q) => (Math.hypot(q.x - at.x, q.y - at.y) < Math.hypot(a.x - at.x, a.y - at.y) ? q : a));
        const dx = cup.x - at.x, dy = cup.y - at.y, d = Math.hypot(dx, dy) || 1;
        const lean = mine.mode === "roll" ? { x: mine.vx * 0.35, y: mine.vy * 0.35 } : { x: (dx / d) * Math.min(5, d * 0.3), y: (dy / d) * Math.min(5, d * 0.3) };
        const kc = 1 - Math.exp(-dt * 3);
        c.x += (at.x + lean.x - c.x) * kc;
        c.y += (at.y + lean.y - c.y) * kc;
      }
      const sa = t - shake.current.t;
      const sk = sa < 0.45 ? shake.current.power * Math.exp(-sa * 9) * Math.sin(sa * 52) : 0;
      const shook = sk !== 0 ? { ...c, x: c.x + Math.cos(shake.current.a) * sk, y: c.y + Math.sin(shake.current.a) * sk } : c;

      fx.current = fx.current.filter((f) => t - f.t < 2);
      const others: Other[] = s.balls.filter((b) => b !== mine).map((b) => ({ sim: b, at: drawn(b), color: colorOf(b), name: namesRef.current.get(b.id) ?? "" }));
      const tg = targetRef.current;
      drawFrame(ctx, {
        c: COURSE,
        sim: mine,
        cam: shook,
        juice: juice.current,
        dpr: cv.current!.width / Math.max(1, bx.w),
        t,
        trail: trail.current,
        ball: at,
        trailAlpha: mine.mode === "roll" ? 1 : Math.max(0, 1 - (t - stoppedAt) / 0.4),
        fx: fx.current,
        hits: hits.current,
        aim: aim.current,
        target: tg && (tg.kind === "laser" || tg.kind === "mine" || tg.kind === "railgun") ? { kind: tg.kind, at: targetAt.current } : null,
        inset: { top: bx.top, bottom: bx.bottom },
        others,
        myColor: colorOf(mine),
        flagOut: flagOut.current,
      });

      const h = `${mine.mode}|${mine.bag.join()}|${mine.armed}|${mine.shot}|${mine.holes}`;
      if (h !== lastHud) {
        lastHud = h;
        setHud({ ready: true, mode: mine.mode, bag: [...mine.bag], armed: mine.armed, shot: mine.shot, holes: mine.holes });
      }
    };
    raf = requestAnimationFrame(frame);
    // For the e2e suite: every ball as this phone has it.
    (window as unknown as { __golf?: unknown }).__golf = {
      balls: () => n.state?.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, mode: b.mode, holes: b.holes })) ?? [],
      tick: () => n.state?.tick ?? -1,
      me: () => meRef.current,
    };
    return () => {
      cancelAnimationFrame(raf);
      sound.rolling(0, null);
    };
  }, [clock]);

  // --- Input: drag back to aim and let go to shoot; tap the map to place a targeted item. ---
  const pointers = useRef(new Map<number, Vec>());
  const gesture = useRef<{ kind: "aim" | "pan" | "pinch" | "target"; start?: Vec; d0?: number; s0?: number; mid?: Vec } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (p: Vec) => ({ x: (p.x - cam.current.ox) / cam.current.s + cam.current.x, y: (p.y - cam.current.oy) / cam.current.s + cam.current.y });
  const maxPull = () => Math.min(190, box.current.w * 0.46);
  const mine = () => net.current.state?.balls.find((b) => b.id === meRef.current);
  const tickNow = () => Math.max(0, Math.floor(((clock.now() - net.current.startAt) * TPS) / 1000));
  const send = (kind: "shot" | "use" | "fire" | "hop" | "brake" | "reset", extra: { a?: number; p?: number; i?: number; x?: number; y?: number } = {}) => {
    if (!worldId) return;
    act({ worldId, kind, clientTick: tickNow(), seq: ++net.current.seq, ...extra }).catch(() => toast.error("That didn't go through."));
  };

  const down = (e: RPointerEvent) => {
    sound.unlock();
    cv.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      aim.current = null;
      gesture.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), s0: cam.current.s, mid: toWorld({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) };
      return;
    }
    const m = mine();
    if (!m) return;
    if (m.mode === "roll" && m.shot === "brake") return send("brake");
    if (m.mode === "roll" && m.shot === "jump") return send("hop");
    if (targetRef.current && m.mode === "aim") {
      gesture.current = { kind: "target" };
      targetAt.current = toWorld(p);
      return;
    }
    gesture.current = m.mode === "aim" && !e.shiftKey && e.button !== 2 ? { kind: "aim", start: p } : { kind: "pan" };
  };
  const move = (e: RPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    const m = mine();
    if (!g || !m) return;
    if (g.kind === "target") targetAt.current = toWorld(p);
    else if (g.kind === "aim" && g.start) {
      const dx = g.start.x - p.x, dy = g.start.y - p.y;
      const pull = Math.hypot(dx, dy);
      if (pull < 10) {
        aim.current = null;
        return;
      }
      const power = Math.min(1, pull / maxPull()) ** 1.35;
      const angle = Math.atan2(dy, dx);
      aim.current = { angle, power, line: preview(WORLD, m, angle, power, m.armed === "ghost"), from: g.start, to: p };
    } else if (g.kind === "pan") {
      cam.current.x -= (p.x - prev.x) / cam.current.s;
      cam.current.y -= (p.y - prev.y) / cam.current.s;
      box.current.panned = performance.now();
    } else if (g.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const bx = box.current;
      cam.current.s = Math.max(bx.fit, Math.min(bx.play * 2, g.s0! * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0!)));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      cam.current.x = g.mid!.x - (mid.x - cam.current.ox) / cam.current.s;
      cam.current.y = g.mid!.y - (mid.y - cam.current.oy) / cam.current.s;
      bx.panned = performance.now();
    }
  };
  const up = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "aim" && aim.current && aim.current.power > 0.01) {
      send("shot", { a: aim.current.angle, p: aim.current.power });
      box.current.panned = 0;
      if (overviewRef.current) setOverview(false);
    }
    if (g?.kind === "aim") aim.current = null;
    if (g?.kind === "target" && targetRef.current && targetAt.current) {
      send("fire", { i: targetRef.current.i, ...targetAt.current });
      if (targetRef.current.kind === "mine") sound.knock(0.5);
      targetAt.current = null;
      setTarget(null);
    }
    if (pointers.current.size === 0) gesture.current = null;
    else if (g?.kind === "pinch") gesture.current = { kind: "pan" };
  };
  useEffect(() => {
    const el = cv.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const bx = box.current;
      cam.current.s = Math.max(bx.fit, Math.min(bx.play * 2, cam.current.s * Math.exp(-e.deltaY * 0.0015)));
      bx.panned = performance.now();
    };
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", menu);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", menu);
    };
  }, []);

  const tapItem = (i: number) => {
    const p = hud.bag[i];
    if (!p || hud.mode !== "aim") return;
    if (TARGETED.includes(p)) {
      setTarget(target?.i === i ? null : { i, kind: p });
      return;
    }
    if (INSTANT.includes(p)) sound.pickup();
    send("use", { i });
  };
  const others = playing.filter((p) => p._id !== meId);

  return (
    <div ref={wrap} data-mode={hud.mode ?? ""} className="relative -mx-4 -mb-[calc(env(safe-area-inset-bottom)+16px)] h-[100dvh] touch-none select-none overflow-hidden bg-background">
      <canvas ref={cv} className="absolute inset-0 size-full" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label={`${COURSE.name}, an open course`} />

      <div ref={top} className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+34px)] z-20 flex items-center gap-2 px-3">
        <button type="button" aria-label="Back" onClick={goBack} className={round}>
          <CaretLeftIcon size={22} weight="bold" />
        </button>
        <div className="pointer-events-auto flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-card/90 py-1 pl-4 pr-1.5 shadow-md backdrop-blur-md">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-callout leading-tight">{COURSE.name}</span>
            <span className="block truncate text-caption text-muted-foreground">{others.length === 0 ? "Just you" : others.length === 1 ? `${others[0].name} is here` : `${others.length + 1} here`}</span>
          </span>
          {others.length > 0 && (
            <span className="flex shrink-0 -space-x-2">
              {others.slice(0, 3).map((p) => (
                <PlayerAvatar key={p._id} name={p.name} image={p.image} size={28} className="rounded-full ring-2 ring-card" />
              ))}
            </span>
          )}
          <span className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-primary px-3 font-display text-callout text-primary-foreground" aria-label={`${hud.holes} sunk`}>
            <FlagPennantIcon weight="fill" size={16} />
            {hud.holes}
          </span>
        </div>
      </div>

      <AnimatePresence>
        {target && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: "spring", bounce: 0, duration: 0.3 }}
            className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+92px)] z-20 flex justify-center"
          >
            <span className="flex min-h-11 items-center gap-2 rounded-full bg-card/90 py-1 pl-4 pr-1 font-display text-callout shadow-md backdrop-blur-md">
              {HINT[target.kind]}
              <button type="button" aria-label="Cancel" onClick={() => setTarget(null)} className="grid size-9 place-items-center rounded-full bg-muted active:scale-[0.94]">
                <XIcon weight="bold" />
              </button>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={dock} className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
        <div className="flex gap-2">
          {Array.from({ length: BAG_SIZE }, (_, i) => {
            const p = hud.bag[i];
            const item = p ? ITEMS[p] : null;
            const Ico = item?.icon;
            const on = target?.i === i || (p && hud.armed === p && i === hud.bag.indexOf(p));
            return (
              <button
                key={`${i}-${p ?? "empty"}`}
                type="button"
                disabled={!p || hud.mode !== "aim"}
                onClick={() => tapItem(i)}
                aria-label={item ? `Use ${item.name}` : "Empty slot"}
                className={cn(
                  "grid size-14 place-items-center rounded-lg bg-card/90 shadow-md backdrop-blur-md transition-transform duration-100 active:scale-[0.94] disabled:opacity-60",
                  !p && "bg-card/50 shadow-none",
                  on && "bg-primary text-primary-foreground",
                )}
              >
                {Ico && (
                  <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.4, duration: 0.4 }}>
                    <Ico size={26} weight={on ? "fill" : "bold"} />
                  </motion.span>
                )}
              </button>
            );
          })}
        </div>
        {hud.armed && (
          <span className="min-w-0 flex-1 truncate text-center font-display text-footnote text-foreground [text-shadow:0_1px_3px_var(--background)]">{ITEMS[hud.armed].name} next shot</span>
        )}
        {!hud.armed && <span className="flex-1" />}
        {hud.mode === "roll" && (hud.shot === "brake" || hud.shot === "jump") ? (
          <button type="button" onPointerDown={() => send(hud.shot === "jump" ? "hop" : "brake")} className="flex h-14 items-center rounded-lg bg-primary px-5 font-display text-callout text-primary-foreground shadow-md active:scale-[0.97]">
            {hud.shot === "jump" ? "Jump" : "Brake"}
          </button>
        ) : (
          <>
            <button type="button" aria-label={overview ? "Follow my ball" : "See the whole map"} onClick={() => setOverview((o) => !o)} className={cn(round, "size-14")}>
              {overview ? <CornersInIcon size={24} weight="bold" /> : <CornersOutIcon size={24} weight="bold" />}
            </button>
            <button type="button" aria-label="Back to a tee" disabled={hud.mode !== "aim"} onClick={() => send("reset")} className={cn(round, "size-14 disabled:opacity-60")}>
              <GolfIcon size={24} weight="bold" />
            </button>
          </>
        )}
      </div>

      {!hud.ready && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
          <span className="rounded-full bg-card/90 px-4 py-2 font-display text-callout shadow-md">Teeing up</span>
        </div>
      )}
    </div>
  );
}
