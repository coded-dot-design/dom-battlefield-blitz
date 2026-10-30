// The zero-allocation check for Blitz's step, in its own file (run it alone: npm test runs files one at a time).
// A busy demo match (every tank a bot, shells, strikes and crates in play) is warmed up, then 20,000 fixed
// steps run with no read or render (world.steps) while V8's minor GCs are counted. Needs npm run build.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { minorGCs } from "./gc.mjs";

const ORIGIN = "https://blitz.test", STEPS = 20000;
const PAGE = `<!doctype html><meta charset="utf-8"><title>gc</title><style>body{margin:0}</style>
<div id="a" style="position:relative;width:1100px;height:640px"></div>`;

// Blitz's step is not on typed arrays yet: its tanks and shells are objects, and the number arguments
// it passes to the collide and fx bricks box (fizlet-engine lesson K4). Measured at 0.8.3: about 10
// minor GCs in 20,000 busy steps. The check turns on with the E3 port of the step.
const TODO = "Blitz's step allocates until its E3 port (typed arrays, hot-path brick forms): ~10 minor GCs / 20,000 steps at 0.8.3";

test("a busy match steps without allocating (minor GC ≤ 1 in 20 000 steps)", { todo: TODO }, async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      return path === "/" ? route.fulfill({ contentType: "text/html", body: PAGE }) : route.fulfill({ contentType: "text/javascript", body: readFileSync(`dist${path}`) });
    });
    await page.goto(`${ORIGIN}/`);
    const busy = await page.evaluate(async () => {
      const { createBlitz } = await import("/blitz.mjs");
      const g = (window.g = createBlitz(document.getElementById("a"), { demo: true, seed: 7 }));
      g.engine.stop(); // step by hand
      g.world.steps(6000); // warm up: the JIT, every pool, a few strikes and crates
      return { tanks: g.world.tanks.filter((t) => t.alive).length, shells: g.world.shells.filter((s) => s.on).length };
    });
    assert.ok(busy.tanks >= 4, `the match is busy (${busy.tanks} tanks alive)`);
    const gcs = await minorGCs(page, (n) => window.g.world.steps(n), STEPS);
    assert.ok(gcs <= 1, `${gcs} minor GCs in ${STEPS} steps`);
  } finally {
    await browser.close();
  }
});
