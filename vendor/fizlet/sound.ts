/**
 * fizlet/sound: the sound adapter. After each frame it reads the engine's event ring and plays the
 * mapped cues, so collisions and game events make sound without knowing about audio. The default
 * voice is a tiny synth (oscillators, no assets); pass `play` to use your own sounds.
 * Silent until the first trusted gesture, while paused, and when switched off.
 */
import type { Engine } from "./kernel/engine";

export type Cue = "fire" | "hit" | "boom" | "hurt" | "power" | "ready" | "win" | "end" | "click";
type Note = [from: number, to: number, sec: number, delay: number, wave: OscillatorType, vol: number];
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

export interface SoundOptions {
  /** event type → cue, e.g. { shot: "fire", wreck: "boom" }. */
  cues: Record<string, Cue>;
  /** Start switched on (default true). */
  on?: boolean;
  /** Master volume 0..1 (default 0.12). */
  volume?: number;
  /** Your own player instead of the synth. */
  play?: (cue: Cue, intensity: number) => void;
}

export function sound(e: Engine, o: SoundOptions) {
  let ctx: AudioContext | undefined, master: GainNode | undefined, on = o.on ?? true, voices = 0;
  const last = new Map<string, number>();
  const unlock = (ev: Event) => {
    if (!on || !ev.isTrusted || ctx) return void ctx?.resume?.().catch(() => {});
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = o.volume ?? 0.12;
      master.connect(ctx.destination);
    } catch {}
  };
  for (const t of ["pointerdown", "keydown"]) addEventListener(t, unlock, { signal: e.signal, capture: true });
  e.signal.addEventListener("abort", () => void ctx?.close().catch(() => {}));

  function play(cue: Cue, intensity = 1) {
    if (!on || !e.running) return;
    if (o.play) return o.play(cue, intensity);
    if (!ctx || !master || ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (now - (last.get(cue) ?? -1) < (cue === "fire" ? 0.07 : 0.12)) return;
    last.set(cue, now);
    for (const [from, to, sec, delay, wave, vol] of NOTES[cue]) {
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
  e.add({
    render(eng) {
      for (let i = 0; i < eng.events.size; i++) {
        const ev = eng.events.at(i)!, cue = o.cues[ev.type];
        if (cue) play(cue, ev.v || 1);
      }
    },
  });
  return {
    play,
    get on() {
      return on;
    },
    set on(v: boolean) {
      on = v;
      if (!v) void ctx?.suspend?.().catch(() => {});
      else void ctx?.resume?.().catch(() => {});
    },
  };
}
export type Sound = ReturnType<typeof sound>;
