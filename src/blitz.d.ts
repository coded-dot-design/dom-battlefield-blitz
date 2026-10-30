/** Battlefield Blitz module types (dist/blitz.mjs). */
export interface BlitzOptions {
  /** "board": its own arena with a 3-minute match. "embed": the page is the arena, endless. */
  mode?: "board" | "embed";
  /** Match length in seconds (board). Default 180. */
  seconds?: number;
  /** Bot count. Default 7 (board) / 5 (embed). */
  bots?: number;
  /** Attract mode: every tank is a bot, no HUD or keys, endless. */
  demo?: boolean;
  /** Platoons: you + 3 wingmen in your colour against two other platoons. */
  platoons?: boolean;
  /** Seed for the match's randomness. Same seed + same input = the same match. Default: random. */
  seed?: number;
  /** Lockstep multiplayer (needs dist/blitz-net.mjs): same seed (the room's), only inputs cross the wire. A fixed 1100 × 640
   *  arena scaled to fit; humans in seats 0..players-1, bots after; no pause. `again` / `leave` put
   *  REMATCH / NEW ROOM keys on the result (the page joins the next room). */
  net?: { transport: Transport; slot: number; players: number; delay?: number; input?: () => number; again?: () => void; leave?: () => void };
  onEnd?: (standings: { name: string; kills: number; deaths: number; you: boolean; team: number }[]) => void;
}
/** fizlet/presence transport: moves 12-byte messages. */
export interface Transport {
  send(data: Uint8Array): void;
  listen(fn: ((data: Uint8Array) => void) | null): void;
  close(): void;
}
export interface Blitz {
  /** Platoon mode on? */
  readonly platoons: boolean;
  readonly state: "intro" | "count" | "play" | "end" | "paused";
  /** Leave the intro screen and start the countdown. */
  start(): void;
  sound: boolean;
  destroy(): void;
  /** Net play: lockstep frame, stalls, first desynced frame (-1); null when solo. */
  readonly net: { readonly frame: number; readonly stalls: number; readonly desync: number; readonly lost: number } | null;
  /** A hash of the match state. */
  hash(): number;
  readonly engine: { stats(): unknown; stop(): void; start(): void; advance(sec: number): void; readonly running: boolean };
  readonly world: { tanks: unknown[]; tiles: unknown[]; shells: unknown[]; blocks: unknown[]; planes: unknown[]; bombs: unknown[]; crates: unknown[]; marks: unknown[]; steps(n: number): void };
  /** Your controls (debug / tests). */
  readonly controls: { readonly auto: boolean; readonly lock: boolean; readonly lockTarget: number; readonly targeting: boolean; crate(): void };
}
export function createBlitz(host: HTMLElement, options?: BlitzOptions): Blitz;
export interface BlitzInstall {
  open(): Promise<unknown> | undefined;
  close(): void;
  destroy(): void;
  readonly opened: boolean;
}
/** The drop-in: a PLAY BLITZ key (or a hidden easter egg) that turns the page into the arena. */
export function install(config?: { easterEgg?: boolean | object; palette?: Record<string, string>; label?: string; platoons?: boolean }): BlitzInstall;
