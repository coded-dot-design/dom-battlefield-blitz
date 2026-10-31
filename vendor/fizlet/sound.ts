/**
 * @fzlt/core/sound: the sound adapter. After each frame it reads the engine's event ring and plays the
 * mapped cues, so collisions and game events make sound without knowing about audio. The default
 * voice is a tiny synth (oscillators, no assets); pass `play` to use your own sounds.
 * Silent until the first trusted gesture, while paused, and when switched off.
 */
import type { Engine } from "./kernel/engine";

/** A built-in sound cue the synth can play. */
export type Cue = "fire" | "hit" | "boom" | "hurt" | "power" | "ready" | "win" | "end" | "click";
/** A cue name: a built-in Cue, or one of your own `notes`. */
export type CueName = Cue | (string & {});
/** One synth voice: pitch from → to (Hz) over `sec`, after `delay`, its wave and volume. */
export type Note = [from: number, to: number, sec: number, delay: number, wave: OscillatorType, vol: number];
const NOTES: Record<Cue, Note[]> = {
  fire: [[980, 220, 0.07, 0, "triangle", 0.16]],
  hit: [[190, 45, 0.15, 0, "square", 0.08]],
  boom: [[120, 30, 0.35, 0, "sawtooth", 0.14], [70, 25, 0.4, 0.02, "square", 0.08]],
  hurt: [[220, 80, 0.22, 0, "sawtooth", 0.09]],
  power: [[523, 523, 0.08, 0, "triangle", 0.2], [784, 1046, 0.14, 0.07, "triangle", 0.2]],
  ready: [[330, 440, 0.08, 0, "triangle", 0.2], [660, 660, 0.1, 0.08, "triangle", 0.2]],
  win: [[523, 523, 0.09, 0, "triangle", 0.2], [659, 659, 0.1, 0.08, "triangle", 0.2], [784, 900, 0.16, 0.16, "triangle", 0.2]],
  end: [[440, 330, 0.16, 0, "triangle", 0.2], [260, 80, 0.3, 0.16, "triangle", 0.2]],
  click: [[600, 360, 0.045, 0, "triangle", 0.12]],
};

/** Options for `sound()`: which event types play which cue, on or off, volume, or your own player. */
export interface SoundOptions {
  /** event type → cue, e.g. { shot: "fire", wreck: "boom" }. */
  cues: Record<string, CueName>;
  /** Your own cues for the built-in synth: name → voices (a name here wins over a built-in). */
  notes?: Record<string, Note[]>;
  /** Start switched on (default true). */
  on?: boolean;
  /** Master volume 0..1 (default 0.12). */
  volume?: number;
  /** Your own player instead of the synth. */
  play?: (cue: Cue, intensity: number) => void;
}

/** The sound adapter for engine `e`: after each frame it plays the cue mapped to each event in the
 *  ring. Silent until the first trusted gesture and while paused; set `on` to mute, `dispose()` to
 *  remove it. */
export function sound(e: Engine, o: SoundOptions) {
  const ctl = new AbortController(), sig = { signal: ctl.signal };
  let ctx: AudioContext | undefined, master: GainNode | undefined, on = o.on ?? true, voices = 0;
  const last = new Map<string, number>();
  const wake = () => void ctx?.resume().catch(() => {});
  // The built-in synth's unlock: a trusted gesture creates the context, or resumes it whenever the
  // browser or the OS suspended it. Muted, gestures leave it asleep. A custom player gets none of it.
  const unlock = (ev: Event) => {
    if (!on || !ev.isTrusted) return;
    if (ctx) return ctx.state === "running" || wake();
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = o.volume ?? 0.12;
      master.connect(ctx.destination);
      wake();
    } catch {}
  };
  // pointerup: on touch, Chrome grants the gesture on release, not on pointerdown.
  if (!o.play) for (const t of ["pointerdown", "pointerup", "keydown"]) addEventListener(t, unlock, { signal: ctl.signal, capture: true });

  function play(cue: CueName, intensity = 1) {
    // Known cues only, by own key: an event type or cue such as "constructor" would otherwise
    // find Object.prototype's (a function, not notes) and throw in render, stopping the game.
    const notes = o.notes && Object.hasOwn(o.notes, cue) ? o.notes[cue] : Object.hasOwn(NOTES, cue) ? NOTES[cue as Cue] : null;
    if (!on || !e.running || ctl.signal.aborted || !notes) return;
    if (o.play) return o.play(cue as Cue, intensity);
    if (!ctx || !master || ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (now - (last.get(cue) ?? -1) < (cue === "fire" ? 0.07 : 0.12)) return;
    last.set(cue, now);
    for (const [from, to, sec, delay, wave, vol] of notes) {
      if (voices >= 8) return;
      const osc = ctx.createOscillator(), g = ctx.createGain(), t0 = now + delay, t1 = t0 + sec;
      osc.type = wave;
      osc.frequency.setValueAtTime(from, t0);
      osc.frequency.exponentialRampToValueAtTime(to, t1);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol * Math.min(1.5, intensity), t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      osc.connect(g).connect(master);
      voices++;
      osc.onended = () => (voices--, osc.disconnect(), g.disconnect());
      osc.start(t0);
      osc.stop(t1 + 0.01);
    }
  }
  // Read the ring after the steps (render phase): events → cues.
  const system = e.add({
    render(eng: Engine) {
      for (let i = 0; i < eng.events.size; i++) {
        // Own keys only: a prototype name ("constructor") would hand play() a function, and its
        // own-key check would stringify that function's source on every such event.
        const ev = eng.events.at(i)!;
        if (Object.hasOwn(o.cues, ev.type)) play(o.cues[ev.type]!, ev.v || 1);
      }
    },
  });
  /** Remove this sound provider only (listeners, system, its AudioContext); the engine keeps running. */
  function dispose() {
    ctl.abort();
    e.remove(system);
    void ctx?.close().catch(() => {});
    ctx = master = undefined;
  }
  e.signal.addEventListener("abort", dispose, sig);
  return {
    play,
    dispose,
    get on() {
      return on;
    },
    set on(v: boolean) {
      on = v;
      if (!v) void ctx?.suspend().catch(() => {});
      else wake();
    },
  };
}
/** The sound adapter `sound()` returns. */
export type Sound = ReturnType<typeof sound>;
