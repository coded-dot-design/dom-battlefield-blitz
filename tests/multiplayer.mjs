// Multiplayer page (/play/two/) with 2 and 4 players, through a mock room server: Playwright
// routes the page's WebSocket to an in-test relay with the fizlet-rooms wire format (seats in
// arrival order, WELCOME when full, inputs relayed with the sender's seat stamped, LEAVE when a
// socket closes). Each peer is its own browser context, like separate devices.
// Checks: the board fills the stage behind ONE room card; join → waiting (seats) → match (a row per
// player in its tank colour, YOU marked, link live, no desync) → a player leaves (everyone told who)
// → REJOIN. At 1440×900 and 390×844, light and dark; no sideways scroll, card keys ≥ 44 px.
// Two room servers, alternating runs: "new" (fizlet#114: POST /invite with the code in the body, the
// invite as a WebSocket subprotocol) and "old" (the deployed one: ?code= / ?invite= in the URL only;
// it answers a POST with 403 and fails a handshake that offers protocols, as a browser would without
// the 101 echo). The page must work on both, never keep ?code= in its URL, and on "new" never put the
// code in a URL or a referrer. A third, "pass" (REQUIRE_PASS on: docs/play-pass.md): the page shows its
// PASS field instead of the invite, sends pass + device key in the POST body and the subprotocols, never
// a URL, and a pass held by one device is refused on another.
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
const rooms = new Map(), CODE = "TEST-CODE-1";
// Pass mode: two test passes (opaque to the page) and the device each one is locked to.
const PASSES = ["eyJ2IjoxLCJpZCI6InRlc3QtcGFzcy1hIn0.c2lnLWE", "eyJ2IjoxLCJpZCI6InRlc3QtcGFzcy1iIn0.c2lnLWI"], locked = new Map();
const passOk = (p, d, claim) => PASSES.includes(p) && /^[A-Za-z0-9_-]{16,64}$/.test(d ?? "") && (locked.get(p) ?? d) === d && (claim ? (locked.set(p, d), true) : true);
// Where codes travelled on a "new" server (URLs, referrers): must stay empty.
const leaks = [];
async function mockServer(context, mode) {
  await context.route("https://rooms.test/**", (r) => {
    const req = r.request(), u = new URL(req.url()), inUrl = u.searchParams.get("code");
    if (mode === "pass") {
      if (u.search || PASSES.some((p) => req.url().includes(p) || (req.headers().referer ?? "").includes(p))) leaks.push(req.url());
      const [p, d] = (req.postData() ?? "").split("\n"), ok = passOk(p, d, false);
      const why = PASSES.includes(p) && locked.has(p) ? "pass in use on another device" : "pass not valid";
      return r.fulfill({ status: ok ? 200 : 403, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(ok ? { ok: true, players: 4, pass: true } : { ok: false, pass: true, ...(p ? { why } : {}) }) });
    }
    if (mode === "new" && (inUrl || /code|invite/i.test(req.headers().referer ?? ""))) leaks.push(inUrl ?? req.headers().referer);
    // old: the method is ignored and the code read from the URL; new: the body of a POST (URL still accepted).
    const code = mode === "new" && req.method() === "POST" ? req.postData() : inUrl;
    const ok = code === CODE;
    return r.fulfill({ status: ok ? 200 : 403, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: ok ? '{"ok":true,"players":4}' : '{"ok":false}' });
  });
  // The page's subprotocols reach the route through the URL fragment (see the init script in peer()).
  await context.routeWebSocket(/^wss:\/\/rooms\.test\//, (ws) => {
    const u = new URL(ws.url()), players = Number(u.searchParams.get("players"));
    const protocols = u.hash.startsWith("#p=") ? JSON.parse(decodeURIComponent(u.hash.slice(3))) : [];
    const viaUrl = u.searchParams.get("invite"), viaProtocol = protocols.find((p) => p.startsWith("invite."))?.slice(7);
    if (mode === "new" && viaUrl) leaks.push(`ws ?invite=${viaUrl}`);
    if (mode === "pass") {
      if (PASSES.some((p) => u.search.includes(p))) leaks.push(`ws ${u.search}`);
      const pass = protocols.find((p) => p.startsWith("pass."))?.slice(5), dev = protocols.find((p) => p.startsWith("device."))?.slice(7);
      if (!protocols.includes("fizlet-rooms") || !passOk(pass, dev, true)) return ws.close({ code: 4003, reason: "pass needed" });
    } else
    if (mode === "new" && !protocols.includes("fizlet-rooms")) return ws.close({ code: 4003, reason: "expected the fizlet-rooms subprotocol" });
    if (mode === "old" && protocols.length) return ws.close({ code: 1006, reason: "no subprotocol in the 101: the browser fails the handshake" });
    if (mode !== "pass" && (mode === "new" ? viaProtocol : viaUrl) !== CODE) return ws.close({ code: 4003, reason: "invite code needed" });
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
async function peer(width, theme, url, mode) {
  const context = await browser.newContext(VIEW[width]);
  contexts.push(context);
  await context.addInitScript((t) => localStorage.setItem("dom-virus:theme", t), theme);
  await mockServer(context, mode);
  // After Playwright's WebSocket mock: carry the subprotocols to the route in the URL fragment
  // (the mock doesn't hand them over; nothing connects for real).
  await context.addInitScript(() => {
    const W = window.WebSocket;
    window.WebSocket = class extends W {
      constructor(url, protocols) {
        super(protocols ? `${url}#p=${encodeURIComponent(JSON.stringify([protocols].flat()))}` : url);
      }
    };
  });
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
  // The last number: the TEAMS pick (two players: 0 free-for-all, k = kVk with AI wingmen).
  for (const [n, width, theme, mode, teams] of [[2, 1440, "dark", "new", 0], [2, 390, "light", "old", 2], [2, 1440, "light", "new", 4], [2, 390, "dark", "old", 1], [4, 1440, "dark", "new", 0], [4, 390, "light", "old", 0]]) {
    const tag = `${n}p-${width}-${theme}-${mode}`, room = runs++;
    where = tag;
    const url = `${base}play/two/?rooms=wss://rooms.test&room=${room}&players=${n}&code=${CODE}`;
    // You: the device under test. The others: desktop browsers.
    const me = await peer(width, theme, url, mode);
    await me.waitForFunction(() => !document.querySelector("[data-players-pick]").hidden, null, { timeout: 5000 }).catch(() => {});
    assert.equal(await step(me), "join");
    // An old ?code= link: the code prefills the form, and the address bar and history lose it.
    assert.equal(await me.inputValue("input[name=code]"), CODE, `${tag}: ?code= prefills the code`);
    assert.doesNotMatch(me.url(), /code=|invite=/, `${tag}: no code in the URL`);
    assert.equal(await me.evaluate(() => document.referrer === "" && document.querySelector('meta[name="referrer"]')?.content), "no-referrer");
    if (runs === 1) {
      // A wrong code is refused. On a "new" server it goes once more by ?code= (the old-server
      // fallback, dropped next release); a right code never does.
      await me.fill("input[name=code]", "WRONG-CODE-9");
      await me.click("[data-join]");
      await me.waitForFunction(() => /isn't on the list/.test(document.querySelector("[data-say]").textContent));
      assert.deepEqual(leaks.splice(0), ["WRONG-CODE-9"]);
      await me.fill("input[name=code]", CODE);
    }
    // TEAMS: two players only; P1 (you, first in) picks.
    assert.equal(await me.evaluate(() => document.querySelector("[data-squad-pick]").hidden), n !== 2, `${tag}: the teams pick shows for two players only`);
    if (teams) {
      await me.click(`[data-squad="${teams}"]`);
      assert.equal(await me.getAttribute(`[data-squad="${teams}"]`, "aria-pressed"), "true");
    }
    await shot(me, `${tag}-1-join`);
    await layout(me, `${tag} join`);
    await me.click("[data-join]");
    await me.waitForFunction(() => document.querySelector(".room").dataset.step === "wait");
    assert.equal(await me.locator("[data-wait-seats] li").count(), n, "a seat per player");
    assert.match(await me.locator("[data-sub]").textContent(), new RegExp(`WAITING · ${n} PLAYERS`));
    await shot(me, `${tag}-2-wait`);
    await layout(me, `${tag} wait`);
    // SEND LINK: the room and players, never the code.
    await me.evaluate(() => {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => void (window.shared = t) }, configurable: true });
    });
    await me.click("[data-share]");
    const link = await me.waitForFunction(() => window.shared).then((h) => h.jsonValue());
    assert.match(link, new RegExp(`room=${room}&players=${n}${teams ? `&teams=${teams}` : ""}`), `${tag}: the link carries room, players${teams ? " and teams" : ""}`);
    assert.doesNotMatch(link, new RegExp(`code=|invite=|${CODE}`, "i"), `${tag}: the link has no code`);
    const others = [];
    for (let i = 1; i < n; i++) {
      const o = await peer(1440, theme, url, mode);
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
      // P1's teams pick on every screen (the others never picked): 2 × teams tanks, else 2 players + 4 bots.
      const m = await p.evaluate(() => ({ squad: window.blitz.squad, tanks: window.blitz.world.tanks.length, sub: document.querySelector("[data-sub]").textContent }));
      assert.equal(m.squad, n === 2 ? teams : 0, `${tag}: the match plays P1's teams`);
      assert.equal(m.tanks, n === 2 && teams ? 2 * teams : n + 4, `${tag}: the right number of tanks`);
      if (n === 2 && teams) assert.match(m.sub, new RegExp(`${teams}V${teams}`), `${tag}: the card says ${teams}V${teams}`);
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
      const back = await peer(1440, theme, url, mode);
      await back.click("[data-join]");
      for (const p of [me, back]) await p.waitForFunction(() => document.querySelector(".room").dataset.step === "play", null, { timeout: 10000 });
      await back.close();
    }
    for (const p of all) assert.deepEqual(p.errors, [], `${tag}: no page errors`);
    assert.deepEqual(leaks, [], `${tag}: no code in a URL or referrer on the new server`);
    for (const c of contexts.splice(0)) await c.close();
  }
  // Passes on: the PASS field replaces the invite; each device joins with its own pass.
  for (const [width, theme] of [[390, "light"], [1440, "dark"]]) {
    const tag = `pass-${width}-${theme}`, room = runs++, url = `${base}play/two/?rooms=wss://rooms.test&room=${room}&players=2`;
    where = tag;
    locked.clear();
    const me = await peer(width, theme, url, "pass");
    await me.waitForSelector("[data-pass]:not([hidden])", { timeout: 5000 });
    assert.equal(await me.locator("[data-invite]").isHidden(), true, `${tag}: no invite field when passes are required`);
    await layout(me, `${tag} join`);
    await shot(me, `${tag}-1-join`);
    await me.fill("input[name=pass]", "not-a-pass.at-all-really");
    await me.click("[data-join]");
    await me.waitForFunction(() => /isn't valid/.test(document.querySelector("[data-say]").textContent));
    await me.fill("input[name=pass]", PASSES[0]);
    await me.click("[data-join]");
    await me.waitForFunction(() => document.querySelector(".room").dataset.step === "wait");
    assert.equal(await me.evaluate(() => sessionStorage.getItem("blitz-pass")), PASSES[0], `${tag}: the pass is kept for this tab`);
    const other = await peer(1440, theme, url, "pass");
    await other.waitForSelector("[data-pass]:not([hidden])");
    await other.fill("input[name=pass]", PASSES[1]);
    await other.click("[data-join]");
    for (const p of [me, other]) await p.waitForFunction(() => document.querySelector(".room").dataset.step === "play", null, { timeout: 10000 });
    // Pass A is locked to my device: another device with it is refused before it joins.
    const thief = await peer(1440, theme, url, "pass");
    await thief.waitForSelector("[data-pass]:not([hidden])");
    await thief.fill("input[name=pass]", PASSES[0]);
    await thief.click("[data-join]");
    await thief.waitForFunction(() => /locked to another device/.test(document.querySelector("[data-say]").textContent));
    for (const p of [me, other, thief]) {
      assert.doesNotMatch(p.url(), /pass|eyJ/, `${tag}: no pass in the URL`);
      assert.deepEqual(p.errors, [], `${tag}: no page errors`);
    }
    assert.deepEqual(leaks, [], `${tag}: no pass in a URL or referrer`);
    for (const c of contexts.splice(0)) await c.close();
  }
  console.log(`Multiplayer: 2 and 4 players through a mock room (old and new invite forms, and passes), ${runs} runs at 1440 and 390 in light and dark: join, the TEAMS pick (FFA, 1v1, 2v2, 4v4: P1's pick on every screen, the right tank count, carried by the link), waiting seats, live match with a row per player in its tank colour, a player leaving (named), rejoin; no desync, no sideways scroll, card keys ≥ 44 px.`);
} catch (e) {
  console.error(`multiplayer test failed at ${where}`);
  throw e;
} finally {
  await browser.close();
  server.close();
}
