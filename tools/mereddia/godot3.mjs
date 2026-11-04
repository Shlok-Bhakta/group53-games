// A reader for Godot 3.x binary resources (.scn/.res) as RPG in a Box saves them: zstd-compressed
// "RSCC" blocks around a resource file whose "RSRC" magic has been stripped.
import fs from "node:fs";
import zlib from "node:zlib";

export function unwrap(file) {
  const b = fs.readFileSync(file);
  // Some files are stored uncompressed and keep their "RSRC" magic; the compressed ones have it stripped.
  if (b.toString("latin1", 0, 4) === "RSRC") return b;
  if (b.toString("latin1", 0, 4) !== "RSCC") return b;
  const block = b.readUInt32LE(8), total = b.readUInt32LE(12), n = Math.ceil(total / block);
  let off = 16 + 4 * n;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const sz = b.readUInt32LE(16 + 4 * i);
    parts.push(zlib.zstdDecompressSync(b.subarray(off, off + sz)));
    off += sz;
  }
  return Buffer.concat(parts);
}

class R {
  constructor(buf) { this.b = buf; this.o = 0; }
  u8() { return this.b[this.o++]; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  i32() { const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  u64() { const v = Number(this.b.readBigUInt64LE(this.o)); this.o += 8; return v; }
  i64() { const v = Number(this.b.readBigInt64LE(this.o)); this.o += 8; return v; }
  f32() { const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  f64() { const v = this.b.readDoubleLE(this.o); this.o += 8; return v; }
  str() { const n = this.u32(); const s = this.b.toString("utf8", this.o, this.o + n - 1); this.o += n; return s; }
  bytes(n) { const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
}

export class Obj { constructor(type, props) { this.type = type; this.props = props; } }
export class Ref { constructor(kind, v) { this.kind = kind; this.v = v; } }

export function parse(buf) {
  const r = new R(buf);
  // A file that kept its magic has absolute offsets; the stripped ones start straight at the header.
  if (buf.toString("latin1", 0, 4) === "RSRC") r.o = 4;
  r.u32(); const real64 = r.u32(); const major = r.u32(); const minor = r.u32(); const fmt = r.u32();
  const type = r.str();
  r.u64(); for (let i = 0; i < 14; i++) r.u32();
  const strings = []; for (let n = r.u32(), i = 0; i < n; i++) strings.push(r.str());
  const ext = []; for (let n = r.u32(), i = 0; i < n; i++) ext.push({ type: r.str(), path: r.str() });
  const ints = []; for (let n = r.u32(), i = 0; i < n; i++) ints.push({ path: r.str(), off: r.u64() });
  const real = () => (real64 ? r.f64() : r.f32());
  const variant = () => {
    const t = r.u32();
    switch (t) {
      case 1: return null;
      case 2: return r.u32() !== 0;
      case 3: return r.i32();
      case 4: return real();
      case 5: return r.str();
      case 10: return [real(), real()];
      case 11: return [real(), real(), real(), real()];
      case 12: return [real(), real(), real()];
      case 13: return [real(), real(), real(), real()];
      case 14: return [real(), real(), real(), real()];
      case 15: return [real(), real(), real(), real(), real(), real()];
      case 16: return Array.from({ length: 9 }, real);
      case 17: return Array.from({ length: 12 }, real);
      case 18: return Array.from({ length: 6 }, real);
      case 20: return [r.f32(), r.f32(), r.f32(), r.f32()];
      case 22: { const nc = r.u16(); let sc = r.u16(); sc &= 0x7fff; const names = []; for (let i = 0; i < nc + sc; i++) names.push(strings[r.u32()]); return { path: names }; }
      case 24: {
        const k = r.u32();
        if (k === 0) return null;
        if (k === 1) return new Ref("ext", { type: r.str(), path: r.str() });
        if (k === 2) return new Ref("int", r.u32());
        if (k === 3) return new Ref("extIdx", ext[r.u32()]);
        throw new Error("object kind " + k);
      }
      case 26: { const n = r.u32() & 0x7fffffff; const d = {}; for (let i = 0; i < n; i++) { const k = variant(); d[typeof k === "object" ? JSON.stringify(k) : k] = variant(); } return d; }
      case 30: { const n = r.u32() & 0x7fffffff; return Array.from({ length: n }, variant); }
      case 31: { const n = r.u32(); const v = Buffer.from(r.bytes(n)); const x = 4 - (n % 4); if (x < 4) r.bytes(x); return v; }
      case 32: { const n = r.u32(); return Int32Array.from({ length: n }, () => r.i32()); }
      case 33: { const n = r.u32(); return Float32Array.from({ length: n }, () => real()); }
      case 34: { const n = r.u32(); return Array.from({ length: n }, () => r.str()); }
      case 35: { const n = r.u32(); return Float32Array.from({ length: n * 3 }, () => real()); }
      case 36: { const n = r.u32(); return Float32Array.from({ length: n * 4 }, () => r.f32()); }
      case 37: { const n = r.u32(); return Float32Array.from({ length: n * 2 }, () => real()); }
      case 40: return r.i64();
      case 41: return r.f64();
      default: throw new Error(`variant ${t} at ${r.o}`);
    }
  };
  const resources = ints.map(({ path, off }) => {
    r.o = off;
    const rtype = r.str();
    const n = r.u32();
    const props = {};
    for (let i = 0; i < n; i++) { const name = strings[r.u32()]; props[name] = variant(); }
    return { path, obj: new Obj(rtype, props) };
  });
  return { type, version: [major, minor, fmt], strings, ext, resources };
}

export const load = (file) => parse(unwrap(file));
