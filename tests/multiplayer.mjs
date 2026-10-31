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
// code in a URL or a referrer.
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
const INPUT = 1, HASH = 2, WELCOME = 3, LEAVE = 4, LOBBY = 5, START = 6;
const msg = (kind, slot, players, frame, value) => {
  const b = Buffer.alloc(12);
  b[0] = kind, b[1] = slot, b[2] = players;
  b.writeUInt32LE(frame >>> 0, 4);
  b.writeUInt32LE(value >>> 0, 8);
  return b;
};
const rooms = new Map(), CODE = "TEST-CODE-1";
// Where codes travelled on a "new" server (URLs, referrers): must stay empty.
const leaks = [];
async function mockServer(context, mode) {
  await context.route("https://rooms.test/**", (r) => {
    const req = r.request(), u = new URL(req.url()), inUrl = u.searchParams.get("code");
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
    if (mode === "new" && !protocols.includes("fizlet-rooms")) return ws.close({ code: 4003, reason: "expected the fizlet-rooms subprotocol" });
    if (mode === "old" && protocols.length) return ws.close({ code: 1006, reason: "no subprotocol in the 101: the browser fails the handshake" });
    if ((mode === "new" ? viaProtocol : viaUrl) !== CODE) return ws.close({ code: 4003, reason: "invite code needed" });
    let r = rooms.get(u.pathname);
    if (!r || !r.seats.some(Boolean)) rooms.set(u.pathname, (r = { players, seats: Array(players).fill(null), started: false, seed: 1234 + rooms.size }));
    if (r.players !== players || r.started) return ws.close({ code: 4000, reason: "room full" });
    r.seats[r.seats.indexOf(null)] = ws;
    const slot = () => r.seats.indexOf(ws);
    const welcome = () => ((r.started = true), r.seats.forEach((p, s) => p.send(msg(WELCOME, s, r.seats.length, r.seed, 0))));
    // The proposed wire (rooms "start now", "new" server only): LOBBY to everyone waiting on each join
    // and leave; START from seat 0 with 2+ in seats the ones in (arrival order) and welcomes them.
    const lobby = () => mode === "new" && r.seats.forEach((p, s) => p?.send(msg(LOBBY, s, r.seats.filter(Boolean).length, r.players, 0)));
    if (r.seats.every(Boolean)) welcome();
    else lobby();
    ws.onMessage((d) => {
      if (typeof d === "string" || d.length !== 12) return;
      if (d[0] === START && mode === "new" && !r.started && slot() === 0 && r.seats.filter(Boolean).length >= 2) return (r.seats = r.seats.filter(Boolean)), (r.startedWith = r.seats.length), welcome();
      if (!r.started || (d[0] !== INPUT && d[0] !== HASH)) return;
      const b = Buffer.from(d), me = slot();
      b[1] = me;
      r.seats.forEach((p, s) => s !== me && p?.send(b));
    });
    ws.onClose(() => {
      const me = slot();
      if (me < 0) return;
      r.seats[me] = null;
      if (r.started) r.seats.forEach((p) => p?.send(msg(LEAVE, me, r.seats.length, 0, 0)));
      else lobby();
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
// The four modes: [humans, width, theme, server, mode, platoon size]. FFA and 2v2 are 4-seat rooms: with
// 2 or 3 in, P1 starts (START) and the computer takes the empty seats; with 4 in, the room starts itself.
const CASES = [
  [2, 1440, "dark", "new", "1v1"],
  [2, 390, "light", "old", "platoon", 2],
  [2, 1440, "light", "new", "ffa"],
  [3, 390, "dark", "new", "2v2"],
  [4, 1440, "dark", "new", "2v2"],
  [4, 390, "light", "old", "ffa"],
  [2, 390, "dark", "new", "platoon", 4],
  [3, 1440, "light", "new", "ffa"],
];
const said = [];
try {
  for (const [n, width, theme, mode, game, squad] of CASES) {
    const tag = `${game}${squad ? squad : ""}-${n}p-${width}-${theme}-${mode}`, room = runs++, seats = game === "ffa" || game === "2v2" ? 4 : 2;
    where = tag;
    // Old links (?players=, ?teams=) still land on a mode; the share link writes ?mode=.
    const url = `${base}play/two/?rooms=wss://rooms.test&room=${room}&${runs % 2 ? `mode=${game}${squad ? `&teams=${squad}` : ""}` : game === "platoon" ? `teams=${squad}` : game === "1v1" ? "teams=1" : `mode=${game}`}&code=${CODE}`;
    // You: the device under test (P1, the host). The others: desktop browsers.
    const me = await peer(width, theme, url, mode);
    await me.waitForFunction(() => !document.querySelector('[data-mode="ffa"]').disabled, null, { timeout: 5000 }).catch(() => {});
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
    // The link picked the mode; pick it again by hand (and the platoon size), as P1 would.
    assert.equal(await me.getAttribute(`[data-mode="${game}"]`, "aria-pressed"), "true", `${tag}: the link picks ${game}`);
    await me.click(`[data-mode="${game}"]`);
    assert.equal(await me.evaluate(() => document.querySelector("[data-squad-pick]").hidden), game !== "platoon", `${tag}: the platoon size shows for platoons only`);
    if (squad) await me.click(`[data-squad="${squad}"]`), assert.equal(await me.getAttribute(`[data-squad="${squad}"]`, "aria-pressed"), "true");
    assert.deepEqual(await me.$$eval("[data-mode]", (b) => b.map((k) => k.getAttribute("aria-pressed"))), ["1v1", "ffa", "2v2", "platoon"].map((m) => String(m === game)), `${tag}: one mode pressed`);
    await shot(me, `${tag}-1-join`);
    await layout(me, `${tag} join`);
    await me.click("[data-join]");
    await me.waitForFunction(() => document.querySelector(".room").dataset.step === "wait");
    assert.equal(await me.locator("[data-wait-seats] li").count(), seats, "a seat per player");
    assert.match(await me.locator("[data-sub]").textContent(), new RegExp(`WAITING · ${seats} PLAYERS`));
    await shot(me, `${tag}-2-wait`);
    await layout(me, `${tag} wait`);
    // SEND LINK: the room and mode, never the code.
    await me.evaluate(() => {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => void (window.shared = t) }, configurable: true });
    });
    await me.click("[data-share]");
    const link = await me.waitForFunction(() => window.shared).then((h) => h.jsonValue());
    assert.match(link, new RegExp(`room=${room}&mode=${game}${squad ? `&teams=${squad}` : ""}`), `${tag}: the link carries room and mode`);
    assert.doesNotMatch(link, new RegExp(`code=|invite=|${CODE}`, "i"), `${tag}: the link has no code`);
    // The others join from the link with a different mode of their own: P1's is the match's.
    const others = [];
    for (let i = 1; i < n; i++) {
      const o = await peer(1440, theme, `${base}play/two/?rooms=wss://rooms.test&room=${room}&mode=${game}&code=${CODE}`, mode);
      if (seats === 2) await o.click(`[data-mode="${game === "1v1" ? "platoon" : "1v1"}"]`);
      else await o.waitForFunction(() => !document.querySelector('[data-mode="2v2"]').disabled), await o.click(`[data-mode="${game === "ffa" ? "2v2" : "ffa"}"]`);
      await o.click("[data-join]");
      others.push(o);
    }
    const all = [me, ...others];
    const cpu = seats - n;
    if (cpu) {
      // A 4-seat room with 2 or 3 in: P1 sees who's in and START NOW; the others wait for P1.
      await me.waitForFunction((n) => document.querySelectorAll("[data-wait-seats] li:not(.open)").length === n, n);
      await me.waitForFunction(() => !document.querySelector("[data-start]").hidden);
      assert.match(await me.locator("[data-start]").textContent(), new RegExp(`START NOW · ${cpu} CPU`));
      for (const o of others) assert.equal(await o.locator("[data-start]").isHidden(), true, `${tag}: only P1 can start`), assert.match(await o.locator("[data-wait-say]").textContent(), /Waiting for P1 to start/);
      await shot(me, `${tag}-2-wait-start`);
      await layout(me, `${tag} wait start`);
      await me.click("[data-start]");
    }
    for (const p of all) await p.waitForFunction(() => document.querySelector(".room").dataset.step === "play", null, { timeout: 10000 });
    // The match runs: frames move on every screen and every hash check agrees.
    await me.waitForFunction(() => window.blitz?.net?.frame > 240, null, { timeout: 60000 });
    for (const p of all) {
      const s = await p.evaluate(() => ({ desync: window.blitz.net.desync, conn: document.querySelector(".room").dataset.conn, rows: [...document.querySelectorAll("[data-rows] tr:not(.side)")].map((r) => [r.className.includes("you"), r.querySelector(".sw").style.getPropertyValue("--c"), r.querySelector("th").textContent]), sides: [...document.querySelectorAll("[data-rows] tr.side")].map((r) => [r.querySelector("th").textContent, +r.querySelector("td").textContent]) }));
      assert.equal(s.desync, -1, `${tag}: no desync`);
      assert.equal(s.conn, "live");
      const m = await p.evaluate(() => ({ squad: window.blitz.squad, tanks: window.blitz.world.tanks.map((t) => ({ team: t.team, kills: t.kills, color: t.color, you: t.you })), sub: document.querySelector("[data-sub]").textContent }));
      // P1's mode on every screen (the others picked another): the right tanks, humans first.
      const want = { "1v1": [1, 2], platoon: [squad, 2 * squad], ffa: [0, 4], "2v2": [2, 4] }[game];
      assert.equal(m.squad, want[0], `${tag}: the match plays P1's mode`);
      assert.equal(m.tanks.length, want[1], `${tag}: ${want[1]} tanks`);
      assert.equal(m.tanks.filter((t) => t.you).length, n, `${tag}: ${n} humans, the rest the computer's`);
      if (seats === 4) assert.match(m.sub, new RegExp(`${game === "ffa" ? "FFA" : "2V2"} · ${n} PLAYERS${cpu ? ` \\+ ${cpu} CPU` : ""}`), `${tag}: the card says the mode and the bots`);
      if (game === "2v2") assert.deepEqual(m.tanks.map((t) => t.team), [0, 1, 0, 1], `${tag}: P1 + P3 (or a bot) vs P2 + P4 (or a bot)`);
      assert.equal(s.rows.length, m.tanks.length === 4 ? 4 : n, `${tag}: a row per player (and per bot in a seat)`);
      assert.equal(s.rows.filter((r) => r[0]).length, 1, `${tag}: exactly one YOU`);
      assert.equal(s.rows.filter((r) => / · CPU$/.test(r[2])).length, m.tanks.length === 4 ? 4 - n : 0, `${tag}: the computer's seats say CPU`);
      assert.deepEqual(s.rows.map((r) => r[1]), m.tanks.slice(0, s.rows.length).map((t) => t.color), `${tag}: row colours = tank colours`);
      // Sides: a total row each, = the kills of every tank on that side (bots too).
      if (m.squad > 1) {
        assert.equal(s.sides.length, 2, `${tag}: two side totals`);
        const mine = m.tanks[s.rows.findIndex((r) => r[0])].team;
        const sum = (team) => m.tanks.filter((t) => t.team === team).reduce((a, t) => a + t.kills, 0);
        assert.equal(s.sides[0][0], "YOUR SIDE");
        assert.equal(s.sides[0][1], sum(mine), `${tag}: your side's score`);
        assert.equal(s.sides[1][1], sum(1 - mine), `${tag}: their side's score`);
      } else assert.equal(s.sides.length, 0);
    }
    said.push(`${game}${squad ? ` ${squad}V${squad}` : ""} with ${n}${cpu ? ` + ${cpu} CPU` : ""}`);
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
  console.log(`Multiplayer: the four modes through a mock room (old and new invite forms; LOBBY/START on the new one), ${runs} runs at 1440 and 390 in light and dark (${said.join("; ")}): join, the MODE pick (P1's on every screen, carried by the link), waiting seats, START NOW with the computer in the empty seats, live match with a row per player and bot in its tank colour and side totals, a player leaving (named), rejoin; no desync, no sideways scroll, card keys ≥ 44 px.`);
} catch (e) {
  console.error(`multiplayer test failed at ${where}`);
  throw e;
} finally {
  await browser.close();
  server.close();
}
