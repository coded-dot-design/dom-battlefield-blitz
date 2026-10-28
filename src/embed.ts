/**
 * Battlefield Blitz, drop-in. One script tag turns any page into the arena:
 *   <script src="https://coded-dot-design.github.io/dom-battlefield/blitz/blitz.js" defer></script>
 * Options as data attributes on that tag:
 *   data-easter-egg="true"   stay hidden until the Konami code (desktop) or a hold-then-tap on any
 *                            [data-blitz-trigger] element (phones). Default: a PLAY BLITZ key.
 *   data-palette='{"cmd":"#8573ee"}'   Board UI colours (hex only)
 *   data-blitz-manual        don't auto-install; call window.BattlefieldBlitz.install({...})
 * Escape (or the toggle key) closes it, and the page is exactly as it was.
 */
import { embed, type EmbedConfig } from "../vendor/fizlet/embed";
import { createBlitz } from "./game";

export function install(config: Partial<EmbedConfig> = {}) {
  return embed(() => (host) => createBlitz(host, { mode: "embed" }), {
    name: "blitz",
    label: "Play Blitz",
    open: false,
    ...config,
    easterEgg: config.easterEgg ?? false,
  });
}

const tag = document.currentScript as HTMLScriptElement | null;
if (tag && tag.dataset.blitzManual === undefined) {
  let palette: EmbedConfig["palette"];
  try {
    palette = tag.dataset.palette ? JSON.parse(tag.dataset.palette) : undefined;
  } catch {}
  const ready = () => install({ palette, easterEgg: tag.dataset.easterEgg === "true" });
  if (document.body) ready();
  else addEventListener("DOMContentLoaded", ready, { once: true });
}
(window as unknown as { BattlefieldBlitz: unknown }).BattlefieldBlitz = { install };
