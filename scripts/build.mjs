// Build the two things DOM Battlefield ships (dist/ is committed; CI checks it matches):
//   dist/blitz.js   - the drop-in: one self-contained script for any website (IIFE)
//   dist/blitz.mjs  - the module: createBlitz + install, for the Battlefield site's Blitz pages
//   dist/blitz.d.ts - its types
//   dist/build.json - version and SHA-256 per file (provenance for the sync into dom-battlefield)
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
const common = { bundle: true, minify: true, target: "es2022", legalComments: "none", logLevel: "warning", banner: { js: `/* Battlefield Blitz ${version} · MIT © Chris Cooley · built on Fizlet */` } };
await build({ ...common, entryPoints: ["src/embed.ts"], format: "iife", outfile: "dist/blitz.js" });
await build({ ...common, entryPoints: ["src/index.ts"], format: "esm", outfile: "dist/blitz.mjs" });
copyFileSync("src/blitz.d.ts", "dist/blitz.d.ts");
const files = Object.fromEntries(["blitz.js", "blitz.mjs", "blitz.d.ts"].map((f) => [f, createHash("sha256").update(readFileSync(`dist/${f}`)).digest("hex")]));
writeFileSync("dist/build.json", JSON.stringify({ version, files }, null, 2) + "\n");
console.log(`Built Blitz ${version}: dist/blitz.js, dist/blitz.mjs`);
