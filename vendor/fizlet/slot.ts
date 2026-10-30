/**
 * fizlet/slot: mount a Fizlet scene into an astro-base-engine slot: the element carrying
 *   class="ae-slot" data-slot-target="<page>#<slot>" role="img" aria-label="…". Both shapes the engine
 *   has rendered are found: the figure itself (`<figure class="ae-slot">`), or a box inside one
 *   (`<figure class="ae-slot-figure"><div class="ae-slot">…</div><figcaption class="ae-slot__fallback">`,
 *   where the caption sits outside the role="img" box and stays: it is not over the scene).
 * - Lazy: nothing loads or runs until the slot comes near the viewport, and then only once the
 *   main thread is idle (or `idle` ms have passed), so the page's own work goes first.
 * - Safe first tap: a tap on the slot before the scene is up loads it at once and is handed to the
 *   scene as plain numbers (`first`), never as a stale PointerEvent whose pointer is gone.
 * - Reduced motion: the slot keeps its placeholder and fallback; the scene never loads. If the
 *   setting turns on while a scene runs, the scene goes and the fallback comes back.
 * - Accessible: role="img" + aria-label stay unless the scene says it renders real accessible
 *   content (`accessible: true`); until then the stage is aria-hidden.
 * - Contained: the scene gets its own stage inside the slot (contain: strict). Every change the
 *   slot makes goes through a Ledger, so destroy() gives the page back exactly.
 * - Off screen, off the page's frame: the stage is content-visibility: auto, so a scene scrolled
 *   away is skipped for style, layout, paint and layers. Without it a 3D scene's composited
 *   layers stayed in every repaint elsewhere on the page (Chromium layerizes the whole document).
 */
import { Ledger } from "./kernel/ledger";

export interface SlotScene {
  /** Remove the scene (its engine's destroy() restores what it changed). */
  destroy(): void;
  /** True when the scene renders real accessible content: the slot drops role="img". */
  accessible?: boolean;
}
/** A tap on the slot before the scene was up: where (px from the slot's top left) and when. */
export interface SlotTap {
  x: number;
  y: number;
  /** `performance.now()` when the finger went down. */
  at: number;
}
/** Build the scene inside `stage` (sized to the slot). `slot` is the figure, read-only. `first` is
 *  the tap that started the load, if one did: act on it as an intent (aim, fire), not as an event. */
export type SlotMount = (stage: HTMLElement, slot: HTMLElement, first: SlotTap | null) => SlotScene;
export interface SlotOptions {
  /** How close to the viewport the slot must come before the scene loads (default "200px"). */
  margin?: string;
  /** Longest wait (ms) for an idle main thread once the slot is near (default 1000; 0: no wait). */
  idle?: number;
}

const REDUCE = "(prefers-reduced-motion: reduce)";

/** The slot for "<page>#<slot>" (or null): any `.ae-slot` carrying the target, figure or box. */
export const findSlot = (target: string, doc: Document = document) =>
  [...doc.querySelectorAll<HTMLElement>(".ae-slot[data-slot-target]")].find((f) => f.dataset.slotTarget === target) ?? null;

export function slot(target: string | HTMLElement, load: () => Promise<SlotMount> | SlotMount, opts: SlotOptions = {}) {
  const el = typeof target === "string" ? findSlot(target) : target;
  const ctl = new AbortController(), ledger = new Ledger();
  const motion = matchMedia(REDUCE);
  let scene: SlotScene | null = null, io: IntersectionObserver | null = null, run = 0, first: SlotTap | null = null, go: (() => void) | null = null;
  // A tap before the scene is up: remember it as numbers and load now (no idle wait).
  el?.addEventListener("pointerdown", (ev) => {
    if (scene || motion.matches || !ev.isPrimary) return;
    const r = el.getBoundingClientRect(); // one read per tap, outside any frame
    first = { x: ev.clientX - r.left, y: ev.clientY - r.top, at: ev.timeStamp };
    if (go) go();
    else if (io) (disarm(), void mount());
  }, { signal: ctl.signal, capture: true });

  function unmount() {
    run++;
    go?.(); // a pending idle wait ends here; its mount sees the new run and stops
    scene?.destroy();
    scene = null;
    ledger.restore();
  }
  async function mount(wait = 0) {
    const id = ++run;
    if (wait > 0 && !first)
      await new Promise<void>((done) => {
        const t = typeof requestIdleCallback === "function" ? requestIdleCallback(() => go?.(), { timeout: wait }) : setTimeout(() => go?.(), 1);
        go = () => {
          go = null;
          typeof cancelIdleCallback === "function" ? cancelIdleCallback(t) : clearTimeout(t);
          done();
        };
        ctl.signal.addEventListener("abort", go, { once: true });
      });
    if (id !== run) return;
    const make = await load();
    if (id !== run || !el || ctl.signal.aborted || motion.matches) return;
    if (getComputedStyle(el).position === "static") ledger.style(el, "position", "relative");
    for (const c of el.querySelectorAll<HTMLElement>(":scope > .ae-slot__placeholder, :scope > .ae-slot__fallback")) ledger.style(c, "display", "none");
    const stage = ledger.add(document.createElement("div"));
    stage.setAttribute("data-fizlet-slot", el.dataset.slotTarget ?? "");
    stage.style.cssText = "position:absolute;inset:0;contain:strict;overflow:hidden;content-visibility:auto";
    el.append(stage);
    scene = make(stage, el, first);
    first = null;
    if (scene.accessible) ledger.attr(el, "role", null);
    else stage.setAttribute("aria-hidden", "true");
  }
  function arm() {
    if (!el || io || scene || motion.matches || ctl.signal.aborted) return;
    io = new IntersectionObserver((list) => {
      if (!list[list.length - 1]!.isIntersecting) return;
      disarm();
      void mount(opts.idle ?? 1000);
    }, { rootMargin: opts.margin ?? "200px" });
    io.observe(el);
  }
  function disarm() {
    io?.disconnect();
    io = null;
  }
  motion.addEventListener("change", () => (motion.matches ? (disarm(), unmount()) : arm()), { signal: ctl.signal });
  arm();

  return {
    /** The slot figure, or null when no slot matches the target. */
    el,
    get mounted() {
      return !!scene;
    },
    /** Remove the scene, the stage and every listener; the slot is back as the engine drew it. */
    destroy() {
      ctl.abort();
      disarm();
      unmount();
    },
  };
}
