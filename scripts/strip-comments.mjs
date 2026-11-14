import fs from "node:fs";
import { parse } from "@typescript-eslint/typescript-estree";

const KEEP = /^\s*(platform:|@vite-ignore|[#@]__PURE__|@refresh|webpackChunkName|\/ <reference)/;

const strip = (code, file) => {
  const { comments } = parse(code, {
    comment: true,
    range: true,
    jsx: file.endsWith("x") || file.endsWith(".mjs") || file.endsWith(".js"),
    loc: false,
  });
  const doomed = comments.filter((c) => !KEEP.test(c.value)).sort((a, b) => b.range[0] - a.range[0]);
  let out = code;
  for (const c of doomed) {
    let [start, end] = c.range;
    const before = out.slice(0, start);
    const after = out.slice(end);
    const jsx = before.match(/\{\s*$/) && after.match(/^\s*\}/);
    if (jsx) {
      start = before.search(/\{\s*$/);
      end = end + after.search(/\}/) + 1;
    }
    const lineStart = out.lastIndexOf("\n", start - 1) + 1;
    const nextNewline = out.indexOf("\n", end);
    const lineEnd = nextNewline === -1 ? out.length : nextNewline;
    const aloneOnLine = out.slice(lineStart, start).trim() === "" && out.slice(end, lineEnd).trim() === "";
    if (aloneOnLine) {
      out = out.slice(0, lineStart) + out.slice(nextNewline === -1 ? out.length : nextNewline + 1);
    } else {
      const trimmedStart = out.slice(0, start).replace(/[ \t]+$/, "").length;
      out = out.slice(0, trimmedStart) + out.slice(end);
    }
  }
  return out.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
};

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/strip-comments.mjs <file>...  (keeps `// platform:` and tool directives)");
  process.exit(1);
}
let changed = 0;
for (const file of files) {
  const code = fs.readFileSync(file, "utf8");
  const out = strip(code, file);
  if (out !== code) {
    fs.writeFileSync(file, out);
    changed++;
  }
}
console.log(`${changed} of ${files.length} files changed`);
