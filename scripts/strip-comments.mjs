import fs from "node:fs";
import { parse, simpleTraverse } from "@typescript-eslint/typescript-estree";

const KEEP = /^\s*(platform:|@vite-ignore|[#@]__PURE__|@refresh|webpackChunkName|\/ <reference)/;

const parseFile = (code, file) => parse(code, { comment: true, range: true, loc: false, jsx: /\.(tsx|jsx|mjs|js)$/.test(file) });

const isEmptyJsxContainer = (node) => node?.type === "JSXExpressionContainer" && node.expression.type === "JSXEmptyExpression";

const jsxText = (value) => {
  const lines = value.split(/\r\n|\n|\r/);
  const lastFilled = lines.reduce((at, line, i) => (/[^ \t]/.test(line) ? i : at), -1);
  return lines
    .map((line, i) => {
      let text = line.replace(/\t/g, " ");
      if (i !== 0) text = text.replace(/^ +/, "");
      if (i !== lines.length - 1) text = text.replace(/ +$/, "");
      return text && i !== lastFilled ? `${text} ` : text;
    })
    .join("");
};

const shapeChildren = (children) => {
  const merged = [];
  for (const child of children) {
    if (isEmptyJsxContainer(child)) continue;
    const previous = merged.at(-1);
    if (child?.type === "JSXText" && previous?.type === "JSXText") previous.value += child.value;
    else merged.push(child?.type === "JSXText" ? { type: "JSXText", value: child.value } : child);
  }
  return merged
    .map((child) => (child?.type === "JSXText" ? { type: "JSXText", text: jsxText(child.value) } : shape(child)))
    .filter((child) => !(child?.type === "JSXText" && child.text === ""));
};

const shape = (node) => {
  if (Array.isArray(node)) return node.map(shape);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "range" || key === "loc" || key === "parent" || key === "comments" || key === "tokens") continue;
    out[key] = key === "children" && Array.isArray(value) ? shapeChildren(value) : shape(value);
  }
  return out;
};

const strip = (code, file) => {
  const ast = parseFile(code, file);
  const containers = [];
  simpleTraverse(ast, { enter: (node) => isEmptyJsxContainer(node) && containers.push(node.range) });
  const cuts = new Map();
  for (const comment of ast.comments) {
    if (KEEP.test(comment.value)) continue;
    const container = containers.find(([s, e]) => comment.range[0] > s && comment.range[1] < e);
    const range = container ?? comment.range;
    cuts.set(range[0], { range, jsx: Boolean(container) });
  }
  let out = code;
  for (const { range, jsx } of [...cuts.values()].sort((a, b) => b.range[0] - a.range[0])) {
    const [start, end] = range;
    const lineStart = out.lastIndexOf("\n", start - 1) + 1;
    const nextNewline = out.indexOf("\n", end);
    const lineEnd = nextNewline === -1 ? out.length : nextNewline;
    const aloneOnLine = out.slice(lineStart, start).trim() === "" && out.slice(end, lineEnd).trim() === "";
    if (aloneOnLine) {
      out = out.slice(0, lineStart) + out.slice(nextNewline === -1 ? out.length : nextNewline + 1);
    } else if (jsx) {
      out = out.slice(0, start) + out.slice(end);
    } else {
      const trimmedStart = out.slice(0, start).replace(/[ \t]+$/, "").length;
      out = out.slice(0, trimmedStart) + out.slice(end);
    }
  }
  out = out.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  if (JSON.stringify(shape(parseFile(out, file))) !== JSON.stringify(shape(ast))) {
    throw new Error(`${file}: stripping comments would change the code, so it was left alone. Remove these comments by hand.`);
  }
  return out;
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
