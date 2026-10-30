/**
 * fizlet/coach: the hints and tutorial layer the board games share, in three small parts:
 * - `flag`: a once-only switch kept in localStorage ("tips off", "seen the tour"). Every read and
 *   write is wrapped in try/catch, so a page with storage blocked (private mode, sandboxed iframe,
 *   quota) just reads "not set" and plays on;
 * - `tour`: DOM-free tutorial steps. It counts time on the current step, moves on when the game says
 *   the step is done (`coach:step` on the event ring), then cycles tips every `every` seconds.
 *   `show()` says which card to draw only when it changed, so the DOM is written once per card;
 * - `card`: the Board UI kit card that shows it (count, title, text, an End button) and rings the
 *   control it is about. Its look is DOM Battlefield's coach card, inline on the kit tokens.
 * Defaults are DOM Battlefield Blitz's practice coach (10 steps, then a tip every 6 s), so a port
 * keeps its pace. `tour` steps without allocating; call it from a step like the rest of the game.
 */
import type { Engine } from "./kernel/engine";

/** A localStorage switch: `on` when `key` holds `value` (default "1"). Never throws. */
export function flag(key: string, value = "1") {
  return {
    get on() {
      try {
        return localStorage.getItem(key) === value;
      } catch {
        return false;
      }
    },
    /** Set it (the player turned tips off, finished the tour…). */
    mark() {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {}
    },
  };
}

export interface TourOptions {
  /** Tutorial steps (default 10). */
  steps?: number;
  /** Tips shown in turn after the last step (default 7), one every `every` seconds (default 6). */
  tips?: number;
  every?: number;
}

export function tour(e: Engine, o: TourOptions = {}) {
  const steps = Math.max(0, (o.steps ?? 10) | 0), tips = Math.max(1, (o.tips ?? 7) | 0), every = o.every ?? 6;
  // step, card shown (-1: none yet); seconds on this step. Ints in an Int32Array so reading them never boxes.
  const n = new Int32Array([0, -1]), t = new Float64Array(1);
  return {
    /** Seconds on this step (after the last: since it ended). A typed array: read time[0]. */
    time: t,
    /** The step the player is on; `steps` once the tutorial is over. */
    get step() { return n[0]!; },
    get done() { return n[0]! >= steps; },
    steps,
    /** Count dt on this step. Call once a step, before you test whether it is done. */
    tick(dt: number) {
      t[0]! += dt;
    },
    /** The current step is done: on to the next (time back to 0, `coach:step` on the ring). False after the last. */
    pass() {
      if (n[0]! >= steps) return false;
      n[0]!++;
      t[0] = 0;
      e.events.emit("coach:step", n[0]!, steps);
      return true;
    },
    /** The card to draw, only when it changed since the last call: a step (0…steps − 1), a tip
     *  (steps + 0…tips − 1), or -1 for no change. */
    show() {
      const k = n[0]! < steps ? n[0]! : steps + (((t[0]! / every) | 0) % tips);
      if (k === n[1]) return -1;
      n[1] = k;
      return k;
    },
    /** Back to step 0 (a new practice run). */
    reset() {
      n[0] = 0; n[1] = -1; t[0] = 0;
    },
  };
}
export type Tour = ReturnType<typeof tour>;

export interface CardOptions {
  /** The End button's label (default "END PRACTICE") and what it does (hidden if none). */
  end?: string;
  onEnd?(): void;
  signal?: AbortSignal;
}

// DOM Battlefield's .bf-coach-card on the kit tokens (dashed system-key border, muted text, key-ink title).
const LOOK =
  "position:absolute;left:50%;top:max(76px,calc(env(safe-area-inset-top) + 66px));transform:translateX(-50%);z-index:40;" +
  "display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:2px 12px;width:min(520px,calc(100% - 24px));" +
  "box-sizing:border-box;padding:8px 12px;background:var(--surface);border:2px dashed var(--k-sys);border-radius:8px;" +
  "color:var(--muted);font:700 11px/1.35 ui-monospace,monospace";
const RING = "3px dashed var(--k-sys-ink)";

/** The coach card, added to `host` (hidden until `show`). */
export function card(host: HTMLElement, o: CardOptions = {}) {
  const doc = host.ownerDocument, el = doc.createElement("div");
  el.className = "fizlet-coach";
  el.setAttribute("role", "status");
  el.style.cssText = LOOK;
  el.hidden = true;
  el.innerHTML =
    '<span style="grid-row:span 2;color:var(--k-sys-ink)"></span><b style="color:var(--k-sys-ink);letter-spacing:2px;font-size:13px"></b>' +
    '<small style="grid-column:2;font-size:11px"></small>' +
    (o.onEnd ? '<button class="bui-arcade bui-attack" type="button" style="grid-row:1/span 2;grid-column:3;min-height:36px;font-size:10px"></button>' : "");
  const [count, title, text] = [el.children[0] as HTMLElement, el.children[1] as HTMLElement, el.children[2] as HTMLElement];
  const end = el.children[3] as HTMLElement | undefined;
  if (end) {
    end.textContent = o.end ?? "END PRACTICE";
    end.addEventListener("click", () => o.onEnd!(), { signal: o.signal } as AddEventListenerOptions);
  }
  host.append(el);
  // The ringed control's own inline outline, put back exactly when the ring moves on (Recall).
  let ringed: HTMLElement | null = null, was = ["", ""];
  const set = (n: HTMLElement, v: string) => { if (n.textContent !== v) n.textContent = v; };
  const unring = () => {
    if (ringed) (ringed.style.outline = was[0]!), (ringed.style.outlineOffset = was[1]!);
    ringed = null;
  };
  const api = {
    el,
    /** Show a card (writes only what changed); `target` gets the dashed ring. */
    show(c: string, t: string, body: string, target?: HTMLElement | null) {
      set(count, c); set(title, t); set(text, body);
      if (target !== ringed) {
        unring();
        if (target) (was = [target.style.outline, target.style.outlineOffset]), (target.style.outline = RING), (target.style.outlineOffset = "6px"), (ringed = target);
      }
      el.hidden = false;
    },
    hide() {
      unring();
      el.hidden = true;
    },
    remove() {
      api.hide();
      el.remove();
    },
  };
  // An already-aborted signal never fires: remove at once, like the End button's listener (never added).
  o.signal?.aborted ? api.remove() : o.signal?.addEventListener("abort", api.remove, { once: true });
  return api;
}
