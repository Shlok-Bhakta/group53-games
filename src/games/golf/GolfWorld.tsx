import { useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../../../convex/_generated/api";
import { INSTANT, TARGETED, canShoot, preview, type Course } from "../../../convex/golf/engine";
import { worldOf } from "../../../convex/golf/holes";
import { useGoBack } from "@/components/AppHeader";
import { FullscreenStage } from "@/components/game/floating";
import { cn } from "@/lib/utils";
import { usePlayingIn } from "@/presence";
import * as sound from "./audio";
import type { Camera } from "./toy";
import { BESIDE_RAIL, Dock, RoundBar, TargetHint, TopBar, type Hud } from "./Hud";
import { HoleResult } from "./HoleResult";
import { useGolfLoop, type Aim, type Box, type History, type Target } from "./useGolfLoop";
import { useGolfNet } from "./useGolfNet";
import { OVERLAY } from "./palette";

type Vec = { x: number; y: number };

const OPEN_GAP = 8;
const PLAY_UNITS_ACROSS = 24;

export type HoleInfo = { number: number; total: number; next: string | null };
export type Round = {
  turns: boolean;
  turn: string | null;
  number: number;
  total: number;
  minTick: number;
  colorOf: (id: string) => string | undefined;
  bar: ReactNode;
  onMenu: () => void;
  onSunk: (strokes: number) => void;
  catchUp?: { from: number; onStart: () => void; onShot: (by: string) => void; onDone: () => void; onSeen: (tick: number) => void };
  banner?: ReactNode;
  onSeen?: (tick: number) => void;
};

export default function GolfWorld({ course: COURSE, hole, round }: { course: Course; hole?: HoleInfo; round?: Round }) {
  const WORLD = worldOf(COURSE);
  const roundRef = useRef(round);
  roundRef.current = round;
  const minTick = useRef(0);
  minTick.current = round?.minTick ?? 0;
  const golfNet = useGolfNet(COURSE, minTick);
  const { meId, meRef, net, send } = golfNet;
  const goBack = useGoBack(round ? "/" : hole ? "/golf/practice" : "/golf");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const playing = usePlayingIn(pathname);
  const scores = useQuery(api.golf.scores, hole && !round ? {} : "skip");
  const history = useRef<History | null | undefined>(undefined);
  history.current = useQuery(api.golf.history, round?.catchUp ? { key: COURSE.id } : "skip");
  const [result, setResult] = useState<{ strokes: number } | null>(null);
  const bounds = useMemo(() => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const g of COURSE.greens)
      for (const p of g.poly) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
    return { x0, y0, x1, y1 };
  }, [COURSE]);

  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ x: COURSE.tee.x, y: COURSE.tee.y, s: 16, ox: 0, oy: 0 });
  const box = useRef<Box>({ w: 0, h: 0, fit: 4, play: 16, top: 90, bottom: 120, left: 0, right: 0, panned: 0, big: true });
  const [big, setBig] = useState(true);
  const [overview, setOverview] = useState(false);
  const overviewRef = useRef(overview);
  overviewRef.current = overview;
  const aim = useRef<Aim | null>(null);
  const blind = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const targetAt = useRef<Vec | null>(null);
  const [hud, setHud] = useState<Hud>({
    ready: false,
    mode: null,
    bag: [],
    armed: null,
    shot: null,
    holes: 0,
    strokes: 0,
    status: null,
    canShoot: false,
    slow: false,
  });

  useEffect(() => {
    sound.listen();
    return () => sound.stop();
  }, []);

  const showWhole = (s: number) => {
    cam.current.s = s;
    cam.current.x = (bounds.x0 + bounds.x1) / 2;
    cam.current.y = (bounds.y0 + bounds.y1) / 2;
  };
  const layout = useEffectEvent(() => {
    const r = wrap.current!.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.current!.width = Math.round(r.width * dpr);
    cv.current!.height = Math.round(r.height * dpr);
    const b = box.current;
    b.w = r.width;
    b.h = r.height;
    const bar = top.current?.getBoundingClientRect();
    const sideRail = !!bar && bar.height > bar.width;
    b.top = sideRail ? OPEN_GAP : (bar?.bottom ?? 90) - r.top + OPEN_GAP;
    b.left = sideRail ? bar.right - r.left : 0;
    b.right = 0;
    b.bottom = r.bottom - (dock.current?.getBoundingClientRect().top ?? r.bottom - 120) + OPEN_GAP;
    const openW = r.width - b.left - b.right;
    b.fit = Math.min((openW - 2 * OPEN_GAP) / (bounds.x1 - bounds.x0 + 2), (r.height - b.top - b.bottom) / (bounds.y1 - bounds.y0 + 2));
    b.play = Math.min(r.width, r.height) / PLAY_UNITS_ACROSS;
    b.big = COURSE.open === true || b.fit < b.play * 0.8;
    setBig(b.big);
    cam.current.ox = b.left + openW / 2;
    cam.current.oy = b.top + (r.height - b.top - b.bottom) / 2;
    if (!b.big) showWhole(b.fit);
    else if (!overviewRef.current) cam.current.s = b.play;
  });
  useEffect(() => {
    const ro = new ResizeObserver(() => layout());
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  const frameOverview = useEffectEvent((whole: boolean) => {
    const b = box.current;
    if (!b.big) return;
    if (whole) showWhole(b.fit);
    else cam.current.s = b.play;
  });
  useEffect(() => frameOverview(overview), [overview]);

  useGolfLoop({
    course: COURSE,
    world: WORLD,
    hole,
    round: roundRef,
    net: golfNet,
    history,
    scene: { cv, cam, box, overview: overviewRef, aim, blind, target: targetRef, targetAt },
    setHud,
    onSunk: (strokes) => {
      const r = roundRef.current;
      if (r) r.onSunk(strokes);
      else setResult({ strokes });
    },
  });
  const myTurn = !round?.turns || round.turn === meId;

  const pointers = useRef(new Map<number, Vec>());
  const gesture = useRef<{ kind: "aim" | "pan" | "pinch" | "target"; start?: Vec; d0?: number; s0?: number; mid?: Vec } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (p: Vec) => ({
    x: (p.x - cam.current.ox) / cam.current.s + cam.current.x,
    y: (p.y - cam.current.oy) / cam.current.s + cam.current.y,
  });
  const maxPull = () => Math.min(190, box.current.w * 0.46);
  const mine = () => net.current.state?.balls.find((b) => b.id === meRef.current);

  const down = (e: RPointerEvent) => {
    sound.unlock();
    cv.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      aim.current = null;
      gesture.current = {
        kind: "pinch",
        d0: Math.hypot(a.x - b.x, a.y - b.y),
        s0: cam.current.s,
        mid: toWorld({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      };
      return;
    }
    const m = mine();
    if (!m) {
      gesture.current = { kind: "pan" };
      return;
    }
    if (m.mode === "roll" && m.shot === "brake") return send("brake");
    if (m.mode === "roll" && m.shot === "jump") return send("hop");
    if (targetRef.current && m.mode === "aim") {
      gesture.current = { kind: "target" };
      targetAt.current = toWorld(p);
      return;
    }
    const turnOk = !roundRef.current?.turns || roundRef.current.turn === meRef.current;
    gesture.current = canShoot(m) && turnOk && !e.shiftKey && e.button !== 2 ? { kind: "aim", start: p } : { kind: "pan" };
  };
  const move = (e: RPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    const m = mine();
    if (!g) return;
    if (g.kind === "target") targetAt.current = toWorld(p);
    else if (g.kind === "aim" && g.start && m) {
      const dx = g.start.x - p.x,
        dy = g.start.y - p.y;
      const pull = Math.hypot(dx, dy);
      if (pull < 10) {
        aim.current = null;
        return;
      }
      const power = Math.min(1, pull / maxPull()) ** 1.35;
      const angle = Math.atan2(dy, dx);
      aim.current = { angle, power, line: preview(WORLD, m, angle, power, m.armed === "ghost"), from: g.start, to: p };
    } else if (g.kind === "pan" && box.current.big) {
      cam.current.x -= (p.x - prev.x) / cam.current.s;
      cam.current.y -= (p.y - prev.y) / cam.current.s;
      box.current.panned = performance.now();
    } else if (g.kind === "pinch" && pointers.current.size === 2 && box.current.big) {
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
      if (!bx.big) return;
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
    if (!p || hud.mode !== "aim" || !myTurn) return;
    if (TARGETED.includes(p)) {
      setTarget(target?.i === i ? null : { i, kind: p });
      return;
    }
    if (INSTANT.includes(p)) sound.pickup();
    send("use", { i });
  };
  const others = playing.filter((p) => p._id !== meId);

  return (
    <FullscreenStage ref={wrap} data-mode={hud.mode ?? ""} className="touch-none select-none [--rail-width:13rem]">
      <canvas
        ref={cv}
        className="absolute inset-0 size-full"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label={
          round
            ? `${COURSE.name}, hole ${round.number} of ${round.total}`
            : hole
              ? `${COURSE.name}, hole ${hole.number}`
              : `${COURSE.name}, an open course`
        }
        data-turn={round ? (myTurn ? "mine" : "theirs") : undefined}
      />

      {round ? (
        <RoundBar ref={top} course={COURSE} round={round} hud={hud} onBack={goBack} />
      ) : (
        <TopBar ref={top} course={COURSE} hole={hole} others={others} hud={hud} onBack={goBack} />
      )}
      <TargetHint target={target} onCancel={() => setTarget(null)} />
      {round?.banner && (
        <div className={cn("absolute inset-x-0 top-[calc(var(--safe-top)+92px)] z-20 flex justify-center", BESIDE_RAIL)}>
          {round.banner}
        </div>
      )}
      <Dock
        ref={dock}
        hud={hud}
        target={target}
        hole={!!hole}
        game={!!round}
        myTurn={myTurn}
        big={big}
        overview={overview}
        onItem={tapItem}
        onRolling={() => send(hud.shot === "jump" ? "hop" : "brake")}
        onOverview={() => setOverview((o) => !o)}
        onReset={() => send("reset")}
      />

      <div
        ref={blind}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20 opacity-0"
        style={{ backgroundColor: OVERLAY.flash }}
      />

      {(hole || round) && (
        <motion.div
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ delay: 1.1, duration: 0.5 }}
          className={cn("pointer-events-none absolute inset-x-0 top-1/3 z-10 text-center", BESIDE_RAIL)}
          style={{ color: OVERLAY.title, textShadow: OVERLAY.titleShadow }}
          aria-hidden
        >
          <p className="font-display text-callout">
            Hole {(hole ?? round)!.number}
            {round ? ` of ${round.total}` : ""}
          </p>
          <p className="font-display text-title-lg">{COURSE.name}</p>
          <p className="text-callout">Par {COURSE.par}</p>
        </motion.div>
      )}

      <AnimatePresence>
        {result && hole && !round && (
          <HoleResult
            key="result"
            strokes={result.strokes}
            par={COURSE.par}
            scores={(scores ?? []).filter((r) => r.hole === COURSE.id)}
            next={hole.next}
            onAgain={() => setResult(null)}
            onNext={() => (hole.next ? navigate(hole.next, { replace: true }) : goBack())}
          />
        )}
      </AnimatePresence>

      {!hud.ready && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
          <span className="rounded-full bg-card/90 px-4 py-2 font-display text-callout shadow-md">Teeing up</span>
        </div>
      )}
    </FullscreenStage>
  );
}
