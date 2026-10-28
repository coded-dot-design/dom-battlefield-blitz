// Budget: the whole drop-in (game + engine + art) stays small.
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
let failed = false;
for (const [file, budget] of [["dist/blitz.js", 32768], ["dist/blitz.mjs", 32768]]) {
  const gz = gzipSync(readFileSync(file)).length, ok = gz <= budget;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "OVER"} ${file.padEnd(16)} ${gz} / ${budget} bytes gzip`);
}
if (failed) process.exit(1);
