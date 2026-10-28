# Changelog

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
