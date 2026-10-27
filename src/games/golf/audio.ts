import type { Ground } from "./engine";

// Golf's own sounds, synthesized like the rest of the app's: the putt, wood knocks off the walls, the
// ball rolling (a filtered hiss that follows its speed and what it's rolling on), the cup, splashes, and
// a little outdoors around it all: birds by day, crickets at night.

let ctx: AudioContext | null = null;
let out: GainNode;
let roll: { gain: GainNode; filter: BiquadFilterNode } | null = null;
let noise: AudioBuffer;
let muted = false;
let ambience = 0;
let night = 0;

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    out.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // The rolling bed runs all the time; its volume follows the ball.
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 300;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(out);
    src.start();
    roll = { gain, filter };
    ambience = window.setInterval(outdoors, 400);
  }
  if (ctx.state !== "running") void ctx.resume();
}

export function setMuted(m: boolean) {
  muted = m;
  if (ctx) out.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;
export function setNight(n: number) {
  night = n;
}
export function stop() {
  if (ambience) clearInterval(ambience);
  ambience = 0;
  void ctx?.close();
  ctx = null;
  roll = null;
}

const live = () => (ctx && ctx.state === "running" && !muted ? ctx : null);

function burst(c: AudioContext, at: number, dur: number, type: BiquadFilterType, freq: number, q: number, level: number, sweepTo?: number) {
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, at);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(out);
  src.start(at, Math.random() * 1.5);
  src.stop(at + dur + 0.05);
}

function tone(c: AudioContext, at: number, freq: number, dur: number, level: number, type: OscillatorType = "sine", to?: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

// The putter meeting the ball: a woody tock, firmer the harder it's hit.
export function putt(power: number) {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  const p = 0.35 + power * 0.65;
  burst(c, t, 0.05, "bandpass", 2400, 1.4, 0.5 * p);
  tone(c, t, 1150, 0.07, 0.35 * p, "sine", 700);
  tone(c, t, 420, 0.09, 0.2 * p, "triangle", 300);
}

export function knock(power: number) {
  const c = live();
  if (!c || power < 0.04) return;
  const t = c.currentTime;
  const p = Math.min(1, power * 2.2);
  tone(c, t, 330 + Math.random() * 40, 0.12, 0.32 * p, "sine", 240);
  tone(c, t, 760, 0.05, 0.12 * p, "triangle");
  burst(c, t, 0.04, "bandpass", 1600, 2, 0.25 * p);
}

export function bump() {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  tone(c, t, 520, 0.18, 0.25, "sine", 380);
  tone(c, t, 1040, 0.08, 0.1, "sine");
}

// Into the cup: a rattle round the rim and a soft thud at the bottom.
export function plunk() {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  [0, 0.07, 0.13].forEach((d, i) => burst(c, t + d, 0.03, "bandpass", 3200 - i * 400, 3, 0.3 - i * 0.07));
  tone(c, t + 0.18, 160, 0.25, 0.5, "sine", 90);
  burst(c, t + 0.18, 0.12, "lowpass", 600, 0.7, 0.3);
}

export function splash() {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  burst(c, t, 0.7, "lowpass", 3500, 0.8, 0.45, 300);
  tone(c, t, 300, 0.25, 0.2, "sine", 120);
}

export function whoosh() {
  const c = live();
  if (!c) return;
  burst(c, c.currentTime, 0.5, "bandpass", 500, 0.8, 0.25, 1800);
}

export function land(power: number) {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  tone(c, t, 140, 0.15, 0.4 * power, "sine", 80);
  burst(c, t, 0.08, "lowpass", 900, 0.7, 0.3 * power);
}

export function pickup() {
  const c = live();
  if (!c) return;
  const t = c.currentTime;
  [784, 988, 1319].forEach((f, i) => tone(c, t + i * 0.06, f, 0.25, 0.16, "triangle"));
}

// Called every frame with the ball's speed and what it's on.
export function rolling(speed: number, ground: Ground | null) {
  if (!ctx || !roll) return;
  const t = ctx.currentTime;
  const s = ground ? Math.min(1, speed / 22) : 0;
  const rough = ground === "sand" ? 2.4 : ground === "bridge" ? 1.6 : 1;
  roll.gain.gain.setTargetAtTime(s ** 1.2 * 0.22 * (ground === "sand" ? 1.6 : 1), t, 0.04);
  roll.filter.frequency.setTargetAtTime(180 + s * 900 * rough, t, 0.05);
}

// Birds when it's light, crickets when it's dark.
function outdoors() {
  const c = live();
  if (!c) return;
  const t = c.currentTime + Math.random() * 0.3;
  if (night < 0.5) {
    if (Math.random() < 0.18 * (1 - night)) {
      const base = 2600 + Math.random() * 1600;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) tone(c, t + i * 0.11, base * (1 + (i % 2) * 0.12), 0.08, 0.035, "sine", base * 1.35);
    }
  } else if (Math.random() < 0.6 * night) {
    const f = 4200 + Math.random() * 500;
    for (let i = 0; i < 3; i++) tone(c, t + i * 0.045, f, 0.03, 0.02, "sine");
  }
}
