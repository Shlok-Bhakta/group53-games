import postcss from "postcss";
import fs from "node:fs";
const map = (file) => {
  const root = postcss.parse(fs.readFileSync(file, "utf8"));
  const m = new Map();
  root.walkRules((r) => {
    if (r.parent?.type === "atrule" && /keyframes/.test(r.parent.name)) return;
    let ctx = []; let p = r.parent;
    while (p && p.type !== "root") { if (p.type === "atrule" && p.name !== "layer") ctx.unshift(`@${p.name} ${p.params}`); p = p.parent; }
    const key = ctx.join(" ") + " | " + r.selector.replace(/\s+/g, " ");
    const decls = [];
    r.each((d) => d.type === "decl" && decls.push(`${d.prop}:${d.value.replace(/\s+/g," ")}${d.important ? "!" : ""}`));
    m.set(key, [...(m.get(key) ?? []), ...decls].sort().join("; "));
  });
  return m;
};
const a = map(process.argv[2]), b = map(process.argv[3]);
for (const [k, v] of a) if (b.get(k) !== v) console.log("- " + k + "\n    " + v + "\n  + " + (b.get(k) ?? "MISSING"));
for (const [k, v] of b) if (!a.has(k)) console.log("+NEW " + k + "\n    " + v);
