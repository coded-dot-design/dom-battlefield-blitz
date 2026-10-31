// Gameplay events for the play pages (site code; the game in src/ and dist/ never calls analytics).
// Every track() is a no-op until the visitor accepts, and on a build with no ids (no runtime on the page).
// Props are numbers, booleans and fixed words only: no names, no free text.
import { track } from "./track.mjs";

type Standing = { kills: number; deaths: number; you: boolean };
type Game = { readonly state: string; readonly platoons: boolean };

const GAME = "blitz";
const on = () => typeof window !== "undefined" && "siteAnalytics" in window;

/**
 * Wraps a createBlitz call: game_start when a match leaves the intro (or a rematch starts), game_end
 * from its onEnd standings (your kills, deaths, place, the field size, the match length in seconds).
 * `mode`: "solo" | "platoon" | "online".
 */
export function played<T extends Game>(mode: string, make: (onEnd: (st: Standing[]) => void) => T): T {
  const log = { solo: match(mode), platoon: match("platoon") };
  let current = log.solo;
  const game = make((st) => current.end(st));
  if (on()) {
    // The module has no start callback: read its state once a second (no-op builds skip this).
    let last = game.state;
    const tick = setInterval(() => {
      let now: string;
      try {
        now = game.state;
      } catch {
        return clearInterval(tick); // destroyed
      }
      if ((now === "count" || now === "play") && (last === "intro" || last === "end")) {
        current = mode === "solo" && game.platoons ? log.platoon : log.solo;
        current.start();
      }
      last = now;
    }, 1000);
  }
  return game;
}

/** The same two events for a page that starts and ends matches itself (online play: start when the room seats you). */
export function match(mode: string) {
  let at = 0;
  return {
    start() {
      at = performance.now();
      track("game_start", { game: GAME, mode });
    },
    end(st: Standing[]) {
      const i = st.findIndex((s) => s.you);
      const you = st[i];
      track("game_end", {
        game: GAME,
        mode,
        ...(you ? { kills: you.kills, deaths: you.deaths, place: i + 1 } : {}),
        tanks: st.length,
        duration: at ? Math.round((performance.now() - at) / 1000) : 0,
      });
      at = 0;
    },
  };
}

/** tune_change: a TUNE lever let go (its name and new value) or RESET, from the game's open shadow root. */
export function tuning(host: HTMLElement) {
  const root = host.shadowRoot;
  if (!on() || !root) return;
  root.addEventListener("change", (ev) => {
    const input = ev.target as HTMLInputElement;
    if (input.closest?.("[data-tune-panel]") && input.type === "range" && /^[a-z]{1,12}$/.test(input.name))
      track("tune_change", { game: GAME, lever: input.name, value: Number(input.value) });
  });
  root.addEventListener("click", (ev) => {
    if ((ev.target as Element).closest?.("[data-tune-reset]")) track("tune_change", { game: GAME, lever: "reset" });
  });
}

/** share: the invite link went out (`via`: "share" sheet or "copy"). */
export function shared(via: "share" | "copy") {
  track("share", { game: GAME, via });
}
