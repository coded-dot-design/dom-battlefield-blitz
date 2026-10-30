// Keyboard-only play: start, drive, aim, fire, long shot, airstrike (F then Enter), pause / resume,
// surrender, rematch / new game, all with no pointer; focus is visible, lands somewhere sensible when
// overlays open and close, and Tab always leads out of the game (no trap). Needs npm run build.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const ORIGIN = "https://blitz.test";
const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><title>keys</title><style>body{margin:0}</style>
<main><a href="#before" id="before">before</a><div id="a" style="position:relative;width:1100px;height:640px"></div><a href="#after" id="after">after</a></main>`;

test("Blitz plays with the keyboard alone", async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      return path === "/" ? route.fulfill({ contentType: "text/html", body: PAGE }) : route.fulfill({ contentType: "text/javascript", body: readFileSync(`dist${path}`) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(async () => {
      const { createBlitz } = await import("/blitz.mjs");
      localStorage.removeItem("blitz:mode");
      window.g = createBlitz(document.getElementById("a"), { seed: 11, seconds: 60 });
      window.g.sound = false;
    });
    await page.waitForTimeout(1300); // the start key pops in
    const g = (f) => page.evaluate(f);
    /** What has focus (inside the game's shadow root too), and does it show a focus ring? */
    const focused = () => page.evaluate(() => {
      let el = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      if (!el || el === document.body) return { name: "body" };
      const cs = getComputedStyle(el);
      return { name: el.getAttribute("aria-label") || el.textContent.trim() || el.tagName, tag: el.tagName, ring: cs.boxShadow !== "none" || cs.outlineStyle !== "none" };
    });
    const tabTo = async (re, max = 25) => {
      for (let i = 0; i < max; i++) {
        await page.keyboard.press("Tab");
        const f = await focused();
        if (re.test(f.name)) return f;
      }
      assert.fail(`Tab never reached ${re}`);
    };

    // Start: Tab in from the page, pick a mode, PRESS START.
    await page.focus("#before");
    const solo = await tabTo(/SOLO/);
    assert.ok(solo.ring, "a mode key shows its focus");
    await page.keyboard.press("Enter");
    const start = await tabTo(/start/i);
    assert.ok(start.ring, "PRESS START shows its focus");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.g.state === "count", null, { timeout: 5000 });
    let f = await focused();
    assert.equal(f.tag, "CANVAS", "when the start key goes, focus moves to the arena");
    assert.ok(f.ring, "the arena shows its focus");
    assert.match(f.name, /Space fires/, "the arena's name lists the keys");
    await page.waitForFunction(() => window.g.state === "play", null, { timeout: 10000 });
    await page.waitForFunction(() => window.g.world.tanks[0].alive && window.g.world.tanks[0].drop >= 1, null, { timeout: 10000 });

    // Drive, aim (Q auto, T lock), fire, long shot, airstrike: all keys.
    const x0 = await g(() => window.g.world.tanks[0].x);
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(500);
    await page.keyboard.up("ArrowRight");
    assert.notEqual(await g(() => window.g.world.tanks[0].x), x0, "arrows drive");
    const auto = await g(() => window.g.controls.auto);
    await page.keyboard.press("q");
    await page.waitForFunction((a) => window.g.controls.auto === !a, auto, { timeout: 2000 }); // Q toggles auto-aim
    await page.keyboard.press("t");
    await page.waitForFunction(() => window.g.controls.lock, null, { timeout: 2000 }); // T turns aim lock on
    await page.keyboard.down("Space");
    await page.waitForFunction(() => window.g.world.shells.some((s) => s.on && s.owner === 0), null, { timeout: 3000 });
    await page.keyboard.up("Space");
    assert.equal(await g(() => window.g.state), "play", "Space fires and presses no key");
    const rail = await g(() => window.g.world.tanks[0].rail);
    await page.keyboard.press("e");
    await page.waitForFunction((r) => window.g.world.tanks[0].rail < r || window.g.world.tanks[0].charge > 0, rail, { timeout: 3000 });
    await page.waitForFunction(() => window.g.world.tanks[0].alive && window.g.world.tanks[0].drop >= 1 && window.g.world.tanks[0].strikes > 0, null, { timeout: 10000 });
    await page.keyboard.press("f");
    await page.waitForFunction(() => window.g.controls.targeting, null, { timeout: 2000 });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !window.g.controls.targeting && window.g.world.planes.some((p) => p.on), null, { timeout: 3000 });
    // F then Esc cancels.
    await page.evaluate(() => (window.g.world.tanks[0].strikes = 1));
    await page.keyboard.press("f");
    await page.waitForFunction(() => window.g.controls.targeting, null, { timeout: 2000 });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !window.g.controls.targeting, null, { timeout: 2000 });
    assert.equal(await g(() => window.g.state), "play", "Esc cancels the airstrike first");

    // Pause / resume: focus goes into the overlay and back to the arena.
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.g.state === "paused");
    await page.waitForTimeout(100);
    f = await focused();
    assert.match(f.name, /KEEP FIGHTING/, "pause focuses KEEP FIGHTING");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.g.state === "play");
    assert.equal((await focused()).tag, "CANVAS", "resume puts focus back on the arena");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.g.state === "paused");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.g.state === "play");
    assert.equal((await focused()).tag, "CANVAS", "Esc resumes too, focus on the arena");

    // Tab leads out of the game: no trap.
    const seen = [];
    for (let i = 0; i < 20 && !seen.includes("after"); i++) {
      await page.keyboard.press("Tab");
      seen.push((await focused()).name);
    }
    assert.ok(seen.includes("after"), `Tab leaves the game: ${seen.join(" → ")}`);
    for (const k of seen.slice(0, -1)) assert.notEqual(k, "body", "every stop on the way is a visible key");

    // Surrender → result → NEW GAME → start screen, all by keys.
    await page.evaluate(() => document.getElementById("a").shadowRoot.querySelector("canvas").focus());
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.g.state === "paused");
    await tabTo(/SURRENDER/, 3);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.g.state === "end", null, { timeout: 5000 });
    await page.waitForTimeout(100);
    assert.match((await focused()).name, /REMATCH/, "the result focuses REMATCH");
    await tabTo(/NEW GAME/, 3);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.g.state === "intro");
    await page.waitForTimeout(100);
    assert.match((await focused()).name, /start/i, "NEW GAME focuses PRESS START");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
