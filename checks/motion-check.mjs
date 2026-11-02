import assert from 'node:assert/strict';
import {setMaxListeners} from 'node:events';
import {createMotionController,cubicBezier,originalEase,MOTION_CHANNELS,validateMotion} from '../motion.js';
import {createSettingsStore,SETTINGS_STORAGE_KEY} from '../preferences.js';
import {createMotionEditor} from '../motion-editor.js';
import {createSettingsPanel} from '../settings-panel.js';
import {createGroundMotion} from '../ground-motion.js';
import {createLeaves} from '../leaves.js';
import {createLighting} from '../lighting.js';
import {getSolarState,dateAtMinutes} from '../solar-time.js';
import * as THREE from '../vendor/three/three.module.js';

let passed=0;
const check=(name,run)=>{run();passed++;console.log(`PASS ${name}`);};
const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const storage=()=>{
  const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
};
check('original timing is exact, passive and bounded; Bezier resolves time rather than its path parameter',()=>{
  const backend=storage(),store=createSettingsStore({storage:backend}),motion=createMotionController(store);
  for(const key of Object.keys(MOTION_CHANNELS))assert.equal(motion.get(key).scale,1);
  assert.equal(backend.data.size,0);
  for(const key of ['cards','time','lighting'])for(let i=0;i<=100;i++){
    const t=i/100;assert.equal(motion.transition(key).ease(t),t*t*t*(t*(6*t-15)+10));
  }
  assert.equal(motion.transition('time').duration,2500);
  for(const curve of [[0,0,1,1],[0,1,0,1],[1,0,1,0],[1,1,0,0],[.76,0,.24,1]]){
    let previous=0;
    for(let i=0;i<=100;i++){const value=cubicBezier(curve,i/100);assert.ok(value>=previous-1e-7 && value>=0 && value<=1);previous=value;}
    assert.equal(cubicBezier(curve,0),0);assert.equal(cubicBezier(curve,1),1);
  }
  near(cubicBezier([0,0,1,1],.25),.25);
  assert.ok(cubicBezier([0,1,0,1],.5)>.98,'Solving x(u) makes strong early acceleration behave correctly.');
  assert.equal(originalEase('cards',Infinity),0);
});
check('validated motion persists without mutable references, ignores corrupt values and resets independently',()=>{
  const backend=storage(),store=createSettingsStore({storage:backend}),motion=createMotionController(store);
  const curve=[.2,0,.8,1];motion.update('cards',{scale:2,curve});curve[0]=1;
  assert.equal(motion.get('cards').curve[0],.2);
  assert.ok(Object.isFrozen(store.state.motion.cards.curve));
  motion.get('cards').curve[1]=1;
  assert.equal(motion.get('cards').curve[1],0);
  assert.equal(createMotionController(createSettingsStore({storage:backend})).get('cards').scale,2);
  assert.equal(store.update({motion:JSON.parse(JSON.stringify(store.state.motion))}),false,'Equivalent values do not write/notify again.');
  assert.deepEqual(validateMotion({unknown:{scale:2},time:{scale:-1,curve:[0,0,2,1]},leaves:{scale:1.5,curve:[0,0,1,1]}}),{leaves:{scale:1.5,curve:null}});
  const snapshot=motion.transition('cards',950);motion.update('cards',{scale:.5,curve:[0,0,1,1]});
  assert.equal(snapshot.duration,1900);assert.notEqual(snapshot.ease(.25),.25);
  store.update({groundMovement:true,renderScale:1.5});motion.reset();
  assert.deepEqual(store.state.motion,{});assert.equal(store.state.groundMovement,true);assert.equal(store.state.renderScale,1.5);
  const old=storage();old.data.set(SETTINGS_STORAGE_KEY,JSON.stringify({version:1,settings:{renderScale:1.25}}));
  assert.deepEqual(createSettingsStore({storage:old}).state.motion,{},'Old saved preferences retain the original motion.');
});

class Target {
  constructor(){this.listeners=new Map();}
  addEventListener(type,handler,{signal}={}){
    if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);
    if(signal){setMaxListeners(0,signal);signal.addEventListener('abort',()=>this.listeners.get(type)?.delete(handler),{once:true});}
  }
  emit(type,props={}){
    const event={type,target:this,button:0,pointerId:1,preventDefault(){this.prevented=true;},stopPropagation(){},...props};
    for(const handler of this.listeners.get(type)??[])handler(event);return event;
  }
}
class Element extends Target {
  constructor(id=''){super();this.id=id;this.attrs=new Map();this.dataset={};this.value='';this.textContent='';this.hidden=false;this.checked=false;this.disabled=false;this.captures=new Set();
    const vars=new Map();this.style={setProperty:(k,v)=>vars.set(k,v),removeProperty:k=>vars.delete(k),getPropertyValue:k=>vars.get(k)??''};}
  setAttribute(k,v){this.attrs.set(k,String(v));}
  getAttribute(k){return this.attrs.get(k)??null;}
  focus(){this.focused=true;}
  getBoundingClientRect(){return {left:0,top:0,width:300,height:218};}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
  closest(){return this;}
}

check('Advanced editor supports pointer/keyboard curves, duration, reset, saved CSS and preview cleanup',()=>{
  const ids=['motion-target','motion-duration','motion-duration-value','motion-graph','motion-path','motion-original-path','motion-preview','motion-dot','motion-preview-paper','motion-state','motion-description','motion-handle-help','motion-reduced-note','motion-reset','motion-reset-all'];
  const els=Object.fromEntries(ids.map(id=>[id,new Element(id)]));els['motion-target'].value='cards';
  const handles=[0,1].map(i=>{const el=new Element();el.dataset.motionHandle=String(i);return el;});
  const lines=[new Element(),new Element()];
  const presets=['original','smooth','linear','accelerate','decelerate'].map(name=>{const el=new Element();el.dataset.motionPreset=name;return el;});
  const root=new Element();root.querySelector=s=>els[s.slice(1)];root.querySelectorAll=s=>s.includes('line')?lines:s.includes('handle')?handles:presets;
  const doc=new Target();doc.body=new Element();doc.hidden=false;const win=new Target(),media=new Target();media.matches=false;
  const globals={document:globalThis.document,window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  const frames=new Map();let id=0;
  Object.assign(globalThis,{document:doc,window:win,requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key)});
  const tick=now=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));};
  const store=createSettingsStore({storage:storage()}),motion=createMotionController(store);
  let editor;
  try{
    editor=createMotionEditor({element:root,motion,settingsStore:store,reducedMotion:media});
    assert.equal(els['motion-state'].textContent,'Original curve');assert.equal(frames.size,0);
    assert.equal(doc.body.style.getPropertyValue('--motion-ui-fade'),'650ms');
    assert.equal(doc.body.style.getPropertyValue('--motion-layout-ease'),'');
    editor.setActive(true);presets[2].emit('click');
    assert.deepEqual(motion.get('cards').curve,[0,0,1,1]);
    els['motion-duration'].value='200';els['motion-duration'].emit('input');assert.equal(motion.transition('cards').duration,1900);
    const graph=els['motion-graph'];graph.emit('pointerdown',{target:handles[0],pointerId:8});
    graph.emit('pointermove',{pointerId:8,clientX:91,clientY:100});
    near(motion.get('cards').curve[0],.25);near(motion.get('cards').curve[1],.5);
    graph.emit('pointerup',{pointerId:8,clientX:91,clientY:100});assert.equal(graph.captures.size,0);
    handles[1].emit('keydown',{key:'ArrowLeft',shiftKey:true});near(motion.get('cards').curve[2],.9);
    els['motion-preview'].emit('click');assert.equal(frames.size,1);tick(0);tick(950);
    assert.notEqual(els['motion-preview-paper'].getAttribute('transform'),'translate(10 6)');
    editor.setActive(false);assert.equal(frames.size,0);assert.equal(els['motion-preview'].getAttribute('aria-pressed'),'false');
    els['motion-reset'].emit('click');assert.deepEqual(motion.get('cards'),{scale:1,curve:null});
    els['motion-target'].value='ui';els['motion-target'].emit('change');
    els['motion-duration'].value='50';els['motion-duration'].emit('input');presets[3].emit('click');
    assert.equal(doc.body.style.getPropertyValue('--motion-ui-fade'),'325ms');
    assert.equal(doc.body.style.getPropertyValue('--motion-ui-ease'),'cubic-bezier(0.42,0,1,1)');
    els['motion-target'].value='leaves';els['motion-target'].emit('change');assert.equal(handles[0].getAttribute('aria-disabled'),'true');assert.equal(presets[0].disabled,true);
    els['motion-reset-all'].emit('click');assert.equal(doc.body.style.getPropertyValue('--motion-ui-ease'),'');
    assert.equal(doc.body.style.getPropertyValue('--motion-ui-fade'),'650ms');
    media.matches=true;media.emit('change');assert.equal(els['motion-preview'].disabled,true);
    editor.destroy();const before=els['motion-state'].textContent;store.update({motion:{cards:{scale:2}}});assert.equal(els['motion-state'].textContent,before);
    assert.equal(frames.size,0);
  }finally{editor?.destroy();for(const [key,value]of Object.entries(globals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

check('Settings tab semantics and keyboard switching keep experimental controls on Advanced',()=>{
  const ids=['settings-toggle','settings-close','scene-actions','leaf-trigger','offline-state','offline-status','offline-installed','offline-progress','offline-progress-label','ground-movement','settings-storage-note','settings-general','settings-advanced'];
  const els=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  const tabs=['general','advanced'].map(name=>{const el=new Element(`settings-${name}-tab`);el.setAttribute('aria-controls',`settings-${name}`);return el;});
  const root=new Element();root.querySelector=s=>els[s.slice(1)];root.querySelectorAll=()=>tabs;
  const doc=new Target();doc.querySelector=s=>els[s.slice(1)];const original=globalThis.document;globalThis.document=doc;
  const changes=[];let panel;
  try{
    panel=createSettingsPanel({element:root,settingsStore:createSettingsStore({storage:storage()}),onTabChange:value=>changes.push(value)});
    assert.equal(els['settings-general'].hidden,false);assert.equal(els['settings-advanced'].hidden,true);panel.show();
    tabs[0].emit('keydown',{key:'ArrowRight'});assert.equal(panel.tab,'advanced');assert.equal(els['settings-general'].hidden,true);assert.equal(els['settings-advanced'].hidden,false);
    assert.equal(tabs[0].tabIndex,-1);assert.equal(tabs[1].tabIndex,0);assert.equal(tabs[1].focused,true);
    panel.close();panel.show();assert.equal(panel.tab,'advanced');
    tabs[1].emit('keydown',{key:'Home'});assert.equal(panel.tab,'general');assert.deepEqual(changes,['advanced','general']);
    panel.destroy();tabs[1].emit('click');assert.equal(panel.tab,'general');
  }finally{panel?.destroy();if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});

check('physics timing changes pace without changing the collision/spring trajectory',()=>{
  const normal=createGroundMotion(),slow=createGroundMotion({timeScale:()=>.5});
  for(const effect of [normal,slow]){effect.begin(0);effect.move(.5,.1,60);effect.release(60);}
  for(let i=1;i<=60;i++)normal.step(60+i*1000/120);
  for(let i=1;i<=120;i++)slow.step(60+i*1000/120);
  near(normal.position.x,slow.position.x);near(normal.position.z,slow.position.z);
  const random=()=>.5,sceneA=new THREE.Scene(),sceneB=new THREE.Scene();
  const a=createLeaves(sceneA,{random}),b=createLeaves(sceneB,{random,timeScale:()=>.5});
  a.blow();b.blow();a.step(0);b.step(0);
  for(let i=1;i<=30;i++)a.step(i*1000/120);
  for(let i=1;i<=60;i++)b.step(i*1000/120);
  const meshesA=[],meshesB=[];sceneA.traverse(o=>{if(o.userData.isWindLeaf)meshesA.push(o);});sceneB.traverse(o=>{if(o.userData.isWindLeaf)meshesB.push(o);});
  assert.equal(meshesA.length,meshesB.length);for(let i=0;i<meshesA.length;i++)near(meshesA[i].position.distanceTo(meshesB[i].position),0);
  a.destroy();b.destroy();
});

check('lighting captures custom curve/duration and still obeys immediate updates',()=>{
  const store=createSettingsStore({storage:storage()}),motion=createMotionController(store),scene=new THREE.Scene();
  const light=createLighting(scene,{motion}),date=new Date('2026-11-02T12:00:00Z');
  light.update(getSolarState(dateAtMinutes(720,date)),true,true);
  const start=scene.background.clone();motion.update('lighting',{scale:2,curve:[0,0,1,1]});
  const began=performance.now();light.update(getSolarState(dateAtMinutes(0,date)),false);
  const destinationScene=new THREE.Scene(),destination=createLighting(destinationScene);destination.update(getSolarState(dateAtMinutes(0,date)),false,true);
  light.step(began+650);const middle=start.clone().lerp(destinationScene.background,.5);
  near(scene.background.r,middle.r,.003);near(scene.background.g,middle.g,.003);near(scene.background.b,middle.b,.003);
  light.update(getSolarState(dateAtMinutes(720,date)),true,true);assert.equal(light.step(began+2000),false);
});

console.log(`Motion checks passed (${passed} cases; curves, original defaults, persistence, editor/tab input, preview lifecycle and real lighting/physics).`);
