/** Battlefield Blitz with net play (dist/blitz-net.mjs): everything in blitz.mjs, plus lockstep. */
export * from "./blitz";
import type { Transport } from "./blitz";
/** Join a fizlet-rooms room: resolves when it starts (full, or seat 0 started it) with your seat, the
 *  humans in (`players`) and the room's seed. `protocols` go to the WebSocket handshake: fizlet-rooms
 *  reads the invite there (`["fizlet-rooms", "invite." + code]`). `lobby` hears who is in while it
 *  waits (a room server that sends LOBBY); on seat 0, `start()` asks the room to start now (START). */
export function join(url: string, signal?: AbortSignal, protocols?: string | string[], lobby?: (l: { slot: number; joined: number; size: number; start(): void }) => void): Promise<{ transport: Transport; slot: number; players: number; seed: number }>;
/** Wire kinds beyond fizlet/presence's: LOBBY (room → waiting peer: [5, seat, joined, 0, u32 size]) and START (seat 0 → room). */
export const LOBBY: 5, START: 6;
/** In-memory link between `peers` transports (tests and one-page demos); call tick() once per frame. */
export function memory(o: { peers: number; latency?: number; jitter?: number; seed?: number; cap?: number }): { ends: Transport[]; tick(): void; readonly queued: number; readonly dropped: number };
