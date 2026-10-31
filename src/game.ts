/**
 * Battlefield Blitz: free-for-all tank chaos, built on the Fizlet engine.
 * Everyone respawns by parachute; most kills wins. The grid blinks: lit tiles roll like a slot
 * machine, then settle into a power-up (rapid fire, triple shot, airstrike, shield, health, long
 * shot) or a MINE. Supply crates parachute in. Kill streaks pay out: long shots, airstrikes, a
 * carpet bomb, and at eight a nuke.
 *
 * Two guns: the cannon fires fast (and overheats), the LONG gun locks on and hits from across the
 * field (three to start; find or earn more). Airstrikes: press STRIKE, tap the spot, a bomber
 * flies over and the bombs go off with the Battlefield hero's big blasts and black scorch.
 *
 * Two modes:
 *   board - its own page: a dark grid arena with cover blocks, a 3-minute match and a result.
 *   embed - dropped onto any page: the page itself is the arena; shells knock its headings and
 *           treads flatten them. Endless. Escape (or the toggle) closes and the page is untouched.
 */
import { createEngine } from "../vendor/fizlet/index";
import type { presence as Presence, Transport } from "../vendor/fizlet/presence";
import type { seats as Seats } from "./seats";

// Net play's lockstep (@fzlt/core/presence) and seat map (src/seats.ts) are registered by the net build
// (src/net.ts → dist/blitz-net.mjs), so the drop-in and the solo module don't carry them.
let lockstep: typeof Presence | null = null, seatMap: typeof Seats = null!;
export function useLockstep(p: typeof Presence, s: typeof Seats) {
  (lockstep = p), (seatMap = s);
}
import { controls } from "../vendor/fizlet/input";
import { effects } from "../vendor/fizlet/fx";
import { sound } from "../vendor/fizlet/sound";
import { inRect } from "../vendor/fizlet/collide";
import { tankSprites } from "./sherman-sprites";
import { launch, slam } from "../vendor/fizlet/ui/board-ui";
import { drops } from "../vendor/fizlet/rules";

/** The Board UI kit CSS (Fizlet's ui brick), minified and baked in by scripts/build.mjs. */
declare const __KIT_CSS__: string;

export interface BlitzOptions {
  mode?: "board" | "embed";
  /** Match length in seconds (board). Default 180. */
  seconds?: number;
  /** Bot count. Default 7 (board) / 5 (embed). */
  bots?: number;
  /** Attract mode: every tank is a bot, no HUD or keys, endless (a landing-page hero). */
  demo?: boolean;
  /** Platoons: you and 3 wingmen in your colour against two other platoons (default: solo, or
   *  the last mode picked on the start screen). */
  platoons?: boolean;
  /** Seed for the match's randomness (engine.random). Same seed + same input = the same match. Default: random. */
  seed?: number;
  /** Lockstep multiplayer (@fzlt/core/presence): every peer runs the same match from the same seed and
   *  only inputs cross the wire. A fixed 1100 × 640 arena (scaled to fit), humans in seats
   *  0..players-1, bots after them, no pause. `input` replaces this peer's controls (tests). */
  net?: { transport: Transport; slot: number; players: number; delay?: number; input?: () => number; again?: () => void; leave?: () => void; squad?: number; fill?: boolean; sides?: number; noAuto?: boolean };
  /** Intensity levers (see TUNE). A board match on this device reads the ones saved by Practice →
   *  TUNE; these override them in any mode. Net play: every peer must pass the same values. */
  tune?: Partial<Record<TuneKey, number>>;
  /** Called when a board match ends. */
  onEnd?: (standings: { name: string; kills: number; deaths: number; you: boolean; team: number }[]) => void;
}

const TAU = Math.PI * 2;
/**
 * The intensity levers (Practice → TUNE): one config layer the match reads at its seams. Each default
 * is the number the game used before the levers, so an untouched game plays bit for bit as before.
 *   speed   the match clock: every timer, every move (a fixed step of dt × speed)
 *   tank    drive speed, px/s at the 1.4 scale
 *   turn    turret (aim) turn rate, × (players' and bots')
 *   fire    cannon fire rate, × (the cooldown ÷ this; everyone)
 *   shell   cannon shell speed, px/s (same reach: a slower shell lives longer)
 *   respawn seconds wrecked before the parachute
 *   bots    rival bots in a SOLO match (next match)
 *   air     how often bots call in the airstrikes they hold, ×
 */
const TUNE = [
  ["speed", "GAME SPEED", "the whole match, slow-mo to fast", 1, 0.5, 1.5, 0.05, "×"],
  ["tank", "TANK SPEED", "how fast every tank drives", 150, 80, 220, 5, " px/s"],
  ["turn", "TURRET TURN", "how fast turrets swing onto a target", 1, 0.4, 1.5, 0.05, "×"],
  ["fire", "FIRE RATE", "cannon shots per second, everyone", 1, 0.4, 1.5, 0.05, "×"],
  ["shell", "SHELL SPEED", "slower shells are easier to dodge", 600, 300, 900, 25, " px/s"],
  ["respawn", "RESPAWN", "time out after you are wrecked", 2.2, 1, 6, 0.1, " s"],
  ["bots", "SOLO BOTS", "rivals in a SOLO match (next match)", 7, 1, 10, 1, ""],
  ["air", "BOT AIRSTRIKES", "how often bots call strikes in", 1, 0, 2, 0.1, "×"],
] as const;
export type TuneKey = (typeof TUNE)[number][0];
const U_SPEED = 0, U_TANK = 1, U_TURN = 2, U_FIRE = 3, U_SHELL = 4, U_RESPAWN = 5, U_BOTS = 6, U_AIR = 7;
const tuneDefaults = () => Object.fromEntries(TUNE.map((r) => [r[0], r[3]])) as Record<TuneKey, number>;
/** A lever's value on its slider's grid, clamped to its range. */
const tuneFit = (k: number, v: number) => {
  const [, , , , min, max, step] = TUNE[k]!;
  // To 6 decimals, so a value that lands on a default is the default exactly (2.2, not 2.2000000000000002).
  return Number.isFinite(+v) ? Math.round(Math.min(max, Math.max(min, Math.round((+v - min) / step) * step + min)) * 1e6) / 1e6 : TUNE[k]![3];
};
/**
 * Length of (x, y), bit for bit what Math.hypot returns for finite x, y, without its allocation
 * (V8's Math.hypot allocates on every call, even optimized). It scales by the larger side as V8 does,
 * so a seed replays the same match as before; a plain Math.sqrt(x * x + y * y) can differ in the last bit.
 */
function dist(x: number, y: number) {
  if (x < 0) x = -x;
  if (y < 0) y = -y;
  const m = x > y ? x : y, r = x > y ? y / m : x / m;
  return m === 0 ? 0 : m * Math.sqrt(1 + r * r);
}
const MAXHP = 5, RAIL_MAX = 9, STRIKE_MAX = 5, RAIL_START = 3;
// Net play: squares of the arena kept off screen on each axis (at least), so a tank can hide.
const HIDE = 2;
// Platoon mode: one colour per platoon; your wingmen have names, the others are numbered.
const TEAM_COLORS = ["#39ffb0", "#ff5c8f", "#19f0ff", "#ffc21a"];
const PLATOON = ["YOUR", "VIPER", "NOVA", "BRICK"];
const WING = ["ACE", "BOLT", "DUKE"];
const NAMES = ["YOU", "VIPER", "NOVA", "BRICK", "ZAP", "HEX", "RUMBLE", "MOTH", "SPUD", "JINX", "ORBIT"];
const COLORS = ["#39ffb0", "#ff5c8f", "#19f0ff", "#ffc21a", "#b48cff", "#ff8a1f", "#a8ff3e", "#f6f3ff", "#ff2e88", "#7cf0ff", "#e8b4ff"];
// Power tiles: what a lit square settles into.
const RAPID = 1, TRIPLE = 2, STRIKE = 3, SHIELD = 4, MINE = 5, HEAL = 6, AMMO = 7;
const TILE_COLOR = ["", "#39ffb0", "#19f0ff", "#ff2e88", "#f6f3ff", "#ff2b4e", "#a8ff3e", "#ffc21a"];
const WORDS = ["BOOM", "KABOOM", "WRECKED", "DIRECT HIT", "BLAM", "FLATTENED", "AIRSTRIKE!", "RAPID", "TRIPLE", "SHIELD", "+1 STRIKE", "MINE!", "LANDED", "DOUBLE KILL", "RAMPAGE", "+1", "+2 HP", "+1 LONG", "SNIPED", "SUPPLY DROP", "CARPET BOMB", "NUKED", "OVERHEAT", "LOCKED", "MEDKIT", "+2 LONG", "JACKPOT", "+1 HP"];
const W_BOOM = 0, W_STRIKE = 6, W_MINE = 11, W_DOUBLE = 13, W_RAMPAGE = 14, W_PLUS = 15, W_SNIPED = 18, W_SUPPLY = 19, W_CARPET = 20, W_NUKE = 21, W_HOT = 22, W_LOCK = 23, W_HP1 = 27;
const TILE_WORD = [0, 7, 8, 10, 9, 11, 16, 17];
const CRATE_WORD = [24, 25, 10, 26];
const FX_COLORS = ["#fff4ff", "#ffc21a", "#ff8a1f", "#ff2e88", "#19f0ff", "#39ffb0", "#9a63ff", "#07060f"];
// Kill streak (kills in one life) → reward.
const REWARD = ["", "", "+1 LONG SHOT", "+1 AIRSTRIKE", "", "CARPET BOMB READY", "", "", "NUKE INCOMING"];

interface Tank {
  i: number; team: number; slot: number; name: string; color: string; you: boolean;
  x: number; y: number; a: number; ta: number;
  hp: number; alive: boolean; dead: number; drop: number; shield: number; rapid: number; triple: number;
  strikes: number; carpet: number; rail: number; charge: number; chargeT: number; heat: number; hot: number;
  cool: number; kills: number; deaths: number; recoil: number; flash: number; tread: number; streak: number; streakT: number; run: number;
  gx: number; gy: number; think: number; target: number; lastHit: number;
}
interface Shell { x: number; y: number; vx: number; vy: number; life: number; owner: number; on: boolean; rail: boolean; tgt: number }
interface Tile { c: number; r: number; type: number; roll: number; t: number; on: boolean }
interface Block { x: number; y: number; w: number; h: number; hp: number; back: number }
/** The reticle over a strike zone, until the last bomb lands. */
interface Mark { x: number; y: number; t: number; max: number; owner: number; on: boolean }
interface Plane { x: number; y: number; vx: number; vy: number; a: number; t: number; owner: number; on: boolean }
interface Bomb { x: number; y: number; wait: number; fall: number; owner: number; main: boolean; on: boolean }
/** A follow-up blast a beat after the first (the hero's triple boom). */
interface Boom { x: number; y: number; t: number; p: number; c: number; on: boolean }
interface Cover { el: HTMLElement; x: number; y: number; w: number; h: number; busy: number }

const ICON = {
  fire: '<path d="M10 1v5M10 14v5M1 10h5M14 10h5"/><circle cx="10" cy="10" r="5"/>',
  long: '<circle cx="10" cy="10" r="7"/><path d="M10 1v6M10 13v6M1 10h6M13 10h6"/><circle cx="10" cy="10" r="1" fill="currentColor"/>',
  strike: '<path d="M10 1.5l1.6 5.2 6.4 3.6v1.6l-6.3-1.4-.7 4.3 2.3 1.9v1.3l-3.3-.9-3.3.9v-1.3l2.3-1.9-.7-4.3L2 11.9v-1.6l6.4-3.6z"/>',
  auto: '<path d="M10 1v4M10 15v4M1 10h4M15 10h4M5.5 5.5l2 2M14.5 5.5l-2 2M5.5 14.5l2-2M14.5 14.5l-2-2"/>',
  lock: '<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M10 8v4M8 10h4"/>',
  pause: '<path d="M7 4v12M13 4v12"/>',
  full: '<path d="M2 7V2h5M18 7V2h-5M2 13v5h5M18 13v5h-5"/>',
  exit: '<path d="M7 2v5H2M13 2v5h5M7 18v-5H2M13 18v-5h5"/>',
  tune: '<path d="M3 5h14M3 10h14M3 15h14"/><circle cx="7" cy="5" r="2" fill="currentColor"/><circle cx="13" cy="10" r="2" fill="currentColor"/><circle cx="9" cy="15" r="2" fill="currentColor"/>',
};
// The Battlefield cartridge skull on its grid tile, with a pink Blitz bolt.
const GRID = '<path d="M0 16h64M0 32h64M0 48h64M16 0v64M32 0v64M48 0v64" stroke="#19f0ff" stroke-opacity=".35"/><rect x="1" y="1" width="62" height="62" fill="none" stroke="#19f0ff" stroke-width="2"/>';
const BADGE = `<svg class="ic" viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges">${GRID}<g transform="translate(10 9) scale(.69)" fill="currentColor"><path fill-rule="evenodd" d="M19 6h26v6h7v6h6v6h5v22h-5v6h-8v12h-9v-8h-6v8h-8v-8h-6v8h-8V52H5v-6H0V24h5v-6h6v-6h8ZM11 29v14h15V29Zm26 0v14h15V29Z"/></g><path d="M50 3h9l-4 7h5l-10 12 3-9h-5z" fill="#ff2e88"/></svg>`;
// The white flag (kit section 9.3): a 4 × 4 grid in your team colour that whites out, and a flag that waves.
const CELLS = [0, 1, 4, 2, 5, 8, 3, 6, 9, 12, 7, 10, 13, 11, 14, 15].map((i, k) => `<rect x="${(i % 4) * 16}" y="${((i / 4) | 0) * 16}" width="16" height="16" style="--i:${k}"/>`).join("");
const FLAG = `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges"><g class="bui-cells">${CELLS}</g><path class="bui-grid" d="M0 16h64M0 32h64M0 48h64M16 0v64M32 0v64M48 0v64"/><rect class="bui-frame" x="1" y="1" width="62" height="62"/><path class="bui-pole" d="M17 9h4v46h-4Z"/><path class="bui-cloth" d="M21 12h24l-6 9 6 9H21Z"/></svg>`;
const SKULL = `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges"><g transform="translate(10 9) scale(.69)"><path fill-rule="evenodd" d="M19 6h26v6h7v6h6v6h5v22h-5v6h-8v12h-9v-8h-6v8h-8v-8h-6v8h-8V52H5v-6H0V24h5v-6h6v-6h8ZM11 29v14h15V29Zm26 0v14h15V29Z"/></g></svg>`;
const PLAY = `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges">${GRID}<path d="M22 16v32l26-16Z" fill="currentColor"/></svg>`;
const AGAIN = `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges">${GRID}<path d="M30 12v8a13 13 0 1 0 13 13h6a19 19 0 1 1-19-19Zm0-2 10 9-10 8Z" fill="currentColor"/></svg>`;
const MENU = `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges">${GRID}<path d="M16 18h32v6H16Zm0 11h32v6H16Zm0 11h32v6H16Z" fill="currentColor"/></svg>`;
const svg = (k: keyof typeof ICON) => `<svg viewBox="0 0 20 20" aria-hidden="true">${ICON[k]}</svg>`;

// A phone: a coarse pointer on a small screen (site.css "Game mode", the same query). The board covers
// the screen, the keys float at its edges, and a drive stick shows bottom left.
const PHONE = "(pointer: coarse) and (max-width: 900px), (pointer: coarse) and (max-height: 500px)";
const CSS = `:host{all:initial;display:block}*{box-sizing:border-box}
.bz{position:absolute;inset:0;overflow:hidden;font:600 12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;touch-action:none;user-select:none;-webkit-user-select:none}
.bz.embed{position:fixed;z-index:2147483000}
canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
.aiming canvas{cursor:none}
.hud{position:absolute;left:50%;top:max(10px,env(safe-area-inset-top));translate:-50% 0;display:flex;gap:14px;align-items:center;padding:8px 14px;background:color-mix(in srgb,var(--surface) 93%,transparent);border:2px solid var(--line);border-radius:12px;box-shadow:0 5px 0 var(--rim);pointer-events:auto;cursor:grab;touch-action:none;white-space:nowrap}.hud.on{cursor:grabbing}
.hud b{font-size:17px;font-weight:900}.hud small{display:block;font-size:8px;letter-spacing:.16em;color:var(--muted)}
.hud :is(.k,.tm) b{color:var(--team)}.hud .t b{color:var(--k-sys-ink)}.hud .lead b{color:var(--k-cmd-ink);font-size:13px}.hud .st b{color:var(--k-fire-ink)}
.bui[data-theme=light] .hud :is(.k,.tm) b{color:#0a8a55}
.hud i{display:block;width:64px;height:10px;margin-top:4px;background:var(--raised);border:1.5px solid var(--rim);border-radius:3px;overflow:hidden}
.hud u{display:block;height:100%;background:var(--team);transition:width .2s}.hud .low u{background:var(--k-fire)}
.hud .tm{display:none}.platoon .hud .tm{display:block}
.feed{position:absolute;right:max(12px,env(safe-area-inset-right));top:max(70px,calc(env(safe-area-inset-top) + 60px));margin:0;padding:0;list-style:none;display:grid;gap:4px;justify-items:end;pointer-events:none}
.feed li{padding:4px 8px;color:var(--ink);background:color-mix(in srgb,var(--surface) 90%,transparent);border:1px solid var(--line);border-radius:6px;font-size:11px}.feed li:empty{display:none}
.feed i{font-style:normal;font-weight:900;text-shadow:0 0 1px var(--rim)}
.banner{position:absolute;left:50%;top:max(80px,calc(env(safe-area-inset-top) + 70px));translate:-50% 0;display:grid;justify-items:center;gap:4px;padding:10px 22px 12px;background:#10233f;border:3px solid #f6f3ff;border-radius:14px;box-shadow:0 6px 0 #f6f3ff;rotate:-2deg;pointer-events:none;opacity:0;white-space:nowrap}
.banner b{font:900 clamp(20px,4vw,34px)/1 ui-monospace,monospace;letter-spacing:.05em;color:#ffc21a}.banner span{font-size:11px;letter-spacing:.18em;color:#19f0ff}
.tip{position:absolute;left:50%;bottom:max(18px,env(safe-area-inset-bottom));translate:-50% 0;padding:8px 14px;font-size:11px;letter-spacing:.12em;color:var(--rim);background:var(--k-attack);border:2px solid var(--rim);border-radius:8px;box-shadow:0 4px 0 var(--rim);pointer-events:none;white-space:nowrap;animation:blink 1s steps(2) infinite}
.tip[hidden]{display:none}@keyframes blink{50%{opacity:.6}}
.pad{position:absolute;right:max(10px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));width:200px;height:256px;pointer-events:none;transform-origin:100% 100%}
.embed .pad{bottom:max(80px,calc(env(safe-area-inset-bottom) + 64px))}
.bui .pad .grab{top:auto;left:auto;translate:none;right:60px;bottom:224px;pointer-events:auto}
.bui .rk{--py:5px;position:absolute;display:grid;place-content:center;justify-items:center;gap:2px;width:62px;height:62px;min-height:0;padding:0;border-width:2.5px;border-radius:50%;pointer-events:auto;touch-action:none}
.bui .rk svg{width:24px;height:24px;stroke-width:2.3}
.rk small{font:900 8px/1 ui-monospace,monospace;letter-spacing:.12em}
.rk .n{position:absolute;top:-7px;right:-7px;min-width:24px;height:24px;padding:0 6px;font:900 12px/20px ui-monospace,monospace;color:var(--ink);background:var(--surface);border:2px solid var(--c);border-radius:12px}
.bui .rk kbd{position:absolute;left:-6px;top:-6px;margin:0;padding:1px 4px;font:800 8px/1.3 ui-monospace,monospace;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-radius:4px;opacity:1}
.bui .fire{width:96px;height:96px;right:30px;bottom:0}.bui .fire kbd{left:50%;top:auto;bottom:-8px;translate:-50% 0}.bui .fire svg{width:40px;height:40px}
.fire::after{content:"";position:absolute;inset:-9px;border-radius:50%;background:conic-gradient(var(--hurt) calc(var(--h,0) * 1turn),transparent 0);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 4px));mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 4px));pointer-events:none}
.fire.hot::after{background:var(--k-fire);animation:blink .25s steps(2) infinite}
/* AUTO and LOCK ride on FIRE's shoulders (the Battlefield cockpit); the two specials sit in a row above. */
.bui .long{--c:var(--hurt);right:85px;bottom:150px}.bui .strike{--lock:var(--k-attack);right:9px;bottom:150px}
.bui :is(.lock,.auto){width:52px;height:52px}.bui .auto{right:92px;bottom:84px}.bui .lock{right:12px;bottom:84px}.bui :is(.lock,.auto) svg{width:20px;height:20px}
.coach-on{outline:3px dashed var(--ink);outline-offset:6px;animation:coach 1s ease-in-out infinite}@keyframes coach{50%{outline-offset:10px}}
.demo .hud,.demo .pad,.demo .help,.demo .feed,.demo .banner,.demo .tip{display:none}.demo canvas{cursor:default}
.help{position:absolute;left:max(14px,env(safe-area-inset-left));bottom:max(14px,env(safe-area-inset-bottom));max-width:calc(100% - 240px);padding:6px 10px;font-size:10px;letter-spacing:.08em;color:var(--muted);background:color-mix(in srgb,var(--surface) 85%,transparent);border-radius:8px;pointer-events:none}
.over{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:30px;background:color-mix(in srgb,#2a2d38 72%,transparent)}
.over[hidden]{display:none}
.over.intro{padding-top:64px;background:radial-gradient(closest-side,color-mix(in srgb,var(--bg) 60%,transparent),transparent)}
.sticker{display:grid;grid-template-columns:auto auto;grid-template-areas:"icon kicker" "icon name";column-gap:14px;align-items:center;justify-items:start;padding:10px 24px 12px 14px;color:var(--rim);background:var(--k-flag);border:3px solid var(--rim);border-radius:12px;box-shadow:0 6px 0 var(--rim);rotate:-4deg;animation:bui-slam 1.1s linear both;pointer-events:none}
.sticker.plain{grid-template-columns:auto;grid-template-areas:"kicker" "name";justify-items:center;padding:10px 24px 12px}
.sticker .ic{grid-area:icon;display:block;width:62px;height:62px;padding:3px;color:#19f0ff;background:#10233f;border-radius:7px}
.sticker span{grid-area:kicker;align-self:end;font:800 9px/1 ui-monospace,monospace;letter-spacing:4px;animation:blink 1s steps(2) infinite}
.sticker b{grid-area:name;font:900 clamp(34px,7vw,58px)/1 ui-monospace,monospace;letter-spacing:3px;white-space:nowrap;text-shadow:0 4px 0 #07060f59}
.sticker b em{font-style:normal;color:#ff2e88;text-shadow:0 4px 0 #8f195066}
.bui .bui-sticker-key{animation:pop .38s .9s var(--bui-spring) both}.bui .bui-sticker-key svg [stroke]{stroke:currentColor}.bui .bui-sticker-key b{animation:blink 1s steps(2) infinite}
@keyframes pop{from{scale:.4;opacity:0}}
.modes{margin-top:-6px;flex-wrap:wrap;justify-content:center;gap:12px;max-width:calc(100vw - 24px)}
.bui .mode{flex:1 1 120px;display:grid;justify-items:center;align-content:center;gap:4px;min-width:0;padding:10px 14px 9px;--py:5px}
.mode b{font:900 14px/1 ui-monospace,monospace;letter-spacing:.12em}.mode small{font-size:9px;letter-spacing:.06em;color:var(--muted)}.mode[aria-pressed=true] small{color:inherit;opacity:.8}
.coach{position:absolute;left:50%;top:max(76px,calc(env(safe-area-inset-top) + 66px));translate:-50% 0;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:2px 12px;width:min(520px,calc(100% - 24px));padding:10px 12px 10px 14px;color:#f6f3ff;background:#10233f;border:2.5px solid #f6f3ff;border-radius:12px;box-shadow:0 5px 0 #f6f3ff}
.bui[data-theme=light] .coach{color:var(--rim);background:#f6f3ff;border-color:var(--rim);box-shadow:0 5px 0 var(--rim)}
.coach[hidden]{display:none}.coach span{grid-row:span 2;font:900 11px/1 ui-monospace,monospace;color:var(--k-sys-ink)}.coach b{font:900 14px/1.1 ui-monospace,monospace;letter-spacing:.08em;color:var(--hurt)}.bui[data-theme=light] .coach b{color:#b07400}.coach small{grid-column:2;font-size:11px;line-height:1.35;opacity:.85}
.coach .cx{grid-row:1/span 2;grid-column:3;display:grid;gap:6px}.bui .coach button{min-height:0;padding:7px 10px;font:900 10px/1 ui-monospace,monospace;letter-spacing:.08em}
.bui .coach [data-tune]{display:inline-flex;align-items:center;justify-content:center;gap:5px}.coach [data-tune] svg{width:13px;height:13px;stroke:currentColor;stroke-width:2;fill:none}
.tuning .coach{display:none}
.bui .tune{position:absolute;z-index:4;left:max(12px,env(safe-area-inset-left));top:max(60px,calc(env(safe-area-inset-top) + 50px));display:grid;gap:8px;width:min(400px,calc(100% - 24px));max-height:calc(100% - 76px);padding-bottom:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y}
.tune[hidden]{display:none}
.tune header{display:grid;grid-template-columns:1fr auto;align-items:center;column-gap:10px}.tune header b{font:900 15px/1.1 ui-monospace,monospace;letter-spacing:.12em}.tune header small{grid-row:2;font-size:9px;letter-spacing:.14em;color:var(--muted)}
.bui .tune button{min-height:44px;padding:0 12px;font:900 11px/1 ui-monospace,monospace;letter-spacing:.1em}.bui .tune header button{grid-row:1/span 2;grid-column:2;min-height:40px}
.tr{display:grid;gap:2px;padding:6px 0 4px;border-top:1px solid var(--line)}
.tr span{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:11px;letter-spacing:.1em}
.tr output{font:900 13px/1 ui-monospace,monospace;font-variant-numeric:tabular-nums}.tr.on output{color:var(--hurt)}.bui[data-theme=light] .tr.on output{color:#b07400}
.tr small{font-size:10px;color:var(--muted)}
.tune input{-webkit-appearance:none;appearance:none;display:block;width:100%;height:26px;margin:0;background:none;cursor:pointer;touch-action:pan-y}
.tune input::-webkit-slider-runnable-track{height:10px;border:2px solid var(--line);border-radius:5px;background:linear-gradient(90deg,var(--k-sys) calc(var(--p,0) * 100%),var(--raised) 0)}
.tune input::-moz-range-track{height:6px;border:2px solid var(--line);border-radius:5px;background:linear-gradient(90deg,var(--k-sys) calc(var(--p,0) * 100%),var(--raised) 0)}
.tune input::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-8px;background:var(--k-sys);border:2.5px solid var(--rim);border-radius:6px;box-shadow:calc(2 * var(--shadow-x,0) * var(--u)) calc(2 * var(--shadow-y,1) * var(--u)) 0 var(--shadow-color,var(--rim))}
.tune input::-moz-range-thumb{width:17px;height:17px;background:var(--k-sys);border:2.5px solid var(--rim);border-radius:6px;box-shadow:calc(2 * var(--shadow-x,0) * var(--u)) calc(2 * var(--shadow-y,1) * var(--u)) 0 var(--shadow-color,var(--rim))}
.tune input:focus-visible{outline:3px solid var(--k-sys-ink);outline-offset:1px;border-radius:6px}
.tune .note{margin:0;font-size:10px;line-height:1.4;color:var(--muted)}
.tune code{display:block;padding:6px 8px;font:10px/1.45 ui-monospace,monospace;word-break:break-all;color:var(--ink);background:var(--raised);border:1px solid var(--line);border-radius:6px;user-select:text;-webkit-user-select:text}
.tune .tk{position:sticky;bottom:0;display:grid;grid-template-columns:1fr 1.5fr;gap:10px;margin:0 -14px;padding:10px 14px 14px;background:var(--card);border-top:1px solid var(--line)}
.tuned{margin:-14px 0 0;padding:4px 10px;font-size:10px;letter-spacing:.12em;color:var(--rim);background:var(--hurt);border:2px solid var(--rim);border-radius:6px}
.vs{margin:-18px 0 0;font:900 18px/1 ui-monospace,monospace;letter-spacing:.2em;color:var(--k-sys-ink)}
.bui .fs{position:absolute;z-index:3;left:calc(max(12px,env(safe-area-inset-left)) + var(--bz-lead,0px));top:max(10px,env(safe-area-inset-top));width:40px;height:40px;min-height:0}.embed .fs,.demo .fs{display:none}
.bz.full{position:fixed;z-index:2147483000}
/* PAUSE: always on the top-left key row, away from the stick (left drag) and the fire pad (bottom right). */
.bui .pz{position:absolute;z-index:3;left:calc(max(12px,env(safe-area-inset-left)) + var(--bz-lead,0px) + 48px);top:max(10px,env(safe-area-inset-top));display:inline-flex;align-items:center;gap:6px;height:40px;min-height:0;padding:0 12px}.demo .pz,.pre .pz{display:none}
.pz svg{width:18px;height:18px;stroke:currentColor;stroke-width:3.2;fill:none}
.ov.pause .bui-overlay-keys{flex-wrap:wrap;justify-content:center;width:min(640px,calc(100% - 24px));bottom:max(20px,env(safe-area-inset-bottom))}
.bui .ov [data-resume]{width:168px;height:96px}.bui .ov [data-resume] b{font-size:13px}
.ov .by,.ov .pzl{flex-basis:100%;margin:0;text-align:center;font-size:10px;letter-spacing:.14em;color:#f6f3ff}.ov .by :is(a,button){display:inline-block;padding:8px 2px;font:inherit;letter-spacing:inherit;color:var(--k-sys);background:none;border:0;cursor:pointer;text-decoration:underline}.ov .pzl{font-size:12px;color:var(--k-sys)}
.ov .table{position:absolute;left:50%;top:56%;translate:-50% -50%}.ov.result .bui-sticker{top:26%}
@media (pointer:coarse){.pz span{display:none}.bui :is(.fs,.pz){width:44px;height:44px;padding:0;justify-content:center}.bui .pz{left:calc(max(12px,env(safe-area-inset-left)) + var(--bz-lead,0px) + 52px)}.pz svg{width:22px;height:22px}}
@media (max-height:460px){.ov .table{top:57%;gap:2px;padding:6px 12px;font-size:10px}.ov .table div:nth-child(n+4):not(.you){display:none}.ov.result .bui-sticker{top:22%}}
.pre .hud,.pre .pad,.pre .help,.pre .feed,.aiming .help{display:none}
@media (max-height:460px){.bui .legend{display:none}.over.intro{padding-top:0}}
@media (max-height:460px){.over{gap:24px}.bui .modes{margin-top:4px}.sticker b{font-size:34px}.sticker .ic{width:44px;height:44px}}
.table{display:grid;gap:4px;min-width:240px;padding:12px 16px;color:var(--ink);background:var(--surface);border:2px solid var(--line);border-radius:12px;box-shadow:0 5px 0 var(--rim)}
.table div{display:flex;justify-content:space-between;gap:20px}.table .you{color:var(--team)}.bui[data-theme=light] .table .you{color:#0a8a55}
.row{display:flex;gap:16px}
.count{font:900 96px/1 ui-monospace,monospace;color:var(--ink);text-shadow:0 0 30px var(--k-sys);animation:bui-slam .5s both}
.legend{position:absolute;top:max(12px,env(safe-area-inset-top));left:50%;translate:-50% 0;display:flex;flex-wrap:wrap;justify-content:center;gap:4px 18px;width:max-content;max-width:calc(100% - 128px);padding:8px 16px;font-size:11px;color:var(--muted);background:color-mix(in srgb,var(--surface) 93%,transparent);border:2px solid var(--line);border-radius:10px;box-shadow:0 4px 0 var(--rim)}
.legend b{color:var(--ink)}
@media (max-width:620px){.pad{scale:.82}.hud{gap:10px;padding:6px 10px}.hud .lead{display:none}.help{display:none}
/* Narrow: the scoreboard sits under the key row (exit · full screen · pause), never over it. */
.hud{top:max(62px,calc(env(safe-area-inset-top) + 52px))}.feed{top:max(122px,calc(env(safe-area-inset-top) + 112px))}.banner{top:max(132px,calc(env(safe-area-inset-top) + 122px))}.coach{top:max(118px,calc(env(safe-area-inset-top) + 108px))}}
@media (pointer:fine){.touch-only{display:none}}@media (pointer:coarse){.fine-only,.bui .rk kbd{display:none}}
@media (prefers-reduced-motion:reduce){.sticker,.count,.tip{animation:none}}
.stk{display:none}
@media ${PHONE}{.stk{position:absolute;left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));display:block;width:116px;height:116px;border:2.5px solid var(--line);border-radius:50%;background:color-mix(in srgb,var(--surface) 55%,transparent);touch-action:none}
.stk::before{content:"";position:absolute;inset:-28px;border-radius:50%}
.stk i{position:absolute;left:31px;top:31px;width:50px;height:50px;background:var(--team);border:2.5px solid var(--rim);border-radius:50%;box-shadow:0 4px 0 var(--rim)}
.pre .stk,.demo .stk,.bui .pad .grab{display:none}.bui :is(.auto,.lock){bottom:106px;width:56px;height:56px}.bui :is(.long,.strike){bottom:166px}.hud{translate:-50% 0!important;cursor:default;background:color-mix(in srgb,var(--surface) 80%,transparent)}.pad{translate:none!important}
.feed{left:50%;right:auto;translate:-50% 0;justify-items:center}.feed li:nth-child(n+3){display:none}}
.noauto .bui :is(.auto,.lock),.bui.noauto :is(.auto,.lock){display:none}`;

export function createBlitz(host: HTMLElement, o: BlitzOptions = {}) {
  const net = o.net ?? null, P = net ? net.players : 0;
  const mode = net ? "board" : o.mode ?? "board", embed = mode === "embed", demo = !net && !!o.demo;
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = __KIT_CSS__ + CSS;
  const wrap = document.createElement("div");
  wrap.className = `bui bz ${mode}${demo ? " demo" : ""}${o.net ? " net" : ""}`;
  wrap.dataset.theme = "dark";
  wrap.innerHTML = `<canvas></canvas>
<div class="hud"><div class="k"><small>KILLS</small><b data-k>0</b></div><div class="t"><small>${embed ? "RANK" : "TIME"}</small><b data-t>3:00</b></div><div class="hp"><small>ARMOR</small><i><u data-hp></u></i></div><div class="st"><small>STREAK</small><b data-st>0</b></div><div class="tm"><small>TEAM</small><b data-tm>0</b></div><div class="lead"><small>LEADER</small><b data-lead>—</b></div></div>
<ol class="feed"><li></li><li></li><li></li><li></li></ol>
<div class="banner" data-banner><b></b><span></span></div>
<div class="tip" data-tip hidden>AIRSTRIKE · <span class="fine-only">CLICK</span><span class="touch-only">TAP</span> WHERE THE BOMBS GO</div>
<button class="bui-icon-key fs" type="button" data-fs aria-label="Full screen" title="Full screen">${svg("full")}</button>
<button class="bui-arcade bui-flag pz" type="button" data-pause aria-label="Pause (Esc or P)" title="Esc · P · Pause">${svg("pause")}<span>PAUSE</span></button>
<div class="stk" data-stk aria-hidden="true"><i></i></div>
<div class="pad" data-pad>
<button class="bui-grip grab" type="button" data-grab aria-label="Move the controls: drag (double-click puts them back)" title="Drag to move · double-click to reset"></button>
<button class="rk bui-arcade bui-aim auto" type="button" data-k="auto" aria-pressed="false" aria-label="Auto-aim at the nearest tank (Q)" title="Q · Auto-aim">${svg("auto")}<small>AUTO</small><kbd>Q</kbd></button>
<button class="rk bui-arcade bui-aim lock" type="button" data-k="lock" aria-pressed="false" aria-label="Aim lock: stick to one target, tap a tank to switch (T)" title="T · Aim lock">${svg("lock")}<small>LOCK</small><kbd>T</kbd></button>
<button class="rk bui-arcade bui-attack strike" type="button" data-k="strike" aria-pressed="false" aria-label="Airstrike: then tap where the bombs go (F)" title="F · Airstrike">${svg("strike")}<small>STRIKE</small><span class="n" data-n="strike">1</span><kbd>F</kbd></button>
<button class="rk bui-arcade long" type="button" data-k="long" aria-label="Long shot: locks on and hits from across the field (E)" title="E · Long shot">${svg("long")}<small>LONG</small><span class="n" data-n="long">3</span><kbd>E</kbd></button>
<button class="rk bui-arcade bui-fire fire" type="button" data-k="fire" aria-label="Hold to fire the cannon (Space)" title="Space · Fire">${svg("fire")}<kbd>SPACE</kbd></button>
</div>
<div class="help fine-only">WASD DRIVE · MOUSE AIM · CLICK FIRE · E LONG SHOT · F AIRSTRIKE · Q AUTO · T LOCK${embed ? " · ESC CLOSE" : " · ESC/P PAUSE"}</div>
<div class="coach" data-coach hidden><span data-cs>1/8</span><b data-ct></b><small data-cm></small><div class="cx"><button class="bui-key" type="button" data-tune aria-expanded="false" aria-controls="bz-tune" title="Intensity levers: game speed, tank speed, fire rate…">${svg("tune")}TUNE</button><button class="bui-arcade bui-attack" type="button" data-cx>END PRACTICE</button></div></div>
<section class="tune bui-card" id="bz-tune" data-tune-panel hidden aria-labelledby="bz-tune-t"><header><b id="bz-tune-t">TUNE</b><small>PACE &amp; CHAOS · THIS DEVICE</small><button class="bui-key" type="button" data-tune-x>DONE</button></header><div data-tune-rows></div><p class="note">Plays in SOLO, PLATOON and PRACTICE on this device. Online matches keep the defaults.</p><code data-tune-json></code><div class="tk"><button class="bui-key" type="button" data-tune-reset>RESET</button><button class="bui-key" type="button" data-tune-copy>COPY SETTINGS</button></div></section>
<div class="over" data-over hidden></div>
<div class="bui-overlay ov" data-ov hidden role="dialog"></div>`;
  root.append(style, wrap);
  const $ = <T extends Element>(s: string) => wrap.querySelector<T>(s)!;
  const canvas = $<HTMLCanvasElement>("canvas"), ctx = canvas.getContext("2d")!;
  const over = $<HTMLElement>("[data-over]"), tip = $<HTMLElement>("[data-tip]"), banner = $<HTMLElement>("[data-banner]");
  const keys = {
    fire: $<HTMLButtonElement>("[data-k=fire]"), long: $<HTMLButtonElement>("[data-k=long]"), strike: $<HTMLButtonElement>("[data-k=strike]"),
    auto: $<HTMLButtonElement>("[data-k=auto]"), lock: $<HTMLButtonElement>("[data-k=lock]"),
  };
  const hud = {
    k: $<HTMLElement>("[data-k]"), tm: $<HTMLElement>("[data-tm]"), t: $<HTMLElement>("[data-t]"), lead: $<HTMLElement>("[data-lead]"), st: $<HTMLElement>("[data-st]"), hp: $<HTMLElement>("[data-hp]"),
    sn: $<HTMLElement>("[data-n=strike]"), ln: $<HTMLElement>("[data-n=long]"),
  };
  const feed = [...wrap.querySelectorAll<HTMLLIElement>(".feed li")];

  if (net && o.seed === undefined) throw new Error("Blitz net play needs the room's seed");
  if (net && !lockstep) throw new Error("Blitz net play: import createBlitz from blitz-net.mjs");
  const e = createEngine({ root: wrap, seed: o.seed ?? (Math.random() * 1e9) | 0, events: 128 }); // port-check: ok setup: the seed when none is given, before any step
  const input = controls(e, {
    keys: {
      up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"], fire: ["Space"],
      long: ["KeyE", "KeyR"], strike: ["KeyF", "KeyX"], auto: ["KeyQ"], lock: ["KeyT"], pause: ["Escape", "KeyP"],
    },
    target: canvas,
    stick: "left",
  });
  const fx = effects({ cap: 700, words: WORDS, colors: FX_COLORS, scorch: 48 });
  // Effects the step asks for, played in render. fx is the screen's; its calls take up to a dozen
  // numbers, and a number passed to a call V8 doesn't inline is boxed (K4). So the step stages them in
  // FQ and queues them; render plays the queue, in order, before it draws.
  const FX_SPAWN = 0, FX_WORD = 1, FX_BLAST = 2, FXN = 12, FXCAP = 512;
  const FQ = new Float64Array(FXN - 1), fxq = new Float64Array(FXN * FXCAP);
  let fxLen = 0;
  function fxPush(op: number) {
    if (fxLen < FXCAP) {
      const at = fxLen++ * FXN;
      fxq[at] = op;
      fxq.set(FQ, at + 1);
    }
    FQ.fill(0); // unset optional arguments read as fx's defaults (rot, spin: 0)
  }
  function fxPlay() {
    for (let i = 0; i < fxLen; i++) {
      const q = i * FXN, op = fxq[q];
      if (op === FX_SPAWN) fx.spawn(fxq[q + 1]!, fxq[q + 2]!, fxq[q + 3]!, fxq[q + 4]!, fxq[q + 5]!, fxq[q + 6]!, fxq[q + 7]!, fxq[q + 8]!, fxq[q + 9]!, fxq[q + 10]!);
      else if (op === FX_WORD) fx.word(fxq[q + 1]!, fxq[q + 2]!, fxq[q + 3]!, fxq[q + 4]!, fxq[q + 5]! || 16);
      else fx.blast(fxq[q + 1]!, fxq[q + 2]!, fxq[q + 3]!, fxq[q + 4]!);
    }
    fxLen = 0;
  }
  const sfx = sound(e, { cues: { shot: "fire", boom: "boom", hit: "hit", power: "power", strike: "hurt", land: "click", lock: "click", win: "win", end: "end", ready: "ready", streak: "win", nuke: "end" } });
  const drawTank = tankSprites(document);
  // Every random number in the match comes from the engine's seeded random, so a seed replays a match.
  const R = e.random;
  // The screen's own random (the shake): the same LCG, seeded off the match's seed, drawn only by render.
  const shakeSeed = new Uint32Array([(R.state ^ 0x9e3779b9) >>> 0]);
  const shakeRandom = () => ((shakeSeed[0] = Math.imul(shakeSeed[0]!, 1664525) + 1013904223), shakeSeed[0]! / 4294967296);
  // The match's running numbers that the step writes each frame. A double stored in a closure variable
  // is a new heap number on every write; in a typed array it is stored in place.
  const G = new Float64Array(12);
  const CLK = 0, CNT = 1, MATCH = 2, TILE_IN = 3, CRATE_IN = 4, QUAKE = 5, WHITE = 6, NUKE_T = 7, MOVED = 8, COACH_T = 9, RES = 10, PZ_BY = 11;
  // Pause: resuming counts down RESUME s first (the board holds still); net play, each seat has PZ_CAP s
  // of pause a match. A net pause is bit 12 of the player's input word (PZ_BIT), so every peer pauses
  // on the same frame; pzWant is this peer's latch (local, it only feeds the next input word).
  const RESUME = 3, PZ_CAP = 45, PZ_BIT = 1 << 12, pzLeft = new Float64Array(4).fill(PZ_CAP);
  let pzWant = false;
  G[PZ_BY] = -1;
  G[CLK] = o.seconds ?? 180; // the match clock (board)
  G[TILE_IN] = 1.2; // the next power tile
  G[CRATE_IN] = 12; // the next supply crate
  const coarse = matchMedia("(pointer: coarse)"), fine = matchMedia("(pointer: fine)"), phone = matchMedia(PHONE);
  // Reduced motion: the screen never shakes (the blasts, flags and stickers already calm down).
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  let shook = 0; // the last frame's shake (px), for the tests
  // The levers (TUNE): one config layer the step reads at its seams. Board play on this device reads
  // what Practice → TUNE saved; the drop-in, the attract match and net play keep the defaults (net
  // play: the same numbers on every peer, or a desync). o.tune goes on top, in any mode.
  const TU = new Float64Array(TUNE.map((r) => r[3]));
  const tunable = !net && !embed && !demo;
  const tuneLoad = (v: unknown) => {
    if (v && typeof v === "object") for (let k = 0; k < TUNE.length; k++) { const x = (v as Record<string, unknown>)[TUNE[k]![0]]; if (x != null) TU[k] = tuneFit(k, Number(x)); }
  };
  if (tunable)
    try {
      tuneLoad(JSON.parse(localStorage.getItem("blitz:tune") ?? "null"));
    } catch {}
  tuneLoad(o.tune);
  // Net play: the mode (tanks a side, a 4-seat room the computer backfills, the 2v2 sides). P1's
  // pick rides in bits 9-11 and 13-15 of P1's input word through the countdown, so every peer builds the same
  // roster (src/seats.ts) on the same lockstep frame; nobody's seat changes.
  let squad = 0, agreed = 0, noAuto = 0; // noAuto: P1 turned auto-aim off for the match (lockstep-agreed)

  // ---------- World ----------
  let W = 0, H = 0, dpr = 1, scale = 1.4, T = 44, cols = 0, rows = 0;
  // Canvas px → arena: scale, offset x, offset y, turned (identity unless the arena is fixed: net).
  // Net play on a phone covers the screen: the arena is scaled to cover (not fit), turned 90° on a
  // portrait screen so its long side runs down the tall one, and the camera follows your tank on the
  // axis that's cropped. Drawing and input only: the match never knows (lockstep-safe).
  const view = new Float64Array([1, 0, 0, 0]);
  // Drawn as yours (ring, tag): in net play every human is a player in the match, but only one is you.
  const mine = (t: Tank) => (net ? t === you : t.you);
  const wx = (x: number, y = input.pointer.y) => (view[3] ? y - view[2]! : x - view[1]!) / view[0]!, wy = (y: number, x = input.pointer.x) => (view[3] ? H - (x - view[1]!) / view[0]! : (y - view[2]!) / view[0]!);
  /** The arena on screen (render): the view's transform, × dpr. */
  const vt = () => (view[3] ? ctx.setTransform(0, dpr * view[0]!, -dpr * view[0]!, 0, dpr * (view[1]! + H * view[0]!), dpr * view[2]!) : ctx.setTransform(dpr * view[0]!, 0, 0, dpr * view[0]!, dpr * view[1]!, dpr * view[2]!));
  /** Text and pips about (x, y) read upright on a turned view. */
  const upright = (x: number, y: number) => view[3] && (ctx.translate(x, y), ctx.rotate(-Math.PI / 2), ctx.translate(-x, -y));
  let state: "intro" | "count" | "play" | "end" | "paused" = embed || demo ? "play" : "intro";
  // Solo: every tank for itself. Platoons: teams of 4 (3 on a dropped-in page), three platoons.
  const saved = (() => {
    try {
      return localStorage.getItem("blitz:mode") ?? "";
    } catch {
      return "";
    }
  })();
  // Practice: no clock, a coach with tips, and dummies that never shoot back: three stand still
  // (TARGET), three drive about (MOVER). Rewards and streaks work as in a match.
  let platoon = !net && (o.platoons ?? saved === "platoon"), practice = !net && !embed && !demo && o.platoons === undefined && saved === "practice";
  let N = 0, tanks: Tank[] = [], you: Tank = null!;
  const per = embed ? 3 : 4;
  /** How many sides a platoon match has: three locally; in net play, one per player (2v2: two). */
  let sides = 3, S: ReturnType<typeof Seats> = null!;
  // A net side is named for the first human on it.
  const sideName = (team: number) => (net ? (team === you.team ? "YOUR" : `P${S.lead[team]! + 1}`) : PLATOON[team]!);
  function roster() {
    if (net) (S = seatMap(P, agreed, o.bots ?? 4)), (squad = S.squad), (platoon = squad > 1), (sides = S.sides);
    N = net ? S.team.length : practice ? 7 : platoon ? per * 3 : 1 + (o.bots ?? (embed ? 5 : TU[U_BOTS]!));
    tanks = Array.from({ length: N }, (_, i) => {
      const hu = net ? i < P : i === 0;
      // Net: the humans (seats 0..P-1), then the computer's tanks (src/seats.ts).
      const team = net ? S.team[i]! : platoon ? (i / per) | 0 : i;
      const slot = net ? S.slot[i]! : platoon ? i % per : 0;
      return {
        i, team, slot, you: net ? hu : i === 0 && !demo,
        name: net ? (i === net.slot ? "YOU" : hu ? `P${i + 1}` : squad ? (team === S.team[net.slot] ? WING[slot - 1]! : `P${S.lead[team]! + 1}·${WING[slot - 1]}`) : NAMES[i % NAMES.length]!) : practice ? (i === 0 ? "YOU" : i <= 3 ? `TARGET${i}` : `MOVER${i - 3}`) : platoon ? (i === 0 ? (demo ? "ACE" : "YOU") : team === 0 ? WING[slot - 1]! : `${PLATOON[team]}${slot + 1}`) : demo && i === 0 ? "ACE" : NAMES[i % NAMES.length]!,
        color: platoon ? TEAM_COLORS[team]! : COLORS[i % COLORS.length]!,
        x: 0, y: 0, a: 0, ta: 0, hp: MAXHP, alive: false, dead: platoon ? 0.2 + team * 0.45 + slot * 0.12 : 0.2 + i * 0.18, drop: 0, shield: 0, rapid: 0, triple: 0,
        strikes: hu ? 1 : 0, carpet: 0, rail: hu ? RAIL_START : 1, charge: 0, chargeT: -1, heat: 0, hot: 0,
        cool: 0, kills: 0, deaths: 0, recoil: 0, flash: 0, tread: 0, streak: 0, streakT: 0, run: 0, gx: 0, gy: 0, think: 0, target: -1, lastHit: -1,
      };
    });
    you = tanks[net ? net.slot : 0]!;
  }
  roster();
  const shells: Shell[] = Array.from({ length: 140 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, owner: 0, on: false, rail: false, tgt: -1 }));
  const tiles: Tile[] = Array.from({ length: 22 }, () => ({ c: 0, r: 0, type: 0, roll: 0, t: 0, on: false }));
  const marks: Mark[] = Array.from({ length: 8 }, () => ({ x: 0, y: 0, t: 0, max: 1, owner: 0, on: false }));
  const planes: Plane[] = Array.from({ length: 6 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, a: 0, t: 0, owner: 0, on: false }));
  const bombs: Bomb[] = Array.from({ length: 40 }, () => ({ x: 0, y: 0, wait: 0, fall: 0, owner: 0, main: false, on: false }));
  const booms: Boom[] = Array.from({ length: 48 }, () => ({ x: 0, y: 0, t: 0, p: 0, c: 0, on: false }));
  // Supply crates are @fzlt/core/rules drops: 2 at once, a 2.2 s parachute fall of 170 px, 14 s on the
  // ground (life counts from the spawn). The brick keeps where each one is, where it lands (`landY`)
  // and how old it is (`age`): the fall shadow and the blink read those, the landing puff is its
  // `drop:land` event.
  const CRATE_FALL = 170, CRATE_DROP = 2.2;
  const supply = drops(e, { kinds: ["repair", "long", "strike", "jackpot"], cap: 2, life: 14 + CRATE_DROP, fall: CRATE_FALL, speed: CRATE_FALL / CRATE_DROP });
  const blocks: Block[] = [];
  let covers: Cover[] = [], coverDirty = true, coverAt = 0;
  const anims = new Set<Animation>();
  let lightTheme = false;
  // Your controls: auto-aim (on by default on phones), aim lock and the airstrike target mode.
  let autoOn = coarse.matches, lockOn = false, lockT = -1, targeting = false;
  // Taps the step picks up: an airstrike spot, a lock target, a long shot.
  let strikeQ = false, strikeX = 0, strikeY = 0, longQ = false, strikeT = false, fireQ = false;
  // The nuke: countdown, then the flash.
  let nukeBy = -1;
  // Messages for the DOM, written in render: the kill feed ring and the streak banner.
  const feedK = new Int16Array(8), feedV = new Int16Array(8);
  let feedN = 0, feedShown = 0, bannerN = 0, bannerShown = 0, bannerRun = 0, bannerWho = 0;

  function resize() {
    const r = wrap.getBoundingClientRect();
    if (net) {
      // Lockstep: every peer plays the same arena (laid out once, from the seed), scaled to fit.
      if (!cols) (W = 1100), (H = 640), (scale = 1.45), (T = 44), (cols = 25), (rows = 14), layBlocks();
      const cw = Math.max(320, r.width), ch = Math.max(240, r.height);
      dpr = Math.min(devicePixelRatio || 1, cw < 760 ? 1.5 : 2);
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      // The arena is a little bigger than the screen on every device (owner: room to hide): scaled so
      // at least HIDE squares stay off screen on each axis, and the camera follows your tank (draw).
      // A phone (game mode) turns it when portrait, so its long side runs down the tall screen.
      const turn = (view[3] = +(phone.matches && ch > cw)), aw = turn ? H : W, ah = turn ? W : H;
      view[0] = Math.max(cw / (aw - HIDE * T), ch / (ah - HIDE * T));
      view[1] = (cw - aw * view[0]) / 2;
      view[2] = (ch - ah * view[0]) / 2;
      return;
    }
    W = Math.max(320, r.width);
    H = Math.max(240, r.height);
    dpr = Math.min(devicePixelRatio || 1, W < 760 ? 1.5 : 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    scale = W < 600 ? 1.05 : W < 1000 ? 1.25 : 1.45;
    T = W < 600 ? 36 : 44;
    cols = Math.floor(W / T);
    rows = Math.floor(H / T);
    if (!embed) layBlocks();
    coverDirty = true;
  }
  function layBlocks() {
    blocks.length = 0;
    const n = Math.round((cols * rows) / 34);
    for (let k = 0; k < n; k++) {
      const c = 1 + Math.floor(R() * (cols - 2)), r = 2 + Math.floor(R() * (rows - 3)), long = R() < 0.4;
      blocks.push({ x: c * T + 3, y: r * T + 3, w: (long ? 2 : 1) * T - 6, h: T - 6, hp: 3, back: 0 });
    }
  }
  // The step's number registers. A double passed to, or returned from, a call V8 doesn't inline is
  // boxed (a new heap number each time), so the step's hot helpers take and give their numbers here
  // (fizlet-engine lesson K4). Each helper has its own slots, so a nested call never clobbers them.
  const F = new Float64Array(21);
  const BX = 0, BY = 1, BR = 2; // blockedF: the point and the radius
  const TF = 3, TT = 4, TM = 5, TO = 6; // turnF: from, to, max turn → out
  const DX = 7, DY = 8, DT = 9; // drive: the stick and dt
  const SX = 10, SY = 11, SR = 12; // shellHits: where the shell is going, the hit radius
  const HX = 13, HY = 14, HO = 15; // hyp: dist(F[HX], F[HY]) → F[HO]
  const KX = 16, KY = 17; // callStrike: the target
  const PX = 18, PY = 19; // spawn: where the platoon drops
  const LAST = 20; // callStrike: when its last bomb lands
  function hyp() {
    F[HO] = dist(F[HX]!, F[HY]!);
  }
  /** a and b (tanks, shells) are closer than r (a constant: a literal never boxes). */
  const within = (a: { x: number; y: number }, b: { x: number; y: number }, r: number) => dist(a.x - b.x, a.y - b.y) < r;
  /** The live block that a circle at (F[BX], F[BY]) of radius F[BR] touches (@fzlt/core/collide circleRect, inline), or null. */
  function blockedF() {
    const cx = F[BX]!, cy = F[BY]!, r = F[BR]!;
    for (const b of blocks) {
      if (b.hp <= 0) continue;
      const x = b.x, y = b.y, w = b.w, h = b.h;
      const dx = cx - (cx < x ? x : cx > x + w ? x + w : cx), dy = cy - (cy < y ? y : cy > y + h ? y + h : cy);
      if (dx * dx + dy * dy < r * r) return b;
    }
    return null;
  }
  const blocked = (x: number, y: number, rad: number) => ((F[BX] = x), (F[BY] = y), (F[BR] = rad), blockedF());
  function openSpot(out: Float64Array) {
    let x = 0, y = 0;
    for (let k = 0; k < 24; k++) {
      x = 40 + R() * (W - 80);
      y = 70 + R() * (H - 130);
      if (!blocked(x, y, 22 * scale)) break;
    }
    out[0] = x;
    out[1] = y;
  }
  const spot = new Float64Array(2);

  // ---------- Page as cover (embed): measured in the read phase only when the page moved ----------
  const SEL = "h1,h2,h3,h4,p,li,img,button,blockquote,figure,pre,table,input,textarea,[role=button]";
  addEventListener("scroll", () => (coverDirty = true), { signal: e.signal, passive: true, capture: true });
  addEventListener("resize", () => (coverDirty = true), { signal: e.signal });
  function measureCovers() {
    covers = [];
    for (const el of document.querySelectorAll<HTMLElement>(SEL)) {
      if (covers.length >= 90 || el.closest("[data-fizlet-host]")) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 12 || b.height < 8 || b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue;
      covers.push({ el, x: b.left, y: b.top, w: b.width, h: b.height, busy: 0 });
    }
  }
  // A knock runs in the step (it draws engine.random), so its cool-down is on match time, not the wall clock.
  function knock(c: Cover, nx: number, ny: number, power: number, flat: boolean) {
    if (G[MATCH]! < c.busy || typeof c.el.animate !== "function") return;
    c.busy = G[MATCH]! + (flat ? 1.1 : 0.8);
    const p = Math.min(2, power), dx = nx * 18 * p, dy = ny * 14 * p - 10 * p, spin = (nx >= 0 ? 1 : -1) * (6 + R() * 10) * p;
    const a = c.el.animate(
      flat
        ? [{ transform: "none" }, { transform: "scale(1.06,.35)", offset: 0.2 }, { transform: "scale(1.06,.35)", offset: 0.6 }, { transform: "scale(.96,1.08)", offset: 0.82 }, { transform: "none" }]
        : [{ transform: "none" }, { transform: `translate(${dx}px,${dy}px) rotate(${spin}deg)`, offset: 0.3 }, { transform: `translate(${dx * 0.2}px,0) rotate(${-spin * 0.2}deg)`, offset: 0.7 }, { transform: "none" }],
      { duration: flat ? 1000 : 760, easing: "cubic-bezier(.2,.9,.3,1.2)" },
    );
    anims.add(a);
    a.onfinish = a.oncancel = () => anims.delete(a);
  }
  function knockAround(x: number, y: number, rad: number, power: number) {
    if (!embed) return;
    for (const c of covers) {
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2, d = dist(cx - x, cy - y);
      if (d < rad) knock(c, (cx - x) / (d || 1), (cy - y) / (d || 1), power * (1 - d / rad) + 0.4, false);
    }
  }

  // ---------- Spawning: everyone parachutes in ----------
  /** The spot (F[BX], F[BY]) is clear for tank t to drop on: no block within 22 × scale, no tank too close. */
  function clearFor(t: Tank) {
    const x = F[BX]!, y = F[BY]!;
    F[BR] = 22 * scale;
    if (blockedF()) return false;
    let ok = true;
    for (const o2 of tanks) if (o2 !== t && o2.alive && ((F[HX] = o2.x - x), (F[HY] = o2.y - y), hyp(), F[HO]! < (o2.team === t.team ? 44 : 160))) ok = false;
    return ok;
  }
  function spawn(t: Tank) {
    // The tries are written to F, not to locals: spawn runs a few times a second, so V8 may not
    // optimize it fully, and a number kept in a local across a loop is then a heap number per try.
    if (platoon) {
      // Platoons drop together: next to the platoon's lead tank, else at the platoon's corner.
      let anchor: Tank | null = null;
      for (const o2 of tanks) if (o2 !== t && o2.team === t.team && o2.alive && (!anchor || o2.slot < anchor.slot)) anchor = o2;
      const a = Math.PI * 0.75 + (t.team * TAU) / sides;
      F[PX] = anchor ? anchor.x : W / 2 + Math.cos(a) * W * 0.32;
      F[PY] = anchor ? anchor.y : H / 2 + Math.sin(a) * H * 0.3;
    }
    for (let k = 0; k < 24; k++) {
      if (platoon) {
        const a = R() * TAU, r = 55 + R() * 70;
        F[BX] = Math.max(40, Math.min(W - 40, F[PX]! + Math.cos(a) * r));
        F[BY] = Math.max(70, Math.min(H - 60, F[PY]! + Math.sin(a) * r));
      } else (F[BX] = 40 + R() * (W - 80)), (F[BY] = 70 + R() * (H - 130));
      if (clearFor(t)) break;
    }
    const x = F[BX]!, y = F[BY]!;
    // Field by field (an object literal for Object.assign would be a new object every respawn).
    t.x = x;
    t.y = y;
    t.a = R() * TAU;
    t.hp = MAXHP;
    t.alive = true;
    t.drop = t.shield = t.rapid = t.triple = t.recoil = t.think = 0;
    t.cool = 0.6;
    t.target = -1;
    t.gx = x;
    t.gy = y;
    t.streak = t.run = t.heat = t.hot = t.charge = 0;
    t.chargeT = -1;
    t.ta = t.a;
  }

  // ---------- Shake: only what lands near you (or hits you) moves the screen ----------
  let buzz = 0;
  /** A blast at (FQ[0], FQ[1]) of power FQ[2], tint FQ[3]: the effect (played in render), and the shake if it's near you. */
  function boomQ() {
    const x = FQ[0]!, y = FQ[1]!, power = FQ[2]!;
    fxPush(FX_BLAST);
    if (demo || !you.alive || state !== "play") return;
    const reach = 250 * (scale / 1.4), d = dist(x - you.x, y - you.y);
    if (d < reach) G[QUAKE] = Math.min(18, G[QUAKE]! + power * 3.5 * (1 - d / reach) ** 1.5);
  }

  // ---------- Combat ----------
  function freeShell() {
    for (let i = 0; i < shells.length; i++) if (!shells[i]!.on) return shells[i]!;
    return null;
  }
  function fire(t: Tank) {
    const len = 24 * scale, spreads = t.triple > 0 ? 3 : 1;
    for (let k = 0; k < spreads; k++) {
      const s = freeShell();
      if (!s) break;
      const a = t.ta + (spreads > 1 ? (k - 1) * 0.2 : 0) + (t.you ? (R() - 0.5) * 0.04 : (R() - 0.5) * 0.12);
      s.on = true;
      s.rail = false;
      s.tgt = -1;
      s.x = t.x + Math.cos(a) * len;
      s.y = t.y + Math.sin(a) * len;
      s.vx = Math.cos(a) * TU[U_SHELL]!;
      s.vy = Math.sin(a) * TU[U_SHELL]!;
      s.life = 600 / TU[U_SHELL]!; // the same reach at any speed
      s.owner = t.i;
    }
    t.recoil = 6;
    t.flash = 0.08;
    if (t.you) cShots++;
    // The cannon is quick; hold it down too long and it overheats (rapid fire never does).
    t.cool = (t.you ? (t.rapid > 0 ? 0.1 : 0.19) : t.rapid > 0 ? 0.22 : 0.5 + R() * 0.35) / TU[U_FIRE]!;
    if (t.you && t.rapid <= 0 && (t.heat += 0.16) >= 1) {
      t.hot = 1.4;
      ((FQ[0] = t.x), (FQ[1] = t.y - 34), (FQ[2] = W_HOT), (FQ[3] = 2), (FQ[4] = 16), fxPush(FX_WORD));
    }
    ((FQ[0] = 1), (FQ[1] = t.x + Math.cos(t.ta) * len), (FQ[2] = t.y + Math.sin(t.ta) * len), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 9), (FQ[6] = 0.12), (FQ[7] = 0), fxPush(FX_SPAWN));
    e.events.emit("shot", t.i);
  }
  /** Long shot: lock on for a beat (laser sight), then a guided round crosses the field. */
  function charge(t: Tank, target: number) {
    if (t.rail <= 0 || t.charge > 0 || target < 0 || !t.alive || t.drop < 1) return;
    t.charge = 0.45;
    t.chargeT = target;
    if (t.you) ((FQ[0] = tanks[target]!.x), (FQ[1] = tanks[target]!.y - 34), (FQ[2] = W_LOCK), (FQ[3] = 4), (FQ[4] = 14), fxPush(FX_WORD));
    e.events.emit("lock", t.i);
  }
  function fireRail(t: Tank) {
    const o2 = tanks[t.chargeT]!, s = freeShell();
    t.charge = 0;
    if (!s || !o2.alive) return;
    t.rail--;
    if (t.you) cRail++;
    const a = Math.atan2(o2.y - t.y, o2.x - t.x), len = 26 * scale;
    t.ta = a;
    s.on = true;
    s.rail = true;
    s.tgt = o2.i;
    s.x = t.x + Math.cos(a) * len;
    s.y = t.y + Math.sin(a) * len;
    s.vx = Math.cos(a) * 1500;
    s.vy = Math.sin(a) * 1500;
    s.life = 2;
    s.owner = t.i;
    t.recoil = 11;
    t.flash = 0.14;
    ((FQ[0] = 1), (FQ[1] = s.x), (FQ[2] = s.y), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 16), (FQ[6] = 0.16), (FQ[7] = 1), fxPush(FX_SPAWN));
    ((FQ[0] = 2), (FQ[1] = s.x), (FQ[2] = s.y), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 8), (FQ[6] = 0.3), (FQ[7] = 1), fxPush(FX_SPAWN));
    if (t.you) G[QUAKE] = Math.min(18, G[QUAKE]! + 3);
    e.events.emit("shot", t.i, 0, 0, 0, 1.5);
  }
  function kill(t: Tank, by: number, word = W_BOOM) {
    if (!t.alive) return;
    t.alive = false;
    t.dead = TU[U_RESPAWN]!;
    t.deaths++;
    t.run = 0;
    t.charge = 0;
    if (t.you) targeting = false;
    const k = by >= 0 && tanks[by]!.team !== t.team ? tanks[by]! : null;
    if (k) {
      k.kills++;
      k.run++;
      k.hp = Math.min(MAXHP, k.hp + 1); // scavenge: every kill patches you up a little
      k.streak = k.streakT > 0 ? k.streak + 1 : 1;
      k.streakT = 3;
      if (k.streak === 2) ((FQ[0] = k.x), (FQ[1] = k.y - 40), (FQ[2] = W_DOUBLE), (FQ[3] = 1), (FQ[4] = 18), fxPush(FX_WORD));
      if (k.streak >= 3) ((FQ[0] = k.x), (FQ[1] = k.y - 40), (FQ[2] = W_RAMPAGE), (FQ[3] = 3), (FQ[4] = 20), fxPush(FX_WORD));
      if (k.you) ((FQ[0] = k.x), (FQ[1] = k.y - 26), (FQ[2] = W_PLUS), (FQ[3] = 5), (FQ[4] = 18), fxPush(FX_WORD));
      reward(k);
    }
    ((FQ[0] = t.x), (FQ[1] = t.y), (FQ[2] = 2.2), (FQ[3] = 3), boomQ());
    ((FQ[0] = t.x + (R() - 0.5) * 30), (FQ[1] = t.y + (R() - 0.5) * 30), (FQ[2] = 1.2), (FQ[3] = 1), boomQ());
    for (let n = 0; n < 9; n++) {
      const a = R() * TAU, sp = 90 + R() * 140;
      ((FQ[0] = 0), (FQ[1] = t.x), (FQ[2] = t.y), (FQ[3] = Math.cos(a) * sp), (FQ[4] = Math.sin(a) * sp), (FQ[5] = (7 + R() * 7) * (scale / 1.4)), (FQ[6] = 1.1), (FQ[7] = n % 3 ? 5 : 7), (FQ[8] = R() * TAU), (FQ[9] = (R() - 0.5) * 24), fxPush(FX_SPAWN));
    }
    ((FQ[0] = t.x), (FQ[1] = t.y - 18), (FQ[2] = word === W_BOOM ? (R() * 5) | 0 : word), (FQ[3] = 3), (FQ[4] = word === W_NUKE ? 24 : 18), fxPush(FX_WORD));
    if (t.you) (G[QUAKE] = 16), (buzz += 220);
    e.events.emit("boom", t.i, by);
    feedK[feedN % 8] = k ? k.i : -1;
    feedV[feedN % 8] = t.i;
    feedN++;
  }
  /** Kill streaks pay out (kills in one life). */
  function reward(k: Tank) {
    const r = k.run;
    if (r === 2) k.rail = Math.min(RAIL_MAX, k.rail + 1);
    else if (r === 3) k.strikes = Math.min(STRIKE_MAX, k.strikes + 1);
    else if (r === 5) (k.strikes = Math.min(STRIKE_MAX, k.strikes + 1)), k.carpet++;
    else if (r === 8) nuke(k.i);
    else return;
    if (k.you || r === 8) {
      bannerRun = r;
      bannerWho = k.i;
      bannerN++;
      e.events.emit("streak", k.i);
    }
  }
  function damage(t: Tank, by: number, amount: number, word = W_BOOM) {
    if (!t.alive || t.drop < 1) return false;
    if (t.shield > 0) {
      ((FQ[0] = 2), (FQ[1] = t.x), (FQ[2] = t.y), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 18), (FQ[6] = 0.3), (FQ[7] = 4), fxPush(FX_SPAWN));
      return false;
    }
    t.hp -= amount;
    t.lastHit = by;
    if (t.you) (G[QUAKE] = Math.min(18, G[QUAKE]! + amount * 2.5)), (buzz += 35 * amount); // worse the harder you're hit
    e.events.emit("hit", t.i);
    if (t.hp <= 0) kill(t, by, word);
    return true;
  }

  // ---------- Airstrikes: a bomber crosses the field and the bombs walk over the target ----------
  /** owner calls an airstrike on (F[KX], F[KY]). */
  function callStrike(owner: number) {
    const x = F[KX]!, y = F[KY]!, t = tanks[owner]!;
    if (t.strikes <= 0 || !t.alive || t.drop < 1) return false;
    let m: Mark | null = null, p: Plane | null = null;
    for (let i = 0; i < marks.length; i++) if (!marks[i]!.on) m = marks[i]!;
    for (let i = 0; i < planes.length; i++) if (!planes[i]!.on) p = planes[i]!;
    if (!m || !p) return false;
    t.strikes--;
    if (owner === 0) cStrike++;
    const carpet = t.carpet > 0;
    if (carpet) t.carpet--;
    // The bomber comes in over the caller's shoulder.
    F[HX] = x - t.x;
    F[HY] = y - t.y;
    hyp();
    const a = F[HO]! > 40 ? Math.atan2(y - t.y, x - t.x) : R() * TAU;
    F[HX] = W;
    F[HY] = H;
    hyp();
    const ca = Math.cos(a), sa = Math.sin(a), speed = 820, reach = F[HO]! * 0.65;
    p.on = true;
    p.owner = owner;
    p.a = a;
    p.x = x - ca * reach;
    p.y = y - sa * reach;
    p.vx = ca * speed;
    p.vy = sa * speed;
    p.t = (reach * 2) / speed;
    const n = carpet ? 7 : 3, gap = (carpet ? 56 : 42) * (scale / 1.4);
    F[LAST] = 0; // when the last bomb lands
    for (let k = 0; k < n; k++) {
      let b: Bomb | null = null;
      for (let i = 0; i < bombs.length; i++) if (!bombs[i]!.on) b = bombs[i]!;
      if (!b) break;
      const off = (k - (n - 1) / 2) * gap, side = (R() - 0.5) * 26;
      b.on = true;
      b.owner = owner;
      b.main = carpet || k === (n - 1) / 2;
      b.x = x + ca * off - sa * side;
      b.y = y + sa * off + ca * side;
      b.wait = (reach + off) / speed;
      b.fall = 0.5;
      F[LAST] = Math.max(F[LAST]!, b.wait + b.fall);
    }
    m.on = true;
    m.owner = owner;
    m.x = x;
    m.y = y;
    m.t = m.max = F[LAST]! + 0.1;
    if (carpet) ((FQ[0] = x), (FQ[1] = y - 70), (FQ[2] = W_CARPET), (FQ[3] = 3), (FQ[4] = 22), fxPush(FX_WORD));
    e.events.emit("strike", owner);
    return true;
  }
  /** A follow-up blast at (FQ[0], FQ[1]), power FQ[2], tint FQ[3], FQ[4] seconds from now. */
  function laterQ() {
    for (let i = 0; i < booms.length; i++) {
      const b = booms[i]!;
      if (!b.on) {
        b.on = true;
        b.x = FQ[0]!;
        b.y = FQ[1]!;
        b.p = FQ[2]!;
        b.c = FQ[3]!;
        b.t = FQ[4]!;
        return;
      }
    }
  }
  function detonate(b: Bomb) {
    // The Battlefield hero's airstrike: one big blast, two more a beat later, black scorch.
    const p = b.main ? 3.2 : 2.4;
    ((FQ[0] = b.x), (FQ[1] = b.y), (FQ[2] = p), (FQ[3] = 3), boomQ());
    ((FQ[0] = b.x + (R() - 0.5) * 60), (FQ[1] = b.y + (R() - 0.5) * 48), (FQ[2] = 1.6), (FQ[3] = 1), (FQ[4] = 0.09), laterQ());
    ((FQ[0] = b.x + (R() - 0.5) * 60), (FQ[1] = b.y + (R() - 0.5) * 48), (FQ[2] = 1.3), (FQ[3] = 4), (FQ[4] = 0.19), laterQ());
    if (b.main && R() < 0.6) ((FQ[0] = b.x), (FQ[1] = b.y - 30), (FQ[2] = W_STRIKE), (FQ[3] = 3), (FQ[4] = 22), fxPush(FX_WORD));
    const rad = (b.main ? 95 : 80) * (scale / 1.4);
    // Index loops and F, not for-of and locals: a rare function may run unoptimized-ish (Maglev), where both allocate.
    for (let i = 0; i < tanks.length; i++) {
      const t = tanks[i]!;
      if (t.team === tanks[b.owner]!.team) continue;
      F[HX] = t.x - b.x;
      F[HY] = t.y - b.y;
      hyp();
      if (F[HO]! < rad) damage(t, b.owner, F[HO]! < rad * 0.6 ? MAXHP : 3, W_STRIKE);
    }
    for (let i = 0; i < blocks.length; i++) {
      const k = blocks[i]!;
      if (k.hp > 0 && ((F[HX] = k.x + k.w / 2 - b.x), (F[HY] = k.y + k.h / 2 - b.y), hyp(), F[HO]! < rad + 20)) wreckBlock(k);
    }
    if (embed) knockAround(b.x, b.y, rad * 2, 2.4);
    e.events.emit("boom", -1, 0, 0, 0, 1.4);
  }
  function nuke(owner: number) {
    if (G[NUKE_T]! > 0) return;
    G[NUKE_T] = 2.6;
    nukeBy = owner;
    e.events.emit("nuke", owner);
  }
  function nukeGoesOff() {
    G[WHITE] = 1;
    for (const t of tanks) if (t.team !== tanks[nukeBy]!.team && t.alive && t.drop >= 1) (t.shield = 0), kill(t, nukeBy, W_NUKE);
    for (const b of blocks) if (b.hp > 0) wreckBlock(b);
    for (let k = 0; k < 9; k++) ((FQ[0] = 40 + R() * (W - 80)), (FQ[1] = 70 + R() * (H - 120)), (FQ[2] = 2.4 + R() * 1.6), (FQ[3] = (k % 4) + 1), (FQ[4] = k * 0.08), laterQ());
    if (embed) knockAround(W / 2, H / 2, Math.max(W, H), 2.6);
    if (!demo) G[QUAKE] = 18;
  }
  function wreckBlock(b: Block) {
    b.hp = 0;
    b.back = 12;
    for (let n = 0; n < 8; n++) {
      const a = R() * TAU, sp = 60 + R() * 140;
      ((FQ[0] = 0), (FQ[1] = b.x + b.w / 2), (FQ[2] = b.y + b.h / 2), (FQ[3] = Math.cos(a) * sp), (FQ[4] = Math.sin(a) * sp), (FQ[5] = 6 + R() * 6), (FQ[6] = 0.8), (FQ[7] = 6), (FQ[8] = R() * TAU), (FQ[9] = (R() - 0.5) * 18), fxPush(FX_SPAWN));
    }
  }

  // ---------- Power tiles (the blinking grid) and supply crates ----------
  function lightTile(show = false) {
    let s: Tile | null = null, n = 0;
    for (let i = 0; i < tiles.length; i++) tiles[i]!.on ? n++ : (s = tiles[i]!);
    if (!s || cols < 3 || rows < 3 || (!show && n >= 8)) return;
    s.on = true;
    s.c = 1 + Math.floor(R() * (cols - 2));
    s.r = 1 + Math.floor(R() * (rows - 2));
    const roll = R();
    s.type = roll < 0.15 ? RAPID : roll < 0.27 ? TRIPLE : roll < 0.39 ? STRIKE : roll < 0.5 ? SHIELD : roll < 0.7 ? HEAL : roll < 0.84 ? AMMO : MINE;
    s.roll = show ? 0.5 + R() * 0.5 : 1.1; // slot-machine colours first, then it settles
    s.t = show ? 1.2 + R() * 1.4 : 7.5;
  }
  function takeTile(s: Tile, t: Tank) {
    s.on = false;
    if (t.you) cTile++;
    const cx = (s.c + 0.5) * T, cy = (s.r + 0.5) * T;
    if (s.type === MINE) {
      ((FQ[0] = cx), (FQ[1] = cy), (FQ[2] = 2.6), (FQ[3] = 3), boomQ());
      ((FQ[0] = cx), (FQ[1] = cy - 26), (FQ[2] = W_MINE), (FQ[3] = 3), (FQ[4] = 20), fxPush(FX_WORD));
      for (const o2 of tanks) if (dist(o2.x - cx, o2.y - cy) < 80 * (scale / 1.4)) damage(o2, -1, 3);
      e.events.emit("boom", -1);
      return;
    }
    if (s.type === RAPID) (t.rapid = 8), (t.hot = 0), (t.heat = 0);
    if (s.type === TRIPLE) t.triple = 8;
    if (s.type === SHIELD) t.shield = 6;
    if (s.type === STRIKE) t.strikes = Math.min(STRIKE_MAX, t.strikes + 1);
    if (s.type === HEAL) t.hp = Math.min(MAXHP, t.hp + 2);
    if (s.type === AMMO) t.rail = Math.min(RAIL_MAX, t.rail + 1);
    ((FQ[0] = 2), (FQ[1] = cx), (FQ[2] = cy), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 20), (FQ[6] = 0.5), (FQ[7] = s.type === STRIKE ? 3 : s.type === AMMO ? 1 : 5), fxPush(FX_SPAWN));
    ((FQ[0] = cx), (FQ[1] = cy - 22), (FQ[2] = TILE_WORD[s.type]!), (FQ[3] = s.type === STRIKE ? 3 : s.type === AMMO ? 1 : 5), (FQ[4] = 15), fxPush(FX_WORD));
    e.events.emit("power", t.i);
  }
  function dropCrate() {
    if (supply.count === 2) return;
    openSpot(spot);
    const x = spot[0]!, y = spot[1]!, r = R(), kind = r < 0.38 ? 0 : r < 0.66 ? 1 : r < 0.9 ? 2 : 3;
    supply.spawn(x, y, kind);
    ((FQ[0] = x), (FQ[1] = y - 130), (FQ[2] = W_SUPPLY), (FQ[3] = 1), (FQ[4] = 18), fxPush(FX_WORD));
    feedK[feedN % 8] = -2;
    feedV[feedN % 8] = kind;
    feedN++;
    e.events.emit("ready", -1);
  }
  /** Tank t drives over landed crate i: take it (the brick removes it). */
  function takeCrate(i: number, t: Tank) {
    const x = supply.x[i]!, y = supply.y[i]!, kind = supply.kind[i]!;
    supply.collect(x, y, 0.5);
    const c = { x, y, kind };
    if (t.you) cCrate++;
    if (c.kind === 0 || c.kind === 3) (t.hp = MAXHP), (t.shield = Math.max(t.shield, 2));
    if (c.kind === 1) t.rail = Math.min(RAIL_MAX, t.rail + 2);
    if (c.kind === 2 || c.kind === 3) t.strikes = Math.min(STRIKE_MAX, t.strikes + 1);
    if (c.kind === 3) t.rail = Math.min(RAIL_MAX, t.rail + 1);
    ((FQ[0] = 2), (FQ[1] = c.x), (FQ[2] = c.y), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 26), (FQ[6] = 0.6), (FQ[7] = 1), fxPush(FX_SPAWN));
    for (let n = 0; n < 8; n++) {
      const a = R() * TAU, sp = 80 + R() * 120;
      ((FQ[0] = 0), (FQ[1] = c.x), (FQ[2] = c.y), (FQ[3] = Math.cos(a) * sp), (FQ[4] = Math.sin(a) * sp), (FQ[5] = 5 + R() * 4), (FQ[6] = 0.7), (FQ[7] = 1 + (n % 2) * 4), (FQ[8] = R() * TAU), (FQ[9] = (R() - 0.5) * 16), fxPush(FX_SPAWN));
    }
    ((FQ[0] = c.x), (FQ[1] = c.y - 26), (FQ[2] = CRATE_WORD[c.kind]!), (FQ[3] = 1), (FQ[4] = 18), fxPush(FX_WORD));
    e.events.emit("power", t.i);
  }

  // ---------- The simulation ----------
  const live = (k: number) => k >= 0 && tanks[k]!.alive && tanks[k]!.drop >= 1;
  const nearestEnemy = (t: Tank, range: number) => {
    let best = -1, bd = range;
    for (let i = 0; i < tanks.length; i++) {
      const o2 = tanks[i]!;
      if (o2.team === t.team || !o2.alive || o2.drop < 1) continue;
      F[HX] = o2.x - t.x;
      F[HY] = o2.y - t.y;
      hyp();
      const d = F[HO]!;
      if (d < bd) (bd = d), (best = o2.i);
    }
    return best;
  };
  /** The enemy (of `team`) closest to a point (a tap, the mouse, a tank to protect). */
  const nearestTo = (x: number, y: number, range: number, team: number) => {
    let best = -1, bd = range;
    for (let i = 0; i < tanks.length; i++) {
      const o2 = tanks[i]!;
      if (o2.team === team || !o2.alive || o2.drop < 1) continue;
      F[HX] = o2.x - x;
      F[HY] = o2.y - y;
      hyp();
      const d = F[HO]!;
      if (d < bd) (bd = d), (best = o2.i);
    }
    return best;
  };
  /** Turn F[TF] toward F[TT] by at most F[TM]: the result in F[TO]. */
  function turnF() {
    const from = F[TF]!, to = F[TT]!, max = F[TM]!, d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    F[TO] = from + Math.sign(d) * Math.min(Math.abs(d), max);
  }
  const turn = (from: number, to: number, max: number) => ((F[TF] = from), (F[TT] = to), (F[TM] = max), turnF(), F[TO]!);
  /** The hull toward t.a's target angle at most `max`; the turret (ta) the same. */
  const hullTo = (t: Tank) => (turnF(), (t.a = F[TO]!));
  const turretTo = (t: Tank) => (turnF(), (t.ta = F[TO]!));
  /** Drive tank t by the stick (F[DX], F[DY]) for F[DT] seconds. */
  function drive(t: Tank) {
    const ax = F[DX]!, ay = F[DY]!, dt = F[DT]!;
    F[HX] = ax;
    F[HY] = ay;
    hyp();
    const m = Math.min(1, F[HO]!);
    if (m < 0.05) return;
    F[TF] = t.a;
    F[TT] = Math.atan2(ay, ax);
    F[TM] = 7 * dt;
    hullTo(t);
    const sp = TU[U_TANK]! * m * (scale / 1.4) * dt, nx = t.x + Math.cos(t.a) * sp, ny = t.y + Math.sin(t.a) * sp, rad = 14 * scale;
    F[BX] = nx;
    F[BY] = t.y;
    F[BR] = rad;
    if (!blockedF()) t.x = nx;
    F[BX] = t.x;
    F[BY] = ny;
    F[BR] = rad;
    if (!blockedF()) t.y = ny;
    t.tread += sp * 0.15;
    if (t.you) G[MOVED]! += sp;
  }
  /** A platoon's lead tank: you for yours, else its lowest-numbered tank on the ground. */
  function leaderOf(t: Tank) {
    let l: Tank | null = null;
    for (const o2 of tanks) if (o2.team === t.team && o2.alive && o2.drop >= 1 && (!l || o2.slot < l.slot)) l = o2;
    return l;
  }
  /** Wingmen: hold a slot behind the leader, cover them (shoot whoever hit them), keep up. */
  function follow(t: Tank, lead: Tank, dt: number) {
    t.think -= dt;
    if (t.think <= 0) {
      t.think = 0.35 + R() * 0.4;
      const h = lead.lastHit;
      t.target = live(h) && tanks[h]!.team !== t.team && within(tanks[h]!, lead, 560) ? h : nearestTo(lead.x, lead.y, 420, t.team);
      if (t.target < 0) t.target = nearestEnemy(t, 360);
      if (t.target >= 0) {
        const o2 = tanks[t.target]!;
        F[HX] = o2.x - t.x;
        F[HY] = o2.y - t.y;
        hyp();
        const d = F[HO]!;
        if (t.strikes > 0 && R() < 0.2 * TU[U_AIR]!) ((F[KX] = o2.x), (F[KY] = o2.y), callStrike(t.i));
        else if (t.rail > 0 && d > 380 && R() < 0.3) charge(t, o2.i);
      }
    }
    // The slot: fanned out behind the leader.
    const back = lead.a + Math.PI, off = t.slot === 1 ? 0.85 : t.slot === 2 ? -0.85 : 0, r = (t.slot === 3 ? 78 : 58) * scale;
    let gx = lead.x + Math.cos(back + off) * r, gy = lead.y + Math.sin(back + off) * r;
    const o2 = t.target >= 0 ? tanks[t.target]! : null;
    if (o2 && within(o2, lead, 300)) (gx += (o2.x - gx) * 0.25), (gy += (o2.y - gy) * 0.25); // step up between the leader and the threat
    if (t.hp <= 2)
      for (const s of tiles)
        if (s.on && s.roll <= 0 && s.type === HEAL && ((F[HX] = (s.c + 0.5) * T - t.x), (F[HY] = (s.r + 0.5) * T - t.y), hyp(), F[HO]! < 220)) (gx = (s.c + 0.5) * T), (gy = (s.r + 0.5) * T);
    gx = Math.max(30, Math.min(W - 30, gx));
    gy = Math.max(60, Math.min(H - 30, gy));
    const dx = gx - t.x, dy = gy - t.y;
    F[HX] = dx;
    F[HY] = dy;
    hyp();
    const d = F[HO]!;
    if (d > 14) (F[DX] = dx / d), (F[DY] = dy / d), (F[DT] = dt * (d > 140 ? 1.05 : 0.8)), drive(t);
    gun(t, dt);
  }
  function bot(t: Tank, dt: number) {
    if (practice) {
      // Practice dummies: TARGETs stand still, MOVERs roll about. Nobody shoots.
      if (t.i <= 3) return void ((F[TF] = t.ta), (F[TT] = t.a + Math.sin(e.time / 0.9 + t.i)), (F[TM] = 1.5 * dt), turretTo(t));
      if ((t.think -= dt) <= 0) (t.think = 2 + R() * 2), (t.gx = 60 + R() * (W - 120)), (t.gy = 90 + R() * (H - 160));
      const dx = t.gx - t.x, dy = t.gy - t.y;
      F[HX] = dx;
      F[HY] = dy;
      hyp();
      const d = F[HO]!;
      if (d > 16) (F[DX] = dx / d), (F[DY] = dy / d), (F[DT] = dt * 0.55), drive(t);
      (F[TF] = t.ta), (F[TT] = t.a), (F[TM] = 3 * dt), turretTo(t);
      return;
    }
    if (platoon) {
      const lead = leaderOf(t);
      if (lead && lead !== t) return follow(t, lead, dt);
    }
    t.think -= dt;
    if (t.think <= 0) {
      t.think = 0.7 + R() * 0.9;
      t.target = nearestEnemy(t, 9999);
      // Hurt bots go for health; everyone likes a supply crate.
      let gx = -1, gy = 0;
      for (let i = 0; i < supply.count; i++) if (supply.landed(i) && ((F[HX] = supply.x[i]! - t.x), (F[HY] = supply.y[i]! - t.y), hyp(), F[HO]! < 520) && R() < 0.6) (gx = supply.x[i]!), (gy = supply.y[i]!);
      if (gx < 0)
        for (const s of tiles) {
          if (!s.on || s.roll > 0 || s.type === MINE) continue;
          const sx = (s.c + 0.5) * T, sy = (s.r + 0.5) * T;
          F[HX] = sx - t.x;
          F[HY] = sy - t.y;
          hyp();
          const d = F[HO]!;
          if (d < 380 && (s.type === HEAL ? t.hp <= 3 || R() < 0.3 : R() < 0.45)) (gx = sx), (gy = sy);
        }
      if (gx >= 0) (t.gx = gx), (t.gy = gy);
      else if (t.target >= 0) {
        const o2 = tanks[t.target]!, a = Math.atan2(t.y - o2.y, t.x - o2.x) + (R() - 0.5) * 1.6, keep = 120 + R() * 120;
        t.gx = Math.max(30, Math.min(W - 30, o2.x + Math.cos(a) * keep));
        t.gy = Math.max(60, Math.min(H - 30, o2.y + Math.sin(a) * keep));
      } else (t.gx = 40 + R() * (W - 80)), (t.gy = 70 + R() * (H - 120));
      if (t.target >= 0) {
        const o2 = tanks[t.target]!;
        F[HX] = o2.x - t.x;
        F[HY] = o2.y - t.y;
        hyp();
        const d = F[HO]!;
        if (t.strikes > 0 && R() < 0.35 * TU[U_AIR]!) ((F[KX] = o2.x), (F[KY] = o2.y), callStrike(t.i));
        else if (t.rail > 0 && d > 380 && R() < 0.4) charge(t, o2.i);
      }
    }
    const dx = t.gx - t.x, dy = t.gy - t.y;
    F[HX] = dx;
    F[HY] = dy;
    hyp();
    const d = F[HO]!;
    if (d > 16) {
      const before = t.x + t.y;
      (F[DX] = dx / d), (F[DY] = dy / d), (F[DT] = dt * 0.85), drive(t);
      if (Math.abs(t.x + t.y - before) < 0.01) t.think = Math.min(t.think, 0.05); // stuck: rethink
    }
    gun(t, dt);
  }
  /** Bots' turret: track the target, fire when lined up and in range. */
  function gun(t: Tank, dt: number) {
    const o2 = t.target >= 0 ? tanks[t.target]! : null;
    if (o2 && o2.alive && o2.drop >= 1) {
      const aim = Math.atan2(o2.y - t.y, o2.x - t.x);
      (F[TF] = t.ta), (F[TT] = aim), (F[TM] = 4.5 * TU[U_TURN]! * dt), turretTo(t);
      const err = Math.abs(Math.atan2(Math.sin(aim - t.ta), Math.cos(aim - t.ta)));
      if (t.cool <= 0 && t.charge <= 0 && err < 0.12 && within(o2, t, 460)) fire(t);
    } else (F[TF] = t.ta), (F[TT] = t.a), (F[TM] = 3 * TU[U_TURN]! * dt), turretTo(t);
  }
  /** What your turret is on: the lock, else auto-aim's pick, else nothing (-1). */
  function aimTarget() {
    if (lockOn) {
      if (!live(lockT)) lockT = nearestEnemy(you, 9999);
      if (lockT >= 0) return lockT;
    }
    return autoOn ? nearestEnemy(you, 520) : -1;
  }
  function player(dt: number) {
    const t = you;
    (F[DX] = input.axis("left", "right", 0)), (F[DY] = input.axis("up", "down", 1)), (F[DT] = dt), drive(t);
    const touch = input.stick.active || coarse.matches, aim = aimTarget();
    if (aim >= 0) {
      const o2 = tanks[aim]!;
      (F[TF] = t.ta), (F[TT] = Math.atan2(o2.y - t.y, o2.x - t.x)), (F[TM] = 8 * TU[U_TURN]! * dt), turretTo(t);
    } else if (!touch || input.pointer.down) (F[TF] = t.ta), (F[TT] = Math.atan2(input.pointer.y - t.y, input.pointer.x - t.x)), (F[TM] = 10 * TU[U_TURN]! * dt), turretTo(t);
    else (F[TF] = t.ta), (F[TT] = t.a), (F[TM] = 4 * TU[U_TURN]! * dt), turretTo(t);
    if ((input.down("fire") || input.pointer.down || fireQ) && !targeting && t.cool <= 0 && t.hot <= 0 && t.charge <= 0) fire(t);
    if (t.cool <= 0) fireQ = false; // a quick tap on FIRE always gets its shot
    if (longQ) {
      longQ = false;
      const k = aim >= 0 ? aim : touch ? nearestEnemy(t, 9999) : nearestTo(input.pointer.x, input.pointer.y, 9999, 0);
      charge(t, k);
    }
    if (strikeT) (strikeT = false), (targeting = !targeting && t.strikes > 0);
    if (strikeQ) {
      strikeQ = false;
      if (((F[KX] = strikeX), (F[KY] = strikeY), callStrike(0))) targeting = false;
    }
    if (t.strikes <= 0) targeting = false;
  }
  // ---------- Net play: one 32-bit input per player per frame ----------
  // Bits 0-1 drive x (1 left, 2 right), 2-3 drive y (1 up, 2 down), 4 fire, 5 long shot, 6 airstrike
  // at the pointer, 7-8 aim (0 pointer, 1 auto, 2 along the hull), 16-23 / 24-31 pointer x / y in
  // 256ths of the arena. Every peer runs the same human() on the same words.
  function human(t: Tank, b: number, dt: number) {
    const mx = b & 3, my = (b >>> 2) & 3, am = (b >>> 7) & 3, aimMode = noAuto && am === 1 ? 0 : am;
    const px = (((b >>> 16) & 255) + 0.5) * (W / 256), py = (((b >>> 24) & 255) + 0.5) * (H / 256);
    (F[DX] = mx === 1 ? -1 : mx === 2 ? 1 : 0), (F[DY] = my === 1 ? -1 : my === 2 ? 1 : 0), (F[DT] = dt), drive(t);
    const aim = aimMode === 1 ? nearestEnemy(t, 520) : -1;
    if (aim >= 0) (F[TF] = t.ta), (F[TT] = Math.atan2(tanks[aim]!.y - t.y, tanks[aim]!.x - t.x)), (F[TM] = 8 * TU[U_TURN]! * dt), turretTo(t);
    else if (aimMode === 0) (F[TF] = t.ta), (F[TT] = Math.atan2(py - t.y, px - t.x)), (F[TM] = 10 * TU[U_TURN]! * dt), turretTo(t);
    else (F[TF] = t.ta), (F[TT] = t.a), (F[TM] = 4 * TU[U_TURN]! * dt), turretTo(t);
    if (b & 16 && t.cool <= 0 && t.hot <= 0 && t.charge <= 0) fire(t);
    if (b & 32) charge(t, aim >= 0 ? aim : nearestTo(px, py, 9999, t.team));
    if (b & 64) (F[KX] = px), (F[KY] = py), callStrike(t.i);
  }
  /** This peer's controls as one input word (latched taps are spent here, once). */
  function encode() {
    let ax = input.axis("left", "right", 0), ay = input.axis("up", "down", 1);
    const touch = input.stick.active || coarse.matches;
    // A turned view: up on the screen is left in the arena, right on the screen is up.
    if (view[3]) (ay = -ax), (ax = input.axis("up", "down", 1));
    let b = (ax < -0.3 ? 1 : ax > 0.3 ? 2 : 0) | ((ay < -0.3 ? 1 : ay > 0.3 ? 2 : 0) << 2);
    if (!targeting && (input.down("fire") || input.pointer.down || fireQ)) b |= 16;
    fireQ = false;
    if (longQ) (longQ = false), (b |= 32);
    if (strikeT) (strikeT = false), (targeting = !targeting && you.strikes > 0);
    let x = wx(input.pointer.x), y = wy(input.pointer.y);
    if (strikeQ) (strikeQ = false), (targeting = false), (b |= 64), (x = wx(strikeX, strikeY)), (y = wy(strikeY, strikeX));
    if (you.strikes <= 0) targeting = false;
    b |= ((autoOn || lockOn) && !noAuto ? 1 : !touch || input.pointer.down ? 0 : 2) << 7;
    const qx = Math.max(0, Math.min(255, Math.floor((x / W) * 256))), qy = Math.max(0, Math.min(255, Math.floor((y / H) * 256)));
    return (b | (qx << 16) | (qy << 24)) >>> 0;
  }
  // A hash of the match (tanks, shells, cover, crates, clock, the random's state), compared across
  // peers every 30 frames: a desync shows up as the first frame that differs.
  const hb = new Float64Array(1), hbytes = new Uint8Array(hb.buffer), hs = new Uint32Array(1);
  function mix(v: number) {
    hb[0] = v;
    for (let i = 0; i < 8; i++) hs[0] = Math.imul(hs[0]! ^ hbytes[i]!, 16777619);
  }
  function worldHash() {
    hs[0] = 0x811c9dc5;
    mix(R.state);
    mix(G[CLK]!);
    mix(state === "play" ? 1 : state === "count" ? 2 : state === "end" ? 3 : state === "paused" ? 4 : 0);
    mix(G[RES]!), mix(G[PZ_BY]!), mix(noAuto);
    for (let s = 0; s < P; s++) mix(pzLeft[s]!);
    for (let i = 0; i < N; i++) {
      const t = tanks[i]!;
      mix(t.x), mix(t.y), mix(t.a), mix(t.ta), mix(t.hp), mix(t.alive ? 1 : 0), mix(t.drop), mix(t.kills), mix(t.deaths);
      mix(t.cool), mix(t.rail), mix(t.strikes), mix(t.charge), mix(t.heat), mix(t.shield);
    }
    for (let i = 0; i < shells.length; i++) if (shells[i]!.on) mix(shells[i]!.x), mix(shells[i]!.y);
    for (let i = 0; i < blocks.length; i++) mix(blocks[i]!.hp);
    for (let i = 0; i < supply.count; i++) mix(supply.x[i]!), mix(supply.y[i]!);
    return hs[0]! >>> 0;
  }
  // presence's step hands every player's input for the frame here, then runs world().
  let netIn: Uint32Array = new Uint32Array(Math.max(1, P));

  /** A live tank sits on block b (@fzlt/core/collide circleRect, radius 20, inline): it can't grow back yet. */
  function tankOn(b: Block) {
    const x = b.x, y = b.y, w = b.w, h = b.h;
    for (let i = 0; i < tanks.length; i++) {
      const t = tanks[i]!;
      if (!t.alive) continue;
      const cx = t.x, cy = t.y, dx = cx - (cx < x ? x : cx > x + w ? x + w : cx), dy = cy - (cy < y ? y : cy > y + h ? y + h : cy);
      if (dx * dx + dy * dy < 20 * 20) return true;
    }
    return false;
  }
  /** Shell s, going to (F[SX], F[SY]) this step, touches tank t (radius F[SR]): @fzlt/core/collide segCircle(...) >= 0, inline. */
  function shellHits(s: Shell, t: Tank) {
    const x0 = s.x, y0 = s.y, cx = t.x, cy = t.y, r = F[SR]!;
    const dx = F[SX]! - x0, dy = F[SY]! - y0, ox = x0 - cx, oy = y0 - cy;
    const a = dx * dx + dy * dy, b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - r * r;
    if (c <= 0) return true;
    if (a === 0) return false;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const u = (-b - Math.sqrt(disc)) / (2 * a);
    return u >= 0 && u <= 1;
  }

  e.add({
    read() {
      if (embed && coverDirty && performance.now() - coverAt > 120) { // port-check: ok read phase: throttles page measurement, never feeds the step
        coverDirty = false;
        coverAt = performance.now(); // port-check: ok read phase: as above
        measureCovers();
      }
      if (input.hit("pause")) {
        if (targeting) targeting = false;
        else if (!embed) togglePause();
      }
      // One-frame key edges are caught here (a frame can run no step).
      if (input.hit("long")) longQ = true;
      if (input.hit("strike")) strikeT = true;
      if (input.hit("auto") && !noAuto) autoOn = !autoOn;
      if (input.hit("lock") && !noAuto) (lockOn = !lockOn), (lockT = -1);
    },
    // Net play: presence runs world() once per lockstep frame instead.
    // The crates hold still while paused or counting back in (they used to fall through a pause).
    step: net ? undefined : (_, dt) => (state === "paused" || G[RES]! > 0 || supply.system.step!(e, dt), world(dt * TU[U_SPEED]!)),
    render() {
      fxPlay(); // what the steps asked for, in order
      // A crate that landed this frame raises a dust puff.
      for (let i = 0; i < e.events.size; i++) {
        const ev = e.events.at(i)!;
        if (ev.type === "drop:land") fx.spawn(2, ev.x, ev.y, 0, 0, 16, 0.4, 7);
      }
      hudFrame();
      draw();
      if (buzz > 0) {
        try {
          navigator.vibrate?.(Math.min(400, buzz));
        } catch {}
        buzz = 0;
      }
    },
  });
  // Crates are a @fzlt/core/rules system: in net play they move on lockstep frames too, so world()
  // steps them (first, as the engine would) and the engine doesn't; solo, the game's step does.
  e.remove(supply.system);
  // This peer's word: its mode pick in bits 9-11 and 13-15 (only P1's counts: src/seats.ts) and its
  // pause in bit 12 (PZ_BIT). Both ride in every word: the mode is read through the countdown, the
  // pause in play, and they never share a bit.
  const pick = net ? ((net.fill ? (net.squad === 2 ? 6 : 5) | (((net.sides ?? 5) & 7) << 4) : net.squad! & 7) << 9) : 0, ownInput = net?.input ?? encode;
  // Auto-aim off (P1's pick, agreed like the mode): bit 16, the pointer's lowest x bit, which no
  // one aims with before the match. Set or cleared only while this peer is at the start screen or in
  // the countdown, so the words read there (sent a few frames ahead, from the same state) carry it
  // and play keeps the full pointer.
  const NOAUTO_BIT = 0x10000, wantNoAuto = !!net?.noAuto;
  const netInput = () => {
    let w = (ownInput() | pick | (pzWant ? PZ_BIT : 0)) >>> 0;
    if (state === "intro" || state === "count") w = wantNoAuto ? (w | NOAUTO_BIT) >>> 0 : (w & ~NOAUTO_BIT) >>> 0;
    return w;
  };
  const link = net
    ? lockstep!(e, { transport: net.transport, slot: net.slot, players: P, delay: net.delay ?? 3, input: netInput, step: (_, ins) => ((netIn = ins), world(e.dt * TU[U_SPEED]!)), hash: worldHash })
    : null;

  /** One fixed step of the match. */
  function world(dt: number) {
      if (net && state !== "paused" && G[RES]! <= 0) supply.system.step!(e, dt);
      G[MATCH]! += dt;
      fx.step(dt);
      G[QUAKE] = Math.max(0, G[QUAKE]! - dt * 40);
      G[WHITE] = Math.max(0, G[WHITE]! - dt * 0.9);
      if (state === "intro" || state === "count") {
        // Net: P1's mode (the same input word on every peer, the same frame).
        if (net && (netIn[0]! & 0xee00) !== agreed) (agreed = netIn[0]! & 0xee00), roster();
        if (net && +!!(netIn[0]! & NOAUTO_BIT) !== noAuto) (noAuto = +!!(netIn[0]! & NOAUTO_BIT)), (autoOn = lockOn = false);
        // The start screen: the grid lights up with everything that can land on it.
        if ((G[TILE_IN]! -= dt) <= 0) (lightTile(true), (G[TILE_IN] = 0.08 + R() * 0.16));
        for (const s of tiles) {
          if (!s.on) continue;
          if (s.roll > 0) s.roll -= dt;
          else if ((s.t -= dt) <= 0) s.on = false;
        }
        if (state === "count" && (G[CNT]! -= dt) <= 0) {
          for (const s of tiles) s.on = false;
          G[TILE_IN] = 1.2;
          begin();
        }
        return;
      }
      if (net) netPause(dt);
      if (state !== "play") return;
      if (G[RES]! > 0) return void (G[RES]! -= dt);
      if (!embed && !demo && !practice) {
        G[CLK]! -= dt;
        if (G[CLK]! <= 0) return void end();
      }
      // Tiles blink in; crates parachute in.
      G[TILE_IN]! -= dt;
      if (G[TILE_IN]! <= 0) (lightTile(), (G[TILE_IN] = 1.4 + R() * 2));
      for (const s of tiles) {
        if (!s.on) continue;
        if (s.roll > 0) s.roll -= dt;
        else if ((s.t -= dt) <= 0) {
          s.on = false;
          if (s.type === MINE) takeTile(s, you); // a mine left alone goes off by itself
        }
      }
      // The brick moves and expires the crates (and says when one lands: render puffs its dust).
      if ((G[CRATE_IN]! -= dt) <= 0) (dropCrate(), (G[CRATE_IN] = 18 + R() * 8));
      for (const b of blocks) if (b.hp <= 0 && (b.back -= dt) <= 0 && !tankOn(b)) b.hp = 3;
      // Tanks.
      for (const t of tanks) {
        if (!t.alive) {
          if ((t.dead -= dt) <= 0) {
            spawn(t);
            if (t.you) e.events.emit("ready", 0);
          }
          continue;
        }
        if (t.drop < 1) {
          t.drop = Math.min(1, t.drop + dt / 1.5);
          if (t.drop >= 1) {
            t.shield = Math.max(t.shield, 1.2);
            ((FQ[0] = 2), (FQ[1] = t.x), (FQ[2] = t.y), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 22), (FQ[6] = 0.45), (FQ[7] = 7), fxPush(FX_SPAWN));
            for (let n = 0; n < 6; n++) ((FQ[0] = 5), (FQ[1] = t.x + (R() - 0.5) * 30), (FQ[2] = t.y + (R() - 0.5) * 20), (FQ[3] = (R() - 0.5) * 40), (FQ[4] = -10), (FQ[5] = 14), (FQ[6] = 0.9), (FQ[7] = 6), fxPush(FX_SPAWN));
            e.events.emit("land", t.i);
          }
          continue;
        }
        t.cool -= dt;
        t.shield = Math.max(0, t.shield - dt);
        t.rapid = Math.max(0, t.rapid - dt);
        t.triple = Math.max(0, t.triple - dt);
        t.streakT = Math.max(0, t.streakT - dt);
        t.recoil = Math.max(0, t.recoil - dt * 30);
        t.flash = Math.max(0, t.flash - dt);
        t.hot = Math.max(0, t.hot - dt);
        t.heat = Math.max(0, t.heat - dt * (t.hot > 0 ? 0.7 : 0.45));
        if (net) t.i < P ? human(t, netIn[t.i]!, dt) : bot(t, dt);
        else if (t.you) player(dt), practice && coachStep(dt);
        else bot(t, dt);
        // Long shot charging: the turret holds the target, then it fires.
        if (t.charge > 0) {
          if (!live(t.chargeT)) t.charge = 0;
          else {
            const o2 = tanks[t.chargeT]!;
            (F[TF] = t.ta), (F[TT] = Math.atan2(o2.y - t.y, o2.x - t.x)), (F[TM] = 14 * dt), turretTo(t);
            if ((t.charge -= dt) <= 0) fireRail(t);
          }
        }
        // Hurt tanks smoke.
        if (t.hp <= 2 && R() < dt * 7) ((FQ[0] = 5), (FQ[1] = t.x + (R() - 0.5) * 12), (FQ[2] = t.y - 6), (FQ[3] = (R() - 0.5) * 20), (FQ[4] = -30), (FQ[5] = 10 + R() * 6), (FQ[6] = 0.9), (FQ[7] = 6), fxPush(FX_SPAWN));
        t.x = Math.max(18, Math.min(W - 18, t.x));
        t.y = Math.max(54, Math.min(H - 18, t.y));
        // Tiles and crates under the tracks.
        for (const s of tiles) {
          if (!s.on || s.roll > 0) continue;
          const x0 = s.c * T, y0 = s.r * T; // @fzlt/core/collide inRect, inline
          if (t.x >= x0 && t.x <= x0 + T && t.y >= y0 && t.y <= y0 + T) takeTile(s, t);
        }
        for (let i = supply.count - 1; i >= 0; i--) if (supply.landed(i) && ((F[HX] = supply.x[i]! - t.x), (F[HY] = supply.y[i]! - t.y), hyp(), F[HO]! < 26 * scale)) takeCrate(i, t);
        // Treads flatten the page (embed).
        if (embed) for (const c of covers) if (inRect(t.x, t.y, c.x, c.y + c.h * 0.2, c.w, c.h * 0.7)) knock(c, 0, 0, 1, true);
      }
      // Tanks push apart.
      for (let i = 0; i < N; i++)
        for (let j = i + 1; j < N; j++) {
          const p = tanks[i]!, q = tanks[j]!;
          if (!p.alive || !q.alive || p.drop < 1 || q.drop < 1) continue;
          const dx = q.x - p.x, dy = q.y - p.y;
          F[HX] = dx;
          F[HY] = dy;
          hyp();
          const d = F[HO]!, min = 26 * scale;
          if (d > 0 && d < min) {
            // Practice TARGETs are immovable: whoever bumps them gets the whole push.
            const pf = practice && p.i >= 1 && p.i <= 3 ? 0 : 1, qf = practice && q.i >= 1 && q.i <= 3 ? 0 : 1, k = (min - d) / (pf + qf || 1) / d;
            (p.x -= dx * k * pf), (p.y -= dy * k * pf), (q.x += dx * k * qf), (q.y += dy * k * qf);
          }
        }
      // Shells: swept hits so fast shots never pass through. Long shots home in and punch through cover.
      for (const s of shells) {
        if (!s.on) continue;
        if (s.rail && live(s.tgt)) {
          const o2 = tanks[s.tgt]!;
          F[TF] = Math.atan2(s.vy, s.vx);
          F[TT] = Math.atan2(o2.y - s.y, o2.x - s.x);
          F[TM] = 5 * dt;
          turnF();
          const na = F[TO]!;
          F[HX] = s.vx;
          F[HY] = s.vy;
          hyp();
          const sp = F[HO]!;
          s.vx = Math.cos(na) * sp;
          s.vy = Math.sin(na) * sp;
        }
        const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
        s.life -= dt;
        let done = s.life <= 0 || nx < -20 || ny < -20 || nx > W + 20 || ny > H + 20;
        F[SX] = nx;
        F[SY] = ny;
        F[SR] = 15 * scale;
        for (const t of tanks) {
          if (done || t.team === tanks[s.owner]!.team || !t.alive || t.drop < 1) continue; // no friendly fire
          if (shellHits(s, t)) {
            done = true;
            ((FQ[0] = t.x), (FQ[1] = t.y), (FQ[2] = s.rail ? 1.8 : 1), (FQ[3] = s.rail ? 1 : 4), boomQ());
            damage(t, s.owner, s.rail ? MAXHP : 1, s.rail ? W_SNIPED : W_BOOM);
          }
        }
        const b = done ? null : ((F[BX] = nx), (F[BY] = ny), (F[BR] = 2), blockedF());
        if (b) {
          if (s.rail) wreckBlock(b), ((FQ[0] = nx), (FQ[1] = ny), (FQ[2] = 1), (FQ[3] = 1), boomQ());
          else {
            done = true;
            ((FQ[0] = nx), (FQ[1] = ny), (FQ[2] = 0.8), (FQ[3] = 2), boomQ());
            if (--b.hp <= 0) wreckBlock(b);
          }
        }
        if (!done && embed)
          for (const c of covers)
            if (inRect(nx, ny, c.x, c.y, c.w, c.h) && (s.rail || R() < 0.5)) {
              const d = dist(s.vx, s.vy) || 1;
              knock(c, s.vx / d, s.vy / d, s.rail ? 2 : 1.2, false);
              if (!s.rail) {
                done = true;
                ((FQ[0] = nx), (FQ[1] = ny), (FQ[2] = 0.9), (FQ[3] = 4), boomQ());
                break;
              }
            }
        if (done) {
          if (s.life <= 0 && !b) ((FQ[0] = 1), (FQ[1] = s.x), (FQ[2] = s.y), (FQ[3] = 0), (FQ[4] = 0), (FQ[5] = 6), (FQ[6] = 0.15), (FQ[7] = 1), fxPush(FX_SPAWN));
          s.on = false;
        } else (s.x = nx), (s.y = ny);
      }
      // Airstrikes: bombers fly, bombs drop, blasts follow up.
      for (const p of planes) if (p.on && (p.t -= dt) <= 0) p.on = false;
      for (const p of planes) if (p.on) (p.x += p.vx * dt), (p.y += p.vy * dt);
      for (const b of bombs) {
        if (!b.on) continue;
        if (b.wait > 0) b.wait -= dt;
        else if ((b.fall -= dt) <= 0) (b.on = false), detonate(b);
      }
      for (const m of marks) if (m.on && (m.t -= dt) <= 0) m.on = false;
      for (const b of booms) if (b.on && (b.t -= dt) <= 0) (b.on = false), ((FQ[0] = b.x), (FQ[1] = b.y), (FQ[2] = b.p), (FQ[3] = b.c), boomQ());
      if (G[NUKE_T]! > 0 && (G[NUKE_T]! -= dt) <= 0) nukeGoesOff();
  }

  // ---------- Taps on the field: an airstrike spot, or a new lock target ----------
  wrap.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.target !== canvas || state !== "play" || demo || !you.alive) return;
      const r = canvas.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (targeting) {
        ev.stopPropagation();
        strikeQ = true;
        strikeX = x;
        strikeY = y;
        return;
      }
      if (lockOn) {
        const k = nearestTo(wx(x, y), wy(y, x), 44 * (scale / 1.4), you.team);
        if (k >= 0 && k !== lockT) {
          ev.stopPropagation();
          lockT = k;
          fx.word(tanks[k]!.x, tanks[k]!.y - 34, W_LOCK, 4, 14);
          e.events.emit("lock", 0);
        }
      }
    },
    { capture: true, signal: e.signal },
  );

  // ---------- Practice: the coach walks you through every control, then shares tricks ----------
  const COACH: [string, string, string][] = [
    ["DRIVE", "WASD or the arrow keys. On a phone, drag on the left half of the screen.", ""],
    ["FIRE", "Click, Space, or hold FIRE. Keep holding and the ring fills: the cannon overheats.", "fire"],
    ["AUTO AIM", "Tap AUTO (Q). The turret swings onto the nearest tank by itself.", "auto"],
    ["AIM LOCK", "Tap LOCK (T). The turret sticks to one tank; tap another tank to switch.", "lock"],
    ["LONG SHOT", "Tap LONG (E). It locks on, then wrecks a tank from across the field.", "long"],
    ["AIRSTRIKE", "Tap STRIKE (F), then tap where the bombs go. They never hurt you.", "strike"],
    ["POWER TILES", "Drive over a lit square: health, ammo, rapid fire, shields. Not the blinking red one.", ""],
    ["KILL STREAK", "Wreck 3 tanks without being wrecked. 2 in a row earns a long shot, 3 an airstrike (5: carpet bomb, 8: nuke).", ""],
    ["SUPPLY CRATE", "A crate is parachuting in. Drive over it: a medkit, long ammo, an airstrike or the jackpot.", ""],
    ["YOUR KEYS", "Drag the grab bar above the keys to put them under your thumb.", "grab"],
  ];
  const TRICKS = [
    "Right-click (desktop) fires a long shot at the tank nearest the mouse.",
    "Rapid fire tiles cool the cannon: no overheating for 8 seconds.",
    "Every kill patches 1 armour. Kill streaks: 2 long shot, 3 airstrike, 5 carpet bomb, 8 nuke.",
    "Supply crates parachute in every 20 seconds or so. Race for them.",
    "Mines blink fast and red. Drive around them, or lure someone over one.",
    "In PLATOON, your three wingmen follow you and go after whoever shoots you.",
    "Esc cancels an airstrike. Double-click the grab bar to put the keys back.",
  ];
  let cCrate = 0, cStep = 0, cShots = 0, cRail = 0, cStrike = 0, cTile = 0, cDrag = 0, coachShown = -1;
  function coachStep(dt: number) {
    // Never run dry while practising.
    if (you.rail < 1) you.rail = 3;
    if (you.strikes < 1 && !targeting) you.strikes = 2;
    G[COACH_T]! += dt;
    const done = [G[MOVED]! > 220, cShots >= 6, autoOn, lockOn, cRail > 0, cStrike > 0, cTile > 0, you.run >= 3, cCrate > 0, cDrag > 0 || G[COACH_T]! > 9][cStep];
    if (cStep < COACH.length && done) {
      cStep++;
      G[COACH_T] = 0;
      e.events.emit("power", 0);
      if (COACH[cStep]?.[0] === "SUPPLY CRATE") dropCrate();
    }
    // The crate step: if the crate timed out (or someone else took it), drop another.
    if (COACH[cStep]?.[0] === "SUPPLY CRATE" && supply.count === 0) dropCrate();
  }
  function coachFrame() {
    const key = cStep < COACH.length ? cStep : COACH.length + (((G[COACH_T]! / 6) | 0) % TRICKS.length);
    if (key === coachShown) return;
    coachShown = key;
    for (const el of wrap.querySelectorAll(".coach-on")) el.classList.remove("coach-on");
    const [title, text, k] = cStep < COACH.length ? COACH[cStep]! : ["TRICK", TRICKS[key - COACH.length]!, ""];
    $<HTMLElement>("[data-cs]").textContent = cStep < COACH.length ? `${cStep + 1}/${COACH.length}` : "✓";
    $<HTMLElement>("[data-ct]").textContent = cStep < COACH.length ? title : `FREE PLAY · ${title}`;
    $<HTMLElement>("[data-cm]").textContent = text;
    if (k) wrap.querySelector(k === "grab" ? "[data-grab]" : `[data-k=${k}]`)?.classList.add("coach-on");
  }
  $<HTMLButtonElement>("[data-cx]").addEventListener("click", () => toIntro(), { signal: e.signal });
  /** Back to the start screen (End practice). */
  function toIntro() {
    closeOverlay();
    for (const t of tanks) t.alive = false;
    for (const pool of [shells, tiles, marks, planes, bombs, booms] as { on: boolean }[][]) for (const s of pool) s.on = false;
    supply.reset();
    targeting = false;
    G[NUKE_T] = G[WHITE] = G[QUAKE] = G[RES] = 0;
    fx.clear();
    roster();
    intro();
  }

  // ---------- TUNE: the intensity levers (a card from Practice's coach) ----------
  // Each slider writes one number of TU (the config the step reads), saved on this device. Practice
  // plays it live; SOLO and PLATOON read it at the next match. COPY SETTINGS puts the JSON on the
  // clipboard, to send back the numbers that feel right.
  const tunePanel = $<HTMLElement>("[data-tune-panel]"), tuneKey = $<HTMLButtonElement>("[data-tune]"), tuneJson = $<HTMLElement>("[data-tune-json]");
  const copyKey = $<HTMLButtonElement>("[data-tune-copy]");
  const tuneValues = () => Object.fromEntries(TUNE.map((r, k) => [r[0], TU[k]!])) as Record<TuneKey, number>;
  const tuneChanged = () => TUNE.reduce((n, r, k) => n + (TU[k] !== r[3] ? 1 : 0), 0);
  const tuneShow = (k: number, v: number) => `${v.toFixed(TUNE[k]![6] < 0.1 ? 2 : TUNE[k]![6] < 1 ? 1 : 0)}${TUNE[k]![7]}`;
  $<HTMLElement>("[data-tune-rows]").innerHTML = TUNE.map(
    ([id, label, hint, def, min, max, step], k) =>
      `<label class="tr"><span><b>${label}</b><output></output></span><input type="range" name="${id}" min="${min}" max="${max}" step="${step}" data-u="${k}"><small>${hint} · default ${tuneShow(k, def)}</small></label>`,
  ).join("");
  const tuneInputs = [...tunePanel.querySelectorAll<HTMLInputElement>("input")];
  function tunePaint() {
    tuneInputs.forEach((inp, k) => {
      const [, , , def, min, max] = TUNE[k]!, v = TU[k]!, row = inp.parentElement!;
      inp.value = String(v);
      inp.style.setProperty("--p", String((v - min) / (max - min)));
      inp.setAttribute("aria-valuetext", tuneShow(k, v));
      row.classList.toggle("on", v !== def);
      row.querySelector("output")!.textContent = tuneShow(k, v);
    });
    tuneJson.textContent = JSON.stringify(tuneValues());
  }
  const tuneSave = () => {
    try {
      if (tuneChanged()) localStorage.setItem("blitz:tune", JSON.stringify(tuneValues()));
      else localStorage.removeItem("blitz:tune");
    } catch {}
  };
  function tuneOpen(on: boolean) {
    if (on) tunePaint();
    tunePanel.hidden = !on;
    wrap.classList.toggle("tuning", on);
    tuneKey.setAttribute("aria-expanded", String(on));
    if (on) tuneInputs[0]!.focus({ preventScroll: true });
  }
  tunePanel.addEventListener("input", (ev) => {
    const inp = ev.target as HTMLInputElement, k = Number(inp.dataset.u);
    TU[k] = tuneFit(k, Number(inp.value));
    tuneSave();
    tunePaint();
  }, { signal: e.signal });
  // A slider takes its own arrow keys (they don't drive); Escape closes the card.
  tunePanel.addEventListener("keydown", (ev) => {
    if (ev.code === "Escape") return void (ev.stopPropagation(), tuneOpen(false), tuneKey.focus({ preventScroll: true }));
    if ((ev.target as Element).matches("input") && /^(Arrow|Home|End|Page)/.test(ev.code)) ev.stopPropagation();
  }, { signal: e.signal });
  tuneKey.addEventListener("click", () => tuneOpen(!!tunePanel.hidden), { signal: e.signal });
  $<HTMLButtonElement>("[data-tune-x]").addEventListener("click", () => (tuneOpen(false), tuneKey.focus({ preventScroll: true })), { signal: e.signal });
  $<HTMLButtonElement>("[data-tune-reset]").addEventListener("click", () => (TU.set(TUNE.map((r) => r[3])), tuneSave(), tunePaint()), { signal: e.signal });
  copyKey.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(tuneValues()));
      copyKey.textContent = "COPIED";
    } catch {
      // No clipboard (an insecure page, a denied permission): select the line so it copies by hand.
      getSelection()?.selectAllChildren(tuneJson);
      copyKey.textContent = "SELECTED · COPY IT";
    }
    setTimeout(() => (copyKey.textContent = "COPY SETTINGS"), 1800);
  }, { signal: e.signal });

  // ---------- Match flow ----------
  const kicker = () => `BATTLEFIELD · ${practice ? "PRACTICE" : platoon ? "PLATOONS" : "FREE FOR ALL"}`;
  function intro() {
    state = "intro";
    G[TILE_IN] = 0;
    wrap.classList.add("pre");
    over.hidden = false;
    over.classList.add("intro");
    over.innerHTML = `<div class="sticker">${BADGE}<span data-kick>${kicker()}</span><b>BLITZ<em>!</em></b></div>
<div class="modes bui-seg" role="group" aria-label="Mode"><button class="mode" type="button" data-mode="solo" aria-pressed="${!platoon && !practice}"><b>SOLO</b><small>every tank for itself</small></button><button class="mode" type="button" data-mode="platoon" aria-pressed="${platoon}"><b>PLATOON</b><small>you + 3 wingmen vs 2 platoons</small></button><button class="mode" type="button" data-mode="practice" aria-pressed="${practice}"><b>PRACTICE</b><small>learn the keys, with tips</small></button></div>
${tunable && tuneChanged() ? `<p class="tuned">TUNED · ${tuneChanged()} LEVER${tuneChanged() > 1 ? "S" : ""} CHANGED · PRACTICE → TUNE</p>` : ""}
<div class="legend"><span><b>FIRE</b> fast cannon (it overheats)</span><span><b>LONG</b> lock on, hit across the field</span><span><b>STRIKE</b> tap a spot, the bombs go boom</span><span><b>AUTO · LOCK</b> let the turret aim</span><span><b>STREAKS</b> 2 long · 3 strike · 5 carpet · 8 nuke</span><span><b>CRATES</b> health, ammo, strikes</span></div>
<button class="bui-sticker-key bui-call" type="button" data-go aria-label="Press start">${PLAY}<b>PRESS START</b></button>`;
    for (const b of over.querySelectorAll<HTMLButtonElement>("[data-mode]"))
      b.addEventListener("click", () => {
        platoon = b.dataset.mode === "platoon";
        practice = b.dataset.mode === "practice";
        try {
          localStorage.setItem("blitz:mode", b.dataset.mode!);
        } catch {}
        roster();
        for (const m of over.querySelectorAll("[data-mode]")) m.setAttribute("aria-pressed", String(m === b));
        over.querySelector("[data-kick]")!.textContent = kicker();
        e.events.emit("lock", 0);
      }, { signal: e.signal });
    const go = over.querySelector<HTMLButtonElement>("[data-go]")!;
    go.addEventListener("click", () => launch(go, countdown, { reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }), { signal: e.signal });
  }
  function countdown() {
    state = "count";
    over.classList.remove("intro");
    G[CNT] = 2.4;
    G[RES] = 0;
    over.hidden = false;
    over.innerHTML = `<div class="count" data-c>3</div>${net ? `<p class="vs" data-vs></p>` : ""}`;
    e.events.emit("ready", 0);
  }
  function begin() {
    state = "play";
    if (practice) (cStep = cCrate = cShots = G[MOVED] = cRail = cStrike = cTile = cDrag = G[COACH_T] = 0), (coachShown = -1);
    wrap.classList.remove("pre");
    over.hidden = true;
    over.innerHTML = "";
  }
  function standings() {
    return tanks.map((t) => ({ name: t.name, kills: t.kills, deaths: t.deaths, you: net ? t === you : t.you, team: t.team })).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }
  function end(surrendered = false) {
    state = "end";
    targeting = false;
    const st = standings();
    // Platoons: the platoon with the most kills wins; the table is the platoons, then you.
    const teams = Array.from({ length: sides }, (_, team) => ({ team, kills: 0, deaths: 0 }));
    if (platoon) for (const t of tanks) (teams[t.team]!.kills += t.kills), (teams[t.team]!.deaths += t.deaths);
    teams.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const won = !surrendered && (platoon ? teams[0]!.team === you.team : st[0]!.you);
    e.events.emit(won ? "win" : "end", 0);
    const rows = platoon
      ? teams.map((s, i) => `<div class="${s.team === you.team ? "you" : ""}"><span>${i + 1}. ${sideName(s.team)} PLATOON</span><span>${s.kills} K · ${s.deaths} D</span></div>`).join("") + `<div class="you"><span>YOU</span><span>${you.kills} K · ${you.deaths} D</span></div>`
      : st.slice(0, 5).map((s, i) => `<div class="${s.you ? "you" : ""}"><span>${i + 1}. ${s.name}</span><span>${s.kills} K · ${s.deaths} D</span></div>`).join("");
    // Kit result overlays: STAGE CLEAR when you win, INSERT COIN when you don't, WHITE FLAG when you gave up.
    overlay(
      won ? "STAGE CLEAR" : surrendered ? "WHITE FLAG" : "INSERT COIN",
      won ? (platoon ? "PLATOON WINS" : "YOU WIN") : surrendered ? "GAME OVER" : `${platoon ? sideName(teams[0]!.team) : st[0]!.name} WINS`,
      // Net play: the page decides what REMATCH and NEW ROOM do (net.again / net.leave: a new room join).
      (net ? (net.again ? `<button class="bui-sticker-key" type="button" data-again>${PLAY}<b>REMATCH</b></button>` : "") + (net.leave ? `<button class="bui-sticker-key bui-second" type="button" data-new>${PLAY}<b>NEW ROOM</b></button>` : "") : `<button class="bui-sticker-key" type="button" data-again>${PLAY}<b>REMATCH</b></button><button class="bui-sticker-key bui-second" type="button" data-new>${PLAY}<b>NEW GAME</b></button>`),
      `<div class="table">${rows}</div>`,
    );
    if (!net) {
      ov.querySelector("[data-again]")!.addEventListener("click", () => (closeOverlay(), rematch()), { signal: e.signal });
      ov.querySelector("[data-new]")!.addEventListener("click", () => (closeOverlay(), toIntro()), { signal: e.signal });
    } else {
      ov.querySelector("[data-again]")?.addEventListener("click", () => net.again!(), { signal: e.signal });
      ov.querySelector("[data-new]")?.addEventListener("click", () => net.leave!(), { signal: e.signal });
    }
    o.onEnd?.(st);
  }
  function rematch() {
    G[CLK] = o.seconds ?? 180;
    for (const t of tanks) Object.assign(t, { kills: 0, deaths: 0, alive: false, dead: platoon ? 0.2 + t.team * 0.45 + t.slot * 0.12 : 0.2 + t.i * 0.15, strikes: t.you ? 1 : 0, carpet: 0, rail: t.you ? RAIL_START : 1, run: 0 });
    for (const pool of [shells, tiles, marks, planes, bombs, booms] as { on: boolean }[][]) for (const s of pool) s.on = false;
    supply.reset();
    G[NUKE_T] = G[WHITE] = 0;
    G[CRATE_IN] = 12;
    lockT = -1;
    fx.clear();
    if (!embed) layBlocks();
    countdown();
  }
  /** The kit overlay (Board UI section 9): grey dim, a sticker that slams and presses in, two keys. */
  const ov = $<HTMLElement>("[data-ov]");
  function overlay(kick: string, word: string, keys: string, table = "") {
    ov.hidden = false;
    ov.classList.toggle("result", !!table);
    ov.setAttribute("aria-label", `${kick} ${word}`);
    ov.innerHTML = `<div class="bui-sticker"><span>${kick}</span><b>${word}</b></div>${table}<div class="bui-overlay-keys">${keys}</div>`;
    slam(ov.querySelector(".bui-sticker"));
    requestAnimationFrame(() => ov.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }));
  }
  const closeOverlay = () => ((ov.hidden = true), (ov.innerHTML = ""), ov.classList.remove("pause"));
  /** Pause: one key (PAUSE, Esc, P), and the tab going away pauses too. The overlay: RESUME (a short
   *  countdown first, so nothing hits you the moment you're back), RESTART, QUIT TO MENU, and the
   *  white flag (SURRENDER) from DOM Battlefield. Net play can't stop one screen: see netPause(). */
  // The menu's byline, with the links the hidden footer carried on a phone: PRIVACY, and COOKIE SETTINGS
  // once the page has a consent pattern (<html data-consent>; the key sends it a composed
  // "consent:open" event). No analytics here.
  const BYLINE = () => `<p class="by">BATTLEFIELD BLITZ · BY CHRIS COOLEY · <a href="https://domvirus.com/legal/privacy/">PRIVACY</a>${"consent" in document.documentElement.dataset ? ` · <button type="button" data-consent>COOKIE SETTINGS</button>` : ""}</p>`;
  ov.addEventListener("click", (ev) => (ev.target as Element).closest?.("[data-consent]") && host.dispatchEvent(new CustomEvent("consent:open", { bubbles: true, composed: true })), { signal: e.signal });
  function togglePause() {
    if (net) return void (pzWant = state === "play" || (state === "paused" && G[PZ_BY] === net.slot) ? !pzWant : pzWant);
    if (state === "play") {
      state = "paused";
      targeting = false;
      input.press("fire", false);
      overlay("BATTLE PAUSED", "PAUSED", `<button class="bui-sticker-key" type="button" data-resume>${PLAY}<b>RESUME</b></button><button class="bui-sticker-key bui-plan" type="button" data-restart>${AGAIN}<b>RESTART</b></button><button class="bui-sticker-key bui-second" type="button" data-menu>${MENU}<b>QUIT TO MENU</b></button><button class="bui-sticker-key bui-second bui-surrender" type="button" data-surrender>${FLAG}<b>SURRENDER</b></button>${BYLINE()}`);
      ov.classList.add("pause");
      ov.querySelector("[data-resume]")!.addEventListener("click", togglePause, { signal: e.signal });
      ov.querySelector("[data-restart]")!.addEventListener("click", () => (closeOverlay(), rematch()), { signal: e.signal });
      ov.querySelector("[data-menu]")!.addEventListener("click", () => toIntro(), { signal: e.signal });
      const flag = ov.querySelector<HTMLButtonElement>("[data-surrender]")!;
      flag.addEventListener("click", () => {
        if (flag.classList.contains("go")) return;
        // The white flag: cells white out, the flag waves, then it blows up and the match ends.
        flag.classList.add("go");
        e.events.emit("strike", 0);
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        setTimeout(() => launch(flag, () => (practice ? (closeOverlay(), toIntro()) : end(true)), { reduced }), reduced ? 0 : 480);
      }, { signal: e.signal });
    } else if (state === "paused") (closeOverlay(), (state = "play"), (G[RES] = RESUME));
  }
  /** Net play: a pause is bit 12 of a player's input word, so every peer pauses on the same frame and
   *  the lockstep keeps ticking (inputs only, nothing frozen on one screen). Every screen shows who
   *  paused. Each seat has PZ_CAP s of pause a match; letting go, or running out, resumes everyone
   *  after the same countdown. */
  function netPause(dt: number) {
    if (state !== "play" && state !== "paused") return;
    if (state === "paused") pzLeft[G[PZ_BY]!]! -= dt;
    let by = -1;
    for (let s = 0; s < P && by < 0; s++) if (netIn[s]! & PZ_BIT && pzLeft[s]! > 0) by = s;
    if (state === "paused" && by < 0) (state = "play"), (G[RES] = RESUME);
    else if (state === "play" && by >= 0) state = "paused";
    G[PZ_BY] = by;
  }
  /** Net overlay (render phase): RESUME for the one who paused, the wait and the cap for the others. */
  function netPauseUI() {
    const me = G[PZ_BY] === net!.slot, who = `P${G[PZ_BY]! + 1}`;
    overlay(me ? "YOU PAUSED" : "BATTLE PAUSED", me ? "PAUSED" : `${who} PAUSED`, (me ? `<button class="bui-sticker-key" type="button" data-resume>${PLAY}<b>RESUME</b></button>` : "") + (net!.leave ? `<button class="bui-sticker-key bui-second" type="button" data-new>${MENU}<b>LEAVE ROOM</b></button>` : "") + `<p class="pzl" data-pzl></p>${BYLINE()}`);
    ov.classList.add("pause");
    ov.querySelector("[data-resume]")?.addEventListener("click", () => (pzWant = false), { signal: e.signal });
    ov.querySelector("[data-new]")?.addEventListener("click", () => net!.leave!(), { signal: e.signal });
  }
  // The tab hidden or the phone locked: pause. Net play sends the pause now (one lockstep frame, the
  // normal path), because a hidden tab stops its frames and the others would just wait in silence.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden" || embed || demo || state !== "play") return;
    if (!net) return togglePause();
    pzWant = true;
    for (let k = 0; k < 3; k++) e.advance(e.dt);
  }, { signal: e.signal });

  // ---------- HUD (change-only writes, render phase) ----------
  const teamKills = new Int32Array(4);
  const last = { pl: false, pr: false, na: 0, tm: "", k: "", t: "", lead: "", st: "", hp: -1, sn: "", ln: "", sDis: false, lDis: false, fDis: false, auto: "", lock: "", aim: "", heat: -1, hot: false, aiming: false, count: "", rs: false, pz: -1, pzl: "" };
  function hudFrame() {
    if (last.pl !== platoon) wrap.classList.toggle("platoon", (last.pl = platoon));
    if (last.pr !== practice) wrap.classList.toggle("practice", (last.pr = practice));
    if (last.na !== noAuto) wrap.classList.toggle("noauto", !!(last.na = noAuto)); // P1 turned auto-aim off: no AUTO / LOCK keys
    const coaching = practice && state === "play";
    if (!coaching && !tunePanel.hidden) tuneOpen(false);
    if (coaching) coachFrame();
    if ($<HTMLElement>("[data-coach]").hidden === coaching) {
      $<HTMLElement>("[data-coach]").hidden = !coaching;
      if (!coaching) for (const el of wrap.querySelectorAll(".coach-on")) el.classList.remove("coach-on");
    }
    const k = String(you.kills);
    let lead = tanks[0]!;
    for (const t of tanks) if (t.kills > lead.kills) lead = t;
    let rank = 1;
    for (const t of tanks) if (t.kills > you.kills) rank++;
    teamKills.fill(0);
    for (const t of tanks) if (t.team < 4) teamKills[t.team]! += t.kills;
    const tt = practice ? "∞" : embed ? `#${rank}` : `${Math.floor(Math.max(0, G[CLK]!) / 60)}:${String(Math.floor(Math.max(0, G[CLK]!) % 60)).padStart(2, "0")}`;
    let top = 0;
    for (let k2 = 1; k2 < sides && k2 < 4; k2++) if (teamKills[k2]! > teamKills[top]!) top = k2;
    const ld = platoon ? (teamKills[top] ? `${sideName(top)} ${teamKills[top]}` : "—") : lead.kills ? `${lead.name} ${lead.kills}` : "—";
    const tm = String(teamKills[you.team] ?? 0);
    if (tm !== last.tm) hud.tm.textContent = last.tm = tm;
    if (k !== last.k) hud.k.textContent = last.k = k;
    if (tt !== last.t) hud.t.textContent = last.t = tt;
    if (ld !== last.lead) hud.lead.textContent = last.lead = ld;
    const st = String(you.run);
    if (st !== last.st) hud.st.textContent = last.st = st;
    const hp = you.alive ? Math.max(0, you.hp) : 0;
    if (hp !== last.hp) {
      last.hp = hp;
      hud.hp.style.width = `${(hp / MAXHP) * 100}%`;
      hud.hp.parentElement!.parentElement!.classList.toggle("low", hp <= 2);
    }
    const sn = String(you.strikes), ln = String(you.rail);
    if (sn !== last.sn) hud.sn.textContent = last.sn = sn;
    if (ln !== last.ln) hud.ln.textContent = last.ln = ln;
    const down = !you.alive || you.drop < 1;
    const sDis = down || you.strikes <= 0, lDis = down || you.rail <= 0, fDis = down;
    if (sDis !== last.sDis) keys.strike.disabled = last.sDis = sDis;
    if (lDis !== last.lDis) keys.long.disabled = last.lDis = lDis;
    if (fDis !== last.fDis) keys.fire.disabled = last.fDis = fDis;
    const au = String(autoOn), lo = String(lockOn), ai = String(targeting);
    if (au !== last.auto) keys.auto.setAttribute("aria-pressed", (last.auto = au));
    if (lo !== last.lock) keys.lock.setAttribute("aria-pressed", (last.lock = lo));
    if (ai !== last.aim) {
      keys.strike.setAttribute("aria-pressed", (last.aim = ai));
      tip.hidden = !targeting;
      wrap.classList.toggle("aiming", targeting);
    }
    const heat = Math.round((you.hot > 0 ? 1 : you.heat) * 20) / 20, hot = you.hot > 0;
    if (heat !== last.heat) keys.fire.style.setProperty("--h", String((last.heat = heat)));
    if (hot !== last.hot) keys.fire.classList.toggle("hot", (last.hot = hot));
    // Kill feed and supply calls.
    for (; feedShown < feedN; feedShown++) {
      const li = feed[feedShown % feed.length]!, a = feedK[feedShown % 8]!, v = feedV[feedShown % 8]!;
      const tag = (t: Tank) => `<i style="color:${t.color}">${t.name}</i>`;
      li.innerHTML = a === -2 ? `📦 SUPPLY DROP · ${["MEDKIT", "LONG AMMO", "AIRSTRIKE", "JACKPOT"][v]}` : a >= 0 ? `${tag(tanks[a]!)} ✕ ${tag(tanks[v]!)}` : `${tag(tanks[v]!)} ✕ 💥`;
      li.parentElement!.prepend(li);
      li.animate?.([{ opacity: 0, transform: "translateX(20px)" }, { opacity: 1, transform: "none" }], { duration: 200 });
    }
    // Streak banner.
    if (bannerShown !== bannerN) {
      bannerShown = bannerN;
      const who = tanks[bannerWho]!;
      banner.querySelector("b")!.textContent = bannerRun === 8 && !who.you ? `${who.name}: NUKE` : `${bannerRun} KILL STREAK`;
      banner.querySelector("span")!.textContent = REWARD[bannerRun]!;
      banner.animate?.(
        [{ opacity: 0, transform: "scale(2.2)" }, { opacity: 1, transform: "scale(.94)", offset: 0.12 }, { opacity: 1, transform: "scale(1)", offset: 0.2 }, { opacity: 1, transform: "scale(1)", offset: 0.82 }, { opacity: 0, transform: "scale(.9) translateY(-14px)" }],
        { duration: 2200, easing: "ease-out" },
      );
    }
    // Resume countdown (3, 2, 1 over the held board) and the net pause overlay: change-only.
    const rs = state === "play" && G[RES]! > 0, pz = net && state === "paused" ? G[PZ_BY]! : -1;
    if (rs !== last.rs) {
      over.hidden = !(last.rs = rs);
      over.innerHTML = rs ? `<div class="count" data-c></div>` : "";
      last.count = "";
    }
    if (rs) {
      const c = G[RES]! > 2 ? "3" : G[RES]! > 1 ? "2" : "1";
      if (c !== last.count) (last.count = c), (over.querySelector("[data-c]")!.textContent = c);
    }
    if (pz !== last.pz) {
      if ((last.pz = pz) >= 0) netPauseUI();
      else if (state !== "end") closeOverlay();
      if (pz < 0 && net && state === "play") pzWant = false; // the cap ran out: let go
    }
    if (pz >= 0) {
      const left = `${G[PZ_BY] === net!.slot ? "YOU HAVE" : `P${pz + 1} HAS`} ${Math.ceil(pzLeft[pz]!)} S OF PAUSE LEFT · ${RESUME} S COUNTDOWN FOR EVERYONE`;
      if (left !== last.pzl) (last.pzl = left), (ov.querySelector("[data-pzl]")!.textContent = left);
    }
    if (state === "count") {
      const vs = (squad ? `${squad} V ${squad}` : "FREE FOR ALL") + (noAuto ? " · AUTO-AIM OFF" : ""), vsEl = over.querySelector<HTMLElement>("[data-vs]");
      if (vsEl && vsEl.textContent !== vs) vsEl.textContent = vs;
      const c = G[CNT]! > 1.6 ? "3" : G[CNT]! > 0.8 ? "2" : G[CNT]! > 0.15 ? "1" : "BLITZ!";
      if (c !== last.count) {
        last.count = c;
        const el = over.querySelector<HTMLElement>("[data-c]");
        if (el) (el.textContent = c), el.getAnimations?.().forEach((a) => (a.cancel(), a.play()));
      }
    }
  }

  // ---------- Drawing ----------
  /** Find yourself: seconds the locate pulse runs after you land, and when it last started (render clock). */
  const LOCATE = 1.4, still = matchMedia("(prefers-reduced-motion: reduce)");
  let youUp = false, locateAt = -9;
  /** Find yourself: each time you land (the start, every respawn) rings ripple out from your tank and
   *  a big YOU chevron drops onto it. Drawn only, on the screen's clock (never the match's). */
  function locatePulse() {
    const now = performance.now() / 1000, up = you.alive && you.drop >= 1; // port-check: ok render: the pulse is drawn only
    if (up && !youUp) locateAt = now;
    youUp = up;
    const lk = now - locateAt;
    if (!up || lk >= LOCATE) return;
    const r0 = 27 * scale, s = scale / 1.4, calm = still.matches;
    // Three rings a beat apart (one fading ring with reduced motion).
    for (let k = 0; k < (calm ? 1 : 3); k++) {
      const ph = calm ? 0.3 : lk / LOCATE - k * 0.2;
      if (ph <= 0 || ph >= 1) continue;
      ctx.globalAlpha = calm ? 1 - lk / LOCATE : 1 - ph;
      ctx.beginPath();
      ctx.arc(you.x, you.y, r0 + ph * 120 * s, 0, TAU);
      ctx.strokeStyle = lightTheme ? "#f6f3ff" : "#07060f";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = you.color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    // The chevron: drops in over the tag and bobs, then fades.
    const drop = calm ? 0 : 10 * Math.abs(Math.sin(lk * 8)) * (1 - lk / LOCATE), y = you.y - r0 - 30 - drop;
    ctx.globalAlpha = Math.min(1, (LOCATE - lk) * 3);
    ctx.beginPath();
    ctx.moveTo(you.x - 11, y - 10);
    ctx.lineTo(you.x + 11, y - 10);
    ctx.lineTo(you.x, y + 3);
    ctx.closePath();
    ctx.fillStyle = you.color;
    ctx.strokeStyle = lightTheme ? "#f6f3ff" : "#07060f";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  /** A top-down jet pointing along +x. */
  function jet(x: number, y: number, a: number, s: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(26, 0);
    ctx.lineTo(10, -4);
    ctx.lineTo(-2, -26);
    ctx.lineTo(-10, -26);
    ctx.lineTo(-4, -5);
    ctx.lineTo(-16, -4);
    ctx.lineTo(-23, -12);
    ctx.lineTo(-28, -12);
    ctx.lineTo(-24, 0);
    ctx.lineTo(-28, 12);
    ctx.lineTo(-23, 12);
    ctx.lineTo(-16, 4);
    ctx.lineTo(-4, 5);
    ctx.lineTo(-10, 26);
    ctx.lineTo(-2, 26);
    ctx.lineTo(10, 4);
    ctx.closePath();
    ctx.restore();
  }
  function chute(x: number, y: number, sc: number, color: string, sway: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sway);
    const cw = 34 * sc, cy = -46 * sc;
    ctx.strokeStyle = "#f6f3ff";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const f of [-1, -0.4, 0.4, 1]) (ctx.moveTo(f * cw * 0.95, cy), ctx.lineTo(f * 8 * sc, -8 * sc));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, cy, cw, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#f6f3ff";
    for (let k = -2; k <= 2; k += 2) {
      ctx.beginPath();
      ctx.moveTo(0, cy - cw);
      ctx.lineTo(k * cw * 0.28 - cw * 0.12, cy);
      ctx.lineTo(k * cw * 0.28 + cw * 0.12, cy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = "#07060f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, cy, cw, Math.PI, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  function crate(x: number, y: number, s: number, kind: number) {
    const w = 26 * s;
    ctx.fillStyle = "#3a2a14";
    ctx.strokeStyle = "#07060f";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - w / 2, w, w, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = kind === 0 ? "#a8ff3e" : kind === 1 ? "#ffc21a" : kind === 2 ? "#ff2e88" : "#19f0ff";
    ctx.fillRect(x - w / 2 + 3, y - 3 * s, w - 6, 6 * s);
    ctx.fillRect(x - 3 * s, y - w / 2 + 3, 6 * s, w - 6);
    ctx.strokeStyle = "#ffc21a";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - w / 2 + 3, y - w / 2 + 3, w - 6, w - 6);
  }
  /** Brackets that close in on a target (lock, auto pick, long-shot charge). */
  function brackets(x: number, y: number, r: number, color: string, width: number) {
    const l = r * 0.45;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) (ctx.moveTo(x + sx * r, y + sy * (r - l)), ctx.lineTo(x + sx * r, y + sy * r), ctx.lineTo(x + sx * (r - l), y + sy * r));
    ctx.stroke();
  }
  /** The Battlefield hero's airstrike reticle, bigger. */
  function reticle(x: number, y: number, r: number, spin: number, alpha: number) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#ff2e88";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.moveTo(x - r - 14, y);
    ctx.lineTo(x - r + 16, y);
    ctx.moveTo(x + r - 16, y);
    ctx.lineTo(x + r + 14, y);
    ctx.moveTo(x, y - r - 14);
    ctx.lineTo(x, y - r + 16);
    ctx.moveTo(x, y + r - 16);
    ctx.lineTo(x, y + r + 14);
    ctx.stroke();
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -spin * 40;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 12, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.3, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "#ff2e88";
    ctx.fillRect(x - 2, y - 2, 4, 4);
    ctx.globalAlpha = 1;
  }
  function tileIcon(type: number, x: number, y: number, w: number) {
    const c = x + w / 2, m = y + w / 2, s = w * 0.3;
    ctx.fillStyle = ctx.strokeStyle = type === SHIELD ? "#07060f" : "#f6f3ff";
    ctx.lineWidth = 2.5;
    if (type === HEAL) {
      ctx.fillRect(c - s, m - s * 0.32, s * 2, s * 0.64);
      ctx.fillRect(c - s * 0.32, m - s, s * 0.64, s * 2);
    } else if (type === AMMO) {
      ctx.beginPath();
      ctx.arc(c, m, s * 0.8, 0, TAU);
      ctx.moveTo(c - s * 1.2, m);
      ctx.lineTo(c + s * 1.2, m);
      ctx.moveTo(c, m - s * 1.2);
      ctx.lineTo(c, m + s * 1.2);
      ctx.stroke();
    } else if (type === STRIKE) {
      jet(c, m, -Math.PI / 2, w / 80);
      ctx.fill();
    } else {
      ctx.font = `900 ${Math.round(w * 0.55)}px ui-monospace,monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(type === RAPID ? "»" : type === TRIPLE ? "≡" : type === SHIELD ? "◆" : "!", c, m + 1);
    }
  }
  function draw() {
    if (net) {
      ctx.setTransform(1, 0, 0, 1, 0, 0), ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Cover: the camera keeps your tank mid-screen, up to the arena's edges, or a little past them
      // at the top and bottom, where the keys and the scoreboard sit (your tank is never under them).
      const s = view[0]!, cw = canvas.width / dpr, ch = canvas.height / dpr, t = view[3]!;
      if (phone.matches) (view[1] = Math.min(0, Math.max(cw - (t ? H : W) * s, cw / 2 - s * (t ? H - you.y : you.x)))), (view[2] = Math.min(ch * 0.12, Math.max(ch * 0.84 - (t ? W : H) * s, ch / 2 - s * (t ? you.x : you.y))));
      else (view[1] = Math.min(0, Math.max(cw - W * s, cw / 2 - s * you.x))), (view[2] = Math.min(0, Math.max(ch - H * s, ch / 2 - s * you.y)));
    }
    vt();
    ctx.clearRect(0, 0, W, H);
    // The shake draws from the screen's own random, never engine.random: how often the screen is drawn must not change the match.
    const sh = calm.matches ? 0 : G[QUAKE]!, sx = sh ? (shakeRandom() - 0.5) * sh : 0, sy = sh ? (shakeRandom() - 0.5) * sh : 0;
    shook = Math.abs(sx) + Math.abs(sy);
    ctx.translate(sx, sy);
    if (!embed) {
      // The arena: a dark grid like the game's map.
      ctx.fillStyle = lightTheme ? "#e4e6f7" : "#090818";
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.strokeStyle = lightTheme ? "rgba(0,136,179,.22)" : "rgba(25,240,255,.09)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= cols; c++) (ctx.moveTo(c * T + 0.5, 0), ctx.lineTo(c * T + 0.5, H));
      for (let r = 0; r <= rows; r++) (ctx.moveTo(0, r * T + 0.5), ctx.lineTo(W, r * T + 0.5));
      ctx.stroke();
    }
    const now = performance.now() / 1000; // port-check: ok render: the tiles' colour cycle and pulse, drawn only
    // Lit tiles: slot-machine colours, then the settled power-up pulses.
    for (const s of tiles) {
      if (!s.on) continue;
      const x = s.c * T + 3, y = s.r * T + 3, w = T - 6;
      const rolling = s.roll > 0, color = rolling ? COLORS[((now * 14) | 0) % 8]! : TILE_COLOR[s.type]!;
      const pulse = rolling ? 0.85 : 0.55 + 0.45 * Math.abs(Math.sin(now * (s.type === MINE ? 9 : 4)));
      ctx.globalAlpha = (embed || lightTheme || state !== "play" ? 0.7 : 0.35) * pulse;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, w);
      ctx.globalAlpha = !rolling && s.t < 2 && ((now * 6) | 0) % 2 ? 0.3 : 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, w, w);
      if (!rolling) tileIcon(s.type, x, y, w);
      ctx.globalAlpha = 1;
    }
    fx.drawGround(ctx, lightTheme);
    // Cover blocks.
    for (const b of blocks) {
      if (b.hp <= 0) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#aea4d6";
        ctx.fillRect(b.x, b.y + b.h / 2 - 2, b.w, 4);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.fillStyle = lightTheme ? "#f6f3ff" : "#1a1430";
      ctx.strokeStyle = b.hp === 3 ? "#ff8a1f" : b.hp === 2 ? "#ffc21a" : "#ff2b4e";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(b.x + b.w / 2 - 6, b.y + b.h / 2 - 2, 12, 4);
    }
    // Strike zones: a big reticle over the target, a small one on every bomb's spot.
    for (const m of marks) {
      if (!m.on) continue;
      const k = m.t / m.max;
      reticle(m.x, m.y, (40 + 70 * k) * (scale / 1.4), now, 1 - k * 0.4);
    }
    for (const b of bombs) {
      if (!b.on) continue;
      const k = b.wait > 0 ? 0 : 1 - b.fall / 0.5;
      ctx.globalAlpha = 0.25 + 0.4 * k;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, 4 + 10 * k, 2.5 + 6 * k, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Supply crates.
    for (let i = 0; i < supply.count; i++) {
      const x = supply.x[i]!, y = supply.y[i]!, land = supply.landY[i]!, kind = supply.kind[i]!;
      if (!supply.landed(i)) {
        // Falling: the shadow on the landing spot grows as the crate comes down.
        const drop = Math.min(1, supply.age[i]! / CRATE_DROP), k = 1 - drop;
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(x, land + 4, 14 * (0.5 + drop * 0.5), 7 * (0.5 + drop * 0.5), 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        chute(x, y, scale * 0.8, "#ffc21a", Math.sin(now * 3) * 0.12 * k);
        crate(x, y, scale * 0.9, kind);
      } else if (supply.life - supply.age[i]! > 3 || ((now * 8) | 0) % 2) {
        // On the ground: it blinks in its last 3 seconds.
        ctx.globalAlpha = 0.5 + 0.4 * Math.abs(Math.sin(now * 4));
        ctx.strokeStyle = "#ffc21a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 22 * scale, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
        crate(x, y, scale * 0.9, kind);
      }
    }
    // Tanks (and their parachutes).
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const t of tanks) {
      if (!t.alive) continue;
      if (t.drop < 1) {
        const k = 1 - t.drop, lift = k * 150, sc = scale * (1 + k * 0.7);
        ctx.globalAlpha = 0.35 * (1 - k * 0.6);
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(t.x, t.y + 6, 20 * scale * (0.5 + t.drop * 0.5), 9 * scale * (0.5 + t.drop * 0.5), 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (mine(t)) {
          // Where you'll land.
          ctx.setLineDash([6, 5]);
          ctx.lineDashOffset = -now * 30;
          ctx.strokeStyle = t.color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(t.x, t.y, 26 * scale, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const y = t.y - lift, sway = Math.sin(now * 3 + t.i) * 0.12 * k;
        chute(t.x, y, sc, t.color, sway);
        drawTank(ctx, t.x, y, t.a + sway, t.ta + sway, t.color, t.tread, 0, false, sc);
      } else {
        if (mine(t)) {
          // You: a marching dashed ring, so you find yourself at a glance.
          const r = 27 * scale;
          ctx.globalAlpha = 0.16;
          ctx.fillStyle = t.color;
          ctx.beginPath();
          ctx.arc(t.x, t.y, r, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.setLineDash([7, 5]);
          ctx.lineDashOffset = -now * 30;
          ctx.strokeStyle = "#07060f";
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(t.x, t.y, r, 0, TAU);
          ctx.stroke();
          ctx.strokeStyle = t.color;
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (platoon && !t.you && t.team === you.team && !demo) {
          // Your wingmen: a thin ring in your colour.
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = t.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(t.x, t.y, 23 * scale, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (t.shield > 0 && (t.shield > 1.5 || ((now * 10) | 0) % 2)) {
          ctx.strokeStyle = "#f6f3ff";
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(t.x, t.y, 22 * scale, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        drawTank(ctx, t.x, t.y, t.a, t.ta, t.color, t.tread, t.recoil, t.flash > 0, scale);
        if (t.rapid > 0 || t.triple > 0) {
          ctx.fillStyle = t.triple > 0 ? "#19f0ff" : "#39ffb0";
          ctx.fillRect(t.x - 12, t.y + 20 * scale, (24 * Math.max(t.rapid, t.triple)) / 8, 3);
        }
        // Long shot charging: laser sight and closing brackets.
        if (t.charge > 0 && live(t.chargeT)) {
          const o2 = tanks[t.chargeT]!, k = t.charge / 0.45;
          ctx.globalAlpha = 0.5 + 0.5 * (((now * 20) | 0) % 2);
          ctx.strokeStyle = mine(t) ? "#ffc21a" : "#ff2b4e";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(t.x, t.y);
          ctx.lineTo(o2.x, o2.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          brackets(o2.x, o2.y, (18 + 26 * k) * (scale / 1.4), ctx.strokeStyle, 3);
        }
      }
      // Name tag and health pips.
      const ty = (t.drop < 1 ? t.y - (1 - t.drop) * 150 - 70 * scale : t.y - 27 * scale) - 6;
      ctx.save();
      upright(t.x, t.y);
      ctx.font = `800 ${mine(t) ? 12 : 10}px ui-monospace,monospace`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = lightTheme ? "#f6f3ff" : "#07060f";
      const tag = mine(t) ? "▼ YOU" : platoon && t.team === you.team && !demo ? `▲ ${t.name}` : t.name;
      ctx.strokeText(tag, t.x, ty);
      ctx.fillStyle = t.color;
      ctx.fillText(tag, t.x, ty);
      if (t.drop >= 1)
        for (let k = 0; k < MAXHP; k++) {
          ctx.fillStyle = k < t.hp ? (t.hp <= 2 ? "#ff2b4e" : t.color) : "rgba(174,164,214,.3)";
          ctx.fillRect(t.x - 17 + k * 7, ty + 4, 5, 3);
        }
      ctx.restore();
    }
    if (!demo) locatePulse();
    // Your aim: the lock (cyan brackets) or auto's pick (thin).
    if (!demo && you.alive && you.drop >= 1 && you.charge <= 0) {
      const k = lockOn ? lockT : autoOn ? nearestEnemy(you, 520) : -1;
      if (live(k)) {
        const o2 = tanks[k]!, pulse = lockOn ? 2 * Math.sin(now * 6) : 0;
        brackets(o2.x, o2.y, (24 + pulse) * (scale / 1.4), lockOn ? "#19f0ff" : "rgba(25,240,255,.55)", lockOn ? 3 : 1.5);
        if (lockOn) {
          ctx.font = "800 9px ui-monospace,monospace";
          ctx.fillStyle = "#19f0ff";
          ctx.save();
          upright(o2.x, o2.y);
          ctx.fillText("LOCK", o2.x, o2.y + 36 * (scale / 1.4));
          ctx.restore();
        }
      }
    }
    // Shells.
    ctx.lineCap = "round";
    for (const s of shells) {
      if (!s.on) continue;
      const c = tanks[s.owner]!.color, tail = s.rail ? 0.06 : 0.035;
      ctx.strokeStyle = s.rail ? "#ffc21a" : c;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = s.rail ? 12 : 8;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * tail, s.y - s.vy * tail);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = s.rail ? 4 : 3;
      ctx.strokeStyle = "#fff4ff";
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    // Falling bombs: from the bomber's height down to their shadow.
    for (const b of bombs) {
      if (!b.on || b.wait > 0) continue;
      const k = b.fall / 0.5, y = b.y - k * 70, s = (0.7 + 0.6 * k) * (scale / 1.4);
      ctx.fillStyle = "#1a1430";
      ctx.strokeStyle = "#f6f3ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(b.x, y, 5 * s, 9 * s, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ff2e88";
      ctx.fillRect(b.x - 6 * s, y - 12 * s, 12 * s, 3 * s);
    }
    fx.draw(ctx, lightTheme);
    // Bombers, high above: a shadow on the ground, the jet up top.
    for (const p of planes) {
      if (!p.on) continue;
      const s = 1.5 * (scale / 1.4);
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = "#000";
      jet(p.x + 20, p.y + 26, p.a, s * 0.8);
      ctx.fill();
      ctx.globalAlpha = 1;
      jet(p.x, p.y - 70, p.a, s);
      ctx.fillStyle = tanks[p.owner]!.color;
      ctx.strokeStyle = "#07060f";
      ctx.lineWidth = 2.5;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f6f3ff";
      ctx.beginPath();
      ctx.ellipse(p.x + Math.cos(p.a) * 12 * s, p.y - 70 + Math.sin(p.a) * 12 * s, 5 * s, 2.5 * s, p.a, 0, TAU);
      ctx.fill();
    }
    // Your cannon heat, under your tank.
    if (!demo && you.alive && you.drop >= 1 && (you.heat > 0.05 || you.hot > 0)) {
      ctx.fillStyle = "rgba(7,6,15,.7)";
      ctx.fillRect(you.x - 18, you.y + 25 * scale, 36, 4);
      ctx.fillStyle = you.hot > 0 ? (((now * 8) | 0) % 2 ? "#ff2b4e" : "#ffc21a") : "#ffc21a";
      ctx.fillRect(you.x - 18, you.y + 25 * scale, 36 * (you.hot > 0 ? 1 : you.heat), 4);
    }
    // Airstrike target mode: the big crosshair follows the pointer.
    if (targeting && (fine.matches || input.pointer.x || input.pointer.y)) {
      const x = wx(input.pointer.x), y = wy(input.pointer.y), r = (62 + 5 * Math.sin(now * 5)) * (scale / 1.4);
      reticle(x, y, r, now, 1);
      ctx.font = "900 12px ui-monospace,monospace";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#07060f";
      ctx.save();
      upright(x, y);
      ctx.strokeText("AIRSTRIKE", x, y - r - 22);
      ctx.fillStyle = "#ff2e88";
      ctx.fillText("AIRSTRIKE", x, y - r - 22);
      ctx.restore();
    } else if (!demo && you.alive && !input.stick.active && fine.matches) {
      // Aim cursor (desktop).
      ctx.strokeStyle = "#39ffb0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(wx(input.pointer.x), wy(input.pointer.y), 9, 0, TAU);
      ctx.stroke();
    }
    vt();
    // The nuke: a red siren, then everything goes white.
    if (G[NUKE_T]! > 0) {
      const blink = ((now * 4) | 0) % 2;
      ctx.strokeStyle = "#ff2b4e";
      ctx.globalAlpha = blink ? 0.8 : 0.35;
      ctx.lineWidth = 18;
      ctx.strokeRect(9, 9, W - 18, H - 18);
      ctx.globalAlpha = 1;
      ctx.font = `900 ${Math.round(Math.min(64, W / 10))}px ui-monospace,monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#07060f";
      const txt = `NUKE ${Math.ceil(G[NUKE_T]!)}`;
      ctx.save();
      upright(W / 2, H / 2);
      ctx.strokeText(txt, W / 2, H / 2);
      ctx.fillStyle = blink ? "#ff2b4e" : "#ffc21a";
      ctx.fillText(txt, W / 2, H / 2);
      ctx.restore();
      ctx.textBaseline = "alphabetic";
    }
    if (G[WHITE]! > 0) {
      ctx.globalAlpha = Math.min(1, G[WHITE]! * 1.4);
      ctx.fillStyle = "#fff4ff";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (net && state === "play") edges();
  }
  /** Net play: an enemy off screen lights the screen's edge on its side, in its colour (drawing only). */
  function edges() {
    const s = view[0]!, cw = canvas.width / dpr, ch = canvas.height / dpr, t = view[3]!, L = 54, D = 7;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 0.55 + 0.35 * Math.sin(performance.now() / 160); // port-check: ok render-phase pulse, never in the step
    for (const o of tanks) {
      if (!o.alive || o.team === you.team) continue;
      const x = t ? view[1]! + s * (H - o.y) : view[1]! + s * o.x, y = t ? view[2]! + s * o.x : view[2]! + s * o.y;
      if (x >= 0 && x <= cw && y >= 0 && y <= ch) continue;
      const cx = Math.max(L / 2, Math.min(cw - L / 2, x)), cy = Math.max(L / 2, Math.min(ch - L / 2, y));
      ctx.fillStyle = o.color;
      if (x < 0) ctx.fillRect(0, cy - L / 2, D, L);
      else if (x > cw) ctx.fillRect(cw - D, cy - L / 2, D, L);
      if (y < 0) ctx.fillRect(cx - L / 2, 0, L, D);
      else if (y > ch) ctx.fillRect(cx - L / 2, ch - D, L, D);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Wiring: the round keys ----------
  const tapKey = (b: HTMLButtonElement, intent: string) => {
    const go = () => (input.press(intent), input.press(intent, false));
    b.addEventListener("pointerdown", (ev) => (ev.stopPropagation(), b.disabled || go()), { signal: e.signal });
    b.addEventListener("click", (ev) => ev.detail === 0 && go(), { signal: e.signal }); // keyboard
  };
  tapKey(keys.auto, "auto");
  tapKey(keys.lock, "lock");
  tapKey(keys.strike, "strike");
  keys.long.addEventListener("pointerdown", (ev) => (ev.stopPropagation(), (longQ = true)), { signal: e.signal });
  keys.long.addEventListener("click", (ev) => ev.detail === 0 && (longQ = true), { signal: e.signal });
  // FIRE: hold it down.
  const fireUp = () => (keys.fire.classList.remove("down"), input.press("fire", false));
  keys.fire.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    keys.fire.setPointerCapture?.(ev.pointerId);
    keys.fire.classList.add("down");
    input.press("fire");
    fireQ = true;
  }, { signal: e.signal });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) keys.fire.addEventListener(t, fireUp, { signal: e.signal });
  // The drive stick (phones): a drag from its centre steers, up on the screen is up (see encode).
  const stk = $<HTMLElement>("[data-stk]"), knob = stk.firstElementChild as HTMLElement;
  const steer = (ev: PointerEvent) => {
    const r = stk.getBoundingClientRect(), R = r.width / 2;
    let x = (ev.clientX - r.left - R) / R, y = (ev.clientY - r.top - R) / R;
    const d = Math.max(1, Math.hypot(x, y));
    input.steer((x /= d), (y /= d));
    knob.style.translate = `${x * 40}px ${y * 40}px`;
  };
  stk.addEventListener("pointerdown", (ev) => (ev.stopPropagation(), stk.setPointerCapture?.(ev.pointerId), steer(ev)), { signal: e.signal });
  stk.addEventListener("pointermove", (ev) => stk.hasPointerCapture?.(ev.pointerId) && steer(ev), { signal: e.signal });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) stk.addEventListener(t, () => (input.steer(0, 0, false), (knob.style.translate = "")), { signal: e.signal });
  // Drag to move, remembered on this device; double-click puts it back. The keys move by their grab
  // bar; the scoreboard by any part of it (in-page scoreboards always drag: Board UI).
  const movable = (el: HTMLElement, handle: HTMLElement, id: string, clamp: (at: Float64Array, w: DOMRect) => void, css: (x: number, y: number) => string, moved?: () => void) => {
    const at = new Float64Array(4);
    const place = () => (clamp(at, wrap.getBoundingClientRect()), (el.style.translate = at[0] || at[1] ? css(at[0]!, at[1]!) : ""));
    try {
      const v = JSON.parse(localStorage.getItem(id) ?? "null");
      if (Array.isArray(v)) (at[0] = +v[0] || 0), (at[1] = +v[1] || 0), requestAnimationFrame(place);
    } catch {}
    const save = () => {
      try {
        localStorage.setItem(id, JSON.stringify([at[0], at[1]]));
      } catch {}
    };
    handle.addEventListener("pointerdown", (ev) => {
      if (ev.button) return;
      ev.stopPropagation();
      handle.setPointerCapture?.(ev.pointerId);
      handle.classList.add("on");
      at[2] = ev.clientX - at[0]!;
      at[3] = ev.clientY - at[1]!;
    }, { signal: e.signal });
    handle.addEventListener("pointermove", (ev) => {
      if (!handle.classList.contains("on")) return;
      at[0] = ev.clientX - at[2]!;
      at[1] = ev.clientY - at[3]!;
      place();
      moved?.();
    }, { signal: e.signal });
    for (const t of ["pointerup", "pointercancel"]) handle.addEventListener(t, () => handle.classList.contains("on") && (handle.classList.remove("on"), save()), { signal: e.signal });
    handle.addEventListener("dblclick", () => ((at[0] = at[1] = 0), place(), save()), { signal: e.signal });
  };
  const pad = $<HTMLElement>("[data-pad]"), bar = $<HTMLElement>(".hud");
  movable(pad, $<HTMLButtonElement>("[data-grab]"), "blitz:pad", (at, r) => {
    const pw = pad.offsetWidth * 0.9, ph = pad.offsetHeight * 0.9;
    at[0] = Math.max(-(r.width - pw - 8), Math.min(8, at[0]!));
    at[1] = Math.max(-(r.height - ph - 8), Math.min(8, at[1]!));
  }, (x, y) => `${x}px ${y}px`, () => cDrag++);
  // The scoreboard starts centred at the top; it stays whole on the board.
  movable(bar, bar, "blitz:hud", (at, r) => {
    const sx = Math.max(0, (r.width - bar.offsetWidth) / 2 - 8);
    at[0] = Math.max(-sx, Math.min(sx, at[0]!));
    at[1] = Math.max(-bar.offsetTop + 4, Math.min(r.height - bar.offsetTop - bar.offsetHeight - 8, at[1]!));
  }, (x, y) => `calc(-50% + ${x}px) ${y}px`);
  $<HTMLButtonElement>("[data-pause]").addEventListener("click", () => state === "play" && togglePause(), { signal: e.signal });
  // Full screen: the real thing where the browser allows it, else the board fills the window.
  const fsKey = $<HTMLButtonElement>("[data-fs]");
  const fsOn = () => document.fullscreenElement === host || wrap.classList.contains("full");
  const fsPaint = () => {
    const on = fsOn();
    fsKey.innerHTML = svg(on ? "exit" : "full");
    fsKey.setAttribute("aria-label", on ? "Leave full screen" : "Full screen");
    fsKey.setAttribute("aria-pressed", String(on));
  };
  fsKey.addEventListener("click", async () => {
    if (fsOn()) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      wrap.classList.remove("full");
    } else if (host.requestFullscreen) {
      await host.requestFullscreen({ navigationUI: "hide" }).catch(() => wrap.classList.add("full"));
      (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape").catch(() => {});
    } else wrap.classList.add("full");
    fsPaint();
  }, { signal: e.signal });
  document.addEventListener("fullscreenchange", fsPaint, { signal: e.signal });
  // Right-click: long shot at the tank nearest the mouse (or cancel the airstrike).
  canvas.addEventListener("contextmenu", (ev) => (ev.preventDefault(), targeting ? (targeting = false) : (longQ = true)), { signal: e.signal });
  // Light or dark: follows the page's Board UI theme (<html data-theme>), like the Battlefield game.
  const theme = () => {
    lightTheme = document.documentElement.dataset.theme === "light";
    wrap.classList.toggle("light", lightTheme);
    wrap.dataset.theme = lightTheme ? "light" : "dark";
  };
  const mo = new MutationObserver(theme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  e.signal.addEventListener("abort", () => mo.disconnect());
  theme();
  new ResizeObserver(() => resize()).observe(wrap);
  resize();
  if (embed || demo) {
    // Straight into the action: everyone parachutes in.
    for (const t of tanks) t.dead = 0.2 + t.i * 0.25;
  } else if (net) countdown(); // every peer starts the countdown on frame 0
  else intro();
  e.start();

  return {
    engine: e,
    get state() {
      return state;
    },
    start: () => (state === "intro" ? countdown() : undefined),
    /** Net play: lockstep frame, stalls and the first desynced frame (-1), or null. */
    get net() {
      return link;
    },
    /** A hash of the match state (net play compares it across peers). */
    hash: worldHash,
    /** Debug / tests: the live world. */
    world: {
      get tanks() {
        return tanks;
      },
      tiles, shells, blocks, planes, bombs, marks,
      /** Run `n` fixed steps (1/60 s) with no read or render: the zero-allocation test counts the step alone. */
      steps(n: number) {
        for (let k = 0; k < n; k++) world(1 / 60);
      },
      /** Supply crates on the board (a snapshot of the @fzlt/core/rules drops). */
      get crates() {
        return Array.from({ length: supply.count }, (_, i) => ({ x: supply.x[i]!, y: supply.y[i]!, kind: supply.kind[i]!, landed: supply.landed(i), on: true }));
      },
    },
    get platoons() {
      return platoon;
    },
    /** Net play, two players: tanks a side as agreed (P1's pick), 0 = free-for-all. */
    get squad() {
      return squad;
    },
    /** Net play: P1 turned auto-aim off for this match (agreed in the countdown). */
    get noAuto() {
      return !!noAuto;
    },
    /** The intensity levers (Practice → TUNE): the live values, set one (saved like the slider), reset. */
    tune: {
      get values() {
        return tuneValues();
      },
      get changed() {
        return tuneChanged();
      },
      set(key: TuneKey, v: number) {
        const k = TUNE.findIndex((r) => r[0] === key);
        if (k >= 0) (TU[k] = tuneFit(k, v)), tunable && tuneSave(), tunePaint();
      },
      reset() {
        TU.set(TUNE.map((r) => r[3]));
        if (tunable) tuneSave();
        tunePaint();
      },
      /** The TUNE card's key: open or close it (practice). */
      open: (on = true) => tuneOpen(on),
    },
    get practice() {
      return practice;
    },
    /** Practice coach: the step you're on (0-based; 8 = done). */
    get coach() {
      return cStep;
    },
    /** Debug / tests: the screen shake drawn last frame (px; always 0 under reduced motion). */
    get shake() {
      return shook;
    },
    /** Debug / tests: your controls. */
    controls: {
      get auto() {
        return autoOn;
      },
      get lock() {
        return lockOn;
      },
      get lockTarget() {
        return lockT;
      },
      get targeting() {
        return targeting;
      },
      /** When the find-yourself pulse last started (performance.now() seconds; -9 never). */
      get locate() {
        return locateAt;
      },
      /** Drop a supply crate now. */
      crate: () => dropCrate(),
    },
    get sound() {
      return sfx.on;
    },
    set sound(v: boolean) {
      sfx.on = v;
    },
    destroy() {
      for (const a of anims) a.cancel();
      anims.clear();
      e.destroy();
      wrap.remove();
      style.remove();
    },
  };
}
export type Blitz = ReturnType<typeof createBlitz>;
