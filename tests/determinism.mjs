// Blitz replays: the same seed gives the same match, frame for frame, with no Math.random in play;
// another seed gives another match, and pinned seeds still play the match they played at 0.8.2,
// value for value. Also reports heap bytes allocated per frame (no GC in between).
// Run: node tests/determinism.mjs (after npm run build).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const ORIGIN = "https://blitz.test", FRAMES = 3600; // one minute of play at 60 Hz
// Every number of every tank, shell, tile, block, plane, bomb, mark and crate, every frame for FRAMES
// frames, hashed (FNV-1a over the float64 bits). Recorded on 0.8.2 (b60931a): a change that moves any
// value by one bit fails here. Update only for an intended gameplay change, and say so in the CHANGELOG.
// Per Chrome major: V8's math differs in the last bit between versions, so a match drifts apart after
// about a second (145 is Playwright 1.58's Chromium, the one CI runs; 153 is a newer local build).
// On a version not listed the pinned check is skipped (said in the output); the replay checks still run.
const PINNED = {
  145: { "41": "5fd4738d", "42": "c6d0a59d", "7 platoons": "84efb95f" },
  153: { "41": "b42a9e47", "42": "6650d44", "7 platoons": "c546f16d" },
};
const PAGE = `<!doctype html><meta charset="utf-8"><title>replay</title><style>body{margin:0}</style>
<div id="a" style="position:relative;width:1100px;height:640px"></div><div id="b" style="position:relative;width:1100px;height:640px"></div>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return path === "/" ? route.fulfill({ contentType: "text/html", body: PAGE }) : route.fulfill({ contentType: "text/javascript", body: readFileSync(`dist${path}`) });
  });
  await page.goto(`${ORIGIN}/`);
  /** Run a demo match (every tank a bot) for `frames` fixed steps and return a digest of the world. */
  const play = (seed, frames) =>
    page.evaluate(async ([seed, frames]) => {
      const { createBlitz } = await import("/blitz.mjs");
      for (const id of ["a", "b"]) document.getElementById(id).replaceChildren();
      const host = document.getElementById(seed % 2 ? "a" : "b");
      const g = createBlitz(host, { demo: true, seed });
      g.engine.stop(); // step by hand: the shared clock must not add frames
      let calls = 0;
      const real = Math.random;
      Math.random = () => (calls++, real());
      const digest = [];
      for (let f = 1; f <= frames; f++) {
        g.engine.advance(1 / 60);
        if (f % 600 === 0) {
          const w = g.world;
          digest.push(w.tanks.map((t) => [t.alive, Math.round(t.x * 100), Math.round(t.y * 100), Math.round(t.a * 1000), t.hp, t.kills, t.deaths].join(",")).join("|"),
            w.shells.filter((s) => s.on).length, w.crates.map((c) => [c.kind, Math.round(c.x), Math.round(c.y), c.landed].join(",")).join("|"));
        }
      }
      Math.random = real;
      g.destroy();
      return { digest: digest.join("\n"), calls };
    }, [seed, frames]);
  /** The exact digest of a demo match (see PINNED). */
  const exact = (seed, platoons) =>
    page.evaluate(async ([seed, platoons, frames]) => {
      const { createBlitz } = await import("/blitz.mjs");
      for (const id of ["a", "b"]) document.getElementById(id).replaceChildren();
      const g = createBlitz(document.getElementById("a"), { demo: true, seed, platoons });
      g.engine.stop();
      let h = 0x811c9dc5;
      const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
      const mix = (v) => {
        if (typeof v === "boolean") v = v ? 1 : 0;
        if (typeof v !== "number") return;
        f64[0] = v;
        h = Math.imul(h ^ u32[0], 16777619) >>> 0;
        h = Math.imul(h ^ u32[1], 16777619) >>> 0;
      };
      for (let f = 1; f <= frames; f++) {
        g.engine.advance(1 / 60);
        const w = g.world;
        for (const list of [w.tanks, w.shells, w.tiles, w.blocks, w.planes, w.bombs, w.marks, w.crates]) for (const o of list) for (const k in o) mix(o[k]);
      }
      g.destroy();
      return h.toString(16);
    }, [seed, platoons, FRAMES]);
  const major = Number(browser.version().split(".")[0]), pinned = PINNED[major];
  for (const [name, want] of Object.entries(pinned ?? {})) {
    const [seed, mode] = name.split(" ");
    assert.equal(await exact(Number(seed), mode === "platoons"), want, `seed ${name} plays the 0.8.2 match, value for value (Chrome ${major})`);
  }

  const a = await play(41, FRAMES), b = await play(41, FRAMES), c = await play(42, FRAMES);
  assert.equal(a.calls, 0, "no Math.random while playing");
  assert.equal(a.digest, b.digest, "same seed, same match");
  assert.notEqual(a.digest, c.digest, "another seed, another match");
  assert.ok(a.digest.split("\n").some((l) => /\d+,\d+,\d+,(true|false)/.test(l)), "crates dropped and were tracked in the digest");

  // Allocation: heap growth per frame over 600 frames with no GC in between (median of 3).
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(async () => {
    const { createBlitz } = await import("/blitz.mjs");
    window.g = createBlitz(document.getElementById("a"), { demo: true, seed: 7 });
    window.g.engine.stop();
    for (let f = 0; f < 1200; f++) window.g.engine.advance(1 / 60); // warm up
  });
  const perFrame = [];
  for (let r = 0; r < 3; r++) {
    await cdp.send("HeapProfiler.collectGarbage");
    const before = (await cdp.send("Runtime.getHeapUsage")).usedSize;
    await page.evaluate(() => { for (let f = 0; f < 600; f++) window.g.engine.advance(1 / 60); });
    const after = (await cdp.send("Runtime.getHeapUsage")).usedSize;
    perFrame.push(Math.max(0, after - before) / 600);
  }
  perFrame.sort((x, y) => x - y);
  assert.deepEqual(errors, []);
  console.log(`Blitz determinism: ${pinned ? `seeds ${Object.keys(pinned).join(", ")} play the 0.8.2 matches value for value (Chrome ${major})` : `no pinned digests for Chrome ${major} (pinned: ${Object.keys(PINNED).join(", ")}), skipped`}; seed 41 twice → identical over ${FRAMES} frames, seed 42 differs, 0 Math.random calls in play. Heap growth: ${Math.round(perFrame[1])} B/frame (median of 3 × 600 frames, demo, no GC between).`);
} finally {
  await browser.close();
}
