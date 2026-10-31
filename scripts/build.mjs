// Build the two things DOM Battlefield ships (dist/ is committed; CI checks it matches):
//   dist/blitz.js   - the drop-in: one self-contained script for any website (IIFE)
//   dist/blitz.mjs  - the module: createBlitz + install, for the Battlefield site's Blitz pages
//   dist/blitz.d.ts - its types
//   dist/blitz-net.mjs - the module with net play (@fzlt/core/presence, join, memory) + blitz-net.d.ts
//   dist/build.json - version and SHA-256 per file (provenance for the sync into dom-battlefield)
import { build, transform } from "esbuild";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
// The Board UI kit (Fizlet's ui brick): the same keys, states and stickers as DOM Battlefield,
// minified and baked in as a string for the game's shadow root.
const kit = (await transform(readFileSync("vendor/fizlet/ui/board-ui.css", "utf8"), { loader: "css", minify: true })).code;
const common = { define: { __KIT_CSS__: JSON.stringify(kit) }, bundle: true, minify: true, target: "es2022", legalComments: "none", logLevel: "warning", banner: { js: `/* Battlefield Blitz ${version} · MIT © Chris Cooley · built on Fizlet */` } };
await build({ ...common, entryPoints: ["src/embed.ts"], format: "iife", outfile: "dist/blitz.js" });
await build({ ...common, entryPoints: ["src/index.ts"], format: "esm", outfile: "dist/blitz.mjs" });
await build({ ...common, entryPoints: ["src/net.ts"], format: "esm", outfile: "dist/blitz-net.mjs" });
copyFileSync("src/blitz.d.ts", "dist/blitz.d.ts");
copyFileSync("src/blitz-net.d.ts", "dist/blitz-net.d.ts");
const files = Object.fromEntries(["blitz.js", "blitz.mjs", "blitz.d.ts", "blitz-net.mjs", "blitz-net.d.ts"].map((f) => [f, createHash("sha256").update(readFileSync(`dist/${f}`)).digest("hex")]));
writeFileSync("dist/build.json", JSON.stringify({ version, files }, null, 2) + "\n");
console.log(`Built Blitz ${version}: dist/blitz.js, dist/blitz.mjs, dist/blitz-net.mjs`);
