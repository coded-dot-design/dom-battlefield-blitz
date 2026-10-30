// The zero-allocation check for Blitz's step, in its own file (run it alone: npm test runs files one at a time).
// A busy demo match (every tank a bot, shells, strikes and crates in play) is warmed up, then 20,000 fixed
// steps run with no read or render (world.steps) while V8's minor GCs are counted: free-for-all and platoons.
// Needs npm run build.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { minorGCs } from "./gc.mjs";

const ORIGIN = "https://blitz.test", STEPS = 20000;
const PAGE = `<!doctype html><meta charset="utf-8"><title>gc</title><style>body{margin:0}</style>
<div id="a" style="position:relative;width:1100px;height:640px"></div>`;

test("a busy match steps without allocating (minor GC ≤ 1 in 20 000 steps)", async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      return path === "/" ? route.fulfill({ contentType: "text/html", body: PAGE }) : route.fulfill({ contentType: "text/javascript", body: readFileSync(`dist${path}`) });
    });
    await page.goto(`${ORIGIN}/`);
    for (const [seed, platoons] of [[7, false], [8, true]]) {
      const busy = await page.evaluate(async ([seed, platoons]) => {
        const { createBlitz } = await import("/blitz.mjs");
        window.g?.destroy();
        const g = (window.g = createBlitz(document.getElementById("a"), { demo: true, seed, platoons }));
        g.engine.stop(); // step by hand
        g.world.steps(6000); // warm up: the JIT, every pool, a few strikes and crates
        return g.world.tanks.filter((t) => t.alive).length;
      }, [seed, platoons]);
      assert.ok(busy >= 4, `the match is busy (${busy} tanks alive)`);
      const gcs = await minorGCs(page, (n) => window.g.world.steps(n), STEPS), what = `${platoons ? "platoons" : "free for all"}: ${gcs} minor GCs in ${STEPS} steps (Chrome ${browser.version()})`;
      if (process.env.GITHUB_ACTIONS) console.log(`::${gcs <= 1 ? "notice" : "error"} title=zero-gc::${what}`); // CI logs show the count
      assert.ok(gcs <= 1, what);
    }
  } catch (err) {
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=zero-gc::${String(err?.message ?? err).split("\n")[0]}`);
    throw err;
  } finally {
    await browser.close();
  }
});
