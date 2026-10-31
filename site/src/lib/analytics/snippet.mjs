/**
 * Analytics-only consent pattern: the HTML the build puts in every page (end of <head> or <body>).
 * Returns '' when no id is set, so a build without PUBLIC_GA4_ID / PUBLIC_POSTHOG_KEY ships no
 * analytics code at all. Works from Astro (`<Fragment set:html={analyticsSnippet(...)} />`) or any
 * Node build that writes HTML strings.
 */
import { analyticsRuntime } from './runtime.mjs';

/**
 * @param {import('./config.mjs').AnalyticsConfig} cfg  resolveAnalytics(env)
 * @param {{ privacyUrl?: string, cookiesUrl?: string, storageKey?: string, text?: string }} [site]
 */
export function analyticsSnippet(cfg, site = {}) {
  if (!cfg || !cfg.enabled) return '';
  const config = {
    ga4Id: cfg.ga4Id,
    posthogKey: cfg.posthogKey,
    posthogHost: cfg.posthogHost,
    ...site,
  };
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<script>(${analyticsRuntime.toString()})(${json});</script>`;
}
