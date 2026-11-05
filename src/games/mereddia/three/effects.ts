import * as THREE from "three";

// The project's particle effects, drawn the way its engine draws them: every particle is born somewhere in
// the emitter's shape, flies off with a velocity and accelerations, and changes size and colour over a short
// life, forever or once. The numbers come from tools/mereddia/effects.mjs. Each particle's path is worked out
// from its age, so nothing is stored between frames.

export type EffectDef = {
  name: string;
  amount: number;
  lifetime: number;
  speed: number;
  preprocess: number;
  oneShot: boolean;
  explosiveness: number;
  shape: number;
  radius: number;
  extents: number[];
  direction: number[];
  spread: number;
  gravity: number[];
  velocity: [number, number];
  linear: number;
  radial: number;
  tangential: number;
  damping: number;
  scale: [number, number];
  scaleCurve: [number, number][] | null;
  ramp: number[][] | null;
  color: number[];
  mesh: { type: string; size: number[] | null; radius: number | null };
  additive: boolean;
  billboard: boolean;
};

const cache = new Map<string, Promise<EffectDef | null>>();
export const loadEffect = (name: string) => {
  let hit = cache.get(name);
  if (!hit) {
    hit = fetch(`${import.meta.env.BASE_URL}mereddia/3d/effects/${name}.json`).then((r) => (r.ok ? (r.json() as Promise<EffectDef>) : null)).catch(() => null);
    cache.set(name, hit);
  }
  return hit;
};

// A small deterministic random number from two integers.
function rnd(a: number, b: number, k: number): number {
  let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b) ^ Math.imul(k + 13, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function sample(points: [number, number][] | null, t: number, fallback = 1): number {
  if (!points) return fallback;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++)
    if (t <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return y0 + ((y1 - y0) * (t - x0)) / Math.max(1e-6, x1 - x0);
    }
  return points[points.length - 1][1];
}

function ramp(r: number[][] | null, t: number): [number, number, number, number] {
  if (!r) return [1, 1, 1, 1];
  if (t <= r[0][0]) return [r[0][1], r[0][2], r[0][3], r[0][4]];
  for (let i = 1; i < r.length; i++)
    if (t <= r[i][0]) {
      const k = (t - r[i - 1][0]) / Math.max(1e-6, r[i][0] - r[i - 1][0]);
      return [0, 1, 2, 3].map((c) => r[i - 1][c + 1] + (r[i][c + 1] - r[i - 1][c + 1]) * k) as [number, number, number, number];
    }
  const l = r[r.length - 1];
  return [l[1], l[2], l[3], l[4]];
}

const VERT = `
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const FRAG = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.01) discard;
    gl_FragColor = vec4(vColor, vAlpha);
  }
`;

export class ParticleEffect {
  readonly object: THREE.InstancedMesh;
  private time = 0;
  private fade = 1;
  // How long a burst runs for, in seconds; 0 means it runs until removed.
  duration = 0;
  done = false;
  private alpha: THREE.InstancedBufferAttribute;
  private color: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private dir: THREE.Vector3;

  constructor(readonly def: EffectDef, private tint?: [number, number, number], private size = 1) {
    const geo =
      def.mesh.type === "SphereMesh" ? new THREE.SphereGeometry(def.mesh.radius ?? 0.025, 6, 4) : def.mesh.type === "QuadMesh" ? new THREE.PlaneGeometry(def.mesh.size?.[0] ?? 0.1, def.mesh.size?.[1] ?? 0.1) : new THREE.BoxGeometry(def.mesh.size?.[0] ?? 0.05, def.mesh.size?.[1] ?? 0.05, def.mesh.size?.[2] ?? 0.05);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: def.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.object = new THREE.InstancedMesh(geo, mat, def.amount);
    this.object.frustumCulled = false;
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(def.amount), 1);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(def.amount * 3), 3);
    geo.setAttribute("aAlpha", this.alpha);
    geo.setAttribute("aColor", this.color);
    this.dir = new THREE.Vector3(...def.direction).normalize();
    this.time = def.preprocess;
  }

  update(dt: number, camera: THREE.Camera) {
    const d = this.def;
    this.time += dt * d.speed;
    if (this.duration) {
      const left = this.duration - this.time;
      this.fade = Math.max(0, Math.min(1, left / 0.5));
      if (left <= 0) this.done = true;
    }
    const up = new THREE.Vector3(0, 1, 0);
    const radial = new THREE.Vector3();
    const tang = new THREE.Vector3();
    const v0 = new THREE.Vector3();
    const acc = new THREE.Vector3();
    const side = new THREE.Vector3();
    const perp = new THREE.Vector3();
    for (let i = 0; i < d.amount; i++) {
      // Each particle is a certain way through its own cycle, spread evenly over the lifetime.
      const offset = (i / d.amount) * (1 - d.explosiveness) * d.lifetime;
      const u = this.time + offset;
      const cycle = Math.floor(u / d.lifetime);
      const a = u - cycle * d.lifetime;
      const t = a / d.lifetime;
      if (d.oneShot && cycle > 0) {
        this.alpha.setX(i, 0);
        continue;
      }
      const r = (k: number) => rnd(i, cycle, k);
      // Where it starts.
      if (d.shape === 2) this.p.set((r(1) * 2 - 1) * d.extents[0], (r(2) * 2 - 1) * d.extents[1], (r(3) * 2 - 1) * d.extents[2]);
      else if (d.shape === 1) {
        const cosT = r(1) * 2 - 1, phi = r(2) * Math.PI * 2, sinT = Math.sqrt(1 - cosT * cosT), rr = d.radius * Math.cbrt(r(3));
        this.p.set(rr * sinT * Math.cos(phi), rr * cosT, rr * sinT * Math.sin(phi));
      } else this.p.set(0, 0, 0);
      radial.copy(this.p).setY(0);
      if (radial.lengthSq() > 1e-8) radial.normalize();
      // Which way it flies: the direction, bent by up to `spread` degrees.
      v0.copy(this.dir);
      const ang = (d.spread * Math.PI) / 180 * r(4);
      if (ang > 0) {
        side.copy(Math.abs(this.dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : up).cross(this.dir).normalize();
        perp.copy(this.dir).cross(side);
        const phi = r(5) * Math.PI * 2;
        v0.multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang) * Math.cos(phi)).addScaledVector(perp, Math.sin(ang) * Math.sin(phi));
      }
      v0.multiplyScalar(d.velocity[0] * (1 - d.velocity[1] * r(6)));
      tang.copy(up).cross(radial);
      acc.set(d.gravity[0], d.gravity[1], d.gravity[2]).addScaledVector(radial, d.radial).addScaledVector(tang, d.tangential).addScaledVector(v0.lengthSq() > 0 ? v0.clone().normalize() : up, d.linear);
      const damp = d.damping > 0 ? Math.exp(-d.damping * a * 0.3) : 1;
      this.p.addScaledVector(v0, a * damp).addScaledVector(acc, 0.5 * a * a);
      this.p.multiplyScalar(this.size);
      const sc = d.scale[0] * (1 - d.scale[1] * r(7)) * sample(d.scaleCurve, t) * this.size;
      this.s.setScalar(Math.max(0.0001, sc));
      if (d.billboard) this.q.copy(camera.quaternion);
      else this.q.identity();
      this.m.compose(this.p, this.q, this.s);
      this.object.setMatrixAt(i, this.m);
      const c = ramp(d.ramp, t);
      // A tint repaints the effect: the brightness stays, the hue becomes the tint's (a purple flame, not an orange one gone dim).
      const lum = Math.max(c[0], c[1], c[2]);
      if (this.tint) this.color.setXYZ(i, lum * this.tint[0] * d.color[0], lum * this.tint[1] * d.color[1], lum * this.tint[2] * d.color[2]);
      else this.color.setXYZ(i, c[0] * d.color[0], c[1] * d.color[1], c[2] * d.color[2]);
      this.alpha.setX(i, c[3] * d.color[3] * this.fade);
    }
    this.object.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.color.needsUpdate = true;
  }

  dispose() {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}
