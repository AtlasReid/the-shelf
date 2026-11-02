import { EMPTY_MOTION, validateMotion } from './motion.js';

// Small, origin-local preferences only. No cookies, requests, card content,
// timing samples or device identifiers are stored here.
export const SETTINGS_STORAGE_KEY = 'the-shelf-settings-v1';
export const SETTINGS_VERSION = 1;
export const DEFAULT_SETTINGS = Object.freeze({
  automatic:true,
  renderScale:1,
  shadowQuality:2,
  inspectionDetail:true,
  indoorEnabled:true,
  groundMovement:false,
  liveFps:true,
  motion:EMPTY_MOTION,
});

const valid = Object.freeze({
  automatic:value => typeof value === 'boolean',
  renderScale:value => typeof value === 'number' && Number.isFinite(value) && value >= .5 && value <= 2,
  shadowQuality:value => Number.isInteger(value) && value >= 0 && value <= 4,
  inspectionDetail:value => typeof value === 'boolean',
  indoorEnabled:value => typeof value === 'boolean',
  groundMovement:value => typeof value === 'boolean',
  liveFps:value => typeof value === 'boolean',
});

function validatedPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, check] of Object.entries(valid)) {
    if (Object.hasOwn(value,key) && check(value[key])) result[key] = value[key];
  }
  if (Object.hasOwn(value,'motion')) {
    const motion = validateMotion(value.motion);
    if (motion) result.motion = motion;
  }
  return result;
}

const sameSettings = (a,b) => Object.keys(DEFAULT_SETTINGS).every(key => key === 'motion'
  ? JSON.stringify(a.motion) === JSON.stringify(b.motion) : a[key] === b[key]);

export function createSettingsStore({storage} = {}) {
  let backend;
  let persistent = false;
  let state = Object.freeze({...DEFAULT_SETTINGS});
  const listeners = new Set();
  try {
    backend = storage === undefined ? globalThis.localStorage : storage;
    persistent = Boolean(backend && typeof backend.getItem === 'function'
      && typeof backend.setItem === 'function' && typeof backend.removeItem === 'function');
    if (!persistent) backend = null;
  } catch { backend = null; }

  if (backend) {
    let saved;
    try { saved = backend.getItem(SETTINGS_STORAGE_KEY); }
    catch { backend = null; persistent = false; }
    if (saved) {
      try {
        const record = JSON.parse(saved);
        if (record?.version === SETTINGS_VERSION) {
          state = Object.freeze({...DEFAULT_SETTINGS,...validatedPatch(record.settings)});
        }
      } catch { /* Malformed data does not disable otherwise usable storage. */ }
    }
  }

  function publish() {
    const metadata = Object.freeze({persistent});
    for (const listener of [...listeners]) listener(state,metadata);
  }

  function save() {
    if (!backend) return;
    try { backend.setItem(SETTINGS_STORAGE_KEY,JSON.stringify({version:SETTINGS_VERSION,settings:state})); }
    catch { backend = null; persistent = false; }
  }

  return {
    get state() { return state; },
    get persistent() { return persistent; },
    update(patch) {
      const next = {...state,...validatedPatch(patch)};
      if (sameSettings(next,state)) return false;
      state = Object.freeze(next);
      save();
      publish();
      return true;
    },
    reset() {
      const changed = !sameSettings(state,DEFAULT_SETTINGS);
      const previouslyPersistent = persistent;
      state = Object.freeze({...DEFAULT_SETTINGS});
      if (backend) {
        try { backend.removeItem(SETTINGS_STORAGE_KEY); }
        catch { backend = null; persistent = false; }
      }
      if (changed || persistent !== previouslyPersistent) publish();
      return changed || persistent !== previouslyPersistent;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A settings listener must be a function.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
