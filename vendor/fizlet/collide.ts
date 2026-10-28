/**
 * fizlet/collide: a fixed-capacity spatial hash (no allocation per insert or query) and the shape
 * tests games need: circle–circle, circle–rect, swept segment–circle.
 */

type Nums = Float64Array | Float32Array;

/** Spatial hash over a w×h world. Insert ids each step (after clear), then query a circle. */
export class Grid {
  cell: number;
  cols = 0;
  rows = 0;
  private head = new Int32Array(0);
  private readonly next: Int32Array;
  private readonly ids: Int32Array;
  private readonly stamp: Int32Array;
  private used = 0;
  private mark = 0;
  /** Inserts dropped because the node store was full (raise `cap`). */
  dropped = 0;
  constructor(cell: number, cap: number, w: number, h: number) {
    this.cell = cell;
    this.next = new Int32Array(cap * 4);
    this.ids = new Int32Array(cap * 4);
    this.stamp = new Int32Array(cap);
    this.resize(w, h);
  }
  /** World size changed (resize is not a hot path). */
  resize(w: number, h: number) {
    this.cols = Math.max(1, Math.ceil(w / this.cell));
    this.rows = Math.max(1, Math.ceil(h / this.cell));
    if (this.head.length < this.cols * this.rows) this.head = new Int32Array(this.cols * this.rows);
    this.clear();
  }
  clear() {
    this.head.fill(-1);
    this.used = 0;
  }
  /** Add id (0..cap-1) covering the circle (x, y, r). */
  insert(id: number, x: number, y: number, r: number) {
    const c = this.cell, mx = this.cols - 1, my = this.rows - 1;
    let x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    x0 = x0 < 0 ? 0 : x0 > mx ? mx : x0;
    x1 = x1 < 0 ? 0 : x1 > mx ? mx : x1;
    y0 = y0 < 0 ? 0 : y0 > my ? my : y0;
    y1 = y1 < 0 ? 0 : y1 > my ? my : y1;
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++) {
        if (this.used === this.ids.length) return void this.dropped++;
        const k = gy * this.cols + gx, n = this.used++;
        this.ids[n] = id;
        this.next[n] = this.head[k]!;
        this.head[k] = n;
      }
  }
  /**
   * Hot-path forms: read body i's x, y, r from typed arrays (arrays and integers never box, even
   * when a big step function stops V8 inlining these calls). `pad` widens the search radius.
   */
  add(x: Nums, y: Nums, r: Nums, i: number) {
    this.insert(i, x[i]!, y[i]!, r[i]!);
  }
  near(x: Nums, y: Nums, r: Nums, i: number, out: Int32Array, pad = 0) {
    return this.query(x[i]!, y[i]!, r[i]! + pad, out);
  }
  /** Ids whose cells touch the circle, each once, into `out`. Returns the count. */
  query(x: number, y: number, r: number, out: Int32Array): number {
    const m = ++this.mark, c = this.cell, mx = this.cols - 1, my = this.rows - 1;
    let x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    x0 = x0 < 0 ? 0 : x0 > mx ? mx : x0;
    x1 = x1 < 0 ? 0 : x1 > mx ? mx : x1;
    y0 = y0 < 0 ? 0 : y0 > my ? my : y0;
    y1 = y1 < 0 ? 0 : y1 > my ? my : y1;
    let count = 0;
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++)
        for (let n = this.head[gy * this.cols + gx]!; n >= 0; n = this.next[n]!) {
          const id = this.ids[n]!;
          if (this.stamp[id] === m || count === out.length) continue;
          this.stamp[id] = m;
          out[count++] = id;
        }
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
