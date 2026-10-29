# Voice — Battlefield Blitz

Brand level: game · by Chris Cooley (https://coded.design/)

Battlefield Blitz is the arcade version of DOM Battlefield: a board game in the DOM VIRUS family,
on the Battlefield site at `/blitz/`. **Everything in `../voice.md` applies** (the byline, the mix,
the avoid list, the limits). This file lists only what Blitz does differently.
<!-- src: games spec (number 03, DOM BLITZ, board, modern); dom-battlefield-blitz README line 3 -->

## Who we talk to

The same players, in a different mood. Battlefield is for people who want to plan; Blitz is for
people who want to drop in and blow things up right now. New players get PRACTICE, where a coach
walks them through every key. Curious web people get one line about the engine, no more.
<!-- src: dom-battlefield-blitz README lines 21-24 -->

## How we sound

Battlefield with the planning taken out: more arcade cabinet than radio net. Louder, faster,
grinning. Cabinet words instead of radio words: BLITZ!, PRESS START, DOUBLE KILL, RAMPAGE, NUKED,
INSERT COIN.

- Rules as two-word kickers (PARACHUTE IN, THE GRID BLINKS, KILL STREAKS, THREE MINUTES), then one
  or two sentences each.
- Coach steps: a one-word title, then one instruction naming the key and its shortcut.
- Say "free for all" and "most kills wins". Leave plan, radio, orders and freeze time to Battlefield.

Lines that ship, to tune by:

- "Free-for-all tank chaos."
- "Battlefield Blitz. *Every tank for itself.*"
- "Same tanks. *No mercy.*"
- "No planning, no radio: eight tanks parachute onto a blinking grid and blow each other up for
  three minutes. Most kills wins."
<!-- src: games spec site.tagline; dom-battlefield site/src/pages/blitz/index.astro lines 38-40, 54 -->

**Mix:** 80–90% gameplay (modes, guns, tiles, airstrikes, streaks). 10–20% engine and size.

**The maker's note** (one short paragraph at most, after the gameplay): Blitz is pure arcade.
Nobody sits out: you get blown up, you parachute back in. It is the one game here built on Fizlet,
Chris Cooley's tiny engine, and the note may say so in one line, as a fact about the game.

## Facts we say

- Every tank for itself. Parachute in, grab the blinking power tiles, call airstrikes, dodge the
  mines. Most kills in three minutes wins. <!-- src: games spec site.description -->
- Three modes: **PRACTICE** (no clock, a coach), **SOLO** (eight tanks, every tank for itself),
  **PLATOON** (you and three wingmen against two platoons of four, no friendly fire).
  <!-- src: dom-battlefield-blitz README lines 21-28 -->
- Two guns: a cannon that overheats and a LONG gun that locks on; you start with 3 long shots.
  <!-- src: README lines 31-33 -->
- Seven tiles: Rapid, Triple, Airstrike, Shield, Health, Long, Mine. <!-- src: README lines 41-49 -->
- Supply crates parachute in every 20 seconds or so. <!-- src: README line 51 -->
- Kill streaks: 2 → long shot, 3 → airstrike, 5 → carpet bomb, 8 → NUKE. <!-- src: README line 55 -->
- Built on Fizlet, tanks drawn with Sherman Bytes sprites, no runtime dependencies.
  <!-- src: README lines 14-17; games spec engine.runtime: fizlet -->
- The same Board UI keys as DOM Battlefield, in light and dark. <!-- src: README line 67 -->
- Size: **about 34 KB gzipped**, engine, art and the Board UI kit included. Measured: `dist/blitz.js`
  34,501 bytes gzip, v0.6.5, budget 40,960 enforced.
  <!-- src: dom-battlefield-blitz c8c8ca4, scripts/size.mjs; same build pinned in dom-battlefield vendor/blitz/ORIGIN.json -->
- Every other tank is a bot. Never call it online or multiplayer.

CTA labels: **PLAY BLITZ** · **Play Blitz ↗** · **About Blitz** · **The original: DOM Battlefield** ·
**Play the original ↗** · **Explore the original Sherman Bytes**. In-game keys keep their shipped
labels.

## Byline

Every Blitz page says **by Chris Cooley**, linked to <https://coded.design/>, in the header or
footer, the credits, and JSON-LD `author` / `creator` (Person "Chris Cooley", url
`https://coded.design/`). The repo licence line reads "MIT © Chris Cooley / coded.design".
<!-- src: dom-battlefield-blitz README line 108 -->

## Avoid

- revolutionary
- game-changing
- cutting-edge
- best-in-class
- world-class
- seamless
- next-gen
- AAA
- unleash
- blazing fast
- fastest
- instant
- zero load time
- full speed on anything
- days instead of months
- built in days
- battle royale
- last tank standing
- online
- multiplayer
- PvP
- invite a friend
- mini-game
- freeze time
- radio your squad
- authentic

## Limits

- max sentence words: 22
- max exclamations: 1
