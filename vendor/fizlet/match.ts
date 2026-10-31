/**
 * @fzlt/core/match: the match flow every game shares, intro → count → play → paused → end, on the
 * Board UI kit's overlay (grey dim, a sticker that slams, at most two sticker keys). One overlay is
 * built once; each phase only flips attributes, styles and text through the ledger, so destroy()
 * gives the page back exactly. Every transition is an event on the ring (`match:play`, …), so the
 * HUD, sound and coach layers react without knowing about this one. Pass `null` as the root to run
 * the phase machine headless (tests, a server).
 */
import { READ, STEP, type Engine, type System } from "./kernel/engine";

/** Where a match is: the intro, the countdown, play, paused or the end. */
export type Phase = "intro" | "count" | "play" | "paused" | "end";
/** A sticker: kicker (small, blinking) and word (big). */
export type Sticker = [kicker: string, word: string];
/** The overlay's sticker keys, by what they do. */
export type MatchKey = "start" | "resume" | "surrender" | "again" | "next";
/** Every word on the match overlay: the stickers per phase, the countdown kicker and the key labels. */
export interface MatchLabels extends Record<MatchKey, string> {
  intro: Sticker;
  /** The kicker over the 3-2-1. */
  count: string;
  paused: Sticker;
  won: Sticker;
  lost: Sticker;
  /** Lost by surrender (the white flag). */
  flag: Sticker;
}
/** How a match ended: won or lost, why, and the clock. */
export interface MatchResult {
  won: boolean;
  /** "time" (the clock ran out), "flag" (surrender) or what the game passed to finish(). */
  why: string;
  /** The clock when it ended. */
  clock: number;
}
/** Options for `match()`: the countdown, the match length, labels and key icons, the pause keys. */
export interface MatchOptions {
  /** Countdown beats of one second before play (default 3; 0 skips it). */
  count?: number;
  /** Match length in seconds; 0 or left out = no time limit (the clock counts up). */
  seconds?: number;
  labels?: Partial<MatchLabels>;
  /** SVG markup per key (64 × 64), e.g. the game's skull on KEEP FIGHTING. */
  icons?: Partial<Record<MatchKey, string>>;
  /** Pause / resume keys (KeyboardEvent.code; default Escape and P). [] turns them off. */
  keys?: string[];
  /** A new round starts (start, rematch): reset the game. Runs in the click (user activation). */
  begin?(): void;
  /** The match ended. Return a sticker to replace the default words (e.g. ["INSERT COIN", "RED WINS"]). */
  end?(r: MatchResult): Sticker | void;
  /** The clock ran out: did the player win? (default: no) */
  timeUp?(): boolean;
  /** The kit's launch burst (`launch` from @fzlt/core/ui) for PRESS START and SURRENDER. */
  launch?(key: HTMLElement, action: () => void, o: { reduced?: boolean }): void;
  /** Each phase change, once it is painted (in the call that made it, or in the render of the frame
   *  a step made it in): a host that owns more than the overlay (@fzlt/core/arcade's skirmish preset)
   *  follows the phase here. Not called for the first intro. */
  on?(phase: Phase): void;
  /** Phases that show no overlay (the phase machine and its events still run), e.g. ["paused"]. */
  hide?: Phase[];
}

const PH: Phase[] = ["intro", "count", "play", "paused", "end"];
const EV = [...PH.slice(0, 4), "won", "lost", "flag"].map((t) => "match:" + t);
const KEYS: MatchKey[] = ["start", "resume", "surrender", "again", "next"];
/** Which keys each phase shows (bit i = KEYS[i]): the primary key comes first. */
const MASK = [1, 0, 0, 6, 24];
const INTRO = 0, COUNT = 1, PLAY = 2, PAUSED = 3, END = 4;
const EDIT = "input,textarea,select,[contenteditable],[data-fizlet-ignore]";
const WORDS: MatchLabels = {
  intro: ["PLAYER 1", "READY?"], count: "GET READY", paused: ["BATTLE PAUSED", "GIVE UP?"],
  won: ["STAGE CLEAR", "MISSION COMPLETE"], lost: ["INSERT COIN", "GAME OVER"], flag: ["WHITE FLAG", "GAME OVER"],
  start: "PRESS START", resume: "KEEP FIGHTING", surrender: "SURRENDER", again: "REMATCH", next: "NEW GAME",
};
const svg = (d: string) => `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges">${d}</svg>`;

/** The shared match flow on engine `e`, intro → count → play → paused → end, on the Board UI overlay
 *  in `root`. Every transition is an event on the ring (`match:play`, …). Drive it with `start()`,
 *  `pause()`, `finish()`, `restart()`; read `phase` and `clock`. */
export function match(e: Engine, root: HTMLElement | null, o: MatchOptions = {}) {
  const lab = { ...WORDS, ...o.labels }, L = e.ledger, total = o.seconds ?? 0, beats = o.count ?? 3;
  const codes = o.keys ?? ["Escape", "KeyP"];
  // Running numbers in one typed array (no boxing): clock, countdown left, number on the sticker.
  const n = new Float64Array(3);
  n[0] = total;
  // Events raised outside a frame wait here and go out in the next read (the ring is per frame).
  const q = new Uint8Array(8), qa = new Float64Array(8);
  let phase = INTRO, painted = -1, qn = 0, dirty = 0, won = false, going = false, why = "";
  let prev: HTMLElement | null = null, flagT: ReturnType<typeof setTimeout> | undefined;
  const inert: HTMLElement[] = [];
  const inFrame = () => e.phase === READ || e.phase === STEP;
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  let ov: HTMLElement | null = null, kick: Text, word: Text, sticker: HTMLElement, keys: HTMLElement[] = [];
  if (root) {
    const icon = { ...o.icons }, play = svg('<path d="M22 16v32l26-16Z"/>');
    const cells = [0, 1, 4, 2, 5, 8, 3, 6, 9, 12, 7, 10, 13, 11, 14, 15].map((i, k) => `<rect x="${(i % 4) * 16}" y="${(i >> 2) * 16}" width="16" height="16" style="--i:${k}"/>`).join("");
    const art: Record<MatchKey, string> = {
      start: play, resume: play, again: play,
      surrender: svg(`<g class="bui-cells">${cells}</g><path class="bui-grid" d="M0 16h64M0 32h64M0 48h64M16 0v64M32 0v64M48 0v64"/><rect class="bui-frame" x="1" y="1" width="62" height="62"/><path class="bui-pole" d="M17 9h4v46h-4Z"/><path class="bui-cloth" d="M21 12h24l-6 9 6 9H21Z"/>`),
      next: svg('<path d="M12 18l4-4 18 18-18 18-4-4 14-14Zm18 0 4-4 18 18-18 18-4-4 14-14Z"/>'),
    };
    const t = document.createElement("div");
    t.innerHTML = `<div class="bui-overlay" role="dialog" aria-modal="true" tabindex="-1"><div class="bui-sticker"><span> </span><b> </b></div><div class="bui-overlay-keys">${KEYS.map((k, i) =>
      `<button class="bui-sticker-key ${["bui-call", "", "bui-second bui-surrender", "", "bui-second"][i]}" type="button" data-k="${k}">${icon[k] ?? art[k]}<b>${lab[k]}</b></button>`).join("")}</div></div>`;
    ov = L.add(t.firstChild as HTMLElement);
    sticker = ov.firstElementChild as HTMLElement;
    kick = sticker.firstChild!.firstChild as Text;
    word = sticker.lastChild!.firstChild as Text;
    keys = [...ov.querySelectorAll<HTMLElement>("[data-k]")];
    root.append(ov);
    const on = { signal: e.signal };
    const boom = (k: HTMLElement, f: () => void, r = reduced()) => (o.launch ? o.launch(k, f, { reduced: r }) : f());
    const act: ((k: HTMLElement) => void)[] = [
      (k) => boom(k, m.start),
      () => m.pause(false),
      (k) => {
        if (going) return;
        // The white flag (kit 9.3): the cells white out and the flag waves, then the key blows up.
        going = true;
        L.cls(k, "go", true);
        e.start();
        emit(6);
        const r = reduced();
        flagT = setTimeout(() => boom(k, () => !e.signal.aborted && going && m.finish(false, "flag"), r), r ? 0 : 480);
      },
      () => m.restart(),
      () => m.intro(),
    ];
    keys.forEach((k, i) => k.addEventListener("click", () => act[i]!(k), on));
    // The white flag's wait dies with the engine (a listener on `on` would be gone before abort fires).
    e.signal.addEventListener("abort", () => clearTimeout(flagT), { once: true });
    addEventListener("keydown", (ev) => {
      if (!codes.includes(ev.code) || ev.metaKey || ev.ctrlKey || ev.altKey || (ev.composedPath()[0] as Element).closest?.(EDIT)) return;
      if ((phase === PLAY || phase === PAUSED) && !going) {
        ev.preventDefault();
        if (!ev.repeat) m.pause();
      }
    }, on);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") phase === PLAY && hold(true, 1);
      else if (!ov!.hidden) slam();
    }, on);
  }

  // The sticker slams again: re-inserted, its CSS animation restarts with no layout read (the kit's
  // slam() reads offsetWidth, a forced reflow on every phase change and countdown beat).
  function slam() {
    ov!.insertBefore(sticker, ov!.firstChild);
  }
  function emit(code: number, a = 0) {
    if (inFrame()) e.events.emit(EV[code]!, a);
    else if (qn < 8) (q[qn] = code), (qa[qn++] = a);
  }
  function go(p: number, a = 0) {
    // A destroyed engine's match is inert: a late call can't write past Recall.
    if (e.signal.aborted) return;
    phase = p;
    emit(p === END ? (won ? 4 : 5) : p, a);
    // DOM writes never happen in a step: a transition there is painted in this frame's render.
    if (inFrame()) dirty = 1;
    else paint();
  }
  function hold(on: boolean, a = 0) {
    if (on && phase === PLAY) (go(PAUSED, a), e.stop());
    else if (!on && phase === PAUSED && !going) (e.start(), go(PLAY, 1));
  }

  function paint() {
    dirty = 0;
    const p = phase, was = painted, fresh = p !== was;
    let w: Sticker = p === COUNT ? [lab.count, "" + n[2]] : p === END ? (won ? lab.won : why === "flag" ? lab.flag : lab.lost) : p === PLAY ? lab.paused : (lab[PH[p] as "intro"]);
    painted = p;
    if (fresh && p === END) w = o.end?.({ won, why, clock: n[0]! }) || w;
    if (ov) {
      const show = p !== PLAY && !o.hide?.includes(PH[p]!), doc = ov.getRootNode() as Document, act = doc.activeElement as HTMLElement | null;
      L.attr(ov, "hidden", show ? null : "");
      L.attr(ov, "data-phase", PH[p]!);
      keys.forEach((k, i) => (L.style(k, "display", (MASK[p]! >> i) & 1 ? "" : "none"), L.cls(k, "go", false)));
      if (show) {
        L.text(kick, w[0]);
        L.text(word, w[1]);
        L.attr(ov, "aria-label", `${w[0]} ${w[1]}`);
        slam();
        // Modal: everything else in the root is inert while the overlay is up.
        for (const c of root!.children as HTMLCollectionOf<HTMLElement>) if (c !== ov && !c.hasAttribute("inert")) (inert.push(c), L.attr(c, "inert", ""));
        const k = keys[Math.log2(MASK[p]! & -MASK[p]!)];
        // Focus moves to the primary key (the dialog itself when it has none), unless the player is
        // busy elsewhere on the host page.
        if (fresh && (!act || act === doc.body || root!.contains(act))) {
          if (!ov.contains(act)) prev = act;
          (k ?? ov).focus({ preventScroll: true });
        }
      } else {
        for (const c of inert) L.attr(c, "inert", null);
        inert.length = 0;
        if (prev?.isConnected && (!act || act === doc.body || ov.contains(act))) prev.focus({ preventScroll: true });
        prev = null;
      }
    }
    if (fresh && was >= 0) o.on?.(PH[p]!);
  }

  const system: System = {
    read(x) {
      for (let i = 0; i < qn; i++) x.events.emit(EV[q[i]!]!, qa[i]);
      qn = 0;
    },
    step(_, dt) {
      // The countdown and the clock are motion: a settling engine stays awake for them.
      if (phase === COUNT || phase === PLAY) e.busy();
      if (phase === COUNT) {
        const c = Math.ceil((n[1]! -= dt) - 1e-9);
        if (c <= 0) go(PLAY);
        else if (c !== n[2]) (n[2] = c), emit(COUNT, c), (dirty = 1);
      } else if (phase === PLAY) {
        if (!total) n[0]! += dt;
        else if ((n[0]! -= dt) <= 0) (n[0] = 0), m.finish(o.timeUp?.() ?? false, "time");
      }
    },
    render() {
      if (dirty) paint();
    },
  };
  e.add(system);

  const m = {
    get phase(): Phase {
      return PH[phase]!;
    },
    /** Seconds left (timed match) or played so far (no limit). Counts only in play. */
    get clock() {
      return n[0]!;
    },
    /** The overlay element (null headless): add your own content, style it by `[data-phase]`. */
    el: ov,
    /** PRESS START: from the intro (or the result), begin a round. */
    start() {
      if (phase === INTRO || phase === END) m.restart();
    },
    /** Pause (true), resume (false) or toggle (no argument). Only during play. */
    pause(on?: boolean) {
      hold(on ?? phase === PLAY);
    },
    /** End the match now (a win, a loss, "flag" for surrender). */
    finish(w: boolean, y = "game") {
      if (phase === INTRO || phase === END) return;
      won = w;
      why = y;
      going = false;
      e.start();
      go(END, n[0]);
    },
    /** A new round from any phase: begin(), the clock reset, then the countdown. */
    restart() {
      n[0] = total;
      n[1] = n[2] = beats;
      going = false;
      o.begin?.();
      e.start();
      beats > 0 ? go(COUNT, beats) : go(PLAY);
    },
    /** Back to the start screen (NEW GAME). */
    intro() {
      going = false;
      e.start();
      go(INTRO);
    },
    system,
  };
  paint();
  return m;
}
/** The match flow `match()` returns. */
export type Match = ReturnType<typeof match>;
