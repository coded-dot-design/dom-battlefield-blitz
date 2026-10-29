// The Battlefield Blitz site on GitHub Pages: landing page (/) and the game (/play/). The drop-in
// (/blitz.js) is copied from dist by scripts/pages.mjs.
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
export default defineConfig({
  root,
  srcDir: root + "site/src",
  publicDir: root + "site/public",
  outDir: root + "artifacts/pages",
  // Custom domain: SITE_URL=https://battlefieldblitz.domvirus.com and SITE_BASE=/ (repo variables).
  site: process.env.SITE_URL || "https://coded-dot-design.github.io",
  base: process.env.SITE_BASE || "/dom-battlefield-blitz",
  trailingSlash: "always",
  output: "static",
  devToolbar: { enabled: false },
  server: { host: "127.0.0.1", port: 4322 },
});
