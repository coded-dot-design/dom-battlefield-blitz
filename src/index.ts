/** Battlefield Blitz as a module (the DOM Battlefield site's game and landing pages use this). */
export { createBlitz } from "./game";
export type { BlitzOptions, Blitz } from "./game";
export { install } from "./embed";
// Net play: join a fizlet-rooms room (WebSocket) or link peers in memory (tests, one-page demos).
export { join, memory } from "../vendor/fizlet/presence";
