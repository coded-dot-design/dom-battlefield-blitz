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
    window.game = createBlitz(document.getElementById("board"), { mode: "board", seconds: 5 });
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
  await page.waitForFunction(() => game.state === "end", null, { timeout: 12000 });
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
  console.log("Blitz: board match (intro → play → result), demo mode, drop-in (PLAY key, arena, Escape, page restored) passed.");
} catch (e) {
  console.error(`::error title=Blitz browser test (${where})::${e.message}`);
  throw e;
} finally {
  await browser.close();
}
