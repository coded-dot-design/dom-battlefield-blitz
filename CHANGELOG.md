# Changelog

## 0.8.4

Still on Fizlet 0.15.0. **The step allocates nothing.** `npm test` checks it: 20,000 busy demo steps (free-for-all and platoons) make 0 minor GCs, measured on Chromium 153 (the bar is ≤ 1). 0.8.3 made 10 and 14. Gameplay is unchanged: the pinned digests (seeds 41, 42, 7 platoons) and five more seeds are the same as 0.8.2's, value for value. The one exception is below.

- **The step's numbers live in typed arrays.** The match's running numbers (clock, countdown, tile and crate timers, shake, whiteout, nuke timer, coach counters) moved into `G`, a `Float64Array`: a double stored in a closure variable is a new heap number on every write. The hot helpers (`blockedF`, `turnF`, `drive`, `hyp`, `shellHits`, `callStrike`, spawn's tries) take their numbers through `F`, a register `Float64Array`, because a number passed to or returned from a call V8 doesn't inline is boxed (fizlet-engine lesson K4). `circleRect`, `segCircle` and `inRect` are inlined with the same arithmetic. Rare paths (strikes, blasts, spawns) use index loops and `F` instead of `for…of` and loop locals, because they may stay on Maglev, where both allocate. A respawn assigns fields one by one instead of `Object.assign` with a literal.
- **Effects are queued by the step and played by render.** `fx.spawn`, `fx.word` and `fx.blast` take up to a dozen numbers each. The step stages them in a typed queue, and render plays the queue in order before it draws. Same particles, words and blasts. A particle now starts at the frame's draw instead of mid-frame, which is the same at one step per frame.
- **The screen shake no longer draws from `engine.random`** (a determinism fix). `draw()` took the shake offset from the seeded gameplay random, so in a board, platoon or practice match where the screen shook, how often the screen was drawn changed the match. It now has its own LCG, seeded from the match's seed. Demo matches never shake, so their digests are unchanged. Board matches where you get hit now play differently from 0.8.3, and they replay. `test:replay` checks that a board match with you getting hit plays the same whether each step is drawn once or twice (0.8.3 fails that check).
- Size: `dist/blitz.js` 37,885 → 39,143 B gzip (`dist/blitz.mjs` 37,970 → 39,245). Budget 40,960 B.

## 0.8.3

E3 acceptance work (`fe port-check`). Gameplay is unchanged, value for value: seeds 41, 42 and 7 (platoons) play the 0.8.2 matches bit for bit (every number of every tank, shell, tile, block, plane, bomb, mark and crate, every frame for 3,600 frames), and `npm run test:replay` now checks that (digests pinned per Chrome major: V8's math differs in the last bit between versions; 145 is CI's, 153 a newer local build).

- **On Fizlet 0.15.0** (was 0.14.1): `vendor/fizlet` re-synced with `scripts/sync.mjs` from the v0.15.0 release commit (`c6ffc1e`). 0.8.2's snapshot named the pre-squash branch commit (`5e21221`); the files were the v0.14.1 release, the provenance wasn't. Brings board-page's refresh clock from `engine.timing` and the kernel's every-frame maximum (no deopt on a new record).
- **No `Math.hypot` in the step** (26 calls): V8's allocates on every call. A module `dist` returns exactly what `Math.hypot` returned (it scales by the larger side as V8 does), so no number moves.
- **No wall clock in the step.** A cover's knock cool-down (embed) runs on match time instead of `performance.now()`: the knock draws `engine.random`, so a page-cover match no longer depends on the wall clock. The remaining `performance.now()` calls are the read phase (page re-measure throttle) and the draw (tile colour cycle), marked `port-check: ok` with why.
- **Tests:** `npm test` (node:test, files one at a time) runs `tests/zero-gc.test.mjs`: 20,000 busy demo steps with no read or render (`world.steps(n)`, a new debug hook), minor GCs counted from V8's trace events. It is a TODO: the step still allocates (10 minor GCs in 20,000 steps; its tanks and shells are objects and the numbers it passes to the collide and fx bricks box) until the step's E3 port.
- Size: `dist/blitz.js` 37,813 → 37,885 B gzip (`dist/blitz.mjs` 37,899 → 37,970). Budget 40,960 B.

## 0.8.2

- **On Fizlet 0.14.1** (was 0.12.0): `vendor/fizlet` re-synced with `scripts/sync.mjs`, for the Board
  UI page-key fix (fizlet#38): press beats hover, the face and its base take the click, and
  `pressCue` (keyboard press, iOS `:active`). Also brings 0.12.1–0.14.0 (arcade scoreboard,
  board-page `hitAt`/`nearAt`/letters, `Ledger.unstyle`); Blitz's gameplay is unchanged (`test:replay`).
- **Site keys are the kit's.** Every in-page key wears `bui-key` (theme, Drop Blitz); PLAY BLITZ is
  the kit sticker key (`bui-key bui-sticker-key bui-call`) at page size instead of its own
  `.start-key` states, so it presses onto its base and clicks on the base too. `tests/keys.mjs` in
  `test:site` presses every page key (centre, top edge, base; Enter; taps at 390).
- Size: `dist/blitz.js` 37,614 → 37,813 B gzip (`dist/blitz.mjs` 37,707 → 37,899). Budget 40,960 B.
- **Site structure and structured data** (check-html: 0 errors on both pages). Footer column titles
  h4 → h2, same look (`.site-foot h2` keeps the old rule), so the landing page no longer jumps
  h2 → h4. `/play/` gets a screen-reader h1 ("Play Battlefield Blitz"); the arena stays the visible
  title. JSON-LD from facts already on the page: WebSite + VideoGame on `/`, WebPage + BreadcrumbList
  on `/play/`. `site/engine.config.json` marks `/play/*` as a game route (scripts expected).
- No gameplay or design change from the SEO pass (#7); it ships in 0.8.2 with the vendor re-sync above.

## 0.8.1

- **On Fizlet 0.12.0** (was 0.10.0): `vendor/fizlet` re-synced with `scripts/sync.mjs`.
- **Supply crates read the brick, not a side table.** Blitz no longer keeps each crate's spawn time
  by its x: the fall shadow is drawn at the brick's landing spot (`landY`) and scaled by its `age`,
  the blink counts `life` − `age`, and the landing puff comes from the `drop:land` event
  (fizlet/rules 0.10.1). Gameplay is unchanged: five seeds × 7,200 frames give the same tanks,
  shells, bombs and crates, value for value, as 0.8.0; `npm run test:replay` passes.
- Size: `dist/blitz.js` 37,639 → 37,614 B gzip (`dist/blitz.mjs` 37,740 → 37,707). Budget 40,960 B.

## 0.8.0

- **On Fizlet 0.10.0** (was 0.2.4): `vendor/fizlet` re-synced with `scripts/sync.mjs`. No API
  changes were needed; the browser test passes unchanged.
- **Replayable:** every random number in a match now comes from the engine's seeded random
  (`engine.random`), and the practice dummies' turret sway runs on engine time instead of the
  wall clock. New option `seed`: the same seed and the same input give the same match. New test
  `npm run test:replay` (also in CI): seed 41 twice is identical over 3,600 frames, seed 42
  differs, and nothing calls `Math.random` while playing (0.7.0 made about 7,700 calls per
  600 frames of the demo).
- **Supply crates run on `fizlet/rules`** (`drops`): 2 at once, the 2.2 s parachute fall and
  14 s on the ground, as before. Same kinds, odds, pickup radius and rewards; the draw code is
  Blitz's own.
- Size: `dist/blitz.js` 34,501 → 37,639 B gzip: +2,277 B from the newer bricks (0.2.4 → 0.10.0),
  +861 B for the rules brick net of the crate code it replaces. Budget 40,960 B.

## 0.7.0

- Blitz has its own site: the landing page at `/` and the game at `/play/`, with the drop-in at
  `/blitz.js`. They're the pages that lived on the Battlefield site under `/blitz/`, moved over
  unchanged with DOM Battlefield's brand and the Board UI kit. They're built with Astro (dev only)
  and deployed to GitHub Pages by `pages.yml`.
- Ready for battlefieldblitz.domvirus.com: with the repo variables `SITE_URL=https://battlefieldblitz.domvirus.com` and
  `SITE_BASE=/`, the Pages build writes `CNAME` and every canonical and og URL is on that host.
  The site links to DOM Battlefield (battlefield.domvirus.com) and DOM VIRUS (domvirus.com).

## 0.6.5

- Phones: more room between the start sticker, the mode keys and PRESS START.

## 0.6.4

- Fix: the short-screen rule for the controls strip now actually applies.

## 0.6.3

- Short screens (landscape phones): the controls strip steps aside so the start sticker and keys fit
  (PRACTICE teaches the same keys).

## 0.6.2

- The pad's drag handle is the Battlefield card grip (the kit's `.bui-grip`, Fizlet 0.2.4): a flat violet
  tab with dark dots, with a bigger invisible touch area.

## 0.6.1

- The SURRENDER key's white flag shows its grid lines, frame and flag outline again (Fizlet 0.2.3 kit).

## 0.6.0

- Pause is the surrender question, exactly as in DOM Battlefield (Board UI kit overlay): the white
  flag key (top left, Esc / P) dims the board and slams BATTLE PAUSED / GIVE UP? with KEEP FIGHTING
  and SURRENDER. Surrender whites out your team grid, waves the flag, bursts and ends the match
  (in practice it goes back to the start screen).
- Results use the kit overlay too: STAGE CLEAR (you win), INSERT COIN (someone else wins) or WHITE
  FLAG / GAME OVER (you gave up), the standings, then REMATCH and NEW GAME (back to the mode picker).

## 0.5.0

- Blitz now wears the Board UI kit (Fizlet's ui brick), the same CSS as DOM Battlefield, so keys
  look and behave the same on both boards in dark and light: the round keys are kit arcade keys
  (FIRE in the fire colour, AUTO and LOCK in the aim colour, dim off and lit and breathing when
  locked, STRIKE in attack pink), the mode picker is the kit's segmented choice (the picked mode
  stays pressed in), PRESS START / REMATCH / KEEP FIGHTING are kit sticker keys (white face and
  ink rim in light), and PRESS START bursts with the kit's launch(). HUD, feed, table and notes
  use the kit tokens, so they flip with the theme too.
- Full screen key (top left, board): real full screen where allowed (landscape on phones), else
  the board fills the window.
- More room on the start screen between the sticker, the modes and PRESS START.
- Size budget 40 KB gzip (the kit CSS is ~3 KB of it).

## 0.4.1

- Practice TARGETs can't be shoved around (bumping one pushes only you).

## 0.4.0

- PRACTICE mode: no clock, TARGET tanks that stand still and MOVERs that drive about (none shoot),
  a 10-step coach for every control and reward (with the right key pulsing), then tricks.
  Endless long shots and strikes. END PRACTICE returns to the start screen.
- The pad, like the Battlefield cockpit: AUTO and LOCK ride on FIRE, LONG and STRIKE sit in a row
  above, and a grab bar moves the whole pad (remembered; double-click resets).
- Shake is about you now: only blasts near your tank move the screen (closer = harder), hits
  you take shake it by how hard they were, and phones vibrate when you're hit.
- Start screen: the controls note runs across the top; the sticker no longer blocks the mode
  keys while it slams in.
- Fix: a very quick tap on FIRE always fires.

## 0.3.0

- PLATOON mode: you and three wingmen in your colour against two other platoons of four. Pick
  SOLO or PLATOON on the start screen (remembered). No friendly fire; wingmen hold a slot behind
  you, cover you (they go for whoever hit you) and parachute in next to you; enemy platoons
  follow their lead tank. HUD shows TEAM kills and the leading platoon; the result ranks the
  platoons. Option `platoons: true`, drop-in `data-platoons="true"`.

## 0.2.0

Blitz steps it up:
- Round arcade keys bottom right, like the Battlefield cockpit: FIRE (hold), LONG, STRIKE, AUTO
  and LOCK, with ammo badges and key hints on desktop.
- Your tank wears a marching dashed ring (and your landing spot shows while you parachute in).
- Two guns: the fast cannon (overheats; Rapid tiles cool it) and the LONG gun: lock on, then a
  guided round crosses the field, punches through cover and wrecks in one hit. 3 to start.
- Airstrikes: press STRIKE, tap the spot. The big Battlefield crosshair follows your pointer, a
  bomber flies over, the bombs fall and blow with the hero's triple blasts and black scorch.
- AUTO aim (on by default on phones) and aim LOCK (tap a tank to switch target).
- Health and long-ammo tiles; supply crates parachute in (medkit, ammo, strike, jackpot); every
  kill patches 1 armour; armour is now 5 with a bar in the HUD.
- Kill streaks: 2 long shot, 3 airstrike, 5 carpet bomb, 8 nuke. A streak banner slams in.
- Start screen: the Battlefield boot sticker with Blitz branding, the PRESS START key that
  shatters when pressed, and the grid lighting up with every tile behind it.
- Light mode: the board follows the page theme.
- Fix: one-frame key presses could be missed on frames that ran no step.

## 0.1.0

First playable Blitz, built on Fizlet 0.2.1:
- Free-for-all for 8 tanks (you + 7 bots on the board, 5 on a dropped-in page); infinite
  respawns by parachute; most kills in 3 minutes wins (board); endless on a page.
- The blinking grid: lit squares roll like a slot machine, then settle into Rapid, Triple,
  Airstrike, Shield or a Mine.
- Airstrikes (Q / right-click / ✚): three staggered blasts on the target.
- Board: cover blocks that crack and come back, intro, 3-2-1 countdown, pause, result with
  standings, rematch. Demo (attract) mode for landing pages.
- Drop-in: a PLAY BLITZ key (or an easter egg), the page as the arena (shells knock its elements,
  treads flatten them), Escape closes and the page is exactly as it was.
- 17 KB gzip, engine and art included.
