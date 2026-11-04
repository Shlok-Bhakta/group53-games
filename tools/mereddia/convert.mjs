// Converts the RPG in a Box project behind Journey Across Mereddia into web assets.
//
//   node tools/mereddia/convert.mjs <project folder> <out folder> [--models a,b,c] [--maps x,y] [--all]
//
// The project's .scn files are Godot 3.1 binary resources inside zstd blocks (see godot3.mjs). From them
// this writes, under <out>:
//   models/<kind>/<name>.json + .bin   voxel meshes, one per animation frame, UVs into one palette atlas per model
//   maps/<name>.json                   every placed tile, object and character, with grid position, transform,
//                                      passability and script hooks, plus the sky and light settings
//
// A model's frames are the MeshInstance children of its scene, in order. Each frame's ArrayMesh is a flat
// list of triangles whose colours live in a 128x128 palette texture that the UVs point into. Each face covers a
// small patch of it, so the texture is kept (packed into one atlas per model) and drawn with nearest filtering.

import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import path from "node:path";
import { load, Ref } from "./godot3.mjs";

const [, , src, out, ...rest] = process.argv;
if (!src || !out) {
  console.error("usage: node tools/mereddia/convert.mjs <project folder> <out folder> [--models a,b] [--maps x,y] [--all]");
  process.exit(1);
}
const arg = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1]?.split(",").filter(Boolean) : undefined);
const all = rest.includes("--all");

const half = (h) => {
  const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s ? -Infinity : Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
};

const ARRAY = { VERTEX: 1, NORMAL: 2, TANGENT: 4, COLOR: 8, UV: 16, UV2: 32, BONES: 64, WEIGHTS: 128, INDEX: 256 };
const COMPRESS = { VERTEX: 1 << 9, NORMAL: 1 << 10, TANGENT: 1 << 11, COLOR: 1 << 12, UV: 1 << 13, UV2: 1 << 14, BONES: 1 << 15, WEIGHTS: 1 << 16 };
const USE_2D = 1 << 18;

// Where each attribute sits inside a vertex, for a Godot 3.1 surface format.
function layout(format) {
  let o = 0;
  const at = {};
  if (format & ARRAY.VERTEX) { at.vertex = o; o += format & USE_2D ? 8 : (format & COMPRESS.VERTEX ? 8 : 12); }
  if (format & ARRAY.NORMAL) { at.normal = o; o += format & COMPRESS.NORMAL ? 4 : 12; }
  if (format & ARRAY.TANGENT) { at.tangent = o; o += format & COMPRESS.TANGENT ? 4 : 16; }
  if (format & ARRAY.COLOR) { at.color = o; o += format & COMPRESS.COLOR ? 4 : 16; }
  if (format & ARRAY.UV) { at.uv = o; o += format & COMPRESS.UV ? 4 : 8; }
  if (format & ARRAY.UV2) { at.uv2 = o; o += format & COMPRESS.UV2 ? 4 : 8; }
  at.stride = o;
  return at;
}

// Internal references are the number in a resource's "local://N" path, not its position in the file.
function resolve(res, ref) {
  return ref instanceof Ref && ref.kind === "int" ? res.find((r) => r.path === `local://${ref.v}`)?.obj : null;
}

// Pull one frame's geometry out of an ArrayMesh: positions, UVs, indices, and the palette texture the UVs point into.
function frameOf(res, meshObj) {
  const s = meshObj.props["surfaces/0"];
  if (!s || !s.array_data) return null;
  const L = layout(s.format);
  const n = s.vertex_count;
  const d = s.array_data;
  const mat = resolve(res, s.material);
  const tex = mat && resolve(res, mat.props.albedo_texture);
  const img = tex && resolve(res, tex.props.image);
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const b = i * L.stride;
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = d.readFloatLE(b + L.vertex + 4 * k);
    if (L.uv !== undefined) {
      uv[i * 2] = s.format & COMPRESS.UV ? half(d.readUInt16LE(b + L.uv)) : d.readFloatLE(b + L.uv);
      uv[i * 2 + 1] = s.format & COMPRESS.UV ? half(d.readUInt16LE(b + L.uv + 2)) : d.readFloatLE(b + L.uv + 4);
    }
  }
  const idx = new Uint16Array(s.index_count);
  // Godot winds front faces clockwise, three.js counter-clockwise: swap two corners of every triangle so the faces
  // point outwards (otherwise lighting is inverted and the near sides are culled, which shows the inside of the model).
  for (let i = 0; i + 2 < s.index_count; i += 3) {
    idx[i] = s.array_index_data.readUInt16LE(i * 2);
    idx[i + 1] = s.array_index_data.readUInt16LE((i + 2) * 2);
    idx[i + 2] = s.array_index_data.readUInt16LE((i + 1) * 2);
  }
  return { pos, uv, idx, image: img?.props.data ?? null };
}

// Joshua, the man who stares at the mural. The project's own Joshua is Clavicus again in a red coat, so he is made over from that body:
// one standing frame, the crown of his head bare, grey hair left round the sides and back, white brows and beard, a Lightbringer's purple robe (red, blue, purple, white; older is nearer purple) in place of
// the red coat. Everything is done by colour: which palette entry a face points at.
function balding(m) {
  const f = m.frames[0];
  const im = f.image;
  const px = (u, v) => [Math.min(127, Math.floor(u * im.width)), Math.min(127, Math.floor(v * im.height))];
  const at = (x, y) => (y * im.width + x) * 4;
  const colourOf = (x, y) => [im.data[at(x, y)], im.data[at(x, y) + 1], im.data[at(x, y) + 2]].join(",");
  const HAIR = "140,95,77", SKIN = "227,197,193", COAT = "179,32,42";
  const find = (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < im.width; x++) if (colourOf(x, y) === c) return [x, y]; return null; };
  const skin = find(SKIN), hair = find(HAIR), coat = find(COAT);
  if (!skin || !hair || !coat) throw new Error("Joshua's palette is not what it was");
  // A colour appears on many palette pixels; change them all.
  const recolour = (from, rgb) => { for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) if (colourOf(x, y) === from) for (let k = 0; k < 3; k++) im.data[at(x, y) + k] = rgb[k]; };
  // A Lightbringer's colours are red, blue, purple, white, and the older they are the nearer the purple: so a purple robe over white, with blue
  // trim and trousers, and white hair.
  // The hair colour is also the ground of the flame picture on his back, so leave it alone near the purples: hair goes white, the ground stays brown.
  const nearPurple = (x0, y0) => {
    for (let y = Math.max(0, y0 - 3); y <= Math.min(im.height - 1, y0 + 3); y++)
      for (let x = Math.max(0, x0 - 3); x <= Math.min(im.width - 1, x0 + 3); x++) {
        const o = at(x, y);
        if (im.data[o + 2] > im.data[o + 1] + 35 && im.data[o] > im.data[o + 1] + 18) return true;
      }
    return false;
  };
  for (let y = 0; y < im.height; y++)
    for (let x = 0; x < im.width; x++)
      if (colourOf(x, y) === HAIR && !nearPurple(x, y)) for (let k = 0; k < 3; k++) im.data[at(x, y) + k] = [228, 228, 236][k];
  recolour(COAT, [112, 52, 160]);
  recolour("137,166,80", [235, 235, 242]);
  recolour("205,127,50", [60, 95, 205]);
  // Corners are shared with the faces around them, so a face that changes colour gets corners of its own.
  const pos = [...f.pos], uv = [...f.uv];
  const idx = Array.from(f.idx);
  const dot = (i, xy) => {
    pos.push(f.pos[i * 3], f.pos[i * 3 + 1], f.pos[i * 3 + 2]);
    uv.push((xy[0] + 0.5) / im.width, (xy[1] + 0.5) / im.height);
    return pos.length / 3 - 1;
  };
  const hairy = (i) => { const [x, y] = px(f.uv[i * 2], f.uv[i * 2 + 1]); return colourOf(x, y) === "228,228,236"; };
  for (let t = 0; t < f.idx.length; t += 3) {
    const v = [f.idx[t], f.idx[t + 1], f.idx[t + 2]];
    if (!v.every(hairy)) continue;
    const P = (i, k) => f.pos[v[i] * 3 + k];
    const e1 = [0, 1, 2].map((k) => P(1, k) - P(0, k)), e2 = [0, 1, 2].map((k) => P(2, k) - P(0, k));
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const len = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], ny, e1[0] * e2[1] - e1[1] * e2[0]) || 1;
    const cy = (P(0, 1) + P(1, 1) + P(2, 1)) / 3;
    // The crown (the faces on top of the head) is bare skin.
    if (cy > 1.1 && ny / len > 0.5) for (let k = 0; k < 3; k++) idx[t + k] = dot(v[k], skin);
  }
  f.pos = Float32Array.from(pos);
  f.uv = Float32Array.from(uv);
  f.idx = Uint16Array.from(idx);
  m.frames = [f];
  m.meta.animations = {};
}

// The flame on a robe's back is a small picture in the palette (purples on a pale mauve ground); the ground is made brown, like the trim around it.
function brownFlameGround(m) {
  for (const fr of m.frames) {
    const d = fr.image?.data;
    if (!d) continue;
    let purple = false;
    for (let i = 0; i < d.length; i += 4) if (d[i] === 120 && d[i + 1] === 51 && d[i + 2] === 166) { purple = true; break; }
    if (!purple) continue;
    for (let i = 0; i < d.length; i += 4) if (d[i] === 181 && d[i + 1] === 142 && d[i + 2] === 134) { d[i] = 112; d[i + 1] = 72; d[i + 2] = 46; }
  }
}

// Glass: a model drawn with see-through colours (the air crystals) is marked, and its faintest colours are made a little more solid so it can be seen.
function glassy(m) {
  for (const fr of m.frames) {
    const d = fr.image?.data;
    if (!d) continue;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 0 && d[i] < 255) {
        m.translucent = true;
        d[i] = Math.max(d[i], 150);
      }
    }
  }
}

// Clavicus, made younger: the project's own is Joshua's body in a red coat. A Keeper's colours are black, light green, purple, white, and the
// younger, the nearer the black and green: a black robe with light-green trim, a white undershirt, near-black trousers and his own dark hair. One
// standing frame, like the others who stand about.
function youngKeeper(m) {
  const f = m.frames[0];
  const im = f.image;
  const at = (x, y) => (y * im.width + x) * 4;
  const recolour = (from, rgb) => {
    for (let y = 0; y < im.height; y++)
      for (let x = 0; x < im.width; x++) {
        const o = at(x, y);
        if (`${im.data[o]},${im.data[o + 1]},${im.data[o + 2]}` === from) for (let k = 0; k < 3; k++) im.data[o + k] = rgb[k];
      }
  };
  recolour("179,32,42", [26, 26, 34]);
  recolour("205,127,50", [140, 214, 120]);
  recolour("230,120,41", [235, 235, 242]);
  recolour("121,228,232", [36, 34, 46]);
  m.frames = [f];
  m.meta.animations = {};
}

// Stone doors: the project numbers a door's frames from 1 where the converter counts from 0, so the tiles' animations are moved down one (the last
// frame of "close" is the closed wall, our frame 0), and every door gets a "shut" that is simply the closed wall, for a slab that drops into place.
// The rock that holds the pickaxe, the clay pots and the locked gate each have one animation (break, break, open) that runs from whole to broken or
// open; standing in the scene they rest on their first frame, whole and shut, and are only played when something is done to them.
function wholeRock(m) {
  m.meta.animations = { ...(m.meta.animations ?? {}), idle: { start: 0, end: 0, speed: 1, type: 3, sound_effect: null } };
}

function stoneDoor(m, numberedFromOne) {
  const anims = m.meta.animations ?? {};
  if (numberedFromOne) for (const a of Object.values(anims)) { a.start = Math.max(0, a.start - 1); a.end = Math.max(0, a.end - 1); }
  anims.shut = { start: 0, end: 0, speed: 1, type: 3, sound_effect: null };
  m.meta.animations = anims;
}

// ---- textures: every frame has its own palette image, so a model's images are packed into one atlas (a grid of
// 128x128 cells) and each frame's UVs are moved into its cell. The renderer then needs one texture per model.
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function png(width, height, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// Packs the frames' images into an atlas and rewrites their UVs. Returns the PNG, or null if nothing has a texture.
function atlasOf(frames) {
  const cells = new Map();
  const list = [];
  for (const fr of frames) {
    if (!fr.image) continue;
    const key = crypto.createHash("md5").update(fr.image.data).digest("hex");
    if (!cells.has(key)) {
      cells.set(key, list.length);
      list.push(fr.image);
    }
    fr.cell = cells.get(key);
  }
  if (!list.length) return null;
  const w = Math.max(...list.map((im) => im.width)), h = Math.max(...list.map((im) => im.height));
  const cols = Math.min(8, list.length), rows = Math.ceil(list.length / cols);
  const px = new Uint8Array(cols * w * rows * h * 4);
  list.forEach((im, k) => {
    const cx = (k % cols) * w, cy = Math.floor(k / cols) * h;
    for (let y = 0; y < Math.min(h, im.height); y++)
      for (let x = 0; x < Math.min(w, im.width); x++) px.set(im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4), ((cy + y) * cols * w + cx + x) * 4);
  });
  for (const fr of frames) {
    if (fr.cell === undefined) continue;
    const cx = fr.cell % cols, cy = Math.floor(fr.cell / cols);
    // UVs are expected to be 0..1 within their own image; anything else would land in a neighbour's cell.
    for (const v of fr.uv) if (v < -1e-4 || v > 1 + 1e-4) { console.warn(`  warning: UV ${v} outside 0..1 in ${fr.name ?? "a frame"}`); break; }
    for (let i = 0; i < fr.uv.length; i += 2) {
      // An image smaller than the cell only covers part of it.
      fr.uv[i] = (fr.uv[i] * fr.image.width + cx * w) / (cols * w);
      fr.uv[i + 1] = (fr.uv[i + 1] * fr.image.height + cy * h) / (rows * h);
    }
  }
  return png(cols * w, rows * h, px);
}

// Every MeshInstance in a scene's node list, with its properties, in order.
export function sceneNodes(file) {
  const { names, variants, nodes, node_count } = file.resources.at(-1).obj.props._bundled;
  const out = [];
  let i = 0;
  for (let n = 0; n < node_count; n++) {
    const parent = nodes[i++], owner = nodes[i++], type = nodes[i++], name = nodes[i++], inst = nodes[i++];
    const np = nodes[i++];
    const props = {};
    for (let p = 0; p < np; p++) props[names[nodes[i++] & 0x7fffffff]] = variants[nodes[i++]];
    const ng = nodes[i++];
    i += ng;
    out.push({ n, parent, owner, type: inst >= 0 ? "INSTANCE" : names[type & 0x7fffffff], name: names[name & 0x7fffffff], inst: inst >= 0 ? variants[inst & 0x7fffffff] : null, props });
  }
  return out;
}

export function convertModel(file) {
  const f = load(file);
  const res = f.resources;
  const nodes = sceneNodes(f);
  const frames = [];
  for (const nd of nodes) {
    if (nd.type !== "MeshInstance" || !nd.props.mesh) continue;
    const mesh = resolve(res, nd.props.mesh);
    if (!mesh || mesh.type !== "ArrayMesh") continue;
    const fr = frameOf(res, mesh);
    if (!fr) continue;
    frames.push({ ...fr, t: nd.props.transform ?? null, name: nd.name });
  }
  const meta = res.map((r) => r.obj.props.__meta__).find(Boolean) ?? {};
  const root = nodes[0]?.props ?? {};
  return { frames, meta, root };
}

function writeModel(kind, name, m) {
  m.atlas = atlasOf(m.frames);
  const dir = path.join(out, "models", kind);
  fs.mkdirSync(dir, { recursive: true });
  const parts = [];
  let off = 0;
  const push = (arr) => {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    parts.push(buf, Buffer.alloc(pad));
    const at = off;
    off += buf.length + pad;
    return [at, arr.length];
  };
  const frames = m.frames.map((fr) => ({ n: fr.pos.length / 3, pos: push(fr.pos), uv: push(fr.uv), idx: push(fr.idx), t: fr.t, ...(fr.hand ? { hand: fr.hand.map((v) => Math.round(v * 1000) / 1000) } : {}), ...(fr.handL ? { handL: fr.handL.map((v) => Math.round(v * 1000) / 1000) } : {}), ...(fr.top !== undefined ? { top: fr.top } : {}) }));
  const slug = name.replace(/[^A-Za-z0-9_-]+/g, "_");
  fs.writeFileSync(path.join(dir, `${slug}.bin`), Buffer.concat(parts));
  // The Letter is a paper falling, one frame after another, with no animation table: still at first, then it falls once.
  if (name === "Letter" && !Object.keys(m.meta.animations ?? {}).length) m.meta.animations = { idle: { start: 0, end: 0, speed: 4, type: 0 }, fall: { start: 0, end: m.frames.length - 1, speed: 10, type: 3 } };
  const meta = {
    animations: m.meta.animations ?? {},
    passable: m.meta.passable,
    type: m.meta.type,
    grid: [m.root.grid_width, m.root.grid_depth, m.root.grid_height],
  };
  if (m.atlas) fs.writeFileSync(path.join(dir, `${slug}.png`), m.atlas);
  fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify({ name, kind, meta, frames, texture: !!m.atlas, ...(m.translucent ? { translucent: true } : {}) }));
  return { slug, frames: frames.length, bytes: off };
}

// -------------------------------------------------------------------------------------------- maps

const TRANSFORM = (t) => t && t.map((v) => Math.round(v * 1e4) / 1e4);

function convertMap(file) {
  const f = load(file);
  const list = sceneNodes(f);
  const root = list[0].props;
  const items = { tiles: [], objects: [], characters: [] };
  const used = { tiles: new Set(), objects: new Set(), characters: new Set() };
  // Chunk parents carry no transform of their own in these maps, but check, so a surprise is loud.
  const parentT = new Map(list.map((n) => [n.n, n.props.transform]));
  let odd = 0;
  for (const nd of list) {
    if (!nd.inst) continue;
    const p = nd.inst.v?.path;
    const kind = p?.startsWith("tiles/") ? "tiles" : p?.startsWith("objects/") ? "objects" : p?.startsWith("characters/") ? "characters" : null;
    if (!kind) continue;
    const pt = parentT.get(nd.parent);
    if (pt && (pt[9] || pt[10] || pt[11])) odd++;
    const name = p.slice(kind.length + 1, -4);
    used[kind].add(name);
    const pr = nd.props;
    const scripts = (pr.scripts ?? [])
      .map((s) => ({ trigger: s.trigger, name: s.script_name ?? undefined, quick: s.quick_script ?? undefined }))
      .filter((s) => s.name || s.quick);
    items[kind].push({
      m: name,
      id: pr.entity_id ?? undefined,
      x: pr.x, y: pr.y, z: pr.z,
      t: TRANSFORM(pr.transform),
      passable: pr.passable === false ? false : undefined,
      tags: pr.tags?.length ? pr.tags : undefined,
      hidden: pr.hidden ? true : undefined,
      scripts: scripts.length ? scripts : undefined,
      dir: pr.direction ?? undefined,
    });
  }
  const env = f.resources.find((r) => r.obj.type === "Environment")?.obj.props;
  const sky = f.resources.find((r) => r.obj.type === "ProceduralSky")?.obj.props;
  const light = list.find((n) => n.type === "DirectionalLight")?.props;
  return {
    map: {
      tileWidth: root.tile_width,
      music: root.bg_music ?? null,
      player: root.player_override ?? null,
      camera: root.camera_override ?? null,
      preLoad: root.pre_load_script ?? null,
      postLoad: root.post_load_script ?? null,
      sky: sky && { top: sky.sky_top_color, horizon: sky.sky_horizon_color, ground: sky.ground_bottom_color, groundHorizon: sky.ground_horizon_color, sun: sky.sun_color },
      ambient: env?.ambient_light_color,
      light: light && { t: TRANSFORM(light.transform), shadow: light.shadow_color },
      ...items,
    },
    used,
    odd,
  };
}

// The part the game rules need: which cells can be walked on, and what stands where. The cell grid is
// cropped to the tiles, so (0,0) here is the map's (x0, y0). Only the floor layer (z up to `top`) counts.
function gridOf(map, top = 3, bottom = 0) {
  // The floor layer is z 0..top. Anything solid in it blocks its cell, even with a floor underneath (a
  // wall tile sits on a floor tile); water counts as water; otherwise a floor tile makes the cell walkable.
  const tiles = map.tiles.filter((t) => t.z >= bottom && t.z <= top);
  const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
  const rank = { "#": 0, ".": 1, "~": 2 };
  const rows = Array.from({ length: h }, () => Array(w).fill("#"));
  const seen = Array.from({ length: h }, () => Array(w).fill(false));
  for (const t of tiles) {
    const c = t.tags?.includes("water") ? "~" : t.passable === false ? "#" : ".";
    const cx = t.x - x0, cy = t.y - y0;
    if (!seen[cy][cx]) { seen[cy][cx] = true; rows[cy][cx] = c; continue; }
    const cur = rows[cy][cx];
    // Water wins, then a wall over a floor.
    rows[cy][cx] = cur === "~" || c === "~" ? "~" : cur === "#" || c === "#" ? "#" : ".";
  }
  void rank;
  // Tiles only take part in the rules when they do something when stepped on (plates, triggers).
  const active = map.tiles.filter((t) => t.scripts?.length).map((t) => ({ ...t, kind: "tiles" }));
  for (const o of map.objects) if (/bridge/i.test(o.m) && o.z <= top && rows[o.y - y0]?.[o.x - x0] !== undefined) rows[o.y - y0][o.x - x0] = ".";
  const ents = [...map.objects.map((o) => ({ ...o, kind: "objects" })), ...map.characters.map((c) => ({ ...c, kind: "characters" })), ...active]
    .filter((e) => e.z <= top && !e.hidden)
    .map((e) => ({ kind: e.kind, m: e.m, id: e.id, x: e.x - x0, y: e.y - y0, passable: e.passable, scripts: e.scripts, dir: e.dir }));
  return { x0, y0, w, h, rows: rows.map((r) => r.join("")), entities: ents };
}

// Every frame of Mallakoth_red_2 (idle and walk included) faces +z as stored, but the game turns him so his front is -z, so
// the frames are all turned round. The right hand's place in each is worked out first, so a tool in his hand can follow it.
function faceHeroTheSameWay(m) {
  m.frames = m.frames.map((fr) => {
    const h = rightHandOf(fr);
    const l = rightHandOf(fr, "left");
    const out = turnedAround(fr);
    out.hand = h ? [-h[0], h[1], -h[2]] : null;
    out.handL = l ? [-l[0], l[1], -l[2]] : null;
    out.top = topOf(out);
    return out;
  });
}

// The older Mallakoth models face the other way from Mallakoth_red_2: bake the frame's own transform, then turn it half way round.
function turnedAround(fr) {
  const tr = fr.t;
  const pos = new Float32Array(fr.pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    let [x, y, z] = [fr.pos[i], fr.pos[i + 1], fr.pos[i + 2]];
    if (tr) [x, y, z] = [tr[0] * x + tr[1] * y + tr[2] * z + tr[9], tr[3] * x + tr[4] * y + tr[5] * z + tr[10], tr[6] * x + tr[7] * y + tr[8] * z + tr[11]];
    pos[i] = -x; pos[i + 1] = y; pos[i + 2] = -z;
  }
  return { ...fr, pos, t: null };
}

// The pigeon's feet are the triangles at the bottom of its body. It perches on a branch or a head with its feet
// tucked in, so they go: the body then sits right on whatever it is on, instead of floating above it on stilts.
function withoutLegs(fr) {
  // The feet and legs hang below the body (everything up to y 1.75 in the model; the body starts at 1.8), in every frame.
  const idx = [];
  for (let i = 0; i + 2 < fr.idx.length; i += 3) {
    const a = fr.idx[i], b = fr.idx[i + 1], c = fr.idx[i + 2];
    if (Math.max(fr.pos[a * 3 + 1], fr.pos[b * 3 + 1], fr.pos[c * 3 + 1]) <= 1.76) continue;
    idx.push(a, b, c);
  }
  return { ...fr, idx: Uint16Array.from(idx) };
}

// How high a frame reaches (the top of his head), so something riding on it can rise and fall with it.
function topOf(fr) {
  let top = 0;
  for (let i = 1; i < fr.pos.length; i += 3) top = Math.max(top, fr.pos[i]);
  return Math.round(top * 1000) / 1000;
}

// Where Mallakoth's right hand is in a frame (the skin-coloured voxels that aren't his face), so a held tool can follow it.
// Positions are in the frame's own space, before it is turned round.
function rightHandOf(fr, side = "right") {
  const im = fr.image;
  if (!im) return null;
  const tr = fr.t;
  const pts = [];
  for (let i = 0; i < fr.pos.length / 3; i++) {
    const q = (Math.min(im.height - 1, Math.floor(fr.uv[i * 2 + 1] * im.height)) * im.width + Math.min(im.width - 1, Math.floor(fr.uv[i * 2] * im.width))) * 4;
    if (Math.abs(im.data[q] - 255) + Math.abs(im.data[q + 1] - 205) + Math.abs(im.data[q + 2] - 179) > 10) continue;
    let [x, y, z] = [fr.pos[i * 3], fr.pos[i * 3 + 1], fr.pos[i * 3 + 2]];
    if (tr) [x, y, z] = [tr[0] * x + tr[1] * y + tr[2] * z + tr[9], tr[3] * x + tr[4] * y + tr[5] * z + tr[10], tr[6] * x + tr[7] * y + tr[8] * z + tr[11]];
    pts.push([x, y, z]);
  }
  if (!pts.length) return null;
  // The head's skin is the topmost cluster near the middle; hands are the skin away from the body's centre line.
  const sides = pts.filter((p) => Math.abs(p[0]) > 0.12);
  if (!sides.length) return null;
  // Right hand: the side that is +x once the frame is turned round, which is -x as it is stored (and the left hand the other).
  const mine = sides.filter((p) => (side === "right" ? p[0] < 0 : p[0] > 0));
  if (!mine.length) return null;
  const m = mine.reduce((a, p) => [a[0] + p[0] / mine.length, a[1] + p[1] / mine.length, a[2] + p[2] / mine.length], [0, 0, 0]);
  return m;
}

// Copies named animations (their frames, in order) from another model of the same character onto this one.
// A name may end in `!5:6` to leave out those frames of the animation (counted from its first frame).
function borrowAnims(m, file, specs) {
  const other = convertModel(file);
  const anims = other.meta.animations ?? {};
  m.meta.animations = m.meta.animations ?? {};
  for (const spec of specs) {
    const [n, skipList] = spec.split("!");
    const skip = new Set((skipList ?? "").split(":").filter(Boolean).map(Number));
    const a = anims[n];
    if (!a) { console.log(`  borrow: ${n} not found in ${path.basename(file)}`); continue; }
    const step = a.end >= a.start ? 1 : -1;
    const start = m.frames.length;
    for (let i = a.start; step > 0 ? i <= a.end : i >= a.end; i += step) {
      if (skip.has(Math.abs(i - a.start))) continue;
      const h = rightHandOf(other.frames[i]);
      const l = rightHandOf(other.frames[i], "left");
      const out = turnedAround(other.frames[i]);
      out.hand = h ? [-h[0], h[1], -h[2]] : null;
      out.handL = l ? [-l[0], l[1], -l[2]] : null;
      out.top = topOf(out);
      m.frames.push(out);
    }
    m.meta.animations[n] = { ...a, start, end: m.frames.length - 1 };
  }
}

// -------------------------------------------------------------------------------------------- driver

const KINDS = ["tiles", "objects", "characters"];
const want = { tiles: new Set(), objects: new Set(), characters: new Set() };
for (const spec of arg("--models") ?? []) {
  const [kind, name] = spec.split("/");
  want[kind].add(name);
}

const mapNames = all ? fs.readdirSync(path.join(src, "maps")).filter((f) => f.endsWith(".scn") && !f.includes("backup")).map((f) => f.slice(0, -4)) : (arg("--maps") ?? []);
fs.mkdirSync(path.join(out, "maps"), { recursive: true });
for (const m of mapNames) {
  try {
    const { map, used, odd } = convertMap(path.join(src, "maps", `${m}.scn`));
    const slug = m.replace(/[^A-Za-z0-9_-]+/g, "_");
    fs.writeFileSync(path.join(out, "maps", `${slug}.json`), JSON.stringify(map));
    const gridDir = arg("--grid")?.[0];
    if (gridDir) {
      fs.mkdirSync(gridDir, { recursive: true });
      const top = Number(arg("--top")?.[0] ?? 3);
      const body = JSON.stringify(gridOf(map, top, Number(arg("--bottom")?.[0] ?? 0)), null, 1);
      fs.writeFileSync(path.join(gridDir, `${slug}.grid.ts`), `// Generated by tools/mereddia/convert.mjs from the ${m} map. Do not edit by hand.
import type { Grid } from "../world";

export const grid: Grid = ${body};
`);
    }
    for (const k of KINDS) for (const n of used[k]) want[k].add(n);
    console.log(`map ${m}: ${map.tiles.length} tiles, ${map.objects.length} objects, ${map.characters.length} characters${odd ? `, ${odd} nodes under moved parents` : ""}`);
  } catch (e) {
    console.log(`map ${m}: skipped (${e.message})`);
  }
}

let total = 0;
for (const kind of KINDS) {
  for (const name of want[kind]) {
    const file = path.join(src, kind, `${name}.scn`);
    if (!fs.existsSync(file)) { console.log(`${kind}/${name}: missing`); continue; }
    try {
      const m = convertModel(file);
      if (name === "Pigeon") m.frames = m.frames.map(withoutLegs);
      if (name === "Mallakoth_red_2") faceHeroTheSameWay(m);
      brownFlameGround(m);
      glassy(m);
      if (kind === "tiles" && /door/.test(name)) stoneDoor(m, true);
      if (kind === "objects" && /^knowledge_exit_\d$/.test(name)) stoneDoor(m, false);
      if (kind === "objects" && /^(boulder|pot|Locked_door)$/.test(name)) wholeRock(m);
      if (name === "Joshua") balding(m);
      if (name === "Clavicus") youngKeeper(m);
      // --borrow "characters/Mallakoth_red=catch+axe_grab>characters/Mallakoth_red_2": animations another model has.
      for (const spec of arg("--borrow") ?? []) {
        const [from, rest2] = spec.split("=");
        const [names, target] = rest2.split(">");
        if (target === `${kind}/${name}`) borrowAnims(m, path.join(src, `${from}.scn`), names.split("+"));
      }
      if (!m.frames.length) { console.log(`${kind}/${name}: no voxel frames`); continue; }
      const w = writeModel(kind, name, m);
      total += w.bytes;
      console.log(`${kind}/${name}: ${w.frames} frames, ${(w.bytes / 1024).toFixed(0)} KB`);
    } catch (e) {
      console.log(`${kind}/${name}: skipped (${e.message})`);
    }
  }
}
console.log(`models: ${(total / 1024 / 1024).toFixed(1)} MB`);
