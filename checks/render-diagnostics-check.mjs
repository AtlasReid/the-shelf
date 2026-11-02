import assert from 'node:assert/strict';
import {setMaxListeners} from 'node:events';
import {createRenderDiagnostics} from '../render-diagnostics.js';
import {createSettingsStore,DEFAULT_SETTINGS} from '../preferences.js';

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type,callback,{signal} = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type,new Set());
    this.listeners.get(type).add(callback);
    if (signal) { setMaxListeners(0,signal); signal.addEventListener('abort',()=>this.listeners.get(type)?.delete(callback),{once:true}); }
  }
  emit(type) { for(const listener of this.listeners.get(type) ?? [])listener({target:this,currentTarget:this}); }
}
class Element extends Target {
  constructor() {
    super(); this.value = ''; this.textContent = ''; this.hidden = false; this.checked = false;
    this.dataset = {}; this.attrs = new Map(); this.children = new Map();
    const classes = new Set();
    this.classList = {add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};
  }
  setAttribute(name,value) { this.attrs.set(name,String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  querySelector(selector) { return this.children.get(selector) ?? null; }
  querySelectorAll() { return []; }
}
class MemoryStorage {
  data = new Map(); writes = 0;
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key,value) { this.writes++; this.data.set(key,value); }
  removeItem(key) { this.data.delete(key); }
}
let clock = 0,timerId = 0;
const timers = new Map();
const originals = Object.fromEntries(['document','performance','devicePixelRatio','getComputedStyle','setTimeout','clearTimeout'].map(key=>[key,globalThis[key]]));
globalThis.performance = {now:()=>clock};
globalThis.devicePixelRatio = 1;
globalThis.getComputedStyle = ()=>({getPropertyValue:()=>''});
globalThis.setTimeout = (callback,delay)=>{timers.set(++timerId,{at:clock+delay,callback});return timerId;};
globalThis.clearTimeout = id=>timers.delete(id);
function advance(milliseconds) {
  clock += milliseconds;
  for(const [id,timer] of [...timers])if(timer.at <= clock){timers.delete(id);timer.callback();}
}
function fixture({storage = new MemoryStorage(),store = null} = {}) {
  clock = 0; timers.clear();
  const document = new Target(); document.hidden = false; document.body = new Element();
  globalThis.document = document;
  const element = new Element(),els = {};
  for(const id of ['perf-fps','perf-live','render-scale','render-scale-value','shadow-quality','shadow-quality-value',
    'quality-auto','quality-status','perf-recommendation','quality-benchmark','fps-graph','inspection-detail']) {
    els[id] = new Element(); element.children.set(`#${id}`,els[id]);
  }
  els['shadow-quality'].value = '2';
  const targetLabel = new Element(); element.children.set('.settings-graph-labels span:last-child',targetLabel);
  const presets = [100,125,150,200].map(value=>{const button=new Element();button.dataset.renderScale=String(value);return button;});
  element.querySelectorAll = selector=>selector === '[data-render-scale]' ? presets : [];
  const graph = els['fps-graph']; graph.clientWidth=280;graph.clientHeight=88;
  graph.getContext = ()=>Object.fromEntries(['setTransform','clearRect','setLineDash','beginPath','moveTo','lineTo','stroke','fillText','arc','fill'].map(name=>[name,()=>{}]));
  const notice = new Element(),message = new Element(),detail = new Element();
  notice.children.set('#graphics-status-message',message);notice.children.set('#graphics-status-detail',detail);
  document.querySelector = selector=>selector === '#graphics-status' ? notice : null;
  let invalidations=0;
  const renderer = {ratios:[],shadowMap:{enabled:true},capabilities:{maxTextureSize:8192},setPixelRatio(value){this.ratios.push(value);}};
  const light = {isLight:true,name:'Sunlight',shadow:{mapSize:{x:2048,y:2048,set(x,y){this.x=x;this.y=y;}}}};
  const scene = {traverse(callback){callback(light);callback({isMesh:true,material:{}});}};
  store ??= createSettingsStore({storage});
  const diagnostics = createRenderDiagnostics({element,renderer,scene,invalidate:()=>invalidations++,settingsStore:store,noticeElement:notice});
  function tick(rate = 30,active = true) { advance(1000/rate);diagnostics.frame(clock,{active}); }
  function run(milliseconds,rate = 30,active = true) {
    const until=clock+milliseconds;
    while(clock < until)tick(typeof rate === 'function' ? rate() : rate,active);
  }
  function until(predicate,limit = 20_000,rate = 30) {
    const deadline=clock+limit;
    while(!predicate() && clock < deadline)tick(typeof rate === 'function' ? rate() : rate);
    assert.ok(predicate(),'Expected state reached within the bounded simulation.');
  }
  return {diagnostics,element,els,notice,message,detail,document,renderer,presets,store,storage,tick,run,until,targetLabel,
    get invalidations(){return invalidations;},destroy(){diagnostics.destroy();}};
}
let passed = 0;
function check(name,run) { run();passed++;console.log(`PASS ${name}`); }

try {
  check('first visit starts with a stable preset and does not benchmark or write storage',()=>{
    const f=fixture();
    assert.equal(f.diagnostics.pixelRatio,1);assert.equal(f.els['shadow-quality'].value,'2');
    assert.equal(f.diagnostics.continuous,false);assert.equal(f.element.dataset.qualityMode,'automatic');
    assert.equal(f.notice.hidden,true);assert.equal(f.storage.writes,0);
    f.run(30_000,30,false);
    assert.equal(f.renderer.ratios.length,1);assert.equal(f.storage.writes,0);
    assert.equal(f.diagnostics.continuous,false);f.destroy();
  });

  check('sustained slow animation starts a downward quality check with temporary honest copy',()=>{
    const f=fixture();
    f.run(6900,20);assert.equal(f.element.dataset.qualityMode,'automatic');assert.equal(f.notice.hidden,true);
    f.until(()=>f.element.dataset.qualityMode === 'measuring',2000,20);
    assert.equal(f.message.textContent,'Adjusting graphics for smoother viewing…');
    assert.equal(f.detail.textContent,'Picture quality may change briefly.');
    assert.equal(f.notice.classList.contains('is-visible'),true);assert.equal(f.diagnostics.continuous,true);
    f.until(()=>f.message.textContent === 'Graphics adjusted for this browser.',10_000,()=>f.element.dataset.shadowQuality === 'low' ? 40 : 20);
    assert.equal(f.diagnostics.pixelRatio,.75);assert.equal(f.els['shadow-quality'].value,'1');
    assert.equal(f.store.state.shadowQuality,1);assert.equal(f.storage.writes,1,'Only the completed profile is saved.');
    assert.equal(f.diagnostics.continuous,false);assert.equal(f.notice.classList.contains('is-visible'),true);
    advance(2501);assert.equal(f.notice.classList.contains('is-visible'),false);
    assert.equal(f.notice.getAttribute('aria-hidden'),'true');f.destroy();
  });

  check('idle gaps, visibility changes and clock reversal cannot combine into a slowdown',()=>{
    const f=fixture();f.run(6900,20);f.tick(20,false);f.run(3300,20);
    assert.equal(f.element.dataset.qualityMode,'automatic');
    f.document.hidden=true;f.document.emit('visibilitychange');f.run(10_000,20);
    f.document.hidden=false;f.document.emit('visibilitychange');f.run(3200,20);
    assert.equal(f.element.dataset.qualityMode,'automatic');
    advance(-2000);f.diagnostics.frame(clock,{active:true});f.run(3200,20);
    assert.equal(f.element.dataset.qualityMode,'automatic');assert.equal(f.storage.writes,0);f.destroy();
  });

  check('manual controls cancel a benchmark, clear its message and restore after reload',()=>{
    const storage=new MemoryStorage(),f=fixture({storage});
    f.els['quality-benchmark'].emit('click');assert.equal(f.diagnostics.continuous,true);
    assert.equal(f.notice.classList.contains('is-visible'),true);
    f.els['render-scale'].value='150';f.els['render-scale'].emit('input');
    assert.equal(f.element.dataset.qualityMode,'manual');assert.equal(f.diagnostics.pixelRatio,1.5);
    assert.equal(f.notice.hidden,true);assert.equal(f.diagnostics.continuous,false);
    assert.equal(f.store.state.automatic,false);const shadow=f.store.state.shadowQuality;f.destroy();
    const restored=fixture({storage});assert.equal(restored.diagnostics.pixelRatio,1.5);
    assert.equal(restored.els['shadow-quality'].value,String(shadow));assert.equal(restored.els['quality-auto'].checked,false);
    assert.equal(restored.diagnostics.continuous,false);
    restored.els['quality-auto'].checked=true;restored.els['quality-auto'].emit('change');
    assert.equal(restored.element.dataset.qualityMode,'automatic');assert.equal(restored.diagnostics.continuous,false);
    assert.equal(restored.notice.hidden,true,'Turning automatic on does not launch a benchmark.');restored.destroy();
  });

  check('a saved automatic profile resumes passive watching without another startup sweep',()=>{
    const storage=new MemoryStorage();const f=fixture({storage});
    f.store.update({renderScale:1.25,shadowQuality:4});f.destroy();
    const writes=storage.writes,restored=fixture({storage});
    assert.equal(restored.diagnostics.pixelRatio,1.25);assert.equal(restored.els['shadow-quality'].value,'4');
    assert.equal(restored.els['quality-auto'].checked,true);assert.equal(restored.diagnostics.continuous,false);
    restored.run(20_000,60);
    assert.equal(restored.renderer.ratios.length,1);assert.equal(storage.writes,writes);
    assert.equal(restored.notice.hidden,true);restored.destroy();
  });

  check('inspection detail and the live meter persist and external preference updates do not loop',()=>{
    const storage=new MemoryStorage(),f=fixture({storage});
    f.els['inspection-detail'].checked=false;f.els['inspection-detail'].emit('change');
    f.els['perf-live'].checked=false;f.els['perf-live'].emit('change');
    assert.equal(f.diagnostics.inspectionDetail,false);assert.equal(f.store.state.inspectionDetail,false);
    assert.equal(f.store.state.liveFps,false);assert.equal(storage.writes,2);
    f.store.update({automatic:false,renderScale:1.25,shadowQuality:3});
    assert.equal(f.diagnostics.pixelRatio,1.25);assert.equal(f.els['shadow-quality'].value,'3');
    assert.equal(storage.writes,3,'Applying a stored snapshot never writes it back again.');f.destroy();
    const restored=fixture({storage});assert.equal(restored.diagnostics.inspectionDetail,false);
    assert.equal(restored.els['perf-live'].checked,false);restored.diagnostics.setPanelOpen(true);
    assert.equal(restored.diagnostics.continuous,false);restored.destroy();
  });

  check('unrelated saved preferences do not restore stale quality during a benchmark',()=>{
    const f=fixture();f.els['quality-benchmark'].emit('click');
    assert.equal(f.element.dataset.qualityMode,'measuring');
    assert.equal(f.els['shadow-quality'].value,'1');assert.equal(f.store.state.shadowQuality,2);
    const applications=f.renderer.ratios.length;
    f.store.update({indoorEnabled:false,groundMovement:true});
    f.store.update({motion:{cards:{scale:2,curve:[0,0,1,1]}}});
    f.els['inspection-detail'].checked=false;f.els['inspection-detail'].emit('change');
    f.els['perf-live'].checked=false;f.els['perf-live'].emit('change');
    assert.equal(f.element.dataset.qualityMode,'measuring');
    assert.equal(f.els['shadow-quality'].value,'1');assert.equal(f.renderer.ratios.length,applications);
    assert.equal(f.message.textContent,'Adjusting graphics for smoother viewing…');
    assert.equal(f.diagnostics.continuous,true);assert.equal(f.storage.writes,4);
    f.until(()=>f.element.dataset.qualityMode === 'automatic',40_000,60);
    assert.equal(f.store.state.shadowQuality,4);assert.equal(f.store.state.renderScale,2);
    assert.equal(f.storage.writes,5,'Only the final profile adds a graphics preference write.');f.destroy();
  });

  check('switching automatic adjustment off saves the displayed trial profile',()=>{
    const storage=new MemoryStorage(),f=fixture({storage});f.els['quality-benchmark'].emit('click');
    f.els['quality-auto'].checked=false;f.els['quality-auto'].emit('change');
    assert.equal(f.store.state.automatic,false);assert.equal(f.store.state.renderScale,1);
    assert.equal(f.store.state.shadowQuality,1);assert.equal(f.element.dataset.qualityMode,'manual');
    assert.equal(f.notice.hidden,true);f.destroy();
    const restored=fixture({storage});assert.equal(restored.diagnostics.pixelRatio,1);
    assert.equal(restored.els['shadow-quality'].value,'1');assert.equal(restored.diagnostics.continuous,false);restored.destroy();
  });

  check('an explicit benchmark can complete and the graph retains actual FPS above its target',()=>{
    const f=fixture();f.diagnostics.setPanelOpen(true);f.els['quality-benchmark'].emit('click');
    f.until(()=>f.message.textContent === 'Graphics adjusted for this browser.',40_000,60);
    assert.equal(f.store.state.renderScale,2);assert.equal(f.store.state.shadowQuality,4);
    assert.ok(Number(f.els['perf-fps'].textContent)>30);
    assert.match(f.els['fps-graph'].getAttribute('aria-label'),/latest 60 FPS\. Target 30 FPS/);
    assert.equal(f.targetLabel.textContent,'Target 30 FPS');
    f.diagnostics.setPanelOpen(false);assert.equal(f.diagnostics.continuous,false);f.destroy();
  });

  check('unavailable storage does not break manual rendering settings',()=>{
    const f=fixture({store:{get state(){throw new Error('Blocked');},update(){throw new Error('Quota');}}});
    f.presets[1].emit('click');assert.equal(f.diagnostics.pixelRatio,1.25);
    assert.equal(f.element.dataset.qualityMode,'manual');f.destroy();
  });

  check('destroy removes listeners, timers and preference subscriptions',()=>{
    const f=fixture();f.els['quality-benchmark'].emit('click');f.destroy();
    const calls=f.renderer.ratios.length;
    f.els['render-scale'].value='200';f.els['render-scale'].emit('input');
    f.store.update({renderScale:2});advance(10_000);f.diagnostics.frame(clock,{active:true});
    assert.equal(f.renderer.ratios.length,calls);assert.equal(f.diagnostics.continuous,false);
    assert.equal(f.notice.hidden,true);assert.equal(timers.size,0);
  });
  assert.equal(DEFAULT_SETTINGS.renderScale,1);
  console.log(`Render diagnostics checks passed (${passed} cases; production controls, meter, persistence and benchmark notice).`);
} finally {
  for(const [key,value] of Object.entries(originals)) { if(value === undefined)delete globalThis[key];else globalThis[key]=value; }
}
