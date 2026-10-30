// The hero scrim follows the theme: in each theme the gradient behind the hero copy starts from that
// theme's token (dark: --bg, light: --surface), the theme key flips it live, and the copy over it
// (eyebrow, BLITZ VERSION, headline, pink line, lead) keeps WCAG AA on the scrim and on the bare page.
import assert from "node:assert/strict";

const TOKEN = { dark: "--bg", light: "--surface" };
// Text over the hero: [selector, AA ratio]. The headline is large text (3:1); the rest is body size (4.5:1).
const TEXT = [
  [".bz-hero .eyebrow", 4.5],
  [".bz-hero .eyebrow b", 4.5],
  [".bz-hero h1", 3],
  [".bz-hero h1 em", 3],
  [".bz-hero .lead", 4.5],
  [".bz-hero .bz-og", 4.5],
];

// In the page: every colour as [r, g, b, a] 0..255, painted on a canvas (so any CSS colour syntax works).
function sample(text) {
  const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  const rgba = (c) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  };
  // The gradient's first stop: split linear-gradient(...) on top-level commas, drop the stop position
  const bg = getComputedStyle(document.querySelector(".bz-hero"), "::after").backgroundImage;
  const args = [];
  let depth = 0, cur = "";
  for (const ch of bg.slice(bg.indexOf("(") + 1, bg.lastIndexOf(")"))) {
    if (ch === "," && depth === 0) (args.push(cur.trim()), (cur = ""));
    else (cur += ch, ch === "(" ? depth++ : ch === ")" ? depth-- : 0);
  }
  args.push(cur.trim());
  // (Chromium drops the default direction, 180deg / to bottom, so the first argument may be a stop.)
  const first = args[/^(-?[\d.]+(deg|turn|rad|grad)|to\s)/.test(args[0]) ? 1 : 0].replace(/\s+[\d.]+%$/, "");
  const root = getComputedStyle(document.documentElement);
  const token = (name) => rgba(root.getPropertyValue(name).trim());
  return {
    theme: document.documentElement.dataset.theme,
    stop: rgba(first),
    bg: token("--bg"),
    surface: token("--surface"),
    text: Object.fromEntries(text.map(([sel]) => [sel, rgba(getComputedStyle(document.querySelector(sel)).color)])),
  };
}

const lum = ([r, g, b]) => {
  const c = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// The scrim's first stop laid over the page colour (what is actually under the copy at the left edge).
const over = (top, under) => top.slice(0, 3).map((v, i) => Math.round((v * top[3] + under[i] * (255 - top[3])) / 255));
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);

function checkTheme(s, theme, where) {
  assert.equal(s.theme, theme, `${where}: page theme`);
  const token = TOKEN[theme] === "--bg" ? s.bg : s.surface;
  assert.ok(near(s.stop.slice(0, 3), token.slice(0, 3)), `${where}: scrim starts from ${TOKEN[theme]} (${s.stop} vs ${token})`);
  assert.ok(s.stop[3] > 200, `${where}: scrim is nearly opaque behind the copy (alpha ${s.stop[3]})`);
  const backs = { scrim: over(s.stop, s.bg), page: s.bg.slice(0, 3) };
  for (const [sel, aa] of TEXT)
    for (const [name, back] of Object.entries(backs)) {
      const r = contrast(s.text[sel], back);
      assert.ok(r >= aa, `${where}: ${sel} ${r.toFixed(2)}:1 on the ${name} (AA ${aa}:1)`);
    }
}

// Each theme as a returning visitor would load it (localStorage), with the OS set the other way:
// the page's own theme decides, then the theme key flips the scrim with the rest of the page.
export async function checkHeroScrim(browser, url, where) {
  for (const theme of ["light", "dark"]) {
    const other = theme === "light" ? "dark" : "light";
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: other });
    await ctx.addInitScript((t) => {
      if (!sessionStorage.getItem("seeded")) (localStorage.setItem("dom-virus:theme", t), sessionStorage.setItem("seeded", "1"));
    }, theme);
    const p = await ctx.newPage();
    await p.goto(url);
    checkTheme(await p.evaluate(sample, TEXT), theme, `${where} ${theme}`);
    await p.click("[data-theme-toggle]");
    checkTheme(await p.evaluate(sample, TEXT), other, `${where} ${theme} → ${other} (theme key)`);
    await p.setViewportSize({ width: 390, height: 844 });
    checkTheme(await p.evaluate(sample, TEXT), other, `${where} ${other} at 390`);
    await ctx.close();
  }
}
