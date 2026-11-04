import * as THREE from "three";

// Loads the voxel models tools/mereddia/convert.mjs wrote: one geometry per animation frame, the colours
// already baked into the vertices, plus the project's animation table.

export type Anim = { start: number; end: number; speed: number; type: number; sound_effect?: string | null; positional_sound?: boolean };
export type Model = { name: string; kind: string; frames: THREE.BufferGeometry[]; animations: Record<string, Anim>; material: THREE.Material; passable?: boolean; hands?: ([number, number, number] | null)[]; handsL?: ([number, number, number] | null)[]; tops?: number[] };

type Raw = {
  name: string;
  kind: string;
  meta: { animations?: Record<string, Anim>; passable?: boolean };
  texture?: boolean;
  frames: { n: number; pos: [number, number]; uv: [number, number]; idx: [number, number]; t: number[] | null; hand?: [number, number, number]; handL?: [number, number, number]; top?: number }[];
};

const BASE = "/mereddia/3d";
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
        const map = json.texture ? await textureOf(`${dir}.png`) : undefined;
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
        const material = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 });
        const hands = json.frames.some((f) => f.hand) ? json.frames.map((f) => f.hand ?? null) : undefined;
        const tops = json.frames.some((f) => f.top !== undefined) ? json.frames.map((f) => f.top ?? 0) : undefined;
        const handsL = json.frames.some((f) => f.handL) ? json.frames.map((f) => f.handL ?? null) : undefined;
        return { name: json.name, kind: json.kind, frames, animations: json.meta.animations ?? {}, material, passable: json.meta.passable, hands, handsL, tops };
      } catch (error) {
        console.error("Mereddia model failed to load:", key, error);
        return null;
      }
    })();
    cache.set(key, hit);
  }
  return hit;
}
