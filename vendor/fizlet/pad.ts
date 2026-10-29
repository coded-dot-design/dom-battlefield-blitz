/**
 * fizlet/pad: swappable on-screen controls for touch (and mouse). One move control (an analog
 * stick, a d-pad or move keys) under one thumb and round arcade action keys under the other, all
 * driving `controls` intents through `press()` / `steer()`: game code reads `down`, `hit` and
 * `axis` and never knows which scheme is on screen. Swap with `setScheme()` at any time.
 *
 * Visuals are the Board UI kit's (`.bui-pad`, `.bui-stick`, `.bui-dpad`, `.bui-arcade` + roles):
 * mount the pad inside a `.bui` root. Listeners are delegated on the pad's one element (bound to
 * the engine's signal), so a scheme swap adds none; the element goes through the ledger.
 */
import type { Engine } from "./kernel/engine";
import type { Controls } from "./input";

export type Scheme = "stick" | "dpad" | "buttons";
export type PadRole = "fire" | "aim" | "attack" | "advance" | "fallin" | "sys" | "cmd" | "go" | "flag";

export interface PadAction {
  /** The `controls` intent this key drives. */
  intent: string;
  /** Short caption on the key (e.g. "FIRE"); empty for icon-only. */
  label: string;
  /** Accessible name (default: label), e.g. "Hold to fire the cannon (Space)". */
  name?: string;
  /** Inline SVG markup (trusted game code). */
  icon?: string;
  /** Shortcut chip for fine pointers, e.g. "SPACE". */
  key?: string;
  /** Kit role colour (default: "fire" for the first action, "sys" for the rest). */
  role?: PadRole;
  /** Held while the finger is down (default: a tap = one press, one `hit`). */
  hold?: boolean;
  /** Each tap flips the intent: `down(intent)` is the switch; `press(intent, on)` from code flips the key too. */
  toggle?: boolean;
}

export interface PadOptions {
  /** "stick" (analog, drives the stick axes), "dpad" (one finger, 8-way) or "buttons" (a key per move intent). */
  scheme?: Scheme;
  /** Action keys; the first is the big primary key. */
  actions?: PadAction[];
  /** Which thumb gets the action keys (default "right"); the move control takes the other. */
  side?: "left" | "right";
  /** Where the pad goes (default: the engine root). Must be inside a `.bui` root for the kit look. */
  host?: HTMLElement;
  /** Move intents [up, down, left, right] for the d-pad and move keys; "" leaves one out. */
  move?: string[];
}

const DEAD = 0.15, DPAD_DEAD = 0.25;
const ARROW = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 12.5l5-5 5 5"/></svg>'; // the kit turns it per direction
const DIRS = ["Up", "Down", "Left", "Right"];

/** Stick vector from a drag offset in radii: clamped to the unit circle, dead zone rescaled so a
 *  light push still creeps (Battlefield's feel). Writes out[0], out[1]; never allocates. */
export function stickAt(dx: number, dy: number, out: Float64Array) {
  const d = Math.hypot(dx, dy), k = d < DEAD ? 0 : (Math.min(1, d) - DEAD) / (1 - DEAD) / d;
  out[0] = dx * k;
  out[1] = dy * k;
}

/** D-pad direction mask (up 1, down 2, left 4, right 8; diagonals combine) from a drag offset in radii. */
export function dpadAt(dx: number, dy: number) {
  // Eight equal 45° sectors: an axis counts once the direction is more than 22.5° off its normal.
  const d = Math.hypot(dx, dy), t = d * 0.3827;
  return d < DPAD_DEAD ? 0 : (dy < -t ? 1 : dy > t ? 2 : 0) | (dx < -t ? 4 : dx > t ? 8 : 0);
}

const STICK = '<div class="bui-stick" role="application" aria-label="Move: drag in any direction"><i class="bui-knob"></i></div>';
const arrows = (move: string[]) =>
  move.map((m, d) => (m ? `<button type="button" class="bui-arcade bui-sys" data-d="${d}" aria-label="${DIRS[d]}">${ARROW}</button>` : "")).join("");

// Labels, names and keys are text (escaped); `icon` is trusted SVG markup supplied by the game.
const esc = (t: string) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function pad(e: Engine, c: Controls, o: PadOptions = {}) {
  const acts = o.actions ?? [], move = o.move ?? ["up", "down", "left", "right"];
  const ctl = new AbortController(), on = { signal: ctl.signal };
  e.signal.addEventListener("abort", () => ctl.abort(), on);
  const el = e.ledger.add(document.createElement("div"));
  el.className = "bui-pad";
  el.dataset.hand = o.side ?? "right";
  el.setAttribute("data-fizlet-ignore", ""); // the field stick and pointer never see pad touches
  // Labels, names and icons are game code (trusted), like any markup the game writes.
  el.innerHTML = `<div class="bui-pad-move"></div><div class="bui-pad-keys">${acts
    .map((a, i) => `<button type="button" class="bui-arcade bui-${(a.role ?? (i ? "sys" : "fire")).replace(/[^a-z-]/g, "")}${i ? "" : " bui-primary"}" data-i="${i}" aria-label="${esc(a.name ?? a.label)}"${a.toggle ? ' aria-pressed="false"' : ""}>${a.icon ?? ""}${a.label ? `<small>${esc(a.label)}</small>` : ""}${a.key ? `<kbd>${esc(a.key)}</kbd>` : ""}</button>`)
    .join("")}</div>`;
  const moveEl = el.firstChild as HTMLElement, kb = (el.lastChild as HTMLElement).children as HTMLCollectionOf<HTMLElement>;
  // Move keys (d-pad arrows or move keys) by direction; the knob when the stick is on.
  const lit = new Uint8Array(acts.length);
  let dk: HTMLElement[] = [], knob: HTMLElement | null = null, mask = 0, scheme: Scheme | "" = "";
  // Move control: centre x, y, radius (read once per touch start), knob offset wanted (3, 4) and
  // drawn (5, 6), and the pointer id holding it (7). The stick vector goes through v.
  const g = new Float64Array(9), v = new Float64Array(2);
  let pk: Element | null = null; // the key the last pointer pressed (its click is not a second tap)
  g[7] = -1;

  const paint = (i: number, now: boolean) => {
    lit[i] = now ? 1 : 0;
    kb[i]!.setAttribute("aria-pressed", String(now)); // in the handler: a key repainted a frame late bounces
  };
  // A tap: a toggle flips, a hold key holds (pointer), anything else presses once (one hit).
  const tap = (i: number, hold: boolean) => {
    const a = acts[i]!;
    if (a.toggle) return paint(i, (c.press(a.intent, !c.down(a.intent)), c.down(a.intent)));
    c.press(a.intent);
    if (!(hold && a.hold)) c.press(a.intent, false);
  };
  const dir = (m: number) => {
    for (let d = 0, b = 1; d < 4; d++, b <<= 1)
      if ((m ^ mask) & b && move[d]) c.press(move[d]!, (m & b) > 0), dk[d]?.classList.toggle("down", (m & b) > 0);
    mask = m;
  };
  const drag = (ev: PointerEvent) => {
    const dx = (ev.clientX - g[0]!) / g[2]!, dy = (ev.clientY - g[1]!) / g[2]!;
    if (!knob) return dir(dpadAt(dx, dy));
    stickAt(dx, dy, v);
    c.steer(v[0]!, v[1]!);
    const k = g[2]! / Math.max(1, Math.hypot(dx, dy));
    g[3] = dx * k;
    g[4] = dy * k;
  };
  const letGo = (t: HTMLElement) => {
    const i = t.dataset.i, d = t.dataset.d;
    t.classList.remove("down");
    if (i) acts[+i]!.hold && c.press(acts[+i]!.intent, false);
    else if (d) c.press(move[+d]!, false);
    else if (((g[7] = -1), knob)) c.steer(0, 0, false), (g[3] = g[4] = 0);
    else dir(0);
  };
  const release = () => el.querySelectorAll<HTMLElement>(".down").forEach(letGo);

  // One delegated handler for every pointer event. Pointer capture sends each finger's events to
  // the element it pressed, so that element's `.down` is all the state a key needs (multi-touch).
  const handle = (ev: Event) => {
    const p = ev as PointerEvent, at = p.target as Element, key = at.closest<HTMLElement>("[data-i],[data-d]");
    const mv = at.closest<HTMLElement>(".bui-stick,.bui-dpad"), t = mv ?? key, i = key?.dataset.i, d = key?.dataset.d;
    if (!t) return;
    if (p.type === "click") {
      // Keyboard (Enter / Space on a focused key) is a tap; pointer clicks already acted on down.
      // Some browsers report a touch tap's click with detail 0 too, so a click on the key a pointer
      // just pressed is never a second tap.
      if (key && key === pk && p.timeStamp - g[8]! < 1000) return void (pk = null);
      if (!p.detail && key) i ? tap(+i, false) : (c.press(move[+d!]!), c.press(move[+d!]!, false));
    } else if (p.type === "pointerdown") {
      if (p.button > 0) return;
      pk = key;
      g[8] = p.timeStamp;
      p.preventDefault(); // no focus steal, no text selection, no emulated mouse
      try {
        t.setPointerCapture(p.pointerId);
      } catch {} // a synthetic or finished pointer can't be captured; the press still counts
      if (i && acts[+i]!.toggle) return tap(+i, true);
      t.classList.add("down");
      if (!mv) return i ? tap(+i, true) : c.press(move[+d!]!);
      // A new finger on the move control takes it (a release the browser dropped never blocks it).
      g[7] = p.pointerId;
      const r = t.getBoundingClientRect(); // one layout read per touch start, never in a step
      g[0] = r.left + r.width / 2;
      g[1] = r.top + r.height / 2;
      g[2] = Math.max(1, r.width * (knob ? 0.36 : 0.5));
      drag(p);
    } else if (p.type === "pointermove") {
      if (mv && p.pointerId === g[7]) drag(p);
    } else if (mv ? p.pointerId === g[7] : t.classList.contains("down")) letGo(t);
  };
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture", "click"]) el.addEventListener(type, handle, on);

  const system = e.add({
    render() {
      if (knob && (g[3] !== g[5] || g[4] !== g[6])) {
        g[5] = g[3]!;
        g[6] = g[4]!;
        knob.style.translate = g[3] || g[4] ? `${g[3]!.toFixed(1)}px ${g[4]!.toFixed(1)}px` : "";
      }
      // Toggles follow the intent, so a press(intent, on) from game code repaints its key.
      for (let i = 0; i < acts.length; i++) if (acts[i]!.toggle && c.down(acts[i]!.intent) !== (lit[i] === 1)) paint(i, !lit[i]);
    },
  });

  /** Swap the move control. Fingers on the old one let go first; listeners stay as they are. */
  const setScheme = (s: Scheme) => {
    if (s === scheme) return;
    release();
    scheme = el.dataset.scheme = s;
    g[3] = g[4] = g[5] = g[6] = 0;
    moveEl.innerHTML = s === "stick" ? STICK : s === "dpad" ? `<div class="bui-dpad" role="group" aria-label="Move">${arrows(move)}</div>` : arrows(move);
    knob = moveEl.querySelector("i");
    dk = [];
    moveEl.querySelectorAll<HTMLElement>("[data-d]").forEach((b) => (dk[+b.dataset.d!] = b));
  };
  setScheme(o.scheme ?? "stick");
  (o.host ?? (e.root as HTMLElement)).append(el);

  return {
    /** The pad's root element (`.bui-pad`). */
    el,
    get scheme() {
      return scheme as Scheme;
    },
    setScheme,
    /** Let go of every finger, remove the listeners and the pad (engine.destroy() does this too). */
    destroy() {
      release();
      ctl.abort();
      e.remove(system);
      el.remove();
    },
  };
}
export type Pad = ReturnType<typeof pad>;
