// Battlefield Blitz with net play (dist/blitz-net.mjs): the module plus fizlet/presence, so
// createBlitz(host, { seed, net }) runs a lockstep match. The drop-in and blitz.mjs stay solo.
import { presence, websocket, WELCOME } from "../vendor/fizlet/presence";
import { useLockstep } from "./game";
import { seats } from "./seats";
useLockstep(presence, seats);
export * from "./index";
// Link peers in memory (tests, one-page demos).
export { memory } from "../vendor/fizlet/presence";

/** Room → waiting peer, on every join and leave before the start: [LOBBY, your seat, seats taken, 0, u32 room size].
 *  Seat 0 → room: [START, 0…]: start now with the seats taken (≥ 2); the room then sends WELCOME as
 *  when full, with players = the humans in. A room server without them starts when full, as before. */
export const LOBBY = 5, START = 6;

/** Join a fizlet-rooms room (WebSocket): resolves with your seat and the room's seed when it starts.
 *  `lobby` hears who is in while it waits; on seat 0 its `start()` asks the room to start now. */
export function join(url: string, signal?: AbortSignal, protocols?: string | string[], lobby?: (l: { slot: number; joined: number; size: number; start(): void }) => void) {
  return new Promise<{ transport: ReturnType<typeof websocket>; slot: number; players: number; seed: number }>((ok, fail) => {
    const ws = new WebSocket(url, protocols), t = websocket(ws);
    const bye = () => (t.close(), fail(new Error("presence: room closed")));
    const u32 = (d: Uint8Array, at: number) => (d[at]! | (d[at + 1]! << 8) | (d[at + 2]! << 16) | (d[at + 3]! << 24)) >>> 0;
    ws.addEventListener("close", bye);
    ws.addEventListener("error", bye);
    signal?.addEventListener("abort", bye);
    t.listen((d) => {
      if (d[0] === LOBBY) return lobby?.({ slot: d[1]!, joined: d[2]!, size: u32(d, 4), start: () => t.send(new Uint8Array([START, d[1]!, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])) });
      if (d[0] !== WELCOME) return;
      t.listen(null);
      ws.removeEventListener("close", bye);
      ws.removeEventListener("error", bye);
      signal?.removeEventListener("abort", bye);
      ok({ transport: t, slot: d[1]!, players: d[2]!, seed: u32(d, 4) });
    });
  });
}
