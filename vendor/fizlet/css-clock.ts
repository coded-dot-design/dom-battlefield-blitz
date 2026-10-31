/**
 * @fzlt/core/css-clock: a page's own CSS @keyframes, on the kernel clock. The look stays in the
 * stylesheet; Fizlet owns the time. Each animation under `root` is paused and reads its time from
 * one custom property that a timeline moves through the ledger:
 *
 *   .led { animation: blink 1s steps(2) infinite paused; animation-delay: var(--fz-t, 0s); }
 *   .bug { animation: walk 6s linear infinite paused; animation-delay: calc(var(--fz-t, 0s) - 3s); }
 *
 * - One shared requestAnimationFrame with every other engine on the page; off screen or in a hidden
 *   tab it asks for no frames at all.
 * - Settles: after `loops` plays of `span` seconds it rests where it started (every animation whose
 *   duration divides `span` is back on its first frame) and the engine sleeps. A pointer over the
 *   root, focus inside it or coming back into view plays it again.
 * - Reduced motion: play() lands on the rest frame at once (the still poster).
 * - Recall: destroy() (or aborting `signal`) gives the root's style back as it was.
 */
import { createEngine } from "./kernel/engine";
import { timeline } from "./timeline";

/** Options for `cssClock()`: the loop length, how many plays before it rests, the custom property,
 *  the frame cap, reduced motion and an abort signal. */
export interface CssClockOptions {
  /** Seconds in one play: the loop length (the longest animation, or a common multiple). Default 6. */
  span?: number;
  /** Plays before it rests and the engine settles (default 3). */
  loops?: number;
  /** The custom property the animations read (default "--fz-t"). */
  prop?: string;
  /** Frame-rate cap, e.g. 30 for steps() blinks (default: none, 60 Hz). */
  fps?: number;
  /** Animate (default: yes, unless the visitor prefers reduced motion). */
  motion?: boolean;
  /** Aborting it destroys the clock (Recall included). */
  signal?: AbortSignal;
}

/** Run the CSS @keyframes under `root` on the kernel clock: each paused animation reads its time from
 *  one custom property a timeline moves. It settles after `loops` plays and wakes on pointer, focus or
 *  coming back into view; `destroy()` gives the root's style back. */
export function cssClock(root: HTMLElement, o: CssClockOptions = {}) {
  const span = o.span ?? 6, T = span * (o.loops ?? 3), { fps, signal, motion } = o;
  const engine = createEngine({ root, settle: 0.5, ...(fps && { fps }), ...(signal && { signal }) });
  const tl = timeline(engine, motion == null ? {} : { motion }).to(root, { [o.prop ?? "--fz-t"]: ["0s", -T + "s"] }, { dur: T, ease: "linear" });
  let held = false;
  const play = () => {
    if (held) return;
    if (!tl.playing) tl.seek(0).play();
  };
  const on = { signal: engine.signal };
  root.addEventListener("pointerenter", play, on);
  root.addEventListener("focusin", play, on);
  if (typeof IntersectionObserver === "function") {
    const io = new IntersectionObserver((l) => l[l.length - 1]!.isIntersecting && play());
    io.observe(root);
    engine.signal.addEventListener("abort", () => io.disconnect(), { once: true });
  }
  engine.start();
  play();
  return {
    engine,
    tl,
    /** Play from the start (unless held). */
    play,
    /** Hold or release (a pause button): held, it keeps its frame and asks for nothing. */
    hold(on: boolean) {
      held = on;
      if (on) tl.pause();
      else tl.play();
    },
    /** Stop for good and give the page back (Recall). */
    destroy: () => engine.destroy(),
  };
}
/** The clock `cssClock()` returns. */
export type CssClock = ReturnType<typeof cssClock>;
