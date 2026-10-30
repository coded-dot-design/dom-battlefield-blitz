// Budget: the whole drop-in (game + engine + art + the Board UI kit CSS) stays small: 41 KB gzip (40 KB until fizlet/steer and fizlet/coach, +1,109 B).
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
let failed = false;
// blitz-net.mjs is the module plus net play (fizlet/presence, join, memory): its own budget, 2 KB over.
for (const [file, budget] of [["dist/blitz.js", 41984], ["dist/blitz.mjs", 41984], ["dist/blitz-net.mjs", 44032]]) {
  const gz = gzipSync(readFileSync(file)).length, ok = gz <= budget;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "OVER"} ${file.padEnd(16)} ${gz} / ${budget} bytes gzip`);
}
if (failed) process.exit(1);
