import { compile, rng, type Power } from "./engine";
import { SANDBOX } from "./sandbox";
import { advance, cmdOrder, fingerprint, newWorld, TPS, type Cmd } from "./world";

// Games played by script, for checking that every JavaScript engine (Safari's on iPhones, Chrome's on
// Android and the server) comes out with exactly the same world. See src/games/golf/determinism.test.ts.

// Eight players for a minute: random shots at random moments, and everyone's bag full of the items that
// throw other balls about.
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

// Runs a scenario and returns the world's fingerprint at each checkpoint. `bags` fills everyone's bag
// once they've joined, so the items get used.
export function play(scn: { cmds: Cmd[]; checkpoints: number[] }, bags: Power[] = ["laser", "railgun", "mine"]) {
  const W = compile(SANDBOX);
  const s = newWorld(SANDBOX);
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
  return { chaos1: play(chaos(1)), chaos2: play(chaos(2), ["bouncy", "jumbo", "spring"]), chaos3: play(chaos(3), ["cart", "rocket", "laser"]) };
}
