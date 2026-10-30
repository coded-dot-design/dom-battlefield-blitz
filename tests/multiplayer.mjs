// Multiplayer page (/play/two/) with 2 and 4 players, through a mock room server: Playwright
// routes the page's WebSocket to an in-test relay with the fizlet-rooms wire format (seats in
// arrival order, WELCOME when full, inputs relayed with the sender's seat stamped, LEAVE when a
// socket closes). Each peer is its own browser context, like separate devices.
// Checks: the board fills the stage behind ONE room card; join → waiting (seats) → match (a row per
// player in its tank colour, YOU marked, link live, no desync) → a player leaves (everyone told who)
// → REJOIN. At 1440×900 and 390×844, light and dark; no sideways scroll, card keys ≥ 44 px.
// Run after `npm run site:build`. SHOTS=<dir> saves screenshots.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve("artifacts/pages"), PREFIX = "/dom-battlefield-blitz", SHOTS = process.env.SHOTS;
if (!existsSync(join(root, "index.html"))) throw Error("Build the site first: npm run site:build");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.startsWith(`${PREFIX}/`) ? join(root, path.slice(PREFIX.length)) : "";
  if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!file || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}${PREFIX}/`;

// ---------- The mock room server (rooms/src/relay.js, in memory) ----------
const INPUT = 1, HASH = 2, WELCOME = 3, LEAVE = 4;
const msg = (kind, slot, players, frame, value) => {
  const b = Buffer.alloc(12);
  b[0] = kind, b[1] = slot, b[2] = players;
  b.writeUInt32LE(frame >>> 0, 4);
  b.writeUInt32LE(value >>> 0, 8);
  return b;
};
const rooms = new Map();
async function mockServer(context) {
  await context.route("https://rooms.test/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"ok":true,"players":4}' }));
  await context.routeWebSocket(/^wss:\/\/rooms\.test\//, (ws) => {
    const u = new URL(ws.url()), players = Number(u.searchParams.get("players"));
    let r = rooms.get(u.pathname);
    if (!r || !r.seats.some(Boolean)) rooms.set(u.pathname, (r = { players, seats: Array(players).fill(null), started: false, seed: 1234 + rooms.size }));
    if (r.players !== players || r.started) return ws.close({ code: 4000, reason: "room full" });
    const slot = r.seats.indexOf(null);
    r.seats[slot] = ws;
    if (r.seats.every(Boolean)) (r.started = true), r.seats.forEach((p, s) => p.send(msg(WELCOME, s, players, r.seed, 0)));
    ws.onMessage((d) => {
      if (typeof d === "string" || d.length !== 12 || (d[0] !== INPUT && d[0] !== HASH)) return;
      const b = Buffer.from(d);
      b[1] = slot;
      r.seats.forEach((p, s) => s !== slot && p?.send(b));
    });
    ws.onClose(() => {
      if (r.seats[slot] !== ws) return;
      r.seats[slot] = null;
      if (r.started) r.seats.forEach((p) => p?.send(msg(LEAVE, slot, players, 0, 0)));
      if (!r.seats.some(Boolean)) r.started = false;
    });
  });
}

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const VIEW = { 1440: { viewport: { width: 1440, height: 900 } }, 390: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } };
const contexts = [];
async function peer(width, theme, url) {
  const context = await browser.newContext(VIEW[width]);
  contexts.push(context);
  await context.addInitScript((t) => localStorage.setItem("dom-virus:theme", t), theme);
  await mockServer(context);
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(url);
  return page;
}
const step = (p) => p.locator(".room").getAttribute("data-step");
const shot = (p, name) => SHOTS && p.screenshot({ path: join(SHOTS, `${name}.png`) });
async function layout(p, label) {
  const fit = await p.evaluate(() => {
    const c = document.querySelector(".room").getBoundingClientRect(), s = document.querySelector(".blitz-stage").getBoundingClientRect();
    const small = [...document.querySelectorAll(".room :is(button:not(.bui-grip), input:not([type=hidden]))")]
      .filter((el) => el.offsetParent && (el.offsetWidth < 44 || el.offsetHeight < 44)) // layout size: a key mid-press is scaled
      .map((el) => el.outerHTML.slice(0, 60));
    const board = document.querySelector("#arena").getBoundingClientRect();
    return { sideways: document.documentElement.scrollWidth - innerWidth, inStage: c.left >= s.left && c.right <= s.right && c.top >= s.top && c.bottom <= s.bottom, small, boardFills: board.width === s.width && s.height - board.height <= 2, cards: document.querySelectorAll(".bui-card").length };
  });
  assert.equal(fit.sideways, 0, `${label}: no sideways scroll`);
  assert.ok(fit.inStage, `${label}: the room card is whole on the board`);
  assert.deepEqual(fit.small, [], `${label}: card keys are 44 px or more`);
  assert.ok(fit.boardFills, `${label}: the board fills the stage`);
  assert.equal(fit.cards, 1, `${label}: one room card`);
}

let where = "start", runs = 0;
try {
  for (const [n, width, theme] of [[2, 1440, "dark"], [2, 390, "light"], [2, 1440, "light"], [2, 390, "dark"], [4, 1440, "dark"], [4, 390, "light"]]) {
    const tag = `${n}p-${width}-${theme}`, room = runs++;
    where = tag;
    const url = `${base}play/two/?rooms=wss://rooms.test&room=${room}&players=${n}&code=TEST-CODE-1`;
    // You: the device under test. The others: desktop browsers.
    const me = await peer(width, theme, url);
    await me.waitForFunction(() => !document.querySelector("[data-players-pick]").hidden, null, { timeout: 5000 }).catch(() => {});
    assert.equal(await step(me), "join");
    await shot(me, `${tag}-1-join`);
    await layout(me, `${tag} join`);
    await me.click("[data-join]");
    await me.waitForFunction(() => document.querySelector(".room").dataset.step === "wait");
    assert.equal(await me.locator("[data-wait-seats] li").count(), n, "a seat per player");
    assert.match(await me.locator("[data-sub]").textContent(), new RegExp(`WAITING · ${n} PLAYERS`));
    await shot(me, `${tag}-2-wait`);
    await layout(me, `${tag} wait`);
    const others = [];
    for (let i = 1; i < n; i++) {
      const o = await peer(1440, theme, url);
      await o.click("[data-join]");
      others.push(o);
    }
    const all = [me, ...others];
    for (const p of all) await p.waitForFunction(() => document.querySelector(".room").dataset.step === "play", null, { timeout: 10000 });
    // The match runs: frames move on every screen and every hash check agrees.
    await me.waitForFunction(() => window.blitz?.net?.frame > 240, null, { timeout: 60000 });
    for (const p of all) {
      const s = await p.evaluate(() => ({ desync: window.blitz.net.desync, conn: document.querySelector(".room").dataset.conn, rows: [...document.querySelectorAll("[data-rows] tr")].map((r) => [r.className.includes("you"), r.querySelector(".sw").style.getPropertyValue("--c"), r.querySelector("th").textContent]) }));
      assert.equal(s.desync, -1, `${tag}: no desync`);
      assert.equal(s.conn, "live");
      assert.equal(s.rows.length, n, `${tag}: a scoreboard row per player`);
      assert.equal(s.rows.filter((r) => r[0]).length, 1, `${tag}: exactly one YOU`);
      assert.deepEqual(s.rows.map((r) => r[1]), ["#39ffb0", "#ff5c8f", "#19f0ff", "#ffc21a"].slice(0, n), `${tag}: seat colours = tank colours`);
    }
    // Phones: the card folds out of the way for the match; it opens on a tap.
    const folded = await me.evaluate(() => document.querySelector(".room").classList.contains("folded"));
    assert.equal(folded, width === 390, `${tag}: folded in a match on a phone only`);
    await shot(me, `${tag}-3-play`);
    await layout(me, `${tag} play`);
    await me.click("[data-fold]");
    await shot(me, `${tag}-4-play-${folded ? "open" : "folded"}`);
    await layout(me, `${tag} play (toggled)`);
    // The last player leaves: everyone else is told who, and can rejoin.
    const quitter = all.at(-1);
    await quitter.close();
    for (const p of all.slice(0, -1)) {
      await p.waitForFunction(() => document.querySelector(".room").dataset.step === "gone", null, { timeout: 5000 });
      const said = await p.locator("[data-gone-say]").textContent();
      assert.match(said, n === 2 ? /other player left/ : new RegExp(`P${n} left`), `${tag}: says who left`);
    }
    await shot(me, `${tag}-5-left`);
    await layout(me, `${tag} gone`);
    if (n === 2 && width === 1440 && theme === "dark") {
      // REJOIN: the same room, a fresh match, for both.
      await me.click("[data-again]");
      const back = await peer(1440, theme, url);
      await back.click("[data-join]");
      for (const p of [me, back]) await p.waitForFunction(() => document.querySelector(".room").dataset.step === "play", null, { timeout: 10000 });
      await back.close();
    }
    for (const p of all) assert.deepEqual(p.errors, [], `${tag}: no page errors`);
    for (const c of contexts.splice(0)) await c.close();
  }
  console.log(`Multiplayer: 2 and 4 players through a mock room, ${runs} runs at 1440 and 390 in light and dark: join, waiting seats, live match with a row per player in its tank colour, a player leaving (named), rejoin; no desync, no sideways scroll, card keys ≥ 44 px.`);
} catch (e) {
  console.error(`multiplayer test failed at ${where}`);
  throw e;
} finally {
  await browser.close();
  server.close();
}
