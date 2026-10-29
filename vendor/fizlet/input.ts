/**
 * fizlet/input: one controller for keys, pointer and a touch stick, mapped to named intents.
 * Listeners only record; the engine's read phase latches edges and measures the target, so a step
 * sees a stable snapshot. Keys typed into the host page's fields (or inside [data-fizlet-ignore])
 * never count. Held state is dropped on window blur, when the engine pauses, on dispose() and on
 * destroy: nothing stays stuck.
 *
 * `hit` (an intent or the pointer): a press is seen by exactly one fixed step, the first step after
 * it, even when that comes frames later (0-step frames while catching up) and never again in the
 * same frame's later steps. Outside a step (read, render), `hit` is true for the one frame whose
 * read latched it. Presses between two steps count once.
 */
import type { Engine, System } from "./kernel/engine";

export interface ControlsOptions {
  /** intent → key codes, e.g. { fire: ["Space"], up: ["KeyW", "ArrowUp"] } (KeyboardEvent.code). */
  keys?: Record<string, string[]>;
  /** Where the pointer is measured and the stick lives (default: the engine root, else window). */
  target?: HTMLElement;
  /** Touch: a drag that starts on the left half (or anywhere: "any") drives a virtual stick. */
  stick?: "left" | "any" | false;
  /** Stick radius in CSS px (default 60). */
  radius?: number;
}

const EDIT = "input,textarea,select,[contenteditable],[data-fizlet-ignore]";

export function controls(e: Engine, o: ControlsOptions = {}) {
  const ctl = new AbortController(), on = { signal: ctl.signal };
  const names = Object.keys(o.keys ?? {}), N = names.length;
  // A key code can drive several intents; an intent can have several keys.
  const byCode = new Map<string, number[]>();
  names.forEach((n, i) => o.keys![n]!.forEach((c) => (byCode.get(c) ?? byCode.set(c, []).get(c)!).push(i)));
  const keys = new Set<string>(); // physical keys down
  const cnt = new Uint8Array(N), btn = new Uint8Array(N); // keys down per intent, press() per intent
  // Edges for each intent plus the pointer (slot N): pending, latched this frame, the step it is for.
  const pend = new Uint8Array(N + 1), fresh = new Uint8Array(N + 1), at = new Float64Array(N + 1).fill(-1);
  const index = (n: string) => names.indexOf(n);
  const isDown = (i: number) => cnt[i]! + btn[i]! > 0;
  const hit = (i: number) => (e.phase === 2 /* STEP */ ? at[i] === e.steps : fresh[i] === 1);
  const target = o.target ?? (e.root as HTMLElement | null) ?? null;
  const R = o.radius ?? 60;
  // Pointer: x, y (relative to target), down, client x, client y, owner pointer id,
  // target left, top, width (measured in read), needs measuring.
  // Stick: x, y in -1..1, active, origin x, origin y, pointer id.
  const p = new Float64Array(10), s = new Float64Array(6);
  p[5] = s[5] = -1;
  const measure = () => {
    const r = target?.getBoundingClientRect();
    p[6] = r?.left ?? 0;
    p[7] = r?.top ?? 0;
    p[8] = r?.width ?? innerWidth;
    p[9] = 0;
  };
  const editing = (t: EventTarget | null) => t instanceof Element && !!t.closest(EDIT);
  const clear = () => {
    keys.clear();
    cnt.fill(0);
    btn.fill(0);
    pend.fill(0);
    fresh.fill(0);
    at.fill(-1);
    p[2] = s[0] = s[1] = s[2] = 0;
    p[5] = s[5] = -1;
  };

  addEventListener("keydown", (ev) => {
    const list = byCode.get(ev.code);
    if (!list || editing(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    e.wake(); // a settled engine (page interactions) wakes on its own keys
    if (e.running) ev.preventDefault();
    if (keys.has(ev.code)) return;
    keys.add(ev.code);
    for (const i of list) {
      if (!ev.repeat && !isDown(i)) pend[i] = 1;
      cnt[i]!++;
    }
  }, on);
  addEventListener("keyup", (ev) => {
    if (keys.delete(ev.code)) for (const i of byCode.get(ev.code)!) cnt[i]!--;
  }, on);
  addEventListener("blur", clear, on);

  const el: EventTarget = target ?? window;
  el.addEventListener("pointermove", (ev) => {
    const pe = ev as PointerEvent;
    e.wake();
    if (pe.pointerId === s[5]) {
      let dx = pe.clientX - s[3]!, dy = pe.clientY - s[4]!;
      const d = Math.hypot(dx, dy);
      if (d > R) (dx *= R / d), (dy *= R / d);
      s[0] = dx / R;
      s[1] = dy / R;
      return;
    }
    // No layout read here: the read phase measures the target once per frame.
    p[3] = pe.clientX;
    p[4] = pe.clientY;
    p[9] = 1;
  }, on);
  el.addEventListener("pointerdown", (ev) => {
    const pe = ev as PointerEvent;
    if (editing(pe.target)) return;
    e.wake();
    measure(); // a press is rare and decides the stick side: measure it fresh
    if (pe.pointerType === "touch" && o.stick && s[5]! < 0 && (o.stick === "any" || pe.clientX - p[6]! < p[8]! / 2)) {
      s[2] = 1;
      s[3] = pe.clientX;
      s[4] = pe.clientY;
      s[5] = pe.pointerId;
      s[0] = s[1] = 0;
      return;
    }
    p[3] = pe.clientX;
    p[4] = pe.clientY;
    p[2] = 1;
    p[5] = pe.pointerId;
    pend[N] = 1;
  }, on);
  // Released anywhere (outside the target too), cancelled, or capture lost: only its owner lets go.
  const up = (ev: Event) => {
    const id = (ev as PointerEvent).pointerId;
    if (id === s[5]) (s[0] = s[1] = s[2] = 0), (s[5] = -1);
    if (id === p[5]) (p[2] = 0), (p[5] = -1);
  };
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) addEventListener(t, up, { signal: ctl.signal, capture: true });

  const system: System = {
    read() {
      const t = e.steps;
      for (let i = 0; i <= N; i++) {
        fresh[i] = pend[i]!;
        if (pend[i]) (at[i] = t), (pend[i] = 0);
      }
      if (p[9]) measure();
      p[0] = p[3]! - p[6]!;
      p[1] = p[4]! - p[7]!;
    },
    pause: clear,
  };
  e.add(system);
  /** Remove this controller only (listeners, system, held state); the engine keeps running. */
  const dispose = () => {
    ctl.abort();
    e.remove(system);
    clear();
  };
  e.signal.addEventListener("abort", dispose, on);

  return {
    /** Held right now (any of its keys, or press()). */
    down: (intent: string) => isDown(index(intent)),
    /** Pressed: true in the first step after the press; outside steps, for the frame it latched. */
    hit: (intent: string) => hit(index(intent)),
    /** -1..1 from two intents (keys), plus the stick when it's active. */
    axis(neg: string, pos: string, stickAxis?: 0 | 1) {
      const k = +isDown(index(pos)) - +isDown(index(neg));
      return k || (stickAxis === undefined ? 0 : s[stickAxis]!);
    },
    pointer: {
      get x() { return p[0]!; },
      get y() { return p[1]!; },
      get down() { return p[2] === 1; },
      get hit() { return hit(N); },
    },
    stick: {
      get x() { return s[0]!; },
      get y() { return s[1]!; },
      get active() { return s[2] === 1; },
    },
    /** Press an intent from code (on-screen keys): `press("strike")`. */
    press(intent: string, down = true) {
      const i = index(intent);
      if (i < 0) return;
      if (down && !isDown(i)) pend[i] = 1;
      btn[i] = +down;
    },
    /** Drive the stick from code (an on-screen stick, fizlet/pad): x, y in -1..1; `on = false` lets go. */
    steer(x: number, y: number, on = true) {
      s[0] = on ? x : 0;
      s[1] = on ? y : 0;
      s[2] = on ? 1 : 0;
    },
    dispose,
    system,
  };
}
export type Controls = ReturnType<typeof controls>;
