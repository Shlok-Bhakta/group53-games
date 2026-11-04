// Compresses the RPG in a Box project's music and sound effects to MP3 for the web.
//
//   FFMPEG=path/to/ffmpeg node tools/mereddia/audio.mjs <project folder> <out folder>
//
// Music becomes 96 kbps stereo, effects 64 kbps mono. Names keep their spelling, with spaces turned into
// underscores ("Slime Walk.wav" -> sfx/Slime_Walk.mp3). `ffmpeg` is taken from $FFMPEG or the PATH.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [, , src, out] = process.argv;
if (!src || !out) {
  console.error("usage: FFMPEG=ffmpeg node tools/mereddia/audio.mjs <project folder> <out folder>");
  process.exit(1);
}
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";

function convert(from, to, args) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", from, "-vn", ...args, to], { stdio: "inherit" });
  return fs.statSync(to).size;
}

let total = 0;
for (const [dir, args] of [
  ["music", ["-ac", "2", "-ar", "44100", "-b:a", "96k"]],
  ["sounds", ["-ac", "1", "-ar", "44100", "-b:a", "64k"]],
]) {
  const folder = path.join(src, dir);
  for (const f of fs.readdirSync(folder)) {
    if (f.includes("backup") || !/\.(wav|ogg|mp3)$/i.test(f)) continue;
    const slug = f.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "_");
    const size = convert(path.join(folder, f), path.join(out, dir === "music" ? "music" : "sfx", `${slug}.mp3`), args);
    total += size;
    console.log(`${dir}/${f} -> ${(size / 1024).toFixed(0)} KB`);
  }
}
console.log(`total ${(total / 1024 / 1024).toFixed(1)} MB`);
