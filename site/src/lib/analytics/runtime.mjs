/**
 * Analytics-only consent pattern: the browser runtime. ONE self-contained function, inlined into the
 * page by snippet.mjs as `(analyticsRuntime)(config)` — no imports, no closures over module scope,
 * no dependencies (so it works in Astro, a plain HTML build or any static site).
 *
 * Guarantees (pinned by tests/analytics-consent.test.ts in the starter):
 *  - Before a choice: Google Consent Mode v2 defaults are all DENIED (analytics_storage, ad_storage,
 *    ad_user_data, ad_personalization) and NO vendor script is requested — no googletagmanager,
 *    google-analytics or posthog request, no `_ga` / `ph_` cookie.
 *  - Accept → GA4 (gtag.js, analytics_storage granted; the three ad signals stay denied for good,
 *    Google signals + ad personalisation off) and PostHog (no autocapture, no session recording,
 *    respect_dnt, cookie persistence) load once. Page views are the defaults of both.
 *  - Reject is one click, like Accept, and the three buttons look the same (equal prominence; a site may
 *    still style .cc-btn--solid on Accept); the choice is remembered (localStorage, `storageKey`). Rejecting
 *    after an Accept stops both on this page (ga-disable flag, PostHog opt-out) and clears their cookies.
 *  - Global Privacy Control or Do Not Track on, and no choice yet → treated as Reject: no banner, nothing
 *    loads; the visitor can still opt in from "Cookie settings".
 *  - track(event, props) no-ops until Accept. Never call it from the Fizlet kernel or bricks: games call
 *    it from site code (window.siteAnalytics.track, or track.mjs).
 *  - Any element with [data-cookie-settings] reopens the choice: the footer "Cookie settings" control.
 *    Ship it as `<button type="button" data-cookie-settings hidden>Cookie settings</button>`; the runtime
 *    unhides it, so a build with no analytics shows no dead control.
 *
 * Exposes window.siteAnalytics = { track, accept, reject, open, granted } and fires
 * `analytics:consent` on document with detail { analytics: boolean }.
 *
 * @param {{ ga4Id: string, posthogKey: string, posthogHost: string, storageKey?: string,
 *   privacyUrl?: string, cookiesUrl?: string, text?: string }} cfg
 */
export function analyticsRuntime(cfg) {
  var w = window, d = document;
  var KEY = cfg.storageKey || 'consent:analytics';
  var loaded = { ga4: false, posthog: false };
  var state = null; // null = no choice yet; true/false = analytics granted/refused

  w.dataLayer = w.dataLayer || [];
  function gtag() { w.dataLayer.push(arguments); }
  w.gtag = w.gtag || gtag;
  w.gtag('consent', 'default', {
    analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
  });
  w.gtag('set', 'ads_data_redaction', true);

  function readChoice() {
    try {
      var c = JSON.parse(w.localStorage.getItem(KEY) || 'null');
      return c && c.v === 1 && typeof c.analytics === 'boolean' ? c.analytics : null;
    } catch (e) { return null; }
  }
  function writeChoice(on) {
    try { w.localStorage.setItem(KEY, JSON.stringify({ v: 1, analytics: on, ts: Date.now() })); } catch (e) { /* private mode */ }
  }
  function inject(src) {
    if (d.querySelector('script[src="' + src + '"]')) return;
    var s = d.createElement('script');
    s.async = true;
    s.src = src;
    d.head.appendChild(s);
  }

  function loadGa4() {
    if (!cfg.ga4Id) return;
    w['ga-disable-' + cfg.ga4Id] = false;
    w.gtag('consent', 'update', { analytics_storage: 'granted' });
    if (loaded.ga4) return;
    loaded.ga4 = true;
    inject('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.ga4Id));
    w.gtag('js', new Date());
    w.gtag('config', cfg.ga4Id, { allow_google_signals: false, allow_ad_personalization_signals: false });
  }

  function loadPosthog() {
    if (!cfg.posthogKey) return;
    if (loaded.posthog) { w.posthog && w.posthog.opt_in_capturing && w.posthog.opt_in_capturing(); return; }
    loaded.posthog = true;
    // PostHog's array snippet (queue stub + async array.js from the assets host), trimmed.
    var ph = (w.posthog = w.posthog || []);
    if (!ph.__SV) {
      ph._i = [];
      ph.init = function (key, opts, name) {
        var target = ph;
        'capture identify register reset opt_in_capturing opt_out_capturing set_config'.split(' ').forEach(function (m) {
          target[m] = function () { target.push([m].concat(Array.prototype.slice.call(arguments))); };
        });
        ph._i.push([key, opts, name]);
      };
      ph.__SV = 1;
      inject(cfg.posthogHost.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js');
    }
    ph.init(cfg.posthogKey, {
      api_host: cfg.posthogHost,
      persistence: 'localStorage+cookie', // consent is granted: only now may PostHog store an id
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
      disable_session_recording: true,
      disable_surveys: true,
      respect_dnt: true,
      person_profiles: 'identified_only',
    });
  }

  function clearCookies(test) {
    var hosts = ['', location.hostname];
    var parts = location.hostname.split('.');
    for (var i = 1; i < parts.length - 1; i++) hosts.push('.' + parts.slice(i).join('.'));
    d.cookie.split(';').forEach(function (pair) {
      var name = pair.split('=')[0].trim();
      if (!test(name)) return;
      hosts.forEach(function (h) {
        d.cookie = name + '=; Max-Age=0; Path=/' + (h ? '; Domain=' + h : '');
      });
    });
  }

  function stop() {
    if (cfg.ga4Id) {
      w['ga-disable-' + cfg.ga4Id] = true;
      w.gtag('consent', 'update', { analytics_storage: 'denied' });
    }
    if (loaded.posthog && w.posthog) {
      try { w.posthog.opt_out_capturing(); w.posthog.reset(); } catch (e) { /* ignore */ }
    }
    clearCookies(function (n) { return /^_ga(_|$)/.test(n) || /^ph_/.test(n); });
    try {
      for (var i = w.localStorage.length - 1; i >= 0; i--) {
        var k = w.localStorage.key(i);
        if (k && /^ph_/.test(k)) w.localStorage.removeItem(k);
      }
    } catch (e) { /* storage blocked */ }
  }

  function apply(on, remember) {
    var was = state;
    state = on;
    if (remember) writeChoice(on);
    if (on) { loadGa4(); loadPosthog(); } else if (was !== null || remember) stop();
    hide();
    d.dispatchEvent(new CustomEvent('analytics:consent', { detail: { analytics: on } }));
  }

  /* ------------------------------- banner ------------------------------- */
  var banner = null;
  function el(tag, attrs, text) {
    var n = d.createElement(tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text) n.textContent = text;
    return n;
  }
  function build() {
    var css = el('style', {});
    css.textContent =
      '.cc-banner{position:fixed;z-index:2147483000;left:var(--cc-gap,16px);right:var(--cc-gap,16px);bottom:var(--cc-gap,16px);' +
      'max-width:40rem;margin-inline:auto;padding:var(--cc-pad,16px);background:var(--cc-bg,Canvas);color:var(--cc-fg,CanvasText);' +
      'border:var(--cc-border,1px solid currentColor);border-radius:var(--cc-radius,0);font:inherit;font-size:var(--cc-font-size,.9375rem);' +
      'line-height:1.5;box-shadow:var(--cc-shadow,none)}' +
      '.cc-banner[hidden]{display:none}.cc-banner p{margin:0 0 12px}.cc-banner a{color:inherit;text-decoration:underline}' +
      '.cc-banner__actions{display:flex;flex-wrap:wrap;gap:8px}' +
      '.cc-btn{font:inherit;cursor:pointer;min-height:44px;padding:0 16px;border:var(--cc-btn-border,1px solid currentColor);' +
      'border-radius:var(--cc-radius,0);background:transparent;color:inherit}' +
      '.cc-btn:focus-visible{outline:2px solid var(--cc-focus,currentColor);outline-offset:2px}' +
      '.cc-settings{margin:0 0 12px}.cc-settings[hidden]{display:none}.cc-settings label{display:flex;gap:8px;align-items:center;min-height:44px}' +
      '.cc-settings input{width:20px;height:20px;accent-color:var(--cc-accent,CanvasText)}' +
      'button[data-cookie-settings]{font:inherit;color:inherit;background:none;border:0;padding:0;text-decoration:underline;cursor:pointer}';
    d.head.appendChild(css);
    banner = el('section', { class: 'cc-banner', role: 'region', 'aria-label': 'Cookie choices', 'data-consent-banner': '', hidden: '' });
    var text = el('p', { class: 'cc-banner__text' },
      (cfg.text || 'With your OK we use Google Analytics and PostHog to count visits and see how the site is used. No ads, no selling data.') + ' ');
    if (cfg.privacyUrl) text.appendChild(el('a', { href: cfg.privacyUrl }, 'Privacy'));
    if (cfg.privacyUrl && cfg.cookiesUrl) text.appendChild(d.createTextNode(' · '));
    if (cfg.cookiesUrl) text.appendChild(el('a', { href: cfg.cookiesUrl }, 'Cookies'));
    var settings = el('div', { class: 'cc-settings', hidden: '' });
    var label = el('label', {});
    var box = el('input', { type: 'checkbox', 'data-cc-analytics': '' });
    label.appendChild(box);
    label.appendChild(d.createTextNode('Analytics (Google Analytics, PostHog)'));
    settings.appendChild(label);
    var actions = el('div', { class: 'cc-banner__actions' });
    var reject = el('button', { type: 'button', class: 'cc-btn', 'data-cc': 'reject' }, 'Reject');
    var more = el('button', { type: 'button', class: 'cc-btn', 'data-cc': 'settings', 'aria-expanded': 'false' }, 'Settings');
    var accept = el('button', { type: 'button', class: 'cc-btn cc-btn--solid', 'data-cc': 'accept' }, 'Accept');
    actions.appendChild(reject);
    actions.appendChild(more);
    actions.appendChild(accept);
    banner.appendChild(text);
    banner.appendChild(settings);
    banner.appendChild(actions);
    reject.addEventListener('click', function () { apply(false, true); });
    accept.addEventListener('click', function () { apply(true, true); });
    more.addEventListener('click', function () {
      if (settings.hidden) {
        box.checked = state === true;
        settings.hidden = false;
        more.textContent = 'Save';
        more.setAttribute('aria-expanded', 'true');
        box.focus();
      } else apply(box.checked, true);
    });
    banner.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state !== null) hide(); });
    d.body.appendChild(banner);
  }
  function show(withSettings) {
    if (!banner) build();
    var settings = banner.querySelector('.cc-settings');
    var more = banner.querySelector('[data-cc="settings"]');
    settings.hidden = true;
    more.textContent = 'Settings';
    more.setAttribute('aria-expanded', 'false');
    banner.hidden = false;
    if (withSettings) more.click();
  }
  function hide() { if (banner) banner.hidden = true; }

  function track(event, props) {
    if (state !== true || typeof event !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(event)) return;
    var clean = {};
    for (var k in props || {}) {
      var v = props[k];
      if (typeof v === 'number' ? isFinite(v) : typeof v === 'string' || typeof v === 'boolean') clean[k] = v;
    }
    try { if (loaded.ga4) w.gtag('event', event, clean); } catch (e) { /* ignore */ }
    try { if (loaded.posthog && w.posthog) w.posthog.capture(event, clean); } catch (e) { /* ignore */ }
  }

  w.siteAnalytics = {
    track: track,
    accept: function () { apply(true, true); },
    reject: function () { apply(false, true); },
    open: function () { show(true); },
    granted: function () { return state === true; },
  };

  d.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-cookie-settings]') : null;
    if (!t) return;
    e.preventDefault();
    show(true);
  });

  function start() {
    var links = d.querySelectorAll('[data-cookie-settings][hidden]');
    for (var i = 0; i < links.length; i++) links[i].hidden = false;
    var stored = readChoice();
    var signal = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
    if (stored !== null) apply(stored, false);
    else if (signal) state = false;
    else show(false);
  }
  if (d.body) start();
  else d.addEventListener('DOMContentLoaded', start, { once: true });
}
