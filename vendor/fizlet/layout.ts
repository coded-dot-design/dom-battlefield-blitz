/**
 * @fzlt/core/layout: force-directed layout on typed arrays, with a Barnes-Hut pass, for diagrams and
 * graphs that settle. Nodes repel (a quadtree, rebuilt each step, sums far groups as one mass:
 * O(n log n)), links pull like springs toward their length, and a weak pull holds the graph
 * around (`cx`, `cy`). One tick per fixed step, so a run replays exactly.
 * - Settle: `alpha` cools from 1 toward 0 over `ticks` steps; when it is spent, or nothing moved
 *   more than `still` px in a step, the layout rests and stops calling `busy()`: the engine sleeps.
 *   `heat()`, `pin()` and `link()` warm it up and wake the engine.
 * - Reduced motion: the whole run happens in one step, so the graph lands where it settles.
 * - Zero allocation per step; fixed capacity (`cap` nodes, `links` links: add and link return -1 when full).
 * - DOM-free: draw it anywhere (@fzlt/core/view-canvas), frame it with @fzlt/core/camera (`bounds`).
 * Distances use steer's exact `hypot` (Math.hypot boxes its arguments).
 */
import type { Engine } from "./kernel/engine";
import { hypot } from "./steer";

/** Options for `layout`: capacity, forces, cooling and motion. */
export interface LayoutOptions {
  /** Nodes (fixed: the arrays never grow). */
  cap: number;
  /** Links (default 2 × cap). */
  links?: number;
  /** Repulsion between nodes, px² per tick (default 30). */
  charge?: number;
  /** A link's rest length in px (default 40; `link` takes its own). */
  distance?: number;
  /** Pull toward the centre, per tick (default 0.04). */
  gravity?: number;
  /** The centre gravity pulls toward, x (default 0). */
  cx?: number;
  /** The centre gravity pulls toward, y (default 0). */
  cy?: number;
  /** Barnes-Hut accuracy: a cell of size s at distance d counts as one mass when s / d < theta (default 0.9). */
  theta?: number;
  /** Velocity kept per tick (default 0.6). */
  keep?: number;
  /** Steps a full run cools over (default 300: five seconds at 60 Hz). */
  ticks?: number;
  /** At rest once no node moves more than this many px in a step (default 0.02). */
  still?: number;
  /** Animate (default: yes, unless the visitor prefers reduced motion; then each run lands at once). */
  motion?: boolean;
}

/** A force-directed layout on typed arrays (`x`, `y`): Barnes-Hut repulsion, links, centre gravity.
 *  It cools over `ticks` steps, then rests and stops calling `busy()` so the engine settles. DOM-free. */
export function layout(engine: Engine, o: LayoutOptions) {
  const n = Math.max(1, o.cap | 0), m = Math.max(1, (o.links ?? 2 * n) | 0), M = 8 * n + 64;
  const charge = o.charge ?? 30, dist = o.distance ?? 40, grav = o.gravity ?? 0.04, theta2 = (o.theta ?? 0.9) ** 2;
  const keep = o.keep ?? 0.6, still = o.still ?? 0.02, decay = 1 - 0.001 ** (1 / (o.ticks ?? 300));
  const mq = o.motion == null && typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const jump = () => (mq ? mq.matches : o.motion === false);
  // Nodes: position, velocity, pin (NaN: free), links per node.
  const x = new Float64Array(n), y = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n);
  const px = new Float64Array(n).fill(NaN), py = new Float64Array(n).fill(NaN), deg = new Uint32Array(n);
  // Links: ends and rest length.
  const ea = new Int32Array(m), eb = new Int32Array(m), el = new Float64Array(m);
  // The quadtree, M cells: body (-1 empty, -2 split), first child, mass, mass-weighted sums, centre, half size.
  const qb = new Int32Array(M), qc = new Int32Array(M), qm = new Float64Array(M), qx = new Float64Array(M), qy = new Float64Array(M);
  const ox = new Float64Array(M), oy = new Float64Array(M), oh = new Float64Array(M), stack = new Int32Array(M);
  // NODES LINKS CELLS used; ALPHA; RESTING; CENTRE X Y; PUSH this tick's repulsion.
  const s = new Float64Array(8);
  const NODES = 0, LINKS = 1, CELLS = 2, ALPHA = 3, REST = 4, CX = 5, CY = 6, PUSH = 7;
  s[CX] = o.cx ?? 0;
  s[CY] = o.cy ?? 0;
  s[REST] = 1;

  // Doubles handed to a call V8 doesn't inline are boxed: the helpers take indices, and read the rest here.
  const empty = (k: number) => {
    qb[k] = -1;
    qm[k] = qx[k] = qy[k] = 0;
  };
  function insert(i: number) {
    let k = 0;
    for (let depth = 0; ; depth++) {
      qm[k] = qm[k]! + 1;
      qx[k] = qx[k]! + x[i]!;
      qy[k] = qy[k]! + y[i]!;
      const b = qb[k]!;
      if (b === -1) return void (qb[k] = i);
      if (b >= 0) {
        // A leaf: split it (unless the two sit on one spot, or the cells ran out: one mass then).
        if (depth > 40 || s[CELLS]! + 4 > M || (x[b] === x[i] && y[b] === y[i])) return;
        const c = (qc[k] = s[CELLS]!), h = oh[k]! / 2;
        s[CELLS] = c + 4;
        for (let q = 0; q < 4; q++) {
          empty(c + q);
          ox[c + q] = ox[k]! + (q & 1 ? h : -h);
          oy[c + q] = oy[k]! + (q & 2 ? h : -h);
          oh[c + q] = h;
        }
        qb[k] = -2;
        const j = c + (x[b]! >= ox[k]! ? 1 : 0) + (y[b]! >= oy[k]! ? 2 : 0);
        qb[j] = b;
        qm[j] = 1;
        qx[j] = x[b]!;
        qy[j] = y[b]!;
      }
      k = qc[k]! + (x[i]! >= ox[k]! ? 1 : 0) + (y[i]! >= oy[k]! ? 2 : 0);
    }
  }
  // Repulsion on node i from every far cell as one mass, near ones body by body.
  function repel(i: number) {
    const w = s[PUSH]!;
    let top = 0;
    stack[top++] = 0;
    while (top) {
      const k = stack[--top]!, mass = qm[k]!;
      if (!mass) continue;
      const dx = qx[k]! / mass - x[i]!, dy = qy[k]! / mass - y[i]!, size = 2 * oh[k]!;
      let d2 = dx * dx + dy * dy;
      if (qb[k] === -2 && size * size >= theta2 * d2) {
        for (let q = 0; q < 4; q++) stack[top++] = qc[k]! + q;
        continue;
      }
      if (qb[k] === i && mass === 1) continue;
      if (d2 < 1e-6) continue; // one spot: no direction to push in (pinned twins stay twins)
      if (d2 < 1) d2 = 1;
      const f = (w * mass) / d2;
      vx[i] = vx[i]! - dx * f;
      vy[i] = vy[i]! - dy * f;
    }
  }

  function tick() {
    const count = s[NODES]!, a = (s[ALPHA] = s[ALPHA]! - s[ALPHA]! * decay);
    // The tree: a square around every node.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < count; i++) {
      x0 = Math.min(x0, x[i]!);
      y0 = Math.min(y0, y[i]!);
      x1 = Math.max(x1, x[i]!);
      y1 = Math.max(y1, y[i]!);
    }
    empty(0);
    ox[0] = (x0 + x1) / 2;
    oy[0] = (y0 + y1) / 2;
    oh[0] = Math.max(x1 - x0, y1 - y0) / 2 + 1;
    s[CELLS] = 1;
    s[PUSH] = charge * a;
    for (let i = 0; i < count; i++) insert(i);
    for (let i = 0; i < count; i++) repel(i);
    // Springs, split by degree (a hub moves less), on the positions the velocities lead to.
    for (let e = 0; e < s[LINKS]!; e++) {
      const i = ea[e]!, j = eb[e]!, di = deg[i]!, dj = deg[j]!;
      const dx = x[j]! + vx[j]! - x[i]! - vx[i]!, dy = y[j]! + vy[j]! - y[i]! - vy[i]!, l = hypot(dx, dy) || 1e-3;
      const f = ((l - el[e]!) / l) * (a / Math.min(di, dj)), bias = di / (di + dj);
      vx[j] = vx[j]! - dx * f * bias;
      vy[j] = vy[j]! - dy * f * bias;
      vx[i] = vx[i]! + dx * f * (1 - bias);
      vy[i] = vy[i]! + dy * f * (1 - bias);
    }
    let most = 0;
    for (let i = 0; i < count; i++) {
      if (px[i] === px[i]) {
        x[i] = px[i]!;
        y[i] = py[i]!;
        vx[i] = vy[i] = 0;
        continue;
      }
      vx[i] = (vx[i]! + (s[CX]! - x[i]!) * grav * a) * keep;
      vy[i] = (vy[i]! + (s[CY]! - y[i]!) * grav * a) * keep;
      x[i] = x[i]! + vx[i]!;
      y[i] = y[i]! + vy[i]!;
      most = Math.max(most, Math.abs(vx[i]!), Math.abs(vy[i]!));
    }
    if (a < 0.001 || most < still) (s[REST] = 1), (s[ALPHA] = 0);
  }

  const lay = {
    x,
    y,
    vx,
    vy,
    /** Nodes and links added so far. */
    get size() {
      return s[NODES]!;
    },
    get links() {
      return s[LINKS]!;
    },
    /** How warm the run is: 1 just heated, 0 at rest. */
    get alpha() {
      return s[ALPHA]!;
    },
    /** At rest: no ticks, no busy(); the engine can settle. */
    get resting() {
      return s[REST]! > 0;
    },
    /** Add a node at (x, y) (default: a sunflower spiral round the centre); its index, or -1 when full. */
    add(ax = NaN, ay = NaN) {
      const i = s[NODES]!;
      if (i >= n) return -1;
      const r = 10 * Math.sqrt(0.5 + i), t = i * Math.PI * (3 - Math.sqrt(5));
      x[i] = ax === ax ? ax : s[CX]! + r * Math.cos(t);
      y[i] = ay === ay ? ay : s[CY]! + r * Math.sin(t);
      s[NODES] = i + 1;
      lay.heat();
      return i;
    },
    /** Link nodes a and b at rest length `len` (default `distance`); its index, or -1 when full. */
    link(a: number, b: number, len = dist) {
      const e = s[LINKS]!;
      if (e >= m || a === b || !(a >= 0 && a < s[NODES]! && b >= 0 && b < s[NODES]!)) return -1;
      ea[e] = a;
      eb[e] = b;
      el[e] = len;
      deg[a]!++;
      deg[b]!++;
      s[LINKS] = e + 1;
      lay.heat();
      return e;
    },
    /** Hold node i at (x, y) (a drag): the rest flows round it. */
    pin(i: number, ax: number, ay: number) {
      if (!(i >= 0 && i < s[NODES]! && ax - ax === 0 && ay - ay === 0)) return;
      px[i] = x[i] = ax;
      py[i] = y[i] = ay;
      lay.heat(0.3);
    },
    /** Let node i go. */
    free(i: number) {
      if (!(i >= 0 && i < n)) return;
      px[i] = py[i] = NaN;
      lay.heat(0.3);
    },
    /** Warm the run up to at least `alpha` (default 1) and wake the engine. */
    heat(alpha = 1) {
      s[ALPHA] = Math.max(s[ALPHA]!, alpha);
      s[REST] = 0;
      engine.wake();
    },
    /** The node nearest (ax, ay) within `r` px, or -1. */
    nearest(ax: number, ay: number, r = Infinity) {
      let best = -1, bd = r;
      for (let i = 0; i < s[NODES]!; i++) {
        const d = hypot(x[i]! - ax, y[i]! - ay);
        if (d <= bd) (bd = d), (best = i);
      }
      return best;
    },
    /** The box round every node, [left, top, right, bottom], into `out` (no allocation). */
    bounds<T extends { [i: number]: number }>(out: T): T {
      out[0] = out[1] = Infinity;
      out[2] = out[3] = -Infinity;
      for (let i = 0; i < s[NODES]!; i++) {
        out[0] = Math.min(out[0]!, x[i]!);
        out[1] = Math.min(out[1]!, y[i]!);
        out[2] = Math.max(out[2]!, x[i]!);
        out[3] = Math.max(out[3]!, y[i]!);
      }
      return out;
    },
    step(e: Engine) {
      if (s[REST]) return;
      // Reduced motion: the whole run now (bounded by the cooling: ≤ `ticks` ticks).
      if (jump()) while (!s[REST]) tick();
      else tick();
      e.busy();
    },
  };
  engine.add(lay);
  return lay;
}
/** What `layout` returns: `x`, `y`, `add`, `link`, `pin`, `free`, `heat`, `nearest`, `bounds`. */
export type Layout = ReturnType<typeof layout>;
