// Blitz net play: two peers in lockstep over the in-memory link stay identical, frame for frame.
// Each peer has its own screen size and only its own player's input (a scripted stream of
// drives, shots, long shots, airstrikes and aim modes); the match must still be the same match.
// Run: node tests/lockstep.mjs (after npm run build).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const ORIGIN = "https://blitz.test", FRAMES = Number(process.env.FRAMES ?? 3600);
const PAGE = `<!doctype html><meta charset="utf-8"><title>lockstep</title><style>body{margin:0}</style>
<div id="a" style="position:relative;width:1100px;height:640px"></div><div id="b" style="position:relative;width:700px;height:460px"></div>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return path === "/" ? route.fulfill({ contentType: "text/html", body: PAGE }) : route.fulfill({ contentType: "text/javascript", body: readFileSync(`dist${path}`) });
  });
  await page.goto(`${ORIGIN}/`);

  /** Two peers, `frames` lockstep frames, a digest of each world every 600 frames. */
  const run = (opts) =>
    page.evaluate(async ({ frames, latency, jitter, seed, scripted }) => {
      const { createBlitz, memory } = await import("/blitz.mjs");
      for (const id of ["a", "b"]) document.getElementById(id).replaceChildren();
      const hub = memory({ peers: 2, latency, jitter, seed: 5 });
      let calls = 0;
      const real = Math.random;
      // Scripted hands: each peer's own seeded stream (only that peer knows it).
      const hands = (slot) => {
        let s = 1000 + slot * 77;
        const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
        return () => {
          const mx = (r() * 3) | 0, my = (r() * 3) | 0, aim = (r() * 3) | 0;
          let b = mx | (my << 2) | (aim << 7);
          if (r() < 0.35) b |= 16;
          if (r() < 0.01) b |= 32;
          if (r() < 0.005) b |= 64;
          return (b | (((r() * 256) | 0) << 16) | (((r() * 256) | 0) << 24)) >>> 0;
        };
      };
      const peers = [0, 1].map((slot) =>
        createBlitz(document.getElementById(slot ? "b" : "a"), { seed, seconds: 600, bots: 4, net: { transport: hub.ends[slot], slot, players: 2, ...(scripted ? { input: hands(slot) } : {}) } }),
      );
      for (const g of peers) g.engine.stop(); // step by hand: the shared clock must not add frames
      Math.random = () => (calls++, real());
      const digests = [[], []];
      const snap = (g) => {
        const w = g.world;
        return w.tanks.map((t) => [t.alive, Math.round(t.x * 100), Math.round(t.y * 100), Math.round(t.ta * 1000), t.hp, t.kills, t.deaths, t.rail, t.strikes].join(",")).join("|") + "#" + w.shells.filter((s) => s.on).length + "#" + g.hash();
      };
      let ticks = 0;
      while (peers.some((g) => g.net.frame < frames) && ticks < frames * 8) {
        hub.tick();
        ticks++;
        peers.forEach((g, i) => {
          if (g.net.frame >= frames) return;
          const before = g.net.frame;
          g.engine.advance(1 / 60);
          if (g.net.frame !== before && g.net.frame % 600 === 0) digests[i].push(snap(g));
        });
      }
      Math.random = real;
      const out = {
        frames: peers.map((g) => g.net.frame), stalls: peers.map((g) => g.net.stalls), desync: peers.map((g) => g.net.desync),
        digests, calls, final: peers.map((g) => g.hash()),
        kills: peers[0].world.tanks.reduce((a, t) => a + t.kills, 0), humanShots: peers[0].world.tanks.slice(0, 2).map((t) => t.rail + "/" + t.strikes),
      };
      peers.forEach((g) => g.destroy());
      return out;
    }, opts);

  const fast = await run({ frames: FRAMES, latency: 0, jitter: 0, seed: 41, scripted: true });
  assert.deepEqual(fast.frames, [FRAMES, FRAMES]);
  assert.equal(fast.digests[0].length, FRAMES / 600);
  assert.deepEqual(fast.digests[0], fast.digests[1], "both peers: the same match every 600 frames");
  assert.equal(fast.final[0], fast.final[1], "the same state hash at the end");
  assert.deepEqual(fast.desync, [-1, -1], "no hash check ever differed");
  assert.equal(fast.calls, 0, "no Math.random in the match");
  assert.ok(fast.kills > 0, "tanks fought (the match isn't idle)");

  const slow = await run({ frames: FRAMES, latency: 6, jitter: 5, seed: 41, scripted: true });
  assert.deepEqual(slow.frames, [FRAMES, FRAMES]);
  assert.ok(slow.stalls[0] > 0 && slow.stalls[1] > 0, "a link slower than the input delay makes both wait");
  assert.deepEqual(slow.digests[0], slow.digests[1], "delayed, jittered, reordered inputs: still the same match");
  assert.deepEqual(slow.digests[0], fast.digests[0], "and the same match as with no latency at all");
  assert.deepEqual(slow.desync, [-1, -1]);

  // The real controls path (encode → word → human): no scripted input, keys held on the page.
  await page.keyboard.down("KeyD");
  const keys = await run({ frames: 900, latency: 2, jitter: 1, seed: 9, scripted: false });
  await page.keyboard.up("KeyD");
  assert.deepEqual(keys.frames, [900, 900]);
  assert.equal(keys.final[0], keys.final[1]);
  assert.deepEqual(keys.desync, [-1, -1]);

  assert.deepEqual(errors, []);
  console.log(
    `Blitz lockstep: 2 peers (1100×640 and 700×460 screens), ${FRAMES} frames identical every 600 frames and at the end; ` +
      `latency 6±5 ticks too (stalls ${slow.stalls.join("/")}), same match as no latency; ${fast.kills} kills; 0 desyncs; 0 Math.random in play.`,
  );
} finally {
  await browser.close();
}
