// @fzlt/core/presence/check: the determinism check as one function any game can call from a test.
// It runs `players` copies of your sim as lockstep clients over the in-memory link (each with only
// its own input), hashes the state after every frame, and reports the first frame that differs.
import { createEngine, type Engine } from "./kernel/engine";
import { presence, memory, hash32 } from "./presence";

/** Your sim as `syncCheck()` runs it: its input for the next frame, one step from every player's
 *  inputs, and a byte view of its whole state. */
export interface SyncGame {
  /** This player's input bits for the next scheduled frame (only this client knows them). */
  input(): number;
  /** One sim frame from every player's inputs. Use `e.random`, never Math.random or the clock. */
  step(e: Engine, inputs: Uint32Array, frame: number): void;
  /** A byte view of the whole sim state (typed arrays; make the view once). */
  state: Uint8Array;
}

/** Options for `syncCheck()`: players, frames, seed, input delay and the simulated link. */
export interface SyncOptions {
  players?: number; // default 2
  frames?: number; // default 600
  seed?: number; // engine seed, the same for every client (default 1)
  delay?: number; // input delay in frames (default 2)
  latency?: number; // link latency in ticks (default 0)
  jitter?: number; // extra random latency in ticks, reorders messages (default 0)
}

/** What `syncCheck()` found: whether every client agreed, how far they got and the first frame that
 *  differed. */
export interface SyncResult {
  /** Every client reached `frames` with the same state hash on every frame. */
  ok: boolean;
  /** Frames every client completed (≤ frames). */
  frames: number;
  /** First frame whose state differed between clients, or -1. */
  diverged: number;
  /** Engine steps spent waiting for inputs, summed over clients. */
  stalls: number;
}

/** Check a sim is deterministic: run `players` copies as lockstep clients over the in-memory link,
 *  hash the state every frame and report the first frame that differs (`diverged`, -1 if none). */
export function syncCheck(setup: (e: Engine, slot: number, players: number) => SyncGame, o: SyncOptions = {}): SyncResult {
  const P = o.players ?? 2, N = o.frames ?? 600, lat = o.latency ?? 0, jit = o.jitter ?? 0;
  const hub = memory({ peers: P, latency: lat, jitter: jit, seed: o.seed ?? 1 });
  const hashes = new Uint32Array(P * N), off = { hidden: false, offscreen: false, editable: false };
  const runs = [];
  for (let s = 0; s < P; s++) {
    const e = createEngine({ seed: o.seed ?? 1, pause: off }), g = setup(e, s, P);
    const net = presence(e, {
      transport: hub.ends[s]!, slot: s, players: P, delay: o.delay ?? 2, input: g.input,
      step(e, inputs, f) {
        g.step(e, inputs, f);
        if (f < N) hashes[s * N + f] = hash32(g.state);
      },
    });
    runs.push({ e, net });
  }
  for (let t = 0, max = N * (4 + lat + jit) + 100; t < max && runs.some((r) => r.net.frame < N); t++) {
    hub.tick();
    for (const r of runs) if (r.net.frame < N) r.e.advance(r.e.dt);
  }
  const frames = Math.min(N, ...runs.map((r) => r.net.frame));
  let diverged = -1;
  for (let f = 0; f < frames && diverged < 0; f++) for (let s = 1; s < P; s++) if (hashes[s * N + f] !== hashes[f]) diverged = f;
  const stalls = runs.reduce((a, r) => a + r.net.stalls, 0);
  for (const r of runs) r.e.destroy();
  return { ok: diverged < 0 && frames === N, frames, diverged, stalls };
}
