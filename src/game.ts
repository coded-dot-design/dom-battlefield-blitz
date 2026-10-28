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
import { controls } from "../vendor/fizlet/input";
import { effects } from "../vendor/fizlet/fx";
import { sound } from "../vendor/fizlet/sound";
import { segCircle, inRect, circleRect } from "../vendor/fizlet/collide";
import { tankSprites } from "../shared/sherman-sprites";
import { launch, slam } from "../vendor/fizlet/ui/board-ui";

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
  /** Called when a board match ends. */
  onEnd?: (standings: { name: string; kills: number; deaths: number; you: boolean; team: number }[]) => void;
}

const TAU = Math.PI * 2;
const MAXHP = 5, RAIL_MAX = 9, STRIKE_MAX = 5, RAIL_START = 3;
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
interface Crate { x: number; y: number; drop: number; life: number; kind: number; on: boolean }
interface Cover { el: HTMLElement; x: number; y: number; w: number; h: number; busy: number }

const ICON = {
  fire: '<path d="M10 1v5M10 14v5M1 10h5M14 10h5"/><circle cx="10" cy="10" r="5"/>',
  long: '<circle cx="10" cy="10" r="7"/><path d="M10 1v6M10 13v6M1 10h6M13 10h6"/><circle cx="10" cy="10" r="1" fill="currentColor"/>',
  strike: '<path d="M10 1.5l1.6 5.2 6.4 3.6v1.6l-6.3-1.4-.7 4.3 2.3 1.9v1.3l-3.3-.9-3.3.9v-1.3l2.3-1.9-.7-4.3L2 11.9v-1.6l6.4-3.6z"/>',
  auto: '<path d="M10 1v4M10 15v4M1 10h4M15 10h4M5.5 5.5l2 2M14.5 5.5l-2 2M5.5 14.5l2-2M14.5 14.5l-2-2"/>',
  lock: '<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M10 8v4M8 10h4"/>',
  flag: '<path d="M5 18V3M5 4h10l-3 3.5 3 3.5H5"/>',
  full: '<path d="M2 7V2h5M18 7V2h-5M2 13v5h5M18 13v5h-5"/>',
  exit: '<path d="M7 2v5H2M13 2v5h5M7 18v-5H2M13 18v-5h5"/>',
};
// The Battlefield cartridge skull on its grid tile, with a pink Blitz bolt.
const GRID = '<path d="M0 16h64M0 32h64M0 48h64M16 0v64M32 0v64M48 0v64" stroke="#19f0ff" stroke-opacity=".35"/><rect x="1" y="1" width="62" height="62" fill="none" stroke="#19f0ff" stroke-width="2"/>';
const BADGE = `<svg class="ic" viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges">${GRID}<g transform="translate(10 9) scale(.69)" fill="currentColor"><path fill-rule="evenodd" d="M19 6h26v6h7v6h6v6h5v22h-5v6h-8v12h-9v-8h-6v8h-8v-8h-6v8h-8V52H5v-6H0V24h5v-6h6v-6h8ZM11 29v14h15V29Zm26 0v14h15V29Z"/></g><path d="M50 3h9l-4 7h5l-10 12 3-9h-5z" fill="#ff2e88"/></svg>`;
// The white flag (kit section 9.3): a 4 × 4 grid in your team colour that whites out, and a flag that waves.
const CELLS = [0, 1, 4, 2, 5, 8, 3, 6, 9, 12, 7, 10, 13, 11, 14, 15].map((i, k) => `<rect x="${(i % 4) * 16}" y="${((i / 4) | 0) * 16}" width="16" height="16" style="--i:${k}"/>`).join("");
const FLAG = `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges"><g class="bui-cells">${CELLS}</g><path class="bui-grid" d="M0 16h64M0 32h64M0 48h64M16 0v64M32 0v64M48 0v64"/><rect class="bui-frame" x="1" y="1" width="62" height="62"/><path class="bui-pole" d="M17 9h4v46h-4Z"/><path class="bui-cloth" d="M21 12h24l-6 9 6 9H21Z"/></svg>`;
const SKULL = `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges"><g transform="translate(10 9) scale(.69)"><path fill-rule="evenodd" d="M19 6h26v6h7v6h6v6h5v22h-5v6h-8v12h-9v-8h-6v8h-8v-8h-6v8h-8V52H5v-6H0V24h5v-6h6v-6h8ZM11 29v14h15V29Zm26 0v14h15V29Z"/></g></svg>`;
const PLAY = `<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges">${GRID}<path d="M22 16v32l26-16Z" fill="currentColor"/></svg>`;
const svg = (k: keyof typeof ICON) => `<svg viewBox="0 0 20 20" aria-hidden="true">${ICON[k]}</svg>`;

const CSS = `:host{all:initial;display:block}*{box-sizing:border-box}
.bz{position:absolute;inset:0;overflow:hidden;font:600 12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;touch-action:none;user-select:none;-webkit-user-select:none}
.bz.embed{position:fixed;z-index:2147483000}
canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
.aiming canvas{cursor:none}
.hud{position:absolute;left:50%;top:max(10px,env(safe-area-inset-top));translate:-50% 0;display:flex;gap:14px;align-items:center;padding:8px 14px;background:color-mix(in srgb,var(--surface) 93%,transparent);border:2px solid var(--line);border-radius:12px;box-shadow:0 5px 0 var(--rim);pointer-events:none;white-space:nowrap}
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
.bui .coach button{grid-row:1/span 2;grid-column:3;min-height:0;padding:7px 10px;font:900 10px/1 ui-monospace,monospace;letter-spacing:.08em}
.bui .fs{position:absolute;z-index:3;left:max(12px,env(safe-area-inset-left));top:max(10px,env(safe-area-inset-top));width:40px;height:40px;min-height:0}.embed .fs,.demo .fs{display:none}
.bz.full{position:fixed;z-index:2147483000}
.bui .pz{position:absolute;z-index:3;left:max(60px,calc(env(safe-area-inset-left) + 48px));top:max(10px,env(safe-area-inset-top));height:40px;min-height:0;padding:0 12px}.demo .pz,.pre .pz{display:none}
.ov .table{position:absolute;left:50%;top:56%;translate:-50% -50%}.ov.result .bui-sticker{top:26%}
@media (pointer:coarse){.pz span{display:none}}
@media (max-height:460px){.ov .table{top:57%;gap:2px;padding:6px 12px;font-size:10px}.ov .table div:nth-child(n+4):not(.you){display:none}.ov.result .bui-sticker{top:22%}}
.pre .hud,.pre .pad,.pre .help,.pre .feed,.aiming .help{display:none}
@media (max-height:460px){.legend{display:none}.over.intro{padding-top:0}}
@media (max-height:460px){.over{gap:14px}.sticker b{font-size:36px}.sticker .ic{width:46px;height:46px}}
.table{display:grid;gap:4px;min-width:240px;padding:12px 16px;color:var(--ink);background:var(--surface);border:2px solid var(--line);border-radius:12px;box-shadow:0 5px 0 var(--rim)}
.table div{display:flex;justify-content:space-between;gap:20px}.table .you{color:var(--team)}.bui[data-theme=light] .table .you{color:#0a8a55}
.row{display:flex;gap:16px}
.count{font:900 96px/1 ui-monospace,monospace;color:var(--ink);text-shadow:0 0 30px var(--k-sys);animation:bui-slam .5s both}
.legend{position:absolute;top:max(12px,env(safe-area-inset-top));left:50%;translate:-50% 0;display:flex;flex-wrap:wrap;justify-content:center;gap:4px 18px;width:max-content;max-width:calc(100% - 128px);padding:8px 16px;font-size:11px;color:var(--muted);background:color-mix(in srgb,var(--surface) 93%,transparent);border:2px solid var(--line);border-radius:10px;box-shadow:0 4px 0 var(--rim)}
.legend b{color:var(--ink)}
@media (max-width:620px){.pad{scale:.82}.hud{gap:10px;padding:6px 10px}.hud .lead{display:none}.help{display:none}}
@media (pointer:fine){.touch-only{display:none}}@media (pointer:coarse){.fine-only,.bui .rk kbd{display:none}}
@media (prefers-reduced-motion:reduce){.sticker,.count,.tip{animation:none}}`;

export function createBlitz(host: HTMLElement, o: BlitzOptions = {}) {
  const mode = o.mode ?? "board", embed = mode === "embed", demo = !!o.demo;
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = __KIT_CSS__ + CSS;
  const wrap = document.createElement("div");
  wrap.className = `bui bz ${mode}${demo ? " demo" : ""}`;
  wrap.dataset.theme = "dark";
  wrap.innerHTML = `<canvas></canvas>
<div class="hud"><div class="k"><small>KILLS</small><b data-k>0</b></div><div class="t"><small>${embed ? "RANK" : "TIME"}</small><b data-t>3:00</b></div><div class="hp"><small>ARMOR</small><i><u data-hp></u></i></div><div class="st"><small>STREAK</small><b data-st>0</b></div><div class="tm"><small>TEAM</small><b data-tm>0</b></div><div class="lead"><small>LEADER</small><b data-lead>—</b></div></div>
<ol class="feed"><li></li><li></li><li></li><li></li></ol>
<div class="banner" data-banner><b></b><span></span></div>
<div class="tip" data-tip hidden>AIRSTRIKE · <span class="fine-only">CLICK</span><span class="touch-only">TAP</span> WHERE THE BOMBS GO</div>
<button class="bui-icon-key fs" type="button" data-fs aria-label="Full screen" title="Full screen">${svg("full")}</button>
<button class="bui-arcade bui-flag pz" type="button" data-pause aria-label="Pause or surrender (Esc)" title="Esc · Pause">${svg("flag")}<span>Surrender</span></button>
<div class="pad" data-pad>
<button class="bui-grip grab" type="button" data-grab aria-label="Move the controls: drag (double-click puts them back)" title="Drag to move · double-click to reset"></button>
<button class="rk bui-arcade bui-aim auto" type="button" data-k="auto" aria-pressed="false" aria-label="Auto-aim at the nearest tank (Q)" title="Q · Auto-aim">${svg("auto")}<small>AUTO</small><kbd>Q</kbd></button>
<button class="rk bui-arcade bui-aim lock" type="button" data-k="lock" aria-pressed="false" aria-label="Aim lock: stick to one target, tap a tank to switch (T)" title="T · Aim lock">${svg("lock")}<small>LOCK</small><kbd>T</kbd></button>
<button class="rk bui-arcade bui-attack strike" type="button" data-k="strike" aria-pressed="false" aria-label="Airstrike: then tap where the bombs go (F)" title="F · Airstrike">${svg("strike")}<small>STRIKE</small><span class="n" data-n="strike">1</span><kbd>F</kbd></button>
<button class="rk bui-arcade long" type="button" data-k="long" aria-label="Long shot: locks on and hits from across the field (E)" title="E · Long shot">${svg("long")}<small>LONG</small><span class="n" data-n="long">3</span><kbd>E</kbd></button>
<button class="rk bui-arcade bui-fire fire" type="button" data-k="fire" aria-label="Hold to fire the cannon (Space)" title="Space · Fire">${svg("fire")}<kbd>SPACE</kbd></button>
</div>
<div class="help fine-only">WASD DRIVE · MOUSE AIM · CLICK FIRE · E LONG SHOT · F AIRSTRIKE · Q AUTO · T LOCK${embed ? " · ESC CLOSE" : " · ESC PAUSE"}</div>
<div class="coach" data-coach hidden><span data-cs>1/8</span><b data-ct></b><small data-cm></small><button class="bui-arcade bui-attack" type="button" data-cx>END PRACTICE</button></div>
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

  const e = createEngine({ root: wrap, seed: (Math.random() * 1e9) | 0, events: 128 });
  const input = controls(e, {
    keys: {
      up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"], fire: ["Space"],
      long: ["KeyE", "KeyR"], strike: ["KeyF", "KeyX"], auto: ["KeyQ"], lock: ["KeyT"], pause: ["Escape", "KeyP"],
    },
    target: canvas,
    stick: "left",
  });
  const fx = effects({ cap: 700, words: WORDS, colors: FX_COLORS, scorch: 48 });
  const sfx = sound(e, { cues: { shot: "fire", boom: "boom", hit: "hit", power: "power", strike: "hurt", land: "click", lock: "click", win: "win", end: "end", ready: "ready", streak: "win", nuke: "end" } });
  const drawTank = tankSprites(document);
  const R = Math.random;
  const coarse = matchMedia("(pointer: coarse)"), fine = matchMedia("(pointer: fine)");

  // ---------- World ----------
  let W = 0, H = 0, dpr = 1, scale = 1.4, T = 44, cols = 0, rows = 0;
  let clock = o.seconds ?? 180, state: "intro" | "count" | "play" | "end" | "paused" = embed || demo ? "play" : "intro", count = 0;
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
  let platoon = o.platoons ?? saved === "platoon", practice = !embed && !demo && o.platoons === undefined && saved === "practice";
  let N = 0, tanks: Tank[] = [], you: Tank = null!;
  const per = embed ? 3 : 4;
  function roster() {
    N = practice ? 7 : platoon ? per * 3 : 1 + (o.bots ?? (embed ? 5 : 7));
    tanks = Array.from({ length: N }, (_, i) => {
      const team = platoon ? (i / per) | 0 : i, slot = platoon ? i % per : 0;
      return {
        i, team, slot, you: i === 0 && !demo,
        name: practice ? (i === 0 ? "YOU" : i <= 3 ? `TARGET${i}` : `MOVER${i - 3}`) : platoon ? (i === 0 ? (demo ? "ACE" : "YOU") : team === 0 ? WING[slot - 1]! : `${PLATOON[team]}${slot + 1}`) : demo && i === 0 ? "ACE" : NAMES[i % NAMES.length]!,
        color: platoon ? TEAM_COLORS[team]! : COLORS[i % COLORS.length]!,
        x: 0, y: 0, a: 0, ta: 0, hp: MAXHP, alive: false, dead: platoon ? 0.2 + team * 0.45 + slot * 0.12 : 0.2 + i * 0.18, drop: 0, shield: 0, rapid: 0, triple: 0,
        strikes: i === 0 ? 1 : 0, carpet: 0, rail: i === 0 ? RAIL_START : 1, charge: 0, chargeT: -1, heat: 0, hot: 0,
        cool: 0, kills: 0, deaths: 0, recoil: 0, flash: 0, tread: 0, streak: 0, streakT: 0, run: 0, gx: 0, gy: 0, think: 0, target: -1, lastHit: -1,
      };
    });
    you = tanks[0]!;
    wrap.classList.toggle("platoon", platoon);
    wrap.classList.toggle("practice", practice);
  }
  roster();
  const shells: Shell[] = Array.from({ length: 140 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, owner: 0, on: false, rail: false, tgt: -1 }));
  const tiles: Tile[] = Array.from({ length: 22 }, () => ({ c: 0, r: 0, type: 0, roll: 0, t: 0, on: false }));
  const marks: Mark[] = Array.from({ length: 8 }, () => ({ x: 0, y: 0, t: 0, max: 1, owner: 0, on: false }));
  const planes: Plane[] = Array.from({ length: 6 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, a: 0, t: 0, owner: 0, on: false }));
  const bombs: Bomb[] = Array.from({ length: 40 }, () => ({ x: 0, y: 0, wait: 0, fall: 0, owner: 0, main: false, on: false }));
  const booms: Boom[] = Array.from({ length: 48 }, () => ({ x: 0, y: 0, t: 0, p: 0, c: 0, on: false }));
  const crates: Crate[] = Array.from({ length: 2 }, () => ({ x: 0, y: 0, drop: 0, life: 0, kind: 0, on: false }));
  const blocks: Block[] = [];
  let covers: Cover[] = [], coverDirty = true, coverAt = 0;
  const anims = new Set<Animation>();
  let tileIn = 1.2, crateIn = 12, lightTheme = false;
  // Your controls: auto-aim (on by default on phones), aim lock and the airstrike target mode.
  let autoOn = coarse.matches, lockOn = false, lockT = -1, targeting = false;
  // Taps the step picks up: an airstrike spot, a lock target, a long shot.
  let strikeQ = false, strikeX = 0, strikeY = 0, longQ = false, strikeT = false, fireQ = false;
  // The nuke: countdown, then the flash.
  let nukeT = 0, nukeBy = -1, whiteout = 0;
  // Messages for the DOM, written in render: the kill feed ring and the streak banner.
  const feedK = new Int16Array(8), feedV = new Int16Array(8);
  let feedN = 0, feedShown = 0, bannerN = 0, bannerShown = 0, bannerRun = 0, bannerWho = 0;

  function resize() {
    const r = wrap.getBoundingClientRect();
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
  const blocked = (x: number, y: number, rad: number) => {
    for (const b of blocks) if (b.hp > 0 && circleRect(x, y, rad, b.x, b.y, b.w, b.h)) return b;
    return null;
  };
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
  function knock(c: Cover, nx: number, ny: number, power: number, flat: boolean) {
    const now = performance.now();
    if (now < c.busy || typeof c.el.animate !== "function") return;
    c.busy = now + (flat ? 1100 : 800);
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
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2, d = Math.hypot(cx - x, cy - y);
      if (d < rad) knock(c, (cx - x) / (d || 1), (cy - y) / (d || 1), power * (1 - d / rad) + 0.4, false);
    }
  }

  // ---------- Spawning: everyone parachutes in ----------
  function spawn(t: Tank) {
    let x = 0, y = 0, hx = 0, hy = 0;
    if (platoon) {
      // Platoons drop together: next to the platoon's lead tank, else at the platoon's corner.
      let anchor: Tank | null = null;
      for (const o2 of tanks) if (o2 !== t && o2.team === t.team && o2.alive && (!anchor || o2.slot < anchor.slot)) anchor = o2;
      const a = Math.PI * 0.75 + (t.team * TAU) / 3;
      hx = anchor ? anchor.x : W / 2 + Math.cos(a) * W * 0.32;
      hy = anchor ? anchor.y : H / 2 + Math.sin(a) * H * 0.3;
    }
    for (let k = 0; k < 24; k++) {
      if (platoon) {
        const a = R() * TAU, r = 55 + R() * 70;
        x = Math.max(40, Math.min(W - 40, hx + Math.cos(a) * r));
        y = Math.max(70, Math.min(H - 60, hy + Math.sin(a) * r));
      } else (x = 40 + R() * (W - 80)), (y = 70 + R() * (H - 130));
      let ok = !blocked(x, y, 22 * scale);
      for (const o2 of tanks) if (o2 !== t && o2.alive && Math.hypot(o2.x - x, o2.y - y) < (o2.team === t.team ? 44 : 160)) ok = false;
      if (ok) break;
    }
    Object.assign(t, { x, y, a: R() * TAU, hp: MAXHP, alive: true, drop: 0, shield: 0, rapid: 0, triple: 0, cool: 0.6, recoil: 0, think: 0, target: -1, gx: x, gy: y, streak: 0, run: 0, heat: 0, hot: 0, charge: 0, chargeT: -1 });
    t.ta = t.a;
  }

  // ---------- Shake: only what lands near you (or hits you) moves the screen ----------
  let quakeAmt = 0, buzz = 0;
  function quake(x: number, y: number, power: number) {
    if (demo || !you.alive || state !== "play") return;
    const reach = 250 * (scale / 1.4), d = Math.hypot(x - you.x, y - you.y);
    if (d < reach) quakeAmt = Math.min(18, quakeAmt + power * 3.5 * (1 - d / reach) ** 1.5);
  }
  function boom(x: number, y: number, power: number, tint: number) {
    fx.blast(x, y, power, tint);
    quake(x, y, power);
  }

  // ---------- Combat ----------
  function freeShell() {
    for (const s of shells) if (!s.on) return s;
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
      s.vx = Math.cos(a) * 600;
      s.vy = Math.sin(a) * 600;
      s.life = 1;
      s.owner = t.i;
    }
    t.recoil = 6;
    t.flash = 0.08;
    if (t.you) cShots++;
    // The cannon is quick; hold it down too long and it overheats (rapid fire never does).
    t.cool = t.you ? (t.rapid > 0 ? 0.1 : 0.19) : t.rapid > 0 ? 0.22 : 0.5 + R() * 0.35;
    if (t.you && t.rapid <= 0 && (t.heat += 0.16) >= 1) {
      t.hot = 1.4;
      fx.word(t.x, t.y - 34, W_HOT, 2, 16);
    }
    fx.spawn(1, t.x + Math.cos(t.ta) * len, t.y + Math.sin(t.ta) * len, 0, 0, 9, 0.12, 0);
    e.events.emit("shot", t.i);
  }
  /** Long shot: lock on for a beat (laser sight), then a guided round crosses the field. */
  function charge(t: Tank, target: number) {
    if (t.rail <= 0 || t.charge > 0 || target < 0 || !t.alive || t.drop < 1) return;
    t.charge = 0.45;
    t.chargeT = target;
    if (t.you) fx.word(tanks[target]!.x, tanks[target]!.y - 34, W_LOCK, 4, 14);
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
    fx.spawn(1, s.x, s.y, 0, 0, 16, 0.16, 1);
    fx.spawn(2, s.x, s.y, 0, 0, 8, 0.3, 1);
    if (t.you) quakeAmt = Math.min(18, quakeAmt + 3);
    e.events.emit("shot", t.i, 0, 0, 0, 1.5);
  }
  function kill(t: Tank, by: number, word = W_BOOM) {
    if (!t.alive) return;
    t.alive = false;
    t.dead = 2.2;
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
      if (k.streak === 2) fx.word(k.x, k.y - 40, W_DOUBLE, 1, 18);
      if (k.streak >= 3) fx.word(k.x, k.y - 40, W_RAMPAGE, 3, 20);
      if (k.you) fx.word(k.x, k.y - 26, W_PLUS, 5, 18);
      reward(k);
    }
    boom(t.x, t.y, 2.2, 3);
    boom(t.x + (R() - 0.5) * 30, t.y + (R() - 0.5) * 30, 1.2, 1);
    for (let n = 0; n < 9; n++) {
      const a = R() * TAU, sp = 90 + R() * 140;
      fx.spawn(0, t.x, t.y, Math.cos(a) * sp, Math.sin(a) * sp, (7 + R() * 7) * (scale / 1.4), 1.1, n % 3 ? 5 : 7, R() * TAU, (R() - 0.5) * 24);
    }
    fx.word(t.x, t.y - 18, word === W_BOOM ? (R() * 5) | 0 : word, 3, word === W_NUKE ? 24 : 18);
    if (t.you) (quakeAmt = 16), (buzz += 220);
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
      fx.spawn(2, t.x, t.y, 0, 0, 18, 0.3, 4);
      return false;
    }
    t.hp -= amount;
    t.lastHit = by;
    if (t.you) (quakeAmt = Math.min(18, quakeAmt + amount * 2.5)), (buzz += 35 * amount); // worse the harder you're hit
    e.events.emit("hit", t.i);
    if (t.hp <= 0) kill(t, by, word);
    return true;
  }

  // ---------- Airstrikes: a bomber crosses the field and the bombs walk over the target ----------
  function callStrike(owner: number, x: number, y: number) {
    const t = tanks[owner]!;
    if (t.strikes <= 0 || !t.alive || t.drop < 1) return false;
    let m: Mark | null = null, p: Plane | null = null;
    for (const q of marks) if (!q.on) (m = q);
    for (const q of planes) if (!q.on) (p = q);
    if (!m || !p) return false;
    t.strikes--;
    if (owner === 0) cStrike++;
    const carpet = t.carpet > 0;
    if (carpet) t.carpet--;
    // The bomber comes in over the caller's shoulder.
    const d0 = Math.hypot(x - t.x, y - t.y), a = d0 > 40 ? Math.atan2(y - t.y, x - t.x) : R() * TAU;
    const ca = Math.cos(a), sa = Math.sin(a), speed = 820, reach = Math.hypot(W, H) * 0.65;
    p.on = true;
    p.owner = owner;
    p.a = a;
    p.x = x - ca * reach;
    p.y = y - sa * reach;
    p.vx = ca * speed;
    p.vy = sa * speed;
    p.t = (reach * 2) / speed;
    const n = carpet ? 7 : 3, gap = (carpet ? 56 : 42) * (scale / 1.4);
    let last = 0;
    for (let k = 0; k < n; k++) {
      let b: Bomb | null = null;
      for (const q of bombs) if (!q.on) (b = q);
      if (!b) break;
      const off = (k - (n - 1) / 2) * gap, side = (R() - 0.5) * 26;
      b.on = true;
      b.owner = owner;
      b.main = carpet || k === (n - 1) / 2;
      b.x = x + ca * off - sa * side;
      b.y = y + sa * off + ca * side;
      b.wait = (reach + off) / speed;
      b.fall = 0.5;
      last = Math.max(last, b.wait + b.fall);
    }
    m.on = true;
    m.owner = owner;
    m.x = x;
    m.y = y;
    m.t = m.max = last + 0.1;
    if (carpet) fx.word(x, y - 70, W_CARPET, 3, 22);
    e.events.emit("strike", owner);
    return true;
  }
  function later(x: number, y: number, p: number, c: number, t: number) {
    for (const b of booms)
      if (!b.on) {
        b.on = true;
        b.x = x;
        b.y = y;
        b.p = p;
        b.c = c;
        b.t = t;
        return;
      }
  }
  function detonate(b: Bomb) {
    // The Battlefield hero's airstrike: one big blast, two more a beat later, black scorch.
    const p = b.main ? 3.2 : 2.4;
    boom(b.x, b.y, p, 3);
    later(b.x + (R() - 0.5) * 60, b.y + (R() - 0.5) * 48, 1.6, 1, 0.09);
    later(b.x + (R() - 0.5) * 60, b.y + (R() - 0.5) * 48, 1.3, 4, 0.19);
    if (b.main && R() < 0.6) fx.word(b.x, b.y - 30, W_STRIKE, 3, 22);
    const rad = (b.main ? 95 : 80) * (scale / 1.4);
    for (const t of tanks) {
      if (t.team === tanks[b.owner]!.team) continue;
      const d = Math.hypot(t.x - b.x, t.y - b.y);
      if (d < rad) damage(t, b.owner, d < rad * 0.6 ? MAXHP : 3, W_STRIKE);
    }
    for (const k of blocks) if (k.hp > 0 && Math.hypot(k.x + k.w / 2 - b.x, k.y + k.h / 2 - b.y) < rad + 20) wreckBlock(k);
    knockAround(b.x, b.y, rad * 2, 2.4);
    e.events.emit("boom", -1, 0, 0, 0, 1.4);
  }
  function nuke(owner: number) {
    if (nukeT > 0) return;
    nukeT = 2.6;
    nukeBy = owner;
    e.events.emit("nuke", owner);
  }
  function nukeGoesOff() {
    whiteout = 1;
    for (const t of tanks) if (t.team !== tanks[nukeBy]!.team && t.alive && t.drop >= 1) (t.shield = 0), kill(t, nukeBy, W_NUKE);
    for (const b of blocks) if (b.hp > 0) wreckBlock(b);
    for (let k = 0; k < 9; k++) later(40 + R() * (W - 80), 70 + R() * (H - 120), 2.4 + R() * 1.6, (k % 4) + 1, k * 0.08);
    knockAround(W / 2, H / 2, Math.max(W, H), 2.6);
    if (!demo) quakeAmt = 18;
  }
  function wreckBlock(b: Block) {
    b.hp = 0;
    b.back = 12;
    for (let n = 0; n < 8; n++) {
      const a = R() * TAU, sp = 60 + R() * 140;
      fx.spawn(0, b.x + b.w / 2, b.y + b.h / 2, Math.cos(a) * sp, Math.sin(a) * sp, 6 + R() * 6, 0.8, 6, R() * TAU, (R() - 0.5) * 18);
    }
  }

  // ---------- Power tiles (the blinking grid) and supply crates ----------
  function lightTile(show = false) {
    let s: Tile | null = null, n = 0;
    for (const q of tiles) q.on ? n++ : (s = q);
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
      boom(cx, cy, 2.6, 3);
      fx.word(cx, cy - 26, W_MINE, 3, 20);
      for (const o2 of tanks) if (Math.hypot(o2.x - cx, o2.y - cy) < 80 * (scale / 1.4)) damage(o2, -1, 3);
      e.events.emit("boom", -1);
      return;
    }
    if (s.type === RAPID) (t.rapid = 8), (t.hot = 0), (t.heat = 0);
    if (s.type === TRIPLE) t.triple = 8;
    if (s.type === SHIELD) t.shield = 6;
    if (s.type === STRIKE) t.strikes = Math.min(STRIKE_MAX, t.strikes + 1);
    if (s.type === HEAL) t.hp = Math.min(MAXHP, t.hp + 2);
    if (s.type === AMMO) t.rail = Math.min(RAIL_MAX, t.rail + 1);
    fx.spawn(2, cx, cy, 0, 0, 20, 0.5, s.type === STRIKE ? 3 : s.type === AMMO ? 1 : 5);
    fx.word(cx, cy - 22, TILE_WORD[s.type]!, s.type === STRIKE ? 3 : s.type === AMMO ? 1 : 5, 15);
    e.events.emit("power", t.i);
  }
  function dropCrate() {
    let c: Crate | null = null;
    for (const q of crates) if (!q.on) (c = q);
    if (!c) return;
    openSpot(spot);
    c.on = true;
    c.x = spot[0]!;
    c.y = spot[1]!;
    c.drop = 0;
    c.life = 14;
    const r = R();
    c.kind = r < 0.38 ? 0 : r < 0.66 ? 1 : r < 0.9 ? 2 : 3;
    fx.word(c.x, c.y - 130, W_SUPPLY, 1, 18);
    feedK[feedN % 8] = -2;
    feedV[feedN % 8] = c.kind;
    feedN++;
    e.events.emit("ready", -1);
  }
  function takeCrate(c: Crate, t: Tank) {
    c.on = false;
    if (t.you) cCrate++;
    if (c.kind === 0 || c.kind === 3) (t.hp = MAXHP), (t.shield = Math.max(t.shield, 2));
    if (c.kind === 1) t.rail = Math.min(RAIL_MAX, t.rail + 2);
    if (c.kind === 2 || c.kind === 3) t.strikes = Math.min(STRIKE_MAX, t.strikes + 1);
    if (c.kind === 3) t.rail = Math.min(RAIL_MAX, t.rail + 1);
    fx.spawn(2, c.x, c.y, 0, 0, 26, 0.6, 1);
    for (let n = 0; n < 8; n++) {
      const a = R() * TAU, sp = 80 + R() * 120;
      fx.spawn(0, c.x, c.y, Math.cos(a) * sp, Math.sin(a) * sp, 5 + R() * 4, 0.7, 1 + (n % 2) * 4, R() * TAU, (R() - 0.5) * 16);
    }
    fx.word(c.x, c.y - 26, CRATE_WORD[c.kind]!, 1, 18);
    e.events.emit("power", t.i);
  }

  // ---------- The simulation ----------
  const live = (k: number) => k >= 0 && tanks[k]!.alive && tanks[k]!.drop >= 1;
  const nearestEnemy = (t: Tank, range: number) => {
    let best = -1, bd = range;
    for (const o2 of tanks) {
      if (o2.team === t.team || !o2.alive || o2.drop < 1) continue;
      const d = Math.hypot(o2.x - t.x, o2.y - t.y);
      if (d < bd) (bd = d), (best = o2.i);
    }
    return best;
  };
  /** The enemy (of `team`) closest to a point (a tap, the mouse, a tank to protect). */
  const nearestTo = (x: number, y: number, range: number, team: number) => {
    let best = -1, bd = range;
    for (const o2 of tanks) {
      if (o2.team === team || !o2.alive || o2.drop < 1) continue;
      const d = Math.hypot(o2.x - x, o2.y - y);
      if (d < bd) (bd = d), (best = o2.i);
    }
    return best;
  };
  const turn = (from: number, to: number, max: number) => {
    const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + Math.sign(d) * Math.min(Math.abs(d), max);
  };
  function drive(t: Tank, ax: number, ay: number, dt: number) {
    const m = Math.min(1, Math.hypot(ax, ay));
    if (m < 0.05) return;
    t.a = turn(t.a, Math.atan2(ay, ax), 7 * dt);
    const sp = 150 * m * (scale / 1.4) * dt, nx = t.x + Math.cos(t.a) * sp, ny = t.y + Math.sin(t.a) * sp, rad = 14 * scale;
    if (!blocked(nx, t.y, rad)) t.x = nx;
    if (!blocked(t.x, ny, rad)) t.y = ny;
    t.tread += sp * 0.15;
    if (t.you) cMoved += sp;
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
      t.target = live(h) && tanks[h]!.team !== t.team && Math.hypot(tanks[h]!.x - lead.x, tanks[h]!.y - lead.y) < 560 ? h : nearestTo(lead.x, lead.y, 420, t.team);
      if (t.target < 0) t.target = nearestEnemy(t, 360);
      if (t.target >= 0) {
        const o2 = tanks[t.target]!, d = Math.hypot(o2.x - t.x, o2.y - t.y);
        if (t.strikes > 0 && R() < 0.2) callStrike(t.i, o2.x, o2.y);
        else if (t.rail > 0 && d > 380 && R() < 0.3) charge(t, o2.i);
      }
    }
    // The slot: fanned out behind the leader.
    const back = lead.a + Math.PI, off = t.slot === 1 ? 0.85 : t.slot === 2 ? -0.85 : 0, r = (t.slot === 3 ? 78 : 58) * scale;
    let gx = lead.x + Math.cos(back + off) * r, gy = lead.y + Math.sin(back + off) * r;
    const o2 = t.target >= 0 ? tanks[t.target]! : null;
    if (o2 && Math.hypot(o2.x - lead.x, o2.y - lead.y) < 300) (gx += (o2.x - gx) * 0.25), (gy += (o2.y - gy) * 0.25); // step up between the leader and the threat
    if (t.hp <= 2)
      for (const s of tiles)
        if (s.on && s.roll <= 0 && s.type === HEAL && Math.hypot((s.c + 0.5) * T - t.x, (s.r + 0.5) * T - t.y) < 220) (gx = (s.c + 0.5) * T), (gy = (s.r + 0.5) * T);
    gx = Math.max(30, Math.min(W - 30, gx));
    gy = Math.max(60, Math.min(H - 30, gy));
    const dx = gx - t.x, dy = gy - t.y, d = Math.hypot(dx, dy);
    if (d > 14) drive(t, dx / d, dy / d, dt * (d > 140 ? 1.05 : 0.8));
    gun(t, dt);
  }
  function bot(t: Tank, dt: number) {
    if (practice) {
      // Practice dummies: TARGETs stand still, MOVERs roll about. Nobody shoots.
      if (t.i <= 3) return void (t.ta = turn(t.ta, t.a + Math.sin(performance.now() / 900 + t.i), 1.5 * dt));
      if ((t.think -= dt) <= 0) (t.think = 2 + R() * 2), (t.gx = 60 + R() * (W - 120)), (t.gy = 90 + R() * (H - 160));
      const dx = t.gx - t.x, dy = t.gy - t.y, d = Math.hypot(dx, dy);
      if (d > 16) drive(t, dx / d, dy / d, dt * 0.55);
      t.ta = turn(t.ta, t.a, 3 * dt);
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
      for (const c of crates) if (c.on && c.drop >= 1 && Math.hypot(c.x - t.x, c.y - t.y) < 520 && R() < 0.6) (gx = c.x), (gy = c.y);
      if (gx < 0)
        for (const s of tiles) {
          if (!s.on || s.roll > 0 || s.type === MINE) continue;
          const sx = (s.c + 0.5) * T, sy = (s.r + 0.5) * T, d = Math.hypot(sx - t.x, sy - t.y);
          if (d < 380 && (s.type === HEAL ? t.hp <= 3 || R() < 0.3 : R() < 0.45)) (gx = sx), (gy = sy);
        }
      if (gx >= 0) (t.gx = gx), (t.gy = gy);
      else if (t.target >= 0) {
        const o2 = tanks[t.target]!, a = Math.atan2(t.y - o2.y, t.x - o2.x) + (R() - 0.5) * 1.6, keep = 120 + R() * 120;
        t.gx = Math.max(30, Math.min(W - 30, o2.x + Math.cos(a) * keep));
        t.gy = Math.max(60, Math.min(H - 30, o2.y + Math.sin(a) * keep));
      } else (t.gx = 40 + R() * (W - 80)), (t.gy = 70 + R() * (H - 120));
      if (t.target >= 0) {
        const o2 = tanks[t.target]!, d = Math.hypot(o2.x - t.x, o2.y - t.y);
        if (t.strikes > 0 && R() < 0.35) callStrike(t.i, o2.x, o2.y);
        else if (t.rail > 0 && d > 380 && R() < 0.4) charge(t, o2.i);
      }
    }
    const dx = t.gx - t.x, dy = t.gy - t.y, d = Math.hypot(dx, dy);
    if (d > 16) {
      const before = t.x + t.y;
      drive(t, dx / d, dy / d, dt * 0.85);
      if (Math.abs(t.x + t.y - before) < 0.01) t.think = Math.min(t.think, 0.05); // stuck: rethink
    }
    gun(t, dt);
  }
  /** Bots' turret: track the target, fire when lined up and in range. */
  function gun(t: Tank, dt: number) {
    const o2 = t.target >= 0 ? tanks[t.target]! : null;
    if (o2 && o2.alive && o2.drop >= 1) {
      const aim = Math.atan2(o2.y - t.y, o2.x - t.x);
      t.ta = turn(t.ta, aim, 4.5 * dt);
      const err = Math.abs(Math.atan2(Math.sin(aim - t.ta), Math.cos(aim - t.ta)));
      if (t.cool <= 0 && t.charge <= 0 && err < 0.12 && Math.hypot(o2.x - t.x, o2.y - t.y) < 460) fire(t);
    } else t.ta = turn(t.ta, t.a, 3 * dt);
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
    drive(t, input.axis("left", "right", 0), input.axis("up", "down", 1), dt);
    const touch = input.stick.active || coarse.matches, aim = aimTarget();
    if (aim >= 0) {
      const o2 = tanks[aim]!;
      t.ta = turn(t.ta, Math.atan2(o2.y - t.y, o2.x - t.x), 8 * dt);
    } else if (!touch || input.pointer.down) t.ta = turn(t.ta, Math.atan2(input.pointer.y - t.y, input.pointer.x - t.x), 10 * dt);
    else t.ta = turn(t.ta, t.a, 4 * dt);
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
      if (callStrike(0, strikeX, strikeY)) targeting = false;
    }
    if (t.strikes <= 0) targeting = false;
  }

  e.add({
    read() {
      if (embed && coverDirty && performance.now() - coverAt > 120) {
        coverDirty = false;
        coverAt = performance.now();
        measureCovers();
      }
      if (input.hit("pause")) {
        if (targeting) targeting = false;
        else if (!embed) togglePause();
      }
      // One-frame key edges are caught here (a frame can run no step).
      if (input.hit("long")) longQ = true;
      if (input.hit("strike")) strikeT = true;
      if (input.hit("auto")) autoOn = !autoOn;
      if (input.hit("lock")) (lockOn = !lockOn), (lockT = -1);
    },
    step(_, dt) {
      fx.step(dt);
      quakeAmt = Math.max(0, quakeAmt - dt * 40);
      whiteout = Math.max(0, whiteout - dt * 0.9);
      if (state === "intro" || state === "count") {
        // The start screen: the grid lights up with everything that can land on it.
        if ((tileIn -= dt) <= 0) (lightTile(true), (tileIn = 0.08 + R() * 0.16));
        for (const s of tiles) {
          if (!s.on) continue;
          if (s.roll > 0) s.roll -= dt;
          else if ((s.t -= dt) <= 0) s.on = false;
        }
        if (state === "count" && (count -= dt) <= 0) {
          for (const s of tiles) s.on = false;
          tileIn = 1.2;
          begin();
        }
        return;
      }
      if (state !== "play") return;
      if (!embed && !demo && !practice) {
        clock -= dt;
        if (clock <= 0) return void end();
      }
      // Tiles blink in; crates parachute in.
      tileIn -= dt;
      if (tileIn <= 0) (lightTile(), (tileIn = 1.4 + R() * 2));
      for (const s of tiles) {
        if (!s.on) continue;
        if (s.roll > 0) s.roll -= dt;
        else if ((s.t -= dt) <= 0) {
          s.on = false;
          if (s.type === MINE) takeTile(s, you); // a mine left alone goes off by itself
        }
      }
      if ((crateIn -= dt) <= 0) (dropCrate(), (crateIn = 18 + R() * 8));
      for (const c of crates) {
        if (!c.on) continue;
        if (c.drop < 1) {
          if ((c.drop += dt / 2.2) >= 1) (c.drop = 1), fx.spawn(2, c.x, c.y, 0, 0, 16, 0.4, 7);
        } else if ((c.life -= dt) <= 0) c.on = false;
      }
      for (const b of blocks) if (b.hp <= 0 && (b.back -= dt) <= 0 && !tanks.some((t) => t.alive && circleRect(t.x, t.y, 20, b.x, b.y, b.w, b.h))) b.hp = 3;
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
            fx.spawn(2, t.x, t.y, 0, 0, 22, 0.45, 7);
            for (let n = 0; n < 6; n++) fx.spawn(5, t.x + (R() - 0.5) * 30, t.y + (R() - 0.5) * 20, (R() - 0.5) * 40, -10, 14, 0.9, 6);
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
        if (t.you) player(dt), practice && coachStep(dt);
        else bot(t, dt);
        // Long shot charging: the turret holds the target, then it fires.
        if (t.charge > 0) {
          if (!live(t.chargeT)) t.charge = 0;
          else {
            const o2 = tanks[t.chargeT]!;
            t.ta = turn(t.ta, Math.atan2(o2.y - t.y, o2.x - t.x), 14 * dt);
            if ((t.charge -= dt) <= 0) fireRail(t);
          }
        }
        // Hurt tanks smoke.
        if (t.hp <= 2 && R() < dt * 7) fx.spawn(5, t.x + (R() - 0.5) * 12, t.y - 6, (R() - 0.5) * 20, -30, 10 + R() * 6, 0.9, 6);
        t.x = Math.max(18, Math.min(W - 18, t.x));
        t.y = Math.max(54, Math.min(H - 18, t.y));
        // Tiles and crates under the tracks.
        for (const s of tiles) if (s.on && s.roll <= 0 && inRect(t.x, t.y, s.c * T, s.r * T, T, T)) takeTile(s, t);
        for (const c of crates) if (c.on && c.drop >= 1 && Math.hypot(c.x - t.x, c.y - t.y) < 26 * scale) takeCrate(c, t);
        // Treads flatten the page (embed).
        if (embed) for (const c of covers) if (inRect(t.x, t.y, c.x, c.y + c.h * 0.2, c.w, c.h * 0.7)) knock(c, 0, 0, 1, true);
      }
      // Tanks push apart.
      for (let i = 0; i < N; i++)
        for (let j = i + 1; j < N; j++) {
          const p = tanks[i]!, q = tanks[j]!;
          if (!p.alive || !q.alive || p.drop < 1 || q.drop < 1) continue;
          const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy), min = 26 * scale;
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
          const o2 = tanks[s.tgt]!, va = Math.atan2(s.vy, s.vx), na = turn(va, Math.atan2(o2.y - s.y, o2.x - s.x), 5 * dt), sp = Math.hypot(s.vx, s.vy);
          s.vx = Math.cos(na) * sp;
          s.vy = Math.sin(na) * sp;
        }
        const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
        s.life -= dt;
        let done = s.life <= 0 || nx < -20 || ny < -20 || nx > W + 20 || ny > H + 20;
        for (const t of tanks) {
          if (done || t.team === tanks[s.owner]!.team || !t.alive || t.drop < 1) continue; // no friendly fire
          if (segCircle(s.x, s.y, nx, ny, t.x, t.y, 15 * scale) >= 0) {
            done = true;
            boom(t.x, t.y, s.rail ? 1.8 : 1, s.rail ? 1 : 4);
            damage(t, s.owner, s.rail ? MAXHP : 1, s.rail ? W_SNIPED : W_BOOM);
          }
        }
        const b = done ? null : blocked(nx, ny, 2);
        if (b) {
          if (s.rail) wreckBlock(b), boom(nx, ny, 1, 1);
          else {
            done = true;
            boom(nx, ny, 0.8, 2);
            if (--b.hp <= 0) wreckBlock(b);
          }
        }
        if (!done && embed)
          for (const c of covers)
            if (inRect(nx, ny, c.x, c.y, c.w, c.h) && (s.rail || R() < 0.5)) {
              const d = Math.hypot(s.vx, s.vy) || 1;
              knock(c, s.vx / d, s.vy / d, s.rail ? 2 : 1.2, false);
              if (!s.rail) {
                done = true;
                boom(nx, ny, 0.9, 4);
                break;
              }
            }
        if (done) {
          if (s.life <= 0 && !b) fx.spawn(1, s.x, s.y, 0, 0, 6, 0.15, 1);
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
      for (const b of booms) if (b.on && (b.t -= dt) <= 0) (b.on = false), boom(b.x, b.y, b.p, b.c);
      if (nukeT > 0 && (nukeT -= dt) <= 0) nukeGoesOff();
    },
    render() {
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
        const k = nearestTo(x, y, 44 * (scale / 1.4), 0);
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
  let cCrate = 0, cStep = 0, cShots = 0, cMoved = 0, cRail = 0, cStrike = 0, cTile = 0, cDrag = 0, cT = 0, coachShown = -1;
  function coachStep(dt: number) {
    // Never run dry while practising.
    if (you.rail < 1) you.rail = 3;
    if (you.strikes < 1 && !targeting) you.strikes = 2;
    cT += dt;
    const done = [cMoved > 220, cShots >= 6, autoOn, lockOn, cRail > 0, cStrike > 0, cTile > 0, you.run >= 3, cCrate > 0, cDrag > 0 || cT > 9][cStep];
    if (cStep < COACH.length && done) {
      cStep++;
      cT = 0;
      e.events.emit("power", 0);
      if (COACH[cStep]?.[0] === "SUPPLY CRATE") dropCrate();
    }
    // The crate step: if the crate timed out (or someone else took it), drop another.
    if (COACH[cStep]?.[0] === "SUPPLY CRATE" && !crates.some((c) => c.on)) dropCrate();
  }
  function coachFrame() {
    const key = cStep < COACH.length ? cStep : COACH.length + (((cT / 6) | 0) % TRICKS.length);
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
    for (const pool of [shells, tiles, marks, planes, bombs, booms, crates] as { on: boolean }[][]) for (const s of pool) s.on = false;
    targeting = false;
    nukeT = whiteout = quakeAmt = 0;
    fx.clear();
    roster();
    intro();
  }

  // ---------- Match flow ----------
  const kicker = () => `BATTLEFIELD · ${practice ? "PRACTICE" : platoon ? "PLATOONS" : "FREE FOR ALL"}`;
  function intro() {
    state = "intro";
    tileIn = 0;
    wrap.classList.add("pre");
    over.hidden = false;
    over.classList.add("intro");
    over.innerHTML = `<div class="sticker">${BADGE}<span data-kick>${kicker()}</span><b>BLITZ<em>!</em></b></div>
<div class="modes bui-seg" role="group" aria-label="Mode"><button class="mode" type="button" data-mode="solo" aria-pressed="${!platoon && !practice}"><b>SOLO</b><small>every tank for itself</small></button><button class="mode" type="button" data-mode="platoon" aria-pressed="${platoon}"><b>PLATOON</b><small>you + 3 wingmen vs 2 platoons</small></button><button class="mode" type="button" data-mode="practice" aria-pressed="${practice}"><b>PRACTICE</b><small>learn the keys, with tips</small></button></div>
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
    count = 2.4;
    over.hidden = false;
    over.innerHTML = `<div class="count" data-c>3</div>`;
    e.events.emit("ready", 0);
  }
  function begin() {
    state = "play";
    if (practice) (cStep = cCrate = cShots = cMoved = cRail = cStrike = cTile = cDrag = cT = 0), (coachShown = -1);
    wrap.classList.remove("pre");
    over.hidden = true;
    over.innerHTML = "";
  }
  function standings() {
    return tanks.map((t) => ({ name: t.name, kills: t.kills, deaths: t.deaths, you: t.you, team: t.team })).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }
  function end(surrendered = false) {
    state = "end";
    targeting = false;
    const st = standings();
    // Platoons: the platoon with the most kills wins; the table is the platoons, then you.
    const teams = [0, 1, 2].map((team) => ({ team, kills: 0, deaths: 0 }));
    if (platoon) for (const t of tanks) (teams[t.team]!.kills += t.kills), (teams[t.team]!.deaths += t.deaths);
    teams.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const won = !surrendered && (platoon ? teams[0]!.team === 0 : st[0]!.you);
    e.events.emit(won ? "win" : "end", 0);
    const rows = platoon
      ? teams.map((s, i) => `<div class="${s.team === 0 ? "you" : ""}"><span>${i + 1}. ${PLATOON[s.team]} PLATOON</span><span>${s.kills} K · ${s.deaths} D</span></div>`).join("") + `<div class="you"><span>YOU</span><span>${you.kills} K · ${you.deaths} D</span></div>`
      : st.slice(0, 5).map((s, i) => `<div class="${s.you ? "you" : ""}"><span>${i + 1}. ${s.name}</span><span>${s.kills} K · ${s.deaths} D</span></div>`).join("");
    // Kit result overlays: STAGE CLEAR when you win, INSERT COIN when you don't, WHITE FLAG when you gave up.
    overlay(
      won ? "STAGE CLEAR" : surrendered ? "WHITE FLAG" : "INSERT COIN",
      won ? (platoon ? "PLATOON WINS" : "YOU WIN") : surrendered ? "GAME OVER" : `${platoon ? PLATOON[teams[0]!.team] : st[0]!.name} WINS`,
      `<button class="bui-sticker-key" type="button" data-again>${PLAY}<b>REMATCH</b></button><button class="bui-sticker-key bui-second" type="button" data-new>${PLAY}<b>NEW GAME</b></button>`,
      `<div class="table">${rows}</div>`,
    );
    ov.querySelector("[data-again]")!.addEventListener("click", () => (closeOverlay(), rematch()), { signal: e.signal });
    ov.querySelector("[data-new]")!.addEventListener("click", () => (closeOverlay(), toIntro()), { signal: e.signal });
    o.onEnd?.(st);
  }
  function rematch() {
    clock = o.seconds ?? 180;
    for (const t of tanks) Object.assign(t, { kills: 0, deaths: 0, alive: false, dead: platoon ? 0.2 + t.team * 0.45 + t.slot * 0.12 : 0.2 + t.i * 0.15, strikes: t.you ? 1 : 0, carpet: 0, rail: t.you ? RAIL_START : 1, run: 0 });
    for (const pool of [shells, tiles, marks, planes, bombs, booms, crates] as { on: boolean }[][]) for (const s of pool) s.on = false;
    nukeT = whiteout = 0;
    crateIn = 12;
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
  const closeOverlay = () => ((ov.hidden = true), (ov.innerHTML = ""));
  /** Pause = the surrender question, exactly like DOM Battlefield: KEEP FIGHTING or SURRENDER. */
  function togglePause() {
    if (state === "play") {
      state = "paused";
      targeting = false;
      input.press("fire", false);
      overlay("BATTLE PAUSED", "GIVE UP?", `<button class="bui-sticker-key" type="button" data-resume>${SKULL}<b>KEEP FIGHTING</b></button><button class="bui-sticker-key bui-second bui-surrender" type="button" data-surrender>${FLAG}<b>SURRENDER</b></button>`);
      ov.querySelector("[data-resume]")!.addEventListener("click", togglePause, { signal: e.signal });
      const flag = ov.querySelector<HTMLButtonElement>("[data-surrender]")!;
      flag.addEventListener("click", () => {
        if (flag.classList.contains("go")) return;
        // The white flag: cells white out, the flag waves, then it blows up and the match ends.
        flag.classList.add("go");
        e.events.emit("strike", 0);
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        setTimeout(() => launch(flag, () => (practice ? (closeOverlay(), toIntro()) : end(true)), { reduced }), reduced ? 0 : 480);
      }, { signal: e.signal });
    } else if (state === "paused") (closeOverlay(), (state = "play"));
  }

  // ---------- HUD (change-only writes, render phase) ----------
  const teamKills = new Int32Array(4);
  const last = { tm: "", k: "", t: "", lead: "", st: "", hp: -1, sn: "", ln: "", sDis: false, lDis: false, fDis: false, auto: "", lock: "", aim: "", heat: -1, hot: false, aiming: false, count: "" };
  function hudFrame() {
    const coaching = practice && state === "play";
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
    const tt = practice ? "∞" : embed ? `#${rank}` : `${Math.floor(Math.max(0, clock) / 60)}:${String(Math.floor(Math.max(0, clock) % 60)).padStart(2, "0")}`;
    let top = 0;
    for (let k2 = 1; k2 < 3; k2++) if (teamKills[k2]! > teamKills[top]!) top = k2;
    const ld = platoon ? (teamKills[top] ? `${PLATOON[top]} ${teamKills[top]}` : "—") : lead.kills ? `${lead.name} ${lead.kills}` : "—";
    const tm = String(teamKills[0]);
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
    if (state === "count") {
      const c = count > 1.6 ? "3" : count > 0.8 ? "2" : count > 0.15 ? "1" : "BLITZ!";
      if (c !== last.count) {
        last.count = c;
        const el = over.querySelector<HTMLElement>("[data-c]");
        if (el) (el.textContent = c), el.getAnimations?.().forEach((a) => (a.cancel(), a.play()));
      }
    }
  }

  // ---------- Drawing ----------
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const sh = quakeAmt, sx = sh ? (R() - 0.5) * sh : 0, sy = sh ? (R() - 0.5) * sh : 0;
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
    const now = performance.now() / 1000;
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
    for (const c of crates) {
      if (!c.on) continue;
      if (c.drop < 1) {
        const k = 1 - c.drop, y = c.y - k * 170;
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(c.x, c.y + 4, 14 * (0.5 + c.drop * 0.5), 7 * (0.5 + c.drop * 0.5), 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        chute(c.x, y, scale * 0.8, "#ffc21a", Math.sin(now * 3) * 0.12 * k);
        crate(c.x, y, scale * 0.9, c.kind);
      } else {
        if (c.life > 3 || ((now * 8) | 0) % 2) {
          ctx.globalAlpha = 0.5 + 0.4 * Math.abs(Math.sin(now * 4));
          ctx.strokeStyle = "#ffc21a";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 22 * scale, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 1;
          crate(c.x, c.y, scale * 0.9, c.kind);
        }
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
        if (t.you) {
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
        if (t.you) {
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
          ctx.strokeStyle = t.you ? "#ffc21a" : "#ff2b4e";
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
      ctx.font = `800 ${t.you ? 12 : 10}px ui-monospace,monospace`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = lightTheme ? "#f6f3ff" : "#07060f";
      const tag = t.you ? "▼ YOU" : platoon && t.team === you.team && !demo ? `▲ ${t.name}` : t.name;
      ctx.strokeText(tag, t.x, ty);
      ctx.fillStyle = t.color;
      ctx.fillText(tag, t.x, ty);
      if (t.drop >= 1)
        for (let k = 0; k < MAXHP; k++) {
          ctx.fillStyle = k < t.hp ? (t.hp <= 2 ? "#ff2b4e" : t.color) : "rgba(174,164,214,.3)";
          ctx.fillRect(t.x - 17 + k * 7, ty + 4, 5, 3);
        }
    }
    // Your aim: the lock (cyan brackets) or auto's pick (thin).
    if (!demo && you.alive && you.drop >= 1 && you.charge <= 0) {
      const k = lockOn ? lockT : autoOn ? nearestEnemy(you, 520) : -1;
      if (live(k)) {
        const o2 = tanks[k]!, pulse = lockOn ? 2 * Math.sin(now * 6) : 0;
        brackets(o2.x, o2.y, (24 + pulse) * (scale / 1.4), lockOn ? "#19f0ff" : "rgba(25,240,255,.55)", lockOn ? 3 : 1.5);
        if (lockOn) {
          ctx.font = "800 9px ui-monospace,monospace";
          ctx.fillStyle = "#19f0ff";
          ctx.fillText("LOCK", o2.x, o2.y + 36 * (scale / 1.4));
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
      const x = input.pointer.x, y = input.pointer.y, r = (62 + 5 * Math.sin(now * 5)) * (scale / 1.4);
      reticle(x, y, r, now, 1);
      ctx.font = "900 12px ui-monospace,monospace";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#07060f";
      ctx.strokeText("AIRSTRIKE", x, y - r - 22);
      ctx.fillStyle = "#ff2e88";
      ctx.fillText("AIRSTRIKE", x, y - r - 22);
    } else if (!demo && you.alive && !input.stick.active && fine.matches) {
      // Aim cursor (desktop).
      ctx.strokeStyle = "#39ffb0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(input.pointer.x, input.pointer.y, 9, 0, TAU);
      ctx.stroke();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The nuke: a red siren, then everything goes white.
    if (nukeT > 0) {
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
      const txt = `NUKE ${Math.ceil(nukeT)}`;
      ctx.strokeText(txt, W / 2, H / 2);
      ctx.fillStyle = blink ? "#ff2b4e" : "#ffc21a";
      ctx.fillText(txt, W / 2, H / 2);
      ctx.textBaseline = "alphabetic";
    }
    if (whiteout > 0) {
      ctx.globalAlpha = Math.min(1, whiteout * 1.4);
      ctx.fillStyle = "#fff4ff";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
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
  // The grab bar moves the keys; where you put them is remembered. Double-click puts them back.
  const pad = $<HTMLElement>("[data-pad]"), grab = $<HTMLButtonElement>("[data-grab]"), padAt = new Float64Array(4);
  const placePad = () => {
    const r = wrap.getBoundingClientRect(), pw = pad.offsetWidth * 0.9, ph = pad.offsetHeight * 0.9;
    padAt[0] = Math.max(-(r.width - pw - 8), Math.min(8, padAt[0]!));
    padAt[1] = Math.max(-(r.height - ph - 8), Math.min(8, padAt[1]!));
    pad.style.translate = padAt[0] || padAt[1] ? `${padAt[0]}px ${padAt[1]}px` : "";
  };
  try {
    const v = JSON.parse(localStorage.getItem("blitz:pad") ?? "null");
    if (Array.isArray(v)) (padAt[0] = +v[0] || 0), (padAt[1] = +v[1] || 0), requestAnimationFrame(placePad);
  } catch {}
  const savePad = () => {
    try {
      localStorage.setItem("blitz:pad", JSON.stringify([padAt[0], padAt[1]]));
    } catch {}
  };
  grab.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    grab.setPointerCapture?.(ev.pointerId);
    grab.classList.add("on");
    padAt[2] = ev.clientX - padAt[0]!;
    padAt[3] = ev.clientY - padAt[1]!;
  }, { signal: e.signal });
  grab.addEventListener("pointermove", (ev) => {
    if (!grab.classList.contains("on")) return;
    padAt[0] = ev.clientX - padAt[2]!;
    padAt[1] = ev.clientY - padAt[3]!;
    placePad();
    cDrag++;
  }, { signal: e.signal });
  for (const t of ["pointerup", "pointercancel"]) grab.addEventListener(t, () => grab.classList.contains("on") && (grab.classList.remove("on"), savePad()), { signal: e.signal });
  grab.addEventListener("dblclick", () => ((padAt[0] = padAt[1] = 0), placePad(), savePad()), { signal: e.signal });
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
  } else intro();
  e.start();

  return {
    engine: e,
    get state() {
      return state;
    },
    start: () => (state === "intro" ? countdown() : undefined),
    /** Debug / tests: the live world. */
    world: {
      get tanks() {
        return tanks;
      },
      tiles, shells, blocks, planes, bombs, crates, marks,
    },
    get platoons() {
      return platoon;
    },
    get practice() {
      return practice;
    },
    /** Practice coach: the step you're on (0-based; 8 = done). */
    get coach() {
      return cStep;
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
