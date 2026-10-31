// Pause in Chromium (dist build): one key (PAUSE, Esc, P), the tab going away, a held board, RESUME
// after a countdown, RESTART and QUIT TO MENU; net play pauses every screen on the same lockstep
// frame ("P2 PAUSED"), resumes everyone after the same countdown and caps each seat's pause.
// Run: node tests/pause.mjs (after npm run build).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const ORIGIN = "https://blitz.test";
const PAGE = `<!doctype html><meta charset="utf-8"><title>pause</title><style>body{margin:0}</style>
<div id="a" style="position:relative;width:1100px;height:640px"></div><div id="b" style="position:relative;width:700px;height:460px"></div>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let where = "start";
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return path === "/" ? route.fulfill({ contentType: "text/html", body: PAGE }) : route.fulfill({ contentType: "text/javascript", body: readFileSync(`dist${path}`) });
  });
  await page.goto(`${ORIGIN}/`);
  const ov = () => page.evaluate(() => document.getElementById("a").shadowRoot.querySelector("[data-ov]").textContent);
  const count = () => page.evaluate(() => { const o = document.getElementById("a").shadowRoot.querySelector("[data-over]"); return o.hidden ? "" : o.textContent; });
  // The board: every tank, the clock, the shells and crates (a pause must hold all of it).
  const board = () => page.evaluate(() => JSON.stringify([g.world.tanks.map((t) => [t.x, t.y, t.a, t.hp, t.alive, t.drop]), g.world.shells.filter((s) => s.on).map((s) => [s.x, s.y]), g.world.crates.map((c) => [c.x, c.y]), document.getElementById("a").shadowRoot.querySelector("[data-t]").textContent]));

  where = "solo: keys";
  await page.evaluate(async () => {
    const { createBlitz } = await import("/blitz.mjs");
    window.g = createBlitz(document.getElementById("a"), { mode: "board", seconds: 120, seed: 4 });
    g.start();
  });
  await page.waitForFunction(() => g.state === "play" && g.world.tanks.filter((t) => t.alive && t.drop >= 1).length >= 6, null, { timeout: 8000 });
  await page.evaluate(() => g.controls.crate());
  await page.waitForTimeout(300);
  await page.mouse.move(500, 300);
  for (const key of ["KeyP", "Escape"]) {
    await page.keyboard.press(key);
    await page.waitForFunction(() => g.state === "paused", null, { timeout: 1000 });
    assert.match(await ov(), /PAUSED.*RESUME.*RESTART.*QUIT TO MENU.*SURRENDER.*BY CHRIS COOLEY/s, `${key} pauses: the overlay`);
    const held = await board();
    await page.waitForTimeout(700);
    assert.equal(await board(), held, `${key}: the board holds still while paused (tanks, shells, crates, clock)`);
    // The same key resumes, after a 3-2-1 over the held board.
    await page.keyboard.press(key);
    await page.waitForFunction(() => g.state === "play", null, { timeout: 1000 });
    assert.equal(await count(), "3", "resume counts down first");
    await page.waitForTimeout(600);
    assert.equal(await board(), held, "and the board still holds during the countdown");
    await page.waitForFunction(() => !document.getElementById("a").shadowRoot.querySelector("[data-over] [data-c]"), null, { timeout: 4000 });
    await page.waitForTimeout(300);
    assert.notEqual(await board(), held, "then the match goes on");
  }

  where = "solo: tab hidden";
  // The tab hidden (or the phone locked): the game pauses itself, and stays paused when it's back.
  const hide = (hidden) => page.evaluate((hidden) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await hide(true);
  assert.equal(await page.evaluate(() => g.state), "paused", "a hidden tab pauses");
  await hide(false);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => g.state), "paused", "and it waits for you");
  assert.match(await ov(), /RESUME/);
  // The menu carries what the hidden footer did on a phone: the byline, PRIVACY, and COOKIE SETTINGS
  // only when the page has a consent pattern (it gets a composed "consent:open").
  assert.equal(await page.evaluate(() => document.getElementById("a").shadowRoot.querySelector("[data-ov] .by a").href), "https://domvirus.com/legal/privacy/");
  assert.equal(await page.evaluate(() => !!document.getElementById("a").shadowRoot.querySelector("[data-consent]")), false, "no COOKIE SETTINGS without a consent pattern");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => g.state === "play");
  await page.evaluate(() => (document.documentElement.dataset.consent = "", document.addEventListener("consent:open", () => (window.consentOpened = true))));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => g.state === "paused");
  await page.evaluate(() => document.getElementById("a").shadowRoot.querySelector("[data-consent]").click());
  assert.equal(await page.evaluate(() => window.consentOpened), true, "COOKIE SETTINGS asks the page's consent pattern");

  where = "solo: restart, quit to menu";
  await page.evaluate(() => document.getElementById("a").shadowRoot.querySelector("[data-restart]").click());
  assert.equal(await page.evaluate(() => g.state), "count", "RESTART: a new match, from the countdown");
  assert.equal(await page.evaluate(() => document.getElementById("a").shadowRoot.querySelector("[data-ov]").hidden), true);
  await page.waitForFunction(() => g.state === "play", null, { timeout: 5000 });
  assert.match(await page.evaluate(() => document.getElementById("a").shadowRoot.querySelector("[data-t]").textContent), /^(2:00|1:59)$/, "the clock starts over");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => g.state === "paused");
  await page.evaluate(() => document.getElementById("a").shadowRoot.querySelector("[data-menu]").click());
  assert.equal(await page.evaluate(() => g.state), "intro", "QUIT TO MENU: the start screen (modes)");
  assert.match(await page.evaluate(() => document.getElementById("a").shadowRoot.querySelector("[data-over]").textContent), /SOLO.*PLATOON.*PRACTICE/s);
  await page.evaluate(() => g.destroy());

  where = "net";
  /** Two peers in lockstep, stepped by hand. `hold`: [seat, from, to] input calls with the pause bit (bit 12). */
  const net = (opts) =>
    page.evaluate(async ({ frames, hold, hideAt }) => {
      const { createBlitz, memory } = await import("/blitz-net.mjs");
      for (const id of ["a", "b"]) document.getElementById(id).replaceChildren();
      const hub = memory({ peers: 2, latency: 2, jitter: 1, seed: 5 });
      const hands = (slot) => {
        let s = 1000 + slot * 77, n = 0;
        const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
        return () => {
          n++;
          let b = ((r() * 3) | 0) | (((r() * 3) | 0) << 2) | (((r() * 3) | 0) << 7);
          if (r() < 0.35) b |= 16;
          if (hold && hold[0] === slot && n >= hold[1] && n < hold[2]) b |= 1 << 12;
          return (b | (((r() * 256) | 0) << 16) | (((r() * 256) | 0) << 24)) >>> 0;
        };
      };
      const peers = [0, 1].map((slot) => createBlitz(document.getElementById(slot ? "b" : "a"), { seed: 21, seconds: 600, bots: 4, net: { transport: hub.ends[slot], slot, players: 2, input: hands(slot) } }));
      for (const p of peers) p.engine.stop();
      const states = [[], []], texts = [new Set(), new Set()];
      for (let tick = 0; peers.some((p) => p.net.frame < frames) && tick < frames * 8; tick++) {
        hub.tick();
        if (tick === hideAt) {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
          document.dispatchEvent(new Event("visibilitychange"));
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        }
        peers.forEach((p, i) => {
          if (p.net.frame >= frames) return;
          const f = p.net.frame;
          p.engine.advance(1 / 60);
          if (p.net.frame !== f) {
            states[i][f] = p.state;
            const o = p === peers[0] ? document.getElementById("a") : document.getElementById("b");
            const v = o.shadowRoot.querySelector("[data-ov]");
            if (!v.hidden) texts[i].add(v.textContent.replace(/\d+ S OF PAUSE LEFT/, "N S OF PAUSE LEFT"));
          }
        });
      }
      const span = (st) => { const a = st.indexOf("paused"), b = st.lastIndexOf("paused"); return a < 0 ? null : [a, b, st.filter((s) => s === "paused").length]; };
      const out = { frames: peers.map((p) => p.net.frame), desync: peers.map((p) => p.net.desync), hash: peers.map((p) => p.hash()), spans: states.map(span), texts: texts.map((t) => [...t]), same: states[0].join() === states[1].join() };
      peers.forEach((p) => p.destroy());
      return out;
    }, opts);

  // P2 holds pause for 300 frames (5 s): both screens pause on the same frames, P1 sees "P2 PAUSED".
  const short = await net({ frames: 1200, hold: [1, 400, 700] });
  assert.deepEqual(short.desync, [-1, -1], "no desync through a pause");
  assert.equal(short.hash[0], short.hash[1]);
  assert.ok(short.same, "both peers: the same state every frame (paused on the same frames)");
  assert.ok(short.spans[0] && Math.abs(short.spans[0][2] - 300) <= 2, `paused ~300 frames: ${JSON.stringify(short.spans[0])}`);
  assert.ok(short.texts[0].some((t) => /P2 PAUSED.*LEAVE ROOM|P2 PAUSED.*P2 HAS N S OF PAUSE LEFT/s.test(t)), `P1 sees who paused: ${short.texts[0]}`);
  assert.ok(short.texts[1].some((t) => /YOU PAUSED.*RESUME.*YOU HAVE N S OF PAUSE LEFT/s.test(t)), `P2 sees RESUME: ${short.texts[1]}`);
  // P2 holds pause for 60 s: the cap (45 s a seat) resumes everyone; still the same match.
  const capped = await net({ frames: 3600 + 600, hold: [1, 300, 300 + 3600] });
  assert.deepEqual(capped.desync, [-1, -1]);
  assert.ok(capped.same);
  assert.ok(Math.abs(capped.spans[0][2] - 45 * 60) <= 2, `the cap: ${capped.spans[0][2]} paused frames (45 s)`);
  // A tab going hidden sends its pause before its frames stop (both peers here share one document).
  const hidden = await net({ frames: 600, hideAt: 200 });
  assert.ok(hidden.spans[0] && hidden.spans[0][0] > 150 && hidden.same, `a hidden tab pauses the match for everyone: ${JSON.stringify(hidden.spans[0])}`);
  assert.deepEqual(hidden.desync, [-1, -1]);

  assert.deepEqual(errors, []);
  console.log(
    `Blitz pause: P and Escape pause and resume (the board holds: tanks, shells, crates, clock; RESUME counts 3-2-1 first), a hidden tab pauses, RESTART and QUIT TO MENU; ` +
      `net: P2's pause stops both screens on the same ${short.spans[0][2]} frames ("P2 PAUSED" on P1, RESUME on P2), the 45 s cap resumes everyone (${capped.spans[0][2]} frames), a hidden tab sends its pause; 0 desyncs.`,
  );
} catch (err) {
  console.error(`Blitz pause test failed at: ${where}`);
  throw err;
} finally {
  await browser.close();
}
