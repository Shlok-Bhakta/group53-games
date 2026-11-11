import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import { canShoot, groundUnder, newSim, type Course, type Power } from "../../../convex/golf/engine";
import type { worldOf } from "../../../convex/golf/holes";
import { advance, newWorld, TPS, unpack, withPending, type Ball, type WorldState } from "../../../convex/golf/world";
import { SEAT_COLORS } from "@/games/seats";
import * as sound from "./audio";
import { ITEMS } from "./items";
import { allCups, drawFrame, refreshTheme, type Camera, type Fx, type Juice, type Other } from "./toy";
import type { Hud } from "./Hud";
import type { GolfNet } from "./useGolfNet";
import type { HoleInfo, Round } from "./GolfWorld";

// Ball colors, in the order players first joined. Seat colors, minus the ones lost on grass.
const BALL_COLORS = [SEAT_COLORS.yellow, SEAT_COLORS.blue, SEAT_COLORS.pink, SEAT_COLORS.orange, SEAT_COLORS.purple, SEAT_COLORS.teal, SEAT_COLORS.red, "#f4f1e8"];
const colorOf = (b: Ball) => BALL_COLORS[b.color % BALL_COLORS.length];
// How long a correction takes to ease out: quick for a small one, a touch longer for a long way, so a
// ball glides onto where it really is however late the news came. Only a real teleport (sinking and
// going back to a tee) jumps.
const EASE_S = 0.14;
const EASE_FAR_S = 0.28;
const FAR = 4;
// A command the server hasn't confirmed after this long means the connection's struggling.
const SLOW_MS = 1200;

// What's happening to my ball, in a word or two for the dock.
function statusOf(b: Ball) {
  if (b.t < b.frozenUntil) return "Frozen";
  if (b.t < b.stunUntil) return "Stunned";
  if (b.rattled) return "Rattled";
  if (b.t < b.blindUntil) return "Blinded";
  if (b.t < b.shieldUntil) return "Shielded";
  if (b.t < b.coffeeUntil) return "Caffeinated";
  return null;
}
type Vec = { x: number; y: number };

export type Box = { w: number; h: number; fit: number; play: number; top: number; bottom: number; panned: number; big: boolean };
export type Aim = { angle: number; power: number; line: Vec[]; from?: Vec; to?: Vec };
export type Target = { i: number; kind: Power };
// What the screen shares with the loop: the canvas, the camera and the layout, and what the finger's doing.
export type Scene = {
  cv: RefObject<HTMLCanvasElement | null>;
  cam: RefObject<Camera>;
  box: RefObject<Box>;
  overview: RefObject<boolean>;
  aim: RefObject<Aim | null>;
  blind: RefObject<HTMLDivElement | null>;
  target: RefObject<Target | null>;
  targetAt: RefObject<Vec | null>;
};

export function useGolfLoop({
  course: COURSE,
  world: WORLD,
  hole,
  round,
  net: g,
  scene,
  setHud,
  setResult,
}: {
  course: Course;
  world: ReturnType<typeof worldOf>;
  hole: HoleInfo | undefined;
  // In a game: whose turn it is and everyone's colors, always the latest.
  round: RefObject<Round | undefined>;
  net: GolfNet;
  scene: Scene;
  setHud: Dispatch<SetStateAction<Hud>>;
  setResult: Dispatch<SetStateAction<{ strokes: number } | null>>;
}) {
  const { clock, net, meRef, namesRef, worldIdRef, joinRef, fromRef, sendRef } = g;
  const { cv, cam, box, overview: overviewRef, aim, blind, target: targetRef, targetAt } = scene;
  const fx = useRef<Fx[]>([]);
  const hits = useRef(new Map<number, number>());
  const juice = useRef<Juice>({ start: 0, spawn: 0.3, impact: null });
  const shake = useRef({ t: -9, power: 0, a: 0 });
  const trail = useRef<Vec[]>([]);
  const flagOut = useRef(new Map<number, number>());
  const lastDrawn = useRef<Vec | null>(null);

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
    let lastJoin = performance.now();
    const smoked = new Map<string, number>();
    const n = net.current;

    const positions = (s: WorldState) => new Map(s.balls.map((b) => [b.id, { x: b.x, y: b.y }]));
    const myBall = (s: WorldState) => s.balls.find((b) => b.id === meRef.current);
    // In a game, seat colors; elsewhere, the order people turned up in.
    const ballColor = (b: Ball) => round.current?.colorOf(b.id) ?? colorOf(b);
    // Who the camera follows: in a turn-based game whoever's shooting, otherwise me, or (watching, or
    // done with the hole) whoever's still out there.
    const focusOf = (s: WorldState, mine: Ball | undefined) => {
      const r = round.current;
      if (r?.turns && r.turn) return s.balls.find((b) => b.id === r.turn) ?? mine ?? s.balls[0];
      return mine ?? s.balls.find((b) => b.mode === "roll") ?? s.balls[0];
    };
    // Something to draw the shared things from (boxes, bumpers, mines) once my ball's off the hole.
    let placeholder: Ball | null = null;
    const watching = (s: WorldState): Ball => {
      if (!placeholder) placeholder = Object.assign(newSim(COURSE), { id: "", holes: 0, color: 0, startBag: [], carry: null, mode: "sunk" as const, modeT: 99 }) as Ball;
      Object.assign(placeholder, { boxes: s.boxes, gone: s.gone, mines: s.mines, strikes: s.strikes, patches: s.patches, t: s.tick / TPS, x: COURSE.cup.x, y: COURSE.cup.y, modeT: 99 });
      return placeholder;
    };

    // "fresh": just happened, play it. "rebuilt": history replayed after a late command; play only what's
    // recent and not heard yet. "arrived": the first build on opening; nothing plays.
    const play = (s: WorldState, how: "fresh" | "rebuilt" | "arrived") => {
      const fresh = how === "fresh";
      const mine = myBall(s);
      for (const { tick, id, ev, strokes } of s.events) {
        const key = `${tick}:${id}:${ev.type}:${Math.round(ev.x * 10)}:${Math.round(ev.y * 10)}`;
        if (n.seen.has(key)) continue;
        n.seen.set(key, tick);
        // Rebuilt history only plays what's recent: a late command's first moments, not old news.
        const isMe = id === meRef.current;
        // (Except my own sink, however late the news: that's the whole point of the hole.)
        if (how === "arrived" || (!fresh && tick < s.tick - TPS / 2 && !(isMe && ev.type === "sink"))) continue;
        const near = Math.hypot(ev.x - cam.current.x, ev.y - cam.current.y) < 30;
        const seed = (tick * 31 + ev.x * 7) | 0;
        const now = performance.now();
        switch (ev.type) {
          case "hit": {
            if (isMe) trail.current = [];
            // A Rocket Driver goes off with a bang, not a tap.
            if (s.balls.find((b) => b.id === id)?.shot === "rocket") {
              if (near) sound.rocket();
              fx.current.push({ kind: "boom", x: ev.x, y: ev.y, t, seed }, { kind: "ring", x: ev.x, y: ev.y, t, seed, big: 1.4, color: "#f19a35" }, { kind: "spark", x: ev.x, y: ev.y, t, seed, color: "#f19a35" });
              if (isMe) shake.current = { t, power: 0.22, a: seed };
            } else if (near) sound.putt(ev.power);
            fx.current.push({ kind: "puff", x: ev.x, y: ev.y, t, seed });
            break;
          }
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
            if (!isMe) toast(`${namesRef.current.get(id) ?? "Someone"} sank one${strokes !== undefined && round.current ? `, ${strokes}` : ""}`);
            // Long enough to watch it drop.
            else if ((hole || round.current) && strokes !== undefined) setTimeout(() => setResult({ strokes }), 1100);
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
          case "missile":
            if (near) sound.whoosh();
            break;
          case "horn":
            if (near) sound.horn();
            fx.current.push({ kind: "horn", x: ev.x, y: ev.y, t, seed, big: 5 });
            break;
          case "flash":
            if (near) sound.camera();
            fx.current.push({ kind: "flash", x: ev.x, y: ev.y, t, seed, big: 9 });
            break;
          case "freeze":
            if (near) sound.freeze();
            fx.current.push({ kind: "frost", x: ev.x, y: ev.y, t, seed, big: 3.6 }, { kind: "spark", x: ev.x, y: ev.y, t, seed, color: "#dff1f7" });
            break;
          case "honey":
            if (near) sound.honey();
            fx.current.push({ kind: "puff", x: ev.x, y: ev.y, t, seed, color: "#d99a2b" });
            break;
          case "shield":
            if (near) sound.shieldUp();
            fx.current.push({ kind: "ring", x: ev.x, y: ev.y, t, seed, color: "#8cc4e3" });
            break;
          case "coffee":
            if (isMe) sound.coffee();
            break;
          case "bolt":
            if (near) {
              sound.thunder();
              shake.current = { t, power: 0.3, a: seed };
            }
            fx.current.push({ kind: "bolt", x: ev.x, y: ev.y, x2: ev.x + 0.6, y2: ev.y - 9, t, seed }, { kind: "ring", x: ev.x, y: ev.y, t, seed, big: 1.2 });
            break;
          case "tracer":
            if (near) sound.gun(ev.power > 0.7);
            fx.current.push({ kind: "tracer", x: ev.x, y: ev.y, x2: ev.x2, y2: ev.y2, t, seed, big: ev.power > 0.7 ? 1.6 : 1 });
            if (isMe && mine && ev.power > 0.7) shake.current = { t, power: 0.25, a: Math.atan2(ev.y - ev.y2, ev.x - ev.x2) };
            break;
          case "stun":
            fx.current.push({ kind: "spark", x: ev.x, y: ev.y, t, seed, color: "#f3d35b" });
            break;
          case "fizzle":
            if (near) sound.fizzle();
            fx.current.push({ kind: "puff", x: ev.x, y: ev.y, t, seed });
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
        const sunkBefore = new Map(n.state?.balls.map((b) => [b.id, b.holes]));
        const s = n.base ? unpack(n.base) : newWorld(COURSE, { collide: n.collide });
        const merged = withPending(n.server, n.pending, s.tick);
        n.pending = merged.pending;
        n.cmds = merged.cmds;
        advance(s, WORLD, Math.max(s.tick, target), n.cmds);
        if (before)
          for (const b of s.balls) {
            const was = before.get(b.id);
            if (!was) continue;
            const o = n.off.get(b.id) ?? { x: 0, y: 0, tau: EASE_S };
            const dx = was.x + o.x - b.x, dy = was.y + o.y - b.y;
            // Sunk and back on a tee in the meantime: that's a real jump. Anything else glides.
            if (sunkBefore.get(b.id) !== b.holes) n.off.delete(b.id);
            else n.off.set(b.id, { x: dx, y: dy, tau: Math.hypot(dx, dy) > FAR ? EASE_FAR_S : EASE_S });
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
      for (const [id, o] of n.off) {
        const k = 1 - Math.exp(-dt / o.tau);
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
      if (!mine && !round.current) {
        // Cleared off a hole while the phone was away: straight back on.
        if (worldIdRef.current && nowMs - lastJoin > 3000) {
          lastJoin = nowMs;
          joinRef.current();
        }
        return;
      }
      const focus = focusOf(s, mine);
      const me: Ball = mine ?? watching(s);
      const at = mine ? drawn(mine) : { x: me.x, y: me.y };
      const focusAt = focus ? drawn(focus) : at;
      if (mine) lastDrawn.current = at;
      if (me.mode === "roll") {
        wasRolling = true;
        const tr = trail.current;
        const lp = tr[tr.length - 1];
        if (!lp || Math.hypot(lp.x - at.x, lp.y - at.y) > 0.25) tr.push({ ...at });
        if (tr.length > 24) tr.shift();
      } else if (wasRolling) {
        wasRolling = false;
        stoppedAt = t;
      }
      sound.rolling(me.mode === "roll" && me.z <= 0 ? Math.hypot(me.vx, me.vy) : 0, me.mode === "roll" ? groundUnder(WORLD, me) : null);

      // The camera follows the ball that matters (mine, or whoever's shooting), leaning the way it's going
      // (or toward the nearest flag).
      const c = cam.current, bx = box.current;
      if (bx.big && !overviewRef.current && nowMs - bx.panned > 1500 && focus) {
        const cup = allCups(COURSE).reduce((a, q) => (Math.hypot(q.x - focusAt.x, q.y - focusAt.y) < Math.hypot(a.x - focusAt.x, a.y - focusAt.y) ? q : a));
        const dx = cup.x - focusAt.x, dy = cup.y - focusAt.y, d = Math.hypot(dx, dy) || 1;
        const lean = focus.mode === "roll" ? { x: focus.vx * 0.35, y: focus.vy * 0.35 } : { x: (dx / d) * Math.min(5, d * 0.3), y: (dy / d) * Math.min(5, d * 0.3) };
        const kc = 1 - Math.exp(-dt * 3);
        c.x += (focusAt.x + lean.x - c.x) * kc;
        c.y += (focusAt.y + lean.y - c.y) * kc;
      }
      const sa = t - shake.current.t;
      const sk = sa < 0.45 ? shake.current.power * Math.exp(-sa * 9) * Math.sin(sa * 52) : 0;
      const shook = sk !== 0 ? { ...c, x: c.x + Math.cos(shake.current.a) * sk, y: c.y + Math.sin(shake.current.a) * sk } : c;

      fx.current = fx.current.filter((f) => t - f.t < 2);
      // Rockets trail smoke.
      for (const b of s.balls)
        if (b.shot === "rocket" && b.mode === "roll" && Math.hypot(b.vx, b.vy) > 6 && t - (smoked.get(b.id) ?? -9) > 0.06) {
          smoked.set(b.id, t);
          fx.current.push({ kind: "puff", x: b.x, y: b.y - b.z * 0.5, t, seed: (t * 977) | 0, color: "#9c9a92" });
        }
      const others: Other[] = s.balls.filter((b) => b !== mine).map((b) => ({ sim: b, at: drawn(b), color: ballColor(b), name: namesRef.current.get(b.id) ?? "" }));
      const tg = targetRef.current;
      drawFrame(ctx, {
        c: COURSE,
        sim: me,
        cam: shook,
        juice: juice.current,
        dpr: cv.current!.width / Math.max(1, bx.w),
        t,
        trail: trail.current,
        ball: at,
        trailAlpha: me.mode === "roll" ? 1 : Math.max(0, 1 - (t - stoppedAt) / 0.4),
        fx: fx.current,
        hits: hits.current,
        // A Flash Camera took the aim line away.
        aim: aim.current && me.t < me.blindUntil ? { ...aim.current, line: [] } : aim.current,
        air: { missiles: s.missiles, storms: s.storms },
        target: tg && ITEMS[tg.kind].aim ? { ...ITEMS[tg.kind].aim!, at: targetAt.current } : null,
        inset: { top: bx.top, bottom: bx.bottom },
        others,
        myColor: mine ? ballColor(mine) : undefined,
        flagOut: flagOut.current,
      });

      // The flash fading off the screen. (In a turn-based game it lasts till your shot, so it fades to a
      // haze rather than going.)
      if (blind.current) blind.current.style.opacity = String(Math.max(0, Math.min(1, (me.blindUntil - me.t) / 1.2)) * (me.blindUntil > 1e8 ? 0.35 : 0.92));
      const r = round.current;
      const status = mine ? statusOf(mine) : null;
      const shootable = !!mine && canShoot(mine) && (!r?.turns || r.turn === mine.id);
      const slow = n.pending.some((p) => !p.acked && nowMs - (p.at ?? nowMs) > SLOW_MS);
      const mode = mine ? mine.mode : null;
      const h = `${mode}|${me.bag.join()}|${me.armed}|${me.shot}|${me.holes}|${me.strokes}|${status}|${shootable}|${slow}|${focus?.id}`;
      if (h !== lastHud) {
        lastHud = h;
        setHud({ ready: true, mode, bag: mine ? [...mine.bag] : [], armed: mine?.armed ?? null, shot: mine?.shot ?? null, holes: me.holes, strokes: mine?.strokes ?? 0, status, canShoot: shootable, slow });
      }
    };
    raf = requestAnimationFrame(frame);
    // For the e2e suite: every ball as this phone has it.
    (window as unknown as { __golf?: unknown }).__golf = {
      balls: () => n.state?.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, mode: b.mode, holes: b.holes, strokes: b.strokes, t: b.t })) ?? [],
      tick: () => n.state?.tick ?? -1,
      me: () => meRef.current,
      // Which snapshot the phone is subscribed from, and where my ball was last drawn.
      from: () => fromRef.current,
      drawn: () => lastDrawn.current,
      shoot: (angle: number, power: number) => sendRef.current("shot", { a: angle, p: power }),
    };
    return () => {
      cancelAnimationFrame(raf);
      sound.rolling(0, null);
    };
  }, [clock]);
}
