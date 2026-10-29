/**
 * Board UI kit: the tiny behaviour half of board-ui.css. No dependencies, no globals, every
 * listener bound to the caller's AbortSignal. Spec: board-ui/BOARD-UI.md.
 */

/** The only per-game input: a palette. Any key left out keeps the kit default. */
export type Palette = Partial<{
  bg: string; surface: string; raised: string; card: string; ink: string; muted: string; line: string; rim: string;
  sys: string; cmd: string; fire: string; aim: string; attack: string; advance: string; fallin: string; flag: string; go: string;
  teamA: string; teamB: string; hurt: string; critical: string;
  /** Text / thin-line twins for the light theme (defaults to the face colour). */
  sysInk: string; cmdInk: string; fireInk: string;
}>;

const VARS: Record<keyof Palette, string> = {
  bg: "--bg", surface: "--surface", raised: "--raised", card: "--card", ink: "--ink", muted: "--muted", line: "--line", rim: "--rim",
  sys: "--k-sys", cmd: "--k-cmd", fire: "--k-fire", aim: "--k-aim", attack: "--k-attack", advance: "--k-advance", fallin: "--k-fallin",
  flag: "--k-flag", go: "--k-go", teamA: "--team-a", teamB: "--team-b", hurt: "--hurt", critical: "--critical",
  sysInk: "--k-sys-ink", cmdInk: "--k-cmd-ink", fireInk: "--k-fire-ink",
};
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** One constructed sheet per distinct CSS text, shared by every board mounted with that text. */
const sheets = new Map<string, CSSStyleSheet>();
/**
 * Mount a board inside a shadow root on `host`, isolated both ways: the kit can't touch the page
 * and the page's CSS (a global `button {}` rule, a reset) can't touch the board. Pass the kit CSS
 * text (e.g. `import css from "board-ui/board-ui.css?raw"`). Returns the `.bui` root to build in.
 * Stylesheet ownership: the kit owns one constructed sheet per CSS text (keyed by the text), so
 * games composed independently with different CSS each get their own, and boards with the same
 * text share one. Treat it as read-only; it is appended to the shadow root's adoptedStyleSheets,
 * never replacing sheets you adopted there yourself.
 */
export function mount(host: HTMLElement, css: string, opts: { theme?: "dark" | "light"; side?: 0 | 1; palette?: Palette } = {}) {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  if ("adoptedStyleSheets" in shadow && typeof CSSStyleSheet === "function" && "replaceSync" in CSSStyleSheet.prototype) {
    let sheet = sheets.get(css);
    if (!sheet) (sheet = new CSSStyleSheet()).replaceSync(css), sheets.set(css, sheet);
    if (!shadow.adoptedStyleSheets.includes(sheet)) shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
  } else {
    const style = document.createElement("style");
    style.textContent = css;
    shadow.append(style);
  }
  const root = document.createElement("div");
  root.className = "bui";
  // Contract rule 8: style containment only (counters and quotes stay inside). The root is static,
  // so layout or paint containment would move or clip a board's own absolute layers.
  root.style.contain = "style";
  root.dataset.theme = opts.theme ?? "dark";
  root.dataset.side = String(opts.side ?? 0);
  shadow.append(root);
  if (opts.palette) applyPalette(root, opts.palette);
  return root;
}

/** Paint a board: sets the palette's CSS variables on the .bui root. Invalid colours are ignored
 *  (an embed config can never inject CSS). Returns a function that restores the old values. */
export function applyPalette(root: HTMLElement, palette: Palette): () => void {
  const before = new Map<string, string>();
  for (const [key, value] of Object.entries(palette) as [keyof Palette, string][]) {
    const name = VARS[key];
    if (!name || typeof value !== "string" || !HEX.test(value)) continue;
    before.set(name, root.style.getPropertyValue(name));
    root.style.setProperty(name, value);
  }
  return () => before.forEach((v, name) => (v ? root.style.setProperty(name, v) : root.style.removeProperty(name)));
}

/**
 * A press that fires once per touch, mouse or keyboard activation, and never loses to a second
 * finger already on the stick. Touch fires on touchstart (no 300ms wait); the click that may
 * follow an uncancellable touch is skipped. Run your state change and repaint synchronously in
 * fn: a frame between release and the new pressed state makes the key bounce.
 */
/** Readouts (BOARD-UI.md section 18): a `.bui-readouts` group of `[label, tone?]` items, appended to
 *  `parent`. Returns the value elements in order, for fizlet/hud (or your own change-only writes).
 *  Text is set with textContent. The caller owns the group: add it through the engine's ledger. */
export function readouts(parent: HTMLElement, items: [label: string, tone?: "team" | "enemy"][], onMap = false) {
  const group = parent.ownerDocument.createElement("div");
  group.className = onMap ? "bui-readouts bui-on-map" : "bui-readouts";
  const values = items.map(([label, tone]) => {
    const item = group.appendChild(parent.ownerDocument.createElement("span"));
    item.className = "bui-readout";
    if (tone) item.dataset.tone = tone;
    item.append(label);
    return item.appendChild(parent.ownerDocument.createElement("b"));
  });
  parent.append(group);
  return { group, values };
}

export function press(el: HTMLElement, fn: () => void, signal: AbortSignal) {
  let touched = 0;
  el.addEventListener("touchstart", (e) => {
    if (e.cancelable) e.preventDefault();
    else touched = performance.now();
    fn();
  }, { passive: false, signal });
  el.addEventListener("click", () => {
    if (!touched || performance.now() - touched > 800) fn();
    touched = 0;
  }, { signal });
}

/** localStorage key of the Settings "Performance overlay" switch (off by default). */
export const PERF_KEY = "dom-virus:perf";
/**
 * A Settings switch: a key that is `aria-pressed` (the kit's locked state) while on, remembered
 * in localStorage under `key` as "1" / "0". Storage that throws (private mode, blocked cookies,
 * a sandboxed frame) is ignored: the switch still works, it just forgets. `change` runs once
 * with the stored value and on every flip; `set(on)` flips it from code (a keyboard shortcut).
 * Example: `setting(btn, PERF_KEY, (on) => overlay.show(on), signal)` with `fizlet/perf`.
 */
export function setting(button: HTMLElement, key: string, change: (on: boolean) => void, signal: AbortSignal, fallback = false) {
  let on = fallback;
  try {
    const v = localStorage.getItem(key);
    if (v === "1" || v === "0") on = v === "1";
  } catch {}
  const set = (next: boolean, save = true) => {
    on = next;
    button.setAttribute("aria-pressed", "" + on);
    if (save)
      try {
        localStorage.setItem(key, on ? "1" : "0");
      } catch {}
    change(on);
  };
  button.addEventListener("click", () => set(!on), { signal });
  set(on, false);
  return {
    get on() {
      return on;
    },
    set,
  };
}

/** Restart an overlay sticker's slam and press (on every entry, and on return to a hidden tab). */
export function slam(sticker: HTMLElement | null) {
  if (!sticker) return;
  sticker.style.animation = "none";
  void sticker.offsetWidth;
  sticker.style.animation = "";
}

/** Show the comms toast for a while (it never stacks: a new line replaces the old). */
export function toast(el: HTMLElement, text: string, ms = 3200) {
  el.textContent = text;
  el.hidden = false;
  clearTimeout(Number(el.dataset.timer));
  el.dataset.timer = String(setTimeout(() => (el.hidden = true), ms));
}

const INVERT = "invert(1) hue-rotate(180deg)";
/**
 * The launch burst: the key presses into its base and flips to its inverse, then shatters into
 * spinning chunks with a flash, a round shock ring and square debris that falls away (the hub
 * hero's explosion). The action runs synchronously in the click (mobile full screen keeps its
 * user activation); the burst lives on <body>, so the layout the action causes can't move it.
 * Never cancel a burst from the action itself (see BOARD-UI.md, "reset cancels the burst").
 */
export function launch(button: HTMLElement, action: () => void, opts: { reduced?: boolean; tones?: string[]; done?: () => void } = {}) {
  const LIFE = 760, PRESS = 90, ease = "cubic-bezier(.15,.8,.3,1)";
  const finish = () => {
    layer?.remove();
    button.classList.remove("bui-igniting");
    opts.done?.();
  };
  let layer: HTMLElement | null = null;
  if (!opts.reduced) {
    const r = button.getBoundingClientRect(), style = getComputedStyle(button), ink = style.color, root = button.closest<HTMLElement>(".bui");
    layer = document.createElement("div");
    layer.className = "bui-burst";
    layer.setAttribute("aria-hidden", "true");
    // Inline styles only: the burst lives on <body>, outside any shadow root the board is in.
    Object.assign(layer.style, { position: "fixed", contain: "layout style", zIndex: "2147483000", pointerEvents: "none", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    document.body.append(layer);
    const sink = Number(style.boxShadow.match(/(-?[\d.]+)px\s+(-?[\d.]+)px/)?.[2] || 5);
    const copy = () => {
      const c = button.cloneNode(true) as HTMLElement;
      c.removeAttribute("id");
      c.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      // Freeze the look: the copy lives outside the .bui root.
      const from = [button, ...button.querySelectorAll<HTMLElement>("*")], to = [c, ...c.querySelectorAll<HTMLElement>("*")];
      from.forEach((n, i) => {
        const s = getComputedStyle(n);
        for (const p of ["color", "background-color", "border", "border-radius", "font", "letter-spacing", "fill", "stroke", "display", "gap", "align-items", "justify-items", "align-content", "padding", "width", "height"])
          to[i]!.style.setProperty(p, s.getPropertyValue(p));
      });
      Object.assign(c.style, { position: "absolute", left: "0", top: "0", margin: "0", width: `${r.width}px`, height: `${r.height}px`, boxSizing: "border-box", transition: "none", animation: "none" });
      return c;
    };
    const cap = copy();
    layer.append(cap);
    cap.animate([
      { transform: "translateY(0)", boxShadow: style.boxShadow, filter: "invert(0) hue-rotate(0deg)" },
      { transform: `translateY(${sink}px)`, boxShadow: "0 0 0 transparent", filter: INVERT, offset: 0.9 },
      { transform: `translateY(${sink}px)`, boxShadow: "0 0 0 transparent", filter: INVERT, opacity: 0 },
    ], { duration: PRESS + 10, fill: "both" });
    const add = (el: HTMLElement, frames: Keyframe[], ms: number) => {
      layer!.append(el);
      el.animate(frames, { duration: ms, delay: PRESS, easing: ease, fill: "both" });
    };
    const W = r.width, H = r.height, R = Math.min(W, H);
    for (let i = 0; i < 6; i++) {
      const col = i % 3, row = Math.floor(i / 3), chunk = copy();
      Object.assign(chunk.style, { filter: INVERT, boxShadow: "none", translate: `0 ${sink}px` });
      chunk.style.clipPath = `inset(${row * 50}% ${100 - (col + 1) * 33.34}% ${100 - (row + 1) * 50}% ${col * 33.33}%)`;
      chunk.style.transformOrigin = `${(col + 0.5) * 33.33}% ${(row + 0.5) * 50}%`;
      const cx = (col + 0.5) / 3 - 0.5, cy = (row + 0.5) / 2 - 0.5, dx = cx * W * 1.1 + (i % 2 ? 8 : -8), dy = cy * H * 1.4 - 18, spin = (cx || 0.3) * (col === 1 ? 60 : 120);
      add(chunk, [
        { transform: "translate(0,0) rotate(0) scale(1)", opacity: 1 },
        { transform: `translate(${dx}px,${dy}px) rotate(${spin}deg) scale(.82)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx * 1.15}px,${dy + 46}px) rotate(${spin * 1.4}deg) scale(.6)`, opacity: 0 },
      ], LIFE - PRESS - 60);
    }
    const dot = (cls: string, size: number, tone: string) => {
      const d = document.createElement("i");
      d.className = cls;
      Object.assign(d.style, {
        position: "absolute", width: `${size}px`, height: `${size}px`, left: `${W / 2 - size / 2}px`, top: `${H / 2 - size / 2 + sink}px`,
        borderRadius: cls === "bui-bit" ? "0" : "50%",
        background: cls === "bui-ring" ? "none" : tone,
        border: cls === "bui-ring" ? `3px solid ${tone}` : "0",
      });
      return d;
    };
    add(dot("bui-flash", R * 0.6, "#fff4ff"), [{ transform: "scale(.3)", opacity: 1 }, { transform: "scale(2.6)", opacity: 0.9, offset: 0.35 }, { transform: "scale(3.2)", opacity: 0 }], 320);
    add(dot("bui-flash", R * 0.45, ink), [{ transform: "scale(.4)", opacity: 1 }, { transform: "scale(2.2)", opacity: 1, offset: 0.4 }, { transform: "scale(.2)", opacity: 0 }], 460);
    add(dot("bui-ring", R * 0.5, ink), [{ transform: "scale(.5)", opacity: 1 }, { transform: "scale(5)", opacity: 0 }], 480);
    const css = root ? getComputedStyle(root) : null,
      tones = opts.tones ?? [ink, ...["--k-attack", "--k-flag", "--k-cmd"].map((v) => css?.getPropertyValue(v).trim() || ink)];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + (i % 2) * 0.3, d = R * 0.9 + (i % 3) * 18, s = 5 + (i % 3) * 2;
      const x = Math.cos(a) * d * (W / H > 1.5 ? 1.5 : 1), y = Math.sin(a) * d;
      add(dot("bui-bit", s, tones[i % tones.length]!), [
        { transform: "translate(0,0) rotate(0)", opacity: 1 },
        { transform: `translate(${x}px,${y}px) rotate(${(i % 2 ? 1 : -1) * (90 + i * 25)}deg)`, opacity: 1, offset: 0.78 },
        { transform: `translate(${x}px,${y + 16}px)`, opacity: 0 },
      ], 640);
    }
    button.classList.add("bui-igniting");
  }
  setTimeout(finish, opts.reduced ? 90 : LIFE);
  action();
}
