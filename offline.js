import { OFFLINE_ASSETS, OFFLINE_VERSION } from './offline-assets.js';

const base = new URL('./', import.meta.url);

export function createOfflineSupport({onStatus = () => {}} = {}) {
  const lifetime = new AbortController();
  const display = matchMedia('(display-mode: standalone)');
  let registration = null;
  let destroyed = false;
  let checking = null;
  let poll = null;
  const channels = new Set();
  let state = {
    status:'preparing', message:'Preparing offline files…', cached:0,
    total:OFFLINE_ASSETS.length, installed:display.matches || navigator.standalone === true,
    offline:!navigator.onLine,
  };

  function emit(next = {}) {
    if (destroyed) return;
    state = {...state, ...next, offline:!navigator.onLine};
    onStatus({...state});
  }

  const listen = (target, type, handler) => target.addEventListener(type, handler, {signal:lifetime.signal});
  listen(window, 'appinstalled', () => emit({installed:true}));
  listen(display, 'change', () => {
    if (display.matches || navigator.standalone === true) emit({installed:true});
  });

  function ask(worker, type) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      channels.add(channel);
      const timeout = setTimeout(() => {
        channel.port1.close();
        channels.delete(channel);
        reject(new Error('The offline download is taking longer than expected.'));
      }, 60_000);
      channel.port1.onmessage = event => {
        clearTimeout(timeout);
        channel.port1.close();
        channels.delete(channel);
        resolve(event.data);
      };
      worker.postMessage({type}, [channel.port2]);
    });
  }

  function refresh() {
    if (destroyed || !registration) return Promise.resolve({...state});
    if (checking) return checking;
    checking = (async () => {
      let worker = registration.active || registration.waiting || registration.installing;
      if (!worker && navigator.onLine) {
        await registration.update();
        worker = registration.active || registration.waiting || registration.installing;
      }
      if (!worker) throw new Error('Offline setup is incomplete. Reconnect and try again.');
      let result = await ask(worker, 'OFFLINE_STATUS');
      const current = result.version === OFFLINE_VERSION && result.total === OFFLINE_ASSETS.length;
      if (!current) {
        emit({status:'preparing', message:'Updating the shelf for offline use…'});
        return {...state};
      }
      emit({cached:result.cached, total:result.total});
      if (!result.ready && navigator.onLine) {
        emit({status:'preparing', message:`Saving offline files (${result.cached}/${result.total})…`});
        result = await ask(worker, 'PREPARE_OFFLINE');
      }
      if (result.error) throw new Error('Some offline files could not be saved. Reconnect and retry.');
      if (result.ready && result.cached === OFFLINE_ASSETS.length) emit({status:'ready', cached:result.cached, total:result.total, message:'All shelf files saved. Ready to use offline.'});
      else emit({status:'error', cached:result.cached, total:result.total, message:'Offline files are incomplete. Reconnect to finish downloading.'});
      return {...state};
    })().catch(error => {
      emit({status:'error', message:error.message || 'Offline setup could not complete.'});
      return {...state};
    }).finally(() => { checking = null; });
    return checking;
  }

  function watch(worker) {
    if (!worker) return;
    listen(worker, 'statechange', () => {
      if (worker.state === 'activated') refresh();
      if (worker.state === 'redundant' && !registration.active) emit({status:'error', message:'Offline files could not finish downloading. Reconnect and retry.'});
    });
  }

  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('caches' in window)) {
    emit({status:'unsupported', message:'Offline storage is unavailable in this browser or context.'});
  } else {
    emit();
    listen(navigator.serviceWorker, 'controllerchange', refresh);
    listen(window, 'online', refresh);
    listen(window, 'offline', refresh);
    listen(document, 'visibilitychange', () => { if (!document.hidden) refresh(); });
    navigator.serviceWorker.register(new URL('sw.js', base), {scope:base.href, type:'module', updateViaCache:'none'})
      .then(next => {
        if (destroyed) return;
        registration = next;
        watch(registration.installing);
        watch(registration.waiting);
        listen(registration, 'updatefound', () => watch(registration.installing));
        refresh();
        poll = setInterval(() => { if (!document.hidden) refresh(); }, 30_000);
      }).catch(() => emit({status:'error', message:'Offline setup could not start. Check the connection and retry.'}));
  }

  return {
    get state() { return {...state}; },
    refresh,
    destroy() {
      destroyed = true;
      lifetime.abort();
      clearInterval(poll);
      for (const channel of channels) channel.port1.close();
      channels.clear();
    },
  };
}
