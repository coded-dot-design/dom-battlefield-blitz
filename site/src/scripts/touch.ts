// Fizlet's lockTouch (fizlet/touch, same rule): on the live surfaces, cancel iOS Safari's
// gesturestart/gesturechange (its pinch ignores user-scalable=no) and any multi-touch start or move,
// so a pinch there never zooms the page. One finger is never touched: taps, drags and scrolling stay.
// Swap for `import { lockTouch } from "../../../vendor/fizlet/touch"` at the next vendor sync.
export const SURFACES = "[data-touch-lock],[data-fizlet-slot],[data-fizlet-host],.bui-pad,.bui-grip";

export function lockTouch(doc: Document = document, sel: string | null = SURFACES): () => void {
  const opt = { capture: true, passive: false };
  const on = (ev: Event) => {
    const t = ev.target as Element | null;
    if ((ev.type[0] == "g" || (ev as TouchEvent).touches.length > 1) && (sel == null || t?.closest?.(sel))) ev.preventDefault();
  };
  const types = ["gesturestart", "gesturechange", "touchstart", "touchmove"];
  for (const t of types) doc.addEventListener(t, on, opt);
  return () => {
    for (const t of types) doc.removeEventListener(t, on, opt);
  };
}
