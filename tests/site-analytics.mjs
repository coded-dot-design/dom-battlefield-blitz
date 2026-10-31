// GA4 + PostHog, consent first (site/src/lib/analytics, the astro-engine kit), against the built site
// (artifacts/pages). Adapted from astro-engine#34 / dom-virus#38.
// 1. The build: with no PUBLIC_GA4_ID / PUBLIC_POSTHOG_KEY (CI and PR builds), no page or script carries
//    analytics code; with an id, every page carries the consent runtime exactly once.
// 2. In Chromium, on the real built pages with the runtime added (test ids, vendor hosts intercepted, so
//    nothing leaves the machine): before a choice no request to googletagmanager, google-analytics or
//    posthog and no _ga/ph_ cookie, and track() sends nothing; Accept loads both (ad signals stay denied)
//    and the play page's events reach them; Reject loads neither and is remembered; GPC means denied (no
//    banner, nothing loads); the footer "Cookie settings" and the game's "consent:open" event reopen the
//    choice; in phone game mode (390×844, 844×390) the banner keeps clear of the key row and the fire pad.
// Run after npm run site:build (it runs with npm run test:site).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { resolveAnalytics } from "../site/src/lib/analytics/config.mjs";
import { consentSnippet } from "../site/src/lib/analytics/site.mjs";

const out = resolve("artifacts/pages");
const VENDOR = /googletagmanager\.com|google-analytics\.com|posthog\.com/;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(html|js|mjs)$/.test(name)) files.push(path);
  }
})(out);

// 1. The build.
const built = resolveAnalytics(process.env);
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!built.enabled) assert.doesNotMatch(text, /googletagmanager\.com\/gtag|static\/array\.js|\.siteAnalytics = \{|data-consent/, `${file}: analytics code with no id set`);
  else if (file.endsWith(".html") && text.includes('class="site-foot"'))
    assert.equal(text.split(".siteAnalytics = {").length - 1, 1, `${file}: consent runtime once`);
}
console.log(`analytics build: ${built.enabled ? "on" : "off"}, ${files.length} files checked`);

// 2. The browser: each built page served with the test runtime in place of whatever the build had.
const snippet = consentSnippet({ PUBLIC_GA4_ID: "G-XXXXXXXXXX", PUBLIC_POSTHOG_KEY: "phc_test1234567890" });
const strip = (html) => html.replace(/<script>\(function analyticsRuntime[\s\S]*?<\/script><script>document\.documentElement\.setAttribute\("data-consent"[\s\S]*?<\/script>/, "");
const withRuntime = (html) => strip(html).replace("</body>", `${snippet}</body>`);
const home = readFileSync(resolve(out, "index.html"), "utf8");
const base = new URL(home.match(/<link rel="canonical" href="([^"]+)"/)[1]).pathname; // "/" or "/dom-battlefield-blitz/"

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function open(path = "", { gpc = false, viewport = { width: 390, height: 844 }, phone = false } = {}) {
  const ctx = await browser.newContext({ viewport, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  if (gpc) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
  const hits = [];
  await ctx.route(VENDOR, (r) => {
    hits.push(r.request().url());
    return r.fulfill({ contentType: "application/javascript", body: "" });
  });
  await ctx.route("https://site.test/**", (r) => {
    let file = resolve(out, "." + new URL(r.request().url()).pathname.slice(base.length - 1));
    if (!file.startsWith(out)) return r.fulfill({ status: 404, body: "" });
    try {
      if (statSync(file).isDirectory()) file = resolve(file, "index.html");
      const ext = file.slice(file.lastIndexOf("."));
      if (ext === ".html") return r.fulfill({ contentType: "text/html", body: withRuntime(readFileSync(file, "utf8")) });
      const type = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" }[ext];
      return r.fulfill({ contentType: type || "application/octet-stream", body: readFileSync(file) });
    } catch {
      return r.fulfill({ status: 404, body: "" });
    }
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`https://site.test${base}${path}`);
  return { ctx, p, hits, errors };
}
const trackers = async (ctx) => (await ctx.cookies()).map((c) => c.name).filter((n) => /^_ga|^ph_/.test(n));
const sent = (p) => p.evaluate(() => [...window.dataLayer].filter((a) => a[0] === "event").map((a) => [a[1], a[2]]));
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

try {
  {
    const { ctx, p, hits } = await open();
    await p.waitForSelector("[data-consent-banner]:not([hidden])");
    assert.equal(await p.isVisible("footer [data-cookie-settings]"), true, "footer Cookie settings shows with analytics on");
    assert.equal(await p.getAttribute("html", "data-consent"), "", "<html data-consent> tells the game's pause menu");
    assert.equal(await p.getAttribute('[data-consent-banner] a[href$="/legal/privacy/"]', "href"), "https://domvirus.com/legal/privacy/");
    assert.equal(await p.getAttribute('[data-consent-banner] a[href$="/legal/cookies/"]', "href"), "https://domvirus.com/legal/cookies/");
    const sizes = await p.$$eval("[data-consent-banner] .cc-btn", (b) => b.map((x) => `${x.offsetWidth >= 44}x${x.offsetHeight}`));
    assert.deepEqual(new Set(sizes.map((s) => s.split("x")[1])).size, 1, "Reject, Settings and Accept are the same height");
    await p.evaluate(() => window.siteAnalytics.track("game_start", { game: "blitz" }));
    await p.waitForTimeout(400);
    assert.deepEqual(hits, [], "no vendor request before consent");
    assert.deepEqual(await trackers(ctx), [], "no _ga / ph_ cookie before consent");
    assert.deepEqual(await sent(p), [], "track() sends nothing before consent");
    const consent = await p.evaluate(() => JSON.stringify([...window.dataLayer].find((a) => a[0] === "consent")));
    assert.match(consent, /"analytics_storage":"denied","ad_storage":"denied","ad_user_data":"denied","ad_personalization":"denied"/);
    await ctx.close();
  }
  {
    const { ctx, p, hits } = await open();
    await p.click('[data-cc="accept"]');
    await p.waitForTimeout(300);
    assert.ok(hits.some((u) => u.includes("googletagmanager.com/gtag/js?id=G-XXXXXXXXXX")), "GA4 loads after Accept");
    assert.ok(hits.some((u) => u.includes("posthog.com/static/array.js")), "PostHog loads after Accept");
    const update = await p.evaluate(() => JSON.stringify([...window.dataLayer].filter((a) => a[0] === "consent" && a[1] === "update")));
    assert.doesNotMatch(update, /ad_(storage|user_data|personalization)":"granted/, "ad signals stay denied");
    // The play page after Accept: a short match sends game_start and game_end (numbers and fixed words only).
    await p.goto(`https://site.test${base}play/?seconds=3`);
    await p.waitForFunction(() => window.blitz?.state === "intro", null, { timeout: 8000 });
    await p.evaluate(() => window.blitz.start());
    await p.waitForFunction(() => window.dataLayer.some((a) => a[0] === "event" && a[1] === "game_end"), null, { timeout: 20000 });
    const events = await sent(p);
    const start = events.find(([e]) => e === "game_start"), end = events.find(([e]) => e === "game_end");
    assert.deepEqual(start?.[1], { game: "blitz", mode: "solo" }, "game_start");
    assert.deepEqual(Object.keys(end[1]).sort(), ["deaths", "duration", "game", "kills", "mode", "place", "tanks"], "game_end: standings, no names");
    assert.ok(Object.values(end[1]).every((v) => typeof v === "number" || /^(blitz|solo)$/.test(v)), "game_end: numbers and fixed words");
    // TUNE: let a lever go → tune_change { lever, value }.
    await p.evaluate(() => {
      const input = document.getElementById("blitz").shadowRoot.querySelector('[data-tune-panel] input[name="speed"]');
      input.value = "1.2";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.deepEqual((await sent(p)).find(([e]) => e === "tune_change")?.[1], { game: "blitz", lever: "speed", value: 1.2 }, "tune_change");
    await p.evaluate(() => localStorage.removeItem("blitz:tune"));
    await ctx.close();
  }
  {
    const { ctx, p, hits } = await open();
    await p.click('[data-cc="reject"]');
    await p.reload();
    await p.waitForTimeout(400);
    assert.equal(await p.isVisible("[data-consent-banner]"), false, "no banner once rejected");
    assert.equal(JSON.parse(await p.evaluate(() => localStorage.getItem("blitz:consent"))).analytics, false, "Reject is stored under blitz:consent");
    await p.evaluate(() => window.siteAnalytics.track("share", { game: "blitz", via: "copy" }));
    await p.waitForTimeout(200);
    assert.deepEqual(hits, [], "nothing loads after Reject, and it is remembered");
    assert.deepEqual(await sent(p), [], "track() sends nothing after Reject");
    assert.deepEqual(await trackers(ctx), []);
    await p.click("footer [data-cookie-settings]");
    assert.equal(await p.isVisible("[data-cc-analytics]"), true, "Cookie settings reopens the choice");
    await ctx.close();
  }
  {
    const { ctx, p, hits } = await open("", { gpc: true });
    await p.waitForTimeout(400);
    assert.equal(await p.isVisible("[data-consent-banner]"), false, "GPC: no banner");
    assert.equal(await p.evaluate(() => window.siteAnalytics.granted()), false, "GPC means denied");
    await p.evaluate(() => window.siteAnalytics.track("game_start", { game: "blitz" }));
    await p.waitForTimeout(200);
    assert.deepEqual(hits, [], "GPC: nothing loads");
    // The game's pause-menu key (phone game mode) sends a composed "consent:open" from inside the arena.
    await p.evaluate(() => document.querySelector("footer").dispatchEvent(new CustomEvent("consent:open", { bubbles: true, composed: true })));
    assert.equal(await p.isVisible("[data-cc-analytics]"), true, '"consent:open" reopens the choice');
    await ctx.close();
  }
  // Phone game mode: the banner never covers the key row (top-left) or the fire pad (bottom-right).
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const { ctx, p, errors } = await open("play/", { viewport, phone: true });
    await p.waitForSelector("[data-consent-banner]:not([hidden])");
    await p.waitForFunction(() => window.blitz?.state === "intro", null, { timeout: 8000 });
    await p.evaluate(() => window.blitz.start());
    await p.waitForFunction(() => window.blitz.state === "play", null, { timeout: 8000 });
    const box = await p.locator("[data-consent-banner]").boundingBox();
    const keys = await p.evaluate(() => {
      const root = document.getElementById("blitz").shadowRoot;
      const rect = (el) => { const r = el.getBoundingClientRect(); return { name: el.className || el.tagName, x: r.x, y: r.y, width: r.width, height: r.height }; };
      return [...root.querySelectorAll("[data-pad], [data-fs], [data-pause]"), ...document.querySelectorAll(".game-exit")].filter((el) => el.getClientRects().length).map(rect);
    });
    console.log(`  ${viewport.width}×${viewport.height}: banner ${[box.x, box.y, box.width, box.height].map(Math.round)}; ${keys.map((k) => `${k.name} ${[k.x, k.y, k.width, k.height].map(Math.round)}`).join("; ")}`);
    assert.ok(keys.length >= 2, `${viewport.width}×${viewport.height}: found the pad and the key row`);
    for (const k of keys) assert.equal(overlap(box, k), false, `${viewport.width}×${viewport.height}: banner clear of ${k.name}`);
    assert.ok(box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width, "banner on screen");
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  console.log("analytics consent: before consent 0 vendor requests; Accept loads GA4 + PostHog and the play events; Reject and GPC load none; phone game mode clear of the keys");
} finally {
  await browser.close();
}
