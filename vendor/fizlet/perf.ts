/**
 * fizlet/perf: a live performance overlay for players, off until they switch it on. Frames per
 * second, a rolling frame-time bar chart (one bar per frame, coloured against the budget),
 * dropped frames, the engine's work per frame (read, steps, render), live pooled entities and,
 * where the browser exposes it, the JS heap. It reads the engine's own frames on the shared clock
 * (`engine.timing`, `engine.live`): no clock or requestAnimationFrame of its own, and it never
 * calls `engine.busy()`, so a settling engine still settles and the chart rests with it.
 *
 * Its own cost stays out of what it measures: frame times go into a typed-array ring (nothing is
 * allocated per frame), the numbers are written twice a second through the ledger (change-only,
 * strings cached), the chart is one canvas, and the root is `contain: layout paint style` and
 * `pointer-events: none`. Hidden, it only records (a few typed-array writes a frame).
 * Not the dev-only `fizlet/debug`, which patches Element prototypes: this one ships to players.
 */
import type { Engine } from "./kernel/engine";

export type Corner = "tl" | "tr" | "bl" | "br";
export interface PerfOptions {
  /** Where the overlay goes (default the engine root, else `document.body`, where it is fixed). */
  host?: HTMLElement | null;
  /** Corner of the host (default "tr"). */
  corner?: Corner;
  /** `KeyboardEvent.code` that toggles it (default "F9"); null for none. */
  key?: string | null;
  /** Shown from the start (default false: players switch it on in Settings). */
  on?: boolean;
  /** The frame budget in ms (default 1000 / 60): a frame over 1.5 budgets counts as dropped. */
  budget?: number;
  /** Called when it is shown or hidden (the key or `show()`): keep a Settings switch in step. */
  change?: (on: boolean) => void;
}

/** Bars in the chart: one per frame, 2 s at 60 fps. */
export const BARS = 120;
/** How often the numbers update (ms of frame time). */
export const WINDOW = 500;

/** The last `cap` frame times (ms) in a typed array: `push` never allocates. */
export class FrameRing {
  readonly ms: Float32Array;
  /** The next slot written. */
  head = 0;
  size = 0;
  constructor(readonly cap: number) {
    this.ms = new Float32Array(cap);
  }
  push(ms: number) {
    this.ms[this.head] = ms;
    this.head = (this.head + 1) % this.cap;
    if (this.size < this.cap) this.size++;
  }
  /** Slot of the k-th oldest frame held. */
  slot(k: number) {
    return (this.head - this.size + k + this.cap) % this.cap;
  }
}
/** Frames per second from a frame count and the ms they took (the readout inlines the same sum). */
export const fps = (frames: number, ms: number) => (ms > 0 ? (frames * 1000) / ms : 0);
/** Frames a long frame swallowed: 0 under 1.5 budgets, else the extra budgets it took (rounded). */
export const missed = (ms: number, budget: number) => (ms > budget * 1.5 ? Math.round(ms / budget) - 1 : 0);

// Strings for 0..1023 (whole numbers, and tenths up to 102.3), made on first use and reused.
// Anything larger shows as a whole number (made each time: rare by definition). The value comes
// from a typed-array slot, never as an argument: a fractional double passed to a call can box.
const cache: string[][] = [[], []], out = new Float64Array(6);
const fmt = (i: number) => {
  const t = +(i === 1 || i === 3), k = Math.round(t ? out[i]! * 10 : out[i]!);
  return k >= 0 && k < 1024 ? (cache[t]![k] ??= t ? ((k / 10) | 0) + "." + (k % 10) : "" + k) : "" + Math.round(out[i]!);
};
// Running numbers in one typed array: updating them never boxes a number.
const WT = 0, WN = 1, WS = 2, DROP = 3, FRAMES = 4;
const LABELS = ["FPS", "MS", "DROP", "WORK", "LIVE", "MB"];
// Board UI tokens: go / hurt / critical bars (under 1.25, 2 and over 2 budgets), the budget line.
const VARS = ["--k-go", "--hurt", "--critical", "--line"], TONES = ["#39ffb0", "#ffc21a", "#f0506e", "#3b3170"];

export function perf(engine: Engine, o: PerfOptions = {}) {
  const L = engine.ledger, clock = engine.timing, budget = o.budget ?? 1000 / 60, ring = new FrameRing(BARS), s = new Float64Array(5);
  const host = o.host ?? (engine.root as HTMLElement | null) ?? document.body, corner = o.corner ?? "tr", key = o.key === undefined ? "F9" : o.key;
  // One static template: a flat arcade card on the kit's tokens (fallbacks: the dark defaults),
  // its hard base straight below; one canvas; six readouts. Built detached, then added once.
  const tpl = document.createElement("div");
  tpl.innerHTML =
    `<div class=fizlet-perf role=group aria-label=Performance data-fizlet-ignore hidden aria-hidden=true style="position:${host === document.body ? "fixed" : "absolute"};${corner[0] === "t" ? "top" : "bottom"}:8px;${corner[1] === "l" ? "left" : "right"}:8px;` +
    "z-index:60;contain:layout paint style;pointer-events:none;width:120px;padding:6px;display:grid;grid-template-columns:1fr 1fr;gap:2px 6px;" +
    "background:var(--surface,#110d22);color:var(--muted,#aea4d6);border:2px solid var(--rim,#07060f);border-radius:6px;box-shadow:0 3px 0 var(--rim,#07060f);" +
    'font:700 9px/1.3 ui-monospace,monospace;letter-spacing:.08em;font-variant-numeric:tabular-nums"><canvas aria-hidden=true style="grid-column:1/-1;width:120px;height:36px;background:var(--bg,#07060f)"></canvas>' +
    LABELS.map((l) => `<span><b style="color:var(--ink,#f6f3ff)">0</b> ${l}</span>`).join("") +
    "</div>";
  const el = tpl.firstChild as HTMLElement, canvas = el.firstChild as HTMLCanvasElement, dpr = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
  const cw = (canvas.width = Math.round(BARS * dpr)), ch = (canvas.height = Math.round(36 * dpr)), ctx = canvas.getContext("2d");
  const tones = TONES.slice(), texts = [...el.querySelectorAll("b")].map((b) => b.firstChild as Text);
  let on = false, dead = false;

  const write = () => {
    const n = s[WN]!, heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    out[0] = n ? (n * 1000) / s[WT]! : 0;
    out[1] = n ? s[WT]! / n : 0;
    out[2] = s[DROP]!;
    out[3] = n ? s[WS]! / n : 0;
    out[4] = engine.live;
    out[5] = heap ? heap.usedJSHeapSize / 1048576 : 0;
    for (let i = 0; i < 6; i++) L.text(texts[i]!, i < 5 || heap ? fmt(i) : "--");
  };
  const draw = () => {
    if (!ctx) return;
    const bw = cw / BARS, top = budget * 3, x0 = (BARS - ring.size) * bw;
    ctx.clearRect(0, 0, cw, ch);
    let tone = -1;
    for (let k = 0; k < ring.size; k++) {
      const i = ring.slot(k), v = ring.ms[i]!, h = Math.max(dpr, Math.min(1, v / top) * ch), c = v <= budget * 1.25 ? 0 : v <= budget * 2 ? 1 : 2;
      if (c !== tone) ctx.fillStyle = tones[(tone = c)]!;
      ctx.fillRect(x0 + k * bw, ch - h, bw, h);
    }
    // The budget line, over the bars: anything that pokes above it was a slow frame.
    ctx.fillStyle = tones[3]!;
    ctx.fillRect(0, Math.round(ch - (budget / top) * ch) - dpr, cw, dpr);
  };
  const system = engine.add({
    render() {
      const d = clock[0]! * 1000, w = clock[1]!;
      if (!(d > 0)) return; // the first frame after a pause or a settle has no interval
      ring.push(d);
      s[WT]! += d;
      s[WN]!++;
      s[WS]! += w;
      s[DROP]! += missed(d, budget);
      s[FRAMES]!++;
      if (s[WT]! >= WINDOW) {
        if (on) write();
        s[WT] = s[WN] = s[WS] = 0;
      }
      if (on) draw();
    },
  });

  const show = (next = !on) => {
    if (dead || next === on) return;
    on = next;
    L.attr(el, "hidden", on ? null : "");
    L.attr(el, "aria-hidden", on ? null : "true");
    if (on) {
      // Read the tokens where it sits (a .bui root or a palette may change them); not in a step.
      const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
      for (let i = 0; i < VARS.length; i++) tones[i] = cs?.getPropertyValue(VARS[i]!).trim() || TONES[i]!;
      write();
      draw();
    }
    o.change?.(on);
  };
  const ctl = new AbortController();
  const destroy = () => {
    if (dead) return;
    dead = true;
    ctl.abort();
    engine.remove(system);
    el.remove();
  };
  engine.signal.addEventListener("abort", destroy, { signal: ctl.signal });
  if (key) document.addEventListener("keydown", (ev) => ev.code === key && !ev.repeat && show(), { signal: ctl.signal });
  host.append(L.add(el));
  if (o.on) show(true);
  return {
    el,
    ring,
    /** Show (true), hide (false) or flip (no argument). */
    show,
    get on() {
      return on;
    },
    /** Frames recorded (0-length frames after a pause are not frames). */
    get frames() {
      return s[FRAMES]!;
    },
    /** Dropped frames so far. */
    get dropped() {
      return s[DROP]!;
    },
    /** Remove the overlay, its key and its system; the engine keeps running. */
    destroy,
  };
}
