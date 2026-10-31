// Game mode on a phone, and the pause key everywhere (the built site, /play/ and /play/two/).
// Phone = a coarse pointer on a small screen (site.css "Game mode"), at 390×844 and 844×390: no
// header, footer or bar on screen (still in the HTML: one h1, the footer and its byline), the board
// fills the viewport, the page never scrolls or shifts, a 44 px exit key goes home. The pause key is
// ≥ 44 px, on top and clear of every other control; a tap, Escape and P pause; RESUME counts down; a
// hidden tab pauses. 1440×900 (desktop) keeps its layout: header, board, bar, footer.
// Run after `npm run site:build`.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve("artifacts/pages"), PREFIX = "/dom-battlefield-blitz";
if (!existsSync(join(root, "index.html"))) throw Error("Build the site first: npm run site:build");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.startsWith(`${PREFIX}/`) ? join(root, path.slice(PREFIX.length)) : "";
  if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!file || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}${PREFIX}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let where = "start";
const SIZES = [["390×844", 390, 844, true], ["844×390", 844, 390, true], ["1440×900", 1440, 900, false]];
// Layout shift from the first paint on (a flash of header would show up here).
const CLS = () => {
  window.__cls = 0;
  new PerformanceObserver((l) => l.getEntries().forEach((e) => e.hadRecentInput || (window.__cls += e.value))).observe({ type: "layout-shift", buffered: true });
};
const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
try {
  for (const [name, w, h, phone] of SIZES) {
    where = `${name} /play/`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: phone, hasTouch: phone });
    await ctx.addInitScript(CLS);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "play/?seconds=90");
    const layout = () => page.evaluate(() => {
      const box = (s) => { const el = document.querySelector(s), r = el.getBoundingClientRect(); return { display: getComputedStyle(el).display, r: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; };
      scrollBy({ top: 400, behavior: "instant" });
      return {
        head: box(".site-head").display, foot: box(".site-foot").display, bar: box(".blitz-bar").display, exit: box(".game-exit"), stage: box(".blitz-stage").r,
        scrolled: scrollY, tall: document.documentElement.scrollHeight > innerHeight + 1,
        h1: document.querySelectorAll("h1").length, byline: /by Chris Cooley/i.test(document.querySelector(".site-foot").textContent),
      };
    });
    const l = await layout();
    assert.equal(l.h1, 1, "one h1 in the DOM");
    assert.ok(l.byline, "the footer (and its byline) stays in the HTML");
    if (phone) {
      assert.deepEqual([l.head, l.foot, l.bar], ["none", "none", "none"], `${name}: game mode hides the header, footer and bar`);
      assert.deepEqual(l.stage, [0, 0, w, h], `${name}: the board fills the viewport`);
      assert.equal(l.scrolled, 0, `${name}: the page doesn't scroll`);
      assert.equal(l.tall, false);
      assert.equal(l.exit.display, "grid", `${name}: the exit key shows`);
      assert.ok(l.exit.r[2] >= 44 && l.exit.r[3] >= 44, `${name}: exit key ≥ 44 px (${l.exit.r})`);
    } else {
      // Desktop as it was: header over a board of 100svh - 78 px, the bar and the footer under it.
      assert.deepEqual([l.head, l.foot, l.exit.display], ["block", "block", "none"], "desktop keeps the header and footer, no exit key");
      assert.notEqual(l.bar, "none");
      assert.deepEqual(l.stage.slice(2), [w, h - 78], "desktop: the board under the header");
      assert.ok(l.tall, "desktop: the page scrolls to the footer");
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    }

    where = `${name} pause key`;
    await page.evaluate(() => window.blitz.start());
    await page.waitForFunction(() => window.blitz.state === "play", null, { timeout: 5000 });
    const keys = await page.evaluate(() => {
      const sr = document.querySelector("#blitz").shadowRoot, r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
      const pz = sr.querySelector("[data-pause]"), b = r(pz);
      const others = [...sr.querySelectorAll(".fs, .hud, .pad .rk, .pad .grab, .feed li:not(:empty)"), document.querySelector(".game-exit")].filter((el) => el && getComputedStyle(el).display !== "none").map((el) => ({ cls: el.className, ...r(el) }));
      const top = sr.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { b, others, onTop: top === pz || pz.contains(top), label: pz.getAttribute("aria-label"), inView: b.x >= 0 && b.y >= 0 && b.x + b.width <= innerWidth && b.y + b.height <= innerHeight };
    });
    assert.ok(keys.b.width >= (phone ? 44 : 40) && keys.b.height >= (phone ? 44 : 40), `${name}: pause key ${keys.b.width}×${keys.b.height}`);
    assert.ok(keys.onTop && keys.inView, `${name}: the pause key is on top and on screen`);
    for (const o of keys.others) assert.ok(!hit(keys.b, o), `${name}: the pause key clears ${o.cls} ${JSON.stringify(o)} ${JSON.stringify(keys.b)}`);
    assert.match(keys.label, /Pause/);

    where = `${name} pause: tap, Escape, P, resume, hidden tab`;
    const state = () => page.evaluate(() => window.blitz.state);
    const sr = (sel) => page.evaluate((sel) => { const r = document.querySelector("#blitz").shadowRoot.querySelector(sel).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width, r.height]; }, sel);
    const [px, py] = await sr("[data-pause]");
    if (phone) await page.touchscreen.tap(px, py);
    else await page.mouse.click(px, py);
    await page.waitForFunction(() => window.blitz.state === "paused", null, { timeout: 1000 });
    await page.waitForTimeout(1500); // the keys pop in (Board UI overlay)
    for (const k of ["[data-resume]", "[data-restart]", "[data-menu]"]) {
      const [x, y, kw, kh] = await sr(k);
      assert.ok(kw >= 120 && kh >= 80 && x - kw / 2 >= 0 && x + kw / 2 <= w && y + kh / 2 <= h, `${name}: ${k} is big and on screen (${kw}×${kh} at ${x},${y})`);
    }
    const [rx, ry] = await sr("[data-resume]");
    if (phone) await page.touchscreen.tap(rx, ry);
    else await page.mouse.click(rx, ry);
    await page.waitForFunction(() => window.blitz.state === "play");
    await page.waitForFunction(() => document.querySelector("#blitz").shadowRoot.querySelector("[data-over] [data-c]")?.textContent === "3", null, { timeout: 1000 }); // RESUME counts down
    if (!phone) {
      for (const key of ["Escape", "KeyP"]) {
        await page.keyboard.press(key);
        await page.waitForFunction(() => window.blitz.state === "paused", null, { timeout: 1000 });
        await page.keyboard.press(key);
        await page.waitForFunction(() => window.blitz.state === "play", null, { timeout: 1000 });
      }
    }
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await state(), "paused", `${name}: a hidden tab pauses`);
    assert.ok((await page.evaluate(() => window.__cls)) < 0.01, `${name}: no layout shift (${await page.evaluate(() => window.__cls)})`);
    assert.deepEqual(errors, []);

    if (phone) {
      where = `${name} exit key`;
      await page.reload();
      await page.locator(".game-exit").click();
      await page.waitForURL(base);
    }

    where = `${name} /play/two/`;
    const two = await ctx.newPage();
    await two.goto(base + "play/two/");
    const t = await two.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
      scrollBy({ top: 400, behavior: "instant" });
      return { head: getComputedStyle(document.querySelector(".site-head")).display, foot: getComputedStyle(document.querySelector(".site-foot")).display, stage: r(".blitz-stage"), exit: getComputedStyle(document.querySelector(".game-exit")).display, exitR: r(".game-exit"), room: r(".room"), scrolled: scrollY };
    });
    if (phone) {
      assert.deepEqual([t.head, t.foot, t.exit, t.scrolled], ["none", "none", "grid", 0], `${name} two: game mode`);
      assert.deepEqual([t.stage.x, t.stage.y, t.stage.width, t.stage.height], [0, 0, w, h]);
      assert.ok(!hit(t.exitR, t.room), `${name} two: the exit key clears the room card`);
    } else assert.deepEqual([t.head, t.foot, t.exit], ["block", "block", "none"], "desktop two: as it was");
    await ctx.close();
  }
  console.log("Blitz phone game mode: 390×844 and 844×390 (coarse pointer): no header, footer or bar on screen (h1 and footer byline in the HTML), the board fills the viewport, no scroll, no layout shift, a 44 px exit key home (/play/ and /play/two/); the pause key ≥ 44 px, on top, clear of the HUD, pad and keys; tap / Escape / P pause, RESUME counts down, RESTART and QUIT TO MENU on screen, a hidden tab pauses; 1440×900 keeps the header, board, bar and footer.");
} catch (err) {
  console.error(`Blitz phone test failed at: ${where}`);
  throw err;
} finally {
  await browser.close();
  server.close();
}
