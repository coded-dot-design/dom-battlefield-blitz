// Blitz site (GitHub Pages): landing page, the game at /play/ and the drop-in at /blitz.js.
// Run after `npm run site:build`. Serves artifacts/pages at /dom-battlefield-blitz/.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve("artifacts/pages");
const PREFIX = "/dom-battlefield-blitz";
if (!existsSync(join(root, "index.html"))) throw Error("Build the site first: npm run site:build");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json" };
// A plain page to drop Blitz onto (the drop-in must give it back exactly).
const HOST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Host</title></head><body><h1>A page</h1><p>Some <b>text</b> to knock around.</p><ul><li>one</li><li>two</li></ul></body></html>`;
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/host/") return res.writeHead(200, { "content-type": "text/html" }).end(HOST_PAGE);
  if (!path.startsWith(`${PREFIX}/`)) return res.writeHead(404).end();
  let file = join(root, path.slice(PREFIX.length));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = `${origin}${PREFIX}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let where = "start";
try {
  where = "landing";
  const lp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const lerr = [];
  lp.on("pageerror", (e) => lerr.push(e.message));
  lp.on("console", (m) => m.type() === "error" && lerr.push(m.text()));
  await lp.goto(base);
  assert.equal(await lp.locator("h1").count(), 1, "one h1");
  assert.match(await lp.locator("h1").textContent(), /Battlefield Blitz/);
  assert.match(await lp.locator(".bz-hero .eyebrow").textContent(), /BLITZ VERSION/);
  assert.match(await lp.locator('link[rel="canonical"]').getAttribute("href"), /^https:\/\/.+\/dom-battlefield-blitz\/$/);
  assert.match(await lp.locator('meta[property="og:image"]').getAttribute("content"), /^https:\/\/.+\/dom-battlefield-blitz\/shots\/og\.png$/);
  // Structured data: the site and the game, from facts on the page.
  const ld = JSON.parse(await lp.locator('script[type="application/ld+json"]').textContent());
  assert.deepEqual(ld["@graph"].map((g) => g["@type"]), ["WebSite", "VideoGame"]);
  assert.equal(ld["@graph"][1].url, await lp.locator('link[rel="canonical"]').getAttribute("href"));
  await lp.waitForFunction(() => window.blitzDemo?.world.tanks.filter((t) => t.alive).length >= 5, null, { timeout: 8000 });
  assert.equal(await lp.evaluate(() => window.blitzDemo.world.tanks.some((t) => t.you)), false, "the hero battle is all bots");
  assert.equal(new URL(await lp.locator(".start-key").getAttribute("href"), base).pathname, `${PREFIX}/play/`);
  assert.ok(await lp.locator('a[href="https://battlefield.domvirus.com/"]').count() > 0, "links to the original");
  assert.ok(await lp.locator('a[href="https://domvirus.com/"]').count() > 0, "links back to DOM VIRUS");
  assert.match(await lp.locator("#drop pre").first().textContent(), /\/blitz\.js/);
  await lp.setViewportSize({ width: 390, height: 844 });
  await lp.waitForTimeout(300);
  assert.ok(await lp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "the landing never scrolls sideways on a phone");
  assert.deepEqual(lerr, []);
  await lp.close();

  where = "board";
  const bp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const berr = [];
  bp.on("pageerror", (e) => berr.push(e.message));
  await bp.goto(base + "play/?seconds=6");
  assert.equal(await bp.locator("h1").count(), 1, "the play page has one h1");
  const pld = JSON.parse(await bp.locator('script[type="application/ld+json"]').textContent());
  assert.deepEqual(pld["@graph"].map((g) => g["@type"]), ["WebPage", "BreadcrumbList"]);
  assert.equal(await bp.evaluate(() => window.blitz.state), "intro");
  await bp.evaluate(() => window.blitz.start());
  await bp.waitForFunction(() => window.blitz.state === "play", null, { timeout: 5000 });
  await bp.waitForFunction(() => window.blitz.world.tanks.filter((t) => t.alive && t.drop >= 1).length >= 6, null, { timeout: 6000 });
  await bp.mouse.move(700, 400);
  await bp.mouse.down();
  await bp.keyboard.press("KeyQ");
  await bp.waitForTimeout(400);
  assert.ok(await bp.evaluate(() => window.blitz.world.shells.some((s) => s.on) || window.blitz.world.tanks[0].strikes === 0), "you can fire and call a strike");
  await bp.mouse.up();
  // A short match ends with the result sticker and the standings.
  await bp.waitForFunction(() => window.blitz.state === "end", null, { timeout: 12000 });
  const over = await bp.evaluate(() => document.querySelector("#blitz").shadowRoot.querySelector("[data-ov]").textContent);
  assert.match(over, /(STAGE CLEAR|INSERT COIN).*REMATCH/s);
  assert.deepEqual(berr, []);
  await bp.close();

  where = "phone";
  // Phones: the game page loads like the Battlefield app (no header/footer, no scroll, no zoom).
  const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  await pp.goto(base + "play/");
  const app = await pp.evaluate(() => {
    const r = document.querySelector(".blitz-stage").getBoundingClientRect();
    return {
      head: getComputedStyle(document.querySelector(".site-head")).display,
      foot: getComputedStyle(document.querySelector(".site-foot")).display,
      stage: [r.top, r.left, Math.round(r.width), Math.round(r.height)],
      scroll: document.documentElement.scrollHeight <= innerHeight + 1,
      zoom: /user-scalable=no/.test(document.querySelector("meta[name=viewport]").content),
    };
  });
  assert.deepEqual(app, { head: "none", foot: "none", stage: [0, 0, 844, 390], scroll: true, zoom: true });
  await phone.close();

  where = "drop-in";
  const dp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const derr = [];
  dp.on("pageerror", (e) => derr.push(e.message));
  await dp.goto(origin + "/host/");
  const snap = () => dp.evaluate(() => [...document.body.querySelectorAll("*")].filter((n) => !n.closest("[data-fizlet-host],[data-blitz-ignore]")).map((n) => n.tagName + [...n.attributes].map((a) => a.name + "=" + a.value).sort().join("|")).join("\n"));
  await dp.addScriptTag({ url: base + "blitz.js" });
  const before = await snap();
  const playKey = dp.locator("[data-blitz-ignore]").locator("button");
  assert.match(await playKey.textContent(), /PLAY BLITZ/i, "a PLAY BLITZ key waits on the page");
  await playKey.click();
  await dp.waitForSelector("[data-fizlet-host=blitz]", { state: "attached" });
  await dp.waitForTimeout(3500);
  assert.ok(await dp.evaluate(() => !!document.querySelector("[data-fizlet-host=blitz]").shadowRoot.querySelector("canvas")), "the page becomes the arena");
  await dp.keyboard.press("Escape");
  await dp.waitForTimeout(200);
  assert.equal(await dp.locator("[data-fizlet-host=blitz]").count(), 0, "Escape closes");
  assert.equal(await snap(), before, "the page is exactly as it was");
  assert.deepEqual(derr, []);
  await dp.close();
  console.log("Site: landing + live demo, board match, phone app mode, drop-in passed.");
} catch (e) {
  console.error(`site test failed at ${where}`);
  throw e;
} finally {
  await browser.close();
  server.close();
}
