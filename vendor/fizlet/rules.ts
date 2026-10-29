/**
 * fizlet/rules: the rules every arcade game repeats, as three small systems on the kernel:
 * - `waves`: a wave clock, prepare → assault → rebuild, with a spawn budget per wave;
 * - `drops`: pickups that fall, wait to be collected and expire;
 * - `score`: points, a combo that decays, and levels from XP thresholds.
 * Each is DOM-free, steps without allocating (state lives in typed arrays) and says what happened
 * on the event ring (`wave:start`, `wave:clear`, `drop:spawn`, `drop:land`, `drop:collect`, `drop:expire`,
 * `score`, `combo:end`, `level`), so the HUD, sound, fx and coach layers react without reaching
 * into the game. Defaults are the DOM VIRUS core's (WaveDirector, SupplyDrops) and Null Invaders'
 * numbers, so a port keeps its feel. The game still decides where and what to spawn. Call
 * `collect`, `add` and `miss` from a step, like the rest of the game: their events go on that
 * frame's ring.
 */
import type { Engine, System } from "./kernel/engine";

export type WavePhase = "prepare" | "assault" | "rebuild";
const PHASES: readonly WavePhase[] = ["prepare", "assault", "rebuild"];
const PREPARE = 0, ASSAULT = 1, REBUILD = 2;

export interface WaveOptions {
  /** Alive now. A wave clears when it has spawned everything and this reaches 0. */
  alive(): number;
  /** Most alive at once, whatever the wave (default 32). */
  cap?: number;
  /** Seconds before wave 1 (default 4) and between waves (default 8). */
  prepare?: number;
  rebuild?: number;
  /** Enemies in wave n (default min(40, 5 + 5n)). */
  size?(wave: number): number;
  /** Most alive at once in wave n, before `cap` (default 8 + 4n). */
  limit?(wave: number): number;
  /** Seconds between two spawns in wave n (default max(0.7, 2.1 − 0.12n)). */
  gap?(wave: number): number;
}

export function waves(e: Engine, o: WaveOptions) {
  const cap = Math.max(1, Math.floor(o.cap ?? 32)), prep = o.prepare ?? 4, rest = o.rebuild ?? 8;
  const size = o.size ?? ((w: number) => Math.min(40, 5 + w * 5));
  const limit = o.limit ?? ((w: number) => 8 + w * 4);
  const gap = o.gap ?? ((w: number) => Math.max(0.7, 2.1 - w * 0.12));
  // wave, phase, left to spawn, countdown, time to the next spawn
  const s = new Float64Array(5);
  const reset = () => void s.set([1, PREPARE, 0, prep, 0]);
  reset();
  const system: System = {
    step(_, dt) {
      s[4]! -= dt;
      if (s[1] !== ASSAULT) {
        s[3] = Math.max(0, s[3]! - dt);
        if (s[3] === 0) {
          if (s[1] === REBUILD) s[0]!++;
          s[1] = ASSAULT;
          s[2] = size(s[0]!);
          s[4] = 0;
          e.events.emit("wave:start", s[0], s[2]);
        }
      } else if (s[2] === 0 && o.alive() === 0) {
        s[1] = REBUILD;
        s[3] = rest;
        e.events.emit("wave:clear", s[0]);
      }
    },
  };
  e.add(system);
  return {
    system,
    get wave() { return s[0]!; },
    get phase() { return PHASES[s[1]!]!; },
    /** Enemies this wave still has to spawn. */
    get left() { return s[2]!; },
    /** Seconds until the next wave starts (prepare, rebuild). */
    get countdown() { return s[3]!; },
    /** Most alive at once in this wave. */
    get limit() { return Math.min(cap, limit(s[0]!)); },
    /** Spawn one now? Assault, enemies left, the gap has passed and the board is under the limit. */
    ready() { return s[1] === ASSAULT && s[2]! > 0 && s[4]! <= 0 && o.alive() < Math.min(cap, limit(s[0]!)); },
    /** One spawned: count it and wait the gap. */
    spawned() {
      if (s[2]! > 0) s[2]!--;
      s[4] = gap(s[0]!);
    },
    reset,
  };
}

export interface DropOptions<K extends string> {
  kinds: readonly K[];
  /** Most on the board at once (default 6). */
  cap?: number;
  /** Seconds between timed drops; 0 or left out: only `spawn()` drops. */
  every?: number;
  /** Where the next timed drop lands: write x, y into `out`. Return false to skip this one. */
  place?(out: Float64Array): boolean | void;
  /** Kind of the n-th timed drop, as an index into `kinds` (default: in turn). */
  pick?(n: number): number;
  /** Seconds a drop lasts (default 14), how far it falls (default 60 px) and how fast (default 90 px/s). */
  life?: number;
  fall?: number;
  speed?: number;
}

export function drops<K extends string>(e: Engine, o: DropOptions<K>) {
  const cap = Math.max(1, Math.floor(o.cap ?? 6)), every = o.every ?? 0, life = o.life ?? 14;
  const fall = o.fall ?? 60, speed = o.speed ?? 90, kinds = o.kinds;
  const x = new Float64Array(cap), y = new Float64Array(cap), to = new Float64Array(cap), left = new Float64Array(cap), age = new Float64Array(cap);
  const kind = new Uint8Array(cap), at = new Float64Array(2);
  // drops on the board, time to the next timed drop, timed drops so far
  const s = new Float64Array([0, every, 0]);
  const remove = (i: number) => {
    const j = --s[0]!;
    x[i] = x[j]!; y[i] = y[j]!; to[i] = to[j]!; left[i] = left[j]!; age[i] = age[j]!; kind[i] = kind[j]!;
  };
  const spawn = (px: number, py: number, k = 0) => {
    if (s[0] === cap || k < 0 || k >= kinds.length) return false;
    const i = s[0]!++;
    x[i] = px; y[i] = py - fall; to[i] = py; left[i] = life; age[i] = 0; kind[i] = k;
    e.events.emit("drop:spawn", k, 0, px, py);
    return true;
  };
  const system: System = {
    step(_, dt) {
      if (every > 0 && (s[1]! -= dt) <= 0) {
        s[1] = every;
        if (!o.place || o.place(at) !== false) spawn(at[0]!, at[1]!, o.pick ? o.pick(s[2]!) : s[2]! % kinds.length);
        s[2]!++;
      }
      for (let i = s[0]! - 1; i >= 0; i--) {
        const air = y[i]! < to[i]!;
        y[i] = Math.min(to[i]!, y[i]! + speed * dt);
        age[i]! += dt;
        if (air && y[i]! >= to[i]!) e.events.emit("drop:land", kind[i], 0, x[i], y[i]);
        if ((left[i]! -= dt) <= 0) {
          e.events.emit("drop:expire", kind[i], 0, x[i], y[i]);
          remove(i);
        }
      }
    },
  };
  e.add(system);
  return {
    system,
    /** Positions and kinds of the drops on the board, for drawing: index 0 to `count` − 1. */
    x, y, kind,
    /** Seconds since each drop spawned (fall shadow, blink: `life` − age is the time left). */
    age,
    /** Where each drop lands: (x[i], landY[i]). Moves with `scroll`. */
    landY: to,
    /** Seconds a drop lasts, as configured. */
    life,
    get count() { return s[0]!; },
    /** Has drop i landed (only landed drops can be collected)? */
    landed: (i: number) => y[i]! >= to[i]!,
    spawn,
    /** The kind of the first landed drop within r of (px, py), removed; or null. */
    collect(px: number, py: number, r: number): K | null {
      for (let i = 0; i < s[0]!; i++) {
        const dx = px - x[i]!, dy = py - y[i]!;
        if (y[i]! >= to[i]! && dx * dx + dy * dy < r * r) {
          const k = kind[i]!;
          e.events.emit("drop:collect", k, 0, x[i], y[i]);
          remove(i);
          return kinds[k]!;
        }
      }
      return null;
    },
    /** The page scrolled: move every drop with it. */
    scroll(dx: number, dy: number) {
      for (let i = 0; i < s[0]!; i++) { x[i]! -= dx; y[i]! -= dy; to[i]! -= dy; }
    },
    reset() { s.set([0, every, 0]); },
  };
}

export interface ScoreOptions {
  /** A streak lasts `window` seconds after each hit (default 3); the multiplier is
   *  min(max, 1 + floor(streak / step)) (defaults 3 and 5). false: no combo. */
  combo?: { window?: number; step?: number; max?: number } | false;
  /** XP to reach each level after level 0, rising (e.g. [8, 24, 50] gives levels 0 to 3). */
  levels?: readonly number[];
}

export function score(e: Engine, o: ScoreOptions = {}) {
  const c = o.combo === false ? null : o.combo ?? {}, win = c?.window ?? 3, step = c?.step ?? 3, max = c?.max ?? 5;
  const levels = o.levels ?? [];
  // points, streak, streak time left, xp, level
  const s = new Float64Array(5);
  const combo = () => (c ? Math.min(max, 1 + Math.floor(s[1]! / step)) : 1);
  const system: System = {
    step(_, dt) {
      if (s[1]! > 0 && (s[2]! -= dt) <= 0) {
        e.events.emit("combo:end", s[1]);
        s[1] = 0;
      }
    },
  };
  e.add(system);
  return {
    system,
    get points() { return s[0]!; },
    get streak() { return s[1]!; },
    get xp() { return s[3]!; },
    get level() { return s[4]!; },
    /** The multiplier the next hit gets. */
    get combo() { return combo(); },
    /** XP still needed for the next level, or -1 at the top. */
    get next() { return s[4]! < levels.length ? levels[s[4]!]! - s[3]! : -1; },
    /** A hit: `points` × the combo, plus `xp`. Returns the points awarded. Event `score` (a: points, b: multiplier, at x, y). */
    add(points: number, xp = 0, px = 0, py = 0) {
      const m = combo(), got = points * m;
      s[0]! += got;
      if (c) { s[1]!++; s[2] = win; }
      s[3]! += xp;
      e.events.emit("score", got, m, px, py);
      while (s[4]! < levels.length && s[3]! >= levels[s[4]!]!) e.events.emit("level", ++s[4]!, 0, px, py);
      return got;
    },
    /** A miss: the streak ends now. */
    miss() {
      if (s[1]! > 0) e.events.emit("combo:end", s[1]);
      s[1] = 0;
    },
    reset() { s.fill(0); },
  };
}
