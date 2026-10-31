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
  net?: { transport: Transport; slot: number; players: number; delay?: number; input?: () => number; again?: () => void; leave?: () => void;
    /** Two players: tanks a side, 1 (1v1) to 4 (4v4: each player + 3 AI wingmen); 0 or none = free-for-all
     *  with `bots` bots. P1's pick is the match's (it rides in P1's input word through the countdown). */
    squad?: number;
    /** A 4-seat room started with fewer humans: the computer takes the empty seats (`players` humans,
     *  4 tanks). With `squad` 2 it's 2v2 (`sides`: bits for P2, P3, P4, 1 = side 1; default 0b101,
     *  at most 2 a side), else free-for-all. P1's pick is the match's, like `squad`. */
    fill?: boolean; sides?: number;
    /** P1 turns auto-aim off for the match (agreed in the countdown, like the mode): no AUTO / LOCK for anyone. */
    noAuto?: boolean };
  /** Intensity levers. A board match reads the ones Practice → TUNE saved on this device; these
   *  override them in any mode (net play: every peer must pass the same values). */
  tune?: Partial<Record<TuneKey, number>>;
  onEnd?: (standings: { name: string; kills: number; deaths: number; you: boolean; team: number }[]) => void;
}
/** The levers: speed (×, 1), tank (px/s, 150), turn (turret ×, 1), fire (×, 1), shell (px/s, 600),
 *  respawn (s, 2.2), bots (SOLO rivals, 7), air (bot airstrike calls ×, 1). Defaults = the game as it was. */
export type TuneKey = "speed" | "tank" | "turn" | "fire" | "shell" | "respawn" | "bots" | "air";
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
  /** Net play, two players: tanks a side as agreed (0 = free-for-all). */
  readonly squad: number;
  /** Net play: P1 turned auto-aim off for this match (agreed in the countdown). */
  readonly noAuto: boolean;
  /** The intensity levers: live values, set one (saved on this device in board play), reset, open the card. */
  readonly tune: { readonly values: Record<TuneKey, number>; readonly changed: number; set(key: TuneKey, v: number): void; reset(): void; open(on?: boolean): void };
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
  readonly controls: { readonly auto: boolean; readonly lock: boolean; readonly lockTarget: number; readonly targeting: boolean; readonly locate: number; crate(): void };
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
