// Snapshot the engine Blitz is built on (sibling checkout), with provenance:
//   ../fizlet/src → vendor/fizlet
// Never edit vendor/ by hand: change coded-dot-design/fizlet, then run node scripts/sync.mjs.
import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const meta = (repo) => ({
  repository: `https://github.com/coded-dot-design/${repo}`,
  version: JSON.parse(readFileSync(`../${repo}/package.json`, "utf8")).version,
  commit: execFileSync("git", ["-C", `../${repo}`, "rev-parse", "HEAD"]).toString().trim(),
});

rmSync("vendor/fizlet", { recursive: true, force: true });
cpSync("../fizlet/src", "vendor/fizlet", { recursive: true, filter: (p) => !p.endsWith(".md") });
const files = [];
const walk = (d) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : files.push(join(d, n))));
walk("vendor/fizlet");
writeFileSync("vendor/fizlet/ORIGIN.json", JSON.stringify({ note: "Generated snapshot. Edit coded-dot-design/fizlet, then run node scripts/sync.mjs.", ...meta("fizlet"), files: files.sort().map((f) => ({ path: relative("vendor/fizlet", f), sha256: sha(f) })) }, null, 2) + "\n");

console.log("synced vendor/fizlet");
