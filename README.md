# Battlefield Blitz

**Free-for-all tank chaos. The arcade version of [DOM Battlefield](https://coded-dot-design.github.io/dom-battlefield/).**

Every tank for itself. Parachute in, grab the blinking power tiles, call airstrikes, dodge the
mines. Die, drop back in. Most kills in three minutes wins. Drop it onto any website and the page
itself becomes the arena: shells knock your headings around, treads flatten them, and Escape gives
the page back exactly as it was.

- **Play:** https://coded-dot-design.github.io/dom-battlefield/blitz/play/
- **About:** https://coded-dot-design.github.io/dom-battlefield/blitz/
- **Drop-in:** `<script src="https://coded-dot-design.github.io/dom-battlefield/blitz/blitz.js" defer></script>`

Blitz is part of the DOM Battlefield brand: its pages live on the Battlefield site and share its
styling. This repo is the game code. It is built on [Fizlet](https://github.com/coded-dot-design/fizlet)
(the engine) and draws tanks with [Sherman Bytes](https://github.com/coded-dot-design/sherman-bytes)
sprites. No runtime dependencies; everything first-party is snapshotted with provenance.

## The game

| Tile | What it does |
|---|---|
| `»` Rapid | rapid fire for 8 seconds |
| `≡` Triple | triple shot for 8 seconds |
| `✚` Airstrike | one airstrike charge (max 3) |
| `◆` Shield | shield for 6 seconds |
| `!` Mine | blows up whoever drives onto it (and goes off by itself if left alone) |

Lit squares roll through colours like a slot machine for a second before they settle, so you can
read what's coming. Everyone respawns by parachute (invulnerable while dropping). Double kills and
rampages pop on screen.

**Controls.** Desktop: WASD / arrows drive, the mouse aims, click or Space fires, Q (or right-click)
calls an airstrike on the pointer, Esc pauses (board) or closes (drop-in). Phones: drag on the left
half to drive; the turret aims at the nearest enemy and fires by itself; the ✚ key calls a strike.

## Drop-in options

```html
<!-- A PLAY BLITZ key appears bottom right -->
<script src=".../blitz.js" defer></script>
<!-- Hidden: Konami code on desktop, hold-then-tap a [data-blitz-trigger] element on phones -->
<script src=".../blitz.js" data-easter-egg="true" defer></script>
<!-- Your brand colours (hex only) -->
<script src=".../blitz.js" data-palette='{"cmd":"#8573ee"}' defer></script>
```

Mark anything with `data-blitz-ignore` to keep it out of the arena.

## As a module

```js
import { createBlitz, install } from "./blitz.mjs";
const game = createBlitz(document.querySelector("#arena"), { mode: "board", seconds: 180 });
game.start();             // intro → countdown → match
// { demo: true } runs bots only with no HUD (a landing-page hero)
```

## Develop

```sh
npm ci
npm run check          # typecheck + build dist/ (committed)
npm run size           # budget: 32 KB gzip (today ~17 KB, engine and art included)
npm run test:browser   # board match, demo, drop-in (Chromium)
node scripts/sync.mjs  # refresh vendor/fizlet and shared/ from sibling checkouts
```

Release: bump `version`, rebuild, add a CHANGELOG entry, push `main`; CI checks `dist/` matches
and tags `vX.Y.Z`. The DOM Battlefield site then pins it with `node scripts/sync-blitz.mjs`.

## Licence

MIT © Chris Cooley / coded.design
