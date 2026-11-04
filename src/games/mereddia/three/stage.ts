import * as THREE from "three";
import { ParticleEffect, loadEffect } from "./effects";
import { loadModel, slug, type Model } from "./models";

// Journey Across Mereddia in 3D: your own maps, rendered the way the project builds them. Tiles are
// 0.8 units wide voxel blocks placed on a grid; objects and characters are voxel models that play
// their frame animations. The sky and sun come from the map's own environment settings.

export type Placed = {
  m: string;
  id?: string;
  x: number;
  y: number;
  z: number;
  t: number[] | null;
  passable?: boolean;
  tags?: string[];
  hidden?: boolean;
  scripts?: { trigger: number; name?: string; quick?: string }[];
  dir?: string;
};
export type MapData = {
  tileWidth: number;
  music: string | null;
  player: string | null;
  camera: string | null;
  postLoad: string | null;
  sky?: { top: number[]; horizon: number[]; ground: number[]; groundHorizon: number[]; sun: number[] };
  ambient?: number[];
  light?: { t: number[] };
  tiles: Placed[];
  objects: Placed[];
  characters: Placed[];
};

export const TILE = 0.8;
// Tiles the game steps through, instead of letting them play.
const STILL = new Set(["wooden_floor_with_trap"]);
// An effect that should be playing: where, in what tint and size, and for how long if it's a one-off.
export type EffectWant = { key: string; name: string; x: number; z: number; y?: number; tint?: [number, number, number]; size?: number; duration?: number; stand?: boolean; hand?: string };
export type Desired = { key: string; restAnim?: string; drop?: number; opacity?: number; xray?: boolean; kind: "characters" | "objects" | "tiles"; name: string; x: number; z: number; y?: number; rotY: number; scale: number; anim?: string; shot?: { name: string; n: number }; glide?: number; moveAnim?: string; bob?: number; rideOn?: string };
type Live = { fall?: { from: number; t: number }; want: Desired; pos: THREE.Vector3; rot: number; loading: boolean; actor?: Actor; shotN?: number; speed?: number; moving?: number; long?: boolean };
const rgb = (c: number[]) => `rgb(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(",")})`;
// Godot stores a transform as a 3x3 basis in rows, then the origin.
export const matrixOf = (t: number[]) => new THREE.Matrix4().set(t[0], t[1], t[2], t[9], t[3], t[4], t[5], t[10], t[6], t[7], t[8], t[11], 0, 0, 0, 1);

// A model in the scene, with a current animation.

// The valley's rim as real mountains. Every cell the map fills with the given wall tiles is mountain; its
// height grows with its distance from the open valley, with some bumps, and a ring of extra mountain
// surrounds the whole map so the peaks go on past the edge. Snow settles on the high ground.
function buildMountains(map: MapData, models: string[], material: THREE.Material): THREE.Mesh {
  const wall = new Set<string>();
  const open = new Set<string>();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of map.tiles) {
    minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x); minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    if (models.includes(t.m)) wall.add(`${t.x},${t.y}`);
    else if (t.z <= 3) open.add(`${t.x},${t.y}`);
  }
  const RING = 14;
  // Distance from open ground, by a sweep outward from every open cell.
  const dist = new Map<string, number>();
  const queue: [number, number][] = [];
  for (const k of open) {
    dist.set(k, 0);
    queue.push(k.split(",").map(Number) as [number, number]);
  }
  const inside = (x: number, y: number) => x >= minX - RING && x <= maxX + RING && y >= minY - RING && y <= maxY + RING;
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    const d = dist.get(`${x},${y}`)!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (!inside(nx, ny) || dist.has(k) || open.has(k)) continue;
      dist.set(k, d + 1);
      queue.push([nx, ny]);
    }
  }
  const noise = (x: number, y: number) => {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  // Smooth value noise, so the ridges roll instead of jitter.
  const smooth = (x: number, y: number) => {
    const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy;
    const s = (v: number) => v * v * (3 - 2 * v);
    const a = noise(fx, fy), b = noise(fx + 1, fy), c = noise(fx, fy + 1), d = noise(fx + 1, fy + 1);
    return a + (b - a) * s(tx) + (c - a) * s(ty) + (a - b - c + d) * s(tx) * s(ty);
  };
  const cellHeight = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (open.has(k)) return 0;
    const d = dist.get(k);
    if (d === undefined || !inside(x, y)) return 0;
    const ridge = smooth(x * 0.3, y * 0.3) * 4.2 + smooth(x * 0.85, y * 0.85) * 1.4;
    // The camera looks north from the south, so the near side stays foothills and the far sides rise to peaks.
    const t = (y - (minY + maxY) / 2) / ((maxY - minY) / 2 + RING);
    const near = t > 0 ? 1 - 0.78 * Math.min(1, t * 1.15) : 1;
    return Math.min(15, (0.4 + d * 0.9 + ridge * Math.min(1, d / 3)) * near);
  };
  const corner = (cx: number, cy: number) => (cellHeight(cx - 1, cy - 1) + cellHeight(cx, cy - 1) + cellHeight(cx - 1, cy) + cellHeight(cx, cy)) / 4;
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const rock = [new THREE.Color("#6d6a73"), new THREE.Color("#85818a"), new THREE.Color("#9a968f")];
  const snow = new THREE.Color("#f3f6fb");
  const push = (x: number, z: number, h: number, shade: number) => {
    pos.push(x * TILE, h, z * TILE);
    // Rock darker low and lighter up high; snow above the snowline, blended over a band.
    const f = Math.min(1, h / 10);
    c.copy(rock[0]).lerp(rock[1], f).lerp(rock[2], noise(x, z) * 0.5);
    c.lerp(snow, Math.min(1, Math.max(0, (h - 7.2) / 2)));
    c.multiplyScalar(0.82 + shade * 0.3);
    col.push(c.r, c.g, c.b);
  };
  for (let y = minY - RING; y <= maxY + RING; y++)
    for (let x = minX - RING; x <= maxX + RING; x++) {
      const k = `${x},${y}`;
      if (open.has(k) || !(wall.has(k) || dist.has(k))) continue;
      const h00 = corner(x, y), h10 = corner(x + 1, y), h01 = corner(x, y + 1), h11 = corner(x + 1, y + 1);
      if (h00 + h10 + h01 + h11 < 0.01) continue;
      const sh = noise(x * 3.1, y * 1.7);
      // Split each cell along the shorter diagonal so ridges stay sharp.
      if (Math.abs(h00 - h11) < Math.abs(h10 - h01)) {
        push(x, y, h00, sh), push(x, y + 1, h01, sh), push(x + 1, y + 1, h11, sh);
        push(x, y, h00, sh), push(x + 1, y + 1, h11, sh), push(x + 1, y, h10, sh);
      } else {
        push(x, y, h00, sh), push(x, y + 1, h01, sh), push(x + 1, y, h10, sh);
        push(x + 1, y, h10, sh), push(x, y + 1, h01, sh), push(x + 1, y + 1, h11, sh);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  return mesh;
}

export class Actor {
  mesh: THREE.Mesh;
  private clock = 0;
  private anim = "";
  // A gesture played once, on top of whatever loops underneath.
  private once = "";
  private onceClock = 0;
  // The axe in Mallakoth's hand during a swing: the project attaches an "axe2" object to his right hand, and the model
  // has no hand to follow, so the axe is carried on an arc that matches the swing's wind-up, strike and follow-through.
  held?: THREE.Object3D;
  // The pickaxe in his hand while he swings it.
  heldPick?: THREE.Object3D;
  // The letter in his hand while he burns it: the project's lined sheet of paper (note2), which has its own burning animation.
  letter?: { grip: THREE.Object3D; paper: Actor };
  constructor(readonly model: Model, material: THREE.Material) {
    this.mesh = new THREE.Mesh(model.frames[0], material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }
  play(name: string) {
    if (this.model.animations[name]) {
      if (this.anim !== name) this.clock = 0;
      this.anim = name;
    }
  }
  get playing() {
    return this.anim;
  }
  playOnce(name: string) {
    if (this.model.animations[name]) {
      this.once = name;
      this.onceClock = 0;
      if (this.held) this.held.visible = name === "swing_axe";
      if (this.heldPick) this.heldPick.visible = name === "pick_attack1";
      if (this.letter && name === "fire") this.letter.paper.playOnce("fire");
    }
  }
  update(dt: number) {
    // The flame on a back flickers while its wearer does anything but stand.
    this.model.flame?.advance(dt, !!this.once || (this.anim !== "idle" && this.anim !== ""));
    if (this.once) {
      const g = this.model.animations[this.once];
      this.onceClock += dt * g.speed;
      const span = Math.abs(g.end - g.start) + 1;
      if (this.once === "swing_axe" && this.held) {
        const p = Math.min(1, this.onceClock / span);
        this.held.visible = p < 1;
        // The grip follows the right hand through the swing's own frames (where the model has one), and the axe tips
        // up and back, chops forward and down, then settles.
        const f = Math.min(g.start + Math.floor(this.onceClock), this.model.frames.length - 1);
        let hand: [number, number, number] | null | undefined = this.model.hands?.[f];
        for (let k = f; !hand && k >= g.start; k--) hand = this.model.hands?.[k];
        if (hand) this.held.position.set(hand[0], hand[1], hand[2]);
        // A sideways swing: out to his right, then a flat sweep across the front to his left, and a settle.
        this.held.rotation.y = p < 0.3 ? THREE.MathUtils.lerp(-0.9, -1.4, p / 0.3) : p < 0.65 ? THREE.MathUtils.lerp(-1.4, 1.0, (p - 0.3) / 0.35) : THREE.MathUtils.lerp(1.0, 0.7, (p - 0.65) / 0.35);
      }
      if ((this.once === "pick_attack1" || this.once === "pick_grab") && this.heldPick) {
        const p = Math.min(1, this.onceClock / span);
        const swing = this.once === "pick_attack1";
        // Taking it from the rock: the pick comes out of the rock into his hand once he has reached it (the hands of those frames are not known, so
        // it is carried across rather than tracked). Swinging it: always.
        this.heldPick.visible = p < 1 && (swing || p > 0.35);
        if (swing) {
          // The grip follows the right hand through the animation's own frames.
          const f = Math.min(g.start + Math.floor(this.onceClock), this.model.frames.length - 1);
          let hand: [number, number, number] | null | undefined = this.model.hands?.[f];
          for (let k = f; !hand && k >= g.start; k--) hand = this.model.hands?.[k];
          if (hand) this.heldPick.position.set(hand[0], hand[1], hand[2]);
          // How far it tips, frame by frame, chosen so it clears his head and body: it rests pointing forward and down, comes up and back over his
          // shoulder, then down in front of him. (He faces -z, so forward is the negative direction.)
          const key = [-0.7, 0.2, 0.7, 0.6, 0, -1.2, -1.3, -1.2, -1.0];
          const at = Math.min(key.length - 1, Math.max(0, p * key.length - 0.5));
          const i = Math.floor(at);
          this.heldPick.rotation.x = THREE.MathUtils.lerp(key[i], key[Math.min(key.length - 1, i + 1)], at - i);
        } else {
          // It comes out of the rock (the cell in front of him, a tile ahead, the pick standing in it at about waist height) and up to his side, so
          // it is not suddenly in his hand: carried over the middle of the animation, easing out.
          const k = Math.min(1, Math.max(0, (p - 0.35) / 0.5));
          const e = k * k * (3 - 2 * k);
          this.heldPick.position.set(THREE.MathUtils.lerp(0, 0.32, e), THREE.MathUtils.lerp(0.75, 0.7, e), THREE.MathUtils.lerp(-0.8, -0.05, e));
          this.heldPick.rotation.x = THREE.MathUtils.lerp(-1.1, -0.3, e);
        }
      }
      if (this.letter) {
        const on = this.once === "fire" && this.onceClock < span;
        this.letter.grip.visible = on;
        if (on) {
          const f = Math.min(g.start + Math.floor(this.onceClock), this.model.frames.length - 1);
          let hand: [number, number, number] | null | undefined = this.model.handsL?.[f];
          for (let k = f; !hand && k >= g.start; k--) hand = this.model.handsL?.[k];
          if (hand) this.letter.grip.position.set(hand[0], hand[1], hand[2]);
        }
      }
      if (this.onceClock >= span) {
        this.once = "";
        if (this.held) this.held.visible = false;
        if (this.heldPick) this.heldPick.visible = false;
        if (this.letter) this.letter.grip.visible = false;
      } else {
        const i = Math.floor(this.onceClock);
        const f = g.start <= g.end ? g.start + i : g.start - i;
        const geo = this.model.frames[Math.min(f, this.model.frames.length - 1)];
        if (this.mesh.geometry !== geo) this.mesh.geometry = geo;
        return;
      }
    }
    const a = this.model.animations[this.anim];
    if (!a || this.model.frames.length < 2) return;
    const lo = Math.min(a.start, a.end);
    const hi = Math.max(a.start, a.end);
    this.clock += dt * a.speed;
    const span = hi - lo + 1;
    let i = Math.floor(this.clock);
    // Type 3 plays once and holds the last frame; the rest loop.
    i = a.type === 3 ? Math.min(i, span - 1) : i % span;
    const f = a.start <= a.end ? lo + i : hi - i;
    const g = this.model.frames[Math.min(f, this.model.frames.length - 1)];
    if (this.mesh.geometry !== g) this.mesh.geometry = g;
  }
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  readonly actors: Actor[] = [];
  readonly focus = new THREE.Vector3();
  private raf = 0;
  private last = 0;
  private ro: ResizeObserver;
  private root = new THREE.Group();
  private focusTarget = new THREE.Object3D();
  private sun?: THREE.DirectionalLight;
  // Roofs and upper walls, hidden while the hero is inside a building so the room can be seen.
  private high: THREE.Object3D[] = [];
  // Tiles that don't animate by themselves but are scrubbed through their frames by the game (the spike floor).
  // Chop marks on the old tree, and the shudder of a hit.
  private damage = new Map<string, THREE.Group>();
  private shakes = new Map<Actor, number>();
  private scrub = new Map<string, { actors: Actor[]; now: number; want: number }>();
  private scenery = new Map<string, Actor>();
  // The floor's pressure plates, by "model@x,y".
  private plates = new Map<string, Actor>();
  // Where the window in the boulder goes: the hero's place on the screen, in pixels, and how wide.
  private hole = { value: new THREE.Vector3(-1e5, -1e5, 0) };
  private holeDepth = { value: 0 };
  private live = new Map<string, Live>();
  private markers = new THREE.Group();
  private fxGroup = new THREE.Group();
  private steady = new Map<string, { eff: ParticleEffect; want: EffectWant }>();
  // Effects the map itself calls for (the lit sconces), and the ones the game last asked for.
  private mapFx: EffectWant[] = [];
  private lastFx: EffectWant[] = [];
  private bursts: ParticleEffect[] = [];
  // Effects that stay on somebody's held paper (a flame at the lower hand), by the key of whoever holds it.
  private onHand = new Map<ParticleEffect, { key: string; lift: number }>();
  private burstSeen = new Set<string>();
  private follow?: Live;
  // A cutscene's camera: it goes to a place (or follows somebody) over a few seconds, and may shake.
  private cam?: { from: THREE.Vector3; fromDist: number; fromPitch: number; to: { key?: string; x: number; z: number }; dist: number; pitch: number; t: number; dur: number; shake: number };
  private scripted = false;
  onFrame?: (dt: number) => void;
  distance = 12.5;
  pitch = 1.0;
  // Third-person camera: it looks a little ahead of whoever it follows, and swings a touch towards where they head.
  readonly lead = new THREE.Vector3();
  // Over the shoulder: the whole view slides sideways, so the hero stands to the left of the middle and the way ahead is clear.
  shoulder = 0;
  // Whether the camera swings round to stay behind the hero, rather than always looking north.
  followYaw = false;
  private shoulderNow = 0;
  private leadNow = new THREE.Vector3();
  private yaw = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.add(this.root, this.markers, this.fxGroup);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // `mountains` names the wall tiles to draw as real mountains instead of blocks.
  // `cutZ` drops every tile from that height up (the caves' ceilings), so the rooms can be seen into.
  async loadMap(name: string, mountains: string[] = [], cutZ = Infinity): Promise<MapData> {
    const map = (await (await fetch(`/mereddia/3d/maps/${slug(name)}.json`)).json()) as MapData;
    this.root.clear();
    this.actors.length = 0;
    this.scenery.clear();
    this.plates.clear();
    this.live.clear();
    this.high = [];
    this.scrub.clear();
    this.mapFx = [];
    this.setEffects([]);
    // Ready for the first swing of the axe.
    void loadModel("objects", "axe");
    void loadModel("objects", "note2");
    this.lighting(map);
    this.keepIn = undefined;
    if (this.summer) this.edgeFog(map);

    // Tiles with one frame are drawn instanced, a model at a time; the few animated ones get their own mesh.
    const byModel = new Map<string, Placed[]>();
    // Tiles above the first storey are kept apart, so they can be hidden when the hero goes indoors.
    const upper = (t: Placed) => t.z >= 17;
    for (const t of map.tiles) if (!mountains.includes(t.m) && t.z < cutZ && !(name === "Caves" && t.m === "carpet")) (byModel.get(`${t.m}|${upper(t) ? 1 : 0}`) ?? byModel.set(`${t.m}|${upper(t) ? 1 : 0}`, []).get(`${t.m}|${upper(t) ? 1 : 0}`)!).push(t);
    if (mountains.length) this.root.add(buildMountains(map, mountains, this.material));
    await Promise.all(
      [...byModel].map(async ([key, list]) => {
        const m = key.split("|")[0];
        const high = key.endsWith("|1");
        const model = await loadModel("tiles", m);
        if (!model) return;
        if (model.frames.length === 1) {
          const inst = new THREE.InstancedMesh(model.frames[0], this.see(model.material, 0.45), list.length);
          const c = new THREE.Color();
          list.forEach((p, i) => {
            inst.setMatrixAt(i, matrixOf(p.t!));
            // A little brightness and hue drift per tile, so open ground reads as painted, not printed.
            const n = Math.sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453;
            const r = n - Math.floor(n);
            c.setHSL(0.02 * (r - 0.5), 0.1 * (r - 0.5), 1 + 0.16 * (r - 0.5));
            c.setRGB(1 + 0.22 * (r - 0.5), 1 + 0.14 * (r - 0.5), 1 + 0.3 * (r - 0.5));
            inst.setColorAt(i, c);
          });
          inst.instanceMatrix.needsUpdate = true;
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
          inst.receiveShadow = true;
          this.root.add(inst);
          if (high) this.high.push(inst);
        } else {
          for (const p of list) {
            const a = new Actor(model, this.see(model.material, 0.45));
            a.mesh.applyMatrix4(matrixOf(p.t!));
            if (m.startsWith("Pressure_plate")) {
              // A plate stands up, in the project's own stone, until somebody stands on it.
              a.play("plate_up");
              this.plates.set(`${p.m}@${p.x},${p.y}`, a);
            } else if (STILL.has(m)) (this.scrub.get(m) ?? this.scrub.set(m, { actors: [], now: 0, want: 0 }).get(m)!).actors.push(a);
            else a.play(Object.keys(model.animations)[0] ?? "");
            this.root.add(a.mesh);
            this.actors.push(a);
            if (high) this.high.push(a.mesh);
          }
        }
      }),
    );
    await Promise.all(
      [...map.objects.map((o) => ["objects", o] as const), ...map.characters.map((c) => ["characters", c] as const)].map(async ([kind, p]) => {
        if (p.hidden) return;
        const model = await loadModel(kind, p.m);
        if (!model) return;
        const a = this.spawn(model);
        a.mesh.applyMatrix4(matrixOf(p.t!));
        a.play(model.animations.idle ? "idle" : (Object.keys(model.animations)[0] ?? ""));
        this.scenery.set(`${p.m}@${p.x},${p.y}`, a);
        if (p.m === "skeleton" && p.t) void this.dress(p.t);
        // A lit sconce burns.
        if (p.m === "sconce" && p.t) this.mapFx.push({ key: `sconce${p.x},${p.y},${p.z}`, name: "fire", x: p.t[9], z: p.t[11], y: p.t[10] + 0.3, size: 1.2 });
        // The irori hearth burns too, low and warm.
        if (p.m === "ptrn_tradjp_AT_irori_fire" && p.t) this.mapFx.push({ key: `irori${p.x},${p.y}`, name: "ptrn_tradjp_EF_irori_fire", x: p.t[9], z: p.t[11], y: p.t[10] + 0.15, size: 1.3 });
      }),
    );
    this.setEffects(this.lastFx);
    return map;
  }

  // A small bare patch of ground under the project's sky, for fights.
  loadArena(cave = false) {
    this.root.clear();
    this.actors.length = 0;
    this.scenery.clear();
    this.plates.clear();
    this.live.clear();
    this.high = [];
    const sky = cave
      ? { top: [0.08, 0.07, 0.1], horizon: [0.2, 0.18, 0.22], ground: [0.1, 0.09, 0.08], groundHorizon: [0.2, 0.18, 0.2], sun: [1, 0.85, 0.7] }
      : { top: [0.047, 0.455, 0.977], horizon: [0.557, 0.824, 0.91], ground: [0.102, 0.188, 0.165], groundHorizon: [0.482, 0.953, 0.855], sun: [1, 0.863, 0.502] };
    this.lighting({ tileWidth: 16, music: null, player: null, camera: null, postLoad: null, sky, ambient: [0.75, 0.75, 0.75], tiles: [], objects: [], characters: [] });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(5.5, 40), new THREE.MeshLambertMaterial({ color: cave ? "#4a443e" : "#2f7a35" }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.root.add(floor);
  }

  spawn(model: Model): Actor {
    const a = new Actor(model, model.material);
    this.root.add(a.mesh);
    this.actors.push(a);
    return a;
  }

  // Set before loading a map: a bright summer's day instead of the map's own sky.
  summer = false;
  private skyCss = "";
  private cinema = false;
  // In a cutscene whatever lies beyond the edge of the world is black, like the bars, never a band of sky.
  setCinema(on: boolean) {
    this.cinema = on;
    (this.canvas.parentElement ?? this.canvas).style.background = on || !this.skyCss ? "#000" : this.skyCss;
  }

  // Layered haze round the map's edge: a few thin curtains one tile apart, each a little thicker than the one before it, so the
  // air thickens over the last few tiles until it is a soft wall rather than an edge. Only the outermost few tiles of it.
  private keepIn?: { l: number; r: number; t: number; b: number };
  private edgeFog(map: MapData) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const t of map.tiles) {
      if (t.z > 3) continue;
      x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); z0 = Math.min(z0, t.y); z1 = Math.max(z1, t.y);
    }
    if (!Number.isFinite(x0)) return;
    const hz = map.sky ? map.sky.horizon : [0.55, 0.82, 0.9];
    const css = `rgb(${hz.slice(0, 3).map((v) => Math.round(v * 255)).join(",")}`;
    const cv = document.createElement("canvas");
    cv.width = 4;
    cv.height = 64;
    const g = cv.getContext("2d");
    if (!g) return;
    const grad = g.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, `${css},1)`);
    grad.addColorStop(0.7, `${css},0.9)`);
    grad.addColorStop(1, `${css},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
    const tex = new THREE.CanvasTexture(cv);
    // Many thin curtains, each barely denser than the last, so there is no visible step between them.
    // Many thin curtains over about six tiles, each barely denser than the last (a smooth curve, so no visible steps).
    const N = 24;
    const LAYERS_SPAN = TILE * 5.6;
    const GAP = LAYERS_SPAN / (N - 1);
    const LAYERS = Array.from({ length: N }, (_, i) => 0.02 + 0.5 * Math.pow(i / (N - 1), 3.2));
    const H = 7;
    const left = x0 * TILE, right = (x1 + 1) * TILE, top = z0 * TILE, bottom = (z1 + 1) * TILE;
    const w = right - left + 12, d = bottom - top + 12;
    const room = LAYERS_SPAN + 0.3;
    this.keepIn = { l: left + room, r: right - room, t: top + room, b: bottom - room };
    LAYERS.forEach((opacity, i) => {
      // The first layer stands three tiles in from the edge, the last right on it.
      const inset = (LAYERS.length - 1 - i) * GAP;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, fog: false, side: THREE.DoubleSide });
      const sides: [number, number, number, number][] = [
        [(left + right) / 2, top + inset, w, 0],
        [(left + right) / 2, bottom - inset, w, 0],
        [left + inset, (top + bottom) / 2, d, Math.PI / 2],
        [right - inset, (top + bottom) / 2, d, Math.PI / 2],
      ];
      for (const [x, z, len, rot] of sides) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), mat);
        m.position.set(x, H / 2 - 0.2, z);
        m.rotation.y = rot;
        m.renderOrder = 5 + i;
        this.root.add(m);
      }
    });
  }

  private lighting(map: MapData) {
    // The map's own sky and haze: its horizon colour is what the distance fades into, with the sky's blue above it.
    const horizon = map.sky ? rgb(map.sky.horizon) : "#8ccfe8";
    const top = map.sky ? rgb(map.sky.top) : "#3b86e8";
    this.skyCss = `linear-gradient(to bottom, ${top} 0%, ${horizon} 70%)`;
    (this.canvas.parentElement ?? this.canvas).style.background = this.cinema ? "#000" : this.skyCss;
    this.scene.fog = new THREE.Fog(new THREE.Color(map.sky ? map.sky.horizon[0] : 0.55, map.sky ? map.sky.horizon[1] : 0.82, map.sky ? map.sky.horizon[2] : 0.9), 14, 34);
    const gcol = map.sky ? map.sky.ground : [0.1, 0.19, 0.16];
    // The summer field's ground is the grass's own green, so the hairline gaps between rows of tiles don't show as dark seams.
    const far = this.summer ? new THREE.Color("#1c6d25") : new THREE.Color(gcol[0] * 1.6, gcol[1] * 1.8, gcol[2] * 1.6);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: far }));
    ground.rotation.x = -Math.PI / 2;
    // Under the lowest tile, so a treehouse's forest floor isn't buried.
    ground.position.y = Math.min(-0.02, Math.min(0, ...map.tiles.map((p) => (p.t ? p.t[10] : 0))) - 0.03);
    this.root.add(ground);
    const amb = map.ambient ?? [0.75, 0.75, 0.75];
    this.root.add(new THREE.AmbientLight(new THREE.Color(amb[0], amb[1], amb[2]), this.summer ? 1.9 : 1.15));
    // The project's sun shines straight down; tilt it a little so the sides of the blocks catch the light.
    const sun = new THREE.DirectionalLight(map.sky ? new THREE.Color(map.sky.sun[0], map.sky.sun[1], map.sky.sun[2]) : 0xfff0d0, this.summer ? 2.4 : 1.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -14;
    sc.right = sc.top = 14;
    sc.far = 60;
    // Without a little bias the far ground, seen at a slant, shadows itself in thin dark streaks.
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
    sun.target = this.focusTarget;
    this.root.add(sun, this.focusTarget);
    this.sun = sun;
  }


  // Where a still tile is in its animation, 0 (at rest) to 1 (the end): the spikes rising.
  setTileFrame(model: string, t: number) {
    const s = this.scrub.get(model);
    if (s) s.want = Math.max(0, Math.min(1, t));
  }

  // Pale notches cut into the trunk's south face (and chips on the ground below) for each chop it has taken: `level` 0..2.
  setDamage(key: string, x: number, z: number, level: number) {
    let g = this.damage.get(key);
    if (g && !g.parent) {
      this.damage.delete(key);
      g = undefined;
    }
    if (!level) {
      if (g) g.visible = false;
      return;
    }
    if (!g) {
      g = new THREE.Group();
      const pale = new THREE.MeshLambertMaterial({ color: "#dcb67a" });
      const dark = new THREE.MeshLambertMaterial({ color: "#2e1b0e" });
      const part = (min: number, geo: THREE.BoxGeometry, mat: THREE.Material, px: number, py: number, pz: number) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px, py, pz);
        m.userData.level = min;
        g!.add(m);
      };
      // First chop: a notch. Second: a deeper, wider one lower down, and chips on the grass.
      part(1, new THREE.BoxGeometry(0.46, 0.17, 0.05), pale, 0, 0.8, 0);
      part(1, new THREE.BoxGeometry(0.34, 0.07, 0.07), dark, 0, 0.8, 0);
      part(2, new THREE.BoxGeometry(0.56, 0.2, 0.05), pale, 0, 0.52, 0);
      part(2, new THREE.BoxGeometry(0.44, 0.1, 0.07), dark, 0, 0.52, 0);
      for (const [cx, cz] of [[-0.25, 0.25], [0.1, 0.4], [0.3, 0.2], [-0.05, 0.55]]) part(2, new THREE.BoxGeometry(0.07, 0.05, 0.07), pale, cx, 0.06, cz);
      for (const c of g.children) c.castShadow = true;
      this.root.add(g);
      this.damage.set(key, g);
    }
    g.position.set(x, 0, z);
    g.visible = true;
    for (const c of g.children) c.visible = c.userData.level <= level;
  }

  // A map's own scenery (by "model@x,y") shudders as if struck.
  shudder(key: string) {
    const a = this.scenery.get(key);
    if (a) this.shakes.set(a, 0);
  }

  // Take the roof off: upper walls and roofs vanish while the hero is inside a building.
  setIndoors(indoors: boolean) {
    for (const o of this.high) o.visible = !indoors;
  }

  // Show or hide the map's own scenery by "model@x,y": the sword on the statue, a tree that has been felled,
  // an NPC that the game rules draw themselves.
  setHidden(keys: Set<string>) {
    for (const [k, a] of this.scenery) a.mesh.visible = !keys.has(k);
  }

  // A skeleton lies in the cave as the project left it, headless: give it its skull (modelled to sit on it), and a pickaxe lying at its feet, as a hint.
  private async dress(t: number[]) {
    const [skull, pick] = await Promise.all([loadModel("objects", "skull"), loadModel("objects", "pickaxe")]);
    const base = matrixOf(t);
    if (skull) {
      // The skull was modelled in a place of its own (centre 0.17, 0.8, -0.37); it goes on the neck (about -0.10, 0.75, -0.72), nodding a little
      // forward and over to one side.
      const centre = new THREE.Vector3(0.17, 0.8, -0.37);
      const on = new THREE.Matrix4()
        .makeTranslation(-0.1, 0.75, -0.72)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.3, 0, 0.12)))
        .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
      const a = this.spawn(skull);
      a.mesh.applyMatrix4(base.clone().multiply(on));
    }
    if (pick) {
      // Across its lap: the handle along the thighs, the head across them, a little shorter than life so it does not stick out past the knees, and slimmed (its thin side is what stands up from the lap).
      const a = this.spawn(pick);
      const local = new THREE.Matrix4().compose(new THREE.Vector3(-0.19, 0.2, -0.68), new THREE.Quaternion(0.5, 0.5, 0.5, 0.5), new THREE.Vector3(0.4, 0.7, 0.7));
      a.mesh.applyMatrix4(base.clone().multiply(local));
    }
  }

  // The plate somebody is standing on (by "model@x,y") sinks; the rest stand up.
  setPressed(key?: string) {
    for (const [k, a] of this.plates) a.play(k === key ? "plate_down" : "plate_up");
  }

  // A door built of map objects (by "model@x,y") swings open, the project's own animation.
  openScenery(keys: string[]) {
    this.playScenery(keys, "open");
  }

  // Any of the map's own animated scenery (by "model@x,y"): the rock that holds the pickaxe breaking up, say.
  playScenery(keys: string[], anim: string) {
    for (const k of keys) this.scenery.get(k)?.play(anim);
  }

  // The sheet of paper he burns, held in his right hand.
  private async giveLetter(a: Actor) {
    if (a.letter) return;
    const m = await loadModel("objects", "note2");
    if (!m || a.letter) return;
    const paper = new Actor(m, m.material);
    // The model's sheet floats 2.375 above its origin and is 1.6 wide: bring it to the origin and make it hand-sized, then
    // stand it up so its face looks at whoever is in front of him.
    // It is held by the middle of its lower edge (model 0, 2.375, -0.8), which is what sits in the hand; the sheet stands up
    // from there. Hand-sized: the model's sheet is 1.6 wide.
    const s = 0.14;
    paper.mesh.scale.setScalar(s);
    paper.mesh.position.set(0, -2.375 * s, 0.8 * s);
    const grip = new THREE.Group();
    grip.rotation.x = -Math.PI / 2;
    const tilt = new THREE.Group();
    tilt.add(paper.mesh);
    grip.add(tilt);
    const holder = new THREE.Group();
    holder.add(grip);
    holder.visible = false;
    a.mesh.add(holder);
    this.actors.push(paper);
    a.letter = { grip: holder, paper };
  }

  // The pickaxe, gripped low on its handle with the head up, and swung over his shoulder and down.
  private async givePick(a: Actor) {
    if (a.heldPick) return;
    const pick = await loadModel("objects", "pickaxe");
    if (!pick || a.heldPick) return;
    const mesh = new THREE.Mesh(pick.frames[0], pick.material);
    mesh.castShadow = true;
    // The model's handle runs along z, from the head at z -0.2 to its free end at z 0.4 (centre y 0.33, x 0), and the curved head spans y.
    // He holds it by the free end of the handle (moved to the origin), turned a quarter so the handle stands up, head on top, and the
    // head's sweep points forward, where the swing goes.
    mesh.position.set(0, -0.33, -0.3);
    const stand = new THREE.Group();
    stand.rotation.x = Math.PI / 2;
    stand.add(mesh);
    // Slim and not long: x is its thin side.
    const size = new THREE.Group();
    size.scale.set(0.45, 0.75, 0.75);
    size.add(stand);
    const grip = new THREE.Group();
    grip.add(size);
    grip.position.set(0.32, 0.55, -0.05);
    grip.visible = false;
    a.mesh.add(grip);
    a.heldPick = grip;
  }

  private async giveAxe(a: Actor) {
    if (a.held) return;
    const axe = await loadModel("objects", "axe");
    if (!axe || a.held) return;
    const mesh = new THREE.Mesh(axe.frames[0], axe.material);
    mesh.castShadow = true;
    // The axe's wooden handle runs along z with the steel blade at one end, the blade standing up along y. It is gripped
    // at the free end of the handle (which is moved to the origin), rolled a quarter turn so the head points to his left
    // rather than down, then turned round so the blade is forward.
    // The handle is modelled slanting up towards the blade by about 12 degrees (0.211 rad), so the mesh is tipped back by
    // that much to make it level, and moved so the free end of the handle is still at the origin.
    mesh.rotation.x = 0.211;
    mesh.position.set(0.075, -1.0357, 0.443);
    const roll = new THREE.Group();
    roll.rotation.z = Math.PI / 2;
    roll.add(mesh);
    const turn = new THREE.Group();
    turn.rotation.y = Math.PI;
    turn.scale.setScalar(0.7);
    turn.add(roll);
    const grip = new THREE.Group();
    grip.add(turn);
    grip.position.set(0.32, 0.55, -0.05);
    grip.visible = false;
    a.mesh.add(grip);
    a.held = grip;
  }

  // The things the game rules draw: who is where, facing which way, and what they are doing.
  sync(list: Desired[], follow?: string) {
    const keep = new Set(list.map((d) => d.key));
    for (const [k, l] of this.live)
      if (!keep.has(k)) {
        if (l.actor) {
          this.root.remove(l.actor.mesh);
          this.actors.splice(this.actors.indexOf(l.actor), 1);
        }
        this.live.delete(k);
      }
    for (const d of list) {
      let l = this.live.get(d.key);
      if (!l) {
        l = { want: d, pos: new THREE.Vector3(d.x, (d.y ?? 0.05) + (d.drop ?? 0), d.z), rot: d.rotY, loading: true, ...(d.drop ? { fall: { from: d.drop, t: 0 } } : {}) };
        this.live.set(d.key, l);
        const made = l;
        loadModel(d.kind, d.name).then((model) => {
          made.loading = false;
          if (!model || this.live.get(d.key) !== made) return;
          made.actor = this.spawn(model);
          made.actor.mesh.scale.setScalar(made.want.scale);
          // Something solid with a round window cut in it where the hero is, so he can be seen through it (the boulder at his back).
          if (made.want.xray) made.actor.mesh.material = this.see(made.actor.mesh.material as THREE.Material, -100);
          // Something seen through (the boulder at your back) gets a material of its own, so it can be let show what is behind it.
          if (made.want.opacity !== undefined) {
            const m = (made.actor.mesh.material as THREE.MeshLambertMaterial).clone();
            m.transparent = true;
            m.opacity = made.want.opacity;
            m.depthWrite = false;
            made.actor.mesh.material = m;
          }
          made.actor.play(model.animations.idle ? "idle" : (Object.keys(model.animations)[0] ?? ""));
        });
      }
      // The pace is the whole distance (height included: a letter that falls 0.9 in under a second must be quick) over the time.
      if (d.glide && (l.want.x !== d.x || l.want.z !== d.z || l.want.y !== d.y)) {
        l.speed = Math.hypot(d.x - l.pos.x, (d.y ?? 0.05) - l.pos.y, d.z - l.pos.z) / d.glide;
        l.long = d.glide > 1.5;
      }
      else if (!d.glide && (l.want.x !== d.x || l.want.z !== d.z)) l.speed = 0;
      l.want = d;
      if (d.key === follow) this.follow = l;
    }
  }

  // Effects that run for as long as they're wanted: poison smoke, torches, sconces, rain.
  setEffects(wanted: EffectWant[]) {
    this.lastFx = wanted;
    const list = [...this.mapFx, ...wanted];
    const keep = new Set(list.map((w) => w.key));
    for (const [k, e] of this.steady)
      if (!keep.has(k)) {
        this.fxGroup.remove(e.eff.object);
        e.eff.dispose();
        this.steady.delete(k);
      }
    for (const w of list) {
      const live = this.steady.get(w.key);
      if (live) {
        live.want = w;
        live.eff?.object.position.set(w.x, w.y ?? 0.1, w.z);
        continue;
      }
      // Claim the slot now: the file takes a moment to arrive.
      this.steady.set(w.key, { eff: undefined as unknown as ParticleEffect, want: w });
      void loadEffect(w.name).then((def) => {
        const slot = this.steady.get(w.key);
        if (!def || !slot || slot.eff) return;
        slot.eff = new ParticleEffect(def, w.tint, w.size);
        slot.eff.object.position.set(slot.want.x, slot.want.y ?? 0.1, slot.want.z);
        // A torch burns on a post.
        if (w.stand) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1, 6), new THREE.MeshLambertMaterial({ color: "#5a3b22" }));
          post.position.y = -0.55;
          slot.eff.object.add(post);
        }
        this.fxGroup.add(slot.eff.object);
      });
    }
  }

  // Mark a one-off as already played (the ones left over from before this view opened).
  ignore(key: string) {
    this.burstSeen.add(key);
  }

  // An effect that plays once, for `duration` seconds, and is then gone. A key is only ever played once.
  burst(w: EffectWant) {
    if (this.burstSeen.has(w.key)) return;
    this.burstSeen.add(w.key);
    void loadEffect(w.name).then((def) => {
      if (!def) return;
      const eff = new ParticleEffect(def, w.tint, w.size);
      eff.duration = w.duration ?? 1.6;
      eff.object.position.set(w.x, w.y ?? 0.1, w.z);
      this.fxGroup.add(eff.object);
      this.bursts.push(eff);
      if (w.hand) this.onHand.set(eff, { key: w.hand, lift: w.y ?? 0 });
    });
  }

  private runEffects(dt: number) {
    for (const e of this.steady.values()) e.eff?.update(dt, this.camera);
    for (const [eff, h] of this.onHand) {
      const grip = this.live.get(h.key)?.actor?.letter?.grip;
      if (!grip) continue;
      grip.getWorldPosition(eff.object.position);
      eff.object.position.y += h.lift;
    }
    for (const b of this.bursts) b.update(dt, this.camera);
    if (this.bursts.some((b) => b.done)) {
      for (const b of this.bursts.filter((x) => x.done)) {
        this.onHand.delete(b);
        this.fxGroup.remove(b.object);
        b.dispose();
      }
      this.bursts = this.bursts.filter((b) => !b.done);
    }
  }

  // Flat glowing squares on the floor: dash trails, rock shadows.
  setMarkers(list: { x: number; z: number; color: string; opacity: number }[]) {
    this.markers.clear();
    for (const m of list) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 0.92, TILE * 0.92), new THREE.MeshBasicMaterial({ color: m.color, transparent: true, opacity: m.opacity, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(m.x, 0.07, m.z);
      this.markers.add(mesh);
    }
  }

  private step(dt: number) {
    for (const l of this.live.values()) {
      const d = l.want;
      const target = new THREE.Vector3(d.x, d.y ?? 0.05, d.z);
      const dist = l.pos.distanceTo(target);
      // Teleports (a new area, a dash) snap; walking glides.
      if (l.speed) {
        // A scripted walk or flight goes at one pace the whole way.
        // Flight eases in to its landing rather than stopping dead.
        const slow = l.long ? Math.min(1, Math.max(0.3, dist / 1.6)) : 1;
        const k = Math.min(1, (l.speed * slow * dt) / Math.max(dist, 1e-6));
        l.pos.lerp(target, k);
        if (k >= 1) l.speed = 0;
      } else if (dist > TILE * 3.5) l.pos.copy(target);
      else {
        // Walkers cover the ground at a steady pace instead of easing in and out, so their steps read as steps; if the
        // target runs far ahead (a key held down) they hurry to catch up.
        const pace = Math.max(d.moveAnim === "sprint" ? 9 : 5.5, dist * 7);
        l.pos.lerp(target, Math.min(1, (pace * dt) / Math.max(dist, 1e-6)));
      }
      // Something gliding somewhere (a pigeon in flight) points its head where it is going.
      const heading = l.speed && dist > 0.05 ? Math.atan2(target.x - l.pos.x, target.z - l.pos.z) : d.rotY;
      let dr = heading - l.rot;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      // Gliders bank into turns slowly, like a bird; walkers snap round.
      l.rot += dr * (1 - Math.exp(-dt * (l.speed ? 3.5 : 16)));
      // Something riding on another (a pigeon on a head) goes wherever that one goes, and up and down with each frame of its
      // animation: the carrier's top in the frame being shown, plus the rider's own height.
      const carrier = d.rideOn ? this.live.get(d.rideOn) : undefined;
      if (carrier?.actor) {
        const ca = carrier.actor;
        const top = ca.model.tops?.[ca.model.frames.indexOf(ca.mesh.geometry)] ?? 1.2;
        l.pos.set(carrier.pos.x, carrier.pos.y + top * ca.mesh.scale.y + (d.y ?? 0), carrier.pos.z);
        l.rot = carrier.rot;
        l.speed = 0;
      }
      // Something let fall (a slab) drops from where it was let go, faster and faster, and lands.
      if (l.fall) {
        l.fall.t += dt;
        const k = Math.min(1, l.fall.t / 0.5);
        l.pos.y = (d.y ?? 0.05) + l.fall.from * (1 - k * k);
        if (k >= 1) l.fall = undefined;
      }
      if (l.actor) {
        l.actor.mesh.position.copy(l.pos);
        // At rest, an idle that settles down and rises again (a perched bird's breathing): its own single frame has no motion,
        // so it is a slow dip of `bob` and back.
        if (d.bob && !l.speed) l.actor.mesh.position.y -= (0.5 - 0.5 * Math.cos(performance.now() / 1000 * 2.4)) * d.bob;
        // A little rise and fall with each wingbeat while something is flying somewhere.
        if (l.speed) l.actor.mesh.position.y += Math.sin(performance.now() / 1000 * 11) * (d.kind === "objects" ? 0 : 0.04);
        // Paper flutters a little from side to side as it falls.
        if (l.speed && d.kind === "objects") l.actor.mesh.position.x += Math.sin(performance.now() / 1000 * 9) * 0.04;
        l.actor.mesh.rotation.y = l.rot;
        // Walking carries on for a moment after the last step, so holding a key is one smooth walk, not a stutter.
        l.moving = dist > 0.04 ? 0.18 : Math.max(0, (l.moving ?? 0) - dt);
        const walk = d.moveAnim && l.actor.model.animations[d.moveAnim] ? d.moveAnim : "walk";
        const want = d.anim ?? (l.moving > 0 && l.actor.model.animations[walk] ? walk : (d.restAnim ?? "idle"));
        l.actor.play(want);
        if (d.shot && d.shot.n !== l.shotN) {
          // The first time we see a gesture count, remember it without playing: it's old news.
          if (l.shotN !== undefined) {
            if (d.shot.name === "swing_axe") void this.giveAxe(l.actor);
            if (d.shot.name === "pick_attack1" || d.shot.name === "pick_grab") void this.givePick(l.actor);
            if (d.shot.name === "fire") void this.giveLetter(l.actor).then(() => l.actor?.playOnce("fire"));
            else l.actor.playOnce(d.shot.name);
          }
          l.shotN = d.shot.n;
        } else if (!d.shot && l.shotN === undefined) l.shotN = 0;
      }
    }
    for (const [a, t0] of this.shakes) {
      const t = t0 + dt;
      if (t > 0.9) {
        a.mesh.rotation.z = 0;
        this.shakes.delete(a);
      } else {
        a.mesh.rotation.z = Math.sin(t * 42) * 0.045 * Math.exp(-t * 4.5);
        this.shakes.set(a, t);
      }
    }
    if (this.cam) {
      this.settle = undefined;
      this.stepCamera(dt);
    } else if (this.settle) {
      const k = 1 - Math.exp(-dt * 4);
      this.pitch += (this.settle.pitch - this.pitch) * k;
      this.distance += (this.settle.dist - this.distance) * k;
      if (Math.abs(this.settle.pitch - this.pitch) < 0.002 && Math.abs(this.settle.dist - this.distance) < 0.01) {
        this.pitch = this.settle.pitch;
        this.distance = this.settle.dist;
        this.settle = undefined;
      }
    } else if (!this.scripted && this.follow && this.live.has(this.follow.want.key)) {
      this.leadNow.lerp(this.lead, 1 - Math.exp(-dt * 2.5));
      this.focus.lerp(this.follow.pos.clone().add(this.leadNow), 1 - Math.exp(-dt * 6));
    }
    // Behind him: the camera swings round to sit behind whichever way he faces (where an area asks for it).
    if (this.followYaw && !this.scripted && this.lead.lengthSq() > 0.01) {
      const want = Math.atan2(-this.lead.x, -this.lead.z);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 3.2));
    } else if (this.scripted || !this.followYaw) {
      this.yaw += (0 - this.yaw) * (1 - Math.exp(-dt * 4));
    }
    this.shoulderNow += ((this.scripted ? 0 : this.shoulder) - this.shoulderNow) * (1 - Math.exp(-dt * 3));
  }

  // Where somebody is right now, for a camera to look at.
  positionOf(key: string): THREE.Vector3 | undefined {
    return this.live.get(key)?.pos;
  }

  // Take the camera: glide to a place (or stay on somebody) over `secs`, with an optional shake.
  moveCamera(to: { key?: string; x: number; z: number }, dist: number, pitch: number, secs: number, shake = 0) {
    this.scripted = true;
    this.cam = { from: this.focus.clone(), fromDist: this.distance, fromPitch: this.pitch, to, dist, pitch, t: 0, dur: Math.max(0.0001, secs), shake };
    if (secs <= 0) this.stepCamera(0);
  }

  // Give the camera back to the hero.
  releaseCamera(dist: number, pitch: number) {
    this.cam = undefined;
    this.scripted = false;
    // Settle into the usual angle over a moment instead of snapping to it (a sudden drop of the camera shows the horizon).
    this.settle = { dist, pitch };
    this.shakeBy.set(0, 0, 0);
  }
  private settle?: { dist: number; pitch: number };

  private shakeBy = new THREE.Vector3();
  private stepCamera(dt: number) {
    const c = this.cam!;
    c.t = Math.min(c.dur, c.t + dt);
    const k = c.t / c.dur;
    const e = k * k * (3 - 2 * k);
    const tgt = c.to.key ? (this.live.get(c.to.key)?.pos ?? new THREE.Vector3(c.to.x, 0, c.to.z)) : new THREE.Vector3(c.to.x, 0, c.to.z);
    this.focus.set(c.from.x + (tgt.x - c.from.x) * e, 0, c.from.z + (tgt.z - c.from.z) * e);
    this.distance = c.fromDist + (c.dist - c.fromDist) * e;
    this.pitch = c.fromPitch + (c.pitch - c.fromPitch) * e;
    const amp = c.shake * (k < 1 ? 1 : 0);
    this.shakeBy.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
  }

  // A copy of a material with the round window in it: the faces that are nearer the camera than the hero and higher than `above` (the walls,
  // not the floor) are cut away inside a circle round where he shows on the screen, so he is never lost behind a wall or a boulder.
  private seen = new Map<THREE.Material, THREE.Material>();
  private see(base: THREE.Material, above: number): THREE.Material {
    const key = base;
    const hit = this.seen.get(key);
    if (hit && above === 0.45) return hit;
    const m = (base as THREE.MeshLambertMaterial).clone();
    // The faces seen through the window are the insides of the blocks beyond it, not the empty dark behind them.
    if (above > 0) m.side = THREE.DoubleSide;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uHole = this.hole;
      shader.uniforms.uHoleDepth = this.holeDepth;
      shader.uniforms.uHoleAbove = { value: above };
      const NL = String.fromCharCode(10);
      shader.vertexShader = ["varying float vHoleY;", shader.vertexShader].join(NL).replace("#include <begin_vertex>", ["#include <begin_vertex>", "vec4 holeAt = vec4(transformed, 1.0);", "#ifdef USE_INSTANCING", "holeAt = instanceMatrix * holeAt;", "#endif", "vHoleY = (modelMatrix * holeAt).y;"].join(NL));
      shader.fragmentShader = ["uniform vec3 uHole;", "uniform float uHoleDepth;", "uniform float uHoleAbove;", "varying float vHoleY;", shader.fragmentShader].join(NL).replace("void main() {", ["void main() {", "  if (vHoleY > uHoleAbove && distance(gl_FragCoord.xy, uHole.xy) < uHole.z && length(vViewPosition) < uHoleDepth) discard;"].join(NL));
    };
    m.customProgramCacheKey = () => `hole${above}`;
    if (above === 0.45) this.seen.set(key, m);
    return m;
  }

  // The window in a solid thing at the hero's back, centred on where he shows on the screen, about as wide as he is tall.
  private aimHole() {
    const hero = this.live.get("hero");
    if (!hero) return;
    this.camera.updateMatrixWorld();
    const at = hero.pos.clone();
    at.y += 0.7;
    const ndc = at.clone().project(this.camera);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const dist = this.camera.position.distanceTo(at);
    const perUnit = size.y / 2 / (dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.hole.value.set((ndc.x * 0.5 + 0.5) * size.x, (ndc.y * 0.5 + 0.5) * size.y, 1.0 * perUnit);
    // Only what is clearly nearer the camera than he is gets cut.
    this.holeDepth.value = dist - 0.7;
  }

  start() {
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - this.last) / 1000 || 0);
      this.last = t;
      this.step(dt);
      this.runEffects(dt);
      for (const s of this.scrub.values()) {
        s.now += (s.want - s.now) * (1 - Math.exp(-dt * 7));
        const frames = s.actors[0]?.model.frames.length ?? 1;
        const f = Math.min(frames - 1, Math.round(s.now * (frames - 1)));
        for (const a of s.actors) if (a.mesh.geometry !== a.model.frames[f]) a.mesh.geometry = a.model.frames[f];
      }
      for (const a of this.actors) a.update(dt);
      this.onFrame?.(dt);
      const flat = Math.cos(this.pitch) * this.distance;
      this.camera.position.set(this.focus.x + Math.cos(this.yaw) * this.shoulderNow + Math.sin(this.yaw) * flat + this.shakeBy.x, this.focus.y + Math.sin(this.pitch) * this.distance + this.shakeBy.y, this.focus.z - Math.sin(this.yaw) * this.shoulderNow + Math.cos(this.yaw) * flat + this.shakeBy.z);
      if (this.keepIn) {
        // Never out past the haze at the map's edge, or the view would be through it.
        const k = this.keepIn;
        this.camera.position.x = Math.min(k.r, Math.max(k.l, this.camera.position.x));
        this.camera.position.z = Math.min(k.b, Math.max(k.t, this.camera.position.z));
      }
      this.camera.lookAt(this.focus.x + Math.cos(this.yaw) * this.shoulderNow, this.focus.y + 0.55, this.focus.z - Math.sin(this.yaw) * this.shoulderNow);
      this.aimHole();
      this.focusTarget.position.copy(this.focus);
      this.sun?.position.set(this.focus.x - 6, this.focus.y + 12, this.focus.z + 7);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderer.dispose();
  }
}
