// Multiplayer on a phone (/play/multi/, game mode), through the mock room server of tests/multiplayer.mjs
// (its "new" wire: fizlet-rooms subprotocol, LOBBY, WELCOME when full). A 1V1 match between two phones,
// the device under test at 390×844 and 375×667 (portrait) and 844×390 (landscape), the other phone
// in the other orientation, so a portrait and a landscape screen play one match. Once LIVE:
// - the board covers the screen: its rect is the viewport's (±1 px), nothing scrolls;
// - the room card is a status chip ≤ 32 px tall, clear of the scoreboard, the key row, the stick,
//   the fire pad and the board's central 60%;
// - every control is ≥ 44 px and none overlap; a supply-drop toast covers no control and no HUD;
// - the drive stick shows bottom left, ≥ 44 px, and pushing it up drives your tank up the screen
//   (portrait turns the arena: up on screen is −x in the arena; landscape: −y);
// - 0 desyncs, the same frame count moving on both phones.
// Run after `npm run site:build`. SHOTS=<dir> saves a screenshot per size; ROOT=<dir> tests another
// build (LOOSE=1: screenshots only, no layout asserts, for a before/after sheet).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(process.env.ROOT ?? "artifacts/pages"), PREFIX = "/dom-battlefield-blitz", SHOTS = process.env.SHOTS, LOOSE = !!process.env.LOOSE;
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

// ---------- The mock room server (as tests/multiplayer.mjs, "new" wire only) ----------
const INPUT = 1, HASH = 2, WELCOME = 3, LEAVE = 4, LOBBY = 8, CODE = "TEST-CODE-1";
const msg = (kind, slot, players, frame, value, mode = 0) => {
  const b = Buffer.alloc(12);
  b[0] = kind, b[1] = slot, b[2] = players, b[3] = mode;
  b.writeUInt32LE(frame >>> 0, 4);
  b.writeUInt32LE(value >>> 0, 8);
  return b;
};
const rooms = new Map();
async function mockServer(context) {
  await context.route("https://rooms.test/**", (r) => {
    const req = r.request(), code = req.method() === "POST" ? req.postData() : new URL(req.url()).searchParams.get("code"), ok = code === CODE;
    return r.fulfill({ status: ok ? 200 : 403, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: ok ? '{"ok":true,"players":4}' : '{"ok":false}' });
  });
  await context.routeWebSocket(/^wss:\/\/rooms\.test\//, (ws) => {
    const u = new URL(ws.url()), players = Number(u.searchParams.get("players"));
    const protocols = u.hash.startsWith("#p=") ? JSON.parse(decodeURIComponent(u.hash.slice(3))) : [];
    if (protocols.find((p) => p.startsWith("invite."))?.slice(7) !== CODE) return ws.close({ code: 4003, reason: "invite code needed" });
    let r = rooms.get(u.pathname);
    if (!r || !r.seats.some(Boolean)) rooms.set(u.pathname, (r = { players, seats: Array(players).fill(null), started: false, seed: 4321 + rooms.size }));
    if (r.players !== players || r.started) return ws.close({ code: 4000, reason: "room full" });
    r.seats[r.seats.indexOf(null)] = ws;
    const slot = () => r.seats.indexOf(ws);
    r.seats.forEach((p, s) => p?.send(msg(LOBBY, s, r.seats.length, 0, 0, r.seats.filter(Boolean).length)));
    if (r.seats.every(Boolean)) (r.started = true), r.seats.forEach((p, s) => p.send(msg(WELCOME, s, r.seats.length, r.seed, 1 + s, 0)));
    ws.onMessage((d) => {
      if (typeof d === "string" || d.length !== 12 || !r.started || (d[0] !== INPUT && d[0] !== HASH)) return;
      const b = Buffer.from(d), me = slot();
      b[1] = me;
      r.seats.forEach((p, s) => s !== me && p?.send(b));
    });
    ws.onClose(() => {
      const me = slot();
      if (me < 0) return;
      r.seats[me] = null;
      if (r.started) r.seats.forEach((p) => p?.send(msg(LEAVE, me, r.seats.length, 0, 0)));
      if (!r.seats.some(Boolean)) r.started = false;
    });
  });
}

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
async function phone(width, height, url) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await mockServer(context);
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
  return { page, context };
}
// Rects in page px: the HUD, the key row, the stick, the round keys, the chip, a toast.
const measure = (p) =>
  p.evaluate(() => {
    const sr = document.querySelector("#arena").shadowRoot, R = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const shown = (el) => el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && el.getBoundingClientRect().width > 0;
    const named = (el, name) => (shown(el) ? { name, ...R(el) } : null);
    const controls = [
      named(document.querySelector(".game-exit"), "exit"), named(sr.querySelector(".fs"), "full screen"), named(sr.querySelector(".pz"), "pause"), named(sr.querySelector(".stk"), "stick"),
      ...[...sr.querySelectorAll(".pad .rk")].map((el) => named(el, el.dataset.k)), named(document.querySelector(".room [data-fold]"), "chip key"),
    ].filter(Boolean);
    const room = document.querySelector(".room");
    return {
      vw: innerWidth, vh: innerHeight, board: R(sr.querySelector("canvas")), stage: R(document.querySelector(".blitz-stage")),
      hud: named(sr.querySelector(".hud"), "hud"), chip: { ...R(room), folded: room.classList.contains("folded") }, controls,
      keyRow: controls.filter((c) => ["exit", "full screen", "pause"].includes(c.name)), stick: controls.find((c) => c.name === "stick") ?? null, pad: controls.filter((c) => ["fire", "long", "strike", "auto", "lock"].includes(c.name)),
      scroll: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight],
    };
  });
const hit = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
// A touch drag on the stick, through the DevTools protocol (touch → pointer events, like a phone).
async function drag(p, at, dx, dy, ms) {
  const cdp = await p.context().newCDPSession(p);
  const pt = (x, y) => [{ x, y, id: 7, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(at.x, at.y) });
  for (let k = 1; k <= 4; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(at.x + (dx * k) / 4, at.y + (dy * k) / 4) });
  await p.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const SIZES = [["390×844", 390, 844, [844, 390]], ["844×390", 844, 390, [390, 844]], ["375×667", 375, 667, [667, 375]]];
let where = "start", room = 0;
const said = [];
try {
  for (const [name, w, h, [ow, oh]] of SIZES) {
    where = name;
    const url = `${base}play/multi/?rooms=wss://rooms.test&room=${room++}&mode=1v1&code=${CODE}`;
    const me = await phone(w, h, url), other = await phone(ow, oh, url);
    await me.page.click("[data-join]");
    await me.page.waitForFunction(() => document.querySelector(".room").dataset.step === "wait");
    await other.page.click("[data-join]");
    for (const { page } of [me, other]) await page.waitForFunction(() => document.querySelector(".room").dataset.step === "play", null, { timeout: 10000 });
    const p = me.page;
    await p.waitForFunction(() => window.blitz?.state === "play" && window.blitz.world.tanks.every((t) => t.drop >= 1), null, { timeout: 20000 });
    await p.waitForTimeout(400);
    // A supply drop in the kill feed (the toast in the owner's landscape shot).
    await p.evaluate(() => (document.querySelector("#arena").shadowRoot.querySelector(".feed li").innerHTML = "📦 SUPPLY DROP · LONG AMMO"));
    if (SHOTS) await p.screenshot({ path: join(SHOTS, `${LOOSE ? "before" : "after"}-${w}x${h}.png`) });
    const m = await measure(p);
    if (!LOOSE) {
      const toast = await p.evaluate(() => { const b = document.querySelector("#arena").shadowRoot.querySelector(".feed li").getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
      // Edge to edge.
      for (const [k, v] of [["x", 0], ["y", 0], ["width", w], ["height", h]]) assert.ok(Math.abs(m.board[k] - v) <= 1, `${name}: the board covers the screen (${k} ${m.board[k]} ≠ ${v})`);
      assert.deepEqual(m.scroll.map((v) => Math.max(0, v)), [0, 0], `${name}: no page scroll`);
      assert.equal(await p.evaluate(() => (scrollBy(0, 300), scrollY)), 0, `${name}: the page doesn't scroll`);
      // The chip.
      assert.ok(m.chip.folded && m.chip.height <= 32, `${name}: LIVE, the room card is a chip ≤ 32 px (${m.chip.height})`);
      const centre = { x: w * 0.2, y: h * 0.2, width: w * 0.6, height: h * 0.6 };
      for (const o of [m.hud, ...m.keyRow, m.stick, ...m.pad, centre]) assert.ok(!hit(m.chip, o), `${name}: the chip is clear of ${o.name ?? "the board's centre"}`);
      // Controls: ≥ 44 px, no two overlapping, none on the HUD.
      for (const c of m.controls) assert.ok(c.width >= 44 && c.height >= 44, `${name}: ${c.name} ≥ 44 px (${c.width}×${c.height})`);
      for (const [i, a] of m.controls.entries()) {
        for (const b of m.controls.slice(i + 1)) assert.ok(!hit(a, b), `${name}: ${a.name} and ${b.name} don't overlap (${JSON.stringify([a, b])})`);
        assert.ok(!hit(a, m.hud), `${name}: ${a.name} is clear of the HUD`);
        assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.width <= w && a.y + a.height <= h, `${name}: ${a.name} on screen`);
      }
      // The toast.
      for (const o of [m.hud, ...m.controls]) assert.ok(!hit(toast, o), `${name}: the supply-drop toast is clear of ${o.name}`);
      // The stick: bottom left, opposite the fire pad.
      const fire = m.pad.find((c) => c.name === "fire");
      assert.ok(m.stick && m.stick.x < w / 2 && m.stick.y > h / 2 && fire.x > w / 2, `${name}: the stick bottom left, the fire pad bottom right`);
      // Push it up: your tank goes up the screen.
      const slot = await p.evaluate(() => Number(/P(\d)$/.exec(document.querySelector("[data-title]").textContent)[1]) - 1);
      const at = () => p.evaluate((s) => { const t = window.blitz.world.tanks[s]; return [t.x, t.y]; }, slot);
      const turned = h > w, a0 = await at();
      await drag(p, { x: m.stick.x + m.stick.width / 2, y: m.stick.y + m.stick.height / 2 }, 0, -60, 900);
      const a1 = await at(), dx = a1[0] - a0[0], dy = a1[1] - a0[1];
      // Screen up = arena −x (turned) or −y; a block in the way still leaves the push in the right direction.
      const up = turned ? -dx : -dy, side = Math.abs(turned ? dy : dx);
      assert.ok(up > 20 && up > side, `${name}: the stick up moves your tank up the screen (arena Δ ${dx.toFixed(0)}, ${dy.toFixed(0)})`);
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#arena").shadowRoot.querySelector(".stk i")).translate), "none", `${name}: the stick lets go`);
      // A thumb half off the stick still drives it (a 28 px margin around the pad), and the page never
      // moves under it: the stage stays put and nothing scrolls (owner: the page shifted under a drag).
      const R0 = m.stick.width / 2, off = { x: m.stick.x + R0, y: m.stick.y - 18 };
      assert.equal(await p.evaluate(({ x, y }) => document.querySelector("#arena").shadowRoot.elementFromPoint(x, y)?.className, off), "stk", `${name}: 18 px outside the stick is still the stick`);
      const b0 = await at();
      await drag(p, off, 0, -60, 700);
      const b1 = await at(), bup = turned ? b0[0] - b1[0] : b0[1] - b1[1];
      assert.ok(bup > 10, `${name}: a drag that starts beside the stick drives too (up ${bup.toFixed(0)})`);
      await drag(p, { x: w / 2, y: h / 2 }, 0, 220, 200);
      const still = await p.evaluate(() => [scrollX, scrollY, document.querySelector(".blitz-stage").getBoundingClientRect().top]);
      assert.deepEqual(still.map(Math.round), [0, 0, 0], `${name}: a swipe on the board moves neither the page nor the stage`);
      // One match on a portrait and a landscape screen.
      await p.waitForFunction(() => window.blitz.net.frame > 400, null, { timeout: 30000 });
      for (const { page } of [me, other]) assert.equal(await page.evaluate(() => window.blitz.net.desync), -1, `${name}: no desync`);
      for (const { page } of [me, other]) assert.deepEqual(page.errors, [], `${name}: no page errors`);
      said.push(`${name} (vs ${ow}×${oh}): chip ${Math.round(m.chip.width)}×${Math.round(m.chip.height)}, stick ${m.stick.width}px, up = arena ${turned ? "−x" : "−y"} ${up.toFixed(0)}`);
    }
    await me.context.close();
    await other.context.close();
  }
  console.log(LOOSE ? `Phone net: screenshots of ${root}` : `Phone net (1V1 on two phones, mock room): ${said.join("; ")}. The board covers the screen, no scroll, every control ≥ 44 px and apart, the chip and the toast clear of the HUD and the keys, 0 desyncs portrait vs landscape.`);
} catch (e) {
  console.error(`phone-net test failed at ${where}`);
  throw e;
} finally {
  await browser.close();
  server.close();
}
