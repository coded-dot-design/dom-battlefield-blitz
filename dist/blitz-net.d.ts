/** Battlefield Blitz with net play (dist/blitz-net.mjs): everything in blitz.mjs, plus lockstep. */
export * from "./blitz";
import type { Transport } from "./blitz";
/** Join a fizlet-rooms room: resolves when it's full with your seat and the room's seed. */
export function join(url: string, signal?: AbortSignal): Promise<{ transport: Transport; slot: number; players: number; seed: number }>;
/** In-memory link between `peers` transports (tests and one-page demos); call tick() once per frame. */
export function memory(o: { peers: number; latency?: number; jitter?: number; seed?: number; cap?: number }): { ends: Transport[]; tick(): void; readonly queued: number; readonly dropped: number };
