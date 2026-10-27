import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  ArrowCounterClockwiseIcon,
  ArrowFatLinesUpIcon,
  BasketballIcon,
  ArrowsOutIcon,
  CaretLeftIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  CornersInIcon,
  CornersOutIcon,
  GhostIcon,
  HandPalmIcon,
  MagnetIcon,
  MoonIcon,
  PushPinIcon,
  RocketLaunchIcon,
  ShuffleIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  SunIcon,
  type Icon,
} from "@phosphor-icons/react";
import * as sound from "./audio";
import { GREEN_HILLS } from "./courses";
import { BAG_SIZE, DT, INSTANT, MAX_STROKES, activate, brake, hop, compile, groundAt, newSim, preview, scoreName, shoot, step, type Power, type Sim } from "./engine";
import { generate, type GenHole } from "./gen";
import { clockLabel, lightKey, sunAt, type Light } from "./light";
import { STYLES, drawFrame, lookOf, still, type Camera, type Fx, type Style } from "./render";

// Golf, one course for now: Green Hills, nine generated holes. Single player, no server. There's also
// the generator: page through seeds, play any of them, and pin the good ones.

const POWER_UI: Record<Power, { name: string; icon: Icon }> = {
  rocket: { name: "Rocket", icon: RocketLaunchIcon },
  ghost: { name: "Ghost", icon: GhostIcon },
  magnet: { name: "Magnet", icon: MagnetIcon },
  brake: { name: "Brake", icon: HandPalmIcon },
  mulligan: { name: "Mulligan", icon: ClockCounterClockwiseIcon },
  bigcup: { name: "Big cup", icon: ArrowsOutIcon },
  jump: { name: "Jump", icon: ArrowFatLinesUpIcon },
  bouncy: { name: "Bouncy", icon: BasketballIcon },
};
const FEATURE_NAMES: Record<string, string> = { pond: "Pond", island: "Island", stream: "Stream", gate: "Hedge", slope: "Slope", chamber: "Posts", hill: "Hill", ramp: "Ramp", boost: "Speed pads" };

const holeCache = new Map<number, GenHole | null>();
const hole = (seed: number) => {
  if (!holeCache.has(seed)) holeCache.set(seed, generate(seed));
  return holeCache.get(seed)!;
};

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be off in a sandboxed frame; pins just won't stick.
    }
  },
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

type Round = { seeds: number[]; start: number; index: number; scores: number[]; attempt: number };

export function GolfExplorer() {
  const [screen, setScreen] = useState<"home" | "browse" | "play">("home");
  const [hour, setHour] = useState<number | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [course, setCourse] = useState<number[]>(() => store.get("golf:course2", GREEN_HILLS));
  const [pins, setPins] = useState<number[]>(() => store.get("golf:pins2", []));
  const [muted, setMuted] = useState(false);
  const [style, setStyleState] = useState<Style>(() => store.get("golf:style", "flat"));
  const setStyle = (st: Style) => {
    setStyleState(st);
    store.set("golf:style", st);
  };
  const light = useLight(hour);
  useEffect(() => sound.setNight(light.night), [light.night]);
  useEffect(() => () => sound.stop(), []);
  const togglePin = (seed: number) => {
    const next = pins.includes(seed) ? pins.filter((s) => s !== seed) : [...pins, seed];
    setPins(next);
    store.set("golf:pins2", next);
  };
  const useAsCourse = (seeds: number[]) => {
    setCourse(seeds);
    store.set("golf:course2", seeds);
    setScreen("home");
  };
  const toggleMute = () => {
    sound.setMuted(!muted);
    setMuted(!muted);
  };
  const play = (seeds: number[], index = 0) => {
    setRound({ seeds, start: index, index, scores: [], attempt: 0 });
    setScreen("play");
  };
  const chrome = { light, hour, setHour, muted, toggleMute, style, setStyle };

  if (screen === "play" && round && round.scores.length === round.seeds.length - round.start) return <Scorecard round={round} onHome={() => setScreen("home")} />;
  if (screen === "play" && round) {
    const seed = round.seeds[round.index];
    return (
      <Play
        key={`${seed}-${round.index}-${round.attempt}`}
        seed={seed}
        number={round.seeds.length > 1 ? round.index + 1 : null}
        round={round}
        {...chrome}
        onBack={() => setScreen(round.seeds.length > 1 ? "home" : "browse")}
        onDone={(strokes) => {
          const scores = [...round.scores, strokes];
          setRound({ ...round, scores, index: Math.min(round.index + 1, round.seeds.length - 1), attempt: 0 });
        }}
        onAgain={() => setRound({ ...round, attempt: round.attempt + 1 })}
      />
    );
  }
  if (screen === "browse") return <Browse {...chrome} pins={pins} togglePin={togglePin} onBack={() => setScreen("home")} onPlay={(s) => play([s])} useAsCourse={useAsCourse} />;
  return <Home {...chrome} course={course} onPlay={play} onBrowse={() => setScreen("browse")} />;
}

type Chrome = { light: Light; hour: number | null; setHour: (h: number | null) => void; muted: boolean; toggleMute: () => void; style: Style; setStyle: (s: Style) => void };

function Thumb({ seed, light, width, style }: { seed: number; light: Light; width: number; style: Style }) {
  const [src, setSrc] = useState<string | null>(null);
  const key = lightKey(light);
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      const h = hole(seed);
      if (h && live) setSrc(still(h, width, light, style).toDataURL("image/jpeg", 0.85));
    }, 20 + Math.random() * 200);
    return () => {
      live = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, key, width, style]);
  return (
    <div className="g-thumb" style={{ background: lookOf(style).bg }}>
      {src && <img src={src} alt="" draggable={false} />}
    </div>
  );
}

function Home({ course, onPlay, onBrowse, ...chrome }: Chrome & { course: number[]; onPlay: (seeds: number[], i?: number) => void; onBrowse: () => void }) {
  const holes = course.map((s) => ({ seed: s, h: hole(s) }));
  const par = holes.reduce((a, x) => a + (x.h?.par ?? 0), 0);
  return (
    <div className="g-menu">
      <header className="g-menu-head">
        <h1 className="g-display g-title-lg">Green Hills</h1>
        <div className="g-row">
          <MuteButton {...chrome} />
          <TimeChip {...chrome} />
        </div>
      </header>
      <div className="g-seg" role="radiogroup" aria-label="Look">
        {STYLES.map((st) => (
          <button key={st.id} type="button" role="radio" aria-checked={chrome.style === st.id} className={`g-seg-item ${chrome.style === st.id ? "g-seg-on" : ""}`} onClick={() => chrome.setStyle(st.id)}>
            {st.name}
          </button>
        ))}
      </div>
      <button type="button" className="g-btn g-btn-big g-btn-primary g-play-all" onClick={() => onPlay(course)}>
        Play {course.length} holes · Par {par}
      </button>
      <section className="g-section">
        <ol className="g-holes">
          {holes.map(({ seed, h }, i) => (
            <li key={`${seed}-${i}`}>
              <button type="button" className="g-hole-row" onClick={() => onPlay(course, i)}>
                <span className="g-display g-hole-num">{i + 1}</span>
                <Thumb seed={seed} light={chrome.light} width={120} style={chrome.style} />
                <span className="g-hole-text">
                  <span className="g-display g-card-name">{h?.name ?? `Seed ${seed}`}</span>
                  <span className="g-footnote">
                    Par {h?.par} · {h?.stats.features.map((f) => FEATURE_NAMES[f]).filter((x, k, a) => a.indexOf(x) === k).join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>
      <button type="button" className="g-btn g-btn-big" onClick={onBrowse}>
        <ShuffleIcon size={20} weight="bold" /> Generator
      </button>
    </div>
  );
}

function Browse({ pins, togglePin, onBack, onPlay, useAsCourse, ...chrome }: Chrome & { pins: number[]; togglePin: (s: number) => void; onBack: () => void; onPlay: (s: number) => void; useAsCourse: (s: number[]) => void }) {
  const [start, setStart] = useState(() => store.get("golf:browse", 100));
  const [seeds, setSeeds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Find the next eight seeds that make the cut, a few at a time so the page stays responsive.
  useEffect(() => {
    let live = true;
    setSeeds([]);
    setBusy(true);
    let s = start;
    const found: number[] = [];
    const next = () => {
      if (!live) return;
      const until = performance.now() + 60;
      while (performance.now() < until && found.length < 8) if (hole(s++)) found.push(s - 1);
      setSeeds([...found]);
      if (found.length < 8) setTimeout(next, 0);
      else setBusy(false);
    };
    next();
    return () => {
      live = false;
    };
  }, [start]);
  const more = () => {
    const last = seeds[seeds.length - 1] ?? start;
    setStart(last + 1);
    store.set("golf:browse", last + 1);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pins.join(", "));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard in this frame.
    }
  };
  return (
    <div className="g-menu">
      <header className="g-menu-head">
        <div className="g-row">
          <button type="button" className="g-icon-btn g-icon-plain" onClick={onBack} aria-label="Back">
            <CaretLeftIcon size={22} weight="bold" />
          </button>
          <h1 className="g-display g-title">Generator</h1>
        </div>
        <TimeChip {...chrome} />
      </header>
      {pins.length > 0 && (
        <section className="g-section">
          <h2 className="g-display g-heading">Pinned</h2>
          <div className="g-pins">
            {pins.map((s) => (
              <button key={s} type="button" className="g-chip-btn" onClick={() => onPlay(s)}>
                {hole(s)?.name ?? s} <span className="g-muted">#{s}</span>
              </button>
            ))}
          </div>
          <div className="g-row g-pin-actions">
            <button type="button" className="g-btn" onClick={copy}>
              <CopyIcon size={18} weight="bold" /> {copied ? "Copied" : "Copy seeds"}
            </button>
            <button type="button" className="g-btn g-btn-on" onClick={() => useAsCourse(pins.slice(0, 9))} disabled={pins.length === 0}>
              Make these the course
            </button>
          </div>
        </section>
      )}
      <section className="g-section">
        <h2 className="g-display g-heading">From seed {start}</h2>
        <div className="g-grid">
          {seeds.map((s) => {
            const h = hole(s)!;
            const pinned = pins.includes(s);
            return (
              <div key={s} className="g-card">
                <button type="button" className="g-card-main" onClick={() => onPlay(s)} aria-label={`Play ${h.name}`}>
                  <Thumb seed={s} light={chrome.light} width={170} style={chrome.style} />
                  <span className="g-card-text">
                    <span className="g-display g-card-name">{h.name}</span>
                    <span className="g-footnote">
                      #{s} · Par {h.par} · {h.stats.length}m
                    </span>
                    <span className="g-footnote">{[...new Set(h.stats.features.map((f) => FEATURE_NAMES[f]))].join(" · ")}</span>
                  </span>
                </button>
                <button type="button" className={`g-pin ${pinned ? "g-pin-on" : ""}`} onClick={() => togglePin(s)} aria-label={pinned ? `Unpin ${h.name}` : `Pin ${h.name}`} aria-pressed={pinned}>
                  <PushPinIcon size={20} weight={pinned ? "fill" : "bold"} />
                </button>
              </div>
            );
          })}
        </div>
        <button type="button" className="g-btn g-btn-big g-more" onClick={more} disabled={busy}>
          {busy ? "Generating…" : "Next eight"}
        </button>
      </section>
    </div>
  );
}

function MuteButton({ muted, toggleMute }: Chrome) {
  return (
    <button type="button" className="g-icon-btn" onClick={toggleMute} aria-label={muted ? "Sound on" : "Sound off"}>
      {muted ? <SpeakerSlashIcon size={22} weight="fill" /> : <SpeakerHighIcon size={22} weight="fill" />}
    </button>
  );
}

function TimeChip({ light, hour, setHour, compact }: Chrome & { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = light.night > 0.5 ? MoonIcon : SunIcon;
  return (
    <div className="g-time">
      <button type="button" className={compact ? "g-icon-btn" : "g-pill g-time-chip"} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Time of day: ${clockLabel(light.hour)}`}>
        <Icon size={compact ? 22 : 18} weight="fill" />
        {!compact && <span className="g-display">{clockLabel(light.hour)}</span>}
      </button>
      {open && (
        <div className="g-time-panel">
          <span className="g-display g-time-label">{clockLabel(light.hour)}</span>
          <input type="range" min={0} max={24} step={0.05} value={light.hour} aria-label="Time of day" onChange={(e) => setHour(Number(e.target.value))} className="g-range" />
          <button type="button" className={`g-btn ${hour === null ? "g-btn-on" : ""}`} onClick={() => setHour(null)}>
            Live
          </button>
        </div>
      )}
    </div>
  );
}

// --- Playing a hole ---

type Hud = { strokes: number; mode: Sim["mode"]; bag: Power[]; armed: Power | null; shot: Power | null; dist: number };

function Play({
  seed,
  number,
  round,
  onBack,
  onDone,
  onAgain,
  ...chrome
}: Chrome & { seed: number; number: number | null; round: Round; onBack: () => void; onDone: (strokes: number) => void; onAgain: () => void }) {
  const course = hole(seed)!;
  const { light } = chrome;
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const world = useMemo(() => compile(course), [course]);
  const sim = useRef<Sim>(newSim(course, seed));
  const lightRef = useRef(light);
  lightRef.current = light;
  const cam = useRef<Camera>({ x: course.w / 2, y: course.h / 2, s: 10, ox: 0, oy: 0 });
  const view = useRef({ w: 0, h: 0, fit: 10, play: 18, follow: true, overview: false, intro: 0, introOn: true, panned: 0, mapY: 90 });
  const aim = useRef<{ angle: number; power: number; line: { x: number; y: number }[]; from?: { x: number; y: number }; to?: { x: number; y: number } } | null>(null);
  const fx = useRef<Fx[]>([]);
  const trail = useRef<{ x: number; y: number }[]>([]);
  const [hud, setHud] = useState<Hud>({ strokes: 0, mode: "aim", bag: [], armed: null, shot: null, dist: 0 });
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [done, setDone] = useState(false);
  const [overview, setOverview] = useState(false);
  const [intro, setIntro] = useState(true);
  const say = (text: string) => setToast({ text, key: Date.now() });

  const styleRef = useRef(chrome.style);
  styleRef.current = chrome.style;

  const PAD_TOP = 84, PAD_BOTTOM = 104;
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.current!.width = Math.round(r.width * dpr);
      cv.current!.height = Math.round(r.height * dpr);
      const first = view.current.w === 0;
      Object.assign(view.current, {
        w: r.width,
        h: r.height,
        fit: Math.min((r.width - 16) / course.w, (r.height - PAD_TOP - PAD_BOTTOM) / (course.h + 3)),
        play: Math.max(14, r.width / 20),
      });
      // The minimap sits just under the top bar, wherever the safe area puts it.
      const bar = el.querySelector(".g-top")?.getBoundingClientRect();
      view.current.mapY = bar ? bar.bottom - r.top + 10 : PAD_TOP + 6;
      cam.current.ox = r.width / 2;
      cam.current.oy = PAD_TOP + (r.height - PAD_TOP - PAD_BOTTOM) / 2;
      if (first) {
        cam.current.s = view.current.fit;
        cam.current.x = course.w / 2;
        cam.current.y = course.h / 2;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [course]);

  useEffect(() => {
    const ctx = cv.current!.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let t = 0;
    let lastHud = "";
    let lastKnock = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      const last0 = last;
      last = now;
      t += dt;
      const s = sim.current;
      const v = view.current;
      if (!v.introOn) {
        acc += dt;
        while (acc >= DT) {
          step(s, world, DT);
          acc -= DT;
        }
      }
      for (const e of s.events) {
        const fxSeed = Math.floor(Math.random() * 1e6);
        switch (e.type) {
          case "hit":
            sound.putt(e.power);
            trail.current = [];
            break;
          case "bounce":
            if (now - lastKnock > 60) sound.knock(e.power);
            lastKnock = now;
            break;
          case "bump":
            if (now - lastKnock > 60) sound.bump();
            lastKnock = now;
            fx.current.push({ kind: "ring", x: e.x, y: e.y, t, seed: fxSeed });
            break;
          case "splash":
            if (s.outGround === "oob") say("Out of bounds. +1");
            else {
              sound.splash();
              fx.current.push({ kind: "splash", x: e.x, y: e.y, t, seed: fxSeed });
              say("Splash! +1");
            }
            break;
          case "sink":
            sound.plunk();
            fx.current.push({ kind: "ring", x: e.x, y: e.y, t, seed: fxSeed });
            if (s.strokes <= course.par) fx.current.push({ kind: "confetti", x: e.x, y: e.y - 1, t, seed: fxSeed });
            setTimeout(() => setDone(true), 900);
            break;
          case "box":
            sound.pickup();
            fx.current.push({ kind: "spark", x: e.x, y: e.y - 1, t, seed: fxSeed });
            say(`Got ${POWER_UI[e.item].name}`);
            break;
          case "launch":
            sound.whoosh();
            break;
          case "land":
            if (e.power > 0.1) sound.land(e.power);
            if (groundAt(world, e) === "sand") fx.current.push({ kind: "puff", x: e.x, y: e.y, t, seed: fxSeed });
            break;
          case "warp":
            fx.current.push({ kind: "spark", x: e.x, y: e.y, t, seed: fxSeed, color: "#b49aff" });
            break;
          case "lip":
            sound.knock(0.2);
            say("Lipped out");
            break;
          case "stop":
            sound.land(0.4);
            break;
        }
      }
      s.events.length = 0;
      fx.current = fx.current.filter((f) => t - f.t < 2.5);
      const speed = Math.hypot(s.vx, s.vy);
      if (s.mode === "roll") {
        const tr = trail.current;
        const lp = tr[tr.length - 1];
        if (!lp || Math.hypot(lp.x - s.x, lp.y - s.y) > 0.3) tr.push({ x: s.x, y: s.y });
        if (tr.length > 40) tr.shift();
      }
      sound.rolling(s.mode === "roll" && s.z <= 0 ? speed : 0, s.mode === "roll" ? groundAt(world, s) : null);

      // Camera: a look over the whole hole first, then down to the ball, which it follows a little ahead.
      const c = cam.current;
      const ease = (k: number) => k * k * (3 - 2 * k);
      // Ahead of the ball, more the faster it goes.
      const follow = { x: s.x + s.vx * 0.4, y: s.y - 2 + s.vy * 0.4 };
      if (s.mode === "aim") {
        // Lean the view toward the cup.
        const dx = course.cup.x - s.x, dy = course.cup.y - s.y, d = Math.hypot(dx, dy) || 1;
        follow.x = s.x + (dx / d) * Math.min(5, d * 0.3);
        follow.y = s.y - 1.5 + (dy / d) * Math.min(5, d * 0.3);
      }
      if (v.introOn) {
        // Wall-clock time, so a slow first frame doesn't drag the look-over out.
        v.intro += Math.min(0.25, (now - last0) / 1000);
        const k = ease(Math.max(0, Math.min(1, (v.intro - 1.6) / 1.6)));
        c.s = v.fit + (v.play - v.fit) * k;
        c.x = course.w / 2 + (follow.x - course.w / 2) * k;
        c.y = course.h / 2 + (follow.y - course.h / 2) * k;
        if (v.intro > 3.2) {
          v.introOn = false;
          setIntro(false);
        }
      } else if (v.overview) {
        const k = 1 - Math.exp(-dt * 6);
        c.s += (v.fit - c.s) * k;
        c.x += (course.w / 2 - c.x) * k;
        c.y += (course.h / 2 - c.y) * k;
      } else if (v.follow && now - v.panned > 1200) {
        const k = 1 - Math.exp(-dt * (s.mode === "roll" ? 3 : 2));
        const zoomOut = s.mode === "roll" ? Math.min(0.45, speed / 70) : 0;
        c.s += (v.play * (1 - zoomOut) - c.s) * (1 - Math.exp(-dt * 2));
        c.x += (follow.x - c.x) * k;
        c.y += (follow.y - c.y) * k;
      }

      const L = lightRef.current;
      drawFrame(ctx, {
        c: course,
        sim: s,
        style: styleRef.current,
        map: v.introOn || v.overview ? null : { x: v.w - 12 - 64, y: v.mapY, w: 64, h: 96 },
        light: L,
        cam: c,
        dpr: cv.current!.width / Math.max(1, v.w),
        t,
        trail: trail.current,
        fx: fx.current,
        aim: aim.current,
      });

      const dist = Math.round(Math.hypot(course.cup.x - s.x, course.cup.y - s.y));
      const h = `${s.strokes}|${s.mode}|${s.bag.join()}|${s.armed}|${s.shot}|${dist}`;
      if (h !== lastHud) {
        lastHud = h;
        setHud({ strokes: s.strokes, mode: s.mode, bag: [...s.bag], armed: s.armed, shot: s.shot, dist });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      sound.rolling(0, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  // --- Touch: pull back anywhere to aim; two fingers to look around and zoom ---
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "aim" | "pan" | "pinch"; start?: { x: number; y: number }; d0?: number; s0?: number; mid?: { x: number; y: number } } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (x: number, y: number) => ({ x: (x - cam.current.ox) / cam.current.s + cam.current.x, y: (y - cam.current.oy) / cam.current.s + cam.current.y });
  const maxPull = () => Math.min(190, view.current.w * 0.46);
  const skipIntro = () => {
    const v = view.current;
    if (v.introOn) v.intro = Math.max(v.intro, 1.6);
  };

  const down = (e: RPointerEvent) => {
    sound.unlock();
    cv.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const s = sim.current;
    if (view.current.introOn) {
      skipIntro();
      gesture.current = null;
      return;
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      aim.current = null;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), s0: cam.current.s, mid: toWorld(mid.x, mid.y) };
      return;
    }
    if (s.mode === "roll" && s.shot === "brake") {
      brake(s);
      return;
    }
    if (s.mode === "roll" && s.shot === "jump") {
      hop(s);
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
    const v = view.current;
    if (g.kind === "aim" && g.start) {
      const dx = g.start.x - p.x, dy = g.start.y - p.y;
      const pull = Math.hypot(dx, dy);
      if (pull < 10) {
        aim.current = null;
        return;
      }
      // Gentle at first, for putts; the last bit of the pull is where the power is.
      const power = Math.min(1, pull / maxPull()) ** 1.35;
      const angle = Math.atan2(dy, dx);
      aim.current = { angle, power, line: preview(world, s, angle, power, s.armed === "ghost"), from: g.start, to: p };
    } else if (g.kind === "pan") {
      cam.current.x -= (p.x - prev.x) / cam.current.s;
      cam.current.y -= (p.y - prev.y) / cam.current.s;
      v.panned = performance.now();
      v.overview = false;
      setOverview(false);
    } else if (g.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.current.s = Math.max(v.fit * 0.9, Math.min(v.play * 2.2, g.s0! * (d / g.d0!)));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      cam.current.x = g.mid!.x - (mid.x - cam.current.ox) / cam.current.s;
      cam.current.y = g.mid!.y - (mid.y - cam.current.oy) / cam.current.s;
      v.panned = performance.now();
      v.overview = false;
      setOverview(false);
    }
  };
  const up = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "aim" && aim.current && aim.current.power > 0.01) {
      shoot(sim.current, aim.current.angle, aim.current.power);
      view.current.follow = true;
      view.current.panned = 0;
      view.current.overview = false;
      setOverview(false);
    }
    if (g?.kind === "aim") aim.current = null;
    if (pointers.current.size === 0) gesture.current = null;
    else if (g?.kind === "pinch") gesture.current = { kind: "pan" };
  };
  useEffect(() => {
    const el = cv.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const before = toWorld(p.x, p.y);
      const v = view.current;
      cam.current.s = Math.max(v.fit * 0.9, Math.min(v.play * 2.2, cam.current.s * Math.exp(-e.deltaY * 0.0015)));
      cam.current.x = before.x - (p.x - cam.current.ox) / cam.current.s;
      cam.current.y = before.y - (p.y - cam.current.oy) / cam.current.s;
      v.panned = performance.now();
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

  const toggleOverview = () => {
    const v = view.current;
    v.overview = !v.overview;
    if (!v.overview) v.panned = 0;
    setOverview(v.overview);
  };
  const tapPower = (i: number) => {
    const s = sim.current;
    const p = s.bag[i];
    activate(s, i);
    if (p && INSTANT.includes(p)) sound.pickup();
  };

  const totalPar = round.seeds.slice(round.start, round.index).reduce((a, s) => a + (hole(s)?.par ?? 0), 0);
  const totalStrokes = round.scores.reduce((a, b) => a + b, 0);
  const vsPar = totalStrokes - totalPar;
  return (
    <div ref={wrap} className="g-play">
      <canvas ref={cv} className="g-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label={`${course.name}, par ${course.par}`} />

      <div className="g-top">
        <button type="button" className="g-icon-btn" onClick={onBack} aria-label="Back">
          <CaretLeftIcon size={22} weight="bold" />
        </button>
        <div className="g-pill g-hole-pill">
          {number !== null && <span className="g-display g-hole-no">{number}</span>}
          <span className="g-display g-hole-name">{course.name}</span>
          <span className="g-muted">{hud.dist}m</span>
          {number !== null && round.scores.length > 0 && <span className="g-muted g-vspar">{vsPar === 0 ? "E" : vsPar > 0 ? `+${vsPar}` : vsPar}</span>}
          <span className="g-display g-strokes" aria-label={`${hud.strokes} strokes`}>
            {hud.strokes}
          </span>
        </div>
        <TimeChip {...chrome} compact />
      </div>

      {intro && (
        <div className="g-intro" key="intro">
          {number !== null && <span className="g-display g-intro-no">Hole {number}</span>}
          <span className="g-display g-intro-name">{course.name}</span>
          <span className="g-intro-par">
            Par {course.par} · {course.stats.length}m
          </span>
        </div>
      )}

      {toast && (
        <div key={toast.key} className="g-toast" onAnimationEnd={() => setToast(null)}>
          {toast.text}
        </div>
      )}

      <div className="g-dock">
        <div className="g-bag">
          {Array.from({ length: BAG_SIZE }, (_, i) => i).map((i) => {
            const p = hud.bag[i];
            const IconC = p ? POWER_UI[p].icon : null;
            return (
              <button key={i} type="button" className={`g-slot ${p ? "" : "g-slot-empty"}`} disabled={!p || hud.mode !== "aim"} onClick={() => tapPower(i)} aria-label={p ? `Use ${POWER_UI[p].name}` : "Empty power-up slot"}>
                {IconC && <IconC size={22} weight="fill" />}
                {p && <span>{POWER_UI[p].name}</span>}
              </button>
            );
          })}
          {hud.armed && (
            <div className="g-armed">
              {(() => {
                const A = POWER_UI[hud.armed].icon;
                return <A size={18} weight="fill" />;
              })()}
              {POWER_UI[hud.armed].name} next shot
            </div>
          )}
          {hud.mode === "roll" && hud.shot === "jump" && (
            <button type="button" className="g-btn g-btn-on g-brake" onClick={() => hop(sim.current)}>
              <ArrowFatLinesUpIcon size={22} weight="fill" /> Jump
            </button>
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
          <button type="button" className="g-icon-btn" onClick={onAgain} aria-label="Start the hole again">
            <ArrowCounterClockwiseIcon size={22} weight="bold" />
          </button>
        </div>
      </div>

      {hud.mode === "aim" && hud.strokes >= MAX_STROKES && !done && (
        <Result title="PICKED UP" sub={`${MAX_STROKES} strokes`} tone="hit" primary={number ? "Next hole" : "Again"} onPrimary={() => (number ? onDone(MAX_STROKES) : onAgain())} onSecondary={onAgain} />
      )}
      {done && (
        <Result
          title={scoreName(hud.strokes, course.par).toUpperCase()}
          sub={`${hud.strokes} ${hud.strokes === 1 ? "stroke" : "strokes"} · Par ${course.par}`}
          tone={hud.strokes < course.par ? "green" : hud.strokes === course.par ? "yellow" : "grey"}
          primary={number !== null ? (number === round.seeds.length ? "Scorecard" : "Next hole") : "Again"}
          onPrimary={() => (number !== null ? onDone(hud.strokes) : onAgain())}
          onSecondary={onAgain}
        />
      )}
    </div>
  );
}

function Result({ title, sub, tone, primary, onPrimary, onSecondary }: { title: string; sub: string; tone: "green" | "yellow" | "grey" | "hit"; primary: string; onPrimary: () => void; onSecondary: () => void }) {
  const words = title.split(" ");
  return (
    <div className="g-result">
      <div className="g-result-card">
        <div className="g-tiles" aria-label={title}>
          {words.map((w, wi) => (
            <div key={wi} className="g-tile-row">
              {[...w].map((ch, i) => (
                <span key={i} className={`g-tile g-tile-${tone === "hit" && wi === 0 && i === 0 ? "hit" : tone === "hit" ? "grey" : tone}`} style={{ animationDelay: `${(wi * 4 + i) * 60}ms` }}>
                  {ch}
                </span>
              ))}
            </div>
          ))}
        </div>
        <p className="g-muted g-result-sub">{sub}</p>
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

function Scorecard({ round, onHome }: { round: Round; onHome: () => void }) {
  const pars = round.seeds.slice(round.start).map((s) => hole(s)?.par ?? 0);
  const total = round.scores.reduce((a, b) => a + b, 0);
  const par = pars.reduce((a, b) => a + b, 0);
  const diff = total - par;
  return (
    <div className="g-menu g-scorecard">
      <div>
        <h1 className="g-display g-title-lg">Green Hills</h1>
        <div className="g-tiles g-tiles-left" aria-label={`${total} strokes`}>
          <div className="g-tile-row">
            {[...String(total)].map((ch, i) => (
              <span key={i} className={`g-tile g-tile-${diff < 0 ? "green" : diff === 0 ? "yellow" : "grey"}`} style={{ animationDelay: `${i * 60}ms` }}>
                {ch}
              </span>
            ))}
          </div>
        </div>
        <p className="g-muted g-result-sub">{diff === 0 ? "Even par" : diff > 0 ? `${diff} over par` : `${-diff} under par`}</p>
        <table className="g-card-table">
          <thead>
            <tr>
              <th>Hole</th>
              {pars.map((_, i) => (
                <th key={i}>{round.start + i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Par</th>
              {pars.map((p, i) => (
                <td key={i}>{p}</td>
              ))}
            </tr>
            <tr>
              <th>You</th>
              {round.scores.map((s, i) => (
                <td key={i} className={s < pars[i] ? "g-under" : s > pars[i] ? "g-over" : ""}>
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
