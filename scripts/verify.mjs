import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
process.chdir(ROOT);

const has = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0;

const sidecar = has("cargo")
  ? ["cargo", ["test", "--manifest-path", "stonks/Cargo.toml"]]
  : [
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${ROOT}/stonks:/src`,
        "-v",
        "group53-dev-target:/src/target",
        "-w",
        "/src",
        "rust:1-alpine",
        "sh",
        "-c",
        "apk add -q musl-dev && cargo test",
      ],
    ];

const STEPS = [
  { key: "format", title: "Formatting", run: ["npx", ["prettier", "--check", "--log-level", "warn", "."]] },
  { key: "lint", title: "Lint rules", run: ["npx", ["eslint", ".", "--max-warnings", "0"]] },
  { key: "dead", title: "Dead code", run: ["npx", ["knip"]] },
  { key: "types", title: "Typecheck", run: ["npx", ["tsc", "-b"]] },
  { key: "unit", title: "Unit tests and simulations", needs: ["bun"], run: ["npx", ["vitest", "run"]] },
  { key: "build", title: "Build", run: ["npx", ["vite", "build"]] },
  { key: "sidecar", title: "Stonks sidecar", run: sidecar },
  { key: "e2e", title: "End-to-end on phones (portrait and landscape)", needs: ["docker"], run: ["node", ["e2e/run.mjs"]] },
];

const args = process.argv.slice(2);
const only = args
  .find((a) => a.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",");
const steps = only ? STEPS.filter((s) => only.includes(s.key)) : STEPS;
if (only && steps.length !== only.length) {
  console.error(`Unknown step in --only. Steps: ${STEPS.map((s) => s.key).join(", ")}`);
  process.exit(2);
}

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const stampDir = path.join(git("rev-parse", "--git-common-dir"), "group53-verified");
const clean = git("status", "--porcelain") === "";
const tree = git("rev-parse", "HEAD^{tree}");

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

const started = Date.now();
const unchanged = () => git("rev-parse", "HEAD^{tree}") === tree && (git("status", "--porcelain") === "") === clean;
const stopIfChanged = () => {
  if (unchanged()) return;
  console.error(
    red("\nThe checkout changed while verify was running (a commit, a checkout or an edit), so this run proves nothing. Run it again."),
  );
  process.exit(1);
};

for (const [i, step] of steps.entries()) {
  stopIfChanged();
  const missing = (step.needs ?? []).filter((b) => !has(b));
  if (missing.length) {
    console.error(red(`\n${step.title} needs ${missing.join(", ")} installed. Nothing is skipped: install it and run again.`));
    process.exit(1);
  }
  console.log(bold(`\n[${i + 1}/${steps.length}] ${step.title}`));
  const t = Date.now();
  const [cmd, cmdArgs] = step.run;
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit", env: { ...process.env, FORCE_COLOR: "1" } });
  if (result.status !== 0) {
    console.error(red(`\n✘ ${step.title} failed. Fix it and run \`npm run verify\` again; every step has to pass before a push.`));
    process.exit(result.status ?? 1);
  }
  console.log(green(`✔ ${step.title} (${Math.round((Date.now() - t) / 1000)}s)`));
}

const total = Math.round((Date.now() - started) / 1000);
if (only) {
  console.log(green(`\n✔ ${steps.map((s) => s.key).join(", ")} passed in ${total}s. Partial runs don't count for a push.`));
} else if (clean && unchanged()) {
  fs.mkdirSync(stampDir, { recursive: true });
  fs.writeFileSync(path.join(stampDir, tree), new Date().toISOString());
  console.log(green(`\n✔ Everything passed in ${total}s. This commit can be pushed.`));
} else {
  console.log(
    green(`\n✔ Everything passed in ${total}s.`) + ` Uncommitted changes, so nothing is recorded: commit and run it again before pushing.`,
  );
}
