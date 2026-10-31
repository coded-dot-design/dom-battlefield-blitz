// Budget: the whole drop-in (game + engine + art + the Board UI kit CSS) stays small: 43 KB gzip.
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
let failed = false;
// blitz-net.mjs is the module plus net play (fizlet/presence, join, memory): its own budget, 2 KB over.
// 0.11.0: +3 KB each for the TUNE card (measured +3,063 / +3,091 / +3,064 B).
// Phone game mode + easy pause: +1.25 KB each (pause menu, resume countdown, net pause; measured +1,318 / +1,297 / +1,299 B).
// Phones in net play: +704 B each (the drive stick, the arena covering the screen and turned in portrait, the camera; measured +689 / +696 / +686 B).
// Net play room to hide + edge lights + auto-aim switch: +512 B each (measured +423 / +428 / +414 B).
for (const [file, budget] of [["dist/blitz.js", 46528], ["dist/blitz.mjs", 46528], ["dist/blitz-net.mjs", 48576]]) {
  const gz = gzipSync(readFileSync(file)).length, ok = gz <= budget;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "OVER"} ${file.padEnd(16)} ${gz} / ${budget} bytes gzip`);
}
if (failed) process.exit(1);
