// Converts the RPG in a Box project's particle effects (effects/*.scn) to small JSON files for the web.
//
//   node tools/mereddia/effects.mjs <project folder> <out folder>
//
// Each effect is a Godot particle emitter: how many particles, how long they live, where they appear, how they
// move, and how their size and colour change over a life. The numbers are copied as they are; the renderer in
// src/games/mereddia/three/effects.ts follows the same rules.

import fs from "node:fs";
import path from "node:path";
import { load, Ref } from "./godot3.mjs";

const [, , src, out] = process.argv;
if (!src || !out) {
  console.error("usage: node tools/mereddia/effects.mjs <project folder> <out folder>");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

const byPath = (res, ref) => (ref instanceof Ref && ref.kind === "int" ? res.find((r) => r.path === `local://${ref.v}`)?.obj : null);

// A curve's points, as [offset, value] pairs, sampled to a short list the renderer can interpolate.
function curveOf(res, tex) {
  const c = byPath(res, tex?.props.curve);
  const data = c?.props._data;
  if (!data) return null;
  const pts = [];
  for (let i = 0; i < data.length; i += 5) if (Array.isArray(data[i])) pts.push([data[i][0], data[i][1]]);
  return pts.length ? pts : null;
}

function rampOf(res, tex) {
  const g = byPath(res, tex?.props.gradient);
  if (!g) return null;
  const colors = g.props.colors;
  const offsets = g.props.offsets ?? [0, 1];
  const out = [];
  for (let i = 0; i < colors.length / 4; i++) out.push([offsets[i] ?? i / Math.max(1, colors.length / 4 - 1), colors[i * 4], colors[i * 4 + 1], colors[i * 4 + 2], colors[i * 4 + 3]]);
  return out;
}

for (const f of fs.readdirSync(path.join(src, "effects")).filter((f) => f.endsWith(".scn") && !f.includes("backup"))) {
  const file = load(path.join(src, "effects", f));
  const res = file.resources;
  const { names, variants, nodes, node_count } = res.at(-1).obj.props._bundled;
  // The Particles node's own properties.
  let i = 0;
  let node = {};
  for (let n = 0; n < node_count; n++) {
    const type = nodes[i + 2];
    const np = nodes[i + 5];
    const props = {};
    for (let p = 0; p < np; p++) props[names[nodes[i + 6 + 2 * p] & 0x7fffffff]] = variants[nodes[i + 7 + 2 * p]];
    const ng = nodes[i + 6 + 2 * np];
    i += 7 + 2 * np + ng;
    if (names[type & 0x7fffffff] === "Particles") node = props;
  }
  const pm = res.find((r) => r.obj.type === "ParticlesMaterial")?.obj.props ?? {};
  const mat = res.find((r) => r.obj.type === "SpatialMaterial")?.obj.props ?? {};
  const mesh = res.find((r) => ["CubeMesh", "SphereMesh", "QuadMesh"].includes(r.obj.type))?.obj;
  const curve = (name) => curveOf(res, byPath(res, pm[name]));
  const effect = {
    name: f.slice(0, -4),
    amount: node.amount ?? 8,
    lifetime: node.lifetime ?? 1,
    speed: node.speed_scale ?? 1,
    preprocess: node.preprocess ?? 0,
    oneShot: !!node.one_shot,
    explosiveness: node.explosiveness ?? 0,
    // Where particles appear: 0 point, 1 sphere, 2 box.
    shape: pm.emission_shape ?? 0,
    radius: pm.emission_sphere_radius ?? 1,
    extents: pm.emission_box_extents ?? [1, 1, 1],
    direction: pm.direction ?? [1, 0, 0],
    spread: pm.spread ?? 45,
    gravity: pm.gravity ?? [0, -9.8, 0],
    velocity: [pm.initial_velocity ?? 0, pm.initial_velocity_random ?? 0],
    linear: pm.linear_accel ?? 0,
    radial: pm.radial_accel ?? 0,
    tangential: pm.tangential_accel ?? 0,
    damping: pm.damping ?? 0,
    scale: [pm.scale ?? 1, pm.scale_random ?? 0],
    scaleCurve: curve("scale_curve"),
    ramp: rampOf(res, byPath(res, pm.color_ramp)),
    color: pm.color ?? [1, 1, 1, 1],
    mesh: mesh ? { type: mesh.type, size: mesh.props.size ?? null, radius: mesh.props.radius ?? null } : { type: "CubeMesh", size: [0.05, 0.05, 0.05] },
    // Blend mode 1 is additive; 0 normal. Unshaded glows.
    additive: mat.params_blend_mode === 1,
    billboard: mesh?.type === "QuadMesh",
  };
  fs.writeFileSync(path.join(out, `${effect.name}.json`), JSON.stringify(effect));
  console.log(`${effect.name}: ${effect.amount} particles, ${effect.lifetime}s, ${effect.mesh.type}`);
}
