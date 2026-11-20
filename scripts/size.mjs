// Budget: the whole drop-in (game + engine + art + the Board UI kit CSS) stays small: 43 KB gzip.
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
let failed = false;
// blitz-net.mjs is the module plus net play (@fzlt/core/presence, join, memory): its own budget, 2 KB over.
// 0.11.0: +3 KB each for the TUNE card (measured +3,063 / +3,091 / +3,064 B).
// Phone game mode + easy pause: +1.25 KB each (pause menu, resume countdown, net pause; measured +1,318 / +1,297 / +1,299 B).
// Phones in net play: +704 B each (the drive stick, the arena covering the screen and turned in portrait, the camera; measured +689 / +696 / +686 B).
// Net play room to hide + edge lights + auto-aim switch: +512 B each (measured +423 / +428 / +414 B).
// blitz.js and blitz.mjs 46,528 → 46,720 (+192 B, blitz-net unchanged): Fizlet 0.21.2 Board UI CSS 4,974 → 5,139 B gz (+165: shadow-direction settings + coach card fix); after sync blitz.js 46,399 / blitz.mjs 46,525 (on main 46,207 / 46,313).
// Phone start screen (#41): the directions behind a key (opens at START, closes in the countdown; key, Escape, tap
// elsewhere) and the sticker's mode tag. Measured on main 46,398 / 46,525 / 48,391 → 46,754 / 46,874 / 48,746
// (+356 / +349 / +355, of which the round-5 key and tag +167 / +164 / +175 after win-backs); budgets
// 46,720 / 46,720 / 48,576 → 46,784 / 46,912 / 48,768 (measured + 22-38 B).
// Movement on @fzlt/core/steer, the practice coach on @fzlt/core/coach (G13): measured on main 46,771 / 46,886 / 48,758
// → 47,761 / 47,918 / 49,757 (+990 / +1,032 / +999: the two bricks, less the game code they replace); budgets
// 46,784 / 46,912 / 48,768 → 47,808 / 47,936 / 49,792 (measured + 18-47 B).
for (const [file, budget] of [["dist/blitz.js", 47808], ["dist/blitz.mjs", 47936], ["dist/blitz-net.mjs", 49792]]) {
  const gz = gzipSync(readFileSync(file)).length, ok = gz <= budget;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "OVER"} ${file.padEnd(16)} ${gz} / ${budget} bytes gzip`);
}
if (failed) process.exit(1);
