import {clientsClaim} from 'workbox-core';
import {NavigationRoute, registerRoute} from 'workbox-routing';
import {NetworkFirst} from 'workbox-strategies';
import {CacheableResponsePlugin} from 'workbox-cacheable-response';
import {cleanupOutdatedCaches, matchPrecache, precacheAndRoute} from 'workbox-precaching';

// Injected at build time. Each worker keeps its own complete offline shell.
const entries = self.__WB_MANIFEST;
const entryUrl = entry => new URL(typeof entry === 'string' ? entry : entry.url, self.location.href).href;
const knownAssets = new Set(entries.map(entryUrl));
const shell = entries.find(entry => typeof entry !== 'string' && new URL(entry.url, self.location.href).pathname === '/index.html');
const navigationPrefix = 'saferoute-navigation-';
const navigationCache = `${navigationPrefix}${shell?.revision || 'unrevisioned'}`;

const completeShellOnly = {
  async cacheWillUpdate({request, response}) {
    if (response.status !== 200 || !/text\/html/i.test(response.headers.get('content-type') || '')) return null;
    const html = await response.clone().text();
    let ownScript = false;
    // Vite emits quoted src/href attributes. Do not cache newer HTML that
    // refers to assets this worker has not finished precaching yet.
    for (const match of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      const tag = match[0], script = /^<script\b/i.test(tag);
      if (!script && !/\brel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
      const source = tag.match(script ? /\bsrc\s*=\s*["']([^"']+)["']/i : /\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!source) continue;
      const url = new URL(source, request.url);
      if (url.origin !== self.location.origin) continue;
      if (!knownAssets.has(url.href)) return null;
      if (script && /\.m?js$/.test(url.pathname)) ownScript = true;
    }
    return ownScript ? response : null;
  },
};

const navigation = new NetworkFirst({
  cacheName: navigationCache,
  // This timeout uses a previously cached navigation; without one Workbox
  // waits for network failure, then the handler uses the precached shell.
  networkTimeoutSeconds: 3,
  plugins: [new CacheableResponsePlugin({statuses: [200]}), completeShellOnly],
});

// Order matters: online navigation must reach the server before the precache
// route can serve an older index.html. API, diagnostics, assets and the separate
// authority pilot never become navigation-cache entries.
registerRoute(new NavigationRoute(async options => {
  try {
    return await navigation.handle(options);
  } catch {
    return await matchPrecache('/index.html') || Response.error();
  }
}, {denylist: [/^\/api(?:[/?]|$)/, /^\/piloto(?:[/?]|$)/, /^\/version\.json(?:\?|$)/, /^\/assets\//]}));

precacheAndRoute(entries);
cleanupOutdatedCaches();
self.skipWaiting();
clientsClaim();

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names
    .filter(name => name.startsWith(navigationPrefix) && name !== navigationCache)
    .map(name => caches.delete(name)))));
});
