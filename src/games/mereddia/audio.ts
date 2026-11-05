// Journey Across Mereddia's sound: the project's own music and effects (compressed by tools/mereddia/audio.mjs).
// Everything goes through one Web Audio graph: a music bus that crossfades between tracks, an ambience bus for
// looping sounds that fade with distance (the waterfall, the rolling boulder), and one-shot effects. The page
// stays silent until the first tap, which browsers insist on.

const BASE = `${import.meta.env.BASE_URL}mereddia/audio`;

export type Track = "Forest_with_leaves_woodpecker_LONG" | "cave_ambiance" | "GolemTheme";

type Ctx = { ctx: AudioContext; music: GainNode; sfx: GainNode; ambience: GainNode };

let graph: Ctx | undefined;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let on = { sfx: true, music: true };

// Music: the track that's playing and the one fading out.
let current: { name: Track; source: AudioBufferSourceNode; gain: GainNode } | undefined;
let wanted: { name: Track; volume: number } | undefined;

// Looping ambience by id.
const loops = new Map<string, { source: AudioBufferSourceNode; gain: GainNode; name: string }>();

function ensure(): Ctx | undefined {
  if (graph) return graph;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return undefined;
  const ctx = new AC();
  const bus = (v: number) => {
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(ctx.destination);
    return g;
  };
  graph = { ctx, music: bus(0.55), sfx: bus(0.8), ambience: bus(0.7) };
  return graph;
}

function load(kind: "music" | "sfx", name: string): Promise<AudioBuffer | null> {
  const g = ensure();
  if (!g) return Promise.resolve(null);
  const key = `${kind}/${name}`;
  let hit = buffers.get(key);
  if (!hit) {
    hit = fetch(`${BASE}/${key}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => g.ctx.decodeAudioData(b))
      .catch(() => null);
    buffers.set(key, hit);
  }
  return hit;
}

// Browsers keep the context suspended until a gesture; call this from one.
export function unlock() {
  const g = ensure();
  if (g && g.ctx.state === "suspended") void g.ctx.resume().then(syncMusic);
}

export function setEnabled(next: { sfx: boolean; music: boolean }) {
  on = next;
  if (!next.music) stopMusic();
  else syncMusic();
}

// A one-shot effect. `delay` is in milliseconds; `volume` and `rate` shape it.
// A short effort shout, "hyah!", made on the spot: a voiced buzz whose pitch drops through two vowel-like filters, with a breath of noise at the front.
// (There is no recording of one in the project, so it is built from a few oscillators rather than taken from anywhere.)
function hyah(g: Ctx, delay: number, volume: number) {
  const { ctx } = g;
  const t = ctx.currentTime + delay / 1000;
  const pitch = 0.92 + Math.random() * 0.2;
  const voice = ctx.createOscillator();
  voice.type = "sawtooth";
  voice.frequency.setValueAtTime(330 * pitch, t);
  voice.frequency.exponentialRampToValueAtTime(190 * pitch, t + 0.26);
  const low = ctx.createBiquadFilter();
  low.type = "bandpass";
  low.Q.value = 5;
  low.frequency.setValueAtTime(650, t);
  low.frequency.linearRampToValueAtTime(900, t + 0.12);
  const high = ctx.createBiquadFilter();
  high.type = "bandpass";
  high.Q.value = 7;
  high.frequency.setValueAtTime(1500, t);
  high.frequency.linearRampToValueAtTime(1150, t + 0.2);
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.5 * volume, t + 0.03);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  voice.connect(low).connect(out);
  voice.connect(high).connect(out);
  out.connect(g.sfx);
  voice.start(t);
  voice.stop(t + 0.32);
  // The breath that starts it.
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const breath = ctx.createBufferSource();
  breath.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1800;
  const bg = ctx.createGain();
  bg.gain.value = 0.25 * volume;
  breath.connect(hp).connect(bg).connect(g.sfx);
  breath.start(t);
}

export function play(name: string, opts: { volume?: number; rate?: number; delay?: number } = {}) {
  if (!on.sfx) return;
  const g = ensure();
  if (!g || g.ctx.state !== "running") return;
  if (name === "hyah") return hyah(g, opts.delay ?? 0, opts.volume ?? 1);
  void load("sfx", name).then((buf) => {
    if (!buf) return;
    const src = g.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = g.ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    src.connect(gain).connect(g.sfx);
    src.start(g.ctx.currentTime + (opts.delay ?? 0) / 1000);
  });
}

// ---------------------------------------------------------------------------------------- music

function stopMusic(fade = 0.8) {
  const g = graph;
  if (!g || !current) return;
  const old = current;
  current = undefined;
  old.gain.gain.cancelScheduledValues(g.ctx.currentTime);
  old.gain.gain.setValueAtTime(old.gain.gain.value, g.ctx.currentTime);
  old.gain.gain.linearRampToValueAtTime(0, g.ctx.currentTime + fade);
  old.source.stop(g.ctx.currentTime + fade + 0.05);
}

function syncMusic() {
  const g = graph;
  if (!g || g.ctx.state !== "running" || !on.music) return;
  if (!wanted) return stopMusic();
  const want = wanted;
  if (current?.name === want.name) {
    // Same track: just move the volume.
    current.gain.gain.cancelScheduledValues(g.ctx.currentTime);
    current.gain.gain.setTargetAtTime(want.volume, g.ctx.currentTime, 0.6);
    return;
  }
  stopMusic(1.6);
  void load("music", want.name).then((buf) => {
    // Somebody else may have asked for something different while this was loading.
    if (!buf || wanted?.name !== want.name || current || !on.music) return;
    const src = g.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = g.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(g.music);
    src.start();
    gain.gain.linearRampToValueAtTime(want.volume, g.ctx.currentTime + 1.6);
    current = { name: want.name, source: src, gain };
  });
}

// What music the scene calls for, or none. Called whenever it might have changed.
export function setMusic(name: Track | null, volume = 0.6) {
  wanted = name ? { name, volume } : undefined;
  syncMusic();
}

// ---------------------------------------------------------------------------------------- ambience

// A sound that loops for as long as it's wanted, at a volume that can change from moment to moment.
// A volume of 0 (or null) lets it go.
export function setLoop(id: string, name: string, volume: number) {
  const g = graph;
  if (!g || g.ctx.state !== "running" || !on.sfx) volume = 0;
  const live = loops.get(id);
  if (volume <= 0.01) {
    if (live && g) {
      live.gain.gain.setTargetAtTime(0, g.ctx.currentTime, 0.2);
      live.source?.stop(g.ctx.currentTime + 1);
      loops.delete(id);
    }
    return;
  }
  if (!g) return;
  if (live && live.name === name) {
    live.gain.gain.setTargetAtTime(volume, g.ctx.currentTime, 0.25);
    return;
  }
  if (live) setLoop(id, name, 0);
  // Claim the slot now so a second call while this loads doesn't start a second copy.
  const placeholder = { source: undefined as unknown as AudioBufferSourceNode, gain: g.ctx.createGain(), name };
  loops.set(id, placeholder);
  void load("sfx", name).then((buf) => {
    if (loops.get(id) !== placeholder) return;
    if (!buf) return void loops.delete(id);
    const src = g.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    placeholder.gain.gain.value = 0;
    src.connect(placeholder.gain).connect(g.ambience);
    src.start();
    placeholder.gain.gain.setTargetAtTime(volume, g.ctx.currentTime, 0.3);
    placeholder.source = src;
  });
}

export function silence() {
  stopMusic(0.3);
  for (const id of [...loops.keys()]) setLoop(id, "", 0);
}

export function dispose() {
  silence();
  wanted = undefined;
}

// What the engine is doing right now, for debugging and checks.
export const status = () => ({ state: graph?.ctx.state ?? "none", music: current?.name ?? null, loops: [...loops.keys()], loaded: buffers.size });
