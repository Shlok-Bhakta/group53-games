import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  ArrowCounterClockwiseIcon,
  ArrowsOutIcon,
  CaretLeftIcon,
  ClockCounterClockwiseIcon,
  CornersInIcon,
  CornersOutIcon,
  GhostIcon,
  HandPalmIcon,
  MagnetIcon,
  MoonIcon,
  RocketLaunchIcon,
  SunIcon,
  type Icon,
} from "@phosphor-icons/react";
import { sfx } from "@/sound";
import { COURSES, THEMES, courseById } from "./courses";
import { BALL_R, DT, INSTANT, MAX_STROKES, brake, compile, newSim, preview, scoreName, shoot, step, activate, type Course, type Power, type Sim } from "./engine";
import { clockLabel, lightFor, lightKey, sunAt, type Light } from "./light";
import { buildGlow, buildLayers, buildLight, drawFrame, paletteOf, still, type Camera, type Fx, type Layers } from "./render";

// Single-player golf, for exploring the maps: pick a hole and play it. No server, no other players.

const POWER_UI: Record<Power, { name: string; icon: Icon }> = {
  rocket: { name: "Rocket", icon: RocketLaunchIcon },
  ghost: { name: "Ghost", icon: GhostIcon },
  magnet: { name: "Magnet", icon: MagnetIcon },
  brake: { name: "Brake", icon: HandPalmIcon },
  mulligan: { name: "Mulligan", icon: ClockCounterClockwiseIcon },
  bigcup: { name: "Big cup", icon: ArrowsOutIcon },
};

function useLight(hour: number | null): Light {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (hour !== null) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [hour]);
  return useMemo(() => sunAt(now, hour), [now, hour]);
}

export function GolfExplorer() {
  const [hole, setHole] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const light = useLight(hour);
  if (hole) {
    const i = COURSES.findIndex((c) => c.id === hole);
    return (
      <Play
        key={hole}
        course={courseById(hole)}
        light={light}
        hour={hour}
        setHour={setHour}
        onBack={() => setHole(null)}
        onNext={() => setHole(COURSES[(i + 1) % COURSES.length].id)}
      />
    );
  }
  return <Menu light={light} hour={hour} setHour={setHour} onPick={setHole} />;
}

// --- The course list ---

function Menu({ light, hour, setHour, onPick }: { light: Light; hour: number | null; setHour: (h: number | null) => void; onPick: (id: string) => void }) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const key = lightKey(light);
  useEffect(() => {
    // One at a time, so the list shows up straight away and fills in.
    let cancelled = false;
    let i = 0;
    const next = () => {
      if (cancelled || i >= COURSES.length) return;
      const c = COURSES[i++];
      const url = still(c, c.open ? 150 : 220, lightFor(c.theme, light)).toDataURL("image/png");
      setThumbs((t) => ({ ...t, [c.id]: url }));
      setTimeout(next, 0);
    };
    const id = setTimeout(next, 30);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // Redraw only when the light really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="g-menu">
      <header className="g-menu-head">
        <h1 className="g-display g-title-lg">Golf</h1>
        <TimeChip light={light} hour={hour} setHour={setHour} />
      </header>
      {THEMES.slice(0, 4).map((t) => (
        <section key={t.id} className="g-section">
          <h2 className="g-display g-heading">{t.name}</h2>
          <div className="g-grid">
            {COURSES.filter((c) => c.theme === t.id).map((c) => (
              <HoleCard key={c.id} c={c} src={thumbs[c.id]} onPick={onPick} />
            ))}
          </div>
        </section>
      ))}
      <section className="g-section">
        <h2 className="g-display g-heading">Wild cards</h2>
        <div className="g-grid">
          {COURSES.filter((c) => !THEMES.slice(0, 4).some((t) => t.id === c.theme)).map((c) => (
            <HoleCard key={c.id} c={c} src={thumbs[c.id]} onPick={onPick} />
          ))}
        </div>
      </section>
    </div>
  );
}

function HoleCard({ c, src, onPick }: { c: Course; src?: string; onPick: (id: string) => void }) {
  return (
    <button type="button" className="g-card" onClick={() => onPick(c.id)}>
      <div className="g-thumb" style={{ background: paletteOf(c.theme).beyond }}>
        {src && <img src={src} alt="" draggable={false} className={c.open ? "g-thumb-open" : ""} />}
      </div>
      <div className="g-card-text">
        <span className="g-display g-card-name">{c.name}</span>
        <span className="g-footnote">
          {c.course === c.name ? THEMES.find((t) => t.id === c.theme)!.name : c.course} · Par {c.par}
        </span>
        {c.open && <span className="g-chip">Open world</span>}
      </div>
    </button>
  );
}

function TimeChip({ light, hour, setHour, compact }: { light: Light; hour: number | null; setHour: (h: number | null) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = light.night > 0.5 ? MoonIcon : SunIcon;
  return (
    <div className="g-time">
      <button type="button" className={compact ? "g-icon-btn" : "g-pill g-time-chip"} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Time of day: ${clockLabel(light.hour)}`}>
        <Icon size={compact ? 22 : 18} weight="fill" />
        {!compact && <span className="g-display">{clockLabel(light.hour)}</span>}
        {!compact && <span className="g-muted">{light.phase}</span>}
      </button>
      {open && (
        <div className="g-time-panel">
          <span className="g-display g-time-label">{clockLabel(light.hour)}</span>
          <input
            type="range"
            min={0}
            max={24}
            step={0.05}
            value={light.hour}
            aria-label="Time of day"
            onChange={(e) => setHour(Number(e.target.value))}
            className="g-range"
          />
          <button type="button" className={`g-btn ${hour === null ? "g-btn-on" : ""}`} onClick={() => setHour(null)}>
            Live
          </button>
        </div>
      )}
    </div>
  );
}

// --- Playing a hole ---

type Hud = { strokes: number; mode: Sim["mode"]; bag: Power[]; armed: Power | null; shot: Power | null };

function Play({ course, light, hour, setHour, onBack, onNext }: { course: Course; light: Light; hour: number | null; setHour: (h: number | null) => void; onBack: () => void; onNext: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const world = useMemo(() => compile(course), [course]);
  const sim = useRef<Sim>(newSim(course));
  const layers = useRef<Layers | null>(null);
  const lightRef = useRef(light);
  lightRef.current = light;
  const cam = useRef<Camera>({ x: course.w / 2, y: course.h / 2, s: 10, ox: 0, oy: 0 });
  const view = useRef({ w: 0, h: 0, fit: 10, follow: true, overview: false });
  const aim = useRef<{ angle: number; power: number; line: { x: number; y: number }[] } | null>(null);
  const fx = useRef<Fx[]>([]);
  const trail = useRef<{ x: number; y: number }[]>([]);
  const [hud, setHud] = useState<Hud>({ strokes: 0, mode: "aim", bag: [], armed: null, shot: null });
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [done, setDone] = useState(false);
  const [overview, setOverview] = useState(false);
  const [shotOnce, setShotOnce] = useState(false);

  const say = (text: string) => setToast({ text, key: Date.now() });

  // Layers: the ground once, the light whenever the sun has moved enough to notice.
  if (!layers.current) {
    const ppu = course.open ? 30 : Math.min(56, 2048 / Math.max(course.w, course.h));
    layers.current = { ...buildLayers(course, ppu) };
    Object.assign(layers.current, buildGlow(course, layers.current));
  }

  const PAD_TOP = 84, PAD_BOTTOM = 112;
  const fitScale = (w: number, h: number) => Math.min((w - 12) / course.w, (h - PAD_TOP - PAD_BOTTOM) / course.h);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      cv.current!.width = Math.round(r.width * dpr);
      cv.current!.height = Math.round(r.height * dpr);
      const first = view.current.w === 0;
      view.current.w = r.width;
      view.current.h = r.height;
      view.current.fit = fitScale(r.width, r.height);
      cam.current.ox = r.width / 2;
      cam.current.oy = PAD_TOP + (r.height - PAD_TOP - PAD_BOTTOM) / 2;
      if (first) {
        if (course.open) {
          cam.current.s = Math.max(view.current.fit, r.width / 20);
          cam.current.x = sim.current.x;
          cam.current.y = sim.current.y - 4;
        } else cam.current.s = view.current.fit;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course]);

  // The loop: fixed physics steps, then one frame.
  useEffect(() => {
    const ctx = cv.current!.getContext("2d")!;
    const lightCanvas = document.createElement("canvas");
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let t = 0;
    let lastHud = "";
    let lastBounce = 0;
    let lk = "";
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;
      const s = sim.current;
      acc += dt;
      while (acc >= DT) {
        step(s, world, DT);
        acc -= DT;
      }
      // What happened, as sound and little effects.
      for (const e of s.events) {
        const seed = Math.floor(Math.random() * 1e6);
        switch (e.type) {
          case "hit":
            sfx("place");
            trail.current = [];
            break;
          case "bounce":
            if (e.power > 0.06 && now - lastBounce > 70) {
              sfx("pick");
              lastBounce = now;
            }
            break;
          case "bump":
            if (now - lastBounce > 70) sfx("tick");
            lastBounce = now;
            fx.current.push({ kind: "ring", x: e.x, y: e.y, t, seed, color: "rgba(120,240,255,1)" });
            break;
          case "splash": {
            const g = s.outGround;
            sfx("invalid");
            const lava = g === "lava" || (g === "water" && course.theme === "volcano");
            if (g !== "void") fx.current.push({ kind: "splash", x: e.x, y: e.y, t, seed, color: lava ? "#ffb02e" : g === "coolant" ? "#59f0ff" : undefined });
            say(g === "void" ? "Lost it. +1" : lava ? "Melted. +1" : "Splash! +1");
            break;
          }
          case "sink":
            sfx(s.strokes === 1 ? "bingo" : s.strokes <= course.par ? "win" : "play", { count: 3 });
            fx.current.push({ kind: "ring", x: e.x, y: e.y, t, seed });
            if (s.strokes <= course.par) fx.current.push({ kind: "confetti", x: e.x, y: e.y, t, seed });
            setTimeout(() => setDone(true), 700);
            break;
          case "box":
            sfx("turn");
            fx.current.push({ kind: "spark", x: e.x, y: e.y - 0.35, t, seed });
            say(`Got ${POWER_UI[e.item].name}`);
            break;
          case "launch":
            sfx("ghost");
            break;
          case "land": {
            if (e.power > 0.15) sfx("land");
            const g = world.course.zones.find((z) => (z.kind === "sand" || z.kind === "snow") && pointIn(e, z.poly));
            if (g) fx.current.push({ kind: "puff", x: e.x, y: e.y, t, seed, color: g.kind === "snow" ? "#ffffff" : undefined });
            break;
          }
          case "warp":
            sfx("ghost");
            fx.current.push({ kind: "spark", x: e.x, y: e.y, t, seed, color: "#b49aff" });
            break;
          case "lip":
            sfx("tick");
            say("Lipped out");
            break;
          case "stop":
            sfx("land");
            break;
        }
      }
      s.events.length = 0;
      fx.current = fx.current.filter((f) => t - f.t < 2);
      if (s.mode === "roll") {
        const tr = trail.current;
        const lp = tr[tr.length - 1];
        if (!lp || Math.hypot(lp.x - s.x, lp.y - s.y) > 0.15) tr.push({ x: s.x, y: s.y });
        if (tr.length > 22) tr.shift();
      }

      // The camera follows the ball whenever there's more course than screen.
      const c = cam.current, v = view.current;
      const zoomed = c.s > v.fit * 1.05;
      if (v.overview) {
        c.s += (v.fit - c.s) * (1 - Math.exp(-dt * 8));
        c.x += (course.w / 2 - c.x) * (1 - Math.exp(-dt * 8));
        c.y += (course.h / 2 - c.y) * (1 - Math.exp(-dt * 8));
      } else if (v.follow && (course.open || zoomed)) {
        const k = 1 - Math.exp(-dt * (s.mode === "roll" ? 3.5 : 2.5));
        c.x += (s.x - c.x) * k;
        c.y += (s.y - (s.mode === "aim" ? 3 : 0) - c.y) * k;
      } else if (!zoomed) {
        c.x += (course.w / 2 - c.x) * (1 - Math.exp(-dt * 8));
        c.y += (course.h / 2 - c.y) * (1 - Math.exp(-dt * 8));
      }
      // Keep the view on the course: past the edge only as far as the scenery goes.
      const halfW = v.w / 2 / c.s, halfH = (v.h - PAD_TOP - PAD_BOTTOM) / 2 / c.s;
      const keep = (at: number, half: number, size: number) => (size + 4 <= half * 2 ? size / 2 : Math.max(half - 2, Math.min(size - half + 2, at)));
      if (!v.overview) {
        c.x = keep(c.x, halfW, course.w);
        c.y = keep(c.y, halfH, course.h);
      }

      const L = lightFor(course.theme, lightRef.current);
      const key = lightKey(L) + Math.round(L.night * 20);
      if (key !== lk) {
        lk = key;
        layers.current!.light = buildLight(course, layers.current!, L);
      }
      drawFrame(ctx, {
        c: course,
        sim: s,
        layers: layers.current!,
        light: L,
        cam: c,
        dpr: cv.current!.width / Math.max(1, v.w),
        t,
        trail: trail.current,
        fx: fx.current,
        lightCanvas,
        aim: aim.current,
      });

      const h = `${s.strokes}|${s.mode}|${s.bag.join()}|${s.armed}|${s.shot}`;
      if (h !== lastHud) {
        lastHud = h;
        setHud({ strokes: s.strokes, mode: s.mode, bag: [...s.bag], armed: s.armed, shot: s.shot });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  // --- Touch: drag back from the ball to aim, anywhere else to look around, two fingers to zoom ---
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "aim" | "pan" | "pinch"; d0?: number; s0?: number; mid?: { x: number; y: number } } | null>(null);
  const local = (e: RPointerEvent) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toScreen = (x: number, y: number) => ({ x: (x - cam.current.x) * cam.current.s + cam.current.ox, y: (y - cam.current.y) * cam.current.s + cam.current.oy });
  const toWorld = (x: number, y: number) => ({ x: (x - cam.current.ox) / cam.current.s + cam.current.x, y: (y - cam.current.oy) / cam.current.s + cam.current.y });
  const maxPull = () => Math.min(170, view.current.w * 0.42);

  const down = (e: RPointerEvent) => {
    cv.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const s = sim.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      aim.current = null;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), s0: cam.current.s, mid: toWorld(mid.x, mid.y) };
      view.current.follow = false;
      return;
    }
    if (s.mode === "roll" && s.shot === "brake") {
      brake(s);
      return;
    }
    const ball = toScreen(s.x, s.y);
    if (s.mode === "aim" && Math.hypot(p.x - ball.x, p.y - ball.y) < Math.max(64, BALL_R * 7 * cam.current.s)) {
      gesture.current = { kind: "aim" };
      aim.current = null;
    } else gesture.current = { kind: "pan" };
  };
  const move = (e: RPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    const s = sim.current;
    if (g.kind === "aim") {
      const ball = toScreen(s.x, s.y);
      const dx = p.x - ball.x, dy = p.y - ball.y;
      const pull = Math.hypot(dx, dy);
      if (pull < 8) {
        aim.current = null;
        return;
      }
      const power = Math.min(1, pull / maxPull());
      const angle = Math.atan2(-dy, -dx);
      aim.current = { angle, power, line: preview(world, s, angle, power, s.armed === "ghost") };
    } else if (g.kind === "pan") {
      cam.current.x -= (p.x - prev.x) / cam.current.s;
      cam.current.y -= (p.y - prev.y) / cam.current.s;
      view.current.follow = false;
      view.current.overview = false;
      setOverview(false);
    } else if (g.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const v = view.current;
      cam.current.s = Math.max(v.fit * 0.9, Math.min(v.fit * 4 + 30, g.s0! * (d / g.d0!)));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      cam.current.x = g.mid!.x - (mid.x - cam.current.ox) / cam.current.s;
      cam.current.y = g.mid!.y - (mid.y - cam.current.oy) / cam.current.s;
      v.overview = false;
      setOverview(false);
    }
  };
  const up = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "aim" && aim.current && aim.current.power > 0.05) {
      shoot(sim.current, aim.current.angle, aim.current.power);
      view.current.follow = true;
      setShotOnce(true);
    }
    if (g?.kind === "aim") aim.current = null;
    if (pointers.current.size === 0) gesture.current = null;
    else if (g?.kind === "pinch") gesture.current = { kind: "pan" };
  };
  useEffect(() => {
    const el = cv.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      const before = toWorld(p.x, p.y);
      const v = view.current;
      cam.current.s = Math.max(v.fit * 0.9, Math.min(v.fit * 4 + 30, cam.current.s * Math.exp(-e.deltaY * 0.0015)));
      cam.current.x = before.x - (p.x - cam.current.ox) / cam.current.s;
      cam.current.y = before.y - (p.y - cam.current.oy) / cam.current.s;
      v.follow = false;
      v.overview = false;
      setOverview(false);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleOverview = () => {
    const v = view.current;
    v.overview = !v.overview;
    setOverview(v.overview);
    if (!v.overview) {
      v.follow = true;
      if (course.open) cam.current.s = Math.max(v.fit, v.w / 20);
    }
  };
  const restart = () => {
    sim.current = newSim(course);
    trail.current = [];
    setDone(false);
    view.current.follow = true;
  };
  const tapPower = (i: number) => {
    const s = sim.current;
    const p = s.bag[i];
    activate(s, i);
    if (p && INSTANT.includes(p)) sfx("recall");
    else sfx("pick");
  };

  const strokesLeft = MAX_STROKES - hud.strokes;
  return (
    <div ref={wrap} className="g-play">
      <canvas
        ref={cv}
        className="g-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label={`${course.name}, par ${course.par}`}
      />

      <div className="g-top">
        <button type="button" className="g-icon-btn" onClick={onBack} aria-label="Back">
          <CaretLeftIcon size={22} weight="bold" />
        </button>
        <div className="g-pill g-hole-pill">
          <span className="g-display g-hole-name">{course.name}</span>
          <span className="g-muted">Par {course.par}</span>
          <span className="g-display g-strokes" aria-label={`${hud.strokes} strokes`}>
            {hud.strokes}
          </span>
        </div>
        <TimeChip light={light} hour={hour} setHour={setHour} compact />
      </div>

      {!shotOnce && hud.strokes === 0 && <div className="g-hint">Pull back from the ball</div>}

      {toast && (
        <div key={toast.key} className="g-toast" onAnimationEnd={() => setToast(null)}>
          {toast.text}
        </div>
      )}

      <div className="g-dock">
        <div className="g-bag">
          {[0, 1].map((i) => {
            const p = hud.bag[i];
            const Icon = p ? POWER_UI[p].icon : null;
            return (
              <button key={i} type="button" className={`g-slot ${p ? "" : "g-slot-empty"}`} disabled={!p || hud.mode !== "aim"} onClick={() => tapPower(i)} aria-label={p ? `Use ${POWER_UI[p].name}` : "Empty power-up slot"}>
                {Icon && <Icon size={22} weight="fill" />}
                {p && <span>{POWER_UI[p].name}</span>}
              </button>
            );
          })}
          {hud.armed && (
            <div className="g-armed">
              {(() => {
                const Icon = POWER_UI[hud.armed].icon;
                return <Icon size={18} weight="fill" />;
              })()}
              {POWER_UI[hud.armed].name} next shot
            </div>
          )}
          {hud.mode === "roll" && hud.shot === "brake" && (
            <button type="button" className="g-btn g-btn-on g-brake" onClick={() => brake(sim.current)}>
              <HandPalmIcon size={22} weight="fill" /> Brake
            </button>
          )}
        </div>
        <div className="g-dock-right">
          <button type="button" className="g-icon-btn" onClick={toggleOverview} aria-label={overview ? "Follow the ball" : "See the whole hole"}>
            {overview ? <CornersInIcon size={22} weight="bold" /> : <CornersOutIcon size={22} weight="bold" />}
          </button>
          <button type="button" className="g-icon-btn" onClick={restart} aria-label="Start the hole again">
            <ArrowCounterClockwiseIcon size={22} weight="bold" />
          </button>
        </div>
      </div>

      {hud.mode === "aim" && strokesLeft <= 0 && !done && (
        <Result title="PICKED UP" sub={`${MAX_STROKES} strokes`} tone="hit" onAgain={restart} onNext={onNext} />
      )}
      {done && (
        <Result
          title={scoreName(hud.strokes, course.par).toUpperCase()}
          sub={`${hud.strokes} ${hud.strokes === 1 ? "stroke" : "strokes"} · Par ${course.par}`}
          tone={hud.strokes < course.par ? "green" : hud.strokes === course.par ? "yellow" : "grey"}
          onAgain={restart}
          onNext={onNext}
        />
      )}
    </div>
  );
}

function pointIn(p: { x: number; y: number }, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function Result({ title, sub, tone, onAgain, onNext }: { title: string; sub: string; tone: "green" | "yellow" | "grey" | "hit"; onAgain: () => void; onNext: () => void }) {
  const words = title.split(" ");
  return (
    <div className="g-result">
      <div className="g-result-card">
        <div className="g-tiles" aria-label={title}>
          {words.map((w, wi) => (
            <div key={wi} className="g-tile-row">
              {[...w].map((ch, i) => (
                <span key={i} className={`g-tile g-tile-${tone === "hit" && wi === 0 && i === 0 ? "hit" : tone}`} style={{ animationDelay: `${(wi * 4 + i) * 60}ms` }}>
                  {ch}
                </span>
              ))}
            </div>
          ))}
        </div>
        <p className="g-muted g-result-sub">{sub}</p>
        <div className="g-result-actions">
          <button type="button" className="g-btn g-btn-big" onClick={onAgain}>
            Again
          </button>
          <button type="button" className="g-btn g-btn-big g-btn-primary" onClick={onNext}>
            Next hole
          </button>
        </div>
      </div>
    </div>
  );
}
