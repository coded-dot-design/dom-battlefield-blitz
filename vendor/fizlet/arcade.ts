/**
 * fizlet/arcade: the shell every page arcade game repeats, so a game is only its rules and its art.
 * One engine per run over the host page (`fizlet/board-page`: its words are terrain, its buttons are
 * targets), a fixed overlay with a canvas and a scoreboard in the Board UI kit (title, sound, pause,
 * fold and exit keys, readouts, an optional meter, action keys, a comms toast), keys and pointer
 * (`fizlet/input`), the touch pad on coarse pointers (`fizlet/pad`), sound from the event ring
 * (`fizlet/sound`), sparks and stacking score popups, factory health painted into the buttons, and
 * a controller a hub drives: start, pause, resume, stop, destroy, getSnapshot. While a run is live,
 * a click on the page fires instead of following a link; the scoreboard, fields and
 * `[data-virus-ignore]` / `[data-fizlet-ignore]` keep their clicks. Recall (Escape, the exit key,
 * stop) destroys the engine, so every letter and button comes back exactly; a run that ends keeps
 * the scoreboard with the result until Recall. The game supplies `create(ctx)`: its own systems on
 * `ctx.engine`, reading `ctx.ctl` (written in the read phase) and drawing in render.
 */
import { createEngine } from "./kernel/engine";
import type { Engine, System } from "./kernel/engine";
import type { FizEvent } from "./kernel/ring";
import { boardPage } from "./board-page";
import type { BoardPage } from "./board-page";
import { controls } from "./input";
import type { Controls } from "./input";
import { pad } from "./pad";
import type { PadAction } from "./pad";
import { sound } from "./sound";
import type { Cue } from "./sound";
import { mount, readouts, toast } from "./ui/board-ui";

/** Controls and view, written once per frame in the read phase (a step reads them): mode (0 keys or
 *  stick, 1 pointer), pointer x, y and on, move x, y (-1..1), fire, viewport width and height, and
 *  reduced motion (1/0). The game writes TARGET_HP: the full health of a target, for its paint. */
export const MODE = 0, PX = 1, PY = 2, PON = 3, KX = 4, KY = 5, FIRE = 6, VW = 7, VH = 8, CALM = 9, TARGET_HP = 10;

export interface ArcadeAction {
  /** The controls intent: `ctx.input.hit(id)` in a step. */
  id: string;
  /** KeyboardEvent.code, e.g. "KeyB". */
  key: string;
  /** Scoreboard key text, e.g. "B · Cover". */
  label: string;
}
export type ArcadeStatus = "idle" | "running" | "paused" | "won" | "gameover" | "destroyed";
export interface ArcadeOptions<S> {
  /** The board: a selector or an element (default document.body). */
  root?: string | Element;
  textSelector?: string;
  targetSelector?: string;
  excludeSelector?: string;
  /** "system" (default) follows the visitor's colour scheme. */
  theme?: "dark" | "light" | "system";
  seed?: number;
  reducedMotion?: boolean;
  /** Start with sound on (default true; it waits for a gesture to unlock). */
  sound?: boolean;
  /** "keyboard": the mouse never steers. */
  controls?: "mouse" | "keyboard";
  onState?: (state: ArcadeSnapshot<S>) => void;
  onEvent?: (event: { type: string; game: string; [key: string]: unknown }) => void;
  onError?: (error: unknown) => void;
}
export type ArcadeSnapshot<S> = Partial<S> & {
  id: string;
  status: ArcadeStatus;
  elapsed: number;
  frameMs: number;
  maxFrameMs: number;
  notice: string;
  /** Letters indexed, on screen and spent, and the range reads the last measurement made. */
  board?: { indexed: number; visible: number; spent: number; measurements: number };
  /** Sparks alive (at most 100). */
  particles?: number;
};
export interface ArcadeController<S> {
  start(): ArcadeSnapshot<S>;
  pause(): void;
  resume(): void;
  stop(): void;
  destroy(): void;
  getSnapshot(): ArcadeSnapshot<S>;
}
/** What `create` gets: the run's engine and board, the controls, and the shell's presentation. */
export interface ArcadeContext {
  engine: Engine;
  board: BoardPage;
  input: Controls;
  /** MODE … TARGET_HP (see the constants). */
  ctl: Float64Array;
  reduced(): boolean;
  /** A popup at (x, y): `+value` when `text` is null (stacked with nearby ones), else the text.
   *  Tone 0 score, 1 accent (upgrade), 2 hurt. Call it from render (react). */
  popup(x: number, y: number, value: number, text: string | null, tone?: 0 | 1 | 2): void;
  /** n sparks from (x, y) in colour `c` (an index into `colors`); none under reduced motion. */
  spark(x: number, y: number, n: number, c: number): void;
  /** A line in the comms toast. */
  say(text: string, ms?: number): void;
  /** onEvent for the hub (a plain object: call it from render, not a step). */
  emit(type: string, data?: Record<string, unknown>): void;
  /** In-page art: a shadow root in an overlay inside `el` (an absolutely positioned host that
   *  follows the page's layout, scrolling and transforms natively). A static `el` becomes
   *  relative. Through the ledger: Recall removes it and puts the style back. Call from create
   *  or reset (it reads computed style), never from a step. Null for replaced elements. */
  attach(el: Element): ShadowRoot | null;
}
export interface ArcadeGame<S> {
  /** A fresh run (the viewport is in ctl[VW], ctl[VH]). */
  reset(): void;
  /** 0 playing, 1 lost, 2 won: read every render; the run ends the frame it turns non-zero. */
  over(): number;
  /** The page scrolled by (dx, dy): move page-space things (read phase). */
  scroll?(dx: number, dy: number): void;
  /** Each event on the ring this frame (render): popups, sparks, the toast, onEvent. */
  react?(ev: FizEvent): void;
  /** Draw on the canvas (render), after the target beacons, before sparks and popups. */
  draw(ctx: CanvasRenderingContext2D, dt: number): void;
  /** The readout values, in `readouts` order, then the meter's change key (render, change-only). */
  hud(out: Float64Array): void;
  /** The meter's left text, right text and fill 0..1, when its change key moved. */
  meter?(): readonly [string, string, number];
  /** The snapshot's game fields (not a hot path). */
  stats(): S;
}
export interface ArcadeDef<S> {
  id: string;
  title: string;
  /** The game's accent (hex): title, meter, popups, target paint at full health. */
  color: string;
  hint: string;
  touchHint?: string;
  /** The Board UI kit CSS text (the game bakes in the sections it uses). */
  css: string;
  /** Hold Space / the pointer to fire; a Fire key on the touch pad and an Auto fire key. */
  fire?: boolean;
  actions?: ArcadeAction[];
  /** Touch move control (default "stick"; "dpad" for grid games). */
  pad?: "stick" | "dpad";
  /** Keys (or the stick) only: the mouse never steers. */
  keyboard?: boolean;
  /** Readouts: label, tone, how the value shows, and whether it hides when the board is folded. */
  readouts: [label: string, tone?: "team" | "enemy" | undefined, fmt?: ((v: number) => string) | undefined, fold?: boolean | undefined][];
  meter?: { label: string };
  /** Spark colours, by index. */
  colors: string[];
  /** Event type → sound cue. */
  cues: Record<string, Cue>;
  /** Paint targets with their health (default true). */
  paint?: boolean;
  create(ctx: ArcadeContext): ArcadeGame<S>;
}

const EDIT = 'input,textarea,select,[contenteditable],form,dialog,[role="dialog"]';
const PROTECTED = "[data-virus-ignore],[data-fizlet-ignore]";
const svg = (d: string) => `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  sound: svg('<path d="M3 8h3l4-4v12l-4-4H3ZM14 6q4 4 0 8"/>'),
  mute: svg('<path d="M3 8h3l4-4v12l-4-4H3ZM14 8l4 4m0-4-4 4"/>'),
  pause: svg('<path d="M7 5v10M13 5v10"/>'),
  play: svg('<path d="m7 4 9 6-9 6Z"/>'),
  fold: svg('<path d="M4 10h12"/>'),
  open: svg('<path d="M4 10h12M10 4v12"/>'),
  exit: svg('<path d="m5 5 10 10M15 5 5 15"/>'),
  fire: svg('<path d="M10 1v5M10 14v5M1 10h5M14 10h5"/><circle cx="10" cy="10" r="5"/>'),
};
const esc = (t: string) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const CSS = `
:host{all:initial!important;position:fixed!important;inset:0!important;display:block!important;z-index:2147483000!important;pointer-events:none!important}
.bui{position:absolute;inset:0;background:none;font:500 12px/1.4 ui-monospace,monospace}
canvas{position:absolute;inset:0;pointer-events:none}
.ar{position:absolute;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));width:min(300px,calc(100% - 24px));display:grid;gap:10px;padding:10px 12px 12px;pointer-events:auto;color:var(--ink);background:color-mix(in srgb,var(--card) 94%,transparent);border:2.5px solid var(--line);border-radius:10px;box-shadow:0 5px 0 var(--rim)}
.ar header{display:flex;align-items:center;gap:6px}.ar header b{flex:1;font:900 11px/1 ui-monospace,monospace;letter-spacing:.14em;color:var(--team-a)}
.ar header button{width:34px;height:34px;min-height:0;padding:0;display:grid;place-items:center}.ar header svg{width:18px;height:18px}
.ar .bui-readouts{justify-content:space-between;gap:12px}
.mt{display:grid;grid-template-columns:1fr auto;gap:4px 8px;font-size:10px;letter-spacing:.08em;color:var(--muted)}.mt b{color:var(--ink)}
.mt i{grid-column:1/-1;height:6px;border-radius:3px;background:var(--surface);border:1.5px solid var(--line);overflow:hidden}.mt u{display:block;height:100%;width:0;background:var(--team-a)}
.ar nav{display:flex;flex-wrap:wrap;gap:6px}.ar nav button{flex:1;min-height:0;padding:7px 4px;font:800 10px/1 ui-monospace,monospace;letter-spacing:.08em}
.ar.compact .mt,.ar.compact nav,.ar.compact [data-fold]{display:none}
.bui .msg{position:absolute;left:50%;bottom:max(16px,env(safe-area-inset-bottom));translate:-50% 0;max-width:calc(100% - 24px);pointer-events:none}
.bui .msg[hidden]{display:none}
.bui .bui-pad{pointer-events:auto}
@media (pointer:coarse),(max-width:600px){.ar{top:max(10px,env(safe-area-inset-top));bottom:auto;width:min(260px,calc(100% - 20px))}.bui .msg{bottom:auto;top:max(150px,calc(env(safe-area-inset-top) + 140px))}}
@media (prefers-reduced-motion:reduce){.bui *{transition:none!important;animation:none!important}}`;

export function arcade<S>(def: ArcadeDef<S>, options: ArcadeOptions<S> = {}): ArcadeController<S> {
  let status: ArcadeStatus = "idle", destroyed = false, notice = "";
  let run: ReturnType<typeof begin> | null = null;
  let last: Record<string, unknown> = {};
  const motion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = () => options.reducedMotion ?? !!motion?.matches;
  const emit = (type: string, data: Record<string, unknown> = {}) => options.onEvent?.({ ...data, type, game: def.id });
  const keyboard = def.keyboard || options.controls === "keyboard";
  const actions = def.actions ?? [];

  function getSnapshot(): ArcadeSnapshot<S> {
    const e = run?.engine, ms = e?.stats().frameMs;
    return { id: def.id, status, elapsed: e?.time ?? 0, ...(run?.stats() ?? last), frameMs: ms?.avg ?? 0, maxFrameMs: ms?.max ?? 0, notice } as ArcadeSnapshot<S>;
  }
  const notify = () => options.onState?.(getSnapshot());

  // ---------- One run: an engine, the page as the board, the overlay ----------
  function begin() {
    const doc = document;
    const host = doc.createElement("div");
    host.dataset.domVirusRoot = def.id;
    host.dataset.virusIgnore = "";
    host.setAttribute("data-fizlet-host", def.id);
    const theme = options.theme === "dark" || options.theme === "light" ? options.theme : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const ui = mount(host, def.css + CSS, { theme, palette: { teamA: def.color } });
    ui.innerHTML = `<canvas aria-hidden="true"></canvas>
<section class="ar" aria-label="${esc(def.title)} controls"><header><b>${esc(def.title.toUpperCase())}</b>
<button type="button" data-a="sound" aria-pressed="true" aria-label="Mute game sound">${ICON.sound}</button>
<button type="button" data-a="pause" aria-label="Pause game (P)">${ICON.pause}</button>
<button type="button" data-a="fold" aria-expanded="true" aria-label="Minimize scoreboard">${ICON.fold}</button>
<button type="button" data-a="exit" aria-label="Close game and restore page (Esc)">${ICON.exit}</button></header>
${def.meter ? `<div class="mt"><b></b><span></span><i role="progressbar" aria-label="${esc(def.meter.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><u></u></i></div>` : ""}
<nav>${actions.map((a) => `<button type="button" data-act="${esc(a.id)}">${esc(a.label)}</button>`).join("")}<button type="button" data-a="gate">Next gate</button><button type="button" data-a="restart">Restart</button>${def.fire ? '<button type="button" data-a="auto" aria-pressed="false">Auto fire</button>' : ""}</nav></section>
<div class="bui-toast msg" role="status" hidden></div>`;
    const $ = <T extends Element>(s: string) => ui.querySelector<T>(s)!;
    const panel = $<HTMLElement>(".ar"), msg = $<HTMLElement>(".msg"), meter = ui.querySelector<HTMLElement>(".mt");
    const { group, values } = readouts(panel, def.readouts.map(([l, t]) => (t ? [l, t] : [l])) as [string, ("team" | "enemy")?][]);
    panel.insertBefore(group, meter ?? $("nav"));
    def.readouts.forEach(([, , , fold], i) => fold && group.children[i]!.setAttribute("data-fold", ""));
    const canvas = $<HTMLCanvasElement>("canvas"), c2d = canvas.getContext("2d")!;
    // The overlay is the one page change outside the engine's ledger: the scoreboard outlives the
    // engine when a run ends (the page is already back), and the controller removes it on Recall.
    doc.documentElement.append(host);
    // The run's own keys (Escape, P, G) live as long as the overlay, not the engine.
    const life = new AbortController();
    let built: Engine | undefined;
    try {
      const e = (built = createEngine({
        root: host,
        seed: options.seed ?? (Math.random() * 2 ** 31) | 0,
        events: 256,
        pause: { offscreen: false },
        onError(err) {
          stop();
          notice = "The game stopped safely after an error.";
          notify();
          options.onError?.(err);
        },
      }));
      const board = boardPage(e, {
        root: (typeof options.root === "string" ? doc.querySelector(options.root) : options.root) ?? doc.body,
        // Fizlet's defaults plus the DOM VIRUS hooks pages already carry.
        text: options.textSelector ?? "h1,h2,h3,h4,h5,h6,p,li,blockquote,[data-fizlet-text],[data-virus-text]",
        targets: options.targetSelector ?? "button,[role=button],a.button,a.btn,[data-fizlet-target],[data-virus-target]",
        exclude: [PROTECTED, options.excludeSelector].filter(Boolean).join(","),
        color: def.color,
      });
      const keys: Record<string, string[]> = { up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"] };
      if (def.fire) keys.fire = ["Space"];
      for (const a of actions) keys[a.id] = [a.key];
      const input = controls(e, { keys, target: host });
      const coarse = matchMedia("(pointer: coarse)").matches;
      if (coarse) {
        // Without fire, the first action is the big primary key.
        const pads: PadAction[] = actions.map((a, i) => ({ intent: a.id, label: a.label.replace(/^[^·]*· /, ""), role: !def.fire && !i ? "go" : "sys" }));
        if (def.fire) pads.unshift({ intent: "fire", label: "", name: "Hold to fire (Space)", icon: ICON.fire, hold: true, role: "fire" });
        pad(e, input, { scheme: def.pad ?? "stick", host: ui, actions: pads });
      }
      const sfx = sound(e, { on: options.sound !== false, cues: def.cues });
      const ctl = new Float64Array(11);

      // Sparks (3 px squares, a pool of 100) and popups (24, stacked when they land close together).
      const SN = 100, kx = new Float64Array(SN), ky = new Float64Array(SN), kvx = new Float64Array(SN), kvy = new Float64Array(SN), kl = new Float64Array(SN), kc = new Uint8Array(SN);
      const PN = 24, px = new Float64Array(PN), py = new Float64Array(PN), pl = new Float64Array(PN), pv = new Float64Array(PN), pc = new Uint8Array(PN), pt: (string | null)[] = new Array(PN).fill(null);
      const plus: string[] = [], label = (v: number) => plus[v] ?? (plus[v] = `+${v}`);
      const TONE = ["#4bce82", def.color, "#f4457a"];
      const context: ArcadeContext = {
        engine: e, board, input, ctl, reduced,
        popup(x, y, value, text, tone = 0) {
          if (text === null)
            for (let i = 0; i < PN; i++)
              if (pl[i]! > 0.65 && pt[i] === null && pc[i] === tone && Math.abs(px[i]! - x) < 28 && Math.abs(py[i]! - (y - 12)) < 28) return void ((pv[i]! += value), (pl[i] = 1.1));
          let k = 0;
          for (let i = 1; i < PN; i++) if (pl[i]! < pl[k]!) k = i;
          px[k] = x; py[k] = y - 12; pl[k] = 1.1; pv[k] = value; pt[k] = text; pc[k] = tone;
        },
        spark(x, y, n, c) {
          if (reduced()) return;
          for (let i = 0; i < SN && n > 0; i++) {
            if (kl[i]! > 0) continue;
            const a = Math.random() * 6.2832, v = 30 + Math.random() * 100;
            kx[i] = x; ky[i] = y; kvx[i] = Math.cos(a) * v; kvy[i] = Math.sin(a) * v; kl[i] = 0.3 + Math.random() * 0.3; kc[i] = c;
            n--;
          }
        },
        say: (text, ms) => toast(msg, text, ms),
        emit,
        attach(el) {
          if (!(el instanceof HTMLElement) || /^(IMG|INPUT|BR|HR|CANVAS|VIDEO|IFRAME|TEXTAREA|SELECT)$/.test(el.tagName)) return null;
          if (getComputedStyle(el).position === "static") e.ledger.style(el, "position", "relative", "important");
          const art = e.ledger.add(doc.createElement("div"));
          art.setAttribute("data-fizlet-host", `${def.id}-art`);
          art.setAttribute("aria-hidden", "true");
          art.style.cssText = "all:initial!important;position:absolute!important;inset:0!important;display:block!important;border-radius:inherit!important;pointer-events:none!important;user-select:none!important";
          el.append(art);
          return art.attachShadow({ mode: "open" });
        },
      };
      const game = def.create(context);

      // Pointer, fire and the page's own clicks: while running, a click on the page fires instead
      // of following a link or pressing a button. The HUD, fields and opted-out parts keep theirs.
      const p = new Float64Array(6), P_X = 0, P_Y = 1, P_ON = 2, P_DOWN = 3, SX = 4, SY = 5;
      let mode = keyboard ? 0 : 1, auto = false, jump = 0, ending = 0;
      const live = () => status === "running";
      const guarded = (ev: Event) => ev.composedPath().some((n) => n === host || (n instanceof Element && n.matches(`${EDIT},${PROTECTED}`)));
      const on = { signal: e.signal, capture: true } as const;
      doc.addEventListener("pointermove", (ev) => {
        if (!live() || ev.pointerType === "touch" || keyboard || guarded(ev)) return;
        p[P_X] = ev.clientX; p[P_Y] = ev.clientY; p[P_ON] = 1; mode = 1;
      }, { ...on, passive: true });
      doc.addEventListener("pointerdown", (ev) => {
        if (!live() || ev.button !== 0 || guarded(ev) || !def.fire) return;
        p[P_DOWN] = 1;
        ev.preventDefault();
      }, on);
      const up = () => (p[P_DOWN] = 0);
      doc.addEventListener("pointerup", up, on);
      doc.addEventListener("pointercancel", up, on);
      addEventListener("blur", up, { signal: e.signal });
      doc.addEventListener("click", (ev) => {
        if (live() && ev.detail > 0 && !guarded(ev)) (ev.preventDefault(), ev.stopPropagation());
      }, on);
      doc.addEventListener("keydown", (ev) => {
        if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
        const t = ev.target;
        if (t instanceof Element && t.closest(EDIT)) return;
        if (ev.code === "Escape") return ev.preventDefault(), stop();
        if (/^(Arrow(Up|Down|Left|Right)|Key[WASD])$/.test(ev.code)) mode = 0;
        if (ev.repeat || (t instanceof Element && t.closest(PROTECTED) && !host.contains(t))) return;
        if (ev.code === "KeyP") ev.preventDefault(), status === "paused" ? resume() : pause();
        else if (ev.code === "KeyG" && live()) ev.preventDefault(), (jump = 1);
      }, { signal: life.signal, capture: true });

      // ---------- Scoreboard keys ----------
      const k = { sound: $<HTMLButtonElement>("[data-a=sound]"), pause: $<HTMLButtonElement>("[data-a=pause]"), fold: $<HTMLButtonElement>("[data-a=fold]") };
      const fold = (compact: boolean) => {
        panel.classList.toggle("compact", compact);
        k.fold.innerHTML = compact ? ICON.open : ICON.fold;
        k.fold.setAttribute("aria-expanded", String(!compact));
        k.fold.setAttribute("aria-label", compact ? "Expand scoreboard" : "Minimize scoreboard");
      };
      fold(coarse || innerWidth <= 600);
      const syncSound = () => {
        k.sound.innerHTML = sfx.on ? ICON.sound : ICON.mute;
        k.sound.setAttribute("aria-pressed", String(sfx.on));
        k.sound.setAttribute("aria-label", sfx.on ? "Mute game sound" : "Turn game sound on");
      };
      const syncPause = () => {
        k.pause.innerHTML = status === "paused" ? ICON.play : ICON.pause;
        k.pause.setAttribute("aria-label", status === "paused" ? "Resume game (P)" : "Pause game (P)");
        k.pause.disabled = status !== "running" && status !== "paused";
      };
      ui.addEventListener("click", (ev) => {
        const b = (ev.target as Element).closest<HTMLButtonElement>("button[data-a],button[data-act]");
        if (!b) return;
        const a = b.dataset.a;
        if (b.dataset.act) live() && input.press(b.dataset.act), live() && input.press(b.dataset.act, false);
        else if (a === "sound") (sfx.on = !sfx.on), syncSound();
        else if (a === "pause") status === "paused" ? resume() : pause();
        else if (a === "fold") fold(!panel.classList.contains("compact"));
        else if (a === "exit") stop();
        else if (a === "restart") start();
        else if (a === "gate" && live()) jump = 1;
        else if (a === "auto") (auto = !auto), b.setAttribute("aria-pressed", String(auto)), (b.textContent = auto ? "Fire: on" : "Auto fire");
        if (live()) b.blur();
      });
      syncSound();

      // G / Next gate: scroll to a live target, preferring one off screen (a page write: render).
      function gate() {
        let pick: (typeof board.targets)[number] | undefined;
        for (const t of board.targets) if (t.hp > 0 && (!pick || (pick.w > 0 && !(t.w > 0)))) pick = t;
        pick?.el.scrollIntoView({ behavior: "instant", block: "center" });
        emit("jump");
      }
      // Targets: a level of the accent (then yellow, then red) inside the button, through the ledger.
      const signal = (fill: number) => (fill > 60 ? def.color : fill > 25 ? "#cdde00" : "#ee6875");
      const painted = new Map<Element, number>();
      function paint() {
        const max = ctl[TARGET_HP]! || 100;
        for (const t of board.targets) {
          const fill = Math.round((Math.min(t.hp, max) / max) * 100);
          if (painted.get(t.el) === fill) continue;
          painted.set(t.el, fill);
          const c = signal(fill);
          e.ledger.style(t.el as HTMLElement, "background", `linear-gradient(to top,${c} 0%,${c} ${fill}%,transparent ${fill}%,transparent 100%)`, "important");
        }
      }

      const N = def.readouts.length, hv = new Float64Array(N + 1), shown = new Float64Array(N + 1).fill(NaN);
      const view = new Float64Array(3), DPR = 0, NOTE = 1;
      const shell: System = {
        read() {
          // Size and scroll, once a frame (the read phase is the only place that touches layout).
          if (ctl[VW] !== innerWidth || ctl[VH] !== innerHeight) {
            ctl[VW] = innerWidth;
            ctl[VH] = innerHeight;
            view[DPR] = Math.min(devicePixelRatio || 1, 1.5);
            canvas.width = Math.round(innerWidth * view[DPR]!);
            canvas.height = Math.round(innerHeight * view[DPR]!);
          }
          const dx = scrollX - p[SX]!, dy = scrollY - p[SY]!;
          if (dx || dy) (p[SX] = scrollX), (p[SY] = scrollY), game.scroll?.(dx, dy);
          ctl[CALM] = reduced() ? 1 : 0;
          ctl[KX] = input.axis("left", "right", 0);
          ctl[KY] = input.axis("up", "down", 1);
          if (ctl[KX] || ctl[KY]) mode = 0;
          ctl[MODE] = mode;
          ctl[PX] = p[P_X]!;
          ctl[PY] = p[P_Y]!;
          ctl[PON] = p[P_ON]!;
          ctl[FIRE] = def.fire && (input.down("fire") || p[P_DOWN] || auto) ? 1 : 0;
        },
        render(eng) {
          const dt = eng.timing[0]!, r = reduced();
          for (let i = 0; i < eng.events.size; i++) game.react?.(eng.events.at(i)!);
          // The run ended (read from the game, never from a ring that may drop events when full).
          const o = game.over();
          if (o && !ending) (ending = 1), queueMicrotask(() => finish(o === 2));
          if (jump) (jump = 0), gate();
          if (def.paint !== false) paint();
          const d = view[DPR]!, W = ctl[VW]!, H = ctl[VH]!;
          c2d.setTransform(d, 0, 0, d, 0, 0);
          c2d.clearRect(0, 0, W, H);
          // Target beacons: a ring that beats faster as the target weakens.
          const max = ctl[TARGET_HP]! || 100;
          c2d.lineWidth = 2;
          for (const g of board.targets) {
            if (!(g.w > 0 && g.hp > 0)) continue;
            const fill = (g.hp / max) * 100;
            c2d.globalAlpha = r ? 0.7 : 0.45 + 0.35 * Math.sin((eng.time * 6.2832) / (0.7 + 2.1 * (1 - fill / 100)));
            c2d.strokeStyle = signal(fill);
            c2d.strokeRect(g.x - 5, g.y - 5, g.w + 10, g.h + 10);
          }
          c2d.globalAlpha = 1;
          game.draw(c2d, dt);
          for (let i = 0; i < SN; i++) {
            if (kl[i]! <= 0) continue;
            kl[i]! -= dt;
            kx[i]! += kvx[i]! * dt;
            ky[i]! += kvy[i]! * dt;
            c2d.globalAlpha = Math.min(1, Math.max(0, kl[i]! * 3));
            c2d.fillStyle = def.colors[kc[i]!]!;
            c2d.fillRect(kx[i]!, ky[i]!, 3, 3);
          }
          c2d.globalAlpha = 1;
          c2d.font = "700 16px ui-monospace, monospace";
          c2d.textAlign = "center";
          c2d.lineJoin = "round";
          for (let i = 0; i < PN; i++) {
            if (pl[i]! <= 0) continue;
            pl[i]! -= dt;
            if (!r) py[i]! -= 18 * dt;
            const text = pt[i] ?? label(pv[i]!);
            c2d.globalAlpha = Math.min(1, Math.max(0, pl[i]! / 0.4));
            c2d.strokeStyle = theme === "dark" ? "#101010" : "#ffffff";
            c2d.lineWidth = 6;
            c2d.strokeText(text, px[i]!, py[i]!);
            c2d.strokeStyle = "#101010";
            c2d.lineWidth = 3;
            c2d.strokeText(text, px[i]!, py[i]!);
            c2d.fillStyle = TONE[pc[i]!]!;
            c2d.fillText(text, px[i]!, py[i]!);
          }
          c2d.globalAlpha = 1;
          hud();
          if ((view[NOTE]! += dt) >= 0.1) (view[NOTE] = 0), notify();
        },
      };
      e.add(shell);
      // The scoreboard: change-only writes.
      function hud() {
        game.hud(hv);
        for (let i = 0; i < N; i++)
          if (hv[i] !== shown[i]) {
            const fmt = def.readouts[i]![2];
            values[i]!.textContent = fmt ? fmt(hv[i]!) : String(hv[i]);
            shown[i] = hv[i]!;
          }
        if (meter && game.meter && hv[N] !== shown[N]) {
          shown[N] = hv[N]!;
          const [l, rt, f] = game.meter(), pct = Math.round(Math.min(1, Math.max(0, f)) * 100);
          meter.children[0]!.textContent = l;
          meter.children[1]!.textContent = rt;
          (meter.querySelector("u") as HTMLElement).style.width = `${pct}%`;
          meter.children[2]!.setAttribute("aria-valuenow", String(pct));
        }
      }
      function stats(): Record<string, unknown> {
        let visible = 0, spent = 0, sparks = 0;
        const g = board.glyphs;
        for (let i = 0; i < g.count; i++) (spent += g.spent[i]!), (visible += g.w[i]! > 0 ? 1 : 0);
        for (let i = 0; i < SN; i++) if (kl[i]! > 0) sparks++;
        return { ...game.stats(), board: { indexed: g.count, visible, spent, measurements: board.reads }, particles: sparks };
      }
      // First frame: measure, then a fresh run.
      shell.read!(e);
      p[SX] = scrollX;
      p[SY] = scrollY;
      p[P_X] = innerWidth / 2;
      p[P_Y] = innerHeight * 0.65;
      board.refresh();
      game.reset();
      return { engine: e as Engine, life, host, ui, panel, msg, stats, syncPause, hud };
    } catch (err) {
      // A run that fails to start leaves nothing behind.
      built?.destroy();
      life.abort();
      host.remove();
      throw err;
    }
  }

  // ---------- The controller ----------
  function teardown() {
    run?.life.abort();
    run?.engine.destroy();
    run?.host.remove();
    run = null;
  }
  function start() {
    if (destroyed) throw new Error("This game instance was destroyed. Create another instance.");
    teardown();
    notice = "";
    try {
      run = begin();
      status = "running";
      run.engine.start();
      run.syncPause();
      run.hud();
      toast(run.msg, matchMedia("(pointer: coarse)").matches ? def.touchHint ?? def.hint : def.hint, 4200);
      emit("start");
    } catch (err) {
      teardown();
      status = "idle";
      options.onError?.(err);
      throw err;
    }
    notify();
    return getSnapshot();
  }
  function pause() {
    if (status !== "running" || !run) return;
    status = "paused";
    run.engine.stop();
    run.syncPause();
    notify();
    emit("pause");
  }
  function resume() {
    if (status !== "paused" || !run || document.hidden) return;
    status = "running";
    run.engine.start();
    run.syncPause();
    notify();
    emit("resume");
  }
  // A run ends: the page comes back at once (the engine's ledger), the scoreboard stays with the
  // result and a Restart key.
  function finish(won: boolean) {
    if (!run || (status !== "running" && status !== "paused")) return;
    last = run.stats();
    status = won ? "won" : "gameover";
    notice = won ? "Page cleared and restored. Restart for another run." : "Run ended. Page restored. Restart for another run.";
    const { host, ui, panel, msg, syncPause } = run;
    run.engine.destroy();
    const ended = last;
    run = { ...run, stats: () => ended };
    panel.classList.remove("compact");
    ui.querySelector("canvas")?.remove();
    syncPause();
    toast(msg, `${won ? "STAGE CLEAR" : "GAME OVER"} · ${notice}`, 1e9);
    emit(status, { score: last.score });
    notify();
    host.dataset.over = status;
  }
  function stop() {
    if (destroyed) return;
    if (run && (status === "running" || status === "paused")) last = run.stats();
    teardown();
    status = "idle";
    notice = "";
    notify();
    emit("recall");
  }
  function destroy() {
    if (destroyed) return;
    stop();
    destroyed = true;
    status = "destroyed";
    notify();
  }
  return { start, pause, resume, stop, destroy, getSnapshot };
}
