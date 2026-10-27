import { useSyncExternalStore } from "react";

// Sound effects and background music, all synthesized with Web Audio: no files to load or license.
//
// Effects come in packs that share one vocabulary (`sfx("place")`), so swapping packs changes how the
// whole game sounds. Every pack is three voices (a click, a note, a thump) and every sound is built from
// them. Music tracks are generative: chords and patterns scheduled a moment ahead, looping for as long as
// the app is open. Both run through a little room reverb, which is most of what makes synthesized sound
// feel warm instead of thin. Both are chosen on the You tab and remembered on the phone.
//
// iOS: audio only starts from a tap (a whole tap: touchend or click, not the touch going down), so the
// context unlocks on the first one, and again after iOS interrupts it (a call, leaving the app). With
// "Play on silent" on (the default) the audio session is "playback", which plays with the ringer off but
// pauses other audio like Spotify; off, it's "ambient", which mixes with other audio and goes quiet with
// the silent switch.

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
  { value: "lofi", label: "Lo-fi", about: "Dusty keys, a lazy beat and vinyl crackle" },
  { value: "nightcap", label: "Late night", about: "Slow minor lo-fi with a soft rimshot" },
  { value: "sunday", label: "Sunday", about: "Jazzy lo-fi with a walking bass and brushes" },
  { value: "coffee", label: "Coffee shop", about: "Easy bossa nova guitar and shaker" },
  { value: "rain", label: "Rain", about: "Slow pads and piano, rain on the window" },
  { value: "drift", label: "Drift", about: "Ambient, no beat, just floating" },
  { value: "musicbox", label: "Music box", about: "A soft lullaby" },
  { value: "arcade", label: "Arcade", about: "Gentle chiptune" },
  { value: "off", label: "Off", about: "No music" },
] as const;
export type SfxPack = (typeof SFX_PACKS)[number]["value"];
export type MusicTrack = (typeof MUSIC_TRACKS)[number]["value"];
export type SoundSettings = { sfx: SfxPack; music: MusicTrack; lastMusic: Exclude<MusicTrack, "off">; onSilent: boolean };

// --- Settings store ---

const KEY = "sound";
const DEFAULTS: SoundSettings = { sfx: "wood", music: "lofi", lastMusic: "lofi", onSilent: true };
let settings: SoundSettings = (() => {
  try {
    const saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") } as SoundSettings;
    // A pack or track that's since been removed falls back to the default.
    if (!SFX_PACKS.some((p) => p.value === saved.sfx)) saved.sfx = DEFAULTS.sfx;
    if (!MUSIC_TRACKS.some((t) => t.value === saved.music)) saved.music = DEFAULTS.music;
    return saved;
  } catch {
    return DEFAULTS;
  }
})();
const listeners = new Set<() => void>();
export function setSound(next: Partial<SoundSettings>) {
  settings = { ...settings, ...next };
  if (next.music && next.music !== "off") settings.lastMusic = next.music;
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

// --- The audio graph ---

type Ctx = BaseAudioContext;
// Per context, so tests can render the same sounds offline: a master compressor, a reverb, and a bus for
// effects and one for music, each with its own send into the reverb.
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

// A soft room: stereo noise fading out over a couple of seconds, darker as it goes.
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

// Where a pack or track plays into: straight to its bus, plus `wet` of it into the reverb.
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
    // The reverb comes back through the same bus, so the music volume covers it too.
    map.set(id, (n = node));
  }
  return n;
}

let ctx: AudioContext | null = null;
// Set when the context looks dead (iOS can leave one "running" with its clock stopped after the app was
// in the background or another app took the audio). The next tap replaces it with a fresh one.
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
  // Starting, or coming back after iOS interrupted it: pick the music back up, or get it running again.
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

// Throws away a dead context. Music starts again on the new one as soon as it's running.
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

// Gets the context running, from inside a tap. iOS also wants a sound to actually start in that tap
// before it counts the context as unlocked, so a silent one plays.
function wake() {
  const c = broken ? rebuild() : audio();
  if (!c) return null;
  if (c.state !== "running") {
    applySession();
    const silent = c.createBufferSource();
    silent.buffer = c.createBuffer(1, 1, c.sampleRate);
    silent.connect(c.destination);
    silent.start();
    void c.resume().then(() => music.refresh()).catch(() => {});
  }
  return c;
}

// Keeps the context running while the app is on screen and paused while it isn't. Called again whenever a
// suspend or resume settles, so leaving and coming straight back can't strand it in the wrong state.
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
      // Still not running after resuming on screen: iOS wants a tap, and a new context if this one's gone bad.
      if (want && !document.hidden && c.state !== "running") broken = true;
      else sync();
    });
}

// A running context whose clock has stopped makes no sound; notice, so the next tap replaces it.
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
  // For tests: the context's state, and how many times a dead one was replaced.
  (window as unknown as { __audio?: unknown }).__audio = {
    state: () => ctx?.state ?? "none",
    rebuilds: () => rebuilds,
    break: () => {
      broken = true;
    },
  };
}

// --- Building blocks ---

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
// An oscillator through a lowpass, for anything that should sound soft or muffled.
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
// C major pentatonic from C5 up: every run of these sounds happy.
const PENTA = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];

// --- Effect packs ---

type Voice = {
  wet: number;
  click: (c: Ctx, o: AudioNode, at: number, pitch: number, gain: number) => void;
  note: (c: Ctx, o: AudioNode, at: number, midi: number, gain: number, dur?: number) => void;
  thump: (c: Ctx, o: AudioNode, at: number, gain: number) => void;
};
const VOICES: Record<Exclude<SfxPack, "off">, Voice> = {
  // A wooden tile on a wooden board, and marimba notes.
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
  // A thocky mechanical keyboard: a crisp tick, a deep housing thock, and electric piano notes.
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
  // A kalimba: a tine's tick on the way in, then a round note with its bright overtone.
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
  // A felt-muffled upright: soft hammer taps and warm, rounded notes.
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
  // Glass: a little clink, and bells with their uneven overtones.
  glass: {
    wet: 0.42,
    click: (c, o, at, pitch, gain) => {
      osc(c, "sine", 3100 * pitch, { at, dur: 0.07, gain: gain * 0.22, out: o });
      osc(c, "sine", 4350 * pitch, { at, dur: 0.05, gain: gain * 0.12, out: o });
    },
    note: (c, o, at, midi, gain, dur = 1.8) => {
      [1, 2.76, 5.4, 8.93].forEach((p, i) => osc(c, "sine", hz(midi) * p, { at, dur: dur / (1 + i * 0.8), gain: (gain * 0.36) / (1 + i * 1.4), out: o }));
    },
    thump: (c, o, at, gain) => osc(c, "sine", 880, { at, dur: 0.09, gain: gain * 0.2, out: o }, 760),
  },
  // Water drops: a sine that rises fast as it fades, and soft bloops.
  bubble: {
    wet: 0.22,
    click: (c, o, at, pitch, gain) => osc(c, "sine", 420 * pitch, { at, dur: 0.06, gain: gain * 0.5, out: o }, 1300 * pitch),
    note: (c, o, at, midi, gain, dur = 0.5) => {
      osc(c, "sine", hz(midi) * 0.85, { at, dur: 0.05, gain: gain * 0.35, out: o }, hz(midi));
      osc(c, "sine", hz(midi), { at: at + 0.04, dur, gain: gain * 0.4, out: o });
    },
    thump: (c, o, at, gain) => osc(c, "sine", 260, { at, dur: 0.12, gain: gain * 0.5, out: o }, 110),
  },
  // Bubbly glass: round sine blips and soft bells.
  soft: {
    wet: 0.2,
    click: (c, o, at, pitch, gain) => osc(c, "sine", 900 * pitch, { at, dur: 0.06, gain: gain * 0.45, out: o }, 600 * pitch),
    note: (c, o, at, midi, gain, dur = 0.8) => {
      osc(c, "triangle", hz(midi), { at, dur, gain: gain * 0.35, attack: 0.01, out: o });
      osc(c, "sine", hz(midi) * 2.76, { at, dur: dur * 0.5, gain: gain * 0.08, out: o });
    },
    thump: (c, o, at, gain) => osc(c, "sine", 140, { at, dur: 0.12, gain: gain * 0.4, attack: 0.008, out: o }, 90),
  },
  // Chiptune: square-wave blips.
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

export type SfxName = "pick" | "place" | "recall" | "shuffle" | "play" | "bingo" | "invalid" | "turn" | "ghost" | "land" | "tick" | "win" | "lose" | "preview";
type SfxOpts = { count?: number; score?: number };

// Every sound, from a pack's three voices. `count` is how many tiles (for play and land); `score` makes
// bigger plays sound bigger.
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
      // One rising note per tile, in time with the tiles' bounce, then a chord for a good score.
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
    case "win":
      [72, 76, 79, 84, 88].forEach((m, i) => v.note(c, o, t + i * 0.09, m, 0.6, 0.8));
      [79, 84, 88].forEach((m) => v.note(c, o, t + 0.55, m, 0.4, 1.6));
      return;
    case "lose":
      [76, 72, 69, 64].forEach((m, i) => v.note(c, o, t + i * 0.16, m, 0.45, 0.7));
      return;
    case "preview": {
      // A little game in two seconds: pick a tile up, put three down, play the word, and score big.
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
  // Asked for in the same tap that unlocks audio: play it the moment the context is up.
  if (c.state !== "running") {
    void c.resume().then(() => c.state === "running" && sfx(name, opts)).catch(() => {});
    return;
  }
  render(c, pack, name, opts, c.currentTime + 0.005);
}

// --- Music ---

type Step = (c: Ctx, at: number, bar: number, step: number, out: AudioNode) => void;
type Track = { bpm: number; steps: number; swing?: number; wet: number; volume: number; play: Step; bed?: (c: Ctx, out: AudioNode) => AudioScheduledSourceNode };

// A soft, filtered chord held across a bar.
function pad(c: Ctx, at: number, notes: number[], dur: number, out: AudioNode, gain = 0.05, cutoff = 900, type: OscillatorType = "sawtooth") {
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = cutoff;
  f.connect(out);
  for (const m of notes) {
    for (const d of [-7, 7]) osc(c, type, hz(m), { at, dur, gain, attack: dur * 0.3, out: f }, undefined, d);
  }
}
// Electric piano: a sine with a little bell on top.
function keys(c: Ctx, at: number, notes: number[], out: AudioNode, gain = 0.07, dur = 1.4) {
  for (const m of notes) {
    osc(c, "sine", hz(m), { at, dur, gain, attack: 0.006, out });
    osc(c, "sine", hz(m) * 3, { at, dur: dur * 0.2, gain: gain * 0.12, out });
  }
}
// Nylon guitar: a soft pluck that darkens as it rings.
function pluck(c: Ctx, at: number, notes: number[], out: AudioNode, gain = 0.06, dur = 1.1, strum = 0.018) {
  notes.forEach((m, i) => {
    const t = at + i * strum;
    filtered(c, "triangle", hz(m), 2200, { at: t, dur, gain, attack: 0.003, out });
    filtered(c, "sawtooth", hz(m), 1200, { at: t, dur: dur * 0.25, gain: gain * 0.25, attack: 0.003, out });
  });
}
// A celesta: bell partials, quick to speak and slow to fade.
function bell(c: Ctx, at: number, midi: number, out: AudioNode, gain = 0.05, dur = 2.2) {
  [1, 2, 3.01, 4.2].forEach((p, i) => osc(c, "sine", hz(midi) * p, { at, dur: dur / (1 + i), gain: gain / (1 + i * 1.8), out }));
}
function kick(c: Ctx, at: number, out: AudioNode, gain = 0.35) {
  osc(c, "sine", 120, { at, dur: 0.22, gain, out }, 42);
}
function snare(c: Ctx, at: number, out: AudioNode, gain = 0.06) {
  burst(c, "bandpass", 1800, 0.8, { at, dur: 0.16, gain, out });
}
function brush(c: Ctx, at: number, out: AudioNode, gain = 0.03) {
  burst(c, "bandpass", 3500, 0.6, { at, dur: 0.28, gain, attack: 0.03, out });
}
function rim(c: Ctx, at: number, out: AudioNode, gain = 0.05) {
  burst(c, "bandpass", 2600, 6, { at, dur: 0.04, gain, out });
  osc(c, "sine", 820, { at, dur: 0.03, gain: gain * 0.4, out });
}
function hat(c: Ctx, at: number, out: AudioNode, gain = 0.02) {
  burst(c, "highpass", 7000, 1, { at, dur: 0.04, gain, out });
}
function shaker(c: Ctx, at: number, out: AudioNode, gain = 0.012) {
  burst(c, "highpass", 5000, 0.8, { at, dur: 0.07, gain, attack: 0.02, out });
}
// Vinyl crackle, a pop here and there.
function crackle(c: Ctx, at: number, out: AudioNode, chance: number) {
  if (Math.random() < chance) burst(c, "highpass", 3000, 1, { at: at + Math.random() * 0.15, dur: 0.01, gain: 0.03 + Math.random() * 0.03, out });
}
// Filtered noise under the music, looping until the track stops: vinyl hiss, rain, the sea.
function noiseBed(c: Ctx, out: AudioNode, type: BiquadFilterType, freq: number, gain: number) {
  const s = c.createBufferSource();
  s.buffer = noise(c);
  s.loop = true;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = gain;
  s.connect(f).connect(g).connect(out);
  s.start();
  return s;
}

// Picks from a list by bar and step, so a melody repeats in shape but not exactly.
const pickBy = <T,>(xs: readonly T[], n: number) => xs[((n % xs.length) + xs.length) % xs.length];

const LOFI_CHORDS = [
  [53, 57, 60, 64], // Fmaj7
  [52, 55, 59, 62], // Em7
  [50, 53, 57, 60], // Dm7
  [48, 52, 55, 59], // Cmaj7
];
const NIGHT_CHORDS = [
  [45, 52, 55, 59, 60], // Am9
  [50, 53, 57, 60, 64], // Dm9
  [41, 48, 52, 55, 57], // Fmaj9
  [40, 47, 50, 55, 56], // E7sus-ish
];
const SUNDAY_CHORDS = [
  [50, 53, 57, 60, 64], // Dm9
  [43, 53, 57, 59, 64], // G13
  [48, 52, 55, 59, 62], // Cmaj9
  [45, 55, 60, 61, 65], // A7(b13)
];
const COFFEE_CHORDS = [
  [48, 55, 59, 64], // Cmaj7
  [45, 55, 60, 64], // Am7
  [50, 57, 60, 65], // Dm7
  [43, 53, 59, 62], // G7
];
const RAIN_CHORDS = [
  [45, 52, 59, 60, 64], // Am9
  [41, 48, 52, 57], // Fmaj7
  [48, 55, 59, 64], // Cmaj7
  [43, 50, 52, 59], // G6
];
const DRIFT_CHORDS = [
  [48, 55, 62, 66, 71], // Cmaj9#11
  [45, 52, 59, 64, 67], // Am(add9)
  [41, 48, 55, 57, 64], // Fmaj7
  [43, 50, 57, 62, 66], // G6/9
];
const BOX_CHORDS = [
  [48, 52, 55], // C
  [45, 48, 52], // Am
  [41, 45, 48], // F
  [43, 47, 50], // G
];
// A lullaby, as scale steps (C major from C5) over three beats; null rests.
const LULLABY = [
  [4, null, 2, 0, null, 2],
  [5, null, 4, 2, null, null],
  [3, null, 5, 4, null, 2],
  [1, null, 2, 0, null, null],
];
const C_MAJOR = [72, 74, 76, 77, 79, 81, 83, 84];
const ARCADE_CHORDS = [
  [60, 64, 67],
  [57, 60, 64],
  [53, 57, 60],
  [55, 59, 62],
];

const TRACKS: Record<Exclude<MusicTrack, "off">, Track> = {
  // Dusty keys, a lazy beat and vinyl crackle.
  lofi: {
    bpm: 74,
    steps: 16,
    swing: 0.12,
    wet: 0.12,
    volume: 0.9,
    bed: (c, out) => noiseBed(c, out, "bandpass", 2500, 0.006),
    play: (c, at, bar, step, out) => {
      const chord = LOFI_CHORDS[bar % 4];
      const beat = 60 / 74;
      if (step === 0) keys(c, at, chord.map((m) => m + 12), out, 0.05, beat * 3);
      if (step === 6) keys(c, at, chord.slice(1).map((m) => m + 12), out, 0.035, beat * 2);
      if (step === 0 || step === 8) osc(c, "triangle", hz(chord[0] - 12), { at, dur: beat * 1.8, gain: 0.09, attack: 0.01, out });
      if (step === 0 || step === 10) kick(c, at, out, 0.28);
      if (step === 4 || step === 12) snare(c, at, out, 0.05);
      if (step % 2 === 0) hat(c, at, out, step % 4 === 2 ? 0.018 : 0.01);
      if (step === 14 && bar % 2 === 1) keys(c, at, [PENTA[(bar * 3) % 6] - 12], out, 0.04, beat);
      crackle(c, at, out, 0.35);
    },
  },
  // Slower and in a minor key: muffled keys, a rimshot instead of a snare, a melody now and then.
  nightcap: {
    bpm: 66,
    steps: 16,
    swing: 0.1,
    wet: 0.3,
    volume: 0.95,
    bed: (c, out) => noiseBed(c, out, "bandpass", 2200, 0.005),
    play: (c, at, bar, step, out) => {
      const chord = NIGHT_CHORDS[bar % 4];
      const beat = 60 / 66;
      if (step === 0) pad(c, at, chord.map((m) => m + 12), beat * 4, out, 0.012, 1100, "triangle");
      if (step === 0 || step === 7) keys(c, at, chord.slice(1).map((m) => m + 12), out, 0.032, beat * 2.5);
      if (step === 0 || step === 11) osc(c, "sine", hz(chord[0] - 12), { at, dur: beat * 1.6, gain: 0.11, attack: 0.01, out });
      if (step === 0 || step === 6) kick(c, at, out, 0.24);
      if (step === 8) rim(c, at, out, 0.035);
      if (step % 4 === 2) shaker(c, at, out, 0.014);
      if (bar % 2 === 1 && (step === 2 || step === 5 || step === 9)) keys(c, at, [pickBy([81, 79, 76, 74, 72], bar + step)], out, 0.03, beat * 1.5);
      crackle(c, at, out, 0.3);
    },
  },
  // Jazzy: a ii-V-I with a walking bass, brushes, and a ride.
  sunday: {
    bpm: 84,
    steps: 16,
    swing: 0.2,
    wet: 0.2,
    volume: 0.85,
    bed: (c, out) => noiseBed(c, out, "bandpass", 2600, 0.004),
    play: (c, at, bar, step, out) => {
      const chord = SUNDAY_CHORDS[bar % 4];
      const beat = 60 / 84;
      if (step === 0 || step === 6 || step === 12) keys(c, at, chord.slice(1).map((m) => m + 12), out, step === 0 ? 0.035 : 0.025, beat * 1.2);
      if (step % 4 === 0) {
        const walk = [chord[0], chord[0] + 7, chord[0] + 12, chord[0] + 10];
        osc(c, "triangle", hz(walk[step / 4] - 12), { at, dur: beat * 0.9, gain: 0.1, attack: 0.01, out });
      }
      if (step === 4 || step === 12) brush(c, at, out, 0.03);
      if (step % 4 === 0 || step % 4 === 3) osc(c, "sine", 5200, { at, dur: 0.18, gain: 0.006, out });
      if (step === 0) kick(c, at, out, 0.16);
      if (bar % 4 === 3 && step >= 8 && step % 2 === 0) keys(c, at, [pickBy([86, 84, 81, 79], step / 2)], out, 0.028, beat * 0.8);
      crackle(c, at, out, 0.2);
    },
  },
  // Bossa nova: nylon guitar on the off-beats, a dotted bass, shaker and a clave rim.
  coffee: {
    bpm: 108,
    steps: 16,
    wet: 0.22,
    volume: 0.85,
    play: (c, at, bar, step, out) => {
      const chord = COFFEE_CHORDS[Math.floor(bar / 2) % 4];
      const beat = 60 / 108;
      if ([0, 3, 6, 10, 13].includes(step)) pluck(c, at, chord.slice(1).map((m) => m + 12), out, step === 0 ? 0.04 : 0.03, beat * 1.4);
      if (step === 0 || step === 6) pluck(c, at, [chord[0] - 12], out, 0.07, beat * 1.8, 0);
      if (step === 8 || step === 14) pluck(c, at, [chord[0] - 5], out, 0.055, beat, 0);
      if (step % 2 === 0) shaker(c, at, out, step % 4 === 0 ? 0.01 : 0.016);
      if ([0, 3, 6, 10, 12].includes(step) && bar % 2 === 1) rim(c, at, out, 0.02);
    },
  },
  // No beat: slow pads, a few piano notes, and rain on the window.
  rain: {
    bpm: 60,
    steps: 8,
    wet: 0.45,
    volume: 1,
    bed: (c, out) => noiseBed(c, out, "lowpass", 1100, 0.025),
    play: (c, at, bar, step, out) => {
      const chord = RAIN_CHORDS[Math.floor(bar / 2) % 4];
      if (step === 0 && bar % 2 === 0) pad(c, at, chord, 8.5, out, 0.018, 700);
      if (Math.random() < 0.12) keys(c, at, [PENTA[Math.floor(Math.random() * 7)] - 12], out, 0.04, 3);
    },
  },
  // Ambient: long, slow pads that swell and fade into each other, and the odd far-off bell.
  drift: {
    bpm: 48,
    steps: 8,
    wet: 0.7,
    volume: 1,
    play: (c, at, bar, step, out) => {
      const chord = DRIFT_CHORDS[Math.floor(bar / 2) % 4];
      const len = (60 / 48) * 4;
      if (step === 0 && bar % 2 === 0) {
        pad(c, at, chord, len * 2.6, out, 0.013, 500 + Math.random() * 500, "triangle");
        pad(c, at, [chord[0] - 12], len * 2.4, out, 0.02, 300, "sine");
      }
      if (step === 4 && Math.random() < 0.5) bell(c, at, pickBy([84, 86, 88, 91, 93], bar), out, 0.025, 4);
    },
  },
  // A lullaby on a music box, in three, over a soft pad.
  musicbox: {
    bpm: 76,
    steps: 12,
    wet: 0.4,
    volume: 0.9,
    play: (c, at, bar, step, out) => {
      const chord = BOX_CHORDS[bar % 4];
      const beat = 60 / 76;
      if (step === 0) pad(c, at, chord.map((m) => m + 12), beat * 3.2, out, 0.01, 900, "triangle");
      if (step === 0 || step === 4 || step === 8) bell(c, at, chord[step / 4] + 12, out, 0.018, 1.6);
      if (step % 2 === 0) {
        const deg = LULLABY[bar % 4][step / 2];
        if (deg !== null) bell(c, at, C_MAJOR[deg] + (bar % 8 >= 4 ? 12 : 0), out, 0.04, 2.4);
      }
    },
  },
  // Gentle chiptune: arpeggios over a bass line.
  arcade: {
    bpm: 112,
    steps: 16,
    wet: 0.08,
    volume: 0.7,
    play: (c, at, bar, step, out) => {
      const chord = ARCADE_CHORDS[bar % 4];
      osc(c, "square", hz(chord[step % 3] + 12), { at, dur: 0.1, gain: 0.025, out });
      if (step % 4 === 0) osc(c, "triangle", hz(chord[0] - 12), { at, dur: 0.25, gain: 0.12, out });
      if (step % 8 === 4) burst(c, "highpass", 2500, 1, { at, dur: 0.05, gain: 0.03, out });
    },
  },
};

// Plays the chosen track while the app is open (`music.want(true)`), crossfading when you switch.
const music = (() => {
  let wanted = false;
  let playing: MusicTrack = "off";
  let timer = 0;
  let bed: AudioScheduledSourceNode | null = null;
  let next = 0;
  let bar = 0;
  let step = 0;

  // The context it was playing on is gone: forget it without touching the old graph.
  function reset() {
    clearInterval(timer);
    const old = bed;
    bed = null;
    try {
      old?.stop();
    } catch {
      // Already stopped.
    }
    playing = "off";
  }
  function stop() {
    if (!ctx || playing === "off") return;
    const g = graphFor(ctx).music.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(0, ctx.currentTime, 0.3);
    const old = bed;
    bed = null;
    window.setTimeout(() => old?.stop(), 1500);
    clearInterval(timer);
    playing = "off";
  }
  function start(id: Exclude<MusicTrack, "off">) {
    const c = audio();
    if (!c || c.state !== "running") return;
    stop();
    const track = TRACKS[id];
    const g = graphFor(c);
    const out = input(c, "music", id, track.wet);
    playing = id;
    g.music.gain.cancelScheduledValues(c.currentTime);
    g.music.gain.setTargetAtTime(0.5 * track.volume, c.currentTime, 0.12);
    bed = track.bed?.(c, out) ?? null;
    next = c.currentTime + 0.1;
    bar = 0;
    step = 0;
    const stepDur = 60 / track.bpm / 4;
    // Schedules a little ahead, so the timing holds even when the page is busy.
    timer = window.setInterval(() => {
      // Timers stall in the background and when the app comes back; skip what was missed rather than
      // playing it all at once.
      while (next < c.currentTime - 0.05) {
        next += stepDur;
        step = (step + 1) % track.steps;
        if (step === 0) bar++;
      }
      while (next < c.currentTime + 0.25) {
        const swing = track.swing && step % 2 === 1 ? stepDur * track.swing : 0;
        track.play(c, next + swing, bar, step, out);
        next += stepDur;
        step = (step + 1) % track.steps;
        if (step === 0) bar++;
      }
    }, 50);
  }
  function refresh() {
    const target = wanted ? settings.music : "off";
    if (target !== playing) {
      if (target === "off") stop();
      else start(target);
    }
    // For tests: what's playing right now.
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

// For tests: render a sound or a stretch of a track offline and measure it, so every pack and track is
// checked for silence and clipping without anyone listening.
async function measure(seconds: number, draw: (c: OfflineAudioContext) => void) {
  const c = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
  draw(c);
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
    music: (id: Exclude<MusicTrack, "off">, seconds = 12) =>
      measure(seconds, (c) => {
        const track = TRACKS[id];
        const g = graphFor(c);
        g.music.gain.value = 0.5 * track.volume;
        const out = input(c, "music", id, track.wet);
        track.bed?.(c, out);
        const stepDur = 60 / track.bpm / 4;
        for (let i = 0, t = 0.05; t < seconds; i++, t += stepDur) {
          const s = i % track.steps;
          track.play(c, t + (track.swing && s % 2 === 1 ? stepDur * track.swing : 0), Math.floor(i / track.steps), s, out);
        }
      }),
  };
}
