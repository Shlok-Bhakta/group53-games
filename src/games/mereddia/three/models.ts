import * as THREE from "three";

// Loads the voxel models tools/mereddia/convert.mjs wrote: one geometry per animation frame, the colours
// already baked into the vertices, plus the project's animation table.

export type Anim = { start: number; end: number; speed: number; type: number; sound_effect?: string | null; positional_sound?: boolean };
export type Model = { name: string; kind: string; frames: THREE.BufferGeometry[]; animations: Record<string, Anim>; material: THREE.Material; passable?: boolean; flame?: Flame; hands?: ([number, number, number] | null)[]; handsL?: ([number, number, number] | null)[]; tops?: number[] };

// The flame on a robe's back, shown by moving its colours around: along every row of the palette the purples slide over a few pixels and back, so
// the light, middle and dark purples stay in the same proportions as they were drawn, just shifting about. It runs while its wearer is doing
// something, and rests as it was drawn when they stand still. Kept in the model's own palette texture, so everything that wears it shimmers together.
export type Flame = { advance(dt: number, active: boolean): void };

const isPurple = (r: number, g: number, b: number) => b > g + 35 && r > g + 18;
// How far the colours have slid at each step: out and back.
const SLIDE = [0, 1, 2, 3, 2, 1];

function flameOf(bmp: ImageBitmap): { tex: THREE.CanvasTexture; flame: Flame } | null {
  const cv = document.createElement("canvas");
  cv.width = bmp.width;
  cv.height = bmp.height;
  const g = cv.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  // Per row: where its purple pixels are, and what colours they were drawn in.
  const rows: { at: number[]; was: [number, number, number][] }[] = [];
  const shades = new Set<number>();
  for (let y = 0; y < cv.height; y++) {
    const at: number[] = [];
    const was: [number, number, number][] = [];
    for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      if (d[i + 3] === 255 && isPurple(d[i], d[i + 1], d[i + 2])) {
        at.push(i);
        was.push([d[i], d[i + 1], d[i + 2]]);
        shades.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      }
    }
    if (at.length > 1) rows.push({ at, was });
  }
  if (shades.size < 2) return null;
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  let clock = 0;
  let shown = 0;
  const paint = (slide: number) => {
    for (const r of rows) {
      const n = r.at.length;
      r.at.forEach((i, k) => {
        const c = r.was[(k + slide) % n];
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
      });
    }
    g.putImageData(img, 0, 0);
    tex.needsUpdate = true;
  };
  return {
    tex,
    flame: {
      advance(dt, active) {
        const step = active ? Math.floor((clock += dt) / 0.12) % SLIDE.length : 0;
        if (!active) clock = 0;
        if (step !== shown) {
          shown = step;
          paint(SLIDE[step]);
        }
      },
    },
  };
}

type Raw = {
  name: string;
  kind: string;
  meta: { animations?: Record<string, Anim>; passable?: boolean };
  texture?: boolean;
  translucent?: boolean;
  frames: { n: number; pos: [number, number]; uv: [number, number]; idx: [number, number]; t: number[] | null; hand?: [number, number, number]; handL?: [number, number, number]; top?: number }[];
};

const BASE = `${import.meta.env.BASE_URL}mereddia/3d`;
const cache = new Map<string, Promise<Model | null>>();

export const slug = (name: string) => name.replace(/[^A-Za-z0-9_-]+/g, "_");

// The model's palette atlas, drawn the way the project draws it: every texel a hard-edged square.
async function textureOf(url: string): Promise<THREE.Texture> {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const tex = new THREE.Texture(bmp);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function loadModel(kind: string, name: string): Promise<Model | null> {
  const key = `${kind}/${name}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      try {
        const dir = `${BASE}/models/${kind}/${slug(name)}`;
        const [json, bin] = await Promise.all([fetch(`${dir}.json`).then((r) => r.json() as Promise<Raw>), fetch(`${dir}.bin`).then((r) => r.arrayBuffer())]);
        let map = json.texture ? await textureOf(`${dir}.png`) : undefined;
        // People who wear the flame and move about have it flicker; slimes and the like do not.
        let flame: Flame | undefined;
        if (map && kind === "characters" && json.frames.length > 1 && !/slime|Boulder|Golem/i.test(name)) {
          const made = flameOf(map.image as ImageBitmap);
          if (made) {
            flame = made.flame;
            map.dispose();
            map = made.tex;
          }
        }
        const frames = json.frames.map((f) => {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(bin, f.pos[0], f.pos[1]).slice(), 3));
          g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(bin, f.uv[0], f.uv[1]).slice(), 2));
          g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, f.idx[0], f.idx[1]).slice(), 1));
          if (f.t) g.applyMatrix4(new THREE.Matrix4().set(f.t[0], f.t[1], f.t[2], f.t[9], f.t[3], f.t[4], f.t[5], f.t[10], f.t[6], f.t[7], f.t[8], f.t[11], 0, 0, 0, 1));
          // Every face its own vertices and its own flat normal, so a voxel's side is lit evenly and tiles
          // don't smear into their neighbours (shared vertices would average the lighting across corners).
          const flat = g.toNonIndexed();
          g.dispose();
          flat.computeVertexNormals();
          return flat;
        });
        // Glass (the air crystals) is drawn see-through; everything else is solid with cut-out edges.
        const material = json.translucent ? new THREE.MeshLambertMaterial({ map, transparent: true, alphaTest: 0.02, depthWrite: false }) : new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 });
        const hands = json.frames.some((f) => f.hand) ? json.frames.map((f) => f.hand ?? null) : undefined;
        const tops = json.frames.some((f) => f.top !== undefined) ? json.frames.map((f) => f.top ?? 0) : undefined;
        const handsL = json.frames.some((f) => f.handL) ? json.frames.map((f) => f.handL ?? null) : undefined;
        return { name: json.name, kind: json.kind, frames, animations: json.meta.animations ?? {}, material, passable: json.meta.passable, flame, hands, handsL, tops };
      } catch (error) {
        console.error("Mereddia model failed to load:", key, error);
        return null;
      }
    })();
    cache.set(key, hit);
  }
  return hit;
}
