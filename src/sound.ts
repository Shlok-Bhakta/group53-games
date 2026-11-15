import { useSyncExternalStore } from "react";
import song531 from "@/assets/music/53_1.m4a";

export const SFX_PACKS = [
  { value: "wood", label: "Wood", about: "Wooden tiles and marimba" },
  { value: "keys", label: "Thock", about: "A deep mechanical keyboard and electric piano" },
  { value: "kalimba", label: "Kalimba", about: "Plucked metal tines, warm and round" },
  { value: "felt", label: "Felt piano", about: "A muted, cozy upright" },
  { value: "glass", label: "Glass", about: "Clinks and bright bells" },
  { value: "bubble", label: "Bubbles", about: "Water drops and bloops" },
  { value: "soft", label: "Soft", about: "Round blips and gentle tones" },
  { value: "arcade", label: "Arcade", about: "Square-wave blips" },
  { value: "off", label: "Off", about: "No sound effects" },
] as const;
export const MUSIC_TRACKS = [
  { value: "53_1", label: "53_1", about: "By Alex" },
  { value: "off", label: "Off", about: "No music" },
] as const;
export type SfxPack = (typeof SFX_PACKS)[number]["value"];
export type MusicTrack = (typeof MUSIC_TRACKS)[number]["value"];
type Song = Exclude<MusicTrack, "off">;
type SoundSettings = { sfx: SfxPack; music: MusicTrack; volume: number; onSilent: boolean };

const KEY = "sound";
const DEFAULTS: SoundSettings = { sfx: "wood", music: "53_1", volume: 0.6, onSilent: true };
let settings: SoundSettings = (() => {
  try {
    const saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") } as SoundSettings;
    if (!SFX_PACKS.some((p) => p.value === saved.sfx)) saved.sfx = DEFAULTS.sfx;
    if (!MUSIC_TRACKS.some((t) => t.value === saved.music)) saved.music = DEFAULTS.music;
    if (typeof saved.volume !== "number" || !(saved.volume >= 0 && saved.volume <= 1)) saved.volume = DEFAULTS.volume;
    return saved;
  } catch {
    return DEFAULTS;
  }
})();
const listeners = new Set<() => void>();
export function setSound(next: Partial<SoundSettings>) {
  settings = { ...settings, ...next };
  localStorage.setItem(KEY, JSON.stringify(settings));
  listeners.forEach((l) => l());
  applySession();
  music.refresh();
}
export function useSoundSettings() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => settings,
  );
}

type Ctx = BaseAudioContext;
type Graph = { sfx: GainNode; music: GainNode; sfxIn: Map<string, AudioNode>; musicIn: Map<string, AudioNode>; verb: AudioNode };
const graphs = new WeakMap<Ctx, Graph>();

function graphFor(c: Ctx): Graph {
  let g = graphs.get(c);
  if (g) return g;
  const master = c.createDynamicsCompressor();
  master.threshold.value = -14;
  master.ratio.value = 4;
  master.connect(c.destination);
  const verb = c.createConvolver();
  verb.buffer = roomImpulse(c);
  const verbOut = c.createGain();
  verbOut.gain.value = 0.9;
  verb.connect(verbOut).connect(master);
  const sfx = c.createGain();
  sfx.gain.value = 0.7;
  sfx.connect(master);
  const musicBus = c.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(master);
  g = { sfx, music: musicBus, sfxIn: new Map(), musicIn: new Map(), verb };
  graphs.set(c, g);
  return g;
}

function roomImpulse(c: Ctx) {
  const len = Math.floor(c.sampleRate * 2.4);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = 0.35 + 0.6 * t;
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * (1 - t) ** 2.6 * 2.2;
    }
  }
  return buf;
}

function input(c: Ctx, kind: "sfx" | "music", id: string, wet: number) {
  const g = graphFor(c);
  const map = kind === "sfx" ? g.sfxIn : g.musicIn;
  let n = map.get(id);
  if (!n) {
    const node = c.createGain();
    node.connect(kind === "sfx" ? g.sfx : g.music);
    const send = c.createGain();
    send.gain.value = wet;
    node.connect(send).connect(g.verb);
    map.set(id, (n = node));
  }
  return n;
}

let ctx: AudioContext | null = null;
// platform: iOS can leave an AudioContext "running" with its clock stopped after the app was in the background or another app took the audio; the next tap replaces it.
let broken = false;
let rebuilds = 0;

function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  applySession();
  const c = new AC();
  ctx = c;
  broken = false;
  graphFor(c);
  c.onstatechange = () => {
    if (c !== ctx) return;
    music.refresh();
    sync();
  };
  return c;
}

function applySession() {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) nav.audioSession.type = settings.onSilent ? "playback" : "ambient";
}

function rebuild() {
  const old = ctx;
  music.reset();
  ctx = null;
  rebuilds++;
  if (old) {
    old.onstatechange = null;
    void old.close().catch(() => {});
  }
  return audio();
}

// platform: iOS unlocks audio only from a whole tap (touchend or click), and only once a sound actually starts in that tap, so a silent buffer plays.
function wake() {
  const c = broken ? rebuild() : audio();
  if (!c) return null;
  if (c.state !== "running") {
    applySession();
    const silent = c.createBufferSource();
    silent.buffer = c.createBuffer(1, 1, c.sampleRate);
    silent.connect(c.destination);
    silent.start();
    void c
      .resume()
      .then(() => music.refresh())
      .catch(() => {});
  }
  return c;
}

let settling = false;
function sync() {
  const c = ctx;
  if (!c || settling || c.state === "closed") return;
  const want = !document.hidden;
  if (want === (c.state === "running")) return;
  settling = true;
  (want ? c.resume() : c.suspend())
    .catch(() => {})
    .finally(() => {
      settling = false;
      if (c !== ctx) return;
      // platform: iOS won't resume a context without a tap, and a bad one needs replacing.
      if (want && !document.hidden && c.state !== "running") broken = true;
      else sync();
    });
}

let lastClock = { audio: 0, wall: 0 };
function watch() {
  const c = ctx;
  if (!c || document.hidden || c.state !== "running") {
    lastClock = { audio: 0, wall: 0 };
    return;
  }
  const now = performance.now();
  if (lastClock.wall && now - lastClock.wall > 900 && c.currentTime - lastClock.audio < 0.05) broken = true;
  lastClock = { audio: c.currentTime, wall: now };
}

if (typeof window !== "undefined") {
  for (const type of ["touchend", "click", "keydown", "pointerdown"]) window.addEventListener(type, wake, { capture: true, passive: true });
  const back = () => {
    lastClock = { audio: 0, wall: 0 };
    sync();
  };
  document.addEventListener("visibilitychange", back);
  window.addEventListener("pageshow", back);
  window.addEventListener("focus", back);
  window.setInterval(watch, 1000);
  (window as unknown as { __audio?: unknown }).__audio = {
    state: () => ctx?.state ?? "none",
    rebuilds: () => rebuilds,
    musicGain: () => (ctx ? graphFor(ctx).music.gain.value : 0),
    break: () => {
      broken = true;
    },
  };
}

const noiseBuffers = new WeakMap<Ctx, AudioBuffer>();
function noise(c: Ctx) {
  let b = noiseBuffers.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(c, b);
  }
  return b;
}

type Env = { at: number; dur: number; gain: number; attack?: number; out: AudioNode };
function envelope(c: Ctx, { at, dur, gain, attack = 0.003 }: Env) {
  const g = c.createGain();
  // platform: Web Audio holds a gain at 1 until its first event, and rounding can start the source a sample early, which pops.
  g.gain.value = 0.0001;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  return g;
}
function osc(c: Ctx, type: OscillatorType, freq: number, env: Env, freqEnd?: number, detune = 0) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, env.at);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, env.at + env.dur);
  o.detune.value = detune;
  const g = envelope(c, env);
  o.connect(g).connect(env.out);
  o.start(env.at);
  o.stop(env.at + env.dur + 0.05);
}
function filtered(c: Ctx, type: OscillatorType, freq: number, cutoff: number, env: Env, detune = 0) {
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = cutoff;
  f.connect(env.out);
  osc(c, type, freq, { ...env, out: f }, undefined, detune);
}
function burst(c: Ctx, filter: BiquadFilterType, freq: number, q: number, env: Env) {
  const s = c.createBufferSource();
  s.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = envelope(c, env);
  s.connect(f).connect(g).connect(env.out);
  s.start(env.at, Math.random() * 1.5);
  s.stop(env.at + env.dur + 0.05);
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const PENTA = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];

type Voice = {
  wet: number;
  click: (c: Ctx, o: AudioNode, at: number, pitch: number, gain: number) => void;
  note: (c: Ctx, o: AudioNode, at: number, midi: number, gain: number, dur?: number) => void;
  thump: (c: Ctx, o: AudioNode, at: number, gain: number) => void;
};
const VOICES: Record<Exclude<SfxPack, "off">, Voice> = {
  wood: {
    wet: 0.12,
    click: (c, o, at, pitch, gain) => {
      burst(c, "bandpass", 1400 * pitch, 5, { at, dur: 0.045, gain: gain * 0.9, out: o });
      osc(c, "sine", 700 * pitch, { at, dur: 0.035, gain: gain * 0.35, out: o });
    },
    note: (c, o, at, midi, gain, dur = 0.5) => {
      osc(c, "sine", hz(midi), { at, dur, gain: gain * 0.5, out: o });
      osc(c, "sine", hz(midi) * 4, { at, dur: dur * 0.25, gain: gain * 0.12, out: o });
      burst(c, "bandpass", hz(midi) * 2, 8, { at, dur: 0.02, gain: gain * 0.15, out: o });
    },
    thump: (c, o, at, gain) => osc(c, "sine", 190, { at, dur: 0.09, gain: gain * 0.6, out: o }, 95),
  },
  keys: {
    wet: 0.1,
    click: (c, o, at, pitch, gain) => {
      burst(c, "highpass", 3800 * pitch, 0.7, { at, dur: 0.012, gain: gain * 0.25, out: o });
      burst(c, "bandpass", 520 * pitch, 2.5, { at: at + 0.004, dur: 0.05, gain: gain * 1.1, out: o });
      osc(c, "sine", 320 * pitch, { at: at + 0.004, dur: 0.04, gain: gain * 0.3, out: o }, 190 * pitch);
    },
    note: (c, o, at, midi, gain, dur = 0.9) => {
      osc(c, "sine", hz(midi), { at, dur, gain: gain * 0.42, attack: 0.004, out: o });
      osc(c, "sine", hz(midi) * 2, { at, dur: dur * 0.5, gain: gain * 0.08, out: o });
      osc(c, "sine", hz(midi) * 7, { at, dur: 0.12, gain: gain * 0.05, out: o });
    },
    thump: (c, o, at, gain) => {
      osc(c, "sine", 150, { at, dur: 0.1, gain: gain * 0.55, out: o }, 70);
      burst(c, "lowpass", 420, 0.8, { at, dur: 0.06, gain: gain * 0.5, out: o });
    },
  },
  kalimba: {
    wet: 0.28,
    click: (c, o, at, pitch, gain) => {
      osc(c, "sine", 1800 * pitch, { at, dur: 0.05, gain: gain * 0.35, out: o });
      burst(c, "bandpass", 3200 * pitch, 6, { at, dur: 0.012, gain: gain * 0.25, out: o });
    },
    note: (c, o, at, midi, gain, dur = 1.3) => {
      osc(c, "sine", hz(midi), { at, dur, gain: gain * 0.45, attack: 0.002, out: o });
      osc(c, "sine", hz(midi) * 6.27, { at, dur: 0.18, gain: gain * 0.07, out: o });
      burst(c, "bandpass", hz(midi) * 3, 10, { at, dur: 0.015, gain: gain * 0.12, out: o });
    },
    thump: (c, o, at, gain) => osc(c, "sine", 230, { at, dur: 0.14, gain: gain * 0.4, out: o }, 170),
  },
  felt: {
    wet: 0.3,
    click: (c, o, at, pitch, gain) => {
      burst(c, "lowpass", 900 * pitch, 0.7, { at, dur: 0.035, gain: gain * 0.8, out: o });
      osc(c, "sine", 480 * pitch, { at, dur: 0.05, gain: gain * 0.25, out: o });
    },
    note: (c, o, at, midi, gain, dur = 1.5) => {
      filtered(c, "triangle", hz(midi), 1400, { at, dur, gain: gain * 0.5, attack: 0.006, out: o });
      filtered(c, "sawtooth", hz(midi), 900, { at, dur: dur * 0.6, gain: gain * 0.08, attack: 0.006, out: o }, 4);
      burst(c, "lowpass", 700, 0.7, { at, dur: 0.03, gain: gain * 0.15, out: o });
    },
    thump: (c, o, at, gain) => osc(c, "sine", 115, { at, dur: 0.14, gain: gain * 0.5, attack: 0.006, out: o }, 80),
  },
  glass: {
    wet: 0.42,
    click: (c, o, at, pitch, gain) => {
      osc(c, "sine", 3100 * pitch, { at, dur: 0.07, gain: gain * 0.22, out: o });
      osc(c, "sine", 4350 * pitch, { at, dur: 0.05, gain: gain * 0.12, out: o });
    },
    note: (c, o, at, midi, gain, dur = 1.8) => {
      [1, 2.76, 5.4, 8.93].forEach((p, i) =>
        osc(c, "sine", hz(midi) * p, { at, dur: dur / (1 + i * 0.8), gain: (gain * 0.36) / (1 + i * 1.4), out: o }),
      );
    },
    thump: (c, o, at, gain) => osc(c, "sine", 880, { at, dur: 0.09, gain: gain * 0.2, out: o }, 760),
  },
  bubble: {
    wet: 0.22,
    click: (c, o, at, pitch, gain) => osc(c, "sine", 420 * pitch, { at, dur: 0.06, gain: gain * 0.5, out: o }, 1300 * pitch),
    note: (c, o, at, midi, gain, dur = 0.5) => {
      osc(c, "sine", hz(midi) * 0.85, { at, dur: 0.05, gain: gain * 0.35, out: o }, hz(midi));
      osc(c, "sine", hz(midi), { at: at + 0.04, dur, gain: gain * 0.4, out: o });
    },
    thump: (c, o, at, gain) => osc(c, "sine", 260, { at, dur: 0.12, gain: gain * 0.5, out: o }, 110),
  },
  soft: {
    wet: 0.2,
    click: (c, o, at, pitch, gain) => osc(c, "sine", 900 * pitch, { at, dur: 0.06, gain: gain * 0.45, out: o }, 600 * pitch),
    note: (c, o, at, midi, gain, dur = 0.8) => {
      osc(c, "triangle", hz(midi), { at, dur, gain: gain * 0.35, attack: 0.01, out: o });
      osc(c, "sine", hz(midi) * 2.76, { at, dur: dur * 0.5, gain: gain * 0.08, out: o });
    },
    thump: (c, o, at, gain) => osc(c, "sine", 140, { at, dur: 0.12, gain: gain * 0.4, attack: 0.008, out: o }, 90),
  },
  arcade: {
    wet: 0.05,
    click: (c, o, at, pitch, gain) => osc(c, "square", 1100 * pitch, { at, dur: 0.035, gain: gain * 0.12, out: o }, 1600 * pitch),
    note: (c, o, at, midi, gain, dur = 0.22) => {
      osc(c, "square", hz(midi), { at, dur, gain: gain * 0.12, out: o });
      osc(c, "square", hz(midi + 12), { at: at + 0.04, dur: dur * 0.6, gain: gain * 0.05, out: o });
    },
    thump: (c, o, at, gain) => burst(c, "highpass", 1500, 1, { at, dur: 0.06, gain: gain * 0.35, out: o }),
  },
};

type SfxName =
  | "pick"
  | "place"
  | "recall"
  | "shuffle"
  | "play"
  | "bingo"
  | "invalid"
  | "turn"
  | "ghost"
  | "land"
  | "tick"
  | "win"
  | "lose"
  | "preview"
  | "deal"
  | "flip"
  | "chips"
  | "knock"
  | "sweep"
  | "slam"
  | "payout";
type SfxOpts = { count?: number; score?: number; live?: boolean };

function render(c: Ctx, pack: Exclude<SfxPack, "off">, name: SfxName, opts: SfxOpts, t: number) {
  const v = VOICES[pack];
  const o = input(c, "sfx", pack, v.wet);
  const n = Math.max(1, Math.min(9, opts.count ?? 1));
  switch (name) {
    case "pick":
      return v.click(c, o, t, 1.25, 0.5);
    case "place":
      v.click(c, o, t, 1, 0.8);
      return v.thump(c, o, t, 0.7);
    case "recall":
      v.click(c, o, t, 1.1, 0.5);
      return v.click(c, o, t + 0.05, 0.85, 0.4);
    case "shuffle":
      for (let i = 0; i < 6; i++) v.click(c, o, t + i * 0.04, 0.8 + Math.random() * 0.6, 0.35);
      return;
    case "play": {
      for (let i = 0; i < n; i++) v.note(c, o, t + i * 0.07, PENTA[i], 0.7);
      v.thump(c, o, t, 0.6);
      if ((opts.score ?? 0) >= 20) [0, 2, 4].forEach((k) => v.note(c, o, t + n * 0.07 + 0.05, PENTA[k + 3], 0.4, 0.9));
      return;
    }
    case "bingo":
      for (let i = 0; i < 10; i++) v.note(c, o, t + i * 0.05, PENTA[i], 0.6, 0.4);
      [0, 2, 4, 5].forEach((k) => v.note(c, o, t + 0.6, PENTA[k + 2], 0.45, 1.4));
      return;
    case "invalid":
      v.note(c, o, t, 60, 0.5, 0.18);
      v.note(c, o, t + 0.11, 56, 0.5, 0.25);
      return;
    case "turn":
      v.note(c, o, t, 88, 0.55, 0.9);
      return v.note(c, o, t + 0.12, 95, 0.45, 1.1);
    case "ghost":
      return v.click(c, o, t, 0.6, 0.18);
    case "land":
      for (let i = 0; i < n; i++) v.click(c, o, t + i * 0.06, 0.95, 0.5);
      return v.thump(c, o, t + n * 0.06, 0.4);
    case "tick":
      return v.click(c, o, t, 1.6, 0.3);
    case "deal":
      return v.click(c, o, t, 1.15 + n * 0.03, 0.6);
    case "flip":
      v.click(c, o, t, 1.2, 0.5);
      return v.note(c, o, t + 0.02, PENTA[n + 2], 0.45, 0.5);
    case "chips":
      for (let i = 0; i < Math.min(n, 4); i++) v.click(c, o, t + i * 0.045, 1.4, 0.45);
      return v.thump(c, o, t + 0.02, 0.28);
    case "knock":
      v.thump(c, o, t, 0.42);
      v.click(c, o, t, 0.6, 0.4);
      v.thump(c, o, t + 0.13, 0.36);
      return v.click(c, o, t + 0.13, 0.55, 0.32);
    case "sweep":
      for (let i = 0; i < 6; i++) v.click(c, o, t + i * 0.035, 1.1 + i * 0.1, 0.32);
      return v.thump(c, o, t + 0.22, 0.35);
    case "slam":
      v.thump(c, o, t, 0.6);
      v.thump(c, o, t + 0.05, 0.4);
      v.note(c, o, t + 0.03, 55, 0.34, 0.9);
      return v.note(c, o, t + 0.03, 62, 0.22, 0.9);
    case "payout":
      for (let i = 0; i < Math.min(3 + n, 8); i++) {
        v.note(c, o, t + i * 0.075, PENTA[i], 0.5, 0.5);
        v.click(c, o, t + i * 0.075, 1.5, 0.2);
      }
      return;
    case "win":
      [72, 76, 79, 84, 88].forEach((m, i) => v.note(c, o, t + i * 0.09, m, 0.6, 0.8));
      [79, 84, 88].forEach((m) => v.note(c, o, t + 0.55, m, 0.4, 1.6));
      return;
    case "lose":
      [76, 72, 69, 64].forEach((m, i) => v.note(c, o, t + i * 0.16, m, 0.45, 0.7));
      return;
    case "preview": {
      v.click(c, o, t, 1.25, 0.5);
      for (let i = 0; i < 3; i++) {
        v.click(c, o, t + 0.22 + i * 0.16, 1, 0.8);
        v.thump(c, o, t + 0.22 + i * 0.16, 0.6);
      }
      const at = t + 0.85;
      for (let i = 0; i < 4; i++) v.note(c, o, at + i * 0.07, PENTA[i], 0.7);
      [0, 2, 4].forEach((k) => v.note(c, o, at + 0.35, PENTA[k + 3], 0.45, 1));
      return;
    }
  }
}

export function sfx(name: SfxName, opts: SfxOpts = {}) {
  (window as unknown as { __sfx?: string[] }).__sfx?.push(name);
  const pack = settings.sfx;
  if (pack === "off") return;
  const c = wake();
  if (!c) return;
  if (c.state !== "running") {
    if (opts.live) return;
    void c
      .resume()
      .then(() => c.state === "running" && sfx(name, opts))
      .catch(() => {});
    return;
  }
  render(c, pack, name, opts, c.currentTime + 0.005);
}

// platform: AAC's first frame is its roughest and Chrome cuts a file 34 samples short, so the file carries `WRAP` samples of the loop past each end.
type Recording = { src: string; seconds: number; volume: number };
const WRAP = 2048;
const RECORDINGS = {
  "53_1": { src: song531, seconds: 4948363 / 44100, volume: 0.3 },
} satisfies Record<Song, Recording>;

const fetched = new Map<string, Promise<ArrayBuffer>>();
const decoded = new WeakMap<Ctx, Map<string, Promise<AudioBuffer>>>();
function loadRecording(c: Ctx, src: string) {
  let bytes = fetched.get(src);
  if (!bytes) {
    bytes = fetch(src).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} for ${src}`))));
    fetched.set(src, bytes);
    bytes.catch(() => fetched.delete(src));
  }
  let mine = decoded.get(c);
  if (!mine) decoded.set(c, (mine = new Map()));
  let buf = mine.get(src);
  if (!buf) {
    // platform: decodeAudioData detaches the buffer it's given.
    buf = bytes.then((b) => c.decodeAudioData(b.slice(0)));
    mine.set(src, buf);
    buf.catch(() => mine.delete(src));
  }
  return buf;
}
// platform: AAC opens with 1024 frames of encoder delay that some decoders leave in, so the loop starts after it.
function playRecording(c: Ctx, rec: Recording, buf: AudioBuffer, out: AudioNode, at: number, fadeIn = 0) {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  const untrimmed = buf.duration - (rec.seconds + (2 * WRAP) / 44100) > 512 / 44100;
  s.loopStart = (WRAP + (untrimmed ? 1024 : 0)) / 44100;
  s.loopEnd = s.loopStart + rec.seconds;
  const fade = c.createGain();
  if (fadeIn > 0) {
    fade.gain.setValueAtTime(0, at);
    fade.gain.setTargetAtTime(1, at, fadeIn / 3);
  }
  s.connect(fade).connect(out);
  s.start(at, s.loopStart);
  return s;
}

const loudness = (volume: number) => (volume / DEFAULTS.volume) ** 2;
const musicGain = (rec: Recording, volume: number) => 0.5 * rec.volume * loudness(volume);

const music = (() => {
  let wanted = false;
  let playing: MusicTrack = "off";
  let source: AudioScheduledSourceNode | null = null;
  let gen = 0;

  function reset() {
    gen++;
    const old = source;
    source = null;
    try {
      old?.stop();
    } catch {
      // platform: older WebKit throws when a source that already stopped is stopped again.
    }
    playing = "off";
  }
  function stop() {
    if (!ctx || playing === "off") return;
    gen++;
    const g = graphFor(ctx).music.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(0, ctx.currentTime, 0.3);
    const old = source;
    source = null;
    window.setTimeout(() => old?.stop(), 1500);
    playing = "off";
  }
  function start(id: Song) {
    const c = audio();
    if (!c || c.state !== "running") return;
    stop();
    const rec: Recording = RECORDINGS[id];
    const g = graphFor(c);
    const out = input(c, "music", id, 0);
    playing = id;
    g.music.gain.cancelScheduledValues(c.currentTime);
    g.music.gain.setTargetAtTime(musicGain(rec, settings.volume), c.currentTime, 0.12);
    const mine = ++gen;
    loadRecording(c, rec.src).then(
      (buf) => {
        if (mine !== gen || c !== ctx) return;
        source = playRecording(c, rec, buf, out, c.currentTime + 0.05, 2.5);
      },
      () => {
        if (mine === gen) playing = "off";
      },
    );
  }
  function refresh() {
    const target = wanted ? settings.music : "off";
    if (target !== playing) {
      if (target === "off") stop();
      else start(target);
    } else if (ctx && playing !== "off") {
      const g = graphFor(ctx).music.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setTargetAtTime(musicGain(RECORDINGS[playing], settings.volume), ctx.currentTime, 0.05);
    }
    (window as unknown as { __music?: string }).__music = playing;
  }
  return {
    want(on: boolean) {
      wanted = on;
      refresh();
    },
    refresh,
    reset,
  };
})();

export const wantMusic = (on: boolean) => music.want(on);

async function measure(seconds: number, draw: (c: OfflineAudioContext) => void | Promise<void>) {
  const c = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
  await draw(c);
  const buf = await c.startRendering();
  let peak = 0;
  let sum = 0;
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
    sum += d[i] * d[i];
  }
  return { peak, rms: Math.sqrt(sum / d.length) };
}
if (typeof window !== "undefined") {
  (window as unknown as { __soundLab: unknown }).__soundLab = {
    packs: SFX_PACKS.filter((p) => p.value !== "off").map((p) => p.value),
    tracks: MUSIC_TRACKS.filter((t) => t.value !== "off").map((t) => t.value),
    sfx: (pack: Exclude<SfxPack, "off">, name: SfxName) => measure(2.5, (c) => render(c, pack, name, { count: 4, score: 30 }, 0.05)),
    loop: async (id: Song) => {
      const c = new OfflineAudioContext(2, 44100, 44100);
      const rec: Recording = RECORDINGS[id];
      const s = playRecording(c, rec, await loadRecording(c, rec.src), c.destination, 0);
      const d = s.buffer!.getChannelData(0);
      const a = Math.round(s.loopStart * 44100);
      const b = Math.round(s.loopEnd * 44100);
      const stray = (k: number) => {
        let m = 0;
        for (let i = -512; i < 512; i++) m = Math.max(m, Math.abs(d[a + i] - d[b + k + i]));
        return m;
      };
      let nearby = Infinity;
      for (let k = -40; k <= 40; k++) if (k) nearby = Math.min(nearby, stray(k));
      return { length: s.buffer!.length, loopStart: s.loopStart, loopEnd: s.loopEnd, seconds: rec.seconds, seam: stray(0), nearby };
    },
    music: (id: Song, seconds = 12, volume = DEFAULTS.volume) =>
      measure(seconds, async (c) => {
        const rec: Recording = RECORDINGS[id];
        graphFor(c).music.gain.value = musicGain(rec, volume);
        playRecording(c, rec, await loadRecording(c, rec.src), input(c, "music", id, 0), 0);
      }),
  };
}
