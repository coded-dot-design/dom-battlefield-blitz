/**
 * fizlet/debug: development-only checks. `guardLayout(engine)` counts every layout read (rects,
 * offset/client/scroll sizes, computed style) made while the engine is in its STEP phase, the
 * contract's "no layout reads in the tick". Never ship this in a production build.
 */
import { STEP, type Engine } from "./kernel/engine";

const guarded = new Set<Engine & { violations?: number }>();
let patched = false;
function hit() {
  for (const e of guarded) if (e.phase === STEP) e.violations = (e.violations ?? 0) + 1;
}
function patch() {
  if (patched || typeof Element !== "function") return;
  patched = true;
  const P = Element.prototype, H = HTMLElement.prototype;
  for (const name of ["getBoundingClientRect", "getClientRects"] as const) {
    const f = P[name] as (...a: unknown[]) => unknown;
    (P as unknown as Record<string, unknown>)[name] = function (this: Element, ...a: unknown[]) {
      hit();
      return f.apply(this, a);
    };
  }
  for (const [proto, props] of [
    [P, ["clientWidth", "clientHeight", "clientTop", "clientLeft", "scrollWidth", "scrollHeight", "scrollTop", "scrollLeft"]],
    [H, ["offsetWidth", "offsetHeight", "offsetTop", "offsetLeft"]],
  ] as const)
    for (const prop of props) {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (d?.get) Object.defineProperty(proto, prop, { ...d, get() { hit(); return d.get!.call(this); } });
    }
  const gcs = getComputedStyle;
  globalThis.getComputedStyle = (el: Element, pseudo?: string | null) => (hit(), gcs(el, pseudo));
}
/** Count layout reads made during a step; the number shows as `engine.violations`. */
export function guardLayout(engine: Engine) {
  patch();
  const e = engine as Engine & { violations?: number };
  e.violations = 0;
  guarded.add(e);
  engine.signal.addEventListener("abort", () => guarded.delete(e));
  return () => guarded.delete(e);
}
