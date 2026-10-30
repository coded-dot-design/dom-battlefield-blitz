// Blitz net play through a real room server: two peers in Chromium join one fizlet-rooms room over
// WebSockets (with an invite code), play in lockstep and must end with the same match.
// Needs a running room server (fizlet's rooms/: `npm run dev`, or the e2e setup) and:
//   ROOMS_URL=ws://127.0.0.1:8799  ROOMS_INVITE=<a code on the list>  node tests/room.mjs
// Without ROOMS_URL it says so and skips (CI has no room server).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const URL_ = process.env.ROOMS_URL, INVITE = process.env.ROOMS_INVITE ?? "", FRAMES = Number(process.env.FRAMES ?? 1800);
if (!URL_) {
  console.log("Blitz room test skipped: set ROOMS_URL (and ROOMS_INVITE) to a running fizlet-rooms server.");
  process.exit(0);
}
// A loopback http origin: a local room server (ws://127.0.0.1) is then reachable from the page.
const ORIGIN = "http://127.0.0.1:8797";
const PAGE = `<!doctype html><meta charset="utf-8"><title>room</title><style>body{margin:0}</style>
<div id="a" style="position:relative;width:1100px;height:640px"></div><div id="b" style="position:relative;width:800px;height:500px"></div>`;

// Local test only: a Playwright-served page counts as public, and Chromium's Local Network Access
// check would block its ws:// to a room server on 127.0.0.1. (A deployed room is a public wss:// host.)
const args = ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests"];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args } : { args });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (process.env.DEBUG) page.on("console", (m) => console.log("console:", m.text()));
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return path === "/" ? route.fulfill({ contentType: "text/html", body: PAGE }) : route.fulfill({ contentType: "text/javascript", body: readFileSync(`dist${path}`) });
  });
  await page.goto(`${ORIGIN}/`);
  const room = Math.floor(Math.random() * 4);
  const out = await page.evaluate(async ({ base, invite, frames, room }) => {
    const { createBlitz, join } = await import("/blitz-net.mjs");
    const url = `${base}/room/${room}?players=2&invite=${encodeURIComponent(invite)}`;
    const seats = await Promise.all([join(url), join(url)]);
    const hands = (slot) => {
      let s = 2000 + slot * 31;
      const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
      return () => ((r() * 3) | 0) | (((r() * 3) | 0) << 2) | (r() < 0.35 ? 16 : 0) | (r() < 0.01 ? 32 : 0) | (((r() * 3) | 0) << 7) | ((((r() * 256) | 0) << 16) | (((r() * 256) | 0) << 24)) >>> 0;
    };
    const peers = seats.map(({ transport, slot, players, seed }) =>
      createBlitz(document.getElementById(slot ? "b" : "a"), { seed, seconds: 600, bots: 4, net: { transport, slot, players, input: hands(slot) } }),
    );
    for (const g of peers) g.engine.stop();
    const at = [[], []];
    const t0 = performance.now();
    // About 60 frames a second, like a real tab (the room rate-limits floods).
    while (peers.some((g) => g.net.frame < frames) && performance.now() - t0 < 120000) {
      peers.forEach((g, i) => {
        if (g.net.frame >= frames) return;
        const f = g.net.frame;
        g.engine.advance(1 / 60);
        if (g.net.frame !== f && g.net.frame % 300 === 0) at[i].push(g.hash());
      });
      await new Promise((r) => setTimeout(r, 16));
    }
    const r = { seeds: seats.map((s) => s.seed), slots: seats.map((s) => s.slot), frames: peers.map((g) => g.net.frame), desync: peers.map((g) => g.net.desync), stalls: peers.map((g) => g.net.stalls), at, final: peers.map((g) => g.hash()), ms: performance.now() - t0, kills: peers[0].world.tanks.reduce((a, t) => a + t.kills, 0) };
    peers.forEach((g) => g.destroy());
    return r;
  }, { base: URL_, invite: INVITE, frames: FRAMES, room });
  assert.equal(out.seeds[0], out.seeds[1], "one seed from the room");
  assert.deepEqual(out.slots.sort(), [0, 1]);
  assert.deepEqual(out.frames, [FRAMES, FRAMES], `frames ${out.frames}`);
  assert.equal(out.at[0].length, FRAMES / 300);
  assert.deepEqual(out.at[0], out.at[1], "same match hash every 300 frames");
  assert.equal(out.final[0], out.final[1]);
  assert.deepEqual(out.desync, [-1, -1]);
  assert.deepEqual(errors, []);
  console.log(`Blitz room: 2 peers through ${URL_} (room ${room}), ${FRAMES} frames in ${(out.ms / 1000).toFixed(1)} s, identical every 300 frames and at the end; ${out.kills} kills; stalls ${out.stalls.join("/")}; 0 desyncs.`);
} finally {
  await browser.close();
}
