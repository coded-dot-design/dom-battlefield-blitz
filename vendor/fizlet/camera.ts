/**
 * @fzlt/core/camera: the page is the camera. Pan and zoom a DOM stage (any element) with one
 * `transform` written through the engine's ledger, so Recall gives it back exactly. Moves ease and
 * settle (the engine sleeps when they end); with reduced motion they jump. `contain` (default on)
 * keeps the stage covering its own box, so no edge shows and the page never scrolls sideways.
 *
 * Coordinates: world = the stage's own untransformed CSS px (0,0 is its top-left corner); screen =
 * the same box after the camera (what the visitor sees, in the stage's untransformed layout box).
 */
import type { Engine } from "./kernel/engine";
import { need } from "./kernel/need";

/** Options for `camera()`: easing rate, zoom limits, containment and reduced-motion handling. */
export interface CameraOptions {
  /** Easing rate per second (default 7; higher is snappier). A move settles in about 6 / ease s. */
  ease?: number;
  /** Zoom limits (default 1 and 4). */
  min?: number;
  max?: number;
  /** Keep the stage covering its own box and clip its parent (default true). */
  contain?: boolean;
  /** Ease moves (default: yes, unless the visitor prefers reduced motion; then every move jumps). */
  motion?: boolean;
}

/** A camera on stage `el`: pan and zoom it with one `transform` written through the engine's ledger
 *  (so Recall gives it back). Moves ease and settle; `to()`, `pan()` and `home()` drive it. */
export function camera(engine: Engine, el: HTMLElement | SVGElement, o: CameraOptions = {}) {
  const rate = need(o.ease ?? 7, "ease", 1), lo = need(o.min ?? 1, "min", 1), hi = need(o.max ?? 4, "max", 1), box = o.contain !== false;
  // The focus (world point) shows at the pin (screen point): translate = pin - focus * zoom.
  // FX FY Z current; GX GY GZ target; PX PY pin; W H stage size; RX RY RZ last written; flags; JUMP:
  // reduced motion, latched in read while moving (a step never calls into the DOM).
  const s = new Float64Array(17);
  const FX = 0, FY = 1, Z = 2, GX = 3, GY = 4, GZ = 5, PX = 6, PY = 7, W = 8, H = 9, RX = 10, RY = 11, RZ = 12, MOVE = 13, MEASURE = 14, CLIP = 15, JUMP = 16;
  s[Z] = s[GZ] = s[RZ] = 1;
  s[MEASURE] = 1;
  const mq = o.motion == null && typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const still = () => (mq ? mq.matches : o.motion === false);
  const parent = el.parentElement;

  const clampZ = (z: number) => Math.min(hi, Math.max(lo, z));
  // Contain: the translate t (one axis) keeps the stage over its box: between 0 and size * (1 - z).
  const fit = (f: number, p: number, z: number, size: number) => {
    if (!box || !size) return f;
    const t = p - f * z, a = size * (1 - z);
    return (p - Math.min(Math.max(a, 0), Math.max(Math.min(a, 0), t))) / z;
  };
  // Move the pin without moving the picture: re-express the current focus about the new pin.
  const pin = (px: number, py: number) => {
    const dx = px - s[PX]!, dy = py - s[PY]!;
    s[FX] = s[FX]! + dx / s[Z]!;
    s[FY] = s[FY]! + dy / s[Z]!;
    s[GX] = s[GX]! + dx / s[GZ]!;
    s[GY] = s[GY]! + dy / s[GZ]!;
    s[PX] = px;
    s[PY] = py;
  };

  const go = () => {
    s[GX] = fit(s[GX]!, s[PX]!, s[GZ]!, s[W]!);
    s[GY] = fit(s[GY]!, s[PY]!, s[GZ]!, s[H]!);
    s[MOVE] = 1;
    // Size unknown (hidden at setup): measure in the next read. A known size is kept until the
    // stage resizes, so a drag pan reads no layout per frame.
    if (!s[W]) s[MEASURE] = 1;
    engine.wake();
  };

  // Layout reads happen here only: at setup, and in the read phase once the stage resized (or its
  // size is still unknown). A ResizeObserver says so; transforms never change a layout size.
  const measure = () => {
    s[MEASURE] = 0;
    const r = el.getBoundingClientRect();
    s[W] = r.width / s[RZ]!;
    s[H] = r.height / s[RZ]!;
    s[GX] = fit(s[GX]!, s[PX]!, s[GZ]!, s[W]!);
    s[GY] = fit(s[GY]!, s[PY]!, s[GZ]!, s[H]!);
    if (box && parent && !s[CLIP]) s[CLIP] = getComputedStyle(parent).overflowX === "visible" ? 1 : 2;
  };
  measure();
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => (s[MEASURE] = 1));
    ro.observe(el);
    engine.signal.addEventListener("abort", () => ro.disconnect());
  }

  const cam = {
    /** Show world point (x, y) at screen point (px, py) (default: the same point, a zoom about it). */
    to(x: number, y: number, zoom = s[GZ]!, px = x, py = y) {
      if (!(x - x === 0 && y - y === 0 && zoom > 0 && px - px === 0 && py - py === 0)) return;
      pin(px, py);
      s[GX] = x;
      s[GY] = y;
      s[GZ] = clampZ(zoom);
      go();
    },
    /** Stage size in px (untransformed), as last measured. */
    get width() {
      return s[W]!;
    },
    get height() {
      return s[H]!;
    },
    /** Drag by a screen delta (px): follows at once, no easing. */
    pan(dx: number, dy: number) {
      if (!(dx - dx === 0 && dy - dy === 0)) return;
      s[FX] = s[FX]! - dx / s[Z]!;
      s[FY] = s[FY]! - dy / s[Z]!;
      s[GX] = s[GX]! - dx / s[GZ]!;
      s[GY] = s[GY]! - dy / s[GZ]!;
      go();
    },
    /** Back to the page as it is (zoom 1, no offset), eased. */
    home() {
      s[GX] = s[PX]!;
      s[GY] = s[PY]!;
      s[GZ] = 1;
      go();
    },
    /** Screen (stage box px) to world, into `out` (no allocation). */
    toWorld<T extends { [i: number]: number }>(x: number, y: number, out: T): T {
      out[0] = s[FX]! + (x - s[PX]!) / s[Z]!;
      out[1] = s[FY]! + (y - s[PY]!) / s[Z]!;
      return out;
    },
    get zoom() {
      return s[Z]!;
    },
    /** Still easing toward the target. */
    get moving() {
      return s[MOVE]! > 0;
    },
    read() {
      if (s[MEASURE]) measure();
      if (s[MOVE]) s[JUMP] = +still();
    },
    step(e: Engine, dt: number) {
      if (!s[MOVE]) return;
      const a = s[JUMP] ? 1 : 1 - Math.exp(-rate * dt);
      s[Z] = s[Z]! + (s[GZ]! - s[Z]!) * a;
      s[FX] = fit(s[FX]! + (s[GX]! - s[FX]!) * a, s[PX]!, s[Z]!, s[W]!);
      s[FY] = fit(s[FY]! + (s[GY]! - s[FY]!) * a, s[PY]!, s[Z]!, s[H]!);
      // Settled: within a 50th of a pixel and a 10,000th of a zoom step; land exactly on the target.
      if (Math.abs(s[GZ]! - s[Z]!) < 1e-4 && Math.abs(s[GX]! - s[FX]!) * s[Z]! < 0.02 && Math.abs(s[GY]! - s[FY]!) * s[Z]! < 0.02)
        (s[FX] = s[GX]!), (s[FY] = s[GY]!), (s[Z] = s[GZ]!), (s[MOVE] = 0);
      e.busy();
    },
    render() {
      const z = s[Z]!, x = s[PX]! - s[FX]! * z, y = s[PY]! - s[FY]! * z;
      if (x === s[RX] && y === s[RY] && z === s[RZ]) return;
      s[RX] = x;
      s[RY] = y;
      s[RZ] = z;
      const L = engine.ledger, home = Math.abs(x) < 0.005 && Math.abs(y) < 0.005 && Math.abs(z - 1) < 1e-6;
      if (s[CLIP] === 1 && !home) L.style(parent!, "overflow", "clip");
      L.style(el, "transform-origin", home ? "" : "0 0");
      L.style(el, "transform", home ? "" : `translate(${x.toFixed(2)}px,${y.toFixed(2)}px) scale(${z.toFixed(4)})`);
      L.style(el, "will-change", home ? "" : "transform");
    },
  };
  engine.add(cam);
  return cam;
}
/** The camera `camera()` returns. */
export type Camera = ReturnType<typeof camera>;

// Helpers stand alone, so a hero that only zooms never ships them.
/** Zoom about world point (x, y): it stays where it is on screen. The same as `cam.to(x, y, zoom)`. */
export function zoomAt(cam: Camera, x: number, y: number, zoom: number) {
  cam.to(x, y, zoom);
}
/** Centre world point (x, y) on the stage at `zoom`. */
export function flyTo(cam: Camera, x: number, y: number, zoom = cam.zoom) {
  cam.to(x, y, zoom, cam.width / 2, cam.height / 2);
}
/** World to screen (stage box px), into `out`: the inverse of `cam.toWorld`. */
export function toScreen<T extends { [i: number]: number }>(cam: Camera, x: number, y: number, out: T): T {
  cam.toWorld(0, 0, out); // the world point at the screen's 0,0
  out[0] = (x - out[0]!) * cam.zoom;
  out[1] = (y - out[1]!) * cam.zoom;
  return out;
}
/** Fit a world box (x, y, w, h) in the stage, with `pad` (fraction, default 0.1) around it. */
export function fit(cam: Camera, x: number, y: number, w: number, h: number, pad = 0.1) {
  if (w > 0 && h > 0 && cam.width) flyTo(cam, x + w / 2, y + h / 2, Math.min(cam.width / w, cam.height / h) * (1 - pad));
}
