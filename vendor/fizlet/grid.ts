/**
 * @fzlt/core/grid: the game board. A cols × rows tile grid in typed arrays (terrain id, move cost,
 * flags), A* paths, line of sight, movement range and seeded terrain. Every search reuses buffers
 * made once by `board()`, so no call allocates. Cell ids are `row * cols + col`.
 *
 * Not collision: @fzlt/core/collide's `Grid` re-buckets moving bodies every step; a `Board` holds the
 * ground they move over. Use the same cell size for both and a body's collide bucket is its cell.
 * The size is checked at setup: `cols` and `rows` are positive integers, `cell` a finite number > 0
 * (a RangeError names all three).
 */

/** Flags: BLOCKED stops movement and sight, COVER stops sight (pass it in a mask), OCCUPIED marks
 *  a unit standing there (paths avoid it unless it is the goal). Bits 8–128 are yours. */
export const BLOCKED = 1, COVER = 2, OCCUPIED = 4;

// Orthogonal steps first, then diagonals (k > 3).
const DX = [1, -1, 0, 0, 1, -1, 1, -1], DY = [0, 0, 1, -1, 1, 1, -1, -1];

/** Options for `board()`: the cell size in world units and whether moves go 8-way. */
export interface BoardOptions {
  /** World units per cell (default 1: world = grid units). */
  cell?: number;
  /** 8-way moves (never cutting a blocked corner). Default false: 4-way. */
  diagonal?: boolean;
}

/** The board `board()` makes: typed-array terrain, cost and flags per cell, plus the searches (A*
 *  paths, line of sight, movement range) on buffers made once. Make one with `board()`. */
export class Board {
  declare readonly cols: number;
  declare readonly rows: number;
  declare readonly cell: number;
  declare diagonal: boolean;
  /** Per cell: your terrain id (0 = open ground), move cost to enter (1–255, default 1), flags.
   *  Plain typed arrays: write them directly (`flags[i] |= OCCUPIED`, `flags.fill(0)` to reset). */
  declare readonly terrain: Uint8Array;
  declare readonly cost: Uint8Array;
  declare readonly flags: Uint8Array;
  /** Cells the last search expanded; `partial` is true when the last path ran out of budget. */
  expanded = 0;
  partial = false;
  // Search buffers: cost so far (tenths: an orthogonal step into a cost-1 cell is 10, a diagonal 14),
  // priority, parent, a binary heap with positions (decrease-key, so it never holds more than n),
  // and one stamp per cell (mark: queued, mark + 1: settled) so nothing is cleared between calls.
  // Private names are one letter on purpose (esbuild keeps property names): v via (parent), q heap,
  // p heap positions, s seen stamps, k mark, z heap size, b best, x/y target col/row; r run, u push,
  // o pop, w sift up.
  declare private readonly g: Int32Array;
  declare private readonly f: Int32Array;
  declare private readonly v: Int32Array;
  declare private readonly q: Int32Array;
  declare private readonly p: Int32Array;
  declare private readonly s: Int32Array;
  private k = 0;
  private z = 0;
  private b = 0;
  private x = 0;
  private y = 0;

  constructor(cols: number, rows: number, opts: BoardOptions = {}) {
    const n = (this.cols = cols) * (this.rows = rows), cell = (this.cell = opts.cell ?? 1);
    if (!(cols >= 1 && rows >= 1 && cols % 1 === 0 && rows % 1 === 0 && cell > 0 && cell - cell === 0 && typeof cols + typeof rows + typeof cell == "numbernumbernumber"))
      throw new RangeError(`fizlet/grid: cols ${cols}, rows ${rows}, cell ${cell}`);
    this.diagonal = !!opts.diagonal;
    this.terrain = new Uint8Array(n);
    this.cost = new Uint8Array(n).fill(1);
    this.flags = new Uint8Array(n);
    this.g = new Int32Array(n);
    this.f = new Int32Array(n);
    this.v = new Int32Array(n);
    this.q = new Int32Array(n);
    this.p = new Int32Array(n);
    this.s = new Int32Array(n);
  }

  /** The cell under a world point, clamped to the board (so always a valid id). */
  at(x: number, y: number) {
    const c = Math.floor(x / this.cell), r = Math.floor(y / this.cell), mc = this.cols - 1, mr = this.rows - 1;
    return (r < 0 ? 0 : r > mr ? mr : r) * this.cols + (c < 0 ? 0 : c > mc ? mc : c);
  }
  /** Hot-path form: the cell under body i, reading typed arrays (nothing boxes). */
  cellOf(x: Float64Array | Float32Array, y: Float64Array | Float32Array, i: number) {
    return this.at(x[i]!, y[i]!);
  }
  /** World centre of cell i into out[k], out[k + 1]. */
  center(i: number, out: Float64Array | Float32Array, k = 0) {
    const c = i % this.cols;
    out[k] = (c + 0.5) * this.cell;
    out[k + 1] = ((i - c) / this.cols + 0.5) * this.cell;
  }
  set(i: number, terrain: number, cost = 1, flags = 0) {
    this.terrain[i] = terrain;
    this.cost[i] = cost;
    this.flags[i] = flags;
  }

  /**
   * Seeded terrain: inside the rect (c0, r0)–(c1, r1) (default the whole board), each open cell
   * (terrain 0, no flags) becomes `terrain` with chance `density`. One draw per cell in the rect,
   * whatever is there, so the same seed always lays the same board. Returns cells placed.
   */
  scatter(rand: () => number, density: number, terrain: number, cost = 1, flags = BLOCKED, c0 = 0, r0 = 0, c1 = this.cols, r1 = this.rows) {
    let placed = 0;
    for (let r = r0; r < r1; r++)
      for (let c = c0; c < c1; c++) {
        const i = r * this.cols + c;
        if (rand() < density && !this.terrain[i] && !this.flags[i]) this.set(i, terrain, cost, flags), placed++;
      }
    return placed;
  }
  /** A random cell with none of `mask`, or -1 after `tries` misses (spawns, pickups, crates). */
  pick(rand: () => number, mask = BLOCKED | OCCUPIED, tries = 32) {
    for (let k = 0; k < tries; k++) {
      const i = Math.floor(rand() * this.flags.length);
      if (!(this.flags[i]! & mask)) return i;
    }
    return -1;
  }

  /**
   * A* from `from` to `to` into `out`: the cells to step through, start excluded, goal last.
   * Returns the step count (0 when from === to, -1 for no path); if it is over out.length only the
   * first out.length steps are written. `budget` caps the cells expanded (0 = no cap) so a frame
   * never stalls: on a cap it writes the path to the closest cell found and sets `partial`.
   * Cells with any `avoid` flag are walls, except that the goal may be OCCUPIED.
   */
  path(from: number, to: number, out: Int32Array, budget = 0, avoid = BLOCKED | OCCUPIED) {
    this.partial = false;
    if (from === to) return 0;
    if (this.flags[to]! & BLOCKED) return -1;
    let end = this.r(from, to, avoid, 0x7fffffff, budget, out);
    if (end === -1) return -1;
    if (end === -2) (this.partial = true), (end = this.b);
    const via = this.v;
    let n = 0;
    for (let i = end; i !== from; i = via[i]!) n++;
    for (let i = end, k = n; i !== from; i = via[i]!) if (--k < out.length) out[k] = i;
    return n;
  }

  /**
   * Movement range: every cell reachable from `from` for at most `max` cost (an orthogonal step
   * into a cost-1 cell costs 1, a diagonal 1.4), nearest first, start included. Returns the count
   * (capped at out.length). `dist(i)` then reads each cell's cost.
   */
  flood(from: number, max: number, out: Int32Array, avoid = BLOCKED | OCCUPIED) {
    this.r(from, -1, avoid, max * 10, 0, out);
    return this.b;
  }
  /** Cost from the last search's start to cell i (exact after flood), or -1 if it was not reached. */
  dist(i: number) {
    return this.s[i]! >= this.k ? this.g[i]! / 10 : -1;
  }

  /** Line of sight between two cells: no cell strictly between them has a `mask` flag.
   *  Symmetric (a sees b exactly when b sees a). Pass BLOCKED | COVER to let cover block it. */
  los(a: number, b: number, mask = BLOCKED) {
    return (a < b ? this.hit(a, b, mask) : this.hit(b, a, mask)) < 0;
  }
  /** The first cell strictly between a and b (walking from a) with a `mask` flag, or -1 if clear.
   *  Bresenham over cells: what a shot hits on its way. */
  hit(a: number, b: number, mask = BLOCKED) {
    const cols = this.cols, x1 = b % cols, y1 = (b - x1) / cols;
    let x = a % cols, y = (a - x) / cols;
    const dx = Math.abs(x1 - x), dy = -Math.abs(y1 - y), sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
    for (let e = dx + dy; ; ) {
      const i = y * cols + x;
      if (i === b) return -1;
      if (i !== a && this.flags[i]! & mask) return i;
      const e2 = 2 * e;
      if (e2 >= dy) (e += dy), (x += sx);
      if (e2 <= dx) (e += dx), (y += sy);
    }
  }

  // The search: A* toward `to`, or Dijkstra over everything within `limit` when to < 0 (flood).
  // Returns `to` when found, -1 when exhausted, -2 when the budget ran out. Integers only.
  private r(from: number, to: number, avoid: number, limit: number, budget: number, out: Int32Array) {
    const { cols, rows, g, f, v: via, s: seen, flags, cost } = this, m = (this.k += 2), ways = this.diagonal ? 8 : 4, flood = to < 0;
    this.x = to % cols;
    this.y = (to - this.x) / cols;
    this.z = this.expanded = 0;
    g[from] = 0;
    f[from] = this.h(from % cols, (from - (from % cols)) / cols);
    via[from] = from;
    seen[from] = m;
    this.u(from);
    let best = from, found = 0;
    while (this.z) {
      const i = this.o();
      seen[i] = m + 1;
      if (i === to) return i;
      if (flood) {
        if (found < out.length) out[found++] = i;
      } else if (f[i]! - g[i]! < f[best]! - g[best]!) best = i;
      if (++this.expanded > budget && budget) return (this.b = best), -2;
      const c = i % cols, r = (i - c) / cols;
      for (let k = 0; k < ways; k++) {
        const nc = c + DX[k]!, nr = r + DY[k]!, j = nr * cols + nc;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || seen[j] === m + 1 || (flags[j]! & avoid && j !== to)) continue;
        if (k > 3 && (flags[r * cols + nc]! | flags[nr * cols + c]!) & avoid) continue; // no corner cutting
        const ng = g[i]! + cost[j]! * (k > 3 ? 14 : 10);
        if (ng > limit || (seen[j] === m && ng >= g[j]!)) continue;
        g[j] = ng;
        f[j] = ng + this.h(nc, nr);
        via[j] = i;
        if (seen[j] === m) this.w(this.p[j]!);
        else (seen[j] = m), this.u(j);
      }
    }
    this.b = flood ? found : best;
    return -1;
  }
  // Octile (8-way) or Manhattan (4-way) distance in tenths: admissible while every cost is >= 1.
  private h(c: number, r: number) {
    if (this.x < 0) return 0; // flood: no target
    const dx = Math.abs(c - this.x), dy = Math.abs(r - this.y);
    return this.diagonal ? 10 * (dx + dy) - 6 * (dx < dy ? dx : dy) : 10 * (dx + dy);
  }
  private u(i: number) {
    this.q[this.z] = i;
    this.w(this.z++);
  }
  private w(p: number) {
    const h = this.q, f = this.f, pos = this.p, i = h[p]!;
    while (p > 0) {
      const q = (p - 1) >> 1, j = h[q]!;
      if (f[j]! <= f[i]!) break;
      h[p] = j;
      pos[j] = p;
      p = q;
    }
    h[p] = i;
    pos[i] = p;
  }
  private o() {
    const h = this.q, f = this.f, pos = this.p, top = h[0]!, n = --this.z, last = h[n]!;
    let p = 0;
    for (let c = 1; c < n; c = 2 * p + 1) {
      if (c + 1 < n && f[h[c + 1]!]! < f[h[c]!]!) c++;
      if (f[h[c]!]! >= f[last]!) break;
      h[p] = h[c]!;
      pos[h[p]!] = p;
      p = c;
    }
    h[p] = last;
    pos[last] = p;
    return top;
  }
}

/** A cols × rows board; every buffer a search needs is made here, once. */
export const board = (cols: number, rows: number, opts?: BoardOptions) => new Board(cols, rows, opts);
