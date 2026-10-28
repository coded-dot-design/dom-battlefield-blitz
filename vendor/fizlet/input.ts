/**
 * fizlet/input: one controller for keys, pointer and a touch stick, mapped to named intents.
 * Listeners only record; the engine's read phase latches one-frame edges, so a step sees a stable
 * snapshot. Keys typed into the host page's fields (or inside [data-fizlet-ignore]) never count.
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
  const names = Object.keys(o.keys ?? {});
  const byCode = new Map<string, number>();
  names.forEach((n, i) => o.keys![n]!.forEach((c) => byCode.set(c, i)));
  const held = new Uint8Array(names.length), pend = new Uint8Array(names.length), hit = new Uint8Array(names.length);
  const index = (n: string) => names.indexOf(n);
  const target = o.target ?? (e.root as HTMLElement | null) ?? null;
  const R = o.radius ?? 60;
  // Pointer: x, y (relative to target), down, hit (pressed this frame), pending hit, inside.
  // Stick: x, y in -1..1, active, origin x, origin y, pointer id.
  const p = new Float64Array(6), s = new Float64Array(6);
  s[5] = -1;
  const on = { signal: e.signal };
  const rel = (ev: PointerEvent) => {
    const r = target?.getBoundingClientRect();
    p[0] = ev.clientX - (r?.left ?? 0);
    p[1] = ev.clientY - (r?.top ?? 0);
  };
  const editing = (t: EventTarget | null) => t instanceof Element && !!t.closest(EDIT);

  addEventListener("keydown", (ev) => {
    const i = byCode.get(ev.code);
    if (i === undefined || editing(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (e.running) ev.preventDefault();
    if (!held[i]) pend[i] = 1;
    held[i] = 1;
  }, on);
  addEventListener("keyup", (ev) => {
    const i = byCode.get(ev.code);
    if (i !== undefined) held[i] = 0;
  }, on);
  addEventListener("blur", () => (held.fill(0), (p[2] = 0), (s[2] = 0), (s[5] = -1)), on);

  const el: EventTarget = target ?? window;
  el.addEventListener("pointermove", (ev) => {
    const pe = ev as PointerEvent;
    rel(pe);
    if (pe.pointerId === s[5]) {
      let dx = pe.clientX - s[3]!, dy = pe.clientY - s[4]!;
      const d = Math.hypot(dx, dy);
      if (d > R) (dx *= R / d), (dy *= R / d);
      s[0] = dx / R;
      s[1] = dy / R;
    }
  }, on);
  el.addEventListener("pointerdown", (ev) => {
    const pe = ev as PointerEvent;
    if (editing(pe.target)) return;
    rel(pe);
    const w = target?.clientWidth ?? innerWidth;
    if (pe.pointerType === "touch" && o.stick && s[5]! < 0 && (o.stick === "any" || p[0]! < w / 2)) {
      s[2] = 1;
      s[3] = pe.clientX;
      s[4] = pe.clientY;
      s[5] = pe.pointerId;
      s[0] = s[1] = 0;
      return;
    }
    p[2] = 1;
    p[4] = 1;
  }, on);
  const up = (ev: Event) => {
    const pe = ev as PointerEvent;
    if (pe.pointerId === s[5]) return void ((s[2] = 0), (s[0] = s[1] = 0), (s[5] = -1));
    p[2] = 0;
  };
  el.addEventListener("pointerup", up, on);
  el.addEventListener("pointercancel", up, on);

  const system: System = {
    read() {
      for (let i = 0; i < hit.length; i++) (hit[i] = pend[i]!), (pend[i] = 0);
      p[3] = p[4]!;
      p[4] = 0;
    },
  };
  e.add(system);

  return {
    /** Held right now. */
    down: (intent: string) => held[index(intent)] === 1,
    /** Pressed since the last frame (true for exactly one frame). */
    hit: (intent: string) => hit[index(intent)] === 1,
    /** -1..1 from two intents (keys), plus the stick when it's active. */
    axis(neg: string, pos: string, stickAxis?: 0 | 1) {
      const k = (held[index(pos)] ?? 0) - (held[index(neg)] ?? 0);
      return k || (stickAxis === undefined ? 0 : s[stickAxis]!);
    },
    pointer: {
      get x() { return p[0]!; },
      get y() { return p[1]!; },
      get down() { return p[2] === 1; },
      get hit() { return p[3] === 1; },
    },
    stick: {
      get x() { return s[0]!; },
      get y() { return s[1]!; },
      get active() { return s[2] === 1; },
    },
    /** Press an intent from code (on-screen keys): `press("strike")`. */
    press(intent: string, on = true) {
      const i = index(intent);
      if (i < 0) return;
      if (on && !held[i]) pend[i] = 1;
      held[i] = on ? 1 : 0;
    },
    system,
  };
}
export type Controls = ReturnType<typeof controls>;
