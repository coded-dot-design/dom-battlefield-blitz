/**
 * Battlefield Blitz: free-for-all tank chaos, built on the Fizlet engine.
 * Everyone respawns by parachute; most kills wins. The grid blinks: lit tiles roll like a slot
 * machine, then settle into a power-up (rapid fire, triple shot, airstrike, shield) or a MINE that
 * blows up whoever drives onto it. Two modes:
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

export interface BlitzOptions {
  mode?: "board" | "embed";
  /** Match length in seconds (board). Default 180. */
  seconds?: number;
  /** Bot count. Default 7 (board) / 5 (embed). */
  bots?: number;
  /** Attract mode: every tank is a bot, no HUD or keys, endless (a landing-page hero). */
  demo?: boolean;
  /** Called when a board match ends. */
  onEnd?: (standings: { name: string; kills: number; deaths: number; you: boolean }[]) => void;
}

const TAU = Math.PI * 2;
const NAMES = ["YOU", "VIPER", "NOVA", "BRICK", "ZAP", "HEX", "RUMBLE", "MOTH", "SPUD", "JINX", "ORBIT"];
const COLORS = ["#39ffb0", "#ff5c8f", "#19f0ff", "#ffc21a", "#b48cff", "#ff8a1f", "#a8ff3e", "#f6f3ff", "#ff2e88", "#7cf0ff", "#e8b4ff"];
// Power tiles: what a lit square settles into.
const RAPID = 1, TRIPLE = 2, STRIKE = 3, SHIELD = 4, MINE = 5;
const TILE_COLOR = ["", "#39ffb0", "#19f0ff", "#ff2e88", "#f6f3ff", "#ff2b4e"];
const TILE_WORD = ["", "RAPID", "TRIPLE", "AIRSTRIKE", "SHIELD", "MINE"];
const TILE_ICON = ["", "»", "≡", "✚", "◆", "!"];
const WORDS = ["BOOM", "KABOOM", "WRECKED", "DIRECT HIT", "BLAM", "FLATTENED", "AIRSTRIKE!", "RAPID", "TRIPLE", "SHIELD", "+1 STRIKE", "MINE!", "LANDED", "DOUBLE KILL", "RAMPAGE", "+1"];
const W_BOOM = 0, W_FLAT = 5, W_STRIKE = 6, W_POWER = 7, W_MINE = 11, W_DOUBLE = 13, W_RAMPAGE = 14, W_PLUS = 15;
const FX_COLORS = ["#fff4ff", "#ffc21a", "#ff8a1f", "#ff2e88", "#19f0ff", "#39ffb0", "#9a63ff", "#07060f"];

interface Tank {
  i: number; name: string; color: string; you: boolean;
  x: number; y: number; a: number; ta: number;
  hp: number; alive: boolean; dead: number; drop: number; shield: number; rapid: number; triple: number; strikes: number;
  cool: number; kills: number; deaths: number; recoil: number; flash: number; tread: number; streak: number; streakT: number;
  gx: number; gy: number; think: number; target: number; lastHit: number;
}
interface Shell { x: number; y: number; vx: number; vy: number; life: number; owner: number; on: boolean }
interface Tile { c: number; r: number; type: number; roll: number; t: number; on: boolean }
interface Block { x: number; y: number; w: number; h: number; hp: number; back: number }
interface Strike { x: number; y: number; t: number; owner: number; on: boolean; main: boolean }
interface Cover { el: HTMLElement; x: number; y: number; w: number; h: number; busy: number }

const CSS = `:host{all:initial;display:block}*{box-sizing:border-box}
.bz{position:absolute;inset:0;overflow:hidden;font:600 12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:#f6f3ff;touch-action:none;user-select:none;-webkit-user-select:none}
.bz.embed{position:fixed;z-index:2147483000}
canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
.hud{position:absolute;left:50%;top:max(10px,env(safe-area-inset-top));translate:-50% 0;display:flex;gap:14px;align-items:center;padding:8px 14px;background:#110d22ee;border:2px solid #3b3170;border-radius:12px;box-shadow:0 5px 0 #2a2150;pointer-events:none;white-space:nowrap}
.hud b{font-size:17px;font-weight:900}.hud small{display:block;font-size:8px;letter-spacing:.16em;color:#aea4d6}
.hud .k b{color:#39ffb0}.hud .t b{color:#19f0ff}.hud .lead b{color:#ffc21a;font-size:13px}
.feed{position:absolute;right:max(12px,env(safe-area-inset-right));top:max(70px,calc(env(safe-area-inset-top) + 60px));margin:0;padding:0;list-style:none;display:grid;gap:4px;justify-items:end;pointer-events:none}
.feed li{padding:4px 8px;background:#110d22dd;border:1px solid #3b3170;border-radius:6px;font-size:11px}.feed li:empty{display:none}
.feed i{font-style:normal;font-weight:900}
.keys{position:absolute;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));display:flex;gap:10px}
button{font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.key{display:grid;place-items:center;min-width:64px;height:58px;padding:0 14px;font:900 12px/1.1 ui-monospace,monospace;letter-spacing:.1em;color:#07060f;background:#ff2e88;border:2.5px solid #07060f;border-radius:12px;box-shadow:0 5px 0 #8f1950;transition:transform .1s,box-shadow .1s}
.key:active,.key.down{transform:translateY(5px);box-shadow:0 0 0 #8f1950}.key[disabled]{opacity:.45;cursor:default}
.key b{font-size:18px}
.demo .hud,.demo .keys,.demo .help,.demo .feed{display:none}.demo canvas{cursor:default}
.embed .keys{bottom:max(80px,calc(env(safe-area-inset-bottom) + 64px))}
.help{position:absolute;left:max(14px,env(safe-area-inset-left));bottom:max(14px,env(safe-area-inset-bottom));padding:6px 10px;font-size:10px;letter-spacing:.08em;color:#aea4d6;background:#110d22cc;border-radius:8px;pointer-events:none}
.over{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:22px;background:#07060fb8;backdrop-filter:grayscale(.6)}
.over[hidden]{display:none}
.sticker{display:grid;justify-items:center;gap:6px;padding:18px 30px 20px;background:#10233f;border:4px solid #f6f3ff;border-radius:18px;box-shadow:0 8px 0 #f6f3ff;rotate:-2deg;animation:slam 1s cubic-bezier(.2,1.4,.4,1) both}
.sticker span{font-size:12px;letter-spacing:.2em;color:#19f0ff}.sticker b{font:900 clamp(30px,6vw,56px)/1 ui-monospace,monospace;letter-spacing:.06em}
@keyframes slam{0%{transform:scale(2.4);opacity:0}36%{transform:scale(.92);opacity:1}55%{transform:scale(1.04)}100%{transform:scale(1)}}
.table{display:grid;gap:4px;min-width:240px;padding:12px 16px;background:#110d22;border:2px solid #3b3170;border-radius:12px}
.table div{display:flex;justify-content:space-between;gap:20px}.table .you{color:#39ffb0}
.row{display:flex;gap:14px}
.go{color:#07060f;background:#39ffb0;box-shadow:0 5px 0 #1d6a40}.go:active{box-shadow:0 0 0 #1d6a40}
.alt{color:#f6f3ff;background:#1d1738;border-color:#07060f;box-shadow:0 5px 0 #3b3170}.alt:active{box-shadow:0 0 0 #3b3170}
.count{font:900 96px/1 ui-monospace,monospace;color:#f6f3ff;text-shadow:0 0 30px #19f0ff;animation:slam .5s both}
@media (pointer:fine){.touch-only{display:none}}@media (pointer:coarse){.fine-only{display:none}}
@media (prefers-reduced-motion:reduce){.sticker,.count{animation:none}}`;

export function createBlitz(host: HTMLElement, o: BlitzOptions = {}) {
  const mode = o.mode ?? "board", embed = mode === "embed", demo = !!o.demo;
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const wrap = document.createElement("div");
  wrap.className = `bz ${mode}${demo ? " demo" : ""}`;
  wrap.innerHTML = `<canvas></canvas>
<div class="hud"><div class="k"><small>KILLS</small><b data-k>0</b></div><div class="t"><small>${embed ? "RANK" : "TIME"}</small><b data-t>3:00</b></div><div class="lead"><small>LEADER</small><b data-lead>—</b></div></div>
<ol class="feed"><li></li><li></li><li></li><li></li></ol>
<div class="keys"><button class="key" type="button" data-strike aria-label="Airstrike"><b>✚</b><span data-sn>1</span></button></div>
<div class="help fine-only">WASD MOVE · MOUSE AIM · CLICK/SPACE FIRE · Q AIRSTRIKE${embed ? " · ESC CLOSE" : " · ESC PAUSE"}</div>
<div class="help touch-only">DRAG LEFT TO DRIVE · AUTO-FIRE · ✚ AIRSTRIKE</div>
<div class="over" data-over hidden></div>`;
  root.append(style, wrap);
  const $ = <T extends Element>(s: string) => wrap.querySelector<T>(s)!;
  const canvas = $<HTMLCanvasElement>("canvas"), ctx = canvas.getContext("2d")!;
  const over = $<HTMLElement>("[data-over]"), strikeKey = $<HTMLButtonElement>("[data-strike]");
  const hud = { k: $<HTMLElement>("[data-k]"), t: $<HTMLElement>("[data-t]"), lead: $<HTMLElement>("[data-lead]"), sn: $<HTMLElement>("[data-sn]") };
  const feed = [...wrap.querySelectorAll<HTMLLIElement>(".feed li")];

  const e = createEngine({ root: wrap, seed: (Math.random() * 1e9) | 0, events: 96 });
  const input = controls(e, {
    keys: { up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"], fire: ["Space"], strike: ["KeyQ", "KeyE"], pause: ["Escape", "KeyP"] },
    target: canvas,
    stick: "left",
  });
  const fx = effects({ cap: 520, words: WORDS, colors: FX_COLORS });
  const sfx = sound(e, { cues: { shot: "fire", boom: "boom", hit: "hit", power: "power", strike: "hurt", land: "click", win: "win", end: "end", ready: "ready" } });
  const drawTank = tankSprites(document);
  const R = Math.random;

  // ---------- World ----------
  let W = 0, H = 0, dpr = 1, scale = 1.4, T = 44, cols = 0, rows = 0;
  let clock = o.seconds ?? 180, state: "intro" | "count" | "play" | "end" | "paused" = embed || demo ? "play" : "intro", count = 0;
  const N = 1 + (o.bots ?? (embed ? 5 : 7));
  const tanks: Tank[] = Array.from({ length: N }, (_, i) => ({
    i, name: demo && i === 0 ? "ACE" : NAMES[i % NAMES.length]!, color: COLORS[i % COLORS.length]!, you: i === 0,
    x: 0, y: 0, a: 0, ta: 0, hp: 3, alive: false, dead: 0.2 + i * 0.18, drop: 0, shield: 0, rapid: 0, triple: 0, strikes: i === 0 ? 1 : 0,
    cool: 0, kills: 0, deaths: 0, recoil: 0, flash: 0, tread: 0, streak: 0, streakT: 0, gx: 0, gy: 0, think: 0, target: -1, lastHit: -1,
  }));
  const you = tanks[0]!;
  if (demo) you.you = false;
  const shells: Shell[] = Array.from({ length: 120 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, owner: 0, on: false }));
  const tiles: Tile[] = Array.from({ length: 8 }, () => ({ c: 0, r: 0, type: 0, roll: 0, t: 0, on: false }));
  const strikes: Strike[] = Array.from({ length: 18 }, () => ({ x: 0, y: 0, t: 0, owner: 0, on: false, main: false }));
  const blocks: Block[] = [];
  let covers: Cover[] = [], coverDirty = true, coverAt = 0;
  const anims = new Set<Animation>();
  let tileIn = 1.2, lightTheme = false, feedAt = 0;

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

  // ---------- Spawning: everyone parachutes in ----------
  function spawn(t: Tank) {
    let x = 0, y = 0;
    for (let k = 0; k < 24; k++) {
      x = 40 + R() * (W - 80);
      y = 70 + R() * (H - 130);
      let ok = !blocked(x, y, 22 * scale);
      for (const o2 of tanks) if (o2 !== t && o2.alive && Math.hypot(o2.x - x, o2.y - y) < 160) ok = false;
      if (ok) break;
    }
    Object.assign(t, { x, y, a: R() * TAU, hp: 3, alive: true, drop: 0, shield: 0, rapid: 0, triple: 0, cool: 0.6, recoil: 0, think: 0, target: -1, gx: x, gy: y, streak: 0 });
    t.ta = t.a;
  }

  // ---------- Combat ----------
  function fire(t: Tank) {
    const len = 24 * scale, spreads = t.triple > 0 ? 3 : 1;
    for (let k = 0; k < spreads; k++) {
      const s = shells.find((q) => !q.on);
      if (!s) break;
      const a = t.ta + (spreads > 1 ? (k - 1) * 0.2 : 0) + (t.you ? 0 : (R() - 0.5) * 0.12);
      s.on = true;
      s.x = t.x + Math.cos(a) * len;
      s.y = t.y + Math.sin(a) * len;
      s.vx = Math.cos(a) * 560;
      s.vy = Math.sin(a) * 560;
      s.life = 1.05;
      s.owner = t.i;
    }
    t.recoil = 6;
    t.flash = 0.08;
    t.cool = t.rapid > 0 ? 0.16 : t.you ? 0.42 : 0.7 + R() * 0.4;
    fx.spawn(1, t.x + Math.cos(t.ta) * len, t.y + Math.sin(t.ta) * len, 0, 0, 9, 0.12, 0);
    e.events.emit("shot", t.i);
  }
  function kill(t: Tank, by: number, word = W_BOOM) {
    if (!t.alive) return;
    t.alive = false;
    t.dead = 2.2;
    t.deaths++;
    const k = by >= 0 && by !== t.i ? tanks[by]! : null;
    if (k) {
      k.kills++;
      k.streak = k.streakT > 0 ? k.streak + 1 : 1;
      k.streakT = 3;
      if (k.streak === 2) fx.word(k.x, k.y - 40, W_DOUBLE, 1, 18);
      if (k.streak >= 3) fx.word(k.x, k.y - 40, W_RAMPAGE, 3, 20);
      if (k.you) fx.word(k.x, k.y - 26, W_PLUS, 5, 18);
    }
    fx.blast(t.x, t.y, 2.2, 3);
    fx.blast(t.x + (R() - 0.5) * 30, t.y + (R() - 0.5) * 30, 1.2, 1);
    for (let n = 0; n < 9; n++) {
      const a = R() * TAU, sp = 90 + R() * 140;
      fx.spawn(0, t.x, t.y, Math.cos(a) * sp, Math.sin(a) * sp, (7 + R() * 7) * (scale / 1.4), 1.1, n % 3 ? 5 : 7, R() * TAU, (R() - 0.5) * 24);
    }
    fx.word(t.x, t.y - 18, word === W_BOOM ? (R() * 5) | 0 : word, 3, 18);
    if (t.you) fx.kick(10);
    e.events.emit("boom", t.i, by);
    say(k ? `<i style="color:${k.color}">${k.name}</i> ✕ <i style="color:${t.color}">${t.name}</i>` : `<i style="color:${t.color}">${t.name}</i> ✕ 💥`);
  }
  function damage(t: Tank, by: number, amount: number) {
    if (!t.alive || t.drop < 1) return false;
    if (t.shield > 0) {
      fx.spawn(2, t.x, t.y, 0, 0, 18, 0.3, 4);
      return false;
    }
    t.hp -= amount;
    t.lastHit = by;
    e.events.emit("hit", t.i);
    if (t.hp <= 0) kill(t, by);
    return true;
  }
  function callStrike(owner: number, x: number, y: number) {
    const t = tanks[owner]!;
    if (t.strikes <= 0 || !t.alive) return;
    t.strikes--;
    let k = 0;
    for (const s of strikes) {
      if (s.on) continue;
      s.on = true;
      s.owner = owner;
      s.main = k === 0;
      s.x = x + (k ? (R() - 0.5) * 70 : 0);
      s.y = y + (k ? (R() - 0.5) * 60 : 0);
      s.t = 0.75 + k * 0.14;
      if (++k === 3) break;
    }
    e.events.emit("strike", owner);
  }
  function detonate(s: Strike) {
    fx.blast(s.x, s.y, s.main ? 3.2 : 1.8, s.main ? 3 : 2);
    if (s.main) fx.word(s.x, s.y - 30, W_STRIKE, 3, 22);
    const rad = (s.main ? 95 : 70) * (scale / 1.4);
    for (const t of tanks) if (Math.hypot(t.x - s.x, t.y - s.y) < rad) damage(t, s.owner, 3);
    for (const b of blocks) if (b.hp > 0 && Math.hypot(b.x + b.w / 2 - s.x, b.y + b.h / 2 - s.y) < rad + 20) wreckBlock(b);
    if (embed) for (const c of covers) {
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2, d = Math.hypot(cx - s.x, cy - s.y);
      if (d < rad * 2) knock(c, (cx - s.x) / (d || 1), (cy - s.y) / (d || 1), 2.4 - d / rad, false);
    }
    e.events.emit("boom", -1);
  }
  function wreckBlock(b: Block) {
    b.hp = 0;
    b.back = 12;
    for (let n = 0; n < 8; n++) {
      const a = R() * TAU, sp = 60 + R() * 140;
      fx.spawn(0, b.x + b.w / 2, b.y + b.h / 2, Math.cos(a) * sp, Math.sin(a) * sp, 6 + R() * 6, 0.8, 6, R() * TAU, (R() - 0.5) * 18);
    }
  }
  function say(html: string) {
    const li = feed[feedAt++ % feed.length]!;
    li.innerHTML = html;
    wrap.querySelector(".feed")!.prepend(li);
    li.animate?.([{ opacity: 0, transform: "translateX(20px)" }, { opacity: 1, transform: "none" }], { duration: 200 });
  }

  // ---------- Power tiles: the blinking grid ----------
  function lightTile() {
    const s = tiles.find((q) => !q.on);
    if (!s || cols < 3 || rows < 3) return;
    s.on = true;
    s.c = 1 + Math.floor(R() * (cols - 2));
    s.r = 1 + Math.floor(R() * (rows - 2));
    const roll = R();
    s.type = roll < 0.22 ? RAPID : roll < 0.42 ? TRIPLE : roll < 0.62 ? STRIKE : roll < 0.78 ? SHIELD : MINE;
    s.roll = 1.1; // slot-machine colours first, then it settles
    s.t = 7.5;
  }
  function takeTile(s: Tile, t: Tank) {
    s.on = false;
    const cx = (s.c + 0.5) * T, cy = (s.r + 0.5) * T;
    if (s.type === MINE) {
      fx.blast(cx, cy, 2.6, 3);
      fx.word(cx, cy - 26, W_MINE, 3, 20);
      for (const o2 of tanks) if (Math.hypot(o2.x - cx, o2.y - cy) < 80 * (scale / 1.4)) damage(o2, -1, 3);
      e.events.emit("boom", -1);
      return;
    }
    if (s.type === RAPID) t.rapid = 8;
    if (s.type === TRIPLE) t.triple = 8;
    if (s.type === SHIELD) t.shield = 6;
    if (s.type === STRIKE) t.strikes = Math.min(3, t.strikes + 1);
    fx.spawn(2, cx, cy, 0, 0, 20, 0.5, s.type === STRIKE ? 3 : 5);
    fx.word(cx, cy - 22, W_POWER + [0, 0, 1, 3, 2][s.type - 1]!, s.type === STRIKE ? 3 : 5, 15);
    e.events.emit("power", t.i);
  }

  // ---------- The simulation ----------
  const nearestEnemy = (t: Tank, range: number) => {
    let best = -1, bd = range;
    for (const o2 of tanks) {
      if (o2 === t || !o2.alive || o2.drop < 1) continue;
      const d = Math.hypot(o2.x - t.x, o2.y - t.y);
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
  }
  function bot(t: Tank, dt: number) {
    t.think -= dt;
    if (t.think <= 0) {
      t.think = 0.7 + R() * 0.9;
      t.target = nearestEnemy(t, 9999);
      const lit = tiles.find((s) => s.on && s.roll <= 0 && s.type !== MINE && Math.hypot((s.c + 0.5) * T - t.x, (s.r + 0.5) * T - t.y) < 380);
      if (lit && R() < 0.45) (t.gx = (lit.c + 0.5) * T), (t.gy = (lit.r + 0.5) * T);
      else if (t.target >= 0) {
        const o2 = tanks[t.target]!, a = Math.atan2(t.y - o2.y, t.x - o2.x) + (R() - 0.5) * 1.6, keep = 120 + R() * 120;
        t.gx = Math.max(30, Math.min(W - 30, o2.x + Math.cos(a) * keep));
        t.gy = Math.max(60, Math.min(H - 30, o2.y + Math.sin(a) * keep));
      } else (t.gx = 40 + R() * (W - 80)), (t.gy = 70 + R() * (H - 120));
      if (t.strikes > 0 && t.target >= 0 && R() < 0.35) {
        const o2 = tanks[t.target]!;
        callStrike(t.i, o2.x, o2.y);
      }
    }
    const dx = t.gx - t.x, dy = t.gy - t.y, d = Math.hypot(dx, dy);
    if (d > 16) {
      const before = t.x + t.y;
      drive(t, dx / d, dy / d, dt * 0.85);
      if (Math.abs(t.x + t.y - before) < 0.01) t.think = Math.min(t.think, 0.05); // stuck: rethink
    }
    const o2 = t.target >= 0 ? tanks[t.target]! : null;
    if (o2 && o2.alive && o2.drop >= 1) {
      const aim = Math.atan2(o2.y - t.y, o2.x - t.x);
      t.ta = turn(t.ta, aim, 4.5 * dt);
      const err = Math.abs(Math.atan2(Math.sin(aim - t.ta), Math.cos(aim - t.ta)));
      if (t.cool <= 0 && err < 0.12 && Math.hypot(o2.x - t.x, o2.y - t.y) < 460) fire(t);
    } else t.ta = turn(t.ta, t.a, 3 * dt);
  }
  function player(dt: number) {
    const t = you;
    const ax = input.axis("left", "right", 0), ay = input.axis("up", "down", 1);
    drive(t, ax, ay, dt);
    const touch = input.stick.active || coarse.matches;
    if (touch) {
      // Phones: the turret finds the nearest enemy and fires when it's lined up.
      const k = nearestEnemy(t, 440);
      if (k >= 0) {
        const o2 = tanks[k]!, aim = Math.atan2(o2.y - t.y, o2.x - t.x);
        t.ta = turn(t.ta, aim, 7 * dt);
        if (t.cool <= 0 && Math.abs(Math.atan2(Math.sin(aim - t.ta), Math.cos(aim - t.ta))) < 0.15) fire(t);
      } else t.ta = turn(t.ta, t.a, 4 * dt);
    } else {
      t.ta = turn(t.ta, Math.atan2(input.pointer.y - t.y, input.pointer.x - t.x), 10 * dt);
      if ((input.pointer.down || input.down("fire")) && t.cool <= 0) fire(t);
    }
    if (input.hit("strike") || strikeQueued) {
      strikeQueued = false;
      if (touch) {
        const k = nearestEnemy(t, 9999);
        if (k >= 0) callStrike(0, tanks[k]!.x, tanks[k]!.y);
      } else callStrike(0, input.pointer.x, input.pointer.y);
    }
  }
  let strikeQueued = false;
  const coarse = matchMedia("(pointer: coarse)"), fine = matchMedia("(pointer: fine)");

  e.add({
    read() {
      if (embed && coverDirty && performance.now() - coverAt > 120) {
        coverDirty = false;
        coverAt = performance.now();
        measureCovers();
      }
      if (input.hit("pause") && !embed) togglePause();
    },
    step(_, dt) {
      fx.step(dt);
      if (state === "count") {
        count -= dt;
        if (count <= 0) begin();
        return;
      }
      if (state !== "play") return;
      if (!embed && !demo) {
        clock -= dt;
        if (clock <= 0) return void end();
      }
      // Tiles blink in.
      tileIn -= dt;
      if (tileIn <= 0) (lightTile(), (tileIn = 1.6 + R() * 2.2));
      for (const s of tiles) {
        if (!s.on) continue;
        if (s.roll > 0) s.roll -= dt;
        else if ((s.t -= dt) <= 0) {
          s.on = false;
          if (s.type === MINE) takeTile(s, you); // a mine left alone goes off by itself
        }
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
        if (t.you) player(dt);
        else bot(t, dt);
        t.x = Math.max(18, Math.min(W - 18, t.x));
        t.y = Math.max(54, Math.min(H - 18, t.y));
        // Tiles under the tracks.
        for (const s of tiles) if (s.on && s.roll <= 0 && inRect(t.x, t.y, s.c * T, s.r * T, T, T)) takeTile(s, t);
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
            const k = (min - d) / 2 / d;
            (p.x -= dx * k), (p.y -= dy * k), (q.x += dx * k), (q.y += dy * k);
          }
        }
      // Shells: swept hits so fast shots never pass through.
      for (const s of shells) {
        if (!s.on) continue;
        const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
        s.life -= dt;
        let done = s.life <= 0 || nx < -20 || ny < -20 || nx > W + 20 || ny > H + 20;
        for (const t of tanks) {
          if (done || t.i === s.owner || !t.alive || t.drop < 1) continue;
          if (segCircle(s.x, s.y, nx, ny, t.x, t.y, 15 * scale) >= 0) {
            done = true;
            fx.blast(t.x, t.y, 1, 4);
            damage(t, s.owner, 1);
          }
        }
        const b = done ? null : blocked(nx, ny, 2);
        if (b) {
          done = true;
          fx.blast(nx, ny, 0.8, 2);
          if (--b.hp <= 0) wreckBlock(b);
        }
        if (!done && embed)
          for (const c of covers)
            if (inRect(nx, ny, c.x, c.y, c.w, c.h) && R() < 0.5) {
              done = true;
              fx.blast(nx, ny, 0.9, 4);
              const d = Math.hypot(s.vx, s.vy) || 1;
              knock(c, s.vx / d, s.vy / d, 1.2, false);
              break;
            }
        if (done) {
          if (s.life <= 0 && !b) fx.spawn(1, s.x, s.y, 0, 0, 6, 0.15, 1);
          s.on = false;
        } else (s.x = nx), (s.y = ny);
      }
      // Airstrikes land.
      for (const s of strikes) if (s.on && (s.t -= dt) <= 0) (s.on = false), detonate(s);
    },
    render() {
      hudFrame();
      draw();
    },
  });

  // ---------- Match flow ----------
  function intro() {
    state = "intro";
    over.hidden = false;
    over.innerHTML = `<div class="sticker"><span>FREE FOR ALL · MOST KILLS WINS</span><b>BLITZ</b></div><div class="row"><button class="key go" type="button" data-go>PRESS START</button></div>`;
    over.querySelector<HTMLButtonElement>("[data-go]")!.addEventListener("click", countdown, { signal: e.signal });
  }
  function countdown() {
    state = "count";
    count = 2.4;
    over.hidden = false;
    over.innerHTML = `<div class="count" data-c>3</div>`;
    e.events.emit("ready", 0);
  }
  function begin() {
    state = "play";
    over.hidden = true;
    over.innerHTML = "";
  }
  function standings() {
    return tanks.map((t) => ({ name: t.name, kills: t.kills, deaths: t.deaths, you: t.you })).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }
  function end() {
    state = "end";
    const st = standings(), won = st[0]!.you;
    e.events.emit(won ? "win" : "end", 0);
    over.hidden = false;
    over.innerHTML = `<div class="sticker"><span>MATCH OVER</span><b>${won ? "YOU WIN" : `${st[0]!.name} WINS`}</b></div>
<div class="table">${st.slice(0, 5).map((s, i) => `<div class="${s.you ? "you" : ""}"><span>${i + 1}. ${s.name}</span><span>${s.kills} K · ${s.deaths} D</span></div>`).join("")}</div>
<div class="row"><button class="key go" type="button" data-again>REMATCH</button></div>`;
    over.querySelector("[data-again]")!.addEventListener("click", rematch, { signal: e.signal });
    o.onEnd?.(st);
  }
  function rematch() {
    clock = o.seconds ?? 180;
    for (const t of tanks) Object.assign(t, { kills: 0, deaths: 0, alive: false, dead: 0.2 + t.i * 0.15, strikes: t.you ? 1 : 0 });
    for (const s of shells) s.on = false;
    for (const s of tiles) s.on = false;
    for (const s of strikes) s.on = false;
    fx.clear();
    if (!embed) layBlocks();
    countdown();
  }
  function togglePause() {
    if (state === "play") {
      state = "paused";
      over.hidden = false;
      over.innerHTML = `<div class="sticker"><span>BLITZ PAUSED</span><b>HOLD FIRE</b></div><div class="row"><button class="key go" type="button" data-resume>KEEP FIGHTING</button></div>`;
      over.querySelector("[data-resume]")!.addEventListener("click", togglePause, { signal: e.signal });
    } else if (state === "paused") begin();
  }

  // ---------- HUD (change-only writes) ----------
  const last = { k: "", t: "", lead: "", sn: "", dis: false, count: "" };
  function hudFrame() {
    const k = String(you.kills);
    let lead = tanks[0]!;
    for (const t of tanks) if (t.kills > lead.kills) lead = t;
    let rank = 1;
    for (const t of tanks) if (t.kills > you.kills) rank++;
    const tt = embed ? `#${rank}` : `${Math.floor(Math.max(0, clock) / 60)}:${String(Math.floor(Math.max(0, clock) % 60)).padStart(2, "0")}`;
    const ld = lead.kills ? `${lead.name} ${lead.kills}` : "—";
    if (k !== last.k) hud.k.textContent = last.k = k;
    if (tt !== last.t) hud.t.textContent = last.t = tt;
    if (ld !== last.lead) hud.lead.textContent = last.lead = ld;
    const sn = String(you.strikes);
    if (sn !== last.sn) hud.sn.textContent = last.sn = sn;
    const dis = you.strikes <= 0 || !you.alive;
    if (dis !== last.dis) strikeKey.disabled = last.dis = dis;
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
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const sh = fx.shake, sx = sh ? (R() - 0.5) * sh : 0, sy = sh ? (R() - 0.5) * sh : 0;
    ctx.translate(sx, sy);
    if (!embed) {
      // The arena: a dark grid like the game's map.
      ctx.fillStyle = "#090818";
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.strokeStyle = "rgba(25,240,255,.09)";
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
      ctx.globalAlpha = (embed ? 0.75 : 0.35) * pulse;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, w);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, w, w);
      if (!rolling) {
        ctx.fillStyle = s.type === SHIELD || s.type === MINE ? "#07060f" : "#f6f3ff";
        if (s.type === MINE) ctx.fillStyle = "#fff";
        ctx.font = `900 ${Math.round(T * 0.48)}px ui-monospace,monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(TILE_ICON[s.type]!, x + w / 2, y + w / 2 + 1);
        if (s.t < 2 && ((now * 6) | 0) % 2) ctx.globalAlpha = 0.3;
      }
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
      ctx.fillStyle = "#1a1430";
      ctx.strokeStyle = b.hp === 3 ? "#ff8a1f" : b.hp === 2 ? "#ffc21a" : "#ff2b4e";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(b.x + b.w / 2 - 6, b.y + b.h / 2 - 2, 12, 4);
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
        const y = t.y - lift, sway = Math.sin(now * 3 + t.i) * 0.12 * k;
        ctx.save();
        ctx.translate(t.x, y);
        ctx.rotate(sway);
        // Canopy: striped dome in the tank's colour, strings to the tank.
        const cw = 34 * sc, cy = -46 * sc;
        ctx.strokeStyle = "#f6f3ff";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (const fx2 of [-1, -0.4, 0.4, 1]) (ctx.moveTo(fx2 * cw * 0.95, cy), ctx.lineTo(fx2 * 8 * sc, -8 * sc));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, cy, cw, Math.PI, 0);
        ctx.closePath();
        ctx.fillStyle = t.color;
        ctx.fill();
        ctx.fillStyle = "#f6f3ff";
        for (let k2 = -2; k2 <= 2; k2 += 2) {
          ctx.beginPath();
          ctx.moveTo(0, cy - cw);
          ctx.lineTo(k2 * cw * 0.28 - cw * 0.12, cy);
          ctx.lineTo(k2 * cw * 0.28 + cw * 0.12, cy);
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
        drawTank(ctx, t.x, y, t.a + sway, t.ta + sway, t.color, t.tread, 0, false, sc);
      } else {
        if (t.shield > 0 && (t.shield > 1.5 || ((now * 10) | 0) % 2)) {
          ctx.strokeStyle = "#f6f3ff";
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(t.x, t.y, 24 * scale, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        drawTank(ctx, t.x, t.y, t.a, t.ta, t.color, t.tread, t.recoil, t.flash > 0, scale);
        if (t.rapid > 0 || t.triple > 0) {
          ctx.fillStyle = t.triple > 0 ? "#19f0ff" : "#39ffb0";
          ctx.fillRect(t.x - 12, t.y + 20 * scale, 24 * Math.max(t.rapid, t.triple) / 8, 3);
        }
      }
      // Name tag and health pips.
      const ty = (t.drop < 1 ? t.y - (1 - t.drop) * 150 - 70 * scale : t.y - 24 * scale) - 4;
      ctx.font = `800 ${t.you ? 11 : 10}px ui-monospace,monospace`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#07060f";
      ctx.strokeText(t.you ? "▼ YOU" : t.name, t.x, ty);
      ctx.fillStyle = t.color;
      ctx.fillText(t.you ? "▼ YOU" : t.name, t.x, ty);
      if (t.drop >= 1)
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = k < t.hp ? (t.hp === 1 ? "#ff2b4e" : t.color) : "rgba(174,164,214,.3)";
          ctx.fillRect(t.x - 11 + k * 8, ty + 4, 6, 3);
        }
    }
    // Shells.
    ctx.lineCap = "round";
    for (const s of shells) {
      if (!s.on) continue;
      const c = tanks[s.owner]!.color;
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.035, s.y - s.vy * 0.035);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#fff4ff";
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    // Strike reticles.
    for (const s of strikes) {
      if (!s.on || !s.main) continue;
      const k = Math.max(0, s.t / 0.75), r = 30 + 70 * k;
      ctx.strokeStyle = "#ff2e88";
      ctx.lineWidth = 3;
      ctx.globalAlpha = 1 - k * 0.4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, TAU);
      ctx.moveTo(s.x - r - 12, s.y);
      ctx.lineTo(s.x - r + 14, s.y);
      ctx.moveTo(s.x + r - 14, s.y);
      ctx.lineTo(s.x + r + 12, s.y);
      ctx.moveTo(s.x, s.y - r - 12);
      ctx.lineTo(s.x, s.y - r + 14);
      ctx.moveTo(s.x, s.y + r - 14);
      ctx.lineTo(s.x, s.y + r + 12);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    fx.draw(ctx, lightTheme);
    // Aim cursor (desktop).
    if (!demo && you.alive && !input.stick.active && fine.matches) {
      ctx.strokeStyle = "#39ffb0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(input.pointer.x, input.pointer.y, 9, 0, TAU);
      ctx.stroke();
    }
  }

  // ---------- Wiring ----------
  strikeKey.addEventListener("pointerdown", (ev) => (ev.stopPropagation(), (strikeQueued = true)), { signal: e.signal });
  canvas.addEventListener("contextmenu", (ev) => (ev.preventDefault(), (strikeQueued = true)), { signal: e.signal });
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
    world: { tanks, tiles, shells, blocks },
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
