import type { Ground } from "./engine";

// Golf's own sounds, synthesized like the rest of the app's (soft envelopes, filtered noise for
// anything percussive, a few sine partials for anything tonal, a small room reverb rather than
// loudness): the putt, wood knocks off the rails, rubber bumpers, the ball rolling (a filtered hiss
// that follows its speed and what it's rolling on), the cup, boxes, blasts.
//
// iOS only starts audio from a whole tap (touchend or click, not the finger going down), and wants a
// sound started in that tap, so every tap anywhere wakes the context with a silent buffer until it's
// running. Nothing plays on its own: every sound is something happening in the game.
//
// Every sound is also logged to `window.__golfSounds` when that's an array, with the time it played,
// so a recording can render the same sounds offline (`renderOffline`) and lay them under the video.

type Graph = { out: GainNode; wet: GainNode; roll: { gain: GainNode; filter: BiquadFilterNode }; noise: AudioBuffer };
let ctx: BaseAudioContext | null = null;
let g: Graph | null = null;
let muted = false;
let at: number | null = null; // rendering offline: when the sound being scheduled happens
let offline = false;

function graph(c: BaseAudioContext, dest: AudioNode): Graph {
  const out = c.createGain();
  out.gain.value = muted && !offline ? 0 : 0.9;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  out.connect(comp).connect(dest);
  // A small room: a second of decaying noise, a little darker each moment.
  const len = Math.floor(c.sampleRate * 1.1);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      lp += ((Math.random() * 2 - 1) - lp) * (0.6 - k * 0.45);
      d[i] = lp * (1 - k) ** 3;
    }
  }
  const verb = c.createConvolver();
  verb.buffer = ir;
  const wet = c.createGain();
  wet.gain.value = 0.22;
  wet.connect(verb).connect(out);
  const noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  // The rolling bed runs all the time; its volume follows the ball.
  const src = c.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 300;
  filter.Q.value = 0.7;
  const gain = c.createGain();
  gain.gain.value = 0;
  src.connect(filter).connect(gain).connect(out);
  src.start();
  return { out, wet, roll: { gain, filter }, noise };
}

function audio(): AudioContext | null {
  if (ctx && !offline) return ctx as AudioContext;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const c = new AC();
  ctx = c;
  g = graph(c, c.destination);
  // Plays with the ringer off, like the rest of the app's default ("Play on silent").
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) nav.audioSession.type = "playback";
  return c;
}

// Every tap: make sure the context exists and is running.
export function unlock() {
  if (offline) return;
  const c = audio();
  if (!c || c.state === "running") return;
  const silent = c.createBufferSource();
  silent.buffer = c.createBuffer(1, 1, c.sampleRate);
  silent.connect(c.destination);
  silent.start();
  void c.resume().catch(() => {});
}
let listening = false;
export function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  for (const type of ["touchend", "click", "keydown", "pointerdown"]) window.addEventListener(type, unlock, { capture: true, passive: true });
}

export function setMuted(m: boolean) {
  muted = m;
  if (ctx && g && !offline) g.out.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;
// Leaving the game: the ball's not rolling any more.
export function stop() {
  rolling(0, null);
}

type Name = "putt" | "knock" | "bump" | "plunk" | "drop" | "blast" | "whoosh" | "land" | "pickup" | "brake" | "lip" | "rolling";
function rec(name: Name, args: unknown[]) {
  if (offline) return;
  const log = (window as unknown as { __golfSounds?: unknown[] }).__golfSounds;
  if (Array.isArray(log)) log.push({ name, args, t: performance.now() });
}
function live(): BaseAudioContext | null {
  if (offline) return ctx;
  return ctx && (ctx as AudioContext).state === "running" && !muted ? ctx : null;
}
const now = (c: BaseAudioContext) => at ?? c.currentTime;

function burst(c: BaseAudioContext, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, level: number, sweepTo?: number, send = 0.5) {
  const src = c.createBufferSource();
  src.buffer = g!.noise;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const v = c.createGain();
  v.gain.setValueAtTime(0, t);
  v.gain.linearRampToValueAtTime(level, t + 0.004);
  v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(v).connect(g!.out);
  if (send) v.connect(sendTo(c, send));
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

function tone(c: BaseAudioContext, t: number, freq: number, dur: number, level: number, to?: number, send = 0.5, attack = 0.006) {
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const v = c.createGain();
  v.gain.setValueAtTime(0, t);
  v.gain.linearRampToValueAtTime(level, t + attack);
  v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(v).connect(g!.out);
  if (send) v.connect(sendTo(c, send));
  o.start(t);
  o.stop(t + dur + 0.05);
}
function sendTo(c: BaseAudioContext, level: number) {
  const s = c.createGain();
  s.gain.value = level;
  s.connect(g!.wet);
  return s;
}

// The putter meeting the ball: a woody tock, firmer the harder it's hit.
export function putt(power: number) {
  rec("putt", [power]);
  const c = live();
  if (!c) return;
  const t = now(c);
  const p = 0.4 + power * 0.6;
  burst(c, t, 0.035, "bandpass", 1800, 1.2, 0.35 * p, undefined, 0.3);
  tone(c, t, 820, 0.06, 0.3 * p, 560, 0.4);
  tone(c, t, 260, 0.12, 0.28 * p, 200, 0.4);
}

// Off a rail: a soft wooden knock.
export function knock(power: number) {
  if (power < 0.04) return;
  rec("knock", [power]);
  const c = live();
  if (!c) return;
  const t = now(c);
  const p = Math.min(1, power * 2.2);
  tone(c, t, 300 + Math.random() * 30, 0.1, 0.26 * p, 220, 0.5);
  tone(c, t, 610, 0.04, 0.07 * p, undefined, 0.3);
  burst(c, t, 0.03, "bandpass", 1300, 1.6, 0.18 * p, undefined, 0.3);
}

// A rubber bumper: a round, low boing.
export function bump() {
  rec("bump", []);
  const c = live();
  if (!c) return;
  const t = now(c);
  tone(c, t, 196, 0.32, 0.34, 150, 0.6, 0.004);
  tone(c, t, 392, 0.16, 0.12, 300, 0.6, 0.004);
  burst(c, t, 0.05, "lowpass", 700, 0.7, 0.2, undefined, 0.3);
}

// Into the cup: a rattle round the rim, a soft thud at the bottom, and a little rising chime.
export function plunk() {
  rec("plunk", []);
  const c = live();
  if (!c) return;
  const t = now(c);
  [0, 0.06, 0.11].forEach((d, i) => burst(c, t + d, 0.03, "bandpass", 2400 - i * 300, 2.5, 0.2 - i * 0.05, undefined, 0.3));
  tone(c, t + 0.16, 140, 0.28, 0.45, 80, 0.3);
  burst(c, t + 0.16, 0.1, "lowpass", 500, 0.7, 0.25, undefined, 0.2);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, t + 0.32 + i * 0.075, f, 0.6, 0.09, undefined, 0.9, 0.01));
}

// Off the edge: it falls away into the void.
export function drop() {
  rec("drop", []);
  const c = live();
  if (!c) return;
  const t = now(c);
  tone(c, t, 440, 0.45, 0.16, 120, 0.8, 0.02);
  burst(c, t, 0.4, "bandpass", 900, 1, 0.08, 250, 0.6);
}

// An Orbital Laser or a mine going off: a low thump under a dark rush.
export function blast(power = 1) {
  rec("blast", [power]);
  const c = live();
  if (!c) return;
  const t = now(c);
  tone(c, t, 110, 0.45, 0.5 * power, 40, 0.5, 0.003);
  burst(c, t, 0.6, "lowpass", 1800, 0.8, 0.4 * power, 160, 0.7);
}

export function whoosh() {
  rec("whoosh", []);
  const c = live();
  if (!c) return;
  burst(c, now(c), 0.4, "bandpass", 450, 0.9, 0.16, 1500, 0.6);
}

// Coming down from a jump.
export function land(power: number) {
  if (power <= 0.1) return;
  rec("land", [power]);
  const c = live();
  if (!c) return;
  const t = now(c);
  tone(c, t, 130, 0.14, 0.32 * power, 80, 0.3);
  burst(c, t, 0.06, "lowpass", 800, 0.7, 0.2 * power, undefined, 0.3);
}

// A box opening, or an item used: three soft notes going up.
export function pickup() {
  rec("pickup", []);
  const c = live();
  if (!c) return;
  const t = now(c);
  [587.33, 739.99, 880].forEach((f, i) => tone(c, t + i * 0.06, f, 0.35, 0.11, undefined, 0.9, 0.008));
}

// The Brake: a short scuff.
export function brake() {
  rec("brake", []);
  const c = live();
  if (!c) return;
  burst(c, now(c), 0.18, "bandpass", 1400, 1.2, 0.18, 500, 0.3);
}

// Round the rim and out.
export function lip() {
  rec("lip", []);
  const c = live();
  if (!c) return;
  const t = now(c);
  [0, 0.05].forEach((d) => burst(c, t + d, 0.03, "bandpass", 2600, 2.5, 0.16, undefined, 0.3));
}

// Called every frame with the ball's speed and what it's on.
let lastRoll = -1;
export function rolling(speed: number, ground: Ground | null) {
  const s = ground ? Math.min(1, speed / 22) : 0;
  const rough = ground === "sand" ? 2.4 : ground === "bridge" ? 1.6 : 1;
  const level = s ** 1.2 * 0.2 * (ground === "sand" ? 1.6 : 1);
  if (level === 0 && lastRoll === 0 && !offline) return;
  lastRoll = level;
  rec("rolling", [speed, ground]);
  if (!ctx || !g) return;
  const t = now(ctx);
  g.roll.gain.gain.setTargetAtTime(level, t, 0.04);
  g.roll.filter.frequency.setTargetAtTime(180 + s * 900 * rough, t, 0.05);
}

const PLAY: Record<Name, (...a: never[]) => void> = { putt, knock, bump, plunk, drop, blast, whoosh, land, pickup, brake, lip, rolling };

// Renders a log of sounds (from `window.__golfSounds`) into a buffer, `t0` being the log time (ms)
// at which the buffer starts.
export async function renderOffline(log: { name: Name; args: unknown[]; t: number }[], t0: number, seconds: number): Promise<AudioBuffer> {
  const rate = 44100;
  const oc = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const saved = { ctx, g };
  offline = true;
  ctx = oc;
  g = graph(oc, oc.destination);
  try {
    for (const e of log) {
      const s = (e.t - t0) / 1000;
      if (s < 0 || s > seconds) continue;
      at = s;
      (PLAY[e.name] as (...a: unknown[]) => void)(...e.args);
    }
  } finally {
    at = null;
    offline = false;
    ctx = saved.ctx;
    g = saved.g;
  }
  return oc.startRendering();
}
