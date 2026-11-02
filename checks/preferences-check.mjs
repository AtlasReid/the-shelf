import assert from 'node:assert/strict';
import {createSettingsStore,DEFAULT_SETTINGS,SETTINGS_STORAGE_KEY,SETTINGS_VERSION} from '../preferences.js';
import {createSettingsPanel} from '../settings-panel.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const operations = [];
  return {data,operations,
    getItem(key) { operations.push(['get',key]); return data.get(key) ?? null; },
    setItem(key,value) { operations.push(['set',key,value]); data.set(key,value); },
    removeItem(key) { operations.push(['remove',key]); data.delete(key); },
  };
}
let passed = 0;
function check(name, run) { run(); passed++; console.log(`PASS ${name}`); }

check('a first visit starts from the stable preset without writing or probing storage', () => {
  const storage = memoryStorage(), store = createSettingsStore({storage});
  assert.deepEqual(store.state,DEFAULT_SETTINGS);
  assert.equal(store.state.renderScale,1);
  assert.equal(store.persistent,true);
  assert.ok(Object.isFrozen(store.state));
  assert.deepEqual(storage.operations,[['get',SETTINGS_STORAGE_KEY]],'No constructor writes, cookies or storage test keys.');
  assert.throws(() => { store.state.renderScale = 2; },TypeError);
});

check('explicit graphics and scene choices survive a fresh page store', () => {
  const storage = memoryStorage(), first = createSettingsStore({storage});
  first.update({automatic:false,renderScale:1.25,shadowQuality:4,inspectionDetail:false,indoorEnabled:false,groundMovement:true,liveFps:false});
  const record = JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY));
  assert.equal(record.version,SETTINGS_VERSION);
  assert.deepEqual(record.settings,first.state);
  const second = createSettingsStore({storage});
  assert.deepEqual(second.state,first.state);
  assert.equal(storage.operations.filter(([kind]) => kind === 'set').length,1,'Reading saved preferences never rewrites them.');
});

check('only validated preference fields enter memory or persisted data', () => {
  const storage = memoryStorage(), store = createSettingsStore({storage});
  store.update({renderScale:1.37,shadowQuality:3,automatic:false,timePreview:200,card:'private greeting',deviceId:'not-a-setting'});
  assert.equal(store.state.renderScale,1.37);
  assert.equal(store.state.shadowQuality,3);
  assert.equal(store.state.automatic,false);
  assert.deepEqual(Object.keys(store.state),Object.keys(DEFAULT_SETTINGS));
  const before = store.state, writes = storage.operations.length;
  assert.equal(store.update({renderScale:Infinity,shadowQuality:2.1,automatic:1,indoorEnabled:'false',groundMovement:null,inspectionDetail:'yes',liveFps:0}),false);
  assert.equal(store.update({renderScale:.49,shadowQuality:-1}),false);
  assert.equal(store.update({renderScale:2.01,shadowQuality:5}),false);
  assert.equal(store.update(null),false);
  assert.equal(store.update([]),false);
  assert.equal(store.state,before);
  assert.equal(storage.operations.length,writes,'Invalid/no-op patches do not touch storage.');
});

check('malformed, unsupported and partial saved records recover safely', () => {
  for (const value of ['{broken','null','[]',JSON.stringify({version:99,settings:{groundMovement:true}}),JSON.stringify({version:1,settings:[]})]) {
    const storage = memoryStorage({[SETTINGS_STORAGE_KEY]:value}), store = createSettingsStore({storage});
    assert.deepEqual(store.state,DEFAULT_SETTINGS);
    assert.equal(store.persistent,true,'Bad JSON is not a storage-permission failure.');
    assert.equal(storage.operations.filter(([kind]) => kind === 'set').length,0);
    store.update({indoorEnabled:false});
    assert.equal(JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY)).settings.indoorEnabled,false,'A later choice replaces the unusable record.');
  }
  const storage = memoryStorage({[SETTINGS_STORAGE_KEY]:JSON.stringify({version:1,settings:{renderScale:2,shadowQuality:'4',groundMovement:true,unexpected:true}})});
  const store = createSettingsStore({storage});
  assert.equal(store.state.renderScale,2);
  assert.equal(store.state.shadowQuality,DEFAULT_SETTINGS.shadowQuality);
  assert.equal(store.state.groundMovement,true);
  assert.equal('unexpected' in store.state,false);
});

check('blocked reads and denied storage access keep usable in-memory preferences', () => {
  const denied = {getItem(){throw new Error('Storage blocked');},setItem(){throw new Error('Must not write');},removeItem(){throw new Error('Must not remove');}};
  const store = createSettingsStore({storage:denied});
  assert.equal(store.persistent,false);
  assert.equal(store.update({renderScale:1.5}),true);
  assert.equal(store.state.renderScale,1.5);
  store.reset();
  assert.deepEqual(store.state,DEFAULT_SETTINGS);
  const previous = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try {
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('Denied getter');}});
    const globalStore = createSettingsStore();
    assert.equal(globalStore.persistent,false);
    globalStore.update({indoorEnabled:false});
    assert.equal(globalStore.state.indoorEnabled,false);
  } finally {
    if (previous) Object.defineProperty(globalThis,'localStorage',previous);
    else delete globalThis.localStorage;
  }
});

check('a quota failure preserves the choice and reports session-only storage', () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  const store = createSettingsStore({storage}), events = [];
  store.subscribe((state,meta) => events.push({state,meta}));
  store.update({inspectionDetail:false});
  assert.equal(store.state.inspectionDetail,false);
  assert.equal(store.persistent,false);
  assert.equal(events.length,1);
  assert.equal(events[0].state.inspectionDetail,false);
  assert.equal(events[0].meta.persistent,false);
  assert.ok(Object.isFrozen(events[0].state) && Object.isFrozen(events[0].meta));
});

check('subscribers receive meaningful changes only and can unsubscribe', () => {
  const storage = memoryStorage(), store = createSettingsStore({storage}), events = [];
  const unsubscribe = store.subscribe(state => events.push(state));
  assert.equal(events.length,0);
  assert.equal(store.update({...DEFAULT_SETTINGS}),false);
  store.update({shadowQuality:4});
  store.update({shadowQuality:4});
  assert.equal(events.length,1);
  assert.equal(store.reset(),true);
  assert.equal(events.length,2);
  assert.equal(storage.data.has(SETTINGS_STORAGE_KEY),false);
  assert.deepEqual(createSettingsStore({storage}).state,DEFAULT_SETTINGS);
  unsubscribe(); unsubscribe();
  store.update({shadowQuality:0});
  assert.equal(events.length,2);
  assert.throws(() => store.subscribe(null),TypeError);
});

check('a failed reset reports the persistence change without losing defaults', () => {
  const storage = memoryStorage(), store = createSettingsStore({storage}), events = [];
  storage.removeItem = () => { throw new Error('Permission changed'); };
  store.subscribe((state,meta) => events.push(meta));
  assert.equal(store.reset(),true);
  assert.deepEqual(store.state,DEFAULT_SETTINGS);
  assert.equal(store.persistent,false);
  assert.equal(events.length,1);
  assert.equal(events[0].persistent,false);
});

class Element extends EventTarget {
  constructor() { super(); this.attributes = new Map(); this.dataset = {}; this.checked = false; this.hidden = false; this.textContent = ''; }
  setAttribute(key,value) { this.attributes.set(key,String(value)); }
  focus() { this.focused = true; }
}

check('Settings restores and saves the experimental toggle without an initial scene callback', () => {
  const selectors = ['#settings-toggle','#settings-close','#scene-actions','#leaf-trigger','#offline-state','#offline-status','#offline-installed','#offline-progress','#offline-progress-label','#ground-movement','#settings-storage-note'];
  const elements = new Map(selectors.map(key => [key,new Element()]));
  const panel = new Element();
  panel.querySelector = selector => elements.get(selector) ?? null;
  const document = new EventTarget();
  document.querySelector = selector => elements.get(selector) ?? null;
  const previous = globalThis.document;
  const storage = memoryStorage(), store = createSettingsStore({storage});
  store.update({groundMovement:true});
  const calls = [];
  try {
    globalThis.document = document;
    const settings = createSettingsPanel({element:panel,settingsStore:store,onGroundMovementChange:value => calls.push(value)});
    const checkbox = elements.get('#ground-movement'), note = elements.get('#settings-storage-note');
    assert.equal(checkbox.checked,true);
    assert.equal(calls.length,0,'Root applies the saved scene state after construction.');
    assert.equal(note.textContent,'Saved on this browser. No cookies.');
    checkbox.checked = false; checkbox.dispatchEvent(new Event('change'));
    assert.deepEqual(calls,[false]);
    assert.equal(createSettingsStore({storage}).state.groundMovement,false);
    storage.setItem = () => { throw new Error('Quota'); };
    store.update({indoorEnabled:false});
    assert.equal(note.textContent,'Settings are kept for this visit.');
    settings.destroy();
    const before = note.textContent;
    store.update({groundMovement:true});
    assert.equal(note.textContent,before);
    assert.equal(checkbox.checked,false,'Destroyed panel unsubscribes from later store changes.');
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

console.log(`Preference checks passed (${passed} cases; origin-local persistence and Settings integration).`);
