import { EventRing } from "./ring";
import { Ledger } from "./ledger";
import { Pool } from "./pool";
import { seeded, type Random } from "./random";

/** Frame phases. Read geometry only in READ, never in STEP; write the DOM only in RENDER. */
export const IDLE = 0, READ = 1, STEP = 2, RENDER = 3;

/** A system: game logic or a harness. Every hook is optional; systems run in the order added. */
export interface System {
  /** Once per frame, before the steps: read cached geometry, sample input. */
  read?(e: Engine): void;
  /** Fixed step (dt = engine.dt): the simulation. No DOM reads or writes, no allocation. */
  step?(e: Engine, dt: number): void;
  /** Once per frame, after the steps: write the DOM (change-only), play sounds from the ring. */
  render?(e: Engine, alpha: number): void;
}

export interface EngineOptions {
  /** The element the engine lives in; it pauses while this is off screen. */
  root?: Element | null;
  /** Fixed step in seconds (default 1/60). */
  step?: number;
  /** Most steps per frame before dropping time instead of spiralling (default 4). */
  maxSteps?: number;
  /** Seed for `engine.random` (default 1). */
  seed?: number;
  /** Event ring capacity per frame (default 64). */
  events?: number;
  /** Aborting this destroys the engine (Recall included). */
  signal?: AbortSignal;
  /** Auto-pause rules (all on by default; reducedMotion is opt-in: most games calm their effects). */
  pause?: { hidden?: boolean; offscreen?: boolean; editable?: boolean; reducedMotion?: boolean };
}

export interface EngineStats {
  frames: number;
  steps: number;
  dropped: number;
  time: number;
  frameMs: { avg: number; max: number };
  events: { size: number; cap: number; dropped: number };
  pools: Record<string, { used: number; cap: number }>;
  ledger: number;
  paused: string[];
}

export type Engine = ReturnType<typeof createEngine>;

// ---------- The shared scheduler: one requestAnimationFrame for every engine on the page ----------
const live: Engine[] = [];
let raf = 0, requests = 0;
function tick(now: number) {
  raf = 0;
  for (let i = 0; i < live.length; i++) live[i]!.frame(now);
  if (live.length) (requests++, (raf = requestAnimationFrame(tick)));
}
function schedule(e: Engine, on: boolean) {
  const i = live.indexOf(e);
  if (on && i < 0) live.push(e);
  if (!on && i >= 0) live.splice(i, 1);
  if (live.length && !raf && typeof requestAnimationFrame === "function") (requests++, (raf = requestAnimationFrame(tick)));
  if (!live.length && raf) (cancelAnimationFrame(raf), (raf = 0));
}
/** Scheduler facts for tests and the debug HUD. */
export const scheduler = {
  get engines() {
    return live.length;
  },
  get requests() {
    return requests;
  },
};

const REASONS = ["stopped", "hidden", "offscreen", "editable", "reduced-motion"];
const STOPPED = 1, HIDDEN = 2, OFFSCREEN = 4, EDITABLE = 8, MOTION = 16;

export function createEngine(o: EngineOptions = {}) {
  const dt = o.step ?? 1 / 60, maxSteps = o.maxSteps ?? 4, root = o.root ?? null;
  const ctl = new AbortController(), signal = ctl.signal;
  const systems: System[] = [], pools: [string, Pool<unknown>][] = [];
  const events = new EventRing(o.events ?? 64), ledger = new Ledger(), random: Random = seeded(o.seed ?? 1);
  let held = STOPPED, phase = IDLE, dead = false;
  // Running numbers live in one typed array: updating it never allocates (a captured `let` holding
  // a double would box a new number on every write).
  const n = new Float64Array(8);
  const ACC = 0, LAST = 1, TIME = 2, FRAMES = 3, STEPS = 4, DROPPED = 5, MS = 6, MAX = 7;
  n[LAST] = -1;

  const set = (bit: number, on: boolean) => {
    held = on ? held | bit : held & ~bit;
    if (held) n[LAST] = -1;
    schedule(engine, !held && !dead);
  };

  const engine = {
    signal,
    events,
    ledger,
    random,
    root,
    /** Fixed step length in seconds. */
    dt,
    get time() {
      return n[TIME]!;
    },
    get phase() {
      return phase;
    },
    get running() {
      return !held && !dead;
    },
    /** Why it's paused right now (empty when running). */
    get paused() {
      return REASONS.filter((_, i) => held & (1 << i));
    },
    add<S extends System>(s: S): S {
      systems.push(s);
      return s;
    },
    remove(s: System) {
      const i = systems.indexOf(s);
      if (i >= 0) systems.splice(i, 1);
    },
    /** A named, bounded pool, listed in stats(). */
    pool<T>(name: string, cap: number, create: () => T): Pool<T> {
      const p = new Pool(cap, create);
      pools.push([name, p as Pool<unknown>]);
      return p;
    },
    start() {
      if (!dead) set(STOPPED, false);
    },
    stop() {
      set(STOPPED, true);
    },
    /** Called by the scheduler with the rAF timestamp. */
    frame(now: number) {
      const sec = n[LAST]! < 0 ? 0 : (now - n[LAST]!) / 1000;
      n[LAST] = now;
      engine.advance(sec);
    },
    /** Run one frame's worth of time by hand (tests, headless, a server). */
    advance(sec: number) {
      const t0 = performance.now();
      events.clear();
      phase = READ;
      for (let i = 0; i < systems.length; i++) systems[i]!.read?.(engine);
      phase = STEP;
      if (sec > 0) n[ACC]! += sec;
      for (let k = 0; n[ACC]! >= dt; k++) {
        if (k === maxSteps) {
          n[DROPPED]! += Math.floor(n[ACC]! / dt);
          n[ACC]! %= dt;
          break;
        }
        for (let i = 0; i < systems.length; i++) systems[i]!.step?.(engine, dt);
        n[ACC]! -= dt;
        n[TIME]! += dt;
        n[STEPS]!++;
      }
      phase = RENDER;
      const alpha = n[ACC]! / dt;
      for (let i = 0; i < systems.length; i++) systems[i]!.render?.(engine, alpha);
      phase = IDLE;
      const ms = performance.now() - t0;
      n[FRAMES]!++;
      n[MS]! += ms;
      if (ms > n[MAX]!) n[MAX] = ms;
    },
    stats(): EngineStats {
      const p: EngineStats["pools"] = {};
      for (const [name, pool] of pools) p[name] = { used: pool.size, cap: pool.cap };
      const frames = n[FRAMES]!;
      return {
        frames,
        steps: n[STEPS]!,
        dropped: n[DROPPED]!,
        time: n[TIME]!,
        frameMs: { avg: frames ? n[MS]! / frames : 0, max: n[MAX]! },
        events: { size: events.size, cap: events.cap, dropped: events.dropped },
        pools: p,
        ledger: ledger.size,
        paused: engine.paused,
      };
    },
    /** Stop for good: every listener and observer goes (one signal), the page is restored. */
    destroy() {
      if (dead) return;
      dead = true;
      set(STOPPED, true);
      ctl.abort();
      ledger.restore();
      for (const [, pool] of pools) pool.clear();
      systems.length = 0;
    },
  };

  // ---------- Auto-pause: hidden tab, page leaving, off screen, typing, reduced motion ----------
  const rule = o.pause ?? {};
  if (typeof document === "object") {
    const on = { signal };
    if (rule.hidden !== false) {
      const vis = () => set(HIDDEN, document.visibilityState === "hidden");
      document.addEventListener("visibilitychange", vis, on);
      addEventListener("pagehide", () => set(HIDDEN, true), on);
      addEventListener("pageshow", vis, on);
      vis();
    }
    if (rule.offscreen !== false && root && typeof IntersectionObserver === "function") {
      const io = new IntersectionObserver((list) => set(OFFSCREEN, !list[list.length - 1]!.isIntersecting));
      io.observe(root);
      signal.addEventListener("abort", () => io.disconnect(), on);
    }
    if (rule.editable !== false) {
      // Typing in the host page's own fields pauses the game (keys belong to the field).
      const edit = (t: EventTarget | null) =>
        t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !root?.contains(t);
      document.addEventListener("focusin", (ev) => set(EDITABLE, !!edit(ev.target)), on);
      document.addEventListener("focusout", () => set(EDITABLE, false), on);
    }
    if (rule.reducedMotion && typeof matchMedia === "function") {
      const mq = matchMedia("(prefers-reduced-motion: reduce)");
      set(MOTION, mq.matches);
      mq.addEventListener("change", () => set(MOTION, mq.matches), on);
    }
  }
  if (o.signal) {
    if (o.signal.aborted) engine.destroy();
    else o.signal.addEventListener("abort", () => engine.destroy(), { signal });
  }
  return engine;
}
