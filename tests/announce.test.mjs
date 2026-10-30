// Screen-reader announcements (src/announce.ts, the fizlet/announce contract) and Blitz's use of
// them: one polite region per document, coalesced and rate-limited; a match says your kills, armour
// and the result through it. Needs npm run build (the game part loads dist/blitz.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

const ORIGIN = "https://blitz.test";
const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><title>announce</title><style>body{margin:0}</style>
<main><div id="a" style="position:relative;width:1100px;height:640px"></div></main>`;
const announce = (await build({ entryPoints: ["src/announce.ts"], bundle: true, format: "esm", write: false })).outputFiles[0].text;

async function open() {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: PAGE });
    if (path === "/announce.mjs") return route.fulfill({ contentType: "text/javascript", body: announce });
    return route.fulfill({ contentType: "text/javascript", body: readFileSync(`dist${path}`) });
  });
  await page.goto(`${ORIGIN}/`);
  // Every write to the region, with its time.
  await page.evaluate(() => {
    window.writes = [];
    new MutationObserver(() => {
      const r = document.querySelector("[data-fz-announce]");
      if (r && r.textContent !== window.writes.at(-1)?.text) window.writes.push({ text: r.textContent, t: performance.now() });
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  return { browser, page };
}

test("announcer: one polite region, coalesced, rate-limited, re-announces, cleans up", async () => {
  const { browser, page } = await open();
  try {
    const r = await page.evaluate(async () => {
      const { announcer } = await import("/announce.mjs");
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      const out = {};
      const a = announcer({ gap: 0.3 }), b = announcer();
      out.lazy = document.querySelectorAll("[data-fz-announce]").length; // nothing until the first write
      a.say("score", "1 kill");
      a.say("armor", "armor 4 of 5");
      a.say("score", "2 kills"); // replaces the pending score, keeps its place
      await wait(50);
      const reg = document.querySelector("[data-fz-announce]");
      const cs = getComputedStyle(reg);
      out.attrs = [reg.getAttribute("role"), reg.getAttribute("aria-live"), reg.getAttribute("aria-atomic"), reg.parentElement === document.body, cs.display !== "none", cs.position, reg.getBoundingClientRect().width <= 1, cs.overflow];
      out.first = reg.textContent;
      // Rate limit: three quick says inside the gap make ONE write, at the end of the gap.
      a.say("rank", "rank 3 of 8");
      await wait(20);
      a.say("rank", "rank 2 of 8");
      a.say("score", "3 kills");
      await wait(120);
      out.during = reg.textContent; // still the first write
      await wait(300);
      out.second = reg.textContent;
      // The same words again are still heard (a trailing space toggles).
      a.say("rank", "rank 2 of 8");
      a.say("score", "3 kills");
      await wait(400);
      out.third = reg.textContent;
      a.say("status", "You win");
      a.flush(); // promptly, gap or not
      out.flushed = reg.textContent;
      b.say("x", "from b");
      await wait(20);
      out.shared = document.querySelectorAll("[data-fz-announce]").length;
      b.destroy(); // b didn't make the region: it stays
      out.afterB = document.querySelectorAll("[data-fz-announce]").length;
      a.say("late", "never said");
      a.destroy(); // timers off, its region gone
      await wait(400);
      out.afterA = document.querySelectorAll("[data-fz-announce]").length;
      out.writes = window.writes.map((w) => w.text);
      out.gaps = window.writes.slice(1, 3).map((w, i) => w.t - window.writes[i].t);
      return out;
    });
    assert.equal(r.lazy, 0, "the region is made on the first write");
    assert.deepEqual(r.attrs, ["status", "polite", "true", true, true, "fixed", true, "hidden"], "role=status, polite, atomic, in body, visually hidden (not display:none)");
    assert.equal(r.first, "2 kills. armor 4 of 5", "pending texts join in first-queued order; a newer text replaces its key");
    assert.equal(r.during, r.first, "no second write inside the gap");
    assert.equal(r.second, "rank 2 of 8. 3 kills", "the gap's says coalesce into one write");
    assert.ok(r.gaps[0] >= 280, `at most one write per gap (${r.gaps[0].toFixed(0)} ms)`);
    assert.equal(r.third, "rank 2 of 8. 3 kills ", "identical text is re-announced (trailing space toggles)");
    assert.equal(r.flushed.trimEnd(), "You win", "flush writes now");
    assert.equal(r.shared, 1, "one region per document");
    assert.equal(r.afterB, 1, "destroy keeps a region it didn't make");
    assert.equal(r.afterA, 0, "destroy removes the region it made");
    assert.ok(!r.writes.includes("never said"), "destroy clears pending timers");
  } finally {
    await browser.close();
  }
});

test("a match announces score, rank, armour and the result, without spam", async () => {
  const { browser, page } = await open();
  try {
    await page.evaluate(async () => {
      const { createBlitz } = await import("/blitz.mjs");
      window.g = createBlitz(document.getElementById("a"), { seed: 5, seconds: 4 });
      window.g.start();
    });
    await page.waitForFunction(() => window.g.state === "play", null, { timeout: 10000 });
    await page.waitForTimeout(1600); // you've parachuted in
    await page.evaluate(() => (window.g.world.tanks[1].kills = 3)); // you drop to rank 2
    await page.waitForTimeout(1100);
    await page.evaluate(() => {
      const you = window.g.world.tanks[0];
      you.kills = 9; // the top of the table
      you.hp = 2;
    });
    await page.waitForFunction(() => window.g.state === "end", null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const { writes, regions, dialog } = await page.evaluate(() => ({
      writes: window.writes,
      regions: document.querySelectorAll("[aria-live], [role=status]").length + [...document.querySelectorAll("*")].filter((e) => e.shadowRoot).reduce((n, e) => n + e.shadowRoot.querySelectorAll("[aria-live], [role=status], [role=alert]").length, 0),
      dialog: window.g && document.getElementById("a").shadowRoot.activeElement?.textContent,
    }));
    const texts = writes.map((w) => w.text);
    assert.equal(regions, 1, "exactly one live region on the page");
    assert.ok(texts.some((t) => /\bGo\b/.test(t)), `the start is said: ${JSON.stringify(texts)}`);
    assert.ok(texts.some((t) => /9 kills/.test(t)), `your kills are said: ${JSON.stringify(texts)}`);
    assert.ok(texts.some((t) => /rank 2 of 8/.test(t)) && texts.some((t) => /rank 1 of 8/.test(t)), `your rank is said: ${JSON.stringify(texts)}`);
    assert.ok(texts.some((t) => /armor 2 of 5/.test(t)), `your armour is said: ${JSON.stringify(texts)}`);
    assert.match(texts.at(-1), /^You win\. 9 kills, place 1 of 8/, "the result is said last");
    for (let i = 1; i < writes.length; i++) if (!/You win/.test(writes[i].text)) assert.ok(writes[i].t - writes[i - 1].t >= 950, `no more than one write a second (${texts[i - 1]} → ${texts[i]})`);
    assert.match(dialog ?? "", /REMATCH/, "focus is on the result's first key");
  } finally {
    await browser.close();
  }
});
