/**
 * @fzlt/core/touch: taps and swipes on an animation or a game never zoom or pan the page. One
 * delegated listener set on the document (capture, not passive) cancels, on the surfaces that match
 * `sel`, what CSS `touch-action` can't: iOS Safari's `gesturestart` / `gesturechange` (its pinch,
 * which ignores `user-scalable=no`) and any multi-touch `touchstart` / `touchmove` (a pinch
 * anywhere else). One finger is never touched, so taps, drags and the page's own scroll stay.
 * The CSS half lives in the Board UI kit (board-ui.css): `touch-action: manipulation` on the page
 * (no double-tap zoom) and `touch-action: none` / `pan-y` plus `overscroll-behavior: none` on the
 * same surfaces. Pass `null` to lock the whole page (a full-screen board; content pages keep
 * pinch-zoom for WCAG 1.4.4). Returns `release()`: the page gets its gestures back.
 */

/** The surfaces Fizlet draws on: slot stages, game hosts, the touch pad, draggable panels, and anything marked `data-touch-lock`. */
export const SURFACES = "[data-fizlet-slot],[data-fizlet-host],[data-touch-lock],.bui-pad,.bui-grip";

const TYPES = ["gesturestart", "gesturechange", "touchstart", "touchmove"] as const;

/** Lock pinch on the surfaces matching `sel` (`null`: the whole page). Returns `release()`. */
export function lockTouch(doc: Document = document, sel: string | null = SURFACES): () => void {
  const opt = { capture: true, passive: false };
  const on = (ev: Event) => {
    const t = ev.target as Element | null;
    if ((ev.type[0] == "g" || (ev as TouchEvent).touches.length > 1) && (sel == null || t?.closest?.(sel))) ev.preventDefault();
  };
  for (const t of TYPES) doc.addEventListener(t, on, opt);
  return () => {
    for (const t of TYPES) doc.removeEventListener(t, on, opt);
  };
}
