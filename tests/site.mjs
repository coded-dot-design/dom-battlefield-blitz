// Blitz site (GitHub Pages): landing page, the game at /play/ and the drop-in at /blitz.js.
// Run after `npm run site:build`. Serves artifacts/pages at /dom-battlefield-blitz/.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright";
import { checkKeys, checkTaps } from "./keys.mjs";
import { checkHeroScrim } from "./hero-scrim.mjs";
import { FAMILY_LINE, GROUPS, PAGES, SELF, hidden } from "../site/src/sitemap.mjs";

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

  // The hero scrim and its copy follow the theme (light: --surface, dark: --bg), AA in both.
  where = "hero scrim";
  await checkHeroScrim(browser, base, "landing");

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
  // Page keys (Fizlet BOARD-UI.md "Page keys"): every in-page key presses (face drops by its base)
  // and clicks on its face, top edge and base; Enter shows the press; phones: a tap on the base clicks.
  where = "touch";
  {
    // Phones (390 x 844, touch): a double-tap, a pinch or a sideways swipe on the hero battle never
    // zooms or pans the page; the page is touch-action: manipulation (no double-tap zoom) and stays
    // 390 wide. Raw touch points: Chromium's synthesized touch pinch never zooms headless.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const tp = await phone.newPage();
    await tp.goto(base);
    await tp.waitForTimeout(500);
    const cdp = await phone.newCDPSession(tp);
    const pts = (type, list) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: list.map(([x, y], id) => ({ x, y, id })) });
    const state = () => tp.evaluate(() => ({ scale: visualViewport.scale, x: scrollX, w: document.documentElement.scrollWidth }));
    const hero = await tp.locator("[data-touch-lock]").first().boundingBox();
    const x = 195, y = Math.round(hero.y + hero.height * 0.55);
    await pts("touchStart", [[x - 15, y], [x + 15, y]]);
    for (let i = 1; i <= 10; i++) await pts("touchMove", [[x - 15 - i * 12, y], [x + 15 + i * 12, y]]);
    await pts("touchEnd", []);
    await tp.waitForTimeout(300);
    assert.deepEqual(await state(), { scale: 1, x: 0, w: 390 }, "a pinch on the hero does not zoom the page");
    await pts("touchStart", [[300, y]]);
    for (let i = 1; i <= 10; i++) await pts("touchMove", [[300 - i * 25, y]]);
    await pts("touchEnd", []);
    await tp.waitForTimeout(300);
    assert.deepEqual(await state(), { scale: 1, x: 0, w: 390 }, "a sideways swipe on the hero does not pan the page");
    await cdp.send("Input.synthesizeTapGesture", { x, y, tapCount: 2, gestureSourceType: "touch" });
    await tp.waitForTimeout(300);
    assert.equal((await state()).scale, 1, "a double-tap on the hero does not zoom");
    const ta = await tp.evaluate(() => [getComputedStyle(document.documentElement).touchAction, getComputedStyle(document.querySelector("[data-touch-lock]")).touchAction]);
    assert.deepEqual(ta, ["manipulation", "pan-y"], "page touch-action manipulation, hero pan-y");
    await phone.close();
  }

  where = "page keys";
  let keys = 0;
  for (const [opts, check] of [[{ viewport: { width: 1440, height: 900 } }, checkKeys], [{ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, checkTaps]]) {
    const kc = await browser.newContext(opts);
    const kp = await kc.newPage();
    await kp.goto(base);
    keys += await check(kp, where);
    await kc.close();
  }
  // Two players (/play/two/): the join card fits a phone in both orientations and the desktop,
  // with no sideways scroll, every lobby key at least 44 px, and a bad code refused before any room.
  where = "two players";
  for (const [w, h, touch] of [[390, 844, true], [844, 390, true], [1440, 900, false]]) {
    const tc = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
    const tp = await tc.newPage();
    const terr = [];
    tp.on("pageerror", (e) => terr.push(e.message));
    await tp.route("https://rooms.test/**", (r) => r.fulfill({ status: 403, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"ok":false}' }));
    await tp.goto(`${base}play/two/?rooms=wss://rooms.test&room=3`);
    assert.equal(await tp.locator(".room").getAttribute("data-step"), "join");
    assert.equal(await tp.locator("output[name=roomShow]").textContent(), "3", "?room= picks the room");
    const fit = await tp.evaluate(() => {
      const card = document.querySelector(".room").getBoundingClientRect();
      const small = [...document.querySelectorAll(".room :is(button:not(.bui-grip), input:not([type=hidden]))")].filter((el) => el.offsetParent && (el.getBoundingClientRect().width < 44 || el.getBoundingClientRect().height < 44)).map((el) => el.outerHTML.slice(0, 60));
      return { sideways: document.documentElement.scrollWidth - innerWidth, inView: card.top >= 0 && card.bottom <= innerHeight, small };
    });
    assert.equal(fit.sideways, 0, `${w}x${h}: no sideways scroll`);
    assert.ok(fit.inView, `${w}x${h}: the join card is on screen`);
    assert.deepEqual(fit.small, [], `${w}x${h}: lobby keys are 44 px or more`);
    await tp.fill("input[name=code]", "NOPE-NOPE-1");
    await tp.click("[data-join]");
    await tp.waitForFunction(() => /isn't on the list/.test(document.querySelector("[data-say]").textContent));
    assert.equal(await tp.locator(".room").getAttribute("data-step"), "join", "a bad code stays on the join card");
    assert.deepEqual(terr, []);
    await tc.close();
  }
  where = "footer site map";
  {
    // The footer's site map (site/src/sitemap.mjs): on every page, one column per group, every page in
    // PAGES linked exactly once, no hidden or noindex page, the current page marked, every section
    // link landing on its heading. Phones: one column, no sideways scroll.
    const noindex = (path) => /<meta\s+name="robots"\s+content="[^"]*noindex/.test(readFileSync(join(root, path, "index.html"), "utf8"));
    const fp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    for (const at of PAGES.map((p) => p.path)) {
      await fp.goto(base + at);
      const map = fp.locator('footer nav[aria-label="Site map"]');
      assert.equal(await map.locator("ul").count(), GROUPS.length, `/${at}: a list per group`);
      assert.deepEqual(await map.locator("h2").allTextContents(), GROUPS.map((g, i) => `${String(i + 1).padStart(2, "0")}${g.title}`), `/${at}: group headings`);
      const links = await map.locator("a").evaluateAll((as) => as.map((a) => ({ href: a.href, current: a.getAttribute("aria-current") })));
      const local = links.map((l) => ({ ...l, url: new URL(l.href) })).filter((l) => l.url.origin === origin);
      for (const p of PAGES) {
        const n = local.filter((l) => l.url.pathname === new URL(base + p.path).pathname && !l.url.hash).length;
        assert.equal(n, 1, `/${at}: footer links /${p.path} once (got ${n})`);
      }
      for (const l of local) {
        const path = l.url.pathname.slice(`${PREFIX}/`.length);
        assert.ok(!hidden(path) && !noindex(path), `/${at}: footer never links hidden or noindex /${path}`);
        if (l.url.hash) assert.match(readFileSync(join(root, path, "index.html"), "utf8"), new RegExp(`id="${l.url.hash.slice(1)}"`), `${l.href} has its heading`);
      }
      const current = local.filter((l) => l.current === "page").map((l) => l.url.pathname);
      assert.deepEqual(current, [new URL(base + at).pathname], `/${at}: aria-current on this page only`);
      // The family line (sitemap.mjs FAMILY_LINE): the four family sites first, in order, ↗ on all but this one.
      const family = await map.locator('ul[aria-labelledby="map-family"] a').evaluateAll((as) => as.map((a) => [a.getAttribute("href"), a.textContent.trim()]));
      assert.deepEqual(family.slice(0, FAMILY_LINE.length), FAMILY_LINE.map((f) => [f.href, f.href === SELF ? f.label : `${f.label}↗`]), `/${at}: the family line`);
    }
    await fp.setViewportSize({ width: 390, height: 844 });
    await fp.goto(base);
    const phone = await fp.evaluate(() => {
      const cols = [...document.querySelectorAll(".foot-col")].map((c) => Math.round(c.getBoundingClientRect().left));
      return { oneColumn: new Set(cols).size === 1, fits: document.documentElement.scrollWidth <= innerWidth };
    });
    assert.deepEqual(phone, { oneColumn: true, fits: true }, "phone: one column of groups, no sideways scroll");
    await fp.close();
  }
  console.log(`Site: landing + live demo, hero scrim in both themes, board match, phone app mode, drop-in, ${keys} page keys, two-player lobby at 3 sizes, footer site map passed.`);
} catch (e) {
  console.error(`site test failed at ${where}`);
  throw e;
} finally {
  await browser.close();
  server.close();
}
