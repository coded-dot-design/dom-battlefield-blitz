// fizlet/arcade's `skirmish` preset (Battlefield Blitz's HUD): a bar across the top with the title,
// readouts (kills, clock, rank, an armor bar, streak…), aim toggles, action keys with counts and
// header keys; a feed and a banner driven by the event ring; pause / surrender / countdown /
// result overlays (BOARD-UI.md §9); the pad on phones with counted keys and aim toggles. Values go
// through fizlet/hud: change-only, from typed-array slots, nothing allocated in the steady state.
import type { ArcadeHud, HudView } from "./arcade";
import { BASE, ICON, esc } from "./arcade-parts";
import { hud } from "./hud";
import { pad } from "./pad";
import type { PadAction } from "./pad";
import { toast } from "./ui/board-ui";

export interface SkirmishReadout {
  label: string;
  /** How the value shows: `num` (default) 12 · `clock` 3:05 from seconds · `rank` #2 · `pct` 75%
   *  from 0..1 · `bar` a meter from 0..1 (armor, health). */
  kind?: "num" | "clock" | "rank" | "pct" | "bar";
  tone?: "team" | "enemy";
  /** A bar: class `low` at or under this (0..1). */
  low?: number;
}
export interface SkirmishOptions {
  /** Readouts, in the order `hud(out)` fills them. */
  readouts: SkirmishReadout[];
  /** Header keys, in order (default all four). Full screen shows only where the page may use it. */
  header?: ("fullscreen" | "sound" | "pause" | "exit")[];
  /** A feed of the last `rows` (default 4) events of type `on`, newest first. */
  feed?: { rows?: number; on: string; line: (a: number, b: number) => string };
  /** A centred banner (title, sub) on each event of type `on`. */
  banner?: { on: string; text: (a: number, b: number) => readonly [string, string?] };
  /** Overlays (default all four). `countdown` holds the start for 3, 2, 1. */
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
.bui .bui-overlay{pointer-events:auto}.bui .msg{z-index:31;bottom:auto;top:max(84px,calc(env(safe-area-inset-top) + 74px))}.bui-overlay-keys [hidden]{display:none}
.sk-res{position:absolute;left:50%;top:58%;translate:-50% 0;display:grid;grid-template-columns:auto auto;gap:6px 18px;margin:0;font:800 12px/1 ui-monospace,monospace;letter-spacing:.12em;color:#f6f3ff}.sk-res dd{margin:0;text-align:right}
@media (pointer:coarse),(max-width:600px){.sk{width:calc(100% - 20px);flex-wrap:wrap;justify-content:space-between;gap:6px 8px;padding:6px 8px}.sk>b,.sk [data-act],.sk [data-aim]{display:none}.sk .bui-readouts{gap:12px}.sk .bui-readout i{width:48px}.sk-feed{top:max(112px,calc(env(safe-area-inset-top) + 102px))}.bui .msg{top:max(160px,calc(env(safe-area-inset-top) + 150px))}}
@media (prefers-reduced-motion:reduce){.sk-ban.a,.sk-ban.b{opacity:1}}`;
// Sticker keys draw filled icons (the kit's rule): play, a flag, a cross.
const PLAY = "m6 3 11 7-11 7Z", FLAG = "M4 2h2v16H4ZM6 3h10l-2.5 4L16 11H6Z", CROSS = "m3 5 2-2 5 5 5-5 2 2-5 5 5 5-2 2-5-5-5 5-2-2 5-5Z";
const FULL = '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/></svg>';
const NAME = { fullscreen: "Full screen", sound: "Mute game sound", pause: "Pause game (P)", exit: "Close game and restore page (Esc)" };
const FMT = { num: "int", clock: "clock", rank: "rank", pct: "pct" } as const;
// Overlay states: none, countdown, pause, result.
const NONE = 0, COUNT = 1, PAUSE = 2, RESULT = 3;

/**
 * The `skirmish` preset (Battlefield Blitz): `hud: skirmishHud({ readouts: [{ label: "Kills",
 * tone: "team" }, { label: "Time", kind: "clock" }, { label: "Armor", kind: "bar", low: 0.3 }] })`.
 * `hud(out)` fills the readouts in order, then any count slots.
 */
export function skirmishHud(o: SkirmishOptions): ArcadeHud {
  const R = o.readouts, ov = o.overlays ?? ["pause", "surrender", "countdown", "result"], aims = (o.aim ?? []).map((a) => "aim-" + a);
  const counts = o.counts ?? {}, keys: Record<string, string[]> = {};
  for (const a of aims) keys[a] = [];
  return {
    css: BASE + CSS,
    keys,
    mount(r): HudView {
      const { ui, def, engine: e, input } = r, actions = def.actions ?? [], doc = ui.ownerDocument;
      const head = (o.header ?? ["fullscreen", "sound", "pause", "exit"]).filter((k) => k !== "fullscreen" || doc.fullscreenEnabled);
      const badge = (id: string) => (id in counts ? '<b class="bui-badge"></b>' : "");
      const aimLabel = (a: string) => (a === "aim-auto" ? "Auto aim" : "Lock");
      ui.insertAdjacentHTML("beforeend", `<section class="sk" aria-label="${esc(def.title)} controls"><b>${esc(def.title.toUpperCase())}</b><div class="bui-readouts">${R.map((x) => `<span class="bui-readout"${x.tone ? ` data-tone="${x.tone}"` : ""}>${esc(x.label)}${x.kind === "bar" ? `<i><u role="progressbar" aria-label="${esc(x.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></u></i>` : "<b></b>"}</span>`).join("")}</div><nav>${aims
        .map((a) => `<button type="button" data-a="aim" data-aim="${a}" aria-pressed="false">${aimLabel(a)}</button>`)
        .join("")}${actions.map((a) => `<button type="button" data-act="${esc(a.id)}">${esc(a.label)}${badge(a.id)}</button>`).join("")}${head
        .map((k) => `<button type="button" data-a="${k === "fullscreen" ? "full" : k}" aria-label="${NAME[k]}">${k === "fullscreen" ? FULL : ICON[k]}</button>`)
        .join("")}</nav></section>
${o.feed ? '<ol class="sk-feed" aria-label="Feed"></ol>' : ""}${o.banner ? '<div class="sk-ban" role="status"><b></b><span></span></div>' : ""}
<div class="bui-toast msg" role="status" hidden></div>
<div class="bui-overlay" hidden><div class="bui-sticker"><span></span><b></b></div><dl class="sk-res"></dl><div class="bui-overlay-keys"><button type="button" class="bui-sticker-key"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="${PLAY}"/></svg><b></b></button><button type="button" class="bui-sticker-key bui-second"><svg viewBox="0 0 20 20" aria-hidden="true"><path/></svg><b></b></button></div></div>`);
      const $ = <T extends Element = HTMLElement>(s: string) => ui.querySelector<T>(s);
      const bar = $(".sk")!, group = bar.children[1]!, msg = $(".msg")!, layer = $(".bui-overlay")!, sticker = layer.firstChild as HTMLElement, res = $(".sk-res")!;
      const [k1, k2] = layer.querySelectorAll<HTMLButtonElement>(".bui-sticker-key") as unknown as [HTMLButtonElement, HTMLButtonElement];
      const k = { sound: $<HTMLButtonElement>("[data-a=sound]"), pause: $<HTMLButtonElement>("[data-a=pause]") };
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

      // Overlays: one layer, one sticker, at most two keys (BOARD-UI.md §9).
      let shown = NONE, kept = "";
      const face = (b: HTMLButtonElement, a: string, label: string) => {
        b.dataset.a = a;
        b.hidden = !a;
        b.lastChild!.textContent = label;
      };
      const show = (s: number, kicker = "", word = "", a1 = "", l1 = "", a2 = "", l2 = "") => {
        shown = s;
        layer.hidden = !s;
        bar.inert = s > COUNT; // the countdown leaves the bar live (pause, exit)
        if (s !== RESULT) res.textContent = "";
        if (!s) return;
        sticker.firstChild!.textContent = kicker;
        sticker.lastChild!.textContent = word;
        face(k1, a1, l1);
        face(k2, a2, l2);
        k2.querySelector("path")!.setAttribute("d", a2 === "exit" ? CROSS : FLAG);
        if (a1) k1.focus();
      };
      const sync = () => {
        const st = r.status(), give = ov.includes("surrender");
        if (k.pause) {
          k.pause.innerHTML = st === "paused" ? ICON.play : ICON.pause;
          k.pause.setAttribute("aria-label", st === "paused" ? "Resume game (P)" : "Pause game (P)");
          k.pause.disabled = st !== "running" && st !== "paused";
        }
        if (st === "paused" && ov.includes("pause")) show(PAUSE, "BATTLE PAUSED", give ? "GIVE UP?" : "PAUSED", "pause", "KEEP FIGHTING", give ? "surrender" : "", "SURRENDER");
        else if (shown === PAUSE) show(NONE);
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
        key(a, b) {
          if (a === "sound") syncSound();
          else if (a === "full") (doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen()).catch(() => {});
          else if (a === "aim") input.press(b.dataset.aim!, !input.down(b.dataset.aim!)), write();
        },
        begin(go) {
          if (!ov.includes("countdown")) return go();
          let t = 3;
          const tick = () => {
            // Recall or a pause ends the countdown (resume starts the engine itself).
            if (r.signal.aborted || r.status() !== "running") return;
            if (!t) return void (show(NONE), go());
            show(COUNT, "GET READY", "" + t--);
            setTimeout(tick, 600);
          };
          tick();
        },
        // The engine's ledger takes back what fizlet/hud wrote: the bar keeps the final numbers.
        hold: () => void (kept = group.innerHTML),
        end(won, notice, stats) {
          group.innerHTML = kept;
          sync();
          toast(msg, notice, 1e9);
          if (!ov.includes("result")) return show(NONE);
          show(RESULT, won ? "STAGE CLEAR" : "INSERT COIN", won ? "MISSION COMPLETE" : "GAME OVER", "restart", "REMATCH", "exit", "EXIT");
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
