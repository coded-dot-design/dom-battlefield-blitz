/**
 * @fzlt/core/embed: drop a game onto any page with one small config.
 *   palette   - hex colours for the Board UI roles (anything else is ignored: no CSS injection)
 *   easterEgg - false: open now. true / {...}: stay dormant (tiny listeners only) until a trigger
 *               (key sequence, gesture on a selector, click on a selector), then lazy-load the game.
 *   toggle    - a floating key to reopen / close once unlocked. Escape closes and restores the page.
 * Lifted from Swarm Protocol's loader: keys typed in fields never count, only a position and a
 * timestamp are kept for the sequence (never the typed text), and destroy() removes everything.
 */
import { applyPalette, type Palette } from "./ui/board-ui";

type Scope = "desktop" | "mobile" | "all";
/** What wakes a dormant embed: a key sequence (`"konami"` or your own keys), a gesture or a click on
 *  a selector, each limited to desktop, mobile or all; `toggle` adds the on-page toggle key. */
export interface EasterEgg {
  sequence?: "konami" | string[] | false;
  gesture?: { on: string; type: "hold-tap" | "double-tap" | "long-press" } | false;
  click?: string | false;
  scope?: { sequence?: Scope; gesture?: Scope; click?: Scope };
  toggle?: boolean;
}
/** The one config an embed takes: its name, the toggle label, the Board UI palette and the easter egg. */
export interface EmbedConfig {
  /** Short id: data-<name>-trigger / data-<name>-ignore, the toggle label. */
  name: string;
  /** Label on the toggle key (default: name). */
  label?: string;
  palette?: Palette;
  easterEgg?: boolean | EasterEgg;
  /** With no easter egg: open right away (default) or wait closed behind the toggle key. */
  open?: boolean;
}
/** A mounted game: `destroy()` removes it and gives the page back. */
export interface Mounted {
  destroy(): void;
}
/** Your game's mount function: draws the game into `host` and returns it as `Mounted`. */
export type Mount = (host: HTMLElement, config: EmbedConfig) => Mounted;

const KONAMI = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a", "enter"];
const TOGGLE_CSS = ":host{all:initial;position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:2147483600}button{display:flex;align-items:center;gap:8px;height:44px;padding:0 14px;font:800 12px/1 ui-monospace,monospace;letter-spacing:.08em;color:#07060f;background:#39ffb0;border:2px solid #07060f;border-radius:10px;box-shadow:calc(4px*var(--shadow-x,0)) calc(4px*var(--shadow-y,1)) 0 #1d6a40;cursor:pointer}button:active{transform:translate(calc(4px*var(--shadow-x,0)),calc(4px*var(--shadow-y,1)));box-shadow:none}button.open{background:#f6f3ff;box-shadow:calc(4px*var(--shadow-x,0)) calc(4px*var(--shadow-y,1)) 0 #8f88b8}";

/** Drop a game onto the page: `load` is called (and awaited) only when the game opens, at once or when
 *  the easter egg fires. Returns the controls: `open()`, `close()`, `unlock()`, `opened`, `unlocked`
 *  and `destroy()`. */
export function embed(load: () => Promise<Mount> | Mount, cfg: EmbedConfig) {
  const ctl = new AbortController(), on = { signal: ctl.signal };
  const egg: EasterEgg | null = cfg.easterEgg === true ? {} : cfg.easterEgg || null;
  const coarse = matchMedia("(pointer: coarse)");
  const allowed = (s: Scope | undefined, d: Scope) => ((s = s ?? d), s === "all" || (s === "mobile") === coarse.matches);
  const ignore = `input,textarea,select,[contenteditable],[data-${cfg.name}-ignore]`;
  let host: HTMLElement | null = null, game: Mounted | null = null, pending: Promise<unknown> | null = null;
  let toggle: HTMLButtonElement | null = null, unlocked = !egg;

  // Each open() is one generation; close() and destroy() end it, so a load still in flight never
  // mounts after the player closed it.
  let gen = 0;
  async function open() {
    if (game || pending || ctl.signal.aborted) return pending;
    const my = ++gen;
    const p: Promise<unknown> = (async () => {
      const mount = await load();
      if (my !== gen || ctl.signal.aborted) return;
      host = document.createElement("div");
      host.setAttribute(`data-${cfg.name}-ignore`, "");
      host.setAttribute("data-fizlet-host", cfg.name);
      document.body.append(host);
      if (cfg.palette) applyPalette(host, cfg.palette);
      game = mount(host, cfg);
      paint();
    })().finally(() => pending === p && (pending = null));
    return (pending = p);
  }
  function close() {
    gen++;
    pending = null;
    game?.destroy();
    host?.remove();
    game = host = null;
    paint();
  }
  function unlock() {
    unlocked = true;
    void open();
  }
  function paint() {
    if (!toggle && unlocked && egg?.toggle !== false) {
      const h = document.createElement("div");
      h.setAttribute(`data-${cfg.name}-ignore`, "");
      const root = h.attachShadow({ mode: "open" }), style = document.createElement("style");
      style.textContent = TOGGLE_CSS;
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.addEventListener("click", () => (game ? close() : void open()), on);
      root.append(style, toggle);
      document.body.append(h);
      ctl.signal.addEventListener("abort", () => h.remove());
    }
    if (toggle) {
      toggle.className = game ? "open" : "";
      toggle.textContent = game ? "✕ CLOSE" : `▶ ${(cfg.label ?? cfg.name).toUpperCase()}`;
      toggle.setAttribute("aria-label", game ? `Close ${cfg.label ?? cfg.name}` : `Play ${cfg.label ?? cfg.name}`);
    }
  }

  addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && (game || pending)) return close();
  }, on);

  if (egg) {
    // Key sequence: only a position and a timestamp are kept.
    const seq = egg.sequence === false ? null : egg.sequence === undefined || egg.sequence === "konami" ? KONAMI : egg.sequence.map((k) => k.toLowerCase());
    let at = 0, t = 0;
    if (seq)
      addEventListener("keydown", (ev) => {
        if (!allowed(egg.scope?.sequence, "desktop") || (ev.target as Element)?.closest?.(ignore)) return;
        const now = performance.now();
        if (now - t > 1500) at = 0;
        t = now;
        const k = ev.key.toLowerCase();
        at = k === seq[at] ? at + 1 : k === seq[0] ? 1 : 0;
        if (at === seq.length) (at = 0), unlock();
      }, on);
    // Gesture on a selector (default: hold, then tap, on [data-<name>-trigger]).
    const g = egg.gesture === false ? null : egg.gesture ?? { on: `[data-${cfg.name}-trigger]`, type: "hold-tap" as const };
    if (g) {
      let target: Element | null = null, x = 0, y = 0, timer = 0, armedUntil = 0, lastTap = 0;
      const clear = () => (clearTimeout(timer), (timer = 0), (target = null));
      addEventListener("pointerdown", (ev) => {
        if (!allowed(egg.scope?.gesture, "mobile")) return;
        const el = (ev.target as Element)?.closest?.(g.on);
        if (!el || (ev.target as Element).closest(ignore)) return clear();
        target = el;
        x = ev.clientX;
        y = ev.clientY;
        const now = performance.now();
        if (g.type === "hold-tap" && now < armedUntil) return void ((armedUntil = 0), unlock());
        if (g.type === "double-tap" && now - lastTap < 350) return void ((lastTap = 0), unlock());
        lastTap = now;
        if (g.type !== "double-tap")
          timer = window.setTimeout(() => {
            timer = 0;
            if (g.type === "long-press") unlock();
            else armedUntil = performance.now() + 5000;
          }, g.type === "long-press" ? 700 : 900);
      }, on);
      addEventListener("pointermove", (ev) => target && (ev.clientX - x) ** 2 + (ev.clientY - y) ** 2 > 144 && clear(), on);
      addEventListener("pointerup", () => timer && clear(), on);
      addEventListener("pointercancel", clear, on);
      ctl.signal.addEventListener("abort", clear);
    }
    if (egg.click)
      addEventListener("click", (ev) => {
        if (allowed(egg.scope?.click, "all") && (ev.target as Element)?.closest?.(egg.click as string)) (ev.preventDefault(), unlock());
      }, on);
  } else if (cfg.open === false) paint();
  else void open();

  return {
    open,
    close,
    unlock,
    get opened() {
      return !!game;
    },
    get unlocked() {
      return unlocked;
    },
    /** Remove every listener, the toggle and the game (the game restores the page). */
    destroy() {
      close();
      ctl.abort();
    },
  };
}
