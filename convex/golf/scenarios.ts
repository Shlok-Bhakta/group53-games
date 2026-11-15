import { compile, rng, type Course, type Power } from "./engine";
import { worldOf } from "./holes";
import { SANDBOX } from "./sandbox";
import { advance, applyCmd, cmdOrder, fingerprint, newWorld, pack, TPS, unpack, type Cmd, type Packed, type Rules } from "./world";

export function chaos(seed = 1): { cmds: Cmd[]; checkpoints: number[] } {
  const r = rng(seed);
  const cmds: Cmd[] = [];
  const ids = ["ann", "bo", "cy", "di", "ed", "flo", "gus", "hal"];
  let seq = 0;
  ids.forEach((by, i) => cmds.push({ tick: i * 7, by, seq: seq++, kind: "join" }));
  for (let k = 0; k < 160; k++) {
    const by = ids[Math.floor(r() * ids.length)];
    const tick = 60 + Math.floor(r() * TPS * 58);
    const roll = r();
    if (roll < 0.8) cmds.push({ tick, by, seq: seq++, kind: "shot", a: (r() - 0.5) * 6.4, p: 0.2 + r() * 0.8 });
    else if (roll < 0.9) cmds.push({ tick, by, seq: seq++, kind: "use", i: 0 });
    else cmds.push({ tick, by, seq: seq++, kind: "fire", i: Math.floor(r() * 3), x: 10 + r() * 80, y: 10 + r() * 60 });
  }
  return { cmds: cmds.sort(cmdOrder), checkpoints: [TPS * 5, TPS * 20, TPS * 40, TPS * 61] };
}

function turned(scn: { cmds: Cmd[]; checkpoints: number[] }) {
  const cmds = scn.cmds.flatMap((c) =>
    c.kind === "join" ? [c] : [{ tick: c.tick, by: c.by, seq: c.seq - 0.5, kind: "turn" as const }, c],
  );
  return { cmds: cmds.sort(cmdOrder), checkpoints: scn.checkpoints };
}

export function play(scn: { cmds: Cmd[]; checkpoints: number[] }, bags: Power[] = ["laser", "railgun", "mine"], rules?: Rules) {
  const W = compile(SANDBOX);
  const s = newWorld(SANDBOX, { rules });
  const out: number[] = [];
  const filled = new Set<string>();
  let tick = 0;
  for (const cp of scn.checkpoints) {
    while (tick < cp) {
      const to = Math.min(cp, tick + TPS);
      advance(s, W, to, scn.cmds);
      tick = to;
      for (const b of s.balls)
        if (!filled.has(b.id) || b.bag.length === 0) {
          filled.add(b.id);
          b.bag = [...bags];
        }
    }
    out.push(fingerprint(s));
  }
  return out;
}

export function allFingerprints() {
  return {
    chaos1: play(chaos(1)),
    chaos2: play(chaos(2), ["bouncy", "jumbo", "spring"]),
    chaos3: play(chaos(3), ["cart", "rocket", "laser"]),
    chaos4: play(chaos(4), ["missile", "storm", "pistol"]),
    chaos5: play(chaos(5), ["freeze", "elephant", "horn"]),
    chaos6: play(chaos(6), ["honey", "coffee", "shield"]),
    chaos7: play(chaos(7), ["flash", "missile", "freeze"]),
    rules8: play(chaos(8), ["missile", "railgun", "laser"], { cap: 6, turns: false, knockFree: true, markR: 3.2 }),
    rules9: play(turned(chaos(9)), ["freeze", "honey", "shield"], { cap: 99, turns: true, knockFree: true, markR: 0 }),
  };
}

const ME = "solver";
const MAX_ROLL = 16;
export function start(c: Course) {
  const s = newWorld(c);
  applyCmd(s, c, { tick: 0, by: ME, seq: 0, kind: "join" });
  return pack(s);
}
export function takeShot(c: Course, from: Packed, a: number, p: number) {
  const w = worldOf(c);
  const s = unpack(from);
  const cmds: Cmd[] = [{ tick: s.tick, by: ME, seq: 1, kind: "shot", a, p }];
  let to = s.tick + 1;
  advance(s, w, to, cmds);
  let sunk = false;
  for (let i = 0; i < MAX_ROLL * 4; i++) {
    to += TPS / 4;
    advance(s, w, to, cmds);
    if (s.events.some((e) => e.ev.type === "sink" && e.id === ME)) {
      sunk = true;
      break;
    }
    if (s.balls[0].mode === "aim") break;
  }
  s.events.length = 0;
  return { s, sunk };
}
