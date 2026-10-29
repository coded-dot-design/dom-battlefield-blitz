// fizlet/presence: lockstep input exchange for multiplayer, behind a tiny transport adapter.
// Every peer runs the same fixed-step simulation from the same seed. Each sim frame needs every
// player's input for that frame; your own input is sent `delay` frames ahead, so on a good link the
// game never waits. A missing input stalls the sim (never guesses), so peers can't drift apart.
// Inputs live in fixed rings of typed arrays: a confirmed per-frame input log a rollback layer can
// replay. State hashes are exchanged every `hashEvery` frames to catch a desync early.
import type { Engine, System } from "./kernel/engine";
import { seeded } from "./kernel/random";

/** Wire kinds. Every message is 12 bytes: kind, slot, players, 0, u32 frame (or seed), u32 value. */
export const INPUT = 1, HASH = 2, WELCOME = 3, LEAVE = 4;

/** Moves 12-byte messages to the room (or the other peers) and back. */
export interface Transport {
  /** Send one message. The buffer is reused: copy it before returning. */
  send(data: Uint8Array): void;
  /** Deliver every incoming message to `fn` (messages that arrived earlier are flushed to it). */
  listen(fn: ((data: Uint8Array) => void) | null): void;
  close(): void;
}

export interface PresenceOptions {
  transport: Transport;
  /** This peer's seat, 0..players-1 (the room says which). */
  slot: number;
  players: number;
  /** Frames of input delay (default 2: 33 ms at 60 Hz). */
  delay?: number;
  /** Input frames kept per player (default 64; at least 2 × delay + 2). */
  cap?: number;
  /** This player's input for the frame being scheduled, as bits (read latched intents here). */
  input(): number;
  /** The simulation for one frame: same inputs + same seed → same state on every peer. */
  step(e: Engine, inputs: Uint32Array, frame: number): void;
  /** A hash of the sim state (see `hash32`); compared across peers to catch a desync. */
  hash?(): number;
  /** Frames between hash checks (default 30). */
  hashEvery?: number;
}

const FRAME = 0, STALLS = 1, DROPPED = 2, DESYNC = 3, LOST = 4;

export function presence(e: Engine, o: PresenceOptions) {
  const P = o.players, me = o.slot, D = o.delay ?? 2, C = o.cap ?? 64, every = o.hashEvery ?? 30, t = o.transport;
  if (C < D * 2 + 2 || me >= P) throw new RangeError("presence: cap < 2 × delay + 2, or slot ≥ players");
  // One ring slot per (player, frame % cap): the frame it holds and the bits; same for hashes.
  const tag = new Int32Array(P * C).fill(-1), bits = new Uint32Array(P * C);
  const htag = new Int32Array(P * C).fill(-1), hval = new Uint32Array(P * C);
  const now = new Uint32Array(P), n = new Int32Array(5), out = new Uint8Array(12);
  n[DESYNC] = -1;
  const put = (s: number, f: number, b: number) => ((tag[s * C + (f % C)] = f), (bits[s * C + (f % C)] = b));
  for (let s = 0; s < P; s++) for (let f = 0; f < D; f++) put(s, f, 0);
  const send = (k: number, f: number, v: number) => {
    out[0] = k, out[1] = me, out[4] = f, out[5] = f >>> 8, out[6] = f >>> 16, out[7] = f >>> 24;
    out[8] = v, out[9] = v >>> 8, out[10] = v >>> 16, out[11] = v >>> 24;
    t.send(out);
  };
  const check = (s: number, f: number, h: number) => {
    const i = f % C;
    for (let j = 0; j < P; j++) if (j !== s && htag[j * C + i] === f && hval[j * C + i] !== h >>> 0 && n[DESYNC]! < 0) n[DESYNC] = f;
    htag[s * C + i] = f;
    hval[s * C + i] = h;
  };
  const receive = (d: Uint8Array) => {
    const k = d[0], s = d[1]!, f = d[4]! | (d[5]! << 8) | (d[6]! << 16) | (d[7]! << 24);
    if (d.length < 12 || s >= P || s === me) return;
    if (k === LEAVE) n[LOST]! |= 1 << s;
    else if (k === INPUT && f >= n[FRAME]! && f < n[FRAME]! + C) put(s, f, d[8]! | (d[9]! << 8) | (d[10]! << 16) | (d[11]! << 24));
    else if (k === HASH && f > n[FRAME]! - C && f < n[FRAME]! + C) check(s, f, d[8]! | (d[9]! << 8) | (d[10]! << 16) | (d[11]! << 24));
    else n[DROPPED]!++;
  };
  const system: System = {
    step(e) {
      const f = n[FRAME]!;
      for (let s = 0; s < P; s++) {
        const i = s * C + (f % C);
        if (tag[i] !== f) return void n[STALLS]!++; // lockstep: wait, never guess
        now[s] = bits[i]!;
      }
      const b = o.input() >>> 0;
      put(me, f + D, b);
      send(INPUT, f + D, b);
      o.step(e, now, f);
      n[FRAME] = f + 1;
      if (o.hash && (f + 1) % every === 0) {
        const h = o.hash() >>> 0;
        check(me, f + 1, h);
        send(HASH, f + 1, h);
      }
    },
  };
  e.add(system);
  t.listen(receive);
  const stop = () => (e.remove(system), t.listen(null), t.close());
  e.signal.addEventListener("abort", stop, { once: true });
  return {
    system,
    /** Sim frames run so far (every peer passes the same frames, maybe at different times). */
    get frame() {
      return n[FRAME]!;
    },
    /** Engine steps spent waiting for someone's input. */
    get stalls() {
      return n[STALLS]!;
    },
    /** Messages refused (out of the window, bad seat). */
    get dropped() {
      return n[DROPPED]!;
    },
    /** First frame whose state hash differed from a peer's, or -1. */
    get desync() {
      return n[DESYNC]!;
    },
    /** Bitmask of seats the room said left (their frames never arrive: the sim waits). */
    get lost() {
      return n[LOST]!;
    },
    /** The confirmed input of `slot` for `frame`, or -1 if it isn't known (yet, or any more). */
    confirmed(slot: number, frame: number) {
      const i = slot * C + (frame % C);
      return tag[i] === frame ? bits[i]! : -1;
    },
    destroy: stop,
  };
}
export type Presence = ReturnType<typeof presence>;

/** FNV-1a over bytes: hash a byte view of your state's typed arrays (make the view once). */
export function hash32(bytes: Uint8Array, h = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 16777619);
  return h >>> 0;
}

/** In-memory hub: `peers` transports that broadcast to each other (like the room relay) after
 *  `latency` ± `jitter` ticks. Call `tick()` once per frame. Bounded: `cap` messages in flight. */
export function memory(o: { peers: number; latency?: number; jitter?: number; seed?: number; cap?: number }) {
  const cap = o.cap ?? 1024, lat = o.latency ?? 0, jit = o.jitter ?? 0, rnd = seeded(o.seed ?? 1);
  const buf = new Uint8Array(cap * 12), due = new Int32Array(cap), to = new Uint8Array(cap), n = new Int32Array(3); // clock, queued, dropped
  const fns: (((d: Uint8Array) => void) | null)[] = [], scratch = new Uint8Array(12);
  const ends: Transport[] = [];
  for (let p = 0; p < o.peers; p++) {
    fns.push(null);
    ends.push({
      send(d) {
        for (let q = 0; q < o.peers; q++) {
          if (q === p) continue;
          const k = n[1]!;
          if (k === cap) return void n[2]!++;
          for (let b = 0; b < 12; b++) buf[k * 12 + b] = d[b]!;
          due[k] = n[0]! + lat + (jit ? (rnd() * (jit + 1)) | 0 : 0);
          to[k] = q;
          n[1] = k + 1;
        }
      },
      listen: (fn) => (fns[p] = fn),
      close: () => (fns[p] = null),
    });
  }
  return {
    ends,
    /** Advance the link clock one tick and deliver what's due (later messages may overtake). */
    tick() {
      const c = ++n[0]!;
      let w = 0;
      for (let k = 0; k < n[1]!; k++) {
        if (due[k]! <= c) {
          for (let b = 0; b < 12; b++) scratch[b] = buf[k * 12 + b]!;
          fns[to[k]!]?.(scratch);
        } else {
          if (w !== k) (buf.copyWithin(w * 12, k * 12, k * 12 + 12), (due[w] = due[k]!), (to[w] = to[k]!));
          w++;
        }
      }
      n[1] = w;
    },
    get queued() {
      return n[1]!;
    },
    get dropped() {
      return n[2]!;
    },
  };
}

/** Wrap an open-or-opening WebSocket as a transport. Messages before `listen` are kept (≤ 256). */
export function websocket(ws: WebSocket): Transport {
  let fn: ((d: Uint8Array) => void) | null = null;
  const early: Uint8Array[] = [];
  ws.binaryType = "arraybuffer";
  ws.addEventListener("message", (ev) => {
    if (typeof ev.data === "string") return;
    const d = new Uint8Array(ev.data as ArrayBuffer);
    if (fn) fn(d);
    else if (early.length < 256) early.push(d);
  });
  return {
    send: (d) => void (ws.readyState === 1 && ws.send(d.slice(0, 12))),
    listen(f) {
      fn = f;
      while (f && early.length) f(early.shift()!);
    },
    close: () => ws.close(),
  };
}

/** Join a room (`fizlet-rooms`): resolves when the room is full with your seat and the shared seed. */
export function join(url: string, signal?: AbortSignal) {
  return new Promise<{ transport: Transport; slot: number; players: number; seed: number }>((ok, fail) => {
    const ws = new WebSocket(url), t = websocket(ws);
    const bye = () => (t.close(), fail(new Error("presence: room closed")));
    ws.addEventListener("close", bye);
    ws.addEventListener("error", bye);
    signal?.addEventListener("abort", bye);
    t.listen((d) => {
      if (d[0] !== WELCOME) return;
      t.listen(null);
      ws.removeEventListener("close", bye);
      ws.removeEventListener("error", bye);
      signal?.removeEventListener("abort", bye);
      ok({ transport: t, slot: d[1]!, players: d[2]!, seed: (d[4]! | (d[5]! << 8) | (d[6]! << 16) | (d[7]! << 24)) >>> 0 });
    });
  });
}
