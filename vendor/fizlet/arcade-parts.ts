// fizlet/arcade internals shared by the shell and its HUD presets (not a public module): the icons,
// HTML escaping and the overlay CSS every preset starts from.
const svg = (d: string) => `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICON = {
  sound: svg('<path d="M3 8h3l4-4v12l-4-4H3ZM14 6q4 4 0 8"/>'),
  mute: svg('<path d="M3 8h3l4-4v12l-4-4H3ZM14 8l4 4m0-4-4 4"/>'),
  pause: svg('<path d="M7 5v10M13 5v10"/>'),
  play: svg('<path d="m7 4 9 6-9 6Z"/>'),
  fold: svg('<path d="M4 10h12"/>'),
  open: svg('<path d="M4 10h12M10 4v12"/>'),
  exit: svg('<path d="m5 5 10 10M15 5 5 15"/>'),
  fire: svg('<path d="M10 1v5M10 14v5M1 10h5M14 10h5"/><circle cx="10" cy="10" r="5"/>'),
};
export const esc = (t: string) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
/** The overlay host, the kit root, the canvas, the toast and the pad: every preset's base. */
export const BASE = `
:host{all:initial!important;position:fixed!important;inset:0!important;display:block!important;z-index:2147483000!important;pointer-events:none!important}
.bui{position:absolute;inset:0;background:none;font:500 12px/1.4 ui-monospace,monospace}
canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.bui .msg{position:absolute;left:50%;bottom:max(16px,env(safe-area-inset-bottom));translate:-50% 0;max-width:calc(100% - 24px);pointer-events:none}
.bui .msg[hidden]{display:none}
.bui .bui-pad{pointer-events:auto}
@media (prefers-reduced-motion:reduce){.bui *{transition:none!important;animation:none!important}}`;
