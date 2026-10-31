/** Battlefield Blitz with net play (dist/blitz-net.mjs): everything in blitz.mjs, plus lockstep. */
export * from "./blitz";
import type { Transport } from "./blitz";
/** Join a fizlet-rooms room: resolves when it starts (full, or the host's START) with your seat, the
 *  humans in (`players`), the room's seed and the host's START `mode` byte. `protocols` go to the
 *  WebSocket handshake: fizlet-rooms reads the invite there (`["fizlet-rooms", "invite." + code]`).
 *  `o.lobby(start, seat, seated, size)` runs on each LOBBY (every join and leave before the start); on
 *  seat 0, `start(seats, mode)` asks the room to begin once `seats` are taken (0: now). Same call as @fzlt/core/presence's join (fizlet#210). */
export function join(url: string, signal?: AbortSignal, protocols?: string | string[], o?: { lobby?(start: (seats?: number, mode?: number) => void, seat: number, seated: number, size: number): void }): Promise<{ transport: Transport; slot: number; players: number; seed: number; mode: number }>;
/** fizlet-rooms START: [7, 0, seats, mode, 0…], from the host before the start. LOBBY: [8, your seat, room size, seated, 0…], from the room. */
export const START: 7, LOBBY: 8;
/** In-memory link between `peers` transports (tests and one-page demos); call tick() once per frame. */
export function memory(o: { peers: number; latency?: number; jitter?: number; seed?: number; cap?: number }): { ends: Transport[]; tick(): void; readonly queued: number; readonly dropped: number };
