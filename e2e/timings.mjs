import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LAST_TIMINGS, testKey } from "./shards.mjs";

export default class Timings {
  seconds = {};
  rootDir = "";

  onBegin(config) {
    this.rootDir = config.rootDir;
  }

  onTestEnd(test, result) {
    const titles = [];
    for (let s = test.parent; s?.type === "describe"; s = s.parent) titles.unshift(s.title);
    const file = path.relative(this.rootDir, test.location.file).split(path.sep).join("/");
    this.seconds[testKey(file, [...titles, test.title])] = result.status === "skipped" ? 0 : Math.round(result.duration / 100) / 10;
  }

  onEnd() {
    const file = process.env.E2E_TIMINGS ?? LAST_TIMINGS;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(this.seconds, null, 2));
  }

  printsToStdio() {
    return false;
  }
}
