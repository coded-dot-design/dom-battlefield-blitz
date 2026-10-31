# Battlefield Blitz

**Free-for-all tank chaos. The arcade version of [DOM Battlefield](https://battlefield.domvirus.com/).**

Every tank for itself. Parachute in, grab the blinking power tiles, call airstrikes, dodge the
mines. Die, drop back in. Most kills in three minutes wins. Drop it onto any website and the page
itself becomes the arena: shells knock your headings around, treads flatten them, and Escape gives
the page back exactly as it was.

- **Play:** https://battlefieldblitz.domvirus.com/play/
- **About:** https://battlefieldblitz.domvirus.com/
- **Drop-in:** `<script src="https://battlefieldblitz.domvirus.com/blitz.js" defer></script>`

Until the domain is live, the site is at https://coded-dot-design.github.io/dom-battlefield-blitz/ ,
and the old Battlefield copy (`https://coded-dot-design.github.io/dom-battlefield/blitz/blitz.js`)
keeps working for existing embeds.

Blitz is part of the DOM Battlefield brand: its own site (`site/`, Astro, dev only) wears the
Battlefield styling and the Board UI kit. `npm run site:build` builds it into `artifacts/pages`;
`npm run test:site` checks it. The footer's site map comes from `site/src/sitemap.mjs`: add a new page there (or under `HIDDEN`) and the footer lists it; the build fails on a page that is in neither. Custom domain: set the repo variables `SITE_URL=https://battlefieldblitz.domvirus.com`
and `SITE_BASE=/`, then the custom domain in Settings → Pages; the Pages build writes `CNAME` from
`SITE_URL`. This repo is also the game code. It is built on [Fizlet](https://github.com/coded-dot-design/fizlet)
(the engine, snapshotted in `vendor/fizlet/` with provenance) and draws tanks with the art in
`src/sherman-sprites.ts`, taken from [Sherman Bytes](https://github.com/coded-dot-design/sherman-bytes) 0.5.2. No runtime dependencies.

## The game

**Three modes** (pick on the start screen; it remembers). **PRACTICE:** no clock, three TARGET
tanks that stand still and three MOVERs that drive about, none of them shoot back; a coach walks you
through every control (drive, fire, auto, lock, long shot, airstrike, tiles, kill streaks, a supply
crate, moving the keys), then shares tricks. Ammo and strikes never run out. **SOLO:** eight tanks, every tank for
itself. **PLATOON:** you and three wingmen in your colour against two other platoons of four
(three a side on a dropped-in page). No friendly fire. Your wingmen hold a slot behind you, go
after whoever is shooting at you, and parachute back in next to you; the other platoons stick
with their lead tank. The platoon with the most kills wins.

**TUNE** (in Practice, a key on the coach card): sliders for the pace, to dial the chaos in. GAME
SPEED (1.00×), TANK SPEED (150 px/s), TURRET TURN (1.00×), FIRE RATE (1.00×), SHELL SPEED (600 px/s,
same reach), RESPAWN (2.2 s), SOLO BOTS (7) and BOT AIRSTRIKES (1.0×); the defaults are the game's
numbers. Practice plays them live, SOLO and PLATOON at the next match, on this device only. RESET puts
them back; COPY SETTINGS copies them as JSON. Online matches always play the defaults.

**Two players** (`/play/multi/`, online rooms in lockstep): the TEAMS pick is FFA (both players + 4 bots,
the default), 1V1, or 2V2 to 4V4, where each player leads AI wingmen in their colour. P1's pick is the match's.
Want to play online? [Request a multiplayer pass](docs/play-pass.md) with your GitHub account.


**Two guns.** The cannon fires fast but overheats if you hold it (watch the ring on FIRE). The
LONG gun locks on (laser sight), then a guided round crosses the whole field, punches through
cover and wrecks in one hit. You start with 3 long shots; find and earn more.

**Airstrikes.** Press STRIKE, then tap (or click) where the bombs go: a bomber flies in over your
shoulder, the bombs fall and go off with the Battlefield hero's triple blasts and black scorch.

**Aim help.** AUTO swings the turret onto the nearest tank. LOCK sticks to one target (tap a tank
to switch). Your tank wears a marching dashed ring so you always find yourself, and every time you land
(the start and each respawn) rings ripple out from it under a YOU chevron.

| Tile | What it does |
|---|---|
| `»` Rapid | rapid fire for 8 seconds, no overheating |
| `≡` Triple | triple shot for 8 seconds |
| ✈ Airstrike | one airstrike (max 5) |
| `◆` Shield | shield for 6 seconds |
| ✚ Health | +2 armour |
| ◎ Long | +1 long shot |
| `!` Mine | blows up whoever drives onto it (and goes off by itself if left alone) |

Lit squares roll through colours like a slot machine before they settle. **Supply crates**
parachute in every 20 seconds or so (medkit, long ammo, an airstrike, or the jackpot). Every kill
patches 1 armour.

**Kill streaks** (kills in one life): 2 → +1 long shot, 3 → +1 airstrike, 5 → carpet bomb (your
next strike drops seven bombs), 8 → NUKE (siren, then every other tank on the field is wrecked).

**Controls.** Desktop: WASD / arrows drive, the mouse aims, click or Space fires, E (or
right-click) long shot, F airstrike then click the spot, Q auto-aim, T aim lock, Esc pauses
(board) or closes (drop-in). Phones: drag on the left half to drive, tap the field to shoot there,
and the round arcade keys bottom right: AUTO and LOCK ride on FIRE (like the Battlefield cockpit),
LONG and STRIKE sit in a row above, and the grab bar on top moves the whole pad (remembered;
double-click puts it back). Auto-aim starts on. The screen shakes only for blasts near your tank
and hits you take (harder the bigger the hit), and phones buzz when you're hit.
The board follows the page's light or dark theme (`<html data-theme>`) and has a full screen key
(top left) next to the white flag: pause asks BATTLE PAUSED / GIVE UP? with KEEP FIGHTING or
SURRENDER, the same overlay as DOM Battlefield. Every key is a Board UI kit key (Fizlet's `ui` brick), the same as DOM Battlefield's.

## Drop-in options

```html
<!-- A PLAY BLITZ key appears bottom right -->
<script src=".../blitz.js" defer></script>
<!-- Hidden: Konami code on desktop, hold-then-tap a [data-blitz-trigger] element on phones -->
<script src=".../blitz.js" data-easter-egg="true" defer></script>
<!-- Platoon battle on your page -->
<script src=".../blitz.js" data-platoons="true" defer></script>
<!-- Your brand colours (hex only) -->
<script src=".../blitz.js" data-palette='{"cmd":"#8573ee"}' defer></script>
```

Mark anything with `data-blitz-ignore` to keep it out of the arena.

## As a module

```js
import { createBlitz, install } from "./blitz.mjs";
const game = createBlitz(document.querySelector("#arena"), { mode: "board", seconds: 180 });
game.start();             // intro → countdown → match
// { platoons: true } starts in platoon mode; { demo: true } runs bots only with no HUD
```

## Two players (lockstep, demo)

Every peer runs the same match from the room's seed; only inputs travel, 12 bytes per player per
frame, through [`fizlet/presence`](https://github.com/coded-dot-design/fizlet) and a
room server that speaks the `fizlet-rooms` protocol (ours is in-house: a Cloudflare Worker +
Durable Object, gated by an invite code; to run your own, see
[Build your own room server](https://fizlet.com/guides/build-your-own-room-server/)).

```js
import { createBlitz, join } from "./blitz-net.mjs"; // blitz.mjs plus net play
const { transport, slot, players, seed } = await join("wss://rooms.example/room/0?players=2&invite=CODE");
createBlitz(document.querySelector("#arena"), { seed, net: { transport, slot, players } });
```

- The arena is a fixed 1100 × 640, scaled to fit each screen, so screens of any size play one match.
- Humans take seats 0..players-1; bots (4 by default) fill the rest. No pause, no rematch yet.
- Controls travel as one 32-bit word: drive (8 ways), fire, long shot, airstrike at the pointer,
  aim (pointer, auto, hull) and the pointer in 256ths of the arena. Aim lock acts as auto in net play.
- [`examples/two-player.html`](examples/two-player.html): the demo page (invite code, room, play).
- Net play ships as its own module, `dist/blitz-net.mjs` (budget 42 KB gzip), so the drop-in and
  `blitz.mjs` don't carry the lockstep code.

## Develop

```sh
npm ci
npm run check          # typecheck + build dist/ (committed)
npm run size           # budget: 40 KB gzip (today ~34 KB, engine, art and the Board UI kit included)
npm run test:browser   # board match + every key, demo, drop-in (Chromium)
npm run test:replay    # same seed, same match; no Math.random in play
npm run test:lockstep  # two net peers over the memory link stay identical (and under jitter)
ROOMS_URL=ws://127.0.0.1:8787 ROOMS_INVITE=<code> node tests/room.mjs   # through a running room server
node scripts/sync.mjs  # refresh vendor/fizlet from a sibling ../fizlet checkout
```

Release: bump `version`, rebuild, add a CHANGELOG entry, push `main`; CI checks `dist/` matches
and tags `vX.Y.Z`. The DOM Battlefield site then pins it with `node scripts/sync-blitz.mjs`.

## Licence

MIT © Chris Cooley / coded.design
