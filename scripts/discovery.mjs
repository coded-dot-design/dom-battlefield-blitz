// robots.txt, sitemap.xml and llms.txt for the built site (artifacts/pages), read from the pages themselves:
// a page is listed when it is not noindex and its canonical is its own URL (so /v/<version>/ archives and
// copies that point elsewhere stay out). Titles and descriptions come from each page's own head.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const tag = (html, re) => [...html.matchAll(/<(?:meta|link)\b[^>]*>/g)].map((m) => m[0]).find((t) => re.test(t));
const attr = (t, name) => unescape(t?.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "").replace(/\s+/g, " ").trim();

/** Write the three files into `out` for a site served at `home` (absolute, ending in /). Returns the listed pages. */
export function writeDiscovery(out, home, name) {
  const files = [];
  const walk = (dir) => readdirSync(dir).forEach((n) => { const f = join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (f.endsWith(".html")) files.push(f); });
  walk(out);
  const listed = [];
  for (const f of files) {
    const rel = relative(out, f).split("\\").join("/");
    if (rel === "404.html") continue;
    const url = home + (rel === "index.html" ? "" : rel.endsWith("/index.html") ? rel.slice(0, -10) : rel);
    const html = readFileSync(f, "utf8");
    if (/noindex/i.test(attr(tag(html, /\bname="robots"/), "content"))) continue;
    const canonical = attr(tag(html, /\brel="canonical"/), "href");
    if (canonical && canonical !== url) continue;
    const title = unescape(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
    listed.push({ url, title, description: attr(tag(html, /\bname="description"/), "content") });
  }
  listed.sort((a, b) => (a.url === home ? -1 : b.url === home ? 1 : a.url.localeCompare(b.url)));
  if (listed[0]?.url !== home) throw Error(`discovery: the home page ${home} is not indexable`);
  writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${home}sitemap.xml\n`);
  writeFileSync(join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${listed.map((p) => `  <url><loc>${xml(p.url)}</loc></url>\n`).join("")}</urlset>\n`);
  writeFileSync(join(out, "llms.txt"), `# ${name}\n\n> ${listed[0].description}\n\nBy Chris Cooley.\n\n## Pages\n\n${listed.map((p) => `- [${p.title}](${p.url})${p.description ? `: ${p.description}` : ""}\n`).join("")}`);
  return listed;
}
