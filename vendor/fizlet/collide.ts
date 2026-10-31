/**
 * @fzlt/core/collide: a fixed-capacity spatial hash (no allocation per insert or query) and the shape
 * tests games need: circle–circle, circle–rect, swept segment–circle.
 */

type Nums = Float64Array | Float32Array;

/** `v` is a finite number (NaN and ±Infinity fail). No allocation: safe in the hot path. */
const finite = (v: number) => v - v === 0;
/** A positive integer (constructor checks: not a hot path). */
function count(name: string, v: number) {
  if (!(Number.isInteger(v) && v > 0)) throw new RangeError(`Grid: ${name} must be a positive integer, got ${v}`);
  return v;
}
/** A finite number above zero. */
function size(name: string, v: number) {
  if (!(finite(v) && v > 0)) throw new RangeError(`Grid: ${name} must be a finite number above 0, got ${v}`);
  return v;
}

/**
 * Spatial hash over a w×h world. Insert ids each step (after clear), then query a circle.
 * Three separate capacities, each saturating visibly (counters, never silent):
 * - entities `cap`: ids 0..cap-1; any other id (or a non-finite x, y, r) is refused, `rejected`;
 * - index `nodes` (default cap × 4): one node per cell a body covers; past it, `dropped`;
 * - query results: the caller's `out` buffer; ids that don't fit set `missed` (this query) and
 *   count in `truncated` (queries cut short). Size `out` so `missed` stays 0: collision results
 *   must not drop, so a game should treat any of these counters rising as a bug.
 */
export class Grid {
  cell: number;
  cols = 0;
  rows = 0;
  /** Entity capacity: valid ids are 0..cap-1. */
  readonly cap: number;
  /** Index capacity: cell entries per step (a body covering 4 cells takes 4). */
  readonly nodes: number;
  // Private names are one letter on purpose (esbuild keeps property names; board-page ships this):
  // h cell heads, n next node, d node ids, s query stamps, u nodes used, k stamp; a the circle,
  // p put, q scan.
  private h = new Int32Array(0);
  private readonly n: Int32Array;
  private readonly d: Int32Array;
  private readonly s: Int32Array;
  private u = 0;
  private k = 0;
  /** Index entries refused because the node store was full (raise `nodes`). Cumulative. */
  dropped = 0;
  /** Inserts and queries refused: id outside 0..cap-1, or a non-finite (or negative r) circle. Cumulative. */
  rejected = 0;
  /** Queries whose result did not fit in `out`. Cumulative. */
  truncated = 0;
  /** Ids the last query found but could not write to `out` (0 = complete). */
  missed = 0;
  constructor(cell: number, cap: number, w: number, h: number, nodes = cap * 4) {
    this.cell = size("cell", cell);
    this.cap = count("cap", cap);
    this.nodes = count("nodes", nodes);
    this.n = new Int32Array(nodes);
    this.d = new Int32Array(nodes);
    this.s = new Int32Array(cap);
    this.resize(w, h);
  }
  /** World size changed (resize is not a hot path). */
  resize(w: number, h: number) {
    this.cols = Math.max(1, Math.ceil(size("w", w) / this.cell));
    this.rows = Math.max(1, Math.ceil(size("h", h) / this.cell));
    if (this.h.length < this.cols * this.rows) this.h = new Int32Array(this.cols * this.rows);
    this.clear();
  }
  clear() {
    this.h.fill(-1);
    this.u = 0;
  }
  /** The circle being inserted or queried. The work below takes only integers, so a call that
   *  V8 doesn't inline never boxes a number (numbers stay in this typed array). */
  private readonly a = new Float64Array(3);
  /** Add id (0..cap-1) covering the circle (x, y, r). */
  insert(id: number, x: number, y: number, r: number) {
    const a = this.a;
    a[0] = x;
    a[1] = y;
    a[2] = r;
    this.p(id);
  }
  private p(id: number) {
    const a = this.a, x = a[0]!, y = a[1]!, r = a[2]!;
    if (!((id | 0) === id && id >= 0 && id < this.cap && finite(x) && finite(y) && finite(r) && r >= 0)) return void this.rejected++;
    const c = this.cell, mx = this.cols - 1, my = this.rows - 1;
    let x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    x0 = x0 < 0 ? 0 : x0 > mx ? mx : x0;
    x1 = x1 < 0 ? 0 : x1 > mx ? mx : x1;
    y0 = y0 < 0 ? 0 : y0 > my ? my : y0;
    y1 = y1 < 0 ? 0 : y1 > my ? my : y1;
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++) {
        if (this.u === this.nodes) {
          this.dropped += (y1 - gy) * (x1 - x0 + 1) + x1 - gx + 1;
          return;
        }
        const k = gy * this.cols + gx, n = this.u++;
        this.d[n] = id;
        this.n[n] = this.h[k]!;
        this.h[k] = n;
      }
  }
  /**
   * Hot-path forms: read body i's x, y, r from typed arrays (arrays and integers never box, even
   * when a big step function stops V8 inlining these calls). `pad` widens the search radius.
   */
  add(x: Nums, y: Nums, r: Nums, i: number) {
    const a = this.a;
    a[0] = x[i]!;
    a[1] = y[i]!;
    a[2] = r[i]!;
    this.p(i);
  }
  near(x: Nums, y: Nums, r: Nums, i: number, out: Int32Array, pad = 0) {
    const a = this.a;
    a[0] = x[i]!;
    a[1] = y[i]!;
    a[2] = r[i]! + pad;
    return this.q(out);
  }
  /**
   * Ids whose cells touch the circle, each once, into `out`. Returns the count written. If more
   * were found than `out` holds, `missed` says how many (and `truncated` counts the query).
   */
  query(x: number, y: number, r: number, out: Int32Array): number {
    const a = this.a;
    a[0] = x;
    a[1] = y;
    a[2] = r;
    return this.q(out);
  }
  private q(out: Int32Array): number {
    const a = this.a, x = a[0]!, y = a[1]!, r = a[2]!;
    this.missed = 0;
    if (!(finite(x) && finite(y) && finite(r))) return this.rejected++, 0;
    // The dedupe stamp wraps after 2^31 queries: start the stamps over instead of aliasing.
    if (this.k === 0x7fffffff) this.s.fill(0), (this.k = 0);
    const m = ++this.k, c = this.cell, mx = this.cols - 1, my = this.rows - 1;
    let x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    x0 = x0 < 0 ? 0 : x0 > mx ? mx : x0;
    x1 = x1 < 0 ? 0 : x1 > mx ? mx : x1;
    y0 = y0 < 0 ? 0 : y0 > my ? my : y0;
    y1 = y1 < 0 ? 0 : y1 > my ? my : y1;
    let count = 0, missed = 0;
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++)
        for (let n = this.h[gy * this.cols + gx]!; n >= 0; n = this.n[n]!) {
          const id = this.d[n]!;
          if (this.s[id] === m) continue;
          this.s[id] = m;
          if (count === out.length) missed++;
          else out[count++] = id;
        }
    if (missed) (this.missed = missed), this.truncated++;
    return count;
  }
}

/** Two circles overlap. */
export const circles = (ax: number, ay: number, ar: number, bx: number, by: number, br: number) =>
  (ax - bx) * (ax - bx) + (ay - by) * (ay - by) < (ar + br) * (ar + br);

/**
 * Bodies i and j overlap, reading x, y, r from typed arrays. Prefer this in big step functions:
 * it passes arrays and integers, so V8 never boxes numbers even when the call isn't inlined
 * (number arguments to a non-inlined function allocate).
 */
export function overlap(x: Nums, y: Nums, r: Nums, i: number, j: number) {
  const dx = x[i]! - x[j]!, dy = y[i]! - y[j]!, rr = r[i]! + r[j]!;
  return dx * dx + dy * dy < rr * rr;
}

/** A circle overlaps a rect (x, y, w, h). */
export function circleRect(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number) {
  const dx = cx - (cx < x ? x : cx > x + w ? x + w : cx), dy = cy - (cy < y ? y : cy > y + h ? y + h : cy);
  return dx * dx + dy * dy < r * r;
}

/** A point is inside a rect. */
export const inRect = (px: number, py: number, x: number, y: number, w: number, h: number) => px >= x && px <= x + w && py >= y && py <= y + h;

/**
 * Swept hit: where along the segment (x0, y0) → (x1, y1) it first touches the circle, as 0..1,
 * or -1 for a miss. Use it for fast shots so they never tunnel through a target.
 */
export function segCircle(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, r: number) {
  const dx = x1 - x0, dy = y1 - y0, fx = x0 - cx, fy = y0 - cy;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  if (a === 0) return -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}
