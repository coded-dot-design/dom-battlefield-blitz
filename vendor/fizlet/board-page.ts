/**
 * fizlet/board-page: the host page as the board. Its text glyphs become terrain and food, its
 * buttons become targets. Geometry is measured only in the read phase, on a budget (Range reads
 * capped per refresh; 12.5 Hz while the page moves, 2 Hz once it is still), kept in typed arrays
 * and indexed with a collide Grid, so `near` / `hit` in a step never read layout or allocate.
 * `consume` writes a literal 0/1 into the page's own Text node through the ledger (no wrappers,
 * no clones); from a step it is queued and written in render. Recall gives every glyph back, and
 * a newer edit by the host page wins. Coordinates are viewport CSS px (getBoundingClientRect).
 * Glyph indices hold for a frame: a rescan (read phase, after the page changed) renumbers them.
 * Targets only (`text: false`) with `still: Infinity`: a scene that reads page elements (headings,
 * buttons) re-measures only when the page moves or changes, so its still frames read nothing.
 */
import { STEP, RENDER, IDLE, type Engine, type System } from "./kernel/engine";
import { Grid } from "./collide";
import { hypot } from "./steer";

/** Options for `boardPage()`: which part of the page is the board, which elements are text and
 *  targets, and the measuring budget. */
export interface BoardPageOptions {
  /** The part of the page that is the board (default document.body). The board lives in its document
   *  and window (an iframe's page works too). */
  root?: Element;
  /** Text containers (default headings, p, li, blockquote, [data-fizlet-text]); 160 at most. false: no glyphs, targets only. */
  text?: string | false;
  /** Targets (default button, [role=button], a.button, a.btn, [data-fizlet-target]). */
  targets?: string;
  /** More to leave alone, on top of fields, editable, code, live regions, dialogs, [data-fizlet-ignore]. */
  exclude?: string;
  /** Glyphs indexed at most (default 8000). */
  maxGlyphs?: number;
  /** Targets at most (default 32). */
  maxTargets?: number;
  /** Letters only (default false: letters and digits are glyphs). */
  letters?: boolean;
  /** Range reads per refresh at most (default 900); the rest are measured on the next refresh. */
  reads?: number;
  /** Seconds between re-measures while the page is still (default 0.5; Infinity: only after a scroll, resize or change). */
  still?: number;
  /** Hex colour for consumed glyphs (a CSS Custom Highlight, where supported). Off by default. */
  color?: string;
}

/** One target on the board (a button or link): its element and its viewport rect, measured in read. */
export interface BoardTarget {
  readonly el: Element;
  /** Viewport rect, measured in read; w = h = 0 while hidden or off screen. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The game's to use: starts at 100 and survives a rescan. */
  hp: number;
}

/** One Text node: our last value of it; per glyph offset, length, state (0, 1 binary, 2 erase, 3 "0", 4 "1"), range, letter. */
type Rec = [node: Text, value: string, off: number[], len: number[], state: number[], ranges: (Range | undefined)[], chars: string[]];

/** Never a target or food: fields, editable, live regions, dialogs, opted out, a Fizlet host. */
const SKIP = "input,textarea,select,[contenteditable],[aria-live],dialog,[role=dialog],[data-fizlet-ignore],[data-fizlet-host]";
/** Never food either: controls, links, code, scripts. */
const NOT_TEXT = ",option,button,a,script,style,noscript,pre,code";
let seq = 0;

/** The host page as the board for engine `e`: its glyphs become terrain and food, its buttons
 *  targets. Measured only in the read phase, on a budget; `near()` and `hit()` in a step never read
 *  layout or allocate. `consume()` changes a glyph through the ledger. */
export function boardPage(e: Engine, o: BoardPageOptions = {}) {
  const root = o.root ?? document.body, doc = root.ownerDocument, win = doc.defaultView!, host = e.root, L = e.ledger;
  const textSel = o.text ?? "h1,h2,h3,h4,h5,h6,p,li,blockquote,[data-fizlet-text]";
  const targetSel = o.targets ?? "button,[role=button],a.button,a.btn,[data-fizlet-target]";
  const skip = o.exclude ? SKIP + "," + o.exclude : SKIP, skipText = skip + NOT_TEXT;
  const MAX = textSel ? o.maxGlyphs ?? 8000 : 1, READS = o.reads ?? 900, MAXT = o.maxTargets ?? 32;
  const eligible = o.letters ? /\p{L}/u : /\p{L}|\p{N}/u;
  const x = new Float32Array(MAX), y = new Float32Array(MAX), w = new Float32Array(MAX), h = new Float32Array(MAX);
  const spent = new Uint8Array(MAX), gr = new Int32Array(MAX), gk = new Int32Array(MAX), queue = new Int32Array(MAX), found = new Int32Array(MAX);
  // Queued writes name the node record and its glyph slot, so a rescan in between can't lose them.
  const qr: Rec[] = [];
  const recs: Rec[] = [], byNode = new Map<Text, Rec>(), targets: BoardTarget[] = [], byEl = new Map<Element, BoardTarget>();
  const grid = new Grid(32, MAX, 1, 1), range = doc.createRange(), seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  // Small integers stay unboxed in `let`s; times and the hit fraction (doubles) live in a typed array.
  let count = 0, queued = 0, cursor = 0, reads = 0, dirty = 1, rescan = 1, mark = 0, scans = 0;
  let shown = new Int32Array(0);
  // Query scratch: the grid's typed form and the plain-number API's own copies, so the hot path
  // never passes a number to a call V8 may not inline (each would box: one allocation).
  const qx = new Float64Array(1), qy = new Float64Array(1), qrad = new Float64Array(1), arg = new Float64Array(4);
  // The refresh clock: seconds summed from `engine.timing` in read (reading the engine's `time`
  // getter boxed a number every frame: 12 B a frame in steady state).
  const STILL = o.still ?? 0.5;
  const n = new Float64Array([-9, -9, 2, 0]), SCANNED = 0, MEASURED = 1, T = 2, NOW = 3;

  const hex = o.color && /^#[\da-f]{3,8}$/i.test(o.color) ? o.color : "", name = "fizlet-board-" + ++seq;
  const hl = hex && win.Highlight && new win.Highlight();
  if (hl) {
    const st = L.add(doc.createElement("style"));
    st.textContent = `::highlight(${name}){color:${hex}}`;
    doc.head.append(st);
    win.CSS.highlights.set(name, hl);
  }

  // Ours: the engine's root, or any Fizlet host on the page (a game's in-page art). Its mutations
  // never make the board rescan, and its text is never terrain.
  const mine = (node: Node) => !!host?.contains(node) || !!(node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest("[data-fizlet-host]");
  const drop = (r: Rec) => (byNode.delete(r[0]), r[5].forEach((g) => g && (hl as Highlight).delete(g)));
  const ours = (r: Rec) => r[0].isConnected && r[0].data === r[1];
  const visible = (el: Element, b: DOMRect) => {
    const s = win.getComputedStyle(el);
    return b.width > 0 && b.height > 0 && b.right > 0 && b.bottom > 0 && b.left < win.innerWidth && b.top < win.innerHeight && s.visibility !== "hidden" && s.opacity !== "0";
  };

  function scan() {
    rescan = 0;
    scans++;
    const seen = new Set<Rec>();
    let total = 0, visited = 0;
    if (textSel) for (const el of [...root.querySelectorAll(textSel)].slice(0, 160)) {
      if (el.closest(skipText) || mine(el)) continue;
      const walk = doc.createTreeWalker(el, 4);
      for (let t: Node | null; total < MAX && visited++ < 6000 && (t = walk.nextNode()); ) {
        const node = t as Text;
        let r = byNode.get(node);
        if (r && !ours(r)) drop(r), (r = undefined);
        if (!r) {
          if (!node.data.trim() || node.parentElement!.closest(skipText) || mine(node)) continue;
          byNode.set(node, (r = [node, node.data, [], [], [], [], []]));
          for (const p of seg.segment(node.data)) if (eligible.test(p.segment)) r[2].push(p.index), r[3].push(p.segment.length), r[4].push(0), r[6].push(p.segment);
        }
        if (!seen.has(r)) seen.add(r), (total += r[2].length);
      }
    }
    // Drop what the page took back (removed, edited by the host, out of the board).
    byNode.forEach((r) => seen.has(r) || drop(r));
    recs.length = 0;
    byNode.forEach((r) => recs.push(r));
    if (shown.length < recs.length) shown = new Int32Array(recs.length * 2);
    // Fair interleaving, 8 glyphs per node per round: one long paragraph can't take the whole cap.
    count = 0;
    for (let k = 0, more = 1; more; k += 8) {
      more = 0;
      for (let ri = 0; ri < recs.length; ri++)
        for (let j = k; j < k + 8 && j < recs[ri]![2].length && count < MAX; j++, more = 1)
          (gr[count] = ri), (gk[count] = j), (spent[count] = recs[ri]![4][j]! ? 1 : 0), (w[count] = h[count] = 0), count++;
    }
    cursor = 0;
    // Targets, kept by element so hp survives a rescan.
    targets.length = 0;
    for (const el of root.querySelectorAll(targetSel)) {
      if (targets.length === MAXT) break;
      if (el.closest(skip) || mine(el) || (host && el.contains(host))) continue;
      let t = byEl.get(el);
      if (!t) byEl.set(el, (t = { el, x: 0, y: 0, w: 0, h: 0, hp: 100 }));
      targets.push(t);
    }
    byEl.forEach((t, el) => targets.includes(t) || byEl.delete(el));
  }

  function measure() {
    const W = win.innerWidth, H = win.innerHeight;
    dirty = reads = 0;
    mark++;
    if (grid.cols * grid.cell < W || grid.rows * grid.cell < H) grid.resize(W, H);
    grid.clear();
    for (let m = 0, i = cursor; m < count; m++, i = i + 1 < count ? i + 1 : 0) {
      if (spent[i]) continue;
      const ri = gr[i]!, r = recs[ri]!;
      // Once per node per refresh: still ours and shown (sign of the stamp); no Range reads if not.
      if (Math.abs(shown[ri]!) !== mark) {
        const el = r[0].parentElement!, on = ours(r);
        shown[ri] = on && visible(el, el.getBoundingClientRect()) ? mark : -mark;
        if (!on) rescan = 1;
      }
      if (shown[ri]! < 0) {
        w[i] = h[i] = 0;
        continue;
      }
      if (reads === READS) {
        // Over budget: start here next time, at the dirty rate. The rest keep their last geometry.
        cursor = i;
        dirty = 1;
        for (; m < count; m++, i = i + 1 < count ? i + 1 : 0) if (w[i]! > 0 && !spent[i]) put(i);
        break;
      }
      const k = gk[i]!, off = r[2][k]!;
      range.setStart(r[0], off);
      range.setEnd(r[0], off + r[3][k]!);
      const g = range.getBoundingClientRect();
      reads++;
      const l = g.left > 0 ? g.left : 0, t = g.top > 0 ? g.top : 0, rw = (g.right < W ? g.right : W) - l, rh = (g.bottom < H ? g.bottom : H) - t;
      const on = rw > 0 && rh > 0;
      x[i] = l;
      y[i] = t;
      w[i] = on ? rw : 0;
      h[i] = on ? rh : 0;
      if (on) put(i);
    }
    for (const t of targets) {
      const b = t.el.getBoundingClientRect(), on = visible(t.el, b);
      t.x = b.left;
      t.y = b.top;
      t.w = on ? b.width : 0;
      t.h = on ? b.height : 0;
    }
  }
  const put = (i: number) => grid.insert(i, x[i]! + w[i]! / 2, y[i]! + h[i]! / 2, (w[i]! > h[i]! ? w[i]! : h[i]!) / 2);

  function write(r: Rec, k: number) {
    const off = r[2][k]!, len = r[3][k]!;
    const s = r[4][k], bit = s === 2 ? " " : s === 3 ? "0" : s === 4 ? "1" : e.random() < 0.5 ? "0" : "1", next = r[1].slice(0, off) + bit + r[1].slice(off + len);
    if (!L.text(r[0], next)) return;
    r[1] = next;
    r[3][k] = 1;
    for (let j = 0; j < r[2].length; j++) if (r[2][j]! > off) r[2][j]! += 1 - len;
    if (hl) {
      hl.add((r[5][k] = doc.createRange()));
      // A nodeValue write collapses the live ranges in that node: put every one back.
      r[5].forEach((g, j) => g && (g.setStart(r[0], r[2][j]!), g.setEnd(r[0], r[2][j]! + 1)));
    }
    dirty = 1;
  }

  const touch = () => (dirty = 1);
  const on = { signal: e.signal, passive: true, capture: true };
  win.addEventListener("scroll", touch, on);
  win.addEventListener("resize", touch, on);
  const mo = new win.MutationObserver((list) => {
    for (const m of list)
      if (!mine(m.target) && (m.type !== "characterData" || byNode.get(m.target as Text)?.[1] !== m.target.nodeValue)) {
        if (m.type !== "attributes") rescan = 1;
        dirty = 1;
      }
  });
  mo.observe(root, { subtree: true, childList: true, characterData: true, attributeFilter: ["class", "style", "hidden"] });
  const ro = new win.ResizeObserver(touch);
  ro.observe(root);
  e.signal.addEventListener("abort", () => {
    mo.disconnect();
    ro.disconnect();
    if (hl) win.CSS.highlights.delete(name);
    byNode.clear();
    recs.length = qr.length = targets.length = count = queued = 0;
    grid.clear();
  });

  function refresh(force?: boolean) {
    const now = n[NOW]!;
    if (rescan && (force || now - n[SCANNED]! >= 0.5)) (n[SCANNED] = now), scan(), (force = true);
    if (force || now - n[MEASURED]! >= (dirty ? 0.08 : STILL)) (n[MEASURED] = now), measure();
  }

  function nearIn(p: Float64Array, i: number, out: Int32Array) {
    const px = p[i]!, py = p[i + 1]!, pr = p[i + 2]!;
    qx[0] = px;
    qy[0] = py;
    qrad[0] = pr;
    let m = 0;
    for (let k = 0, c = grid.near(qx, qy, qrad, 0, found); k < c && m < out.length; k++) {
      const j = found[k]!, dx = px - (px < x[j]! ? x[j]! : px > x[j]! + w[j]! ? x[j]! + w[j]! : px);
      const dy = py - (py < y[j]! ? y[j]! : py > y[j]! + h[j]! ? y[j]! + h[j]! : py);
      if (!spent[j] && dx * dx + dy * dy <= pr * pr) out[m++] = j;
    }
    return m;
  }
  function hitIn(p: Float64Array, i: number) {
    const x0 = p[i]!, y0 = p[i + 1]!, dx = p[i + 2]! - x0, dy = p[i + 3]! - y0;
    let best = -1;
    n[T] = 2;
    qx[0] = x0 + dx / 2;
    qy[0] = y0 + dy / 2;
    qrad[0] = hypot(dx, dy) / 2 + 2; // the exact hypot (K5), as games compute it
    for (let k = 0, c = grid.near(qx, qy, qrad, 0, found); k < c; k++) {
      const j = found[k]!;
      // Slab test against the padded rect.
      let a = 0, b = 1;
      for (let ax = 0; ax < 2; ax++) {
        const s0 = ax ? y0 : x0, d = ax ? dy : dx, lo = (ax ? y[j]! : x[j]!) - 2, hi = lo + (ax ? h[j]! : w[j]!) + 4;
        if (d) {
          const u = (lo - s0) / d, v = (hi - s0) / d;
          a = Math.max(a, u < v ? u : v);
          b = Math.min(b, u < v ? v : u);
        } else if (s0 < lo || s0 > hi) a = 2;
      }
      if (!spent[j] && a <= b && a < n[T]!) (n[T] = a), (best = j);
    }
    return best;
  }

  const system: System = {
    read: () => e.signal.aborted || ((n[NOW] = n[NOW]! + e.timing[0]!), refresh()),
    render() {
      for (let q = 0; q < queued; q++) write(qr[q]!, queue[q]!);
      queued = 0;
    },
  };
  e.add(system);

  return {
    glyphs: {
      /** Glyphs indexed, spent ones included (w = 0 while not on screen). */
      get count() {
        return count;
      },
      x,
      y,
      w,
      h,
      /** 1 once consumed. */
      spent,
    },
    /** Page targets (rects measured in read). */
    targets: targets as readonly BoardTarget[],
    /** Unspent on-screen glyphs touching the circle, into `out`. Returns how many. */
    near(px: number, py: number, pr: number, out: Int32Array) {
      arg[0] = px;
      arg[1] = py;
      arg[2] = pr;
      return nearIn(arg, 0, out);
    },
    /** `near` for hot paths: the circle is p[i], p[i + 1] (centre) and p[i + 2] (radius), so no
     *  number is passed (a number passed to a call V8 doesn't inline boxes: one allocation). */
    nearAt: (p: Float64Array, i: number, out: Int32Array) => nearIn(p, i, out),
    /** First unspent glyph the segment touches (2 px pad), or -1; how far along it (0..1) is `t`. */
    hit(x0: number, y0: number, x1: number, y1: number) {
      arg[0] = x0;
      arg[1] = y0;
      arg[2] = x1;
      arg[3] = y1;
      return hitIn(arg, 0);
    },
    /** `hit` for hot paths: the segment is p[i .. i + 3] (x0, y0, x1, y1); how far along it the
     *  glyph is goes in p[i + 4] (and `t`). No number is passed, so nothing boxes. */
    hitAt(p: Float64Array, i: number) {
      const g = hitIn(p, i);
      p[i + 4] = n[T]!;
      return g;
    },
    get t() {
      return n[T]!;
    },
    /** Range reads made by the last refresh (never more than `reads`). */
    /** Rescans so far: glyph indices from before a rescan mean nothing after it. */
    get scans() {
      return scans;
    },
    get reads() {
      return reads;
    },
    /**
     * Consume glyph i: a 0/1 ("binary": the board's random draw; "0" / "1": the game's) or a no-break
     * space ("erase") in the page's own text, through the ledger; from a step it is written in
     * render. False if spent or not ours anymore.
     */
    consume(i: number, as?: "binary" | "erase" | "0" | "1") {
      if (!(i >= 0 && i < count) || spent[i] || !ours(recs[gr[i]!]!)) return false;
      spent[i] = 1;
      recs[gr[i]!]![4][gk[i]!] = as === "erase" ? 2 : as === "0" ? 3 : as === "1" ? 4 : 1;
      w[i] = h[i] = 0;
      if (e.phase === RENDER || e.phase === IDLE) write(recs[gr[i]!]!, gk[i]!);
      else (qr[queued] = recs[gr[i]!]!), (queue[queued++] = gk[i]!);
      return true;
    },
    /** Glyph i as it was before the game changed it (the letter a bite ate). Not for a step: a string. */
    char: (i: number) => (i >= 0 && i < count ? recs[gr[i]!]![6][gk[i]!]! : ""),
    /** The element that holds glyph i's text (for a game's own read-phase checks, e.g. what covers it). */
    parent: (i: number) => (i >= 0 && i < count ? recs[gr[i]!]![0].parentElement : null),
    /** Rescan and re-measure now; from a step, at the next read. */
    refresh() {
      rescan = 1;
      if (e.phase === STEP) n[SCANNED] = n[MEASURED] = -9;
      else refresh(true);
    },
    system,
  };
}
/** The board `boardPage()` returns. */
export type BoardPage = ReturnType<typeof boardPage>;
