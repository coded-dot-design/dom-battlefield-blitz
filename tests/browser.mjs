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
  // AUTO and LOCK toggle (keys and round buttons).
  let [x, y] = await sr("[data-k=auto]");
  const auto0 = await page.evaluate(() => game.controls.auto);
  await page.mouse.click(x, y);
  await page.waitForFunction((a) => game.controls.auto !== a, auto0);
  await page.keyboard.press("KeyT");
  await page.waitForFunction(() => game.controls.lock && game.controls.lockTarget >= 0);
  assert.equal(await page.evaluate(() => document.getElementById("board").shadowRoot.querySelector("[data-k=lock]").getAttribute("aria-pressed")), "true");
  // LONG: locks on, fires, spends one round.
  await ready();
  [x, y] = await sr("[data-k=long]");
  await page.mouse.click(x, y);
  await page.waitForFunction(() => game.world.tanks[0].rail === 2, null, { timeout: 3000 });
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
  // Supply crate drops, and the board follows the page theme.
  await page.evaluate(() => game.controls.crate());
  assert.ok(await page.evaluate(() => game.world.crates.some((c) => c.on)), "a supply crate drops");
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.waitForFunction(() => document.getElementById("board").shadowRoot.querySelector(".bz").classList.contains("light"));
  await page.evaluate(() => delete document.documentElement.dataset.theme);
  await page.waitForFunction(() => game.state === "end", null, { timeout: 20000 });
  const over = await page.evaluate(() => document.getElementById("board").shadowRoot.querySelector("[data-over]").textContent);
  assert.match(over, /MATCH OVER/);
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
    window.pl = createBlitz(document.getElementById("board"), { mode: "board", seconds: 6, platoons: true });
  });
  assert.deepEqual(await page.evaluate(() => [pl.platoons, pl.world.tanks.length, pl.world.tanks.map((t) => t.team).join("")]), [true, 12, "000011112222"]);
  // The start screen switches modes (and back).
  const pick = async (m) => { const [x, y] = await page.evaluate((m) => { const r = document.getElementById("board").shadowRoot.querySelector(`[data-mode=${m}]`).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, m); await page.mouse.click(x, y); };
  await pick("solo");
  assert.equal(await page.evaluate(() => pl.platoons), false);
  await pick("platoon");
  assert.equal(await page.evaluate(() => pl.world.tanks.length), 12);
  await page.evaluate(() => pl.start());
  await page.waitForFunction(() => pl.world.tanks.filter((t) => t.alive && t.drop >= 1).length >= 9, null, { timeout: 15000 });
  // No friendly fire: a shell from a wingman passes through you.
  const shot = await page.evaluate(() => { const [you, wing] = pl.world.tanks; const s = pl.world.shells.find((q) => !q.on); Object.assign(s, { on: true, rail: false, tgt: -1, owner: wing.i, x: you.x - 30, y: you.y, vx: 600, vy: 0, life: 1 }); return [pl.world.shells.indexOf(s), you.x]; });
  await page.waitForTimeout(120);
  assert.ok(await page.evaluate(([i, x]) => { const s = pl.world.shells[i]; return s.on && s.owner === 1 && s.x > x; }, shot), "a wingman's shell passes through you");
  await page.waitForFunction(() => pl.state === "end", null, { timeout: 15000 });
  assert.match(await page.evaluate(() => document.getElementById("board").shadowRoot.querySelector("[data-over]").textContent), /PLATOON/);
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
  await page.waitForFunction(() => pr.coach >= 1, null, { timeout: 3000 });
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
  await page.evaluate(() => document.getElementById("board").shadowRoot.querySelector("[data-cx]").click());
  assert.equal(await page.evaluate(() => pr.state), "intro", "END PRACTICE goes back to the start");
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
  console.log("Blitz: board match (intro → play → pad: auto, lock, long shot, airstrike, crate, theme → result), platoons (picker, teams, result), practice (coach, still targets, harmless dummies, grab bar), demo mode, drop-in (PLAY key, arena, Escape, page restored) passed.");
} catch (e) {
  console.error(`::error title=Blitz browser test (${where})::${e.message}`);
  throw e;
} finally {
  await browser.close();
}
