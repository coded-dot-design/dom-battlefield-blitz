// After `astro build`: add the drop-in and check the site links up.
// artifacts/pages is exactly what GitHub Pages serves:
//   /           landing page   (site/src/pages/index.astro)
//   /play/      the game       (site/src/pages/play/index.astro, dist/blitz.mjs)
//   /blitz.js   the drop-in    (dist/blitz.js, the committed build)
import { cpSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const out = resolve("artifacts/pages");
if (!existsSync(join(out, "index.html"))) throw Error("Run astro build first (npm run site:build).");
cpSync("dist/blitz.js", join(out, "blitz.js"));

// Every local href/src in the built pages must resolve to a file.
const BASE = `${(process.env.SITE_BASE || "/dom-battlefield-blitz").replace(/\/$/, "")}/`;
const pages = [];
const walk = (dir) => readdirSync(dir).forEach((n) => {
  const f = join(dir, n);
  if (statSync(f).isDirectory()) walk(f);
  else if (f.endsWith(".html")) pages.push(f);
});
walk(out);
const missing = [];
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  for (const [, url] of html.matchAll(/(?:href|src)="([^"#?]+)/g)) {
    if (/^(https?:|mailto:|data:)/.test(url)) continue;
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : url.startsWith("/") ? null : join(dirname(page).slice(out.length + 1), url);
    if (path === null) {
      missing.push(`${page}: ${url} (outside ${BASE})`);
      continue;
    }
    let file = join(out, path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) missing.push(`${page.slice(out.length)}: ${url}`);
  }
}
if (missing.length) throw Error(`Broken links:\n${missing.join("\n")}`);
console.log(`Pages ready: ${pages.length} pages, Blitz ${JSON.parse(readFileSync("package.json", "utf8")).version} at /play/, drop-in at /blitz.js.`);
