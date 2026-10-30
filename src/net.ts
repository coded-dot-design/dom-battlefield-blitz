/** Battlefield Blitz with net play (dist/blitz-net.mjs): the module plus fizlet/presence, so
 *  createBlitz(host, { seed, net }) runs a lockstep match. The drop-in and blitz.mjs stay solo. */
import { presence } from "../vendor/fizlet/presence";
import { useLockstep } from "./game";
useLockstep(presence);
export * from "./index";
// Join a fizlet-rooms room (WebSocket; join(url, signal, protocols)), or link peers in memory
// (tests, one-page demos).
export { join, memory } from "../vendor/fizlet/presence";
