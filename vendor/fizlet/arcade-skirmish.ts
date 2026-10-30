// fizlet/arcade's `skirmish` preset (Battlefield Blitz's HUD): a bar across the top with the title,
// readouts (kills, clock, rank, an armor bar, streak…), aim toggles, action keys with counts and
// header keys; a feed and a banner driven by the event ring; the pad on phones with counted keys and
// aim toggles. Values go through fizlet/hud: change-only, from typed-array slots, nothing allocated
// in the steady state. The run's flow (countdown, pause / surrender, result: BOARD-UI.md §9) is
// fizlet/match on a small engine of its own that lives as long as the overlay: its clock runs the
// countdown while the game's engine waits, and its END sticker outlives the game's engine (whose end
// gives the page back) until REMATCH, EXIT or Recall. Match owns the phase; the shell asks it.
import type { ArcadeHud, HudView } from "./arcade";
import { ICON, esc } from "./arcade-parts";
import { hud } from "./hud";
import { createEngine } from "./kernel/engine";
import { match } from "./match";
import type { Phase } from "./match";
import { pad } from "./pad";
import type { PadAction } from "./pad";
import { toast } from "./ui/board-ui";

/** One readout on the skirmish bar: its label, how the value shows and its tone. */
export interface SkirmishReadout {
  label: string;
  /** How the value shows: `num` (default) 12 · `clock` 3:05 from seconds · `rank` #2 · `pct` 75%
   *  from 0..1 · `bar` a meter from 0..1 (armor, health). */
  kind?: "num" | "clock" | "rank" | "pct" | "bar";
  tone?: "team" | "enemy";
  /** A bar: class `low` at or under this (0..1). */
  low?: number;
}
/** Options for the `skirmish` HUD preset: its readouts, header and nav keys, feed, banner, overlays,
 *  result, aim toggles and key counts. */
export interface SkirmishOptions {
  /** Readouts, in the order `hud(out)` fills them. */
  readouts: SkirmishReadout[];
  /** Header keys, in order (default full screen, sound, pause, exit; `fold` hides the title and the
   *  text keys). Full screen shows only where the page may use it. */
  header?: ("fullscreen" | "sound" | "pause" | "fold" | "exit")[];
  /** Text keys after the actions, as on the card (default none): `next` (Next gate, G), `restart`,
   *  `auto` (Auto fire: needs `fire`). */
  nav?: ("next" | "restart" | "auto")[];
  /** A feed of the last `rows` (default 4) events of type `on`, newest first. */
  feed?: { rows?: number; on: string; line: (a: number, b: number) => string };
  /** A centred banner (title, sub) on each event of type `on`. */
  banner?: { on: string; text: (a: number, b: number) => readonly [string, string?] };
  /** Overlays (default all four; fizlet/match runs the flow either way). `countdown` holds the start
   *  for 3, 2, 1 on the flow's clock; without `pause` or `result` that phase shows no overlay; without
   *  `surrender` the pause card has no SURRENDER key. */
  overlays?: ("pause" | "surrender" | "countdown" | "result")[];
  /** The result card: `stats()` keys to list, and the one whose best is kept on this device. */
  result?: { stats: string[]; best?: string };
  /** Aim toggles: the intents `aim-auto` and `aim-lock` (`ctx.input.down("aim-lock")`). */
  aim?: ("auto" | "lock")[];
  /** Counted keys: action id → the `hud(out)` slot of its count, a badge on its keys. */
  counts?: Record<string, number>;
}

const CSS = `
.sk{position:absolute;left:50%;top:max(10px,env(safe-area-inset-top));translate:-50% 0;max-width:calc(100% - 20px);display:flex;align-items:center;gap:14px;padding:8px 10px 8px 14px;pointer-events:auto;color:var(--ink);background:color-mix(in srgb,var(--card) 94%,transparent);border:2.5px solid var(--line);border-radius:10px;box-shadow:0 5px 0 var(--rim)}
.sk>b{font:900 11px/1 ui-monospace,monospace;letter-spacing:.14em;color:var(--team-a);white-space:nowrap}
.sk .bui-readouts{gap:16px}.sk .bui-readout b{font-size:16px;margin-top:3px}
.sk .bui-readout i{display:block;width:72px;height:8px;margin-top:7px;border-radius:3px;background:var(--surface);border:1.5px solid var(--line);overflow:hidden}
.sk .bui-readout u{display:block;height:100%;width:0;background:var(--team-a)}.sk u.low{background:var(--hurt)}
.sk nav{display:flex;gap:6px;margin-left:auto}.sk nav button{position:relative;min-width:34px;height:34px;min-height:0;padding:0 8px;display:grid;place-items:center;font:800 10px/1 ui-monospace,monospace;letter-spacing:.08em;white-space:nowrap}.sk nav svg{width:18px;height:18px}
.bui .bui-badge:empty{display:none}.sk .bui-badge{top:-8px;right:-8px;min-width:18px;height:18px;font-size:10px;line-height:15px}
.sk-feed{position:absolute;left:max(12px,env(safe-area-inset-left));top:80px;margin:0;padding:0;list-style:none;display:grid;gap:4px;font:700 11px/1.3 ui-monospace,monospace;color:var(--ink)}
.sk-feed li{padding:3px 8px;background:color-mix(in srgb,var(--surface) 85%,transparent);border-left:3px solid var(--team-a);border-radius:4px}.sk-feed li:empty{display:none}
.sk-ban{position:absolute;left:50%;top:24%;translate:-50% 0;display:grid;justify-items:center;gap:6px;padding:10px 18px;color:var(--ink);background:color-mix(in srgb,var(--surface) 94%,transparent);border:2px solid var(--line);border-radius:8px;box-shadow:0 4px 0 var(--rim);opacity:0}
.sk-ban b{font:900 28px/1 ui-monospace,monospace;letter-spacing:.1em}.sk-ban span{font:800 11px/1 ui-monospace,monospace;letter-spacing:.2em;color:var(--team-a)}
.sk-ban.a{animation:ska 1.8s both}.sk-ban.b{animation:skb 1.8s both}
@keyframes ska{0%{opacity:0;scale:1.4}12%,75%{opacity:1;scale:1}100%{opacity:0}}@keyframes skb{0%{opacity:0;scale:1.4}12%,75%{opacity:1;scale:1}100%{opacity:0}}
.bui .bui-overlay{pointer-events:auto}.bui .msg{z-index:31;bottom:auto;top:max(84px,calc(env(safe-area-inset-top) + 74px))}.sk.compact>b,.sk.compact nav>:not([aria-label]){display:none}
.sk-res{position:absolute;left:50%;top:58%;translate:-50% 0;display:grid;grid-template-columns:auto auto;gap:6px 18px;margin:0;font:800 12px/1 ui-monospace,monospace;letter-spacing:.12em;color:#f6f3ff}.sk-res dd{margin:0;text-align:right}
@media (pointer:coarse),(max-width:600px){.sk{width:calc(100% - 20px);flex-wrap:wrap;justify-content:space-between;gap:6px 8px;padding:6px 8px}.sk>b,.sk [data-act],.sk [data-aim]{display:none}.sk nav{flex-wrap:wrap;justify-content:flex-end}.sk .bui-readouts{gap:12px}.sk .bui-readout i{width:48px}.sk-feed{top:max(112px,calc(env(safe-area-inset-top) + 102px))}.bui .msg{top:max(160px,calc(env(safe-area-inset-top) + 150px))}}
@media (prefers-reduced-motion:reduce){.sk-ban.a,.sk-ban.b{opacity:1}}`;
// EXIT on the result card (match's second END key): a filled cross, the kit's sticker-key icon rule.
const CROSS = '<svg viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges"><path d="m10 16 6-6 16 16 16-16 6 6-16 16 16 16-6 6-16-16-16 16-6-6 16-16Z"/></svg>';
const FULL = '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/></svg>';
const NAME = { fullscreen: "Full screen", sound: "Mute game sound", pause: "Pause game (P)", fold: "Minimize scoreboard", exit: "Close game and restore page (Esc)" };
const NAV = { next: '<button type="button" data-a="gate">Next gate</button>', restart: '<button type="button" data-a="restart">Restart</button>', auto: '<button type="button" data-a="auto" aria-pressed="false">Auto fire</button>' };
const FMT = { num: "int", clock: "clock", rank: "rank", pct: "pct" } as const;

/**
 * The `skirmish` preset (Battlefield Blitz): `hud: skirmishHud({ readouts: [{ label: "Kills",
 * tone: "team" }, { label: "Time", kind: "clock" }, { label: "Armor", kind: "bar", low: 0.3 }] })`.
 * `hud(out)` fills the readouts in order, then any count slots.
 */
export function skirmishHud(o: SkirmishOptions): ArcadeHud {
  const R = o.readouts, ov = o.overlays ?? ["pause", "surrender", "countdown", "result"], aims = (o.aim ?? []).map((a) => "aim-" + a);
  const counts = o.counts ?? {}, keys: Record<string, string[]> = {}, give = ov.includes("surrender");
  for (const a of aims) keys[a] = [];
  return {
    css: CSS + (give ? "" : ".bui-overlay [data-k=surrender]{display:none!important}"),
    keys,
    mount(r): HudView {
      const { ui, def, engine: e, input } = r, actions = def.actions ?? [], doc = ui.ownerDocument;
      const head = (o.header ?? ["fullscreen", "sound", "pause", "exit"]).filter((k) => k !== "fullscreen" || doc.fullscreenEnabled);
      const badge = (id: string) => (id in counts ? '<b class="bui-badge"></b>' : "");
      const aimLabel = (a: string) => (a === "aim-auto" ? "Auto aim" : "Lock");
      ui.insertAdjacentHTML("beforeend", `<section class="sk" aria-label="${esc(def.title)} controls"><b>${esc(def.title.toUpperCase())}</b><div class="bui-readouts">${R.map((x) => `<span class="bui-readout"${x.tone ? ` data-tone="${x.tone}"` : ""}>${esc(x.label)}${x.kind === "bar" ? `<i><u role="progressbar" aria-label="${esc(x.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></u></i>` : "<b></b>"}</span>`).join("")}</div><nav>${aims
        .map((a) => `<button type="button" data-a="aim" data-aim="${a}" aria-pressed="false">${aimLabel(a)}</button>`)
        .join("")}${actions.map((a) => `<button type="button" data-act="${esc(a.id)}">${esc(a.label)}${badge(a.id)}</button>`).join("")}${(o.nav ?? [])
        .filter((k) => k !== "auto" || def.fire)
        .map((k) => NAV[k])
        .join("")}${head
        .map((k) => `<button type="button" data-a="${k === "fullscreen" ? "full" : k}"${k === "fold" ? ' aria-expanded="true"' : ""} aria-label="${NAME[k]}">${k === "fullscreen" ? FULL : ICON[k]}</button>`)
        .join("")}</nav></section>
${o.feed ? '<ol class="sk-feed" aria-label="Feed"></ol>' : ""}${o.banner ? '<div class="sk-ban" role="status"><b></b><span></span></div>' : ""}
<div class="bui-toast msg" role="status" hidden></div><dl class="sk-res"></dl>`);
      const $ = <T extends Element = HTMLElement>(s: string) => ui.querySelector<T>(s);
      const bar = $(".sk")!, group = bar.children[1]!, msg = $(".msg")!, res = $(".sk-res")!;
      const k = { sound: $<HTMLButtonElement>("[data-a=sound]"), pause: $<HTMLButtonElement>("[data-a=pause]"), fold: $<HTMLButtonElement>("[data-a=fold]") };
      const aimKeys = bar.querySelectorAll<HTMLElement>("[data-aim]"), lit = new Uint8Array(aims.length);

      // Values: one typed array the game fills, bound slot by slot (a slot never boxes).
      let n = R.length;
      for (const id in counts) n = Math.max(n, counts[id]! + 1);
      const out = new Float64Array(n), h = hud(e, ui);
      e.remove(h.system); // run from write, right after the game fills `out`
      group.querySelectorAll<HTMLElement>(".bui-readout > b,.bui-readout u").forEach((el, i) => {
        const x = R[i]!;
        x.kind === "bar" ? h.meter(el, [out, i], x.low) : h.num(el, [out, i], FMT[(x.kind ?? "num") as "num"]);
      });
      if (o.feed) h.feed($(".sk-feed")!, o.feed.rows ?? 4, o.feed.on, o.feed.line);
      // The banner replays on each event: its animation name flips (no layout read to restart it).
      if (o.banner) h.banner($(".sk-ban")!, o.banner.on, o.banner.text, (el) => (el.className = el.className === "sk-ban a" ? "sk-ban b" : "sk-ban a"));
      const counted: [Element, number][] = [];
      for (const id in counts) bar.querySelectorAll(`[data-act="${esc(id)}"] .bui-badge`).forEach((b) => counted.push([b, counts[id]!]));
      // The pad: fire, the actions, the aim toggles; counted keys get a badge.
      if (r.coarse) {
        const pads: PadAction[] = actions.map((a, i) => ({ intent: a.id, label: a.label.replace(/^[^·]*· /, ""), role: !def.fire && !i ? "go" : "sys" }));
        if (def.fire) pads.unshift({ intent: "fire", label: "", name: "Hold to fire (Space)", icon: ICON.fire, hold: true, role: "fire" });
        for (const a of aims) pads.push({ intent: a, label: a === "aim-auto" ? "AUTO" : "LOCK", name: aimLabel(a), role: "aim", toggle: true });
        const p = pad(e, input, { scheme: def.pad ?? "stick", host: ui, actions: pads });
        pads.forEach((a, i) => {
          if (!(a.intent in counts)) return;
          const b = p.el.querySelector(`[data-i="${i}"]`)!.appendChild(doc.createElement("b"));
          b.className = "bui-badge";
          counted.push([b, counts[a.intent]!]);
        });
      }
      for (const [b, slot] of counted) h.num(b as HTMLElement, [out, slot]);

      // The flow: fizlet/match on its own engine, alive as long as the overlay (Recall destroys it,
      // and its ledger takes the overlay back). Match owns the phase and its keys' clicks; the shell
      // keeps the keyboard (P, Escape) and asks (`ask`); each phase change answers it (`go`).
      let won = false, kept = "", play = () => {};
      const over = () => r.status() === "won" || r.status() === "gameover";
      const m = match(createEngine({ signal: r.signal }), ui, {
        count: ov.includes("countdown") ? 3 : 0,
        keys: [],
        hide: (["pause", "result"] as const).filter((x) => !ov.includes(x)).map((x) => (x === "pause" ? "paused" : "end")),
        labels: { paused: ["BATTLE PAUSED", give ? "GIVE UP?" : "PAUSED"], next: "EXIT" },
        icons: { next: CROSS },
        end: (x) => void (won = x.won),
        on(p: Phase) {
          if (p === "play") r.status() === "paused" ? r.go("resume") : play();
          else if (p === "paused") r.go("pause");
          else if (p === "end") r.go(won ? "won" : "lost");
          // REMATCH (a new round from the result) is a new run; EXIT (match's NEW GAME) is Recall.
          else if (p === "count" ? over() : p === "intro") r.go(p === "count" ? "restart" : "exit");
        },
      });
      m.el!.insertBefore(res, m.el!.lastChild);
      const sync = () => {
        const st = r.status();
        if (k.pause) {
          k.pause.innerHTML = st === "paused" ? ICON.play : ICON.pause;
          k.pause.setAttribute("aria-label", st === "paused" ? "Resume game (P)" : "Pause game (P)");
          k.pause.disabled = st !== "running" && st !== "paused";
        }
      };
      const syncSound = () => {
        if (!k.sound) return;
        k.sound.innerHTML = r.sfx.on ? ICON.sound : ICON.mute;
        k.sound.setAttribute("aria-pressed", String(r.sfx.on));
        k.sound.setAttribute("aria-label", r.sfx.on ? "Mute game sound" : "Turn game sound on");
      };
      syncSound();
      // Recall leaves full screen too: the page comes back as it was.
      r.signal.addEventListener("abort", () => doc.fullscreenElement && doc.exitFullscreen().catch(() => {}));
      const write = () => {
        r.game.hud(out);
        h.system.render!(e, 0);
        for (let i = 0; i < aims.length; i++) {
          const on = input.down(aims[i]!) ? 1 : 0;
          if (on !== lit[i]) (lit[i] = on), aimKeys[i]?.setAttribute("aria-pressed", on ? "true" : "false");
        }
      };
      return {
        msg,
        sync,
        write,
        ask: (to) => (to === "pause" || to === "resume" ? m.pause(to === "pause") : m.finish(to === "won")),
        key(a, b, auto) {
          if (a === "sound") syncSound();
          else if (a === "auto") b.setAttribute("aria-pressed", String(auto)), (b.textContent = auto ? "Fire: on" : "Auto fire");
          else if (a === "fold") {
            const c = bar.classList.toggle("compact");
            b.innerHTML = c ? ICON.open : ICON.fold;
            b.setAttribute("aria-expanded", String(!c));
            b.setAttribute("aria-label", c ? "Expand scoreboard" : "Minimize scoreboard");
          }
          else if (a === "full") (doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen()).catch(() => {});
          else if (a === "aim") input.press(b.dataset.aim!, !input.down(b.dataset.aim!)), write();
        },
        // The countdown runs on the flow's clock; the game's engine starts when play does.
        begin(go) {
          play = go;
          m.restart();
        },
        // The engine's ledger takes back what fizlet/hud wrote: the bar keeps the final numbers.
        hold: () => void (kept = group.innerHTML),
        end(_, notice, stats) {
          group.innerHTML = kept;
          sync();
          toast(msg, notice, 1e9);
          if (!ov.includes("result")) return;
          const rows: [string, unknown][] = (o.result?.stats ?? []).map((s) => [s, stats[s]]), best = o.result?.best;
          if (best) {
            const id = `fizlet:${def.id}:best`;
            let v = Number(stats[best]) || 0;
            try {
              v = Math.max(v, Number(localStorage.getItem(id)) || 0);
              localStorage.setItem(id, "" + v);
            } catch {}
            rows.push(["best " + best, v]);
          }
          res.innerHTML = rows.map(([l, v]) => `<dt>${esc(l.toUpperCase())}</dt><dd>${esc(String(v ?? 0))}</dd>`).join("");
        },
      };
    },
  };
}
