// Budget: the whole drop-in (game + engine + art + the Board UI kit CSS) stays small: 43 KB gzip.
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
let failed = false;
// blitz-net.mjs is the module plus net play (fizlet/presence, join, memory): its own budget, 2 KB over.
// 0.11.0: +3 KB each for the TUNE card (measured +3,063 / +3,091 / +3,064 B).
// 0.12.0: +1,220 B (js, mjs) and +1,210 B (net) for Tuning (dev), 4 firing levers and share links (measured +1,219 / +1,203 / +1,207 B).
for (const [file, budget] of [["dist/blitz.js", 45252], ["dist/blitz.mjs", 45252], ["dist/blitz-net.mjs", 47290]]) {
  const gz = gzipSync(readFileSync(file)).length, ok = gz <= budget;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "OVER"} ${file.padEnd(16)} ${gz} / ${budget} bytes gzip`);
}
if (failed) process.exit(1);
