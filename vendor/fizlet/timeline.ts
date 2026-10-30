/**
 * fizlet/timeline: scripted DOM choreography on the kernel clock. Keyframe tracks animate CSS
 * properties (transform, translate, scale, rotate, opacity, clip-path, filter, custom properties:
 * any value whose numbers change and whose words stay) or plain numbers, with easings, delays,
 * staggers, sequencing and overlap, labels, repeats and yoyo. Time moves in the fixed step (no
 * allocation, no DOM); writes happen in render through the ledger, change-only, so Recall restores
 * every property touched. Done or paused, it asks for no frames: the engine settles. With reduced
 * motion, play() lands on the end state in one step (or build a gentler variant on `tl.reduced`).
 */
import type { Engine } from "./kernel/engine";
import { need } from "./kernel/need";

/** An easing: progress 0..1 in, eased progress out (it may overshoot). */
export type Ease = (p: number) => number;
/** The named easings: cubic in, out and in-out; back overshoots a little and settles. Also by name:
 *  "steps(n)" (n equal jumps: a ticking counter, a typed-out line). */
export const EASES: Record<string, Ease> = {
  linear: (p) => p,
  in: (p) => p * p * p,
  out: (p) => 1 - (1 - p) ** 3,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (2 - 2 * p) ** 3 / 2),
  back: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
};
// Every easing is sampled once into a 256-step table (shared per easing), so the step never calls
// a function: a call through a function value would box the number it passes.
const TABLES = new Map<unknown, Float64Array>();
const table = (key: unknown, f: Ease) => TABLES.get(key) ?? (TABLES.set(key, Float64Array.from({ length: 257 }, (_, i) => f(i / 256))).get(key) as Float64Array);

/** A number, a CSS value ("translate(0px,8px)", "inset(0 50% 0 0)") or keyframes, evenly spaced.
 *  Keyframes share one shape: the same words, only the numbers change. A single value starts where
 *  the property's last track ended (or is set at once if it has none). */
export type Value = number | string | readonly (number | string)[];
export interface TrackOptions {
  /** Seconds (default 0.4). */
  dur?: number;
  /** Seconds after `at`; negative overlaps the track before (default 0). */
  delay?: number;
  /** A name in EASES, "steps(n)" or a function (default "out"). */
  ease?: string | Ease;
  /** Seconds between one target's start and the next. */
  stagger?: number;
  /** Where it starts: seconds, "<" (with the track before) or a label (default: the end so far). */
  at?: number | string;
}
export interface TimelineOptions {
  /** Extra plays after the first (default 0; Infinity loops). */
  repeat?: number;
  /** Every other play runs backwards. */
  yoyo?: boolean;
  /** Speed (default 1). */
  rate?: number;
  /** Animate (default: yes, unless the visitor prefers reduced motion; then play() jumps). */
  motion?: boolean;
  /** `a` on this timeline's events (default 0). */
  id?: number;
}
/** One property of one target: its words, its numbers now, and whether render owes a write. */
// Short field names: property names survive minification.
interface Prop {
  /** Target, key, words (around the numbers), numbers now, kind (0 a style, 1 a typed array slot, 2 an
   *  object's property), owes a write. */
  el: any;
  k: string | number;
  w: string[];
  o: Float64Array;
  h: number;
  y: number;
}
interface Track {
  p: Prop;
  /** Start and duration in seconds. */
  t: number;
  d: number;
  /** The easing's table. */
  e: Float64Array;
  /** Keyframes × numbers, flat; m keyframes. */
  v: Float64Array;
  m: number;
  /** The property's first track: it holds its first keyframe before it starts. */
  f: boolean;
}

const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/g;

/**
 * A timeline on `engine` (paused until `play()`). Events on the ring, `a` = id: "timeline:start",
 * "timeline:end", and each label's own name (b = its index) as the playhead passes it.
 */
export function timeline(engine: Engine, o: TimelineOptions = {}) {
  const tracks: Track[] = [], props: Prop[] = [], names: string[] = [], marks: number[] = [], waits: (() => void)[] = [];
  const yoyo = o.yoyo, id = o.id ?? 0, rate = need(o.rate ?? 1, "rate", 1), reps = o.repeat === Infinity ? -1 : need(o.repeat ?? 0, "repeat");
  const mq = o.motion == null && typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const still = () => (mq ? mq.matches : o.motion === false);
  // The playhead (seconds over every play) is written every step: a typed array, so it never boxes.
  // The rest change only at setup or on a control call: the end so far (one play's length), the last
  // track's start; direction (1, -1, 0 paused), and what the next step or render owes.
  const s = new Float64Array(1);
  let end = 0, prev = 0, dir = 0, owe = 0, jump = 0, start = 0, undo = 0;
  const total = () => (reps < 0 ? Infinity : end * (reps + 1));
  // Where play stops: the end, or one play's end when it loops forever (reduced motion, finish()).
  const top = () => (reps < 0 ? end : total());
  const at = (a?: number | string, i = names.indexOf(a as string)) => (typeof a === "number" ? a : a === "<" ? prev : i < 0 ? end : marks[i]!);
  // Labels the playhead passes from a to b: (a, b] forward, [b, a) back, play by play.
  const pass = (a: number, b: number) => {
    const L = end;
    // No length yet: i is NaN and the loop never runs.
    for (let i = Math.floor(Math.min(a, b) / L); i * L <= Math.max(a, b); i++)
      for (let j = 0; j < marks.length; j++) {
        // A yoyo's odd play turns at its ends: a label there was already said by the play beside it.
        if (yoyo && i & 1 && marks[j]! % L == 0) continue;
        const g = i * L + (yoyo && i & 1 ? L - marks[j]! : marks[j]!);
        if (b > a ? g > a && g <= b : g >= b && g < a) engine.events.emit(names[j]!, id, j);
      }
  };
  const sample = (t: number) => {
    // One play's own time (yoyo mirrors every other play).
    const L = end, n = t > 0 && L ? Math.ceil(t / L) - 1 : 0, u = yoyo && n & 1 ? L - t + n * L : t - n * L;
    for (let i = 0; i < tracks.length; i++) {
      const k = tracks[i]!, p = k.p, out = p.o, w = out.length;
      if (u < k.t && !k.f) continue;
      const x = (k.d > 0 ? Math.min(1, Math.max(0, (u - k.t) / k.d)) : +(u >= k.t)) * 256, c = k.e, h = Math.min(255, Math.floor(x));
      const e = (c[h]! + (c[h + 1]! - c[h]!) * (x - h)) * (k.m - 1);
      const j = Math.min(Math.max(Math.floor(e), 0), k.m - 2), f = e - j;
      for (let q = 0; q < w; q++) {
        const a = k.v[j * w + q]!, v = Math.round((a + (k.v[j * w + w + q]! - a) * f) * 1e3) / 1e3;
        if (v !== out[q]) (out[q] = v), (p.y = 1);
      }
      // A typed array slot is not the page: it lands now, so a step after this one reads it. (An
      // object's property waits for render: storing a number there can box it.)
      if (p.h == 1 && p.y) (p.el[p.k] = out[0]), (p.y = 0);
    }
  };
  const go = (d: number, j = still()) => {
    if (d > 0 ? s[0]! >= total() : s[0]! <= 0) s[0] = d > 0 ? 0 : top();
    // Said in the next step: the ring is cleared at the start of every frame.
    start = +(dir !== d && s[0] === (d > 0 ? 0 : top()));
    jump = +j;
    dir = d;
    engine.wake();
    return tl;
  };

  const tl = {
    /** Add tracks: each property of `values` on each target (an element, a list of them, or any
     *  object or typed array for plain numbers: `tl.to(arr, { 0: [0, 1] })`). Chainable. */
    to(targets: object | ArrayLike<object>, values: Record<string, Value>, t: TrackOptions = {}) {
      const list: any[] = (targets as any).style || ArrayBuffer.isView(targets) || !("length" in targets) ? [targets] : Array.from(targets as ArrayLike<object>);
      const dur = need(t.dur ?? 0.4, "dur"), st = need(t.stagger ?? 0, "stagger"), t0 = at(t.at) + need(t.delay ?? 0, "delay");
      const f = t.ease ?? "out", n = /^steps\((\d+)\)$/.exec(f as string)?.[1] as unknown as number;
      const fn = typeof f === "function" ? f : n > 0 ? (p: number) => Math.min(1, Math.floor(p * n) / n) : EASES[f];
      if (!fn) throw new RangeError("timeline: ease " + f);
      const ease = table(f, fn);
      list.forEach((el, i) => {
        for (const name in values) {
          // A value's shape is its words with every number cut out; keyframes must share it.
          const key = isNaN(+name) ? name : +name, kf = ([] as unknown[]).concat(values[name]).map(String), shape = (x: string) => x.replace(NUM, "\0");
          let p = props.find((x) => x.el === el && x.k === key), last: Track | undefined;
          const first = !p, w = kf[0]!.match(NUM)?.length ?? 0;
          if (!p) props.push((p = { el, k: key, w: shape(kf[0]!).split("\0"), o: new Float64Array(w).fill(NaN), h: el.style ? 0 : ArrayBuffer.isView(el) ? 1 : 2, y: 0 }));
          for (const k of tracks) if (k.p === p) last = k;
          const v: (string | number)[][] = kf.map((x) => {
            if (shape(x) !== p.w.join("\0")) throw new RangeError("timeline: " + name + " " + x);
            return x.match(NUM) ?? [];
          });
          // A single value starts where the property's last track ended.
          if (!v[1]) v.unshift(last ? [...last.v.subarray(last.v.length - w)] : v[0]!);
          tracks.push({ p, t: t0 + i * st, d: dur, e: ease, v: new Float64Array(v.flat().map(Number)), m: v.length, f: first });
        }
      });
      prev = t0;
      end = Math.max(end, t0 + (list.length - 1) * st + dur);
      return tl;
    },
    /** Name a moment (default: the end so far) for `at`; its name goes on the ring as it passes. */
    label(name: string, t?: number | string) {
      marks.push(at(t));
      names.push(name);
      return tl;
    },
    /** Play forward (from the start if it is at the end). */
    play: () => go(1),
    /** Play backward (from the end if it is at the start). */
    reverse: () => go(-1),
    pause() {
      dir = 0;
      return tl;
    },
    /** Move the playhead to `t` seconds; it keeps playing or stays paused. */
    seek(t: number) {
      s[0] = Math.min(Math.max(need(t, "seek"), 0), total());
      owe = 1;
      engine.wake();
      return tl;
    },
    /** Land on the end in the next step ("timeline:end" fires). */
    finish: () => go(1, true),
    /** Pause and give every property back as it was before the timeline wrote it. */
    revert() {
      dir = 0;
      undo = 1;
      engine.wake();
      return tl;
    },
    /** Resolves the next time the timeline ends. */
    done: () => new Promise<void>((r) => waits.push(r)),
    /** The playhead in seconds (over every play). */
    get time() {
      return s[0]!;
    },
    /** Every play together, in seconds (Infinity when it loops forever). */
    get duration() {
      return total();
    },
    get playing() {
      return dir !== 0;
    },
    /** The visitor prefers reduced motion (or `motion: false`): build the gentler variant on it. */
    get reduced() {
      return still();
    },
    step(e: Engine, dt: number) {
      const d = dir, a = s[0]!;
      if (d) {
        if (start) (start = 0), e.events.emit("timeline:start", id);
        let b = jump ? (d > 0 ? top() : 0) : a + dt * rate * d;
        pass(a, b);
        if (jump || (d > 0 ? b >= total() : b <= 0)) {
          b = Math.min(Math.max(b, 0), top());
          dir = 0;
          e.events.emit("timeline:end", id);
          for (let i = 0; i < waits.length; i++) waits[i]!();
          waits.length = 0;
        }
        s[0] = b;
        e.busy();
      } else if (!owe) return;
      owe = 0;
      sample(s[0]!);
    },
    render() {
      for (let i = 0; i < props.length; i++) {
        const p = props[i]!, w = p.w, out = p.o;
        if (undo) {
          if (!p.h) engine.ledger.unstyle(p.el, p.k as string);
          out.fill(NaN);
        } else if (p.h) {
          if (p.y) p.el[p.k] = out[0];
        } else if (p.y) {
          let v = w[0]!;
          for (let q = 0; q < out.length; q++) v += out[q] + w[q + 1]!;
          engine.ledger.style(p.el, p.k as string, v);
        }
        p.y = 0;
      }
      undo = 0;
    },
  };
  engine.add(tl);
  return tl;
}
export type Timeline = ReturnType<typeof timeline>;
