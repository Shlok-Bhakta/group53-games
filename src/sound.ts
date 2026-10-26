import { useSyncExternalStore } from "react";

// Sound effects and background music, all synthesized with Web Audio: no files to load or license.
//
// Effects come in packs that share one vocabulary (`sfx("place")`), so swapping packs changes how the
// whole game sounds. Music tracks are generative: a few bars of chords and patterns scheduled a moment
// ahead, looping for as long as you're in a game. Both are chosen on the You tab and remembered on the phone.
//
// iOS: audio only starts after a tap, so the context unlocks on the first touch. The audio session is
// "ambient", which mixes with whatever else is playing and goes quiet with the silent switch.

export const SFX_PACKS = [
  { value: "off", label: "Off" },
  { value: "wood", label: "Wood" },
  { value: "soft", label: "Soft" },
  { value: "arcade", label: "Arcade" },
] as const;
export const MUSIC_TRACKS = [
  { value: "off", label: "Off" },
  { value: "lofi", label: "Lo-fi" },
  { value: "rain", label: "Rain" },
  { value: "arcade", label: "Arcade" },
] as const;
export type SfxPack = (typeof SFX_PACKS)[number]["value"];
export type MusicTrack = (typeof MUSIC_TRACKS)[number]["value"];
export type SoundSettings = { sfx: SfxPack; music: MusicTrack; lastMusic: Exclude<MusicTrack, "off"> };

// --- Settings store ---

const KEY = "sound";
const DEFAULTS: SoundSettings = { sfx: "wood", music: "lofi", lastMusic: "lofi" };
let settings: SoundSettings = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
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
  music.refresh();
}
export function useSoundSettings() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => settings,
  );
}

// --- The audio graph ---

let ctx: AudioContext | null = null;
let sfxBus: GainNode;
let musicBus: GainNode;

function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) nav.audioSession.type = "ambient";
  ctx = new AC();
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -14;
  master.ratio.value = 4;
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.7;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(master);
  return ctx;
}

// Browsers keep audio locked until a tap.
if (typeof window !== "undefined") {
  const unlock = () => {
    const c = audio();
    if (c?.state === "suspended") void c.resume();
    music.refresh();
  };
  window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
}

let noiseBuffer: AudioBuffer | null = null;
function noise(c: AudioContext) {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

type Env = { at: number; dur: number; gain: number; attack?: number; out: AudioNode };
function envelope(c: AudioContext, { at, dur, gain, attack = 0.003 }: Env) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  return g;
}
function osc(c: AudioContext, type: OscillatorType, freq: number, env: Env, freqEnd?: number, detune = 0) {
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
function burst(c: AudioContext, filter: BiquadFilterType, freq: number, q: number, env: Env) {
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

// --- Effect packs: three voices each, and every sound is built from those ---

type Voice = {
  click: (c: AudioContext, at: number, pitch: number, gain: number) => void;
  note: (c: AudioContext, at: number, midi: number, gain: number, dur?: number) => void;
  thump: (c: AudioContext, at: number, gain: number) => void;
};
const VOICES: Record<Exclude<SfxPack, "off">, Voice> = {
  // A wooden tile on a wooden board, and marimba notes.
  wood: {
    click: (c, at, pitch, gain) => {
      burst(c, "bandpass", 1400 * pitch, 5, { at, dur: 0.045, gain: gain * 0.9, out: sfxBus });
      osc(c, "sine", 700 * pitch, { at, dur: 0.035, gain: gain * 0.35, out: sfxBus });
    },
    note: (c, at, midi, gain, dur = 0.5) => {
      osc(c, "sine", hz(midi), { at, dur, gain: gain * 0.5, out: sfxBus });
      osc(c, "sine", hz(midi) * 4, { at, dur: dur * 0.25, gain: gain * 0.12, out: sfxBus });
      burst(c, "bandpass", hz(midi) * 2, 8, { at, dur: 0.02, gain: gain * 0.15, out: sfxBus });
    },
    thump: (c, at, gain) => osc(c, "sine", 190, { at, dur: 0.09, gain: gain * 0.6, out: sfxBus }, 95),
  },
  // Bubbly glass: round sine blips and soft bells.
  soft: {
    click: (c, at, pitch, gain) => osc(c, "sine", 900 * pitch, { at, dur: 0.06, gain: gain * 0.45, out: sfxBus }, 600 * pitch),
    note: (c, at, midi, gain, dur = 0.8) => {
      osc(c, "triangle", hz(midi), { at, dur, gain: gain * 0.35, attack: 0.01, out: sfxBus });
      osc(c, "sine", hz(midi) * 2.76, { at, dur: dur * 0.5, gain: gain * 0.08, out: sfxBus });
    },
    thump: (c, at, gain) => osc(c, "sine", 140, { at, dur: 0.12, gain: gain * 0.4, attack: 0.008, out: sfxBus }, 90),
  },
  // Chiptune: square-wave blips.
  arcade: {
    click: (c, at, pitch, gain) => osc(c, "square", 1100 * pitch, { at, dur: 0.035, gain: gain * 0.12, out: sfxBus }, 1600 * pitch),
    note: (c, at, midi, gain, dur = 0.22) => {
      osc(c, "square", hz(midi), { at, dur, gain: gain * 0.12, out: sfxBus });
      osc(c, "square", hz(midi + 12), { at: at + 0.04, dur: dur * 0.6, gain: gain * 0.05, out: sfxBus });
    },
    thump: (c, at, gain) => burst(c, "highpass", 1500, 1, { at, dur: 0.06, gain: gain * 0.35, out: sfxBus }),
  },
};

export type SfxName = "pick" | "place" | "recall" | "shuffle" | "play" | "bingo" | "invalid" | "turn" | "ghost" | "land" | "tick" | "win" | "lose" | "preview";

// `count` is how many tiles (for play and land); `score` makes bigger plays sound bigger.
export function sfx(name: SfxName, opts: { count?: number; score?: number } = {}) {
  (window as unknown as { __sfx?: string[] }).__sfx?.push(name);
  if (settings.sfx === "off") return;
  const c = audio();
  if (!c || c.state !== "running") return;
  const v = VOICES[settings.sfx];
  const t = c.currentTime + 0.005;
  const n = Math.max(1, Math.min(9, opts.count ?? 1));
  switch (name) {
    case "pick":
      return v.click(c, t, 1.25, 0.5);
    case "place":
      v.click(c, t, 1, 0.8);
      return v.thump(c, t, 0.7);
    case "recall":
      v.click(c, t, 1.1, 0.5);
      return v.click(c, t + 0.05, 0.85, 0.4);
    case "shuffle":
      for (let i = 0; i < 6; i++) v.click(c, t + i * 0.04, 0.8 + Math.random() * 0.6, 0.35);
      return;
    case "play": {
      // One rising note per tile, in time with the tiles' bounce, then a chord for a good score.
      for (let i = 0; i < n; i++) v.note(c, t + i * 0.07, PENTA[i], 0.7);
      v.thump(c, t, 0.6);
      if ((opts.score ?? 0) >= 20) [0, 2, 4].forEach((k) => v.note(c, t + n * 0.07 + 0.05, PENTA[k + 3], 0.4, 0.9));
      return;
    }
    case "bingo":
      for (let i = 0; i < 10; i++) v.note(c, t + i * 0.05, PENTA[i], 0.6, 0.4);
      [0, 2, 4, 5].forEach((k) => v.note(c, t + 0.6, PENTA[k + 2], 0.45, 1.4));
      return;
    case "invalid":
      v.note(c, t, 60, 0.5, 0.18);
      v.note(c, t + 0.11, 56, 0.5, 0.25);
      return;
    case "turn":
      v.note(c, t, 88, 0.55, 0.9);
      return v.note(c, t + 0.12, 95, 0.45, 1.1);
    case "ghost":
      return v.click(c, t, 0.6, 0.18);
    case "land":
      for (let i = 0; i < n; i++) v.click(c, t + i * 0.06, 0.95, 0.5);
      return v.thump(c, t + n * 0.06, 0.4);
    case "tick":
      return v.click(c, t, 1.6, 0.3);
    case "win":
      [72, 76, 79, 84, 88].forEach((m, i) => v.note(c, t + i * 0.09, m, 0.6, 0.8));
      [79, 84, 88].forEach((m) => v.note(c, t + 0.55, m, 0.4, 1.6));
      return;
    case "lose":
      [76, 72, 69, 64].forEach((m, i) => v.note(c, t + i * 0.16, m, 0.45, 0.7));
      return;
    case "preview":
      v.click(c, t, 1, 0.7);
      v.thump(c, t, 0.6);
      [0, 1, 2].forEach((i) => v.note(c, t + 0.12 + i * 0.08, PENTA[i + 2], 0.6));
      return;
  }
}

// --- Music ---

type Step = (c: AudioContext, at: number, bar: number, step: number, out: AudioNode) => void;
type Track = { bpm: number; steps: number; swing?: number; play: Step; bed?: (c: AudioContext, out: AudioNode) => () => void; volume: number };

// A soft, filtered chord held across a bar.
function pad(c: AudioContext, at: number, notes: number[], dur: number, out: AudioNode, gain = 0.05, cutoff = 900) {
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = cutoff;
  f.connect(out);
  for (const m of notes) {
    for (const d of [-7, 7]) osc(c, "sawtooth", hz(m), { at, dur, gain, attack: dur * 0.3, out: f }, undefined, d);
  }
}
// Electric piano: a sine with a little bell on top.
function keys(c: AudioContext, at: number, notes: number[], out: AudioNode, gain = 0.07, dur = 1.4) {
  for (const m of notes) {
    osc(c, "sine", hz(m), { at, dur, gain, attack: 0.006, out });
    osc(c, "sine", hz(m) * 3, { at, dur: dur * 0.2, gain: gain * 0.12, out });
  }
}
function kick(c: AudioContext, at: number, out: AudioNode, gain = 0.35) {
  osc(c, "sine", 120, { at, dur: 0.22, gain, out }, 42);
}
function snare(c: AudioContext, at: number, out: AudioNode, gain = 0.06) {
  burst(c, "bandpass", 1800, 0.8, { at, dur: 0.16, gain, out });
}
function hat(c: AudioContext, at: number, out: AudioNode, gain = 0.02) {
  burst(c, "highpass", 7000, 1, { at, dur: 0.04, gain, out });
}
// A loop of filtered noise under the music: vinyl, or rain.
function noiseBed(c: AudioContext, out: AudioNode, type: BiquadFilterType, freq: number, gain: number, crackle = false) {
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
  let timer = 0;
  if (crackle) {
    const pop = () => {
      burst(c, "highpass", 3000, 1, { at: c.currentTime, dur: 0.01, gain: 0.03 + Math.random() * 0.03, out });
      timer = window.setTimeout(pop, 80 + Math.random() * 500);
    };
    pop();
  }
  return () => {
    s.stop();
    clearTimeout(timer);
  };
}

const LOFI_CHORDS = [
  [53, 57, 60, 64], // Fmaj7
  [52, 55, 59, 62], // Em7
  [50, 53, 57, 60], // Dm7
  [48, 52, 55, 59], // Cmaj7
];
const RAIN_CHORDS = [
  [45, 52, 59, 60, 64], // Am9
  [41, 48, 52, 57], // Fmaj7
  [48, 55, 59, 64], // Cmaj7
  [43, 50, 52, 59], // G6
];
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
    volume: 0.9,
    bed: (c, out) => noiseBed(c, out, "bandpass", 2500, 0.006, true),
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
    },
  },
  // No beat: slow pads, a few piano notes, and rain on the window.
  rain: {
    bpm: 60,
    steps: 8,
    volume: 1,
    bed: (c, out) => noiseBed(c, out, "lowpass", 1100, 0.025),
    play: (c, at, bar, step, out) => {
      const chord = RAIN_CHORDS[Math.floor(bar / 2) % 4];
      if (step === 0 && bar % 2 === 0) pad(c, at, chord, 8.5, out, 0.018, 700);
      if (Math.random() < 0.12) keys(c, at, [PENTA[Math.floor(Math.random() * 7)] - 12], out, 0.04, 3);
    },
  },
  // Gentle chiptune: arpeggios over a bass line.
  arcade: {
    bpm: 112,
    steps: 16,
    volume: 0.7,
    play: (c, at, bar, step, out) => {
      const chord = ARCADE_CHORDS[bar % 4];
      osc(c, "square", hz(chord[step % 3] + 12), { at, dur: 0.1, gain: 0.025, out });
      if (step % 4 === 0) osc(c, "triangle", hz(chord[0] - 12), { at, dur: 0.25, gain: 0.12, out });
      if (step % 8 === 4) burst(c, "highpass", 2500, 1, { at, dur: 0.05, gain: 0.03, out });
    },
  },
};

// Plays the chosen track while a game screen is open (`music.want(true)`), fading in and out.
const music = (() => {
  let wanted = false;
  let playing: MusicTrack = "off";
  let timer = 0;
  let stopBed: (() => void) | null = null;
  let next = 0;
  let bar = 0;
  let step = 0;
  let preview = 0;

  function stop() {
    if (!ctx || playing === "off") return;
    const g = musicBus.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(0, ctx.currentTime, 0.3);
    const bed = stopBed;
    stopBed = null;
    window.setTimeout(() => bed?.(), 1500);
    clearInterval(timer);
    playing = "off";
  }
  function start(id: Exclude<MusicTrack, "off">) {
    const c = audio();
    if (!c || c.state !== "running") return;
    stop();
    const track = TRACKS[id];
    playing = id;
    musicBus.gain.cancelScheduledValues(c.currentTime);
    musicBus.gain.setTargetAtTime(0.5 * track.volume, c.currentTime, 0.8);
    stopBed = track.bed?.(c, musicBus) ?? null;
    next = c.currentTime + 0.1;
    bar = 0;
    step = 0;
    const stepDur = 60 / track.bpm / 4;
    // Schedules a little ahead, so the timing holds even when the page is busy.
    timer = window.setInterval(() => {
      while (next < c.currentTime + 0.25) {
        const swing = track.swing && step % 2 === 1 ? stepDur * track.swing : 0;
        track.play(c, next + swing, bar, step, musicBus);
        next += stepDur;
        step = (step + 1) % track.steps;
        if (step === 0) bar++;
      }
    }, 50);
  }
  function refresh() {
    const target = preview ? settings.lastMusic : wanted ? settings.music : "off";
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
    // A few seconds of a track, when you pick it on the You tab.
    preview() {
      clearTimeout(preview);
      preview = window.setTimeout(() => {
        preview = 0;
        refresh();
      }, 7000);
      stop();
      refresh();
    },
    refresh,
  };
})();

export const wantMusic = (on: boolean) => music.want(on);
export const previewMusic = () => music.preview();
