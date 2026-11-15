import fs from "node:fs";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const [before, after, out = "e2e/.state/screens-diff"] = process.argv.slice(2);
if (!before || !after) {
  console.error("usage: node scripts/screens-diff.mjs <before dir> <after dir> [diff dir]");
  process.exit(2);
}

fs.mkdirSync(out, { recursive: true });
const names = [...new Set([...fs.readdirSync(before), ...fs.readdirSync(after)])].filter((n) => n.endsWith(".png")).sort();
const rows = [];
for (const name of names) {
  const a = path.join(before, name);
  const b = path.join(after, name);
  if (!fs.existsSync(a) || !fs.existsSync(b)) {
    rows.push({ name, status: fs.existsSync(a) ? "missing after" : "new" });
    continue;
  }
  const pa = PNG.sync.read(fs.readFileSync(a));
  const pb = PNG.sync.read(fs.readFileSync(b));
  if (pa.width !== pb.width || pa.height !== pb.height) {
    rows.push({ name, status: `size ${pa.width}x${pa.height} -> ${pb.width}x${pb.height}` });
    continue;
  }
  const diff = new PNG({ width: pa.width, height: pa.height });
  const changed = pixelmatch(pa.data, pb.data, diff.data, pa.width, pa.height, { threshold: 0.1 });
  const share = changed / (pa.width * pa.height);
  if (changed > 0) fs.writeFileSync(path.join(out, name), PNG.sync.write(diff));
  rows.push({ name, status: changed === 0 ? "same" : `${(share * 100).toFixed(2)}% (${changed} px)`, share });
}
for (const r of rows) console.log(`${r.status.padEnd(28)} ${r.name}`);
const same = rows.filter((r) => r.status === "same").length;
console.log(`\n${same} of ${rows.length} identical. Diffs in ${out}`);
