// This site's settings for the analytics-only consent pattern (the other files in this folder are the
// astro-engine kit, kit/src/lib/analytics, copied as is). GA4 + PostHog load only after Accept, and only
// on a build with PUBLIC_GA4_ID or PUBLIC_POSTHOG_KEY set (repository Variables): with neither set this
// returns '' and the pages ship no analytics code at all.
import { resolveAnalytics } from "./config.mjs";
import { analyticsSnippet } from "./snippet.mjs";

export const SITE = {
  storageKey: "blitz:consent",
  privacyUrl: "https://domvirus.com/legal/privacy/",
  cookiesUrl: "https://domvirus.com/legal/cookies/",
  text: "With your OK we use Google Analytics and PostHog to count visits and see how Blitz is played. No ads, no selling data.",
};

// The game's pause menu (phone game mode) shows COOKIE SETTINGS when <html data-consent> is set and sends
// a composed "consent:open" event from it: mark the page, and open the choice on that event.
const BRIDGE =
  '<script>document.documentElement.setAttribute("data-consent","");' +
  'document.addEventListener("consent:open",function(){window.siteAnalytics&&window.siteAnalytics.open()});</script>';

/** The end-of-<body> HTML for one build: the consent runtime and the game bridge, or '' (no ids). */
export function consentSnippet(env) {
  const html = analyticsSnippet(resolveAnalytics(env), SITE);
  return html && html + BRIDGE;
}
