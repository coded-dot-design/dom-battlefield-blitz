# Changelog

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
