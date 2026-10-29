import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  ArrowCounterClockwiseIcon,
  ArrowFatLinesUpIcon,
  ArrowsOutIcon,
  BasketballIcon,
  BombIcon,
  CarProfileIcon,
  CloudIcon,
  CornersInIcon,
  CornersOutIcon,
  CrosshairIcon,
  HamburgerIcon,
  LightningIcon,
  SneakerMoveIcon,
  XIcon,
  CaretLeftIcon,
  ClockCounterClockwiseIcon,
  GhostIcon,
  HandPalmIcon,
  MagnetIcon,
  RocketLaunchIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  type Icon,
} from "@phosphor-icons/react";
import * as sound from "./audio";
import { BAG_SIZE, DT, INSTANT, MAX_STROKES, TARGETED, activate, brake, compile, groundAt, hop, newSim, preview, scoreName, shoot, step, fireTargeted, type Course, type Power, type Sim } from "./engine";
import { BATTLE_GROUNDS } from "./battle";
import { BUMPER_PLAINS } from "./plains";
import { drawFrame, refreshTheme, still, type Camera, type Fx, type Juice } from "./toy";
import { PALETTES } from "@/themes";

// Golf, made by hand: Bumper Plains (six short holes, bumpers everywhere) and Battle Grounds (three big
// holes after Super Battle Golf). Single player, no server.

const POWER_UI: Record<Power, { name: string; short: string; icon: Icon }> = {
  rocket: { name: "Rocket Driver", short: "Driver", icon: RocketLaunchIcon },
  ghost: { name: "Ghost", short: "Ghost", icon: GhostIcon },
  magnet: { name: "Magnet", short: "Magnet", icon: MagnetIcon },
  brake: { name: "Brake", short: "Brake", icon: HandPalmIcon },
  mulligan: { name: "Mulligan", short: "Mulligan", icon: ClockCounterClockwiseIcon },
  bigcup: { name: "Big cup", short: "Big cup", icon: ArrowsOutIcon },
  jump: { name: "Jump", short: "Jump", icon: ArrowFatLinesUpIcon },
  bouncy: { name: "Bouncy", short: "Bouncy", icon: BasketballIcon },
  spring: { name: "Spring Boots", short: "Spring", icon: SneakerMoveIcon },
  cart: { name: "Golf Cart", short: "Cart", icon: CarProfileIcon },
  jumbo: { name: "Jumbo Burger", short: "Jumbo", icon: HamburgerIcon },
  smoke: { name: "Smoke Bomb", short: "Smoke", icon: CloudIcon },
  laser: { name: "Orbital Laser", short: "Laser", icon: CrosshairIcon },
  mine: { name: "Landmine", short: "Mine", icon: BombIcon },
  railgun: { name: "Rail Gun", short: "Rail Gun", icon: LightningIcon },
};
// What to do with a targeted item, said on the chip while you pick.
const TARGET_HINT: Partial<Record<Power, string>> = { laser: "Tap where to strike", mine: "Tap where to drop it", railgun: "Tap which way to fire" };

const COURSES = [
  { name: "Bumper Plains", holes: BUMPER_PLAINS },
  { name: "Battle Grounds", holes: BATTLE_GROUNDS },
];

type Round = { course: number; start: number; index: number; scores: number[]; attempt: number };

export function GolfExplorer() {
  const [round, setRound] = useState<Round | null>(null);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    sound.listen();
    return () => sound.stop();
  }, []);
  const toggleMute = () => {
    sound.setMuted(!muted);
    setMuted(!muted);
  };
  const play = (course: number, index = 0) => setRound({ course, start: index, index, scores: [], attempt: 0 });
  // The app's theme, which the void behind the course follows. In the app it's picked on the You tab.
  const [palette, setPalette] = useState(() => document.documentElement.dataset.palette ?? "felt");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const pickTheme = (p: string, d: boolean) => {
    document.documentElement.dataset.palette = p;
    document.documentElement.classList.toggle("dark", d);
    setPalette(p);
    setDark(d);
    refreshTheme();
    try {
      localStorage.setItem("golf:theme", JSON.stringify({ palette: p, dark: d }));
    } catch {
      // No storage in a sandboxed frame.
    }
  };

  if (round) {
    const { name, holes } = COURSES[round.course];
    if (round.scores.length === holes.length - round.start) return <Scorecard name={name} holes={holes} round={round} onHome={() => setRound(null)} />;
    return (
      <Play
        key={`${round.course}-${round.index}-${round.attempt}`}
        holes={holes}
        course={holes[round.index]}
        number={round.index + 1}
        round={round}
        onBack={() => setRound(null)}
        onDone={(strokes) => setRound({ ...round, scores: [...round.scores, strokes], index: Math.min(round.index + 1, holes.length - 1), attempt: 0 })}
        onAgain={() => setRound({ ...round, attempt: round.attempt + 1 })}
      />
    );
  }
  return (
    <div className="g-menu">
      <header className="g-menu-head">
        <h1 className="g-display g-title-lg">Golf</h1>
        <button type="button" className="g-icon-btn" onClick={toggleMute} aria-label={muted ? "Sound on" : "Sound off"}>
          {muted ? <SpeakerSlashIcon size={22} weight="fill" /> : <SpeakerHighIcon size={22} weight="fill" />}
        </button>
      </header>
      {COURSES.map((co, ci) => (
        <section key={co.name} className="g-section">
          <div className="g-section-head">
            <h2 className="g-display g-heading">{co.name}</h2>
            <span className="g-footnote">Par {co.holes.reduce((a, c) => a + c.par, 0)}</span>
          </div>
          <ol className="g-holes">
            {co.holes.map((c, i) => (
              <li key={c.id}>
                <button type="button" className="g-hole-row" onClick={() => play(ci, i)}>
                  <Thumb c={c} theme={`${palette}-${dark}`} />
                  <span className="g-hole-text">
                    <span className="g-card-name">{c.name}</span>
                    <span className="g-footnote">
                      Hole {i + 1}, par {c.par}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="g-btn g-btn-big g-btn-primary g-play-all" onClick={() => play(ci)}>
            Play {co.holes.length} holes
          </button>
        </section>
      ))}
      <section className="g-section">
        <h2 className="g-display g-heading">Theme</h2>
        <div className="g-themes" role="radiogroup" aria-label="Theme">
          {PALETTES.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={palette === p.id} className={`g-chip-btn ${palette === p.id ? "g-chip-on" : ""}`} onClick={() => pickTheme(p.id, dark)}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="g-seg" role="radiogroup" aria-label="Light or dark">
          {[false, true].map((d) => (
            <button key={String(d)} type="button" role="radio" aria-checked={dark === d} className={`g-seg-item ${dark === d ? "g-seg-on" : ""}`} onClick={() => pickTheme(palette, d)}>
              {d ? "Dark" : "Light"}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Thumb({ c, theme }: { c: Course; theme: string }) {
  const src = useMemo(() => still(c, 120).toDataURL("image/png"), [c, theme]);
  return (
    <div className="g-thumb">
      <img src={src} alt="" draggable={false} />
    </div>
  );
}

// --- Playing a hole ---

type Hud = { strokes: number; mode: Sim["mode"]; bag: Power[]; armed: Power | null; shot: Power | null };

function Play({ holes, course, number, round, onBack, onDone, onAgain }: { holes: Course[]; course: Course; number: number; round: Round; onBack: () => void; onDone: (strokes: number) => void; onAgain: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const world = useMemo(() => compile(course), [course]);
  const sim = useRef<Sim>(newSim(course, number));
  const cam = useRef<Camera>({ x: course.w / 2, y: course.h / 2, s: 10, ox: 0, oy: 0 });
  const view = useRef({ w: 0, h: 0, fit: 10, play: 16, big: false, started: false, panned: 0, zoomed: false, top: 84 });
  const aim = useRef<{ angle: number; power: number; line: { x: number; y: number }[]; from?: { x: number; y: number }; to?: { x: number; y: number } } | null>(null);
  const fx = useRef<Fx[]>([]);
  const hits = useRef(new Map<number, number>());
  const juice = useRef<Juice>({ start: 0, spawn: 0.25, impact: null });
  const shake = useRef({ t: -9, power: 0, a: 0 });
  // A targeted item waiting for its spot: which slot, and where the finger is.
  const [target, setTarget] = useState<{ i: number; kind: Power } | null>(null);
  const targetRef = useRef<{ i: number; kind: Power } | null>(null);
  targetRef.current = target;
  const targetAt = useRef<{ x: number; y: number } | null>(null);
  const [overview, setOverview] = useState(false);
  const trail = useRef<{ x: number; y: number }[]>([]);
  const [hud, setHud] = useState<Hud>({ strokes: 0, mode: "aim", bag: [], armed: null, shot: null });
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [done, setDone] = useState(false);
  const say = (text: string) => setToast({ text, key: Date.now() });

  // The board's bounds, so the whole hole fits on screen.
  const bounds = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const g of course.greens)
      for (const p of g.poly) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
    return { x0, y0, x1, y1: y1 + 1 };
  }, [course]);

  const PAD_TOP = 84, PAD_BOTTOM = 104;
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.current!.width = Math.round(r.width * dpr);
      cv.current!.height = Math.round(r.height * dpr);
      const bar = el.querySelector(".g-top")?.getBoundingClientRect();
      const top = bar ? bar.bottom - r.top + 8 : PAD_TOP;
      const v = view.current;
      v.w = r.width;
      v.h = r.height;
      v.top = top;
      v.fit = Math.min((r.width - 24) / (bounds.x1 - bounds.x0), (r.height - top - PAD_BOTTOM) / (bounds.y1 - bounds.y0));
      cam.current.ox = r.width / 2;
      cam.current.oy = top + (r.height - top - PAD_BOTTOM) / 2;
      // Big holes start close on the ball and follow it; small ones show the whole board.
      v.play = Math.max(v.fit, r.width / 24);
      v.big = v.fit < v.play * 0.8;
      if (!v.started) {
        v.started = true;
        if (v.big) {
          v.zoomed = true;
          cam.current.s = v.play;
          cam.current.x = sim.current.x;
          cam.current.y = sim.current.y - 4;
          setOverview(false);
        }
      }
      if (!v.zoomed) {
        cam.current.s = v.fit;
        cam.current.x = (bounds.x0 + bounds.x1) / 2;
        cam.current.y = (bounds.y0 + bounds.y1) / 2;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [bounds]);

  useEffect(() => {
    const ctx = cv.current!.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let t = 0;
    let lastHud = "";
    let lastKnock = 0;
    let lastMode = sim.current.mode;
    let px = sim.current.x, py = sim.current.y;
    let stoppedAt = -9;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;
      const s = sim.current;
      acc += dt;
      const vx0 = s.vx, vy0 = s.vy;
      while (acc >= DT) {
        px = s.x;
        py = s.y;
        step(s, world, DT);
        acc -= DT;
      }
      // Drawn between the last two steps, so the ball glides instead of stepping on uneven frames.
      // A jump (back to the tee, a mulligan, a rail gun) snaps.
      const lerp = acc / DT;
      const jumped = Math.hypot(s.x - px, s.y - py) > 1.5;
      const ball = jumped ? { x: s.x, y: s.y } : { x: px + (s.x - px) * lerp, y: py + (s.y - py) * lerp };
      for (const e of s.events) {
        const seed = Math.floor(Math.random() * 1e6);
        switch (e.type) {
          case "hit":
            sound.putt(e.power);
            trail.current = [];
            fx.current.push({ kind: "puff", x: e.x, y: e.y, t, seed });
            break;
          case "bounce":
            if (now - lastKnock > 60) sound.knock(e.power);
            lastKnock = now;
            // Squash against the wall, along the way it's been sent.
            juice.current.impact = { t, n: Math.atan2(s.vy, s.vx), power: e.power };
            if (e.power > 0.15) fx.current.push({ kind: "ring", x: e.x, y: e.y, t, seed });
            break;
          case "bump": {
            if (now - lastKnock > 50) sound.bump();
            lastKnock = now;
            const i = course.bumpers.findIndex((b) => Math.hypot(b.at.x - e.x, b.at.y - e.y) < 0.01);
            if (i >= 0) hits.current.set(i, t);
            juice.current.impact = { t, n: Math.atan2(s.vy, s.vx), power: 0.5 };
            shake.current = { t, power: 0.12, a: Math.atan2(s.vy, s.vx) };
            break;
          }
          case "splash":
            sound.drop();
            juice.current.outV = { x: vx0, y: vy0 };
            say("Off the edge. +1");
            break;
          case "sink":
            sound.plunk();
            fx.current.push({ kind: "ring", x: e.x, y: e.y, t, seed });
            fx.current.push({ kind: "ring", x: e.x, y: e.y, t: t + 0.12, seed });
            if (s.strokes <= course.par) fx.current.push({ kind: "confetti", x: e.x, y: e.y - 1, t: t + 0.15, seed });
            setTimeout(() => setDone(true), 1100);
            break;
          case "box":
            sound.pickup();
            fx.current.push({ kind: "boxpop", x: e.x, y: e.y, t, seed });
            fx.current.push({ kind: "spark", x: e.x, y: e.y, t, seed });
            fx.current.push({ kind: "label", x: e.x, y: e.y, t, seed, text: POWER_UI[e.item].name });
            break;
          case "launch":
            sound.whoosh();
            break;
          case "land":
            sound.land(e.power);
            break;
          case "lip":
            sound.lip();
            say("Lipped out");
            break;
          case "boom":
            sound.blast(1);
            fx.current.push({ kind: "boom", x: e.x, y: e.y, t, seed, color: "big" });
            fx.current.push({ kind: "ring", x: e.x, y: e.y, t, seed, big: 2.2 });
            fx.current.push({ kind: "spark", x: e.x, y: e.y, t, seed });
            shake.current = { t, power: 0.55, a: seed };
            break;
          case "mine":
          case "smash":
            sound.blast(e.type === "mine" ? 0.8 : 0.5);
            fx.current.push({ kind: "boom", x: e.x, y: e.y, t, seed });
            fx.current.push({ kind: "ring", x: e.x, y: e.y, t, seed, big: 1.3 });
            fx.current.push({ kind: "spark", x: e.x, y: e.y, t: t + 0.02, seed });
            shake.current = { t, power: e.type === "mine" ? 0.4 : 0.2, a: seed };
            if (e.type === "mine") say("Boom");
            break;
          case "rail":
            sound.whoosh();
            fx.current.push({ kind: "rail", x: e.x, y: e.y, x2: e.x2, y2: e.y2, t, seed });
            break;
          case "stop":
            sound.brake();
            break;
        }
      }
      s.events.length = 0;
      // Back from off the edge: the ball pops in again.
      if (lastMode === "out" && s.mode === "aim") juice.current.spawn = t;
      if (lastMode === "roll" && s.mode !== "roll") stoppedAt = t;
      lastMode = s.mode;
      fx.current = fx.current.filter((f) => t - f.t < 2);
      const speed = Math.hypot(s.vx, s.vy);
      if (s.mode === "roll") {
        const tr = trail.current;
        const lp = tr[tr.length - 1];
        if (!lp || Math.hypot(lp.x - ball.x, lp.y - ball.y) > 0.25) tr.push({ x: ball.x, y: ball.y });
        if (tr.length > 24) tr.shift();
      }
      sound.rolling(s.mode === "roll" && s.z <= 0 ? speed : 0, s.mode === "roll" ? groundAt(world, s) : null);

      // The whole hole stays on screen; zoomed in, the camera follows the ball.
      const c = cam.current, v = view.current;
      if (v.zoomed && now - v.panned > 1500) {
        // Ahead of the ball: toward the cup while aiming, the way it's going while it rolls.
        const dx = course.cup.x - ball.x, dy = course.cup.y - ball.y, d = Math.hypot(dx, dy) || 1;
        const lean = s.mode === "roll" ? { x: s.vx * 0.35, y: s.vy * 0.35 } : { x: (dx / d) * Math.min(7, d * 0.3), y: (dy / d) * Math.min(7, d * 0.3) };
        const k = 1 - Math.exp(-dt * 3);
        c.x += (ball.x + lean.x - c.x) * k;
        c.y += (ball.y + lean.y - c.y) * k;
      }
      // A short shake for anything that goes bang.
      // A damped wobble in world units, mostly along the hit, so it reads as a knock and not noise.
      const sa = t - shake.current.t;
      const sk = sa < 0.45 ? shake.current.power * Math.exp(-sa * 9) * Math.sin(sa * 52) : 0;
      const sa2 = shake.current.a;
      const shook = sk !== 0 ? { ...c, x: c.x + Math.cos(sa2) * sk, y: c.y + Math.sin(sa2) * sk + Math.sin(sa * 37) * sk * 0.3 } : c;
      drawFrame(ctx, {
        c: course,
        sim: s,
        cam: shook,
        juice: juice.current,
        dpr: cv.current!.width / Math.max(1, v.w),
        t,
        trail: trail.current,
        ball,
        trailAlpha: s.mode === "roll" ? 1 : Math.max(0, 1 - (t - stoppedAt) / 0.4),
        fx: fx.current,
        hits: hits.current,
        aim: aim.current,
        target: targetRef.current && (targetRef.current.kind === "laser" || targetRef.current.kind === "mine" || targetRef.current.kind === "railgun") ? { kind: targetRef.current.kind, at: targetAt.current } : null,
        inset: v.zoomed ? { top: v.top, bottom: PAD_BOTTOM } : undefined,
      });

      const h = `${s.strokes}|${s.mode}|${s.bag.join()}|${s.armed}|${s.shot}`;
      if (h !== lastHud) {
        lastHud = h;
        setHud({ strokes: s.strokes, mode: s.mode, bag: [...s.bag], armed: s.armed, shot: s.shot });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      sound.rolling(0, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  // --- Touch: pull back anywhere to aim; two fingers to zoom in and look around ---
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "aim" | "pan" | "pinch" | "target"; start?: { x: number; y: number }; d0?: number; s0?: number; mid?: { x: number; y: number } } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (x: number, y: number) => ({ x: (x - cam.current.ox) / cam.current.s + cam.current.x, y: (y - cam.current.oy) / cam.current.s + cam.current.y });
  const maxPull = () => Math.min(190, view.current.w * 0.46);
  const setZoom = (s: number) => {
    const v = view.current;
    cam.current.s = Math.max(v.fit, Math.min(Math.max(v.fit * 3, v.play * 1.5), s));
    v.zoomed = cam.current.s > v.fit * 1.02;
    if (!v.zoomed) {
      cam.current.x = (bounds.x0 + bounds.x1) / 2;
      cam.current.y = (bounds.y0 + bounds.y1) / 2;
    }
  };

  const down = (e: RPointerEvent) => {
    sound.unlock();
    cv.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const s = sim.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      aim.current = null;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), s0: cam.current.s, mid: toWorld(mid.x, mid.y) };
      return;
    }
    if (s.mode === "roll" && s.shot === "brake") return brake(s);
    if (s.mode === "roll" && s.shot === "jump") return hop(s);
    if (targetRef.current && s.mode === "aim") {
      gesture.current = { kind: "target" };
      targetAt.current = toWorld(p.x, p.y);
      return;
    }
    if (e.button === 2 || e.shiftKey || s.mode !== "aim") gesture.current = { kind: "pan" };
    else gesture.current = { kind: "aim", start: p };
  };
  const move = (e: RPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    const s = sim.current;
    if (g.kind === "target") {
      targetAt.current = toWorld(p.x, p.y);
      return;
    }
    if (g.kind === "aim" && g.start) {
      const dx = g.start.x - p.x, dy = g.start.y - p.y;
      const pull = Math.hypot(dx, dy);
      if (pull < 10) {
        aim.current = null;
        return;
      }
      const power = Math.min(1, pull / maxPull()) ** 1.35;
      const angle = Math.atan2(dy, dx);
      aim.current = { angle, power, line: preview(world, s, angle, power, s.armed === "ghost"), from: g.start, to: p };
    } else if (g.kind === "pan" && view.current.zoomed) {
      cam.current.x -= (p.x - prev.x) / cam.current.s;
      cam.current.y -= (p.y - prev.y) / cam.current.s;
      view.current.panned = performance.now();
    } else if (g.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      setZoom(g.s0! * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0!));
      if (view.current.zoomed) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        cam.current.x = g.mid!.x - (mid.x - cam.current.ox) / cam.current.s;
        cam.current.y = g.mid!.y - (mid.y - cam.current.oy) / cam.current.s;
        view.current.panned = performance.now();
      }
    }
  };
  const up = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "aim" && aim.current && aim.current.power > 0.01) {
      shoot(sim.current, aim.current.angle, aim.current.power);
      view.current.panned = 0;
    }
    if (g?.kind === "aim") aim.current = null;
    if (g?.kind === "target" && targetRef.current && targetAt.current) {
      fireTargeted(sim.current, course, targetRef.current.i, targetAt.current);
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
      setZoom(cam.current.s * Math.exp(-e.deltaY * 0.0015));
    };
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", menu);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", menu);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tapPower = (i: number) => {
    const s = sim.current;
    const p = s.bag[i];
    activate(s, i);
    if (p && TARGETED.includes(p)) {
      setTarget(target?.i === i ? null : { i, kind: p });
      return;
    }
    if (p && INSTANT.includes(p)) sound.pickup();
  };
  const totalPar = holes.slice(round.start, round.index).reduce((a, c) => a + c.par, 0);
  const vsPar = round.scores.reduce((a, b) => a + b, 0) - totalPar;
  const last = number === holes.length;

  return (
    <div ref={wrap} className="g-play" data-mode={hud.mode}>
      <canvas ref={cv} className="g-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label={`${course.name}, par ${course.par}`} />

      <div className="g-top">
        <button type="button" className="g-icon-btn" onClick={onBack} aria-label="Back">
          <CaretLeftIcon size={22} weight="bold" />
        </button>
        <div className="g-pill g-hole-pill">
          <span className="g-hole-title">
            <span className="g-hole-name">{course.name}</span>
            <span className="g-hole-sub">
              Hole {number}, par {course.par}
              {round.scores.length > 0 && <>, {vsPar === 0 ? "even" : vsPar > 0 ? `${vsPar} over` : `${-vsPar} under`}</>}
            </span>
          </span>
          <span className="g-strokes" aria-label={`${hud.strokes} strokes`}>
            <span className="g-display">{hud.strokes}</span>
          </span>
        </div>
      </div>

      <div className="g-intro" key="intro">
        <span className="g-display g-intro-no">Hole {number}</span>
        <span className="g-display g-intro-name">{course.name}</span>
        <span className="g-intro-par">Par {course.par}</span>
      </div>

      {toast && (
        <div key={toast.key} className="g-toast" onAnimationEnd={() => setToast(null)}>
          {toast.text}
        </div>
      )}

      <div className="g-dock">
        <div className="g-bag">
          {hud.bag.slice(0, BAG_SIZE).map((p, i) => {
            const IconC = POWER_UI[p].icon;
            return (
              <button key={`${i}-${p}`} type="button" className={`g-slot ${target?.i === i ? "g-slot-on" : ""}`} disabled={hud.mode !== "aim"} onClick={() => tapPower(i)} aria-label={`Use ${POWER_UI[p].name}`}>
                <IconC size={22} weight="fill" />
                <span>{POWER_UI[p].short}</span>
              </button>
            );
          })}
          {target && (
            <div className="g-armed g-targeting">
              {(() => {
                const A = POWER_UI[target.kind].icon;
                return <A size={18} weight="fill" />;
              })()}
              {TARGET_HINT[target.kind]}
              <button type="button" className="g-chip-x" onClick={() => setTarget(null)} aria-label="Cancel">
                <XIcon size={14} weight="bold" />
              </button>
            </div>
          )}
          {!target && hud.armed && (
            <div className="g-armed">
              {(() => {
                const A = POWER_UI[hud.armed].icon;
                return <A size={18} weight="fill" />;
              })()}
              {POWER_UI[hud.armed].name} next shot
            </div>
          )}
          {hud.mode === "roll" && (hud.shot === "brake" || hud.shot === "jump") && (
            <button type="button" className="g-btn g-btn-on g-brake" onClick={() => (hud.shot === "jump" ? hop(sim.current) : brake(sim.current))}>
              {hud.shot === "jump" ? <ArrowFatLinesUpIcon size={22} weight="fill" /> : <HandPalmIcon size={22} weight="fill" />}
              {hud.shot === "jump" ? "Jump" : "Brake"}
            </button>
          )}
        </div>
        <div className="g-dock-right">
          {view.current.big && (
            <button
              type="button"
              className="g-icon-btn"
              onClick={() => {
                const v = view.current;
                if (overview) {
                  setOverview(false);
                  v.zoomed = true;
                  cam.current.s = v.play;
                  v.panned = 0;
                } else {
                  setOverview(true);
                  setZoom(v.fit);
                }
              }}
              aria-label={overview ? "Follow the ball" : "See the whole hole"}
            >
              {overview ? <CornersInIcon size={22} weight="bold" /> : <CornersOutIcon size={22} weight="bold" />}
            </button>
          )}
          <button type="button" className="g-icon-btn" onClick={onAgain} aria-label="Start the hole again">
            <ArrowCounterClockwiseIcon size={22} weight="bold" />
          </button>
        </div>
      </div>

      {hud.mode === "aim" && hud.strokes >= MAX_STROKES && !done && (
        <Result title="Picked up" sub={`${MAX_STROKES} strokes is the most a hole takes`} tone="over" primary={last ? "Scorecard" : "Next hole"} onPrimary={() => onDone(MAX_STROKES)} onSecondary={onAgain} />
      )}
      {done && (
        <Result
          title={scoreName(hud.strokes, course.par)}
          sub={`${hud.strokes} ${hud.strokes === 1 ? "stroke" : "strokes"} on a par ${course.par}`}
          tone={hud.strokes < course.par ? "under" : hud.strokes === course.par ? "par" : "over"}
          primary={last ? "Scorecard" : "Next hole"}
          onPrimary={() => onDone(hud.strokes)}
          onSecondary={onAgain}
        />
      )}
    </div>
  );
}

// The hole's result: a sheet from the bottom with the score's name, big.
function Result({ title, sub, tone, primary, onPrimary, onSecondary }: { title: string; sub: string; tone: "under" | "par" | "over"; primary: string; onPrimary: () => void; onSecondary: () => void }) {
  return (
    <div className="g-result">
      <div className="g-result-card">
        <h2 className={`g-display g-result-title g-result-${tone}`}>{title}</h2>
        <p className="g-result-sub">{sub}</p>
        <div className="g-result-actions">
          <button type="button" className="g-btn g-btn-big" onClick={onSecondary}>
            Again
          </button>
          <button type="button" className="g-btn g-btn-big g-btn-primary" onClick={onPrimary}>
            {primary}
          </button>
        </div>
      </div>
    </div>
  );
}

function Scorecard({ name, holes: all, round, onHome }: { name: string; holes: Course[]; round: Round; onHome: () => void }) {
  const holes = all.slice(round.start);
  const total = round.scores.reduce((a, b) => a + b, 0);
  const par = holes.reduce((a, c) => a + c.par, 0);
  const diff = total - par;
  return (
    <div className="g-menu g-scorecard">
      <div>
        <h1 className="g-display g-title-lg">{name}</h1>
        <div className="g-total">
          <span className={`g-display g-total-num g-result-${diff < 0 ? "under" : diff === 0 ? "par" : "over"}`}>{total}</span>
          <span className="g-total-sub">{diff === 0 ? "Even par" : diff > 0 ? `${diff} over par` : `${-diff} under par`}</span>
        </div>
        <table className="g-card-table">
          <thead>
            <tr>
              <th>Hole</th>
              {holes.map((_, i) => (
                <th key={i}>{round.start + i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Par</th>
              {holes.map((c) => (
                <td key={c.id}>{c.par}</td>
              ))}
            </tr>
            <tr>
              <th>You</th>
              {round.scores.map((s, i) => (
                <td key={i} className={s < holes[i].par ? "g-under" : s > holes[i].par ? "g-over" : ""}>
                  {s}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <div className="g-result-actions">
          <button type="button" className="g-btn g-btn-big g-btn-primary" onClick={onHome}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
