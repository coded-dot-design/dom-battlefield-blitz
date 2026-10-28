// Budget: the whole drop-in (game + engine + art + the Board UI kit CSS) stays small: 40 KB gzip.
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
let failed = false;
for (const [file, budget] of [["dist/blitz.js", 40960], ["dist/blitz.mjs", 40960]]) {
  const gz = gzipSync(readFileSync(file)).length, ok = gz <= budget;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "OVER"} ${file.padEnd(16)} ${gz} / ${budget} bytes gzip`);
}
if (failed) process.exit(1);
