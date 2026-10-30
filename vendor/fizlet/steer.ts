/**
 * fizlet/steer: how things move toward, away from and around a point, as DOM-free steering on
 * typed arrays. Every mover has a position (`x`, `y`), a heading (`a`, radians) that turns at most
 * `turn` rad/s, and moves `speed × scale` px/s along it. Behaviours:
 * - `seek`: drive at a point, stop inside `stop`;
 * - `flee`: drive straight away from a point until `far`;
 * - `arrive`: seek with an arrival band: full pace far off, slower inside `slow`, stop inside `near`;
 *   `arriveGoal` is the same toward the goal the game wrote in `gx[i]`, `gy[i]` (a target that moves
 *   every frame: no double crosses a call, so nothing is boxed);
 * - `wander`: pick a random goal in `area` every `every + random × jitter` s and seek it;
 * - `patrol`: seek waypoints in turn, looping.
 * Each writes the distance moved this call to `moved[i]` (0 when standing). The heading turn and the per-axis
 * wall check (`blocked`, so a mover slides along walls) are DOM Battlefield Blitz's `drive`, and the
 * defaults are its tank numbers, so a port keeps its feel. Nothing allocates: call them from a step,
 * one mover at a time. Pass `engine.random` as `random` so seeded runs replay.
 */
export interface SteerOptions {
  /** Movers (fixed: the arrays never grow). */
  cap: number;
  /** Pixels per second at full pace (default 150) and a multiplier for the board's scale (default 1). */
  speed?: number;
  scale?: number;
  /** Most the heading turns, radians per second (default 7). */
  turn?: number;
  /** Seek, wander and patrol stop inside this many pixels of the goal (default 16). */
  stop?: number;
  /** Arrive: stop inside `near` (14), slow down inside `slow` (140): pace `fast` (1.05) then `calm` (0.8). */
  near?: number;
  slow?: number;
  fast?: number;
  calm?: number;
  /** Flee stops once this far away (default 240). */
  far?: number;
  /** Wander: a new goal every `every` (2) + random × `jitter` (2) seconds, inside `area` [left, top, width, height]. */
  every?: number;
  jitter?: number;
  area?: readonly [number, number, number, number];
  /** Is (at[0], at[1]) a wall for mover i? Checked per axis, so movers slide along walls. The spot
   *  comes in a typed array, not as two numbers: doubles passed to a callback are boxed. */
  blocked?(i: number, at: Float64Array): boolean;
  /** 0..1 (default Math.random; pass engine.random to replay). */
  random?(): number;
}

/** Turn `from` toward `to` by at most `max` radians, the short way round. */
export const turn = (from: number, to: number, max: number) => {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.sign(d) * Math.min(Math.abs(d), max);
};

/**
 * Math.hypot of two numbers, without the builtin call: V8 boxes Math.hypot's arguments, a heap
 * number per call in a hot loop. Same steps as V8's own (Infinity wins over NaN, scale by the
 * larger, sum, sqrt), so it returns the same bits (tested against Math.hypot).
 */
export const hypot = (dx: number, dy: number) => {
  // One expression, no early return: a return of 0 beside a double makes V8 box the result.
  const ax = Math.abs(dx), ay = Math.abs(dy), max = ax > ay ? ax : ay, z = max === 0 ? 1 : max, p = ax / z, q = ay / z;
  return ax === Infinity || ay === Infinity ? Infinity : Math.sqrt(p * p + q * q) * max;
};

export function steer(o: SteerOptions) {
  const n = Math.max(1, o.cap | 0), speed = o.speed ?? 150, scale = o.scale ?? 1, rate = o.turn ?? 7, stop = o.stop ?? 16;
  const near = o.near ?? 14, slow = o.slow ?? 140, fast = o.fast ?? 1.05, calm = o.calm ?? 0.8, far = o.far ?? 240;
  const every = o.every ?? 2, jitter = o.jitter ?? 2, area = o.area ?? [0, 0, 640, 480];
  const blocked = o.blocked, random = o.random ?? Math.random;
  const x = new Float64Array(n), y = new Float64Array(n), a = new Float64Array(n);
  const gx = new Float64Array(n), gy = new Float64Array(n), think = new Float64Array(n), leg = new Uint32Array(n);

  // Scratch for the drive in progress (stick x, y, dt): doubles passed or returned across a call V8
  // doesn't inline are boxed, so the inner helpers trade them through typed arrays instead.
  const v = new Float64Array(3), at = new Float64Array(2), moved = new Float64Array(n);
  function go(i: number) {
    const m = Math.min(1, hypot(v[0]!, v[1]!));
    if (m < 0.05) return void (moved[i] = 0);
    const to = Math.atan2(v[1]!, v[0]!), d = Math.atan2(Math.sin(to - a[i]!), Math.cos(to - a[i]!)), dt = v[2]!;
    a[i] = a[i]! + Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    const sp = speed * m * scale * dt, nx = x[i]! + Math.cos(a[i]!) * sp, ny = y[i]! + Math.sin(a[i]!) * sp;
    at[0] = nx; at[1] = y[i]!;
    if (!blocked?.(i, at)) x[i] = nx;
    at[0] = x[i]!; at[1] = ny;
    if (!blocked?.(i, at)) y[i] = ny;
    moved[i] = sp;
  }
  /** Toward goal (v[0], v[1]) for v[2] seconds at `pace`, until inside `within`. A pace below 0 is
   *  arrive's band (`fast` outside `slow`, `calm` inside): one distance, and no extra call to inline. */
  function toward(i: number, pace: number, within: number) {
    const dx = v[0]! - x[i]!, dy = v[1]! - y[i]!, d = hypot(dx, dy);
    if (d <= within) return void (moved[i] = 0);
    v[0] = dx / d; v[1] = dy / d; v[2] = v[2]! * (pace < 0 ? (d > slow ? fast : calm) : pace);
    go(i);
  }
  return {
    x, y, a,
    /** The goal: wander's current one (and seconds until it picks the next), or one the game writes for `arriveGoal`. */
    gx, gy, think,
    /** Patrol: the waypoint each mover is heading for. */
    leg,
    cap: n,
    /** Put mover i at (px, py) facing `heading`; wander picks a goal at once, patrol starts at 0. */
    place(i: number, px: number, py: number, heading = 0) {
      x[i] = gx[i] = px; y[i] = gy[i] = py; a[i] = heading; think[i] = 0; leg[i] = 0;
    },
    /** Pixels each mover went on its last call (0 when it stood). */
    moved,
    /** Drive mover i along (ax, ay) (a stick, length ≤ 1) for dt seconds. */
    drive(i: number, ax: number, ay: number, dt: number) {
      v[0] = ax; v[1] = ay; v[2] = dt;
      go(i);
    },
    /** Toward (tx, ty) at `pace` (dt is scaled by it, so the turn slows too), until inside `stop`. */
    seek(i: number, tx: number, ty: number, dt: number, pace = 1) {
      v[0] = tx; v[1] = ty; v[2] = dt;
      toward(i, pace, stop);
    },
    flee(i: number, fx: number, fy: number, dt: number, pace = 1) {
      const dx = x[i]! - fx, dy = y[i]! - fy, d = hypot(dx, dy);
      if (d >= far || d === 0) return void (moved[i] = 0);
      v[0] = dx / d; v[1] = dy / d; v[2] = dt * pace;
      go(i);
    },
    arrive(i: number, tx: number, ty: number, dt: number) {
      v[0] = tx; v[1] = ty; v[2] = dt;
      toward(i, -1, near);
    },
    /**
     * `arrive` toward (gx[i], gy[i]): write the goal there, then call it. For a goal computed every
     * frame (a slot behind a leader): passed as two numbers, V8 boxes each one whenever it doesn't
     * inline the call (3 young GCs per 20k steps in Blitz's platoons); a typed array never boxes.
     */
    arriveGoal(i: number, dt: number) {
      v[0] = gx[i]!; v[1] = gy[i]!; v[2] = dt;
      toward(i, -1, near);
    },
    wander(i: number, dt: number, pace = 1) {
      if ((think[i]! -= dt) <= 0) {
        think[i] = every + random() * jitter;
        gx[i] = area[0] + random() * area[2];
        gy[i] = area[1] + random() * area[3];
      }
      v[0] = gx[i]!; v[1] = gy[i]!; v[2] = dt;
      toward(i, pace, stop);
    },
    /** Waypoints as [x0, y0, x1, y1, …] (a typed array is best); the next one once inside `stop`. */
    patrol(i: number, points: ArrayLike<number>, dt: number, pace = 1) {
      const k = (leg[i]! % (points.length >> 1)) << 1, px = points[k]!, py = points[k + 1]!;
      if (hypot(px - x[i]!, py - y[i]!) <= stop) leg[i] = (leg[i]! + 1) % (points.length >> 1);
      const j = leg[i]! << 1;
      v[0] = points[j]!; v[1] = points[j + 1]!; v[2] = dt;
      toward(i, pace, stop);
    },
  };
}
export type Steer = ReturnType<typeof steer>;
