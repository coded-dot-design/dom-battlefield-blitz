/**
 * @fzlt/core/view-canvas: one overlay canvas per root, sized for the screen's pixel density and redrawn
 * only where something changed. The canvas covers the root's padding box (`pointer-events: none`,
 * so the root keeps its input), its backing store is the CSS size × devicePixelRatio (capped by
 * `maxDpr`), and drawing is in CSS px.
 * - Dirty redraw: `dirty([x, y, w, h])` grows one box (no arguments: the whole canvas); in the render
 *   phase that box, snapped out to whole device pixels, is cleared, clipped and handed to `draw`.
 *   Nothing dirty, nothing drawn: a still view costs no canvas work at all.
 * - Settle: it never keeps the engine awake; `dirty()` wakes a settled engine for one redraw.
 * - Layout reads only in the read phase, and only after a resize or a zoom (a ResizeObserver).
 * - Recall: the canvas goes and the root's style comes back exactly (the engine's ledger).
 * It has no motion of its own: reduced motion belongs to whatever moves the drawing.
 */
import type { Engine } from "./kernel/engine";

/** Options for `viewCanvas`: the `draw` callback, the density cap and an accessible name. */
export interface ViewCanvasOptions {
  /** Paint. The canvas is already cleared and clipped to `box` ([x, y, w, h], CSS px): draw the
   *  scene (anything outside the box is clipped away, so drawing it all is fine). */
  draw(ctx: CanvasRenderingContext2D, box: Float64Array): void;
  /** The most pixel density drawn (default 2: sharp on a phone, a quarter of the pixels at 4×). */
  maxDpr?: number;
  /** An accessible name: the canvas becomes role="img" (default: aria-hidden, decoration). */
  label?: string;
}

/** One overlay canvas on `root`, sized for the pixel density (capped by `maxDpr`) and redrawn only
 *  inside the dirty box: `dirty([x, y, w, h])` (CSS px), or `dirty()` for all of it. Never keeps the
 *  engine awake; Recall removes the canvas and gives the root's style back. */
export function viewCanvas(engine: Engine, root: HTMLElement, o: ViewCanvasOptions) {
  const L = engine.ledger, doc = root.ownerDocument, win = doc.defaultView!, cap = o.maxDpr ?? 2;
  const c = L.add(doc.createElement("canvas")), ctx = c.getContext("2d")!;
  // W H DPR measured; X0 Y0 X1 Y1 the dirty box (empty when X0 > X1); MEASURE asks the read phase.
  const s = new Float64Array(8), box = new Float64Array(4);
  const W = 0, H = 1, DPR = 2, X0 = 3, Y0 = 4, X1 = 5, Y1 = 6, MEASURE = 7;
  c.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none";
  if (o.label) c.setAttribute("role", "img"), c.setAttribute("aria-label", o.label);
  else c.setAttribute("aria-hidden", "true");
  if (win.getComputedStyle(root).position === "static") L.style(root, "position", "relative");
  root.append(c);

  const view = {
    canvas: c,
    ctx,
    /** The canvas size in CSS px, as last measured. */
    get width() {
      return s[W]!;
    },
    get height() {
      return s[H]!;
    },
    /** The device pixels per CSS px it draws at. */
    get dpr() {
      return s[DPR]!;
    },
    /** Redraw box [x, y, w, h] (CSS px) on the next render; no box, the whole canvas. The box comes
     *  in an array, not as four numbers: doubles passed to a call are boxed. Wakes a settled engine. */
    dirty(b?: { readonly [i: number]: number }) {
      s[X0] = Math.min(s[X0]!, b ? b[0]! : 0);
      s[Y0] = Math.min(s[Y0]!, b ? b[1]! : 0);
      s[X1] = Math.max(s[X1]!, b ? b[0]! + b[2]! : 1e9);
      s[Y1] = Math.max(s[Y1]!, b ? b[1]! + b[3]! : 1e9);
      if (!engine.running) engine.wake(); // only a settled engine starts; a stopped one stays stopped
    },
    read() {
      if (!s[MEASURE]) return;
      s[MEASURE] = 0;
      const w = root.clientWidth, h = root.clientHeight, d = Math.min(cap, win.devicePixelRatio || 1);
      if (w === s[W] && h === s[H] && d === s[DPR]) return;
      s[W] = w;
      s[H] = h;
      s[DPR] = d;
      c.width = Math.round(w * d);
      c.height = Math.round(h * d);
      view.dirty();
    },
    render() {
      if (s[X0]! > s[X1]! || s[Y0]! > s[Y1]!) return;
      // Snap out to whole device pixels (no half-cleared seams), inside the canvas.
      const d = s[DPR]!, x0 = Math.max(0, Math.floor(s[X0]! * d)), y0 = Math.max(0, Math.floor(s[Y0]! * d));
      const x1 = Math.min(c.width, Math.ceil(s[X1]! * d)), y1 = Math.min(c.height, Math.ceil(s[Y1]! * d));
      s[X0] = s[Y0] = Infinity;
      s[X1] = s[Y1] = -Infinity;
      if (x1 <= x0 || y1 <= y0) return;
      box[0] = x0 / d;
      box[1] = y0 / d;
      box[2] = (x1 - x0) / d;
      box[3] = (y1 - y0) / d;
      // Clear and clip in whole device pixels (integers: nothing boxed), then draw in CSS px.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      o.draw(ctx, box);
      ctx.restore();
    },
  };
  s[X0] = s[Y0] = Infinity;
  s[X1] = s[Y1] = -Infinity;
  // Measured in the next read phase; it redraws only when the size or the density changed.
  const measure = () => ((s[MEASURE] = 1), engine.running || engine.wake());
  measure();
  // A resize of the root, or a zoom (the window's resize: devicePixelRatio changes with it).
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    engine.signal.addEventListener("abort", () => ro.disconnect(), { once: true });
  }
  win.addEventListener("resize", measure, { signal: engine.signal });
  engine.add(view);
  return view;
}
/** What `viewCanvas` returns: `canvas`, `ctx`, `width`, `height`, `dpr` and `dirty(box?)`. */
export type ViewCanvas = ReturnType<typeof viewCanvas>;
