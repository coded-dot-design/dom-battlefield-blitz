# Changelog

## Unreleased

- **Phone game mode and easy pause** (owner: "make sure pause controls are easy, and also that Blitz is loaded in game mode on phone: no header/footer UI"). Pending owner review.
  - **Game mode** (`site.css`, one rule for `/play/` and `/play/two/`): a coarse pointer on a small screen (`(pointer: coarse) and (max-width: 900px)`, or `max-height: 500px` in landscape), in CSS so the first paint is the game. No header, footer or bar on screen (all still in the HTML: the h1, landmarks, the footer and "Created by Chris Cooley"), the board is `100dvh` with safe-area insets, nothing scrolls, no layout shift, the iOS gesture lock stays. A 44 px exit key (home icon) on the game's key row goes back to the Blitz home. Before, any coarse pointer (tablets too) or any window under 760 px (desktop too) got it. Desktop keeps its layout.
  - **PAUSE key** (the white-flag key, now a pause icon and "PAUSE" on desktop): always on the top-left key row, 44 px on phones, clear of the stick, pad and scoreboard (on narrow screens the scoreboard moves under the key row). Escape and P pause; the tab hidden or the phone locked pauses.
  - **The pause menu**: RESUME (big, primary; a 3-2-1 over the held board before play goes on), RESTART, QUIT TO MENU, and SURRENDER (the white flag, as before). The byline "by Chris Cooley", PRIVACY (domvirus.com/legal/privacy/) and a COOKIE SETTINGS slot for the shared consent pattern (shown only when the page sets `<html data-consent>`; it sends a composed `consent:open` event). No analytics. Crates no longer fall through a pause.
  - **Net play pauses every screen, never one in silence**: a pause is bit 12 of the player's lockstep input word, so every peer pauses on the same frame ("P2 PAUSED" with the pause time left; RESUME and LEAVE ROOM for the one who paused). Each seat has 45 s of pause a match; letting go or running out resumes everyone after the same 3 s countdown. A tab going hidden sends its pause first (one lockstep frame, the normal path). Same match: 0 desyncs, zero-alloc step.
  - Tests: `tests/pause.mjs` (in `test:browser`) and `tests/phone.mjs` (in `test:site`; 390×844, 844×390, 1440×900). Sizes (gzip): `blitz.js` 43,769 → 45,087, `blitz.mjs` 43,886 → 45,183, `blitz-net.mjs` 45,361 → 46,660 (budgets +1.25 KB).

- **Reduced motion: no screen shake.** Under `prefers-reduced-motion: reduce` the arena no longer shakes for blasts, hits and the nuke (up to 18 px before; the stickers and launch effects already calmed down). Drawing only: the shake has its own render-side random, so the match is the same (`test:replay` value for value, `test:lockstep` 0 desyncs). `test:browser` steps one seeded match both ways: it shakes without the setting, never with it, same hash. Sizes (gzip, on 0.11.0): `blitz.js` 43,752 → 43,769, `blitz.mjs` 43,864 → 43,886, `blitz-net.mjs` 45,331 → 45,361.

## 0.11.0

- **Dial in the pace: TUNE levers, team sizes for two players, and find your tank** (owner: "so fun but so fast
  you lose your guy … add some sort of slider … 2 player should have platoon option and 1v1"). No default changed:
  an untouched game plays bit for bit as before (`test:replay` plays the 0.8.2 matches value for value).
  - **TUNE** (Practice: a TUNE key on the coach card opens a Board UI card). Eight levers, one config layer
    (`TU`) the step reads at its seams. Defaults are the numbers the game used: GAME SPEED 1.00× (the fixed
    step's dt × speed: every timer and move), TANK SPEED 150 px/s, TURRET TURN 1.00× (players' and bots'
    aim), FIRE RATE 1.00× (cannon cooldown ÷ rate, everyone), SHELL SPEED 600 px/s (same reach: a slower
    shell lives longer), RESPAWN 2.2 s, SOLO BOTS 7 (next match), BOT AIRSTRIKES 1.0× (how often bots
    call in the strikes they hold). Each shows its value and its default; changed ones turn amber.
    RESET puts them all back; COPY SETTINGS puts the JSON on the clipboard (or selects it to copy by
    hand), and the card shows the same line. Saved on this device (`blitz:tune`, try/catch): Practice
    plays them live, SOLO and PLATOON read them at the next match, and the start screen says
    "TUNED · n LEVERS CHANGED". Not in net play (the drop-in and the attract match keep the defaults too):
    lockstep needs the same numbers on every peer, so online matches play the defaults. `createBlitz({ tune })`
    sets them in any mode (net play: every peer must pass the same). A slider's arrow keys don't drive;
    Escape closes the card. New shadows use the unitless shadow tokens (`--shadow-x`, `--shadow-y`, `--shadow-color`).
  - **Two players: teams.** The room card's TEAMS pick: FFA (default, as before: 2 players + 4 bots),
    1V1, 2V2, 3V3, 4V4 (each player + AI wingmen in their colour, who follow and cover them like PLATOON
    wingmen). P1's pick is the match's: it rides in bits 9-11 of P1's input word through the countdown, so
    every peer builds the same roster on the same lockstep frame (no seat or room-server change). The
    countdown says `2 V 2`, the card header `LIVE · 2V2`, the share link carries `&teams=`. Two-player
    rooms only (3 and 4 players stay free-for-all). `net.squad` in the module.
  - **Find your tank.** Each time you land (the start and every respawn) three rings ripple out from your
    tank and a YOU chevron drops onto it for 1.4 s (one fading ring with reduced motion). Drawn in the
    engine's render phase on the screen's clock, never the match's.
  - Sizes (gzip): `blitz.js` 40,689 → 43,752 (+3,063), `blitz.mjs` 40,773 → 43,864 (+3,091),
    `blitz-net.mjs` 42,267 → 45,331 (+3,064): the TUNE card (its CSS, the eight levers and the panel code)
    is most of it. Budgets +3 KB: 40,960 → 44,032 (drop-in and module), 43,008 → 46,080 (net).
  - Tests: `test:browser` opens TUNE, moves sliders by keys and by input, checks the readout, the saved
    JSON, COPY SETTINGS on the clipboard, persistence into a new game, SOLO BOTS (4 tanks), a tuned shell
    (450 px/s, same reach), RESET (defaults back, saved settings cleared), and the locate pulse.
    `test:lockstep`: 1v1 to 4v4 with P2 asking for another size: both peers play P1's, 2k tanks, k a
    side, 0 desyncs; free-for-all unchanged. `npm test` (zero-GC) adds a tuned match (every lever off its
    default): ≤ 1 minor GC in 20,000 steps. `test:site`: the TEAMS pick (two players only), P1's pick on
    every screen, the tank count, the link.

- **No `shared/` copy (G4).** The tank art moves to `src/sherman-sprites.ts`, contents unchanged (taken from Sherman Bytes 0.5.2, `66000fb`). `shared/ORIGIN.json` goes, `scripts/sync.mjs` refreshes `vendor/fizlet/` only, and `tsconfig.json` drops `shared/**`. Why not a brick: the tanks are game art, and redrawing them on `fizlet/sprite` would change their pixels (same call as dom-battlefield#19). The rebuilt `dist/` is byte-identical, so play and art don't change.
- **Fizlet 0.20.0** in `vendor/fizlet/` (tag `v0.20.0`, `bf42a8c`; `node scripts/sync.mjs`, no hand edits; `shared/` unchanged at sherman-bytes 0.5.2). Same matches: `test:replay` plays the 0.8.2 matches value for value; `test:lockstep` 0 desyncs.
  - The `join(url, signal, protocols)` shim is gone: `src/join.ts` is deleted and `src/net.ts` exports the vendored `join` from `fizlet/presence` (fizlet#113). `tests/multiplayer.mjs` passes on both invite forms (subprotocol and `?invite=`).
  - Pinch lock: the site's own `site/src/scripts/touch.ts` is gone; `Base.astro` imports `lockTouch` from `vendor/fizlet/touch`. The page's touch CSS is the Board UI kit's now, so `site.css` drops its copy; the hero is `data-touch-lock="y"` (the kit's `pan-y`; a bare `[data-touch-lock]` is `none` in the kit), so the page still scrolls through it.
  - Blitz draws its own HUD (no `fizlet/arcade` or `skirmishHud` import), so the skirmish preset's move onto `fizlet/match` does not reach it; `test:browser` still runs intro → countdown → play → pause / resume → result and the pad keys, unchanged.
  - Sizes (gzip, all within budget, none raised): `blitz.js` 40,507 → 40,689, `blitz.mjs` 40,610 → 40,773, `blitz-net.mjs` 42,143 → 42,267. Measured per module: the kit's touch CSS (board-ui.css 8,301 → 8,506 alone; the drop-in carries the kit), `fizlet/input` intents and wake +52, `fizlet/presence` first-input-wins +42 (net build only), `fizlet/sound` +15, kernel +6.
- **Multiplayer: invite codes out of URLs** (for fizlet-rooms hardening, fizlet#114 / #113).
  - The code is checked by `POST /invite` (code in the body, a simple request: no preflight) and
    joins with the WebSocket subprotocols `["fizlet-rooms", "invite." + code]`, not `?invite=`.
  - Works on both servers: the deployed one ignores the method and answers a POST with `403`, so on
    `403`/`404`/`405` the page asks once more by `?code=` and, if that passes, joins by `?invite=`.
    **Next release:** drop that fallback when fizlet-rooms drops the URL forms. Until then, a wrong
    code on the new server also goes once by `?code=` (its invocation logs are off); a right one never does.
  - A `?code=` (or `?invite=`) link prefills the form from memory, and the page takes it out of the
    address bar and history (`history.replaceState`) before anything loads; the page is
    `referrer: no-referrer`. SEND LINK carries the room and players only: tell friends the code.
  - A rate-capped check (`429`) says "Too many tries. Wait a minute".
  - `join(url, signal, protocols)` is a local shim (`src/join.ts`) until the next Fizlet vendor sync
    brings fizlet#113; `vendor/` is untouched. `dist/blitz-net.mjs` +85 B gzip (42,143 / 43,008);
    `blitz.js` and `blitz.mjs` are unchanged.
  - `tests/multiplayer.mjs` runs against both servers (alternating runs): "new" refuses a join
    without the subprotocol and records any code in a URL or referrer (must be none); "old" fails a
    handshake that offers protocols, like a browser without the `101` echo. Also checks the `?code=`
    prefill and strip, a wrong code refused, and a share link without the code.
- **Multiplayer page (`/play/two/`): the full board, one room card, and 2 to 4 players.**
  - The board fills the stage like `/play/` (an attract match runs behind until yours starts). The
    dimmed lobby is gone: everything about the room is ONE Board UI card over the board (kit card,
    grip, keys), draggable by its grip or header (kept whole on the board, remembered on this
    device, double-click puts it back) and foldable to its header. In a match it folds on phones.
  - The card's header always shows the room, your seat (`ROOM 3 · P1`) and the link: a dot that is
    grey (not connected), blinking (waiting), green (live), blinking red-orange (frames stalled:
    "WAITING FOR THE OTHERS…") or red (left / lost).
  - Waiting: a seat per player in its tank colour (YOU, then open seats).
  - In the match: a live scoreboard, one row per player in its tank colour (P1..P4, `YOU` marked,
    kills and deaths, dimmed while down), and LEAVE.
  - Someone left: says who (`P3 left…`) with REJOIN / NEW ROOM. No moves for 8 s: CONNECTION LOST
    with REJOIN (before, a dropped socket waited forever).
  - **3 and 4 players:** a PLAYERS pick (2 · 3 · 4) shows when the room server says it allows more
    than two (`/invite` returns `players`, fizlet-rooms change in its own PR). The live server says
    nothing yet, so the page stays two-player until that change is deployed. The game already ran
    any number of humans (`net.players`); the share link carries `players`.
  - No game change: `dist/` is unchanged.
- `tests/multiplayer.mjs` (in `test:site`): 2 and 4 players through a mock room server (the
  fizlet-rooms relay over Playwright's WebSocket routing, one browser context per player) at
  1440×900 and 390×844, light and dark: join, waiting seats, a live match with a row per player in
  its tank colour and one YOU, no desync, the last player leaving (named to the others), REJOIN; no
  sideways scroll, the card whole on the board, every card key ≥ 44 px. `SHOTS=<dir>` saves screenshots.
- **Phones: taps and swipes never zoom or pan the page** (owner: "for mobile all of our pages right
  now need to lock down double tap and pinch to zoom"). The page is `touch-action: manipulation`
  (no double-tap zoom) with `text-size-adjust: 100%`; the hero battle is `[data-touch-lock]`:
  `touch-action: pan-y` and `overscroll-behavior: none`, so the page still scrolls through it but a
  swipe never pans it sideways, and `lockTouch` (Fizlet's `fizlet/touch` rule, in
  `site/src/scripts/touch.ts` until the next vendor sync) cancels a pinch on it, iOS gesture events
  included. The landing keeps pinch-zoom on the copy (WCAG 1.4.4); `/play/` already turns zoom off.
  `test:site` pinches, swipes and double-taps the hero at 390 × 844 (touch): scale stays 1, the page
  390 wide.

## 0.10.0

- **The scoreboard drags.** Board UI rule: in-page scoreboards always drag.
  - Drag the bar at the top from any part of it. It stays whole on the board and is remembered on
    this device; a double-click puts it back. The keys keep their grab bar and work the same way.
  - Both use one `movable()` helper in Blitz. Fizlet 0.19's `drag()` places by viewport
    coordinates, which only works for a full-window overlay; Blitz's board sits below a page header
    on `/play/`, so Blitz keeps its own (and `drag()` isn't bundled).
  - `test:browser` drags the scoreboard, checks it's remembered, and double-clicks it back.
- **Fizlet 0.19.0** (vendored from 0.15.0). No game change: `test:replay` plays the pinned 0.8.2
  matches value for value, and `test:lockstep` stays identical.
- Size: `dist/blitz.js` 40,298 → 40,507 B gzip, `dist/blitz.mjs` 40,399 → 40,609,
  `dist/blitz-net.mjs` 41,836 → 42,057 (0.19 kernel and kit, plus the drag). Budgets unchanged
  (40,960; blitz-net 43,008).
- `test:browser`: LONG presses until a round is spent instead of waiting 3 s (a CI flake).
- **Two players: a real lobby and a phone layout (`/play/two/`).** The page is one full-screen
  stage like `/play/` (no header, footer or scroll on phones), with a Board UI card over the arena:
  - **Join:** invite code, room − / + (`?room=` and `?code=` prefill it), JOIN.
  - **Waiting for player 2:** SEND LINK (share sheet, or copies a link with the room and code) and
    CANCEL.
  - The game's own countdown, then the match.
  - **Result:** REMATCH (both players, the same room, a fresh seed) or NEW ROOM.
  - **The other player left:** REJOIN or NEW ROOM. Before, the match just waited forever.
  - A short landscape phone gets a two-column card. Every lobby key is at least 44 px.
  - Game: `net.again` / `net.leave` put REMATCH / NEW ROOM keys on the net result (no rules
    change; determinism and lockstep tests unchanged).
  - The page frees its room 2 s after the match ends, so a slower peer still gets its last inputs.
  - `test:site` checks the join card at 390×844, 844×390 and 1440×900 (no sideways scroll, on
    screen, keys ≥ 44 px, a bad code refused).
- **Site: the hero scrim follows the theme.** In light mode the gradient behind the hero copy was
  still the dark one (near-black over the light grid). It now fades from the theme's token
  (dark `--bg`, light `--surface`), and the hero copy is on tokens too: headline and eyebrow `--ink`,
  lead and "The original" link `--muted`, the pink line `--k-attack` and BLITZ VERSION `--k-sys-ink`
  (both mixed 25% toward `--ink` in light mode, for AA on white). The hero background is `--bg`.
  Dark mode barely moves (the lead and link are a shade dimmer on `--muted`). `tests/hero-scrim.mjs` in `test:site` checks both themes (stored theme
  with the OS set the other way, the theme key, 1440 and 390): the scrim's first stop is the token
  and every hero text colour passes WCAG AA on the scrim and on the bare page. No game change.

## 0.9.0

- **Two players in lockstep** (`net` option, demo). Every peer runs the same match from the room's
  seed and only inputs travel, through `fizlet/presence`. A fixed 1100 × 640 arena scaled to fit (so
  any two screens play one match), humans in seats 0..players-1 and bots after, one 32-bit input word
  per player per frame (drive, fire, long shot, airstrike at the pointer, aim mode, pointer), and a
  match hash compared every 30 frames.
- **`dist/blitz-net.mjs`**, a new module: everything in `blitz.mjs` plus net play (fizlet/presence,
  `join`, `memory`), with its own budget of 43,008 B gzip. The drop-in and `blitz.mjs` stay solo, so
  they don't carry the lockstep code. `examples/two-player.html` is the demo page (invite code → room → play).
- `npm run test:lockstep`: two peers on 1100 × 640 and 700 × 460 screens, scripted inputs, 3,600
  frames identical every 600 frames; with 6 ± 5 ticks of jitter too, giving the same match as with no
  latency; 0 desyncs, 0 `Math.random` in play. `tests/room.mjs` (needs a room server, skipped in CI):
  measured locally through `wrangler dev`, 1,800 frames identical every 300 frames.
- Crates (`fizlet/rules` drops) step inside the match step in net play, so a peer waiting for input
  doesn't move them.
- Size: `dist/blitz.js` 39,143 → 40,251 B gzip, `dist/blitz.mjs` 39,245 → 40,355 (net hooks:
  input word, match hash, fixed arena); `dist/blitz-net.mjs` 41,785 (budget 43,008). Budget 40,960 B.
- Solo play is unchanged: `test:replay` still plays the pinned 0.8.2 matches value for value.

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
