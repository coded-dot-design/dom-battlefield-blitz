/**
 * Analytics-only consent pattern (GA4 + PostHog, no ads): the build-time config. Pure, Node-safe.
 *
 * Ids come from build-time env vars ONLY — never hard-coded, no built-in defaults:
 *   PUBLIC_GA4_ID        G-XXXXXXXXXX            (empty/unset = GA4 off)
 *   PUBLIC_POSTHOG_KEY   phc_…                   (empty/unset = PostHog off)
 *   PUBLIC_POSTHOG_HOST  https://us.i.posthog.com (default; only used with a key)
 * Neither id set → `enabled` is false and analyticsSnippet() returns '' (the build ships no analytics
 * code at all). A malformed non-empty value throws, so a typo fails the build instead of shipping.
 * The ids are public (they are in every page's source), so CI passes them as repository Variables.
 */

export const GA4_FORMAT = /^G-[A-Z0-9]{4,20}$/;
export const POSTHOG_KEY_FORMAT = /^ph[a-z]_[A-Za-z0-9]{8,128}$/;
export const POSTHOG_HOST_DEFAULT = 'https://us.i.posthog.com';

/** @typedef {{ enabled: boolean, ga4Id: string, posthogKey: string, posthogHost: string }} AnalyticsConfig */

function read(env, name, format) {
  const raw = env?.[name];
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  if (value !== '' && !format.test(value)) {
    throw new Error(`${name}="${value}" is not valid (expected ${format}); set a valid id, or leave it empty to turn it off.`);
  }
  return value;
}

/** Resolve one build's analytics config from env (pure). @returns {AnalyticsConfig} */
export function resolveAnalytics(env = {}) {
  const ga4Id = read(env, 'PUBLIC_GA4_ID', GA4_FORMAT);
  const posthogKey = read(env, 'PUBLIC_POSTHOG_KEY', POSTHOG_KEY_FORMAT);
  const host = String(env?.PUBLIC_POSTHOG_HOST ?? '').trim() || POSTHOG_HOST_DEFAULT;
  let posthogHost;
  try {
    const url = new URL(host);
    if (url.protocol !== 'https:') throw new Error('not https');
    posthogHost = url.origin;
  } catch {
    throw new Error(`PUBLIC_POSTHOG_HOST="${host}" must be an https origin, e.g. ${POSTHOG_HOST_DEFAULT}.`);
  }
  return { enabled: Boolean(ga4Id || posthogKey), ga4Id, posthogKey, posthogHost };
}
