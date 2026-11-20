// Snapshot the engine Blitz is built on (FIZLET_DIR, default the sibling checkout ../fizlet), with
// provenance:  <FIZLET_DIR>/src → vendor/fizlet
// Never edit vendor/ by hand: change fizlet/fzlt, then run node scripts/sync.mjs.
import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const FIZLET = process.env.FIZLET_DIR || "../fizlet";
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const meta = (dir) => ({
  repository: "https://github.com/fizlet/fzlt",
  version: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version,
  commit: execFileSync("git", ["-C", dir, "rev-parse", "HEAD"]).toString().trim(),
});

rmSync("vendor/fizlet", { recursive: true, force: true });
cpSync(join(FIZLET, "src"), "vendor/fizlet", { recursive: true, filter: (p) => !p.endsWith(".md") });
const files = [];
const walk = (d) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : files.push(join(d, n))));
walk("vendor/fizlet");
writeFileSync("vendor/fizlet/ORIGIN.json", JSON.stringify({ note: "Generated snapshot. Edit fizlet/fzlt, then run node scripts/sync.mjs.", ...meta(FIZLET), files: files.sort().map((f) => ({ path: relative("vendor/fizlet", f), sha256: sha(f) })) }, null, 2) + "\n");

console.log("synced vendor/fizlet");
