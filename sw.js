import { OFFLINE_VERSION, offlineURLs, offlineCacheName, offlineCachePrefix } from './offline-assets.js';

const base = new URL('./', self.location.href);
const urls = offlineURLs(base);
const allowed = new Set(urls);
const cacheName = offlineCacheName(base);
const indexURL = new URL('index.html', base).href;
let preparing = null;

async function status() {
  const cache = await caches.open(cacheName);
  const found = await Promise.all(urls.map(url => cache.match(url)));
  const cached = found.filter(Boolean).length;
  return {version:OFFLINE_VERSION, cached, total:urls.length, ready:cached === urls.length};
}

function prepare() {
  if (!preparing) preparing = (async () => {
    const cache = await caches.open(cacheName);
    const missing = [];
    for (const url of urls) if (!await cache.match(url)) missing.push(new Request(url, {cache:'reload'}));
    // Cache.addAll is atomic: failed downloads cannot be reported as a complete
    // new offline set. Readiness is still verified against every required URL.
    if (missing.length) await cache.addAll(missing);
    const result = await status();
    if (!result.ready) throw new Error('The offline asset set is incomplete.');
    return result;
  })().finally(() => { preparing = null; });
  return preparing;
}

self.addEventListener('install', event => {
  event.waitUntil(prepare().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const complete = await status();
    if (!complete.ready) throw new Error('Offline files are incomplete.');
    const prefix = offlineCachePrefix(base);
    const names = await caches.keys();
    // Never remove another app's cache, including another nested shelf copy.
    await Promise.all(names.filter(name => name.startsWith(prefix) && name !== cacheName).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (!['OFFLINE_STATUS', 'PREPARE_OFFLINE'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    try {
      const result = event.data.type === 'PREPARE_OFFLINE' ? await prepare() : await status();
      event.ports[0]?.postMessage(result);
    } catch (error) {
      event.ports[0]?.postMessage({...await status(), error:error.message});
    }
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== base.origin) return;
  url.search = '';
  url.hash = '';
  const home = request.mode === 'navigate' && (url.href === base.href || url.href === indexURL);
  const key = home ? indexURL : url.href;
  if (!allowed.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    try {
      // Online development and new content stay fresh. Cache fallback works
      // for both navigation and the shared modules/images outside this scope.
      const response = await fetch(request);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await cache.put(key, response.clone());
      return response;
    } catch {
      const saved = await cache.match(key);
      return saved || new Response('This shelf file is not available offline yet.', {status:503, headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }
  })());
});
