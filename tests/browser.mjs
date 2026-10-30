// Blitz in Chromium: a board match from intro to result, attract (demo) mode, and the drop-in on a
// real page (PLAY key, arena, Escape, the page exactly as it was).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const ORIGIN = "https://blitz.test";
const PAGE = `<!doctype html><meta charset="utf-8"><title>host</title>
<style>body{margin:0;font:16px system-ui;background:#fff}main{padding:40px}h1{font-size:64px}</style>
<main><h1 id="t" class="hero">A perfectly normal page</h1><p>Some copy to knock around.</p><button>Buy now</button>
<ul><li>One</li><li>Two</li></ul><div id="board" style="position:relative;width:1100px;height:640px"></div></main>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let where = "start";
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: PAGE });
    return route.fulfill({ contentType: "text/javascript", body: readFileSync(`dist${path}`) });
  });
  await page.goto(`${ORIGIN}/`);

  where = "board";
  await page.evaluate(async () => {
    const { createBlitz } = await import("/blitz.mjs");
    window.game = createBlitz(document.getElementById("board"), { mode: "board", seconds: 16 });
  });
  assert.equal(await page.evaluate(() => game.state), "intro");
  await page.evaluate(() => game.start());
  await page.waitForFunction(() => game.state === "play", null, { timeout: 5000 });
  await page.waitForFunction(() => game.world.tanks.filter((t) => t.alive && t.drop >= 1).length >= 6, null, { timeout: 6000 });
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.waitForTimeout(500);
  const dbg = await page.evaluate(() => { const b = document.getElementById("board").getBoundingClientRect(); const t = game.world.tanks[0]; return { b: [b.top, b.bottom], you: [t.alive, t.drop, t.cool, Math.round(t.x), Math.round(t.y)], run: game.engine.running, paused: game.engine.paused, shells: game.world.shells.filter((s) => s.on).length }; });
  assert.ok(dbg.shells > 0, "shots fly " + JSON.stringify(dbg));
  await page.mouse.up();

  where = "board: pad";
  await page.evaluate(() => document.getElementById("board").scrollIntoView({ block: "end" }));
  const sr = (sel) => page.evaluate((sel) => { const r = document.getElementById("board").shadowRoot.querySelector(sel).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  const ready = () => page.waitForFunction(() => game.world.tanks[0].alive && game.world.tanks[0].drop >= 1 && game.world.tanks.filter((t) => t.alive && t.drop >= 1).length >= 4, null, { timeout: 8000 });
  // The scoreboard drags from any part of it, stays on the board, is remembered, and a double-click puts it back.
  {
    const box = () => page.evaluate(() => { const r = document.getElementById("board").shadowRoot.querySelector(".hud").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    const [hx, hy, hw, hh] = await box();
    await page.mouse.move(hx + hw / 2, hy + hh / 2);
    await page.mouse.down();
    await page.mouse.move(hx + hw / 2 + 120, hy + hh / 2 + 90, { steps: 6 });
    await page.mouse.up();
    const [mx, my] = await box();
    assert.ok(Math.abs(mx - hx - 120) < 2 && Math.abs(my - hy - 90) < 2, `scoreboard moved by the drag (${mx - hx}, ${my - hy})`);
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("blitz:hud"))).map(Math.round), [120, 90], "remembered");
    await page.mouse.move(mx + 10, my + 400, { steps: 4 }); // a plain move doesn't drag it
    assert.deepEqual((await box()).slice(0, 2).map(Math.round), [mx, my].map(Math.round));
    await page.mouse.dblclick(mx + hw / 2, my + hh / 2);
    const [bx, by] = await box();
    assert.ok(Math.abs(bx - hx) < 2 && Math.abs(by - hy) < 2, "double-click puts it back");
  }
  // AUTO and LOCK toggle (keys and round buttons).
  let [x, y] = await sr("[data-k=auto]");
  const auto0 = await page.evaluate(() => game.controls.auto);
  await page.mouse.click(x, y);
  await page.waitForFunction((a) => game.controls.auto !== a, auto0);
  await page.keyboard.press("KeyT");
  await page.waitForFunction(() => game.controls.lock && game.controls.lockTarget >= 0);
  assert.equal(await page.evaluate(() => document.getElementById("board").shadowRoot.querySelector("[data-k=lock]").getAttribute("aria-pressed")), "true");
  // LONG: locks on, fires, spends one round.
  // The long gun needs a tank to lock on to: on a slow runner the field may be empty for a moment,
  // so press again until one round is spent (state, not a fixed wait).
  const rail0 = await page.evaluate(() => game.world.tanks[0].rail);
  for (let i = 0; ; i++) {
    await ready();
    [x, y] = await sr("[data-k=long]");
    await page.mouse.click(x, y);
    const spent = await page.waitForFunction((r) => game.world.tanks[0].rail < r, rail0, { timeout: 2000 }).then(() => true, () => false);
    if (spent) break;
    if (i === 5) throw new Error(`LONG never fired (rail ${await page.evaluate(() => game.world.tanks[0].rail)})`);
  }
  // STRIKE: target mode, click the field, a bomber flies over and the bombs land.
  await ready();
  await page.evaluate(() => (game.world.tanks[0].strikes = 1));
  [x, y] = await sr("[data-k=strike]");
  await page.mouse.click(x, y);
  await page.waitForFunction(() => game.controls.targeting);
  const fieldAt = await page.evaluate(() => { const r = document.getElementById("board").getBoundingClientRect(); return [r.x + 400, r.y + 260]; });
  await page.mouse.click(fieldAt[0], fieldAt[1]);
  await page.waitForFunction(() => game.world.planes.some((p) => p.on) && game.world.bombs.some((b) => b.on), null, { timeout: 2000 });
  await page.waitForFunction(() => !game.world.bombs.some((b) => b.on), null, { timeout: 4000 });
  assert.equal(await page.evaluate(() => game.controls.targeting), false);
  // Pause = the surrender question (the Battlefield overlay): KEEP FIGHTING resumes.
  [x, y] = await sr("[data-pause]");
  await page.mouse.click(x, y);
  await page.waitForFunction(() => game.state === "paused");
  assert.match(await page.evaluate(() => document.getElementById("board").shadowRoot.querySelector("[data-ov]").textContent), /BATTLE PAUSED.*GIVE UP\?.*KEEP FIGHTING.*SURRENDER/s);
  await page.mouse.click(...(await sr("[data-resume]")));
  await page.waitForFunction(() => game.state === "play");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => game.state === "paused");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => game.state === "play");
  // Full screen key (board).
  [x, y] = await sr("[data-fs]");
  await page.mouse.click(x, y);
  await page.waitForFunction(() => document.getElementById("board").shadowRoot.querySelector("[data-fs]").getAttribute("aria-pressed") === "true");
  await page.mouse.click(...(await sr("[data-fs]")));
  await page.waitForFunction(() => document.getElementById("board").shadowRoot.querySelector("[data-fs]").getAttribute("aria-pressed") === "false");
  await page.evaluate(() => document.getElementById("board").scrollIntoView({ block: "end" }));
  // Supply crate drops, and the board follows the page theme.
  await page.evaluate(() => game.controls.crate());
  assert.ok(await page.evaluate(() => game.world.crates.some((c) => c.on)), "a supply crate drops");
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.waitForFunction(() => document.getElementById("board").shadowRoot.querySelector(".bz").classList.contains("light"));
  await page.evaluate(() => delete document.documentElement.dataset.theme);
  await page.waitForFunction(() => game.state === "end", null, { timeout: 20000 });
  const over = await page.evaluate(() => document.getElementById("board").shadowRoot.querySelector("[data-ov]").textContent);
  assert.match(over, /(STAGE CLEAR|INSERT COIN).*REMATCH.*NEW GAME/s);
  await page.evaluate(() => game.destroy());
  assert.equal(await page.evaluate(() => document.getElementById("board").shadowRoot.childElementCount), 0, "destroy removes the game");

  where = "demo";
  await page.evaluate(async () => {
    const { createBlitz } = await import("/blitz.mjs");
    window.demo = createBlitz(document.getElementById("board"), { mode: "board", demo: true });
  });
  await page.waitForTimeout(4000);
  const d = await page.evaluate(() => ({
    state: demo.state,
    hud: getComputedStyle(document.getElementById("board").shadowRoot.querySelector(".hud")).display,
    fighting: demo.world.tanks.filter((t) => t.alive).length,
    you: demo.world.tanks.some((t) => t.you),
  }));
  assert.deepEqual(d, { state: "play", hud: "none", fighting: d.fighting, you: false });
  assert.ok(d.fighting >= 5, "bots fight on their own");
  await page.evaluate(() => demo.destroy());

  where = "platoons";
  await page.evaluate(async () => {
    const { createBlitz } = await import("/blitz.mjs");
    window.pl = createBlitz(document.getElementById("board"), { mode: "board", seconds: 6, platoons: true, seed: 7 });
  });
  assert.deepEqual(await page.evaluate(() => [pl.platoons, pl.world.tanks.length, pl.world.tanks.map((t) => t.team).join("")]), [true, 12, "000011112222"]);
  // The start screen switches modes (and back).
  const pick = async (m) => { const [x, y] = await page.evaluate((m) => { const r = document.getElementById("board").shadowRoot.querySelector(`[data-mode=${m}]`).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, m); await page.mouse.click(x, y); };
  await pick("solo");
  assert.equal(await page.evaluate(() => pl.platoons), false);
  await pick("platoon");
  assert.equal(await page.evaluate(() => pl.world.tanks.length), 12);
  // No friendly fire: a shell from a wingman passes through you. Seeded, and stepped by hand (no wall
  // clock), so the board is the same on every run.
  const shot = await page.evaluate(() => {
    pl.start();
    pl.engine.stop();
    for (let f = 0; f < 60 * 15 && pl.world.tanks.filter((t) => t.alive && t.drop >= 1).length < 9; f++) pl.engine.advance(1 / 60);
    const [you, wing] = pl.world.tanks, s = pl.world.shells.find((q) => !q.on);
    Object.assign(s, { on: true, rail: false, tgt: -1, owner: wing.i, x: you.x - 30, y: you.y, vx: 600, vy: 0, life: 1 });
    for (let f = 0; f < 4; f++) pl.engine.advance(1 / 60); // 40 px: from 30 px behind you to 10 px past
    const r = { landed: pl.world.tanks.filter((t) => t.alive && t.drop >= 1).length, on: s.on, owner: s.owner, past: s.x > you.x, alive: you.alive };
    pl.engine.start();
    return r;
  });
  assert.ok(shot.landed >= 9, "the platoons are on the board " + JSON.stringify(shot));
  assert.deepEqual([shot.on, shot.owner, shot.past, shot.alive], [true, 1, true, true], "a wingman's shell passes through you " + JSON.stringify(shot));
  // SURRENDER: the white flag whites out, waves, bursts, and the match ends as GAME OVER.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => pl.state === "paused");
  await page.evaluate(() => document.getElementById("board").shadowRoot.querySelector("[data-surrender]").click());
  await page.waitForFunction(() => pl.state === "end", null, { timeout: 5000 });
  assert.match(await page.evaluate(() => document.getElementById("board").shadowRoot.querySelector("[data-ov]").textContent), /WHITE FLAG.*GAME OVER/s);
  assert.match(await page.evaluate(() => document.getElementById("board").shadowRoot.querySelector("[data-ov]").textContent), /PLATOON/);
  await page.evaluate(() => (pl.destroy(), localStorage.removeItem("blitz:mode")));

  where = "practice";
  await page.evaluate(async () => {
    const { createBlitz } = await import("/blitz.mjs");
    window.pr = createBlitz(document.getElementById("board"), { mode: "board" });
  });
  await pick("practice");
  assert.deepEqual(await page.evaluate(() => [pr.practice, pr.world.tanks.map((t) => t.name).join(",")]), [true, "YOU,TARGET1,TARGET2,TARGET3,MOVER1,MOVER2,MOVER3"]);
  await page.evaluate(() => pr.start());
  await page.waitForFunction(() => pr.state === "play" && pr.world.tanks.every((t) => t.alive && t.drop >= 1), null, { timeout: 15000 });
  const still = await page.evaluate(() => pr.world.tanks.slice(1, 4).map((t) => [t.x, t.y]));
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("board").shadowRoot.querySelector("[data-coach]")).display), "grid", "the coach shows");
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(2200);
  await page.keyboard.up("KeyD");
  await page.waitForFunction(() => pr.coach >= 1, null, { timeout: 10000 });
  const moved = await page.evaluate((still) => pr.world.tanks.slice(1, 4).filter((t, i) => Math.hypot(t.x - still[i][0], t.y - still[i][1]) > 1).length, still);
  assert.ok(moved <= 1, `TARGETs stand still (${moved} moved; a mine may respawn one)`);
  assert.equal(await page.evaluate(() => pr.world.shells.filter((s) => s.on && s.owner !== 0).length), 0, "dummies never shoot");
  // The grab bar moves the keys, and it's remembered.
  const [gx, gy] = await page.evaluate(() => { const r = document.getElementById("board").shadowRoot.querySelector("[data-grab]").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx - 200, gy - 80, { steps: 5 });
  await page.mouse.up();
  assert.match(await page.evaluate(() => document.getElementById("board").shadowRoot.querySelector("[data-pad]").style.translate), /-200px -80px/);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("blitz:pad"))), [-200, -80]);
  // Find yourself: your landing started the locate pulse (drawn on the render clock).
  assert.ok(await page.evaluate(() => pr.controls.locate > 0), "the locate pulse ran when you landed");

  where = "practice: tune";
  const shadow = (sel) => `document.getElementById("board").shadowRoot.querySelector(${JSON.stringify(sel)})`;
  const DEFAULTS = { speed: 1, tank: 150, turn: 1, fire: 1, shell: 600, respawn: 2.2, bots: 7, air: 1 };
  assert.deepEqual(await page.evaluate(() => pr.tune.values), DEFAULTS, "the levers start at the game's numbers");
  await page.evaluate(`${shadow("[data-tune]")}.click()`);
  assert.equal(await page.evaluate(`${shadow("[data-tune-panel]")}.hidden`), false, "TUNE opens the card");
  assert.equal(await page.evaluate(`getComputedStyle(${shadow("[data-coach]")}).display`), "none", "the coach steps aside");
  // Keys on a slider: GAME SPEED one notch down (0.05), TANK SPEED two notches up (+10 px/s); the arrows don't drive.
  const x0 = await page.evaluate(() => pr.world.tanks[0].x);
  await page.evaluate(`${shadow("input[name=speed]")}.focus()`);
  await page.keyboard.press("ArrowLeft");
  await page.evaluate(`${shadow("input[name=tank]")}.focus()`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => pr.tune.values.tank === 160);
  assert.equal(await page.evaluate(() => pr.tune.values.speed), 0.95, "GAME SPEED moved");
  assert.ok(Math.abs((await page.evaluate(() => pr.world.tanks[0].x)) - x0) < 1, "a slider's arrows don't drive the tank");
  assert.equal(await page.evaluate(`${shadow("input[name=tank]")}.parentElement.querySelector("output").textContent`), "160 px/s", "the value shows");
  // Drag-equivalent: set a value through the slider (an input event), and through the API.
  await page.evaluate(`(() => { const i = ${shadow("input[name=shell]")}; i.value = "450"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await page.evaluate(() => pr.tune.set("bots", 3));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("blitz:tune")));
  assert.deepEqual(saved, { ...DEFAULTS, speed: 0.95, tank: 160, shell: 450, bots: 3 }, "saved on this device");
  assert.equal(await page.evaluate(`${shadow("[data-tune-json]")}.textContent`), JSON.stringify(saved), "the copy line is the settings");
  // COPY SETTINGS: the clipboard gets the JSON (granted in the test), the key says so.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  await page.evaluate(`${shadow("[data-tune-copy]")}.click()`);
  await page.waitForFunction(`${shadow("[data-tune-copy]")}.textContent === "COPIED"`);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), JSON.stringify(saved), "COPY SETTINGS puts the JSON on the clipboard");
  // Persist: a new game on this device reads them; the start screen says it's tuned.
  await page.evaluate(`${shadow("[data-cx]")}.click()`);
  assert.equal(await page.evaluate(() => pr.state), "intro", "END PRACTICE goes back to the start");
  await page.evaluate(async () => {
    pr.destroy();
    const { createBlitz } = await import("/blitz.mjs");
    window.pr = createBlitz(document.getElementById("board"), { mode: "board" });
  });
  assert.deepEqual(await page.evaluate(() => pr.tune.values), saved, "the levers persist");
  assert.match(await page.evaluate(`${shadow(".tuned")}.textContent`), /TUNED · 4 LEVERS CHANGED/);
  await pick("solo");
  assert.equal(await page.evaluate(() => pr.world.tanks.length), 4, "SOLO BOTS: you + 3 bots");
  // The levers reach the match: a shell at the tuned speed with the old reach, the respawn delay.
  await page.evaluate(() => {
    pr.start();
    pr.engine.stop();
    for (let f = 0; f < 60 * 8 && !(pr.state === "play" && pr.world.tanks[0].alive && pr.world.tanks[0].drop >= 1); f++) pr.engine.advance(1 / 60);
  });
  await page.keyboard.down("Space");
  const fired = await page.evaluate(() => {
    const t = pr.world.tanks[0];
    t.cool = t.hot = t.charge = 0;
    pr.world.shells.forEach((q) => (q.on = false));
    pr.engine.advance(1 / 60);
    const s = pr.world.shells.find((q) => q.on && q.owner === 0 && !q.rail);
    pr.engine.start();
    return s ? [Math.round(Math.hypot(s.vx, s.vy)), Math.round(s.life * 100) / 100] : [pr.state, t.alive, t.drop, t.cool];
  });
  await page.keyboard.up("Space");
  assert.ok(fired && fired[0] === 450 && fired[1] > 1.3 && fired[1] <= 600 / 450, "a tuned shell: 450 px/s, the same reach " + JSON.stringify(fired));
  // RESET restores every default (and clears the saved settings).
  await page.evaluate(`pr.tune.open(), ${shadow("[data-tune-reset]")}.click()`); // the card's RESET key (one task: render would close it outside practice)
  assert.deepEqual(await page.evaluate(() => pr.tune.values), DEFAULTS, "RESET restores the defaults");
  assert.equal(await page.evaluate(() => localStorage.getItem("blitz:tune")), null, "and forgets the saved ones");
  await page.evaluate(() => (pr.destroy(), localStorage.clear()));

  where = "drop-in";
  const snap = () => page.evaluate(() => [...document.body.querySelectorAll("*")].filter((n) => !n.closest("[data-fizlet-host],[data-blitz-ignore]")).map((n) => n.tagName + [...n.attributes].map((a) => a.name + "=" + a.value).sort().join("|") + "#" + [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.nodeValue).join("")).join("\n"));
  const before = await snap();
  await page.addScriptTag({ url: `${ORIGIN}/blitz.js` });
  const key = page.locator("[data-blitz-ignore]").locator("button");
  assert.match(await key.textContent(), /PLAY BLITZ/i);
  await key.click();
  await page.waitForSelector("[data-fizlet-host=blitz]", { state: "attached" });
  await page.mouse.move(400, 120);
  await page.waitForTimeout(3500);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("[data-fizlet-host=blitz]").count(), 0, "Escape closes");
  assert.equal(await snap(), before, "the page is exactly as it was");

  assert.deepEqual(errors, []);
  console.log("Blitz: board match (intro → play → pad: auto, lock, long shot, airstrike, crate, theme, pause/resume, full screen → result), platoons (picker, teams, surrender), practice (coach, still targets, harmless dummies, grab bar, locate pulse; TUNE: sliders, keys, saved, copy, persist, SOLO BOTS, shell speed and reach, RESET), demo mode, drop-in (PLAY key, arena, Escape, page restored) passed.");
} catch (e) {
  console.error(`::error title=Blitz browser test (${where})::${e.message}`);
  throw e;
} finally {
  await browser.close();
}
