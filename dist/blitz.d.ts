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
  onEnd?: (standings: { name: string; kills: number; deaths: number; you: boolean }[]) => void;
}
export interface Blitz {
  readonly state: "intro" | "count" | "play" | "end" | "paused";
  /** Leave the intro screen and start the countdown. */
  start(): void;
  sound: boolean;
  destroy(): void;
  readonly engine: { stats(): unknown; stop(): void; start(): void; readonly running: boolean };
  readonly world: { tanks: unknown[]; tiles: unknown[]; shells: unknown[]; blocks: unknown[] };
}
export function createBlitz(host: HTMLElement, options?: BlitzOptions): Blitz;
export interface BlitzInstall {
  open(): Promise<unknown> | undefined;
  close(): void;
  destroy(): void;
  readonly opened: boolean;
}
/** The drop-in: a PLAY BLITZ key (or a hidden easter egg) that turns the page into the arena. */
export function install(config?: { easterEgg?: boolean | object; palette?: Record<string, string>; label?: string }): BlitzInstall;
