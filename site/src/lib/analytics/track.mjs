/**
 * The one analytics call games and site code make: track('game_start', { game: 'blitz' }).
 * A no-op until the visitor accepts analytics, and a no-op on a build with no ids (the runtime is
 * not on the page). Props: strings, finite numbers and booleans only. Never import this from the
 * Fizlet kernel or a brick — the engine stays analytics-free; call it from the site's game wiring.
 * Suggested events: game_start, game_end { score, duration }, level_up, tune_change, share.
 * @param {string} event  snake_case, ≤ 40 chars
 * @param {Record<string, string | number | boolean>} [props]
 */
export function track(event, props) {
  const api = typeof window === 'undefined' ? undefined : window.siteAnalytics;
  if (api) api.track(event, props);
}
