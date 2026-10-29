# Style guide — Battlefield Blitz

Preset: cyberpunk-tron · flat colors only (no gradients, blur or glow) · inherits DOM Battlefield · hard shadows straight down · shared 3D key (Board UI)

Blitz lives on the Battlefield site and shares its styling. **Everything in `../style-guide.md`
applies**: rim, surfaces, light and dark, the 3D key family, the overlay ritual, the white flag,
mono type, hard bases straight down. Blitz wears the same Board UI kit, compiled in from Fizlet's
`ui` brick. Listed here: only what differs.
<!-- src: dom-battlefield-blitz README lines 14-15, 67 -->

```tokens
{
  "brand": "Battlefield Blitz",
  "inherits": "DOM Battlefield",
  "color": {
    "accent": "#ff2e88",
    "stage": "#090818",
    "stageLight": "#e4e6f7",
    "heroInk": "#f6f3ff",
    "heroLead": "#cfc7f0",
    "platoons": { "you": "#39ffb0", "viper": "#ff5c8f", "nova": "#19f0ff", "brick": "#ffc21a" },
    "youOnLight": "#0a8a55",
    "tiles": { "rapid": "#39ffb0", "triple": "#19f0ff", "airstrike": "#ff2e88", "shield": "#f6f3ff", "mine": "#ff2b4e", "health": "#a8ff3e", "long": "#ffc21a" },
    "fx": ["#fff4ff", "#ffc21a", "#ff8a1f", "#ff2e88", "#19f0ff", "#39ffb0", "#9a63ff", "#07060f"],
    "banner": { "face": "#10233f", "border": "#f6f3ff", "base": "#f6f3ff", "word": "#ffc21a", "kicker": "#19f0ff" },
    "coach": { "face": "#10233f", "text": "#f6f3ff", "faceLight": "#f6f3ff", "titleLight": "#b07400" }
  },
  "font": {
    "game": "600 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace",
    "startWord": "900 mono, letter-spacing 3px",
    "countdown": "900 96px/1 mono"
  },
  "key": {
    "shape": "round arcade",
    "radius": "50%",
    "baseDepth": "5px",
    "size": { "fire": "96px", "round": "62px", "autoLock": "52px" },
    "shadow": { "round": "0 5px 0 #07060f", "banner": "0 6px 0 #f6f3ff", "stickerWord": "0 4px 0 #07060f" },
    "tilt": { "sticker": "-4deg", "banner": "-2deg" },
    "phoneScale": 0.82
  },
  "byline": { "text": "by Chris Cooley", "url": "https://coded.design/" }
}
```
<!-- src: dom-battlefield-blitz src/game.ts lines 46, 50, 53, 58, 118, 145, 168 (v0.6.5); dom-battlefield site/src/pages/blitz/index.astro lines 227, 253; site/src/pages/blitz/play/index.astro lines 29, 49 -->

## Rules

- **Pink is the accent, not a new role.** It is the kit's attack colour `#ff2e88`: the headline's
  second beat, the BLITZ label, the STRIKE key, the tip strip. Battlefield leans cyan.
- **Kit keys only.** Round arcade (FIRE, AUTO, LOCK, LONG, STRIKE), sticker, segmented mode
  picker, grip, white flag. No new key families.
- **No planning or radio UI.** No cards, orbits, pager or comms toast: Blitz has no planning stage.
- **Tiles keep one colour each.** The landing legend and the game's tile colours are the same set.
- **Arcade HUD, not a cockpit:** a floating KILLS · TIME · ARMOR · STREAK pill, a kill feed, a
  slanted streak banner, a blinking tip strip, all on kit tokens so they flip with the theme.
- **Hard bases, straight down**, as on Battlefield. More tilt is allowed: the banner leans −2°.
- **Reduced motion:** stickers, countdown and tip strip stop; the launch burst becomes a press.
- **The byline** "by Chris Cooley" → <https://coded.design/> on every Blitz page.

## Current styles (documented, Phase 2 lock)

- **Stage:** the heroes and the play stage sit on map navy `#090818`; the canvas map turns
  `#e4e6f7` on light (`src/game.ts` line 1466; `blitz/play/index.astro` line 29).
- **Accent:** `h2 em` and section numbers in `--k-attack` (`blitz/index.astro` lines 227, 253);
  BLITZ label in the play bar (`blitz/play/index.astro` line 49).
- **Colours in game:** platoons (line 46), solo tanks (line 50), tiles (line 53), effects
  (line 58) in `src/game.ts`.
- **Start sticker:** word in 900 mono with a hard 4px rim shadow; the `!` in pink
  (`src/game.ts` lines 145–146).
- **Streak banner:** navy face, white border and base, amber word, cyan kicker (`src/game.ts`
  line 118).
- **Hero:** the real game in demo mode with bots, behind the copy (`blitz/index.astro` lines
  140–153).
- **Phone app mode:** `/blitz/play/` hides header and footer on coarse pointers and pins the stage
  full screen (`blitz/play/index.astro` lines 54–75); the round pad scales to 0.82 under 620px
  (`src/game.ts` line 171).

## Exceptions (Phase 2 lock)

Shipped and kept as they are; new pages use the flat tokens above.

- **Inherited:** every exception in `../style-guide.md` (arcade key glow on dark, header frost,
  START BATTLE halo) applies to Blitz pages too.
- **Countdown halo:** the 3-2-1 digits carry a 30px cyan text halo.
  <!-- src: dom-battlefield-blitz src/game.ts line 168 -->
- **Hero scrim:** a navy fade left to right behind the hero copy, top to bottom on narrow screens.
  <!-- src: dom-battlefield site/src/pages/blitz/index.astro lines 152, 382 -->
- **Kill feed outline:** a 1px soft rim edge on feed names. <!-- src: src/game.ts line 116 -->
- **Screen shake and phone vibration** have no reduced-motion check today.
  <!-- src: dom-battlefield-blitz src/game.ts (no prefers-reduced-motion guard on shake or navigator.vibrate) -->
