/**
 * fizlet/hud: change-only HUD bindings that never allocate in the steady state. A binding reads a
 * number (or a flag) every render, compares it as a number after rounding to what the readout
 * shows, and formats and writes only when that changed. Feeds and banners react to the event ring
 * (`engine.events`), never to polling. Every write goes through `engine.ledger`, so `destroy()`
 * gives the page back. Render phase only: no layout reads, nothing in the step. No visuals of its
 * own: it binds to the game's markup (Board UI or anything else).
 */
import type { Engine, System } from "./kernel/engine";

/** How a number shows: `int` 12 · `clock` 3:05 (seconds) · `rank` #2 · `pct` 75% (0..1 in), or your own. */
export type Fmt = "int" | "clock" | "rank" | "pct" | ((v: number) => string);
type Target = HTMLElement | string;
/**
 * Where a number comes from: a getter, or a slot in a typed array (`[state, 3]`). A getter V8
 * doesn't inline boxes a fractional double on every call (16 bytes); a slot never does, so it is
 * the safe choice for running fractions (clock, hp, heat). Whole numbers and booleans never box.
 */
export type Src = (() => number) | readonly [ArrayLike<number>, number];
type Get = (() => number | boolean) | readonly [ArrayLike<number>, number];

const FMTS = ["int", "clock", "rank", "pct"];
const INT = 0, CLOCK = 1, RANK = 2, PCT = 3;
// Formatted strings for 0..1023 per format, made once on first use: a readout that comes back to
// a value it showed before (a clock, a score that drops, a meter) writes a string it already has.
const N = 1024, caches: (string | undefined)[][] = [];
/** The number a format compares: what the readout can actually show. */
const key = (f: number, v: number) => (f === CLOCK ? Math.max(0, Math.floor(v)) : f === PCT ? Math.round(v * 100) : f < 0 ? v : Math.round(v));
function str(f: number, k: number) {
  if (f === CLOCK) return Math.floor(k / 60) + (k % 60 < 10 ? ":0" : ":") + (k % 60);
  return f === RANK ? "#" + k : f === PCT ? k + "%" : "" + k;
}
const cached = (f: number, k: number) => (k >= 0 && k < N && k === (k | 0) ? ((caches[f] ??= new Array(N))[k] ??= str(f, k)) : str(f, k));

interface Bind {
  k: number;
  el: HTMLElement;
  g: (() => number | boolean) | null;
  a: ArrayLike<number> | null;
  i: number;
  f: number;
  fn: ((v: number) => string) | null;
  /** Class name (flag) or event type (feed, banner). */
  c: string;
  /** Rows (feed) or the low threshold in percent (meter, -1 = none). */
  n: number;
  line: ((a: number, b: number) => string) | null;
  text: ((a: number, b: number) => readonly [string, string?]) | null;
  play: ((el: HTMLElement) => void) | null;
  /** Text nodes written: one for num, `n` rows for feed, title + sub for banner. */
  t: Text[];
  lines: string[];
  dirty: boolean;
}
const NUM = 0, METER = 1, FLAG = 2, FEED = 3, BANNER = 4;

export function hud(engine: Engine, root: ParentNode = document) {
  const L = engine.ledger, vals: Bind[] = [], evs: Bind[] = [];
  // Last value per binding, in a typed array: updating it never boxes a number.
  let last = new Float64Array(8);
  const el = (t: Target) => {
    const x = typeof t === "string" ? root.querySelector<HTMLElement>(t) : t;
    if (!x) throw Error("fizlet/hud: no " + t);
    return x;
  };
  /** The element's only text node, or a new one (added through the ledger, removed on destroy). */
  const textOf = (x: Element) => {
    const f = x.firstChild;
    if (f && f.nodeType === 3 && !f.nextSibling) return f as Text;
    return x.appendChild(L.add(x.ownerDocument.createTextNode("")));
  };
  const bind = (k: number, t: Target, g: Get | null, f: number, fn: Bind["fn"], c: string, n: number, line: Bind["line"], text: Bind["text"], play: Bind["play"]) => {
    const fnGet = typeof g === "function";
    const b: Bind = { k, el: el(t), g: fnGet ? g : null, a: g && !fnGet ? g[0] : null, i: g && !fnGet ? g[1] : 0, f, fn, c, n, line, text, play, t: [], lines: Array<string>(k === FEED ? n : 2).fill(""), dirty: false };
    if (k < FEED) {
      if (vals.length === last.length) {
        const o = last;
        (last = new Float64Array(o.length * 2).fill(NaN)).set(o);
      }
      vals.push(b);
    } else evs.push(b);
    return api;
  };
  last.fill(NaN);

  const system: System = {
    render() {
      for (let i = 0; i < vals.length; i++) {
        const b = vals[i]!, v = b.g ? +b.g() : b.a![b.i]!, k = b.k === NUM ? key(b.fn ? -1 : b.f, v) : b.k === METER ? key(PCT, v < 0 ? 0 : v > 1 ? 1 : v) : v ? 1 : 0;
        if (k === last[i] || (k !== k && last[i] !== last[i])) continue;
        last[i] = k;
        if (b.k === NUM) L.text((b.t[0] ??= textOf(b.el)), b.fn ? b.fn(k) : cached(b.f, k));
        else if (b.k === FLAG) L.cls(b.el, b.c, k === 1);
        else {
          L.style(b.el, "width", cached(PCT, k));
          if (b.el.getAttribute("role") === "progressbar") L.attr(b.el, "aria-valuenow", cached(INT, k));
          if (b.n >= 0) L.cls(b.el, "low", k <= b.n);
        }
      }
      const ring = engine.events;
      if (evs.length)
        for (let j = 0; j < ring.size; j++) {
          const x = ring.at(j)!;
          for (let i = 0; i < evs.length; i++) {
            const b = evs[i]!;
            if (x.type !== b.c) continue;
            b.dirty = true;
            if (b.k === FEED) {
              for (let r = b.n - 1; r > 0; r--) b.lines[r] = b.lines[r - 1]!;
              b.lines[0] = b.line!(x.a, x.b);
            } else {
              const s = b.text!(x.a, x.b);
              b.lines[0] = s[0];
              b.lines[1] = s[1] ?? "";
            }
          }
        }
      for (let i = 0; i < evs.length; i++) {
        const b = evs[i]!;
        if (!b.dirty) continue;
        b.dirty = false;
        const kids = b.el.children;
        if (b.k === FEED) {
          if (!b.t.length)
            for (let r = 0; r < b.n; r++) {
              const row = kids[r] ?? b.el.appendChild(L.add(b.el.ownerDocument.createElement(/^[OU]L$/.test(b.el.tagName) ? "li" : "div")));
              b.t.push(textOf(row));
            }
          for (let r = 0; r < b.n; r++) L.text(b.t[r]!, b.lines[r]!);
          b.play?.(kids[0] as HTMLElement);
        } else {
          // Title in the first child element (or the banner itself), sub in the second.
          if (!b.t.length) b.t.push(textOf(kids[0] ?? b.el)), kids[1] && b.t.push(textOf(kids[1]));
          L.text(b.t[0]!, b.lines[0]!);
          if (b.t[1]) L.text(b.t[1], b.lines[1]!);
          b.play?.(b.el);
        }
      }
    },
  };
  engine.add(system);

  const api = {
    /** A number readout: written only when its shown value changes. */
    num: (t: Target, get: Src, fmt: Fmt = "int") =>
      typeof fmt === "function" ? bind(NUM, t, get, -1, fmt, "", 0, null, null, null) : bind(NUM, t, get, FMTS.indexOf(fmt), null, "", 0, null, null, null),
    /** A bar: `width` in whole percent (0..1 in), `aria-valuenow` on a progressbar, class `low` at or under `low`. */
    meter: (t: Target, get: Src, low?: number) => bind(METER, t, get, 0, null, "", low === undefined ? -1 : Math.round(low * 100), null, null, null),
    /** A class that follows a condition. */
    flag: (t: Target, cls: string, get: () => boolean) => bind(FLAG, t, get, 0, null, cls, 0, null, null, null),
    /** A list of the last `rows` events of a type, newest first (`play` runs on the newest row). */
    feed: (list: Target, rows: number, on: string, line: (a: number, b: number) => string, play?: (row: HTMLElement) => void) =>
      bind(FEED, list, null, 0, null, on, rows, line, null, play ?? null),
    /** Title and sub from an event; `play` (re)starts the game's own animation. */
    banner: (t: Target, on: string, text: (a: number, b: number) => readonly [string, string?], play?: (el: HTMLElement) => void) =>
      bind(BANNER, t, null, 0, null, on, 0, null, text, play ?? null),
    /** The render system (already added to the engine; `engine.remove(system)` unbinds everything). */
    system,
  };
  return api;
}
export type Hud = ReturnType<typeof hud>;
