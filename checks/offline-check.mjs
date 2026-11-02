import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { cards } from '../compatibility/cards.js';
import { OFFLINE_ASSETS, OFFLINE_VERSION, offlineURLs, offlineCacheName, offlineCachePrefix } from '../offline-assets.js';

const app = new URL('../', import.meta.url);
const required = new Set(offlineURLs(app));
let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }

await check('the offline set contains every runtime import, stylesheet, font, icon and card image', async () => {
  assert.equal(required.size, OFFLINE_ASSETS.length, 'cache entries are unique');
  for (const url of required) {
    assert.ok((await stat(fileURLToPath(url))).size > 0, `asset exists: ${url}`);
    if (url.endsWith('.js')) {
      const source = await readFile(new URL(url), 'utf8');
      const imports = /(?:^|\n)\s*(?:import|export)\s+(?:(?:[^;'"\n]+?)\s+from\s+)?['"](\.[^'"]+)['"]/g;
      for (const match of source.matchAll(imports)) assert.ok(required.has(new URL(match[1], url).href), `cached JS dependency ${match[1]} of ${url}`);
    }
    if (url.endsWith('.css')) {
      const source = await readFile(new URL(url), 'utf8');
      for (const match of source.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
        if (match[1].startsWith('data:')) continue;
        assert.ok(!/^https?:/.test(match[1]), `no remote font/style dependency: ${url}`);
        assert.ok(required.has(new URL(match[1], url).href), `cached CSS dependency ${match[1]} of ${url}`);
      }
    }
  }
  const html = await readFile(new URL('index.html', app), 'utf8');
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    const resource = tag[0].match(/(?:src|href)="([^"]+)"/);
    if (resource) assert.ok(required.has(new URL(resource[1], app).href), `cached HTML resource: ${resource[1]}`);
  }
  for (const card of cards) for (const path of [...Object.values(card.surfaces), ...Object.values(card.previewSurfaces ?? {}), ...Object.values(card.finishMaps ?? {})]) assert.ok(required.has(new URL(`compatibility/${path}`, app).href), `cached ${card.id} surface/finish`);
});

await check('manifest and real 192/512 PNG icons support a nested-path standalone app', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', app), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) {
    const bytes = await readFile(new URL(icon.src, app));
    const size = Number(icon.sizes.split('x')[0]);
    assert.deepEqual([...bytes.subarray(0,8)], [137,80,78,71,13,10,26,10]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
    assert.ok([192,512].includes(size));
  }
  const nested = new URL('https://example.test/my-project/');
  for (const url of offlineURLs(nested)) assert.ok(url.startsWith('https://example.test/my-project/'), `nested deployment keeps its project prefix: ${url}`);
  assert.notEqual(offlineCachePrefix(nested), offlineCachePrefix(new URL('https://example.test/another-project/')));
});

const source = (await readFile(new URL('sw.js', app), 'utf8')).replace(/^import .*;\r?\n/, '');
const workerBase = new URL('https://example.test/project/shelf-three/');
const workerURLs = offlineURLs(workerBase);

function workerFixture() {
  const listeners = new Map();
  const stores = new Map();
  const overrides = new Map();
  let online = true, failedURL = null, skipped = 0, claimed = 0;
  const normalize = value => {
    const url = new URL(typeof value === 'string' ? value : value.url);
    url.search = ''; url.hash = '';
    return url.href;
  };
  async function network(request) {
    const url = normalize(request);
    if (!online || url === failedURL) throw new Error('Network unavailable');
    if (!workerURLs.includes(url)) return new Response('Not found', {status:404});
    return new Response(overrides.get(url) ?? `asset:${url}`);
  }
  function makeCache() {
    const data = new Map();
    return {
      data,
      async match(key) { return data.get(normalize(key))?.clone(); },
      async put(key, response) { data.set(normalize(key), response.clone()); },
      async addAll(requests) {
        const responses = await Promise.all(requests.map(request => network(request)));
        if (responses.some(response => !response.ok)) throw new Error('Download failed');
        for (let i=0; i<requests.length; i++) data.set(normalize(requests[i]), responses[i].clone());
      },
    };
  }
  const caches = {
    async open(name) { if (!stores.has(name)) stores.set(name, makeCache()); return stores.get(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const self = {
    location:{href:new URL('sw.js', workerBase).href},
    registration:{scope:workerBase.href},
    clients:{async claim() { claimed++; }},
    async skipWaiting() { skipped++; },
    addEventListener(type, callback) { listeners.set(type, callback); },
  };
  vm.runInNewContext(source, {self,caches,fetch:network,Request,Response,URL,Set,Promise,OFFLINE_VERSION,offlineURLs,offlineCacheName,offlineCachePrefix}, {filename:'sw.js (offline check)'});
  async function lifecycle(type) {
    let task;
    listeners.get(type)({waitUntil(promise) { task=promise; }});
    await task;
  }
  async function message(type) {
    let result, task;
    listeners.get('message')({data:{type},ports:[{postMessage(value){result=value;}}],waitUntil(promise){task=promise;}});
    await task;
    return result;
  }
  async function request(url, mode = 'cors') {
    let response;
    listeners.get('fetch')({request:{url,method:'GET',mode},respondWith(promise){response=promise;}});
    return response ? await response : undefined;
  }
  return {stores,caches,overrides,lifecycle,message,request,
    setOnline(value){online=value;}, fail(url){failedURL=url;},
    get skipped(){return skipped;},get claimed(){return claimed;},
  };
}

await check('worker only activates a complete cache and removes only older caches for its own scope', async () => {
  const f = workerFixture();
  const old = `${offlineCachePrefix(workerBase)}old-version`;
  const other = `${offlineCachePrefix(new URL('https://example.test/other/shelf-three/'))}old-version`;
  await f.caches.open(old); await f.caches.open(other); await f.caches.open('unrelated-personal-data');
  await f.lifecycle('install');
  assert.equal(f.skipped, 1);
  const status = await f.message('OFFLINE_STATUS');
  assert.equal(status.ready, true);
  assert.equal(status.cached, OFFLINE_ASSETS.length);
  await f.lifecycle('activate');
  assert.equal(f.claimed, 1);
  assert.equal(f.stores.has(old), false);
  assert.ok(f.stores.has(other) && f.stores.has('unrelated-personal-data'));
});

await check('missing files never report ready and are repaired after reconnecting', async () => {
  const f = workerFixture();
  await f.lifecycle('install');
  const cache = await f.caches.open(offlineCacheName(workerBase));
  cache.data.delete(workerURLs.at(-1));
  const incomplete = await f.message('OFFLINE_STATUS');
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.cached, OFFLINE_ASSETS.length - 1);
  f.setOnline(false);
  const failed = await f.message('PREPARE_OFFLINE');
  assert.equal(failed.ready, false);
  assert.ok(failed.error);
  f.setOnline(true);
  const repaired = await f.message('PREPARE_OFFLINE');
  assert.equal(repaired.ready, true);
  assert.equal(repaired.cached, OFFLINE_ASSETS.length);
});

await check('offline index/query navigation and shared images use cached responses while other pages remain outside scope', async () => {
  const f = workerFixture();
  await f.lifecycle('install');
  f.setOnline(false);
  const index = new URL('index.html?preview=1', workerBase).href;
  assert.equal(await (await f.request(index, 'navigate')).text(), `asset:${new URL('index.html', workerBase).href}`);
  assert.equal(await (await f.request(workerBase.href, 'navigate')).text(), `asset:${new URL('index.html', workerBase).href}`);
  const shared = new URL(`compatibility/${cards[0].surfaces.front}`, workerBase).href;
  assert.equal(await (await f.request(shared)).text(), `asset:${shared}`);
  assert.equal(await f.request('https://example.test/project/index.html', 'navigate'), undefined);
});

await check('online assets are network-first and refresh the offline copy', async () => {
  const f = workerFixture();
  await f.lifecycle('install');
  const scene = new URL('scene.js', workerBase).href;
  f.overrides.set(scene, 'updated scene source');
  assert.equal(await (await f.request(scene)).text(), 'updated scene source');
  f.setOnline(false);
  assert.equal(await (await f.request(scene)).text(), 'updated scene source');
});

await check('a failed initial download cannot activate or produce a partially ready cache', async () => {
  const f = workerFixture();
  f.fail(workerURLs[3]);
  await assert.rejects(f.lifecycle('install'), /Network unavailable/);
  assert.equal(f.skipped, 0);
  const status = await f.message('OFFLINE_STATUS');
  assert.equal(status.ready, false);
  assert.equal(status.cached, 0);
});

console.log(`Offline checks passed (${passed} cases; actual worker handlers and local runtime closure).`);
