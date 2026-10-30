// Budget: the whole drop-in (game + engine + art + the Board UI kit CSS) stays small: 40 KB gzip,
// plus the measured cost of accessible play (E14: keyboard airstrike, focus, one live region; CHANGELOG).
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
let failed = false;
// blitz-net.mjs is the module plus net play (fizlet/presence, join, memory): its own budget, 2 KB over.
for (const [file, budget] of [["dist/blitz.js", 40960 + 831], ["dist/blitz.mjs", 40960 + 834], ["dist/blitz-net.mjs", 43008 + 858]]) {
  const gz = gzipSync(readFileSync(file)).length, ok = gz <= budget;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "OVER"} ${file.padEnd(16)} ${gz} / ${budget} bytes gzip`);
}
if (failed) process.exit(1);
