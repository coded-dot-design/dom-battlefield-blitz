import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const ORIGIN = "https://blitz.test";
const PAGE = `<!doctype html><meta charset="utf-8"><title>replay</title><style>body{margin:0}</style>
<div id="a" style="position:relative;width:1100px;height:640px"></div><div id="b" style="position:relative;width:1100px;height:640px"></div>`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
await page.route(`${ORIGIN}/**`, (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/") return route.fulfill({ contentType: "text/html", body: PAGE });
  const file = path.startsWith("/old/") ? `dist-old/${path.slice(5)}` : `dist${path}`;
  return route.fulfill({ contentType: "text/javascript", body: readFileSync(file) });
});
await page.goto(`${ORIGIN}/`);
const exact = (mod, seed, platoons) => page.evaluate(async ([mod, seed, platoons]) => {
  const { createBlitz } = await import(mod);
  for (const id of ["a", "b"]) document.getElementById(id).replaceChildren();
  const g = createBlitz(document.getElementById("a"), { demo: true, seed, platoons });
  g.engine.stop();
  const wr = document.querySelector("#a > *")?.getBoundingClientRect?.() ?? document.getElementById("a").firstElementChild?.getBoundingClientRect();
  let h = 0x811c9dc5; const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  const mix = (v) => { if (typeof v === "boolean") v = v ? 1 : 0; if (typeof v !== "number") return; f64[0] = v; h = Math.imul(h ^ u32[0], 16777619) >>> 0; h = Math.imul(h ^ u32[1], 16777619) >>> 0; };
  const marks = [];
  for (let f = 1; f <= 3600; f++) { g.engine.advance(1 / 60); const w = g.world; for (const list of [w.tanks, w.shells, w.tiles, w.blocks, w.planes, w.bombs, w.marks, w.crates]) for (const o of list) for (const k in o) mix(o[k]); if (f === 1 || f === 60 || f === 600) marks.push(h.toString(16)); }
  const blocks = g.world.blocks.length;
  g.destroy();
  return `${h.toString(16)} early=${marks.join("/")} blocks=${blocks} wrap=${wr ? wr.width + "x" + wr.height : "?"} dpr=${devicePixelRatio} ua=${navigator.userAgent.match(/Chrome\/[\d.]+/)}`;
}, [mod, seed, platoons]);
const m = await page.evaluate(() => [Math.sin(1e5), Math.cos(0.7), Math.atan2(0.3, -2), Math.hypot(3.3, 7.1), Math.exp(1.3), Math.pow(1.7, 1.5)].map((x) => x.toString()).join(","));
console.log(`::error::math ${m}`);
for (const [s, p] of [[41, false], [42, false], [7, true]]) {
  console.log(`::error::new ${s}${p ? "p" : ""} ${await exact("/blitz.mjs", s, p)}`);
  console.log(`::error::old ${s}${p ? "p" : ""} ${await exact("/old/blitz.mjs", s, p)}`);
}
await browser.close();
