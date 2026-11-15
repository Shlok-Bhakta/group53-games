import fs from "node:fs";
import path from "node:path";

const PROTECTED = [
  /^eslint\.config\.js$/,
  /^eslint\//,
  /^scripts\/verify\.mjs$/,
  /^scripts\/strip-comments\.mjs$/,
  /^\.githooks\//,
  /^\.claude\/settings\.json$/,
  /^\.claude\/hooks\//,
  /^knip\.json$/,
  /^\.prettierrc\.json$/,
  /^\.prettierignore$/,
  /^\.github\/workflows\//,
  /^\.github\/CODEOWNERS$/,
  /^tsconfig[^/]*\.json$/,
  /^convex\/tsconfig\.json$/,
  /^vitest\.config\.ts$/,
  /^playwright\.config\.ts$/,
];

const PROTECTED_WORDS = [
  "eslint.config.js",
  "eslint/",
  "scripts/verify.mjs",
  "scripts/strip-comments.mjs",
  ".githooks",
  ".claude/settings.json",
  ".claude/hooks",
  "knip.json",
  ".prettierrc",
  ".prettierignore",
  ".github/workflows",
  "CODEOWNERS",
  "tsconfig",
  "vitest.config",
  "playwright.config",
];

const ASK_SHLOK =
  "This file is part of the checks (lint rules, verify, hooks, CI, compiler and test config). Agents don't change the checks. Fix the code so it passes; if a rule is genuinely wrong for a real case, stop and tell Shlok which rule, the case, and the change you'd make.";

const deny = (reason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
  process.exit(0);
};

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const root = input.cwd ?? process.cwd();
const tool = input.tool_name;
const args = input.tool_input ?? {};

const relative = (file) => path.relative(root, path.resolve(root, file)).split(path.sep).join("/");

if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
  const file = relative(args.file_path ?? args.notebook_path ?? "");
  if (PROTECTED.some((p) => p.test(file))) deny(ASK_SHLOK);
}

if (tool === "Bash") {
  const cmd = String(args.command ?? "");
  if (/--no-verify\b/.test(cmd) || /\bgit\b[^|;&]*\bcommit\b[^|;&]*\s-[a-zA-Z]*n[a-zA-Z]*\b/.test(cmd)) {
    deny("Hooks are never skipped. Make the commit pass them (npm run verify shows what fails).");
  }
  if (/core\.hooksPath|HUSKY=0|GROUP53_E2E_LOCKED/.test(cmd)) deny("The git hooks and the e2e lock stay as they are.");
  if (/group53-verified/.test(cmd)) deny("Verification stamps are only written by npm run verify passing.");
  if (/\bgit\s+push\b[^|;&]*(\s-f\b|--force)/.test(cmd)) deny("No force pushes. Push a new commit instead.");
  const writes = /(>|\bsed\s+-i|\bperl\s+-[a-z]*i|\brm\b|\bmv\b|\bcp\b|\btee\b|\btruncate\b|\bchmod\b|\bln\b|git\s+(checkout|restore|rm|mv)\b|\bpython3?\b|\bnode\s+-e\b)/;
  if (writes.test(cmd) && PROTECTED_WORDS.some((w) => cmd.includes(w))) deny(ASK_SHLOK);
}

process.exit(0);
