import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../vendor/three/three.module.js';
import { cards } from '../compatibility/cards.js';
import { getSolarState, dateAtMinutes } from '../solar-time.js';
import { createGroundMotion } from '../ground-motion.js';
import { createSettingsStore } from '../preferences.js';
import { createMotionController } from '../motion.js';

// Run the production interaction functions and listeners with deterministic
// time/RAF and no WebGL or image loading. Only module imports and the automatic
// initialize() invocation are removed; production is not changed for the test.
const original = await readFile(new URL('../scene.js', import.meta.url), 'utf8');
assert.match(original, /initialize\(\)\.catch\(showError\);\s*$/);
const source = original.replace(/^import .*;\r?\n/gm, '')
  .replace(/initialize\(\)\.catch\(showError\);\s*$/, '');
// This listener is registered inside initialize(). Evaluate its actual source
// separately so the preference-change path is covered without renderer setup.
const reducedMotionListener = original.match(/reducedMotion\.addEventListener\('change',[\s\S]*?\r?\n  \}\);/);
assert.ok(reducedMotionListener, 'The production reduced-motion listener must be found.');

class EventTarget {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  emit(type, props = {}) {
    const event = {
      type, target:this, currentTarget:this, button:0, pointerId:1,
      isPrimary:true, shiftKey:false, clientX:640, clientY:300, deltaY:0,
      defaultPrevented:false,
      preventDefault() { this.defaultPrevented = true; },
      ...props,
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

class Element extends EventTarget {
  constructor(id, tagName = 'DIV') {
    super();
    this.id = id;
    this.tagName = tagName;
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.style = { setProperty(name, value) { this[name] = value; } };
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle(name, force) {
        const add = force === undefined ? !classes.has(name) : force;
        if (add) classes.add(name); else classes.delete(name);
        return add;
      },
    };
    this.captures = new Set();
    this.query = () => [];
    this.bounds = () => ({left:0,top:0,width:1280,height:632});
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelectorAll(selector) { return this.query(selector); }
  getBoundingClientRect() {
    const result = this.bounds();
    return {...result, right:result.left + result.width, bottom:result.top + result.height};
  }
  get clientHeight() { return this.bounds().height; }
  matches(selector) { return selector === 'input' && this.tagName === 'INPUT'; }
  closest() { return null; }
  focus() { this.focused = true; }
  setPointerCapture(pointerId) { this.captures.add(pointerId); }
  hasPointerCapture(pointerId) { return this.captures.has(pointerId); }
  releasePointerCapture(pointerId) {
    if (this.captures.delete(pointerId)) this.emit('lostpointercapture', {pointerId});
  }
}

function createHarness({reduced = false} = {}) {
  let now = 0, nextFrame = 0, nextTimer = 0;
  const epoch = Date.parse('2026-10-30T20:00:00Z');
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [epoch + now])); }
    static now() { return epoch + now; }
  }
  let dimensions = {left:0,top:88,width:1280,height:632};
  const frames = new Map(), timers = new Map();
  const elements = new Map();
  const ids = ['scene-canvas','scene-shell','inspection-controls','card-list','opening',
    'opening-value','put-back','selected-title','scene-instruction','reset-view',
    'previous-card','next-card','loading','scene-error','interface-toggle','card-action-toggle','view-actions','scene-actions','scene-introduction','graphics-status',
    'edge-card-navigation','edge-previous-card','edge-next-card'];
  for (const id of ids) elements.set(`#${id}`, new Element(id, id === 'opening' ? 'INPUT' : 'DIV'));
  const views = ['front','inside','back'].map(view => {
    const button = new Element(`view-${view}`, 'BUTTON');
    button.dataset.view = view;
    return button;
  });
  const cardButtons = cards.map(card => {
    const button = new Element(card.id, 'BUTTON');
    button.dataset.cardId = card.id;
    return button;
  });
  const canvas = elements.get('#scene-canvas');
  const shell = elements.get('#scene-shell');
  const controls = elements.get('#inspection-controls');
  const slider = elements.get('#opening');
  shell.bounds = canvas.bounds = () => dimensions;
  elements.get('#put-back').bounds = () => ({left:dimensions.width-136,top:dimensions.top+(dimensions.width<=700?25:36),width:100,height:dimensions.width<=700?36:40});
  for (const id of ['view-actions','scene-actions']) elements.get(`#${id}`).bounds = () => ({left:16,top:dimensions.top+dimensions.height-(dimensions.width<=700?54:62),width:89,height:dimensions.width<=700?38:40});
  controls.bounds = () => {
    const height = controls.dataset.cardType === 'postcard' ? 140 : 224;
    return {left:415,top:dimensions.top + dimensions.height - height - 16,width:450,height};
  };
  controls.hidden = true;
  elements.get('#card-action-toggle').hidden = true;
  elements.get('#edge-card-navigation').hidden = true;
  controls.query = selector => {
    assert.equal(selector, '#opening, [data-view], #reset-view');
    return [slider, ...views, elements.get('#reset-view')];
  };
  elements.get('#card-list').query = selector => {
    assert.equal(selector, 'button');
    return cardButtons;
  };
  const document = new EventTarget();
  document.body = new Element('body', 'BODY');
  const theme = new Element('theme-color', 'META');
  document.querySelector = selector => {
    if (selector === 'meta[name="theme-color"]') return theme;
    assert.ok(elements.has(selector), `Unexpected DOM selector: ${selector}`);
    return elements.get(selector);
  };
  document.querySelectorAll = selector => {
    assert.equal(selector, '[data-view]');
    return views;
  };
  const window = new EventTarget();
  const media = new EventTarget();
  media.matches = reduced;
  const context = vm.createContext({
    THREE, cards, getSolarState, dateAtMinutes, createGroundMotion, createSettingsStore, createMotionController, document, window, console, Date:ClockDate,
    devicePixelRatio:1, matchMedia:() => media,
    performance:{now:() => now},
    requestAnimationFrame:callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame:id => frames.delete(id),
    setTimeout:(callback,delay=0) => { timers.set(++nextTimer, {callback,due:now+delay}); return nextTimer; },
    clearTimeout:id => timers.delete(id),
    __buttons:cardButtons,
  });
  vm.runInContext(source, context, {filename:'scene.js (pickup regression)'});
  vm.runInContext(`
    renderer = {render(){},setSize(){},setPixelRatio(){}};
    lighting = {
      step(){return false;}, update(solar,enabled,immediate){this.lastUpdate={solar,enabled,immediate};},
      followView(camera,focus,immediate){this.lastView={camera,focus:focus?.clone() ?? null,immediate};},
    };
    lightControl = {
      relocate(){}, update(state){this.state=state;},
      setTimeMoving(moving){this.moving=moving;}, cancelPointer(){this.pointerCancellations=(this.pointerCancellations||0)+1;},
      element:{hidden:false},
    };
    cards.forEach((card,index) => {
      const group = new THREE.Group();
      let opening = card.type === 'postcard' ? 0 : 22 + index%3*3;
      const model = {
        group,width:card.width/100,height:card.height/100,
        canFold:card.type !== 'postcard',foldAxis:card.foldAxis,
        get opening(){return opening;},setOpening(value){opening=this.canFold ? Number(value) : 0;},
        boundsForOpening(value) {
          const span = 1 + Math.max(0,-Math.cos(value * Math.PI / 180));
          return {width:this.width * (this.canFold && this.foldAxis !== 'horizontal' ? span : 1),
            height:this.height * (this.foldAxis === 'horizontal' ? span : 1)};
        },
      };
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(model.width, model.height, .01));
      mesh.position.y = model.height / 2;
      mesh.userData.cardId = card.id;
      group.add(mesh);
      pickable.push(mesh);
      scene.add(group);
      models.push({model,card,button:__buttons[index],home:{position:group.position.clone(),quaternion:group.quaternion.clone(),opening}});
    });
    const slots = collectionSlots(models.map(record=>record.model));
    models.forEach((record,index)=>{
      record.model.group.position.set(slots[index].x,0,slots[index].z);
      record.model.group.rotation.y=slots[index].turn;
      record.home.position.copy(record.model.group.position);
      record.home.quaternion.copy(record.model.group.quaternion);
    });
    ready = true;
    shell.dataset.state = 'collection';
    resize();
    globalThis.testAPI = {
      select:selectCard,resize,
      expandedView(){return expandedCardView;},
      lightElement:lightControl.element,
      watchSettings(){settingsPanel={closures:0,close(options){this.closures++;this.lastClose=options;}};return settingsPanel;},
      editMotion(key,patch){motion.update(key,patch);},
      setTime:setManualTime,travel:travelToTime,
      setIndoor(enabled){indoorEnabled=enabled;refreshLighting();},
      timeState(){return {minutes:manualTime?.minutes ?? null,date:manualTime?.date,
        moving:Boolean(timeTravel),control:lightControl.state,holdingDetails:lightControl.moving,
        light:lighting.lastUpdate,indoor:indoorEnabled,source:shell.dataset.timeSource};},
      record(index){return models[index];},
      tween(index){return tweens.get(models[index]);},
      target(index){const expanded=models[index]===selected && expandedCardView;return inspectionTarget(models[index],expanded||'inside',{fillViewport:Boolean(expanded)});},
      home(index){return homeTarget(models[index]);},
      centre(index){return centreOf(models[index]);},
      collectionProjection(){return collectionPoints().map(point=>point.project(camera));},
      inspectionProjection(index) {
        scene.updateMatrixWorld(true);
        const record=models[index],bounds=cardBounds(record,record.model.opening),points=[];
        for(const x of [-bounds.width/2,bounds.width/2])for(const y of [-bounds.height/2,bounds.height/2]) {
          points.push(new THREE.Vector3(x,y+record.model.height/2,0).applyMatrix4(record.model.group.matrixWorld).project(camera));
        }
        return points;
      },
      slots(){return collectionSlots(models.map(record=>record.model));},
      lightView(){return lighting.lastView;},
      watchReadingRenderer(){
        renderDiagnostics={pixelRatio:.75,inspectionDetail:true,frame(){},continuous:false};
        readingRenderer={state:{mode:'inspection',sceneScale:.75,readingScale:.75},render(group,options){this.last={group,...options};}};
      },
      readingRender(){return readingRenderer?.last;},
      enableGroundMovement:setGroundMovementEnabled,
      groundState(){return {enabled:groundMovementEnabled,position:groundMotion.position,velocity:groundMotion.velocity,moving:groundMotion.moving,held:groundMotion.held,camera:camera.position.clone(),home:homeCameraPosition.clone(),quaternion:camera.quaternion.clone(),frames:frame};},
      cardPoint(index){const point=centreOf(models[index]).project(camera),bounds=canvas.getBoundingClientRect();return {clientX:bounds.left+(point.x+1)*bounds.width/2,clientY:bounds.top+(1-point.y)*bounds.height/2};},
      groundPoint(){const point=new THREE.Vector3(0,0,7).project(camera),bounds=canvas.getBoundingClientRect();return {clientX:bounds.left+(point.x+1)*bounds.width/2,clientY:bounds.top+(1-point.y)*bounds.height/2};},
      state(){return {selected:selected?.card.id ?? null,pickup:pickup?.record.card.id ?? null,
        drag:drag?.pointerId ?? null,dragMode:drag?.mode ?? null,touches:[...touchPointers.keys()],touchSuppressed:touchSequenceSuppressed,
        sliderHeld,tweenCount:tweens.size,cardMotion:shell.dataset.cardMotion};},
    };
  `, context);
  vm.runInContext(reducedMotionListener[0], context);
  const api = context.testAPI;
  const tick = milliseconds => {
    now += milliseconds;
    const queued = [...frames.values()];
    frames.clear();
    for (const callback of queued) callback(now);
  };
  tick(0);
  return {
    api, canvas, shell, controls, slider, views, document, window, media, cardButtons,
    el:id => elements.get(`#${id}`), tick, currentDate:() => new ClockDate(),
    advanceTimers(milliseconds) {
      now+=milliseconds;
      for (const [id,timer] of [...timers].sort((a,b)=>a[1].due-b[1].due)) {
        if (timer.due<=now && timers.delete(id)) timer.callback();
      }
    },
    setSize(width,height) { dimensions = {...dimensions,width,height}; },
  };
}

const near = (actual, expected, message) => assert.ok(Math.abs(actual-expected) < 1e-9, `${message}: ${actual} != ${expected}`);
function assertReady(h, index) {
  const record = h.api.record(index), target = h.api.target(index);
  assert.equal(h.api.state().selected, cards[index].id);
  assert.equal(h.api.state().pickup, null);
  assert.equal(h.api.state().cardMotion, 'ready');
  near(record.model.opening, record.model.canFold ? 160 : 0, 'arrived at the default reading view');
  assert.ok(h.api.centre(index).distanceTo(target.centre) < 1e-8, 'arrived at inspection centre');
  assert.ok(record.model.group.quaternion.angleTo(target.quaternion) < 1e-7, 'arrived at inspection orientation');
  assert.equal(h.controls.getAttribute('aria-busy'), 'false');
  assert.ok([h.slider,...h.views,h.el('reset-view')].every(control => control.disabled === (!record.model.canFold && (control === h.slider || control.dataset.view === 'inside'))));
}

let passed = 0;
function check(name, callback) {
  callback();
  passed++;
  console.log(`PASS ${name}`);
}

check('the interface toggle masks regular controls without changing layout state or retained tools', () => {
  const h = createHarness(), button = h.el('interface-toggle');
  const settings = h.api.watchSettings();
  const targets = [h.el('scene-introduction'),h.el('card-list'),h.controls,h.api.lightElement,h.el('graphics-status'),h.el('loading')];
  const bounds = h.controls.getBoundingClientRect();
  button.emit('click');
  assert.equal(h.document.body.dataset.interfaceVisibility, 'hidden');
  assert.equal(button.getAttribute('aria-label'), 'Show interface');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.focused, true);
  assert.ok(targets.every(element => element.inert));
  assert.equal(button.inert, undefined);
  assert.equal(h.el('put-back').inert, undefined);
  assert.equal(settings.closures, 1);
  assert.equal(settings.lastClose.restoreFocus, false);
  assert.equal(h.controls.hidden, true, 'collection keeps inspection closed');
  assert.deepEqual(h.controls.getBoundingClientRect(), bounds, 'mask retains framing measurements');
  button.emit('click');
  assert.equal(h.document.body.dataset.interfaceVisibility, 'visible');
  assert.equal(button.getAttribute('aria-label'), 'Hide interface');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.ok(targets.every(element => !element.inert));
  assert.equal(h.controls.hidden, true, 'showing UI does not open inspection controls');
  assert.equal(settings.closures, 1);
});

check('hiding mid-flight preserves card and time journeys and Put back restores visible focus', () => {
  const h = createHarness(), button = h.el('interface-toggle');
  h.api.select(0);
  h.api.travel(720);
  h.tick(250);
  const tween = h.api.tween(0);
  button.emit('click');
  assert.equal(h.api.tween(0), tween);
  assert.equal(h.api.timeState().moving, true);
  h.tick(700);
  assertReady(h, 0);
  assert.equal(h.controls.inert, true);
  assert.equal(h.controls.hidden, false);
  assert.equal(h.el('put-back').hidden, false, 'return remains available');
  h.tick(1550);
  assert.equal(h.api.timeState().moving, false);
  near(h.api.timeState().minutes, 720, 'time finishes while controls are hidden');
  button.focused = false;
  h.el('put-back').emit('click');
  h.tick(800);
  assert.equal(h.api.state().selected, null);
  assert.equal(button.focused, true, 'return focuses the retained eye control');
  assert.equal(h.cardButtons[0].focused, undefined, 'never focus a hidden card label');
  assert.equal(h.document.body.dataset.interfaceVisibility, 'hidden');
  button.emit('click');
  h.api.select(0);
  h.tick(950);
  h.el('put-back').emit('click');
  h.tick(800);
  assert.equal(h.cardButtons[0].focused, true, 'normal return focus is unchanged after Show');
});

check('hiding releases captured touch gestures while card manipulation still works without UI', () => {
  const h = createHarness();
  h.api.select(0);
  h.tick(950);
  h.canvas.emit('pointerdown', {pointerType:'touch',pointerId:81});
  assert.equal(h.canvas.hasPointerCapture(81), true);
  h.el('interface-toggle').emit('click');
  assert.equal(h.api.state().drag, null);
  assert.equal(h.api.state().touches.length, 0);
  assert.equal(h.canvas.hasPointerCapture(81), false);
  const scale = h.api.record(0).model.group.scale.x;
  h.canvas.emit('wheel', {deltaY:-120});
  assert.ok(h.api.record(0).model.group.scale.x > scale, 'canvas zoom remains usable');
  h.api.resize();
  assert.equal(h.document.body.dataset.interfaceVisibility, 'hidden');
  assert.equal(h.controls.inert, true, 'resize cannot reveal controls');
});

check('the quiet card button is selection-only, guards pickup, and opens/closes either fold axis', () => {
  for (const index of [0,13]) {
    const h = createHarness(), button = h.el('card-action-toggle');
    assert.equal(button.hidden, true);
    h.el('interface-toggle').emit('click');
    assert.equal(button.hidden, true, 'the empty collection has no card action');
    h.api.select(index);
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, true);
    h.tick(200);
    const pickup = h.api.tween(index);
    button.emit('click');
    assert.equal(h.api.tween(index), pickup, 'even a forced click cannot interrupt pickup');
    h.tick(750);
    assertReady(h, index);
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute('aria-label'), 'Close card');
    button.emit('click');
    near(h.api.record(index).model.opening, 160, 'closing starts from the displayed fold');
    h.tick(325);
    const middle = h.api.record(index).model.opening;
    assert.ok(middle > 0 && middle < 160, 'closing is animated');
    h.tick(325);
    near(h.api.record(index).model.opening, 0, 'closed at the front');
    assert.equal(button.getAttribute('aria-label'), 'Open card');
    button.emit('click');
    h.tick(650);
    assertReady(h, index);
    assert.equal(button.getAttribute('aria-label'), 'Close card');
    h.el('interface-toggle').emit('click');
    assert.equal(button.hidden, true, 'ordinary inspection keeps its existing controls');
    const restoring = h.api.tween(index);
    button.emit('click');
    assert.equal(h.api.tween(index), restoring, 'hidden button cannot change the visible interface');
    h.tick(650);
    assertReady(h, index);
    h.el('interface-toggle').emit('click');
    assert.equal(button.hidden, false);
    h.el('put-back').emit('click');
    assert.equal(button.hidden, true, 'return removes the selected-card action immediately');
  }
});

check('quiet open/close reverses from the displayed pose and retains Advanced timing through resize', () => {
  const h = createHarness(), button = h.el('card-action-toggle');
  h.api.select(0);h.tick(950);
  h.el('interface-toggle').emit('click');
  h.api.editMotion('cards', {scale:2,curve:[0,0,1,1]});
  button.emit('click');
  assert.equal(h.api.tween(0).duration, 1300);
  h.tick(650);
  near(h.api.record(0).model.opening, 80, 'custom linear closing reaches its midpoint');
  assert.equal(button.getAttribute('aria-label'), 'Open card');
  button.emit('click');
  near(h.api.record(0).model.opening, 80, 'reversing does not jump');
  assert.equal(button.getAttribute('aria-label'), 'Close card');
  h.tick(325);
  near(h.api.record(0).model.opening, 100, 'reopening follows the captured curve');
  h.api.resize();
  assert.equal(h.api.tween(0).duration, 975);
  h.tick(975);
  assertReady(h, 0);
  assert.equal(h.controls.inert, true);
});

check('quiet postcard control flips card 07 continuously between front and back without folding', () => {
  const h = createHarness(), button = h.el('card-action-toggle');
  assert.equal(cards[6].type, 'postcard');
  h.api.select(6);h.tick(950);
  h.el('interface-toggle').emit('click');
  assert.equal(button.dataset.action, 'flip');
  assert.equal(button.getAttribute('aria-label'), 'Flip card to back');
  const front = h.api.record(6).model.group.quaternion.clone();
  button.emit('click');
  const back = h.api.tween(6).end.quaternion.clone();
  h.tick(325);
  const middle = h.api.record(6).model.group.quaternion;
  assert.ok(middle.angleTo(front) > .5 && middle.angleTo(back) > .5, 'the sheet rotates through an intermediate pose');
  near(h.api.record(6).model.opening, 0, 'a postcard never folds');
  h.tick(325);
  assert.ok(h.api.record(6).model.group.quaternion.angleTo(back) < 1e-7);
  assert.equal(button.getAttribute('aria-label'), 'Flip card to front');
  button.emit('click');h.tick(650);
  assert.ok(h.api.record(6).model.group.quaternion.angleTo(front) < 1e-7);
  near(h.api.record(6).model.opening, 0, 'the return flip remains a single sheet');
  assert.equal(button.getAttribute('aria-label'), 'Flip card to back');
});

check('quiet card actions fit every card to the viewport and restore normal framing when shown', () => {
  for (const dimensions of [[1280,720],[390,844],[844,390],[320,568]]) for (let index=0;index<cards.length;index++) {
    let [width,height]=dimensions;
    const h=createHarness();h.setSize(width,height);h.api.resize();
    h.api.select(index);h.tick(950);
    const extent = () => {
      const points=h.api.inspectionProjection(index);
      return {left:Math.min(...points.map(p=>(p.x+1)*width/2)),right:Math.max(...points.map(p=>(p.x+1)*width/2)),
        top:Math.min(...points.map(p=>(1-p.y)*height/2)),bottom:Math.max(...points.map(p=>(1-p.y)*height/2))};
    };
    const normal=extent();
    h.el('interface-toggle').emit('click');
    const checkFit = () => {
      const box=extent(),margin=width<=700?16:24;
      const top=h.el('put-back').getBoundingClientRect().bottom-h.shell.getBoundingClientRect().top+12;
      const bottom=height-(h.el('view-actions').getBoundingClientRect().top-h.shell.getBoundingClientRect().top)+12;
      const label=`card ${index+1} at ${width}x${height}`;
      assert.ok(box.left>=margin-1 && box.right<=width-margin+1, `${label} clears the side margins`);
      assert.ok(box.top>=top-1 && box.bottom<=height-bottom+1, `${label} clears retained tools`);
      const occupancy=Math.max((box.right-box.left)/(width-2*margin),(box.bottom-box.top)/(height-top-bottom));
      assert.ok(occupancy>.85, `${label} nearly fills the available width or height (${occupancy})`);
    };
    for (let turn=0;turn<2;turn++) {
      h.el('card-action-toggle').emit('click');h.tick(650);checkFit();
    }
    const expanded=extent();
    assert.ok(expanded.bottom-expanded.top>(normal.bottom-normal.top)*1.15, 'the same view is enlarged rather than retaining the old zoom');
    [width,height]=[height,width];h.setSize(width,height);h.api.resize();checkFit();
    h.el('interface-toggle').emit('click');h.tick(650);
    assertReady(h,index);
    assert.equal(h.el('card-action-toggle').hidden,true);
  }
});

check('quiet card actions honour reduced motion for folding and postcard flips', () => {
  const h = createHarness({reduced:true}), button = h.el('card-action-toggle');
  h.api.editMotion('cards', {scale:3,curve:[.2,0,.8,1]});
  h.api.select(0);h.el('interface-toggle').emit('click');
  button.emit('click');near(h.api.record(0).model.opening, 0, 'close is immediate');
  assert.equal(h.api.tween(0), undefined);
  button.emit('click');assertReady(h, 0);
  h.api.select(6);
  const front = h.api.record(6).model.group.quaternion.clone();
  button.emit('click');
  assert.ok(h.api.record(6).model.group.quaternion.angleTo(front) > 3);
  assert.equal(h.api.tween(6), undefined);
  button.emit('click');
  assert.ok(h.api.record(6).model.group.quaternion.angleTo(front) < 1e-7);
  near(h.api.record(6).model.opening, 0, 'postcard stays flat');
});

check('hidden-interface edge navigation uses the hint timer and reappears without idle rendering', () => {
  const h=createHarness(),navigation=h.el('edge-card-navigation');
  const visible=()=>h.document.body.classList.contains('inspection-feedback-visible');
  assert.equal(navigation.hidden,true);
  h.el('interface-toggle').emit('click');
  assert.equal(navigation.hidden,true,'the collection has no selected-card arrows');
  h.api.select(0);h.tick(950);
  assert.equal(navigation.hidden,false);
  assert.equal(h.controls.inert,true);
  assert.equal(visible(),true);
  h.advanceTimers(349);assert.equal(visible(),true);
  h.advanceTimers(1);assert.equal(visible(),false,'the shared 350 ms pause ends');
  h.window.emit('pointermove');assert.equal(visible(),true);
  h.advanceTimers(350);assert.equal(visible(),false);
  h.window.emit('pointerdown',{pointerType:'touch'});assert.equal(visible(),true);
  h.advanceTimers(350);assert.equal(visible(),false);
  h.el('edge-next-card').emit('focus');assert.equal(visible(),true);
  h.advanceTimers(350);assert.equal(visible(),false);
  h.api.editMotion('ui',{scale:2});
  h.window.emit('keydown',{key:'Tab'});assert.equal(visible(),true);
  h.advanceTimers(699);assert.equal(visible(),true);
  h.advanceTimers(1);assert.equal(visible(),false,'Advanced duration scales the same hint delay');
  h.el('edge-previous-card').emit('pointerenter');assert.equal(visible(),true);
  assert.equal(h.api.groundState().frames,0,'revealing arrows does not render an idle 3D scene');
  h.el('interface-toggle').emit('click');
  assert.equal(navigation.hidden,true);
  h.advanceTimers(700);h.window.emit('pointermove');
  assert.equal(visible(),false,'normal UI does not acquire an extra global reveal cycle');
});

check('edge browsing preserves expanded framing, transfers pickup guards, and supports postcard 07', () => {
  const h=createHarness(),previous=h.el('edge-previous-card'),next=h.el('edge-next-card');
  h.api.select(5);h.tick(950);h.el('interface-toggle').emit('click');
  h.el('card-action-toggle').emit('click');h.tick(650);
  next.emit('click');h.tick(200);
  assert.equal(h.api.state().pickup,cards[6].id);
  next.emit('click');
  assert.equal(h.api.state().pickup,cards[7].id,'rapid browsing guards the latest card');
  h.tick(950);assertReady(h,7);
  assert.equal(h.api.expandedView(),'inside');
  assert.equal(next.focused,true,'click/Enter focus remains on the navigation button');
  previous.emit('click');h.tick(950);assertReady(h,6);
  assert.equal(h.api.expandedView(),'front');
  assert.equal(h.el('card-action-toggle').getAttribute('aria-label'),'Flip card to back');
  assert.equal(h.controls.inert,true);
  h.el('card-action-toggle').emit('click');h.tick(650);
  h.document.emit('keydown',{key:'ArrowRight',target:h.canvas});h.tick(950);assertReady(h,7);
  assert.equal(h.api.expandedView(),'inside','keyboard browsing also retains the expanded presentation');
  h.el('put-back').emit('click');
  assert.equal(h.el('edge-card-navigation').hidden,true,'return removes both edge buttons');
});

check('edge browsing wraps in reduced motion and cannot act after Show or return', () => {
  const h=createHarness({reduced:true}),previous=h.el('edge-previous-card'),next=h.el('edge-next-card');
  h.api.select(0);h.el('interface-toggle').emit('click');h.el('card-action-toggle').emit('click');
  previous.emit('click');assertReady(h,13);
  assert.equal(h.api.expandedView(),'inside');
  next.emit('click');assertReady(h,0);
  assert.equal(h.api.tween(0),undefined);
  h.el('interface-toggle').emit('click');
  assert.equal(h.el('edge-card-navigation').hidden,true);
  next.emit('click');assert.equal(h.api.state().selected,cards[0].id);
  h.el('next-card').emit('click');assertReady(h,1);
  assert.equal(h.api.expandedView(),null,'normal navigation retains its usual framing');
  h.el('put-back').emit('click');h.el('interface-toggle').emit('click');
  previous.emit('click');assert.equal(h.api.state().selected,null);
  assert.equal(h.el('edge-card-navigation').hidden,true);
});

function dragGround(h, pointerId = 41) {
  h.api.enableGroundMovement(true);
  const point = h.api.groundPoint();
  h.canvas.emit('pointerdown', {pointerId,...point});
  h.tick(16);
  h.canvas.emit('pointermove', {pointerId,clientX:point.clientX+25,clientY:point.clientY+8});
  h.tick(16);
  h.canvas.emit('pointermove', {pointerId,clientX:point.clientX+50,clientY:point.clientY+16});
}

function settleGround(h) {
  for (let i = 0; i < 420 && h.api.groundState().moving; i++) h.tick(1000 / 60);
  const ground = h.api.groundState();
  near(ground.position.x, 0, 'ground returns exactly to horizontal centre');
  near(ground.position.z, 0, 'ground returns exactly to depth centre');
  assert.equal(ground.moving, false);
  assert.equal(ground.frames, 0, 'settled ground does not keep the render loop alive');
  assert.ok(ground.camera.distanceTo(ground.home) < 1e-9);
}

check('experimental ground movement is off by default and disabling cancels a held drag without a fling', () => {
  const h = createHarness();
  assert.equal(h.api.groundState().enabled, false);
  const point = h.api.groundPoint();
  h.canvas.emit('pointermove', point);
  assert.equal(h.canvas.style.cursor, 'default');
  h.canvas.emit('pointerdown', {pointerId:41,...point});
  h.canvas.emit('pointermove', {pointerId:41,clientX:750,clientY:620});
  h.canvas.emit('pointerup', {pointerId:41});
  assert.equal(h.canvas.captures.size, 0);
  near(h.api.groundState().position.x, 0, 'disabled floor input never moves the camera');
  dragGround(h);
  assert.match(h.canvas.getAttribute('aria-label'), /Drag empty ground/);
  h.api.enableGroundMovement(false);
  assert.equal(h.api.state().drag, null);
  assert.equal(h.canvas.captures.size, 0);
  near(h.api.groundState().velocity.x, 0, 'disabling discards fling velocity');
  assert.doesNotMatch(h.canvas.getAttribute('aria-label'), /Drag empty ground/);
  settleGround(h);
});

check('disabling ground movement preserves inspection framing and returns home after Put back', () => {
  const h = createHarness();
  dragGround(h);
  h.api.select(0);
  const before = h.api.groundState().camera;
  h.api.enableGroundMovement(false);
  h.tick(950);assertReady(h,0);
  assert.ok(h.api.groundState().camera.equals(before), 'turning the experiment off does not shift pickup framing');
  assert.match(h.canvas.getAttribute('aria-label'), /Drag to rotate/);
  h.el('put-back').emit('click');
  h.tick(800);
  settleGround(h);
  assert.equal(h.api.groundState().enabled, false);
});

check('empty-ground drag moves only the camera across the floor, coasts, and settles on demand', () => {
  const h = createHarness();
  const initial = h.api.groundState();
  const cardHomes = cards.map((_, index) => h.api.record(index).model.group.position.clone());
  dragGround(h);
  const held = h.api.groundState();
  assert.equal(held.held, true);
  assert.ok(held.position.x < -.1 && held.position.z < -.1, 'both horizontal and forward/backward input move the view');
  near(held.camera.y, initial.camera.y, 'camera height remains fixed');
  assert.ok(held.quaternion.angleTo(initial.quaternion) < 1e-7, 'ground movement does not rotate the camera');
  assert.equal(h.api.state().selected, null);
  cardHomes.forEach((home, index) => assert.ok(h.api.record(index).model.group.position.equals(home), 'cards stay on the ground'));
  h.canvas.emit('pointerup', {pointerId:41,clientX:690,clientY:606});
  assert.equal(h.canvas.captures.size, 0);
  h.tick(16);
  const coast = h.api.groundState();
  assert.ok(coast.position.x < held.position.x && coast.position.z < held.position.z, 'recent release momentum initially continues the drag');
  settleGround(h);
});

check('card clicks still pick cards, while card drags and out-of-ground presses never pan the shelf', () => {
  const h = createHarness();
  const point = h.api.cardPoint(2);
  h.canvas.emit('pointerdown', {pointerId:7,...point});
  h.canvas.emit('pointerup', {pointerId:7,...point});
  assert.equal(h.api.state().pickup, cards[2].id, 'real mesh raycast retains card selection');
  h.tick(950);assertReady(h,2);
  const untouched = createHarness();
  const card = untouched.api.cardPoint(1);
  untouched.canvas.emit('pointerdown', {pointerId:8,...card});
  untouched.canvas.emit('pointermove', {pointerId:8,clientX:card.clientX+100,clientY:card.clientY+100});
  untouched.canvas.emit('pointerup', {pointerId:8,clientX:card.clientX+100,clientY:card.clientY+100});
  near(untouched.api.groundState().position.x, 0, 'dragging from a card never begins ground input');
  assert.equal(untouched.api.state().selected, null, 'a long card drag is not a click');
  untouched.api.enableGroundMovement(true);
  untouched.canvas.emit('pointerdown', {pointerId:9,clientX:640,clientY:-100000});
  assert.equal(untouched.canvas.captures.size, 0, 'outside the finite ground there is no ground gesture');
});

check('ground gestures match their pointer and cancel cleanly on blur, pointer loss, and resize', () => {
  for (const cancel of ['blur','pointercancel','lostpointercapture','resize']) {
    const h = createHarness();
    dragGround(h);
    const offset = h.api.groundState().position;
    h.canvas.emit('pointermove', {pointerId:42,clientX:850,clientY:650});
    h.canvas.emit('pointerup', {pointerId:42});
    h.canvas.emit('pointerup', {pointerId:41,button:2});
    near(h.api.groundState().position.x, offset.x, 'other pointers and buttons cannot alter the gesture');
    assert.equal(h.api.state().drag, 41);
    if (cancel === 'blur') h.window.emit('blur');
    else if (cancel === 'resize') {h.setSize(900,700);h.api.resize();}
    else h.canvas.emit(cancel, {pointerId:41});
    assert.equal(h.api.state().drag, null);
    assert.equal(h.canvas.captures.size, 0);
    near(h.api.groundState().velocity.x, 0, 'cancelled input has no fling');
    assert.ok(Number.isFinite(h.api.groundState().camera.z));
    settleGround(h);
  }
});

check('re-grabbing holds the displayed ground pose and pickup freezes it until the card returns', () => {
  const h = createHarness();
  dragGround(h);
  h.canvas.emit('pointerup', {pointerId:41});
  h.tick(50);
  const displayed = h.api.groundState().position;
  const grab = h.api.groundPoint();
  h.canvas.emit('pointerdown', {pointerId:42,...grab});
  h.tick(200);
  near(h.api.groundState().position.x, displayed.x, 'a re-grab holds without a camera jump');
  h.canvas.emit('pointermove', {pointerId:42,clientX:grab.clientX+3,clientY:grab.clientY+1});
  near(h.api.groundState().position.x, displayed.x, 'tiny clicks do not move the ground');
  h.api.select(1);
  const inspection = h.api.groundState().camera;
  assert.equal(h.canvas.captures.size, 0, 'selection clears an old ground capture');
  h.tick(950);assertReady(h,1);
  h.tick(1500);
  assert.ok(h.api.groundState().camera.equals(inspection), 'the pickup camera stays steady during inspection');
  h.el('put-back').emit('click');
  h.tick(800);
  settleGround(h);
});

check('reduced motion keeps direct ground dragging but removes coast and finishes an active return', () => {
  const reduced = createHarness({reduced:true});
  dragGround(reduced);
  assert.ok(Math.abs(reduced.api.groundState().position.x) > .1);
  reduced.canvas.emit('pointerup', {pointerId:41});
  reduced.tick(0);
  settleGround(reduced);
  const h = createHarness();
  dragGround(h);
  h.api.select(0);
  h.tick(200);
  h.media.matches = true;
  h.media.emit('change');
  h.tick(0);
  assertReady(h,0);
  assert.ok(h.api.groundState().camera.equals(h.api.groundState().home), 'preference change resets the camera and reframes pickup');
});

check('sharper selected-card rendering waits until pickup clears the shelf', () => {
  const h = createHarness();
  h.api.watchReadingRenderer();
  h.api.select(7);
  h.tick(200);
  assert.equal(h.api.readingRender().inspectionDetail,false,'flight retains room depth and occlusion');
  h.tick(750);
  assert.equal(h.api.readingRender().inspectionDetail,true,'the arrived reading card gets the sharp pass');
  assert.equal(h.api.readingRender().group,h.api.record(7).model.group);
  h.el('put-back').emit('click');
  h.tick(100);
  assert.equal(h.api.readingRender().group,null,'return restores ordinary room rendering');
});

check('Advanced card timing applies to new motion and remains stable through editing and resize', () => {
  const h = createHarness();
  h.api.editMotion('cards',{scale:2,curve:[0,0,1,1]});
  h.api.select(0);
  const original = h.api.tween(0);
  assert.equal(original.duration,1900);
  const middle = original.start.centre.clone().lerp(original.end.centre,.5);
  h.tick(950);
  assert.ok(h.api.centre(0).distanceTo(middle)<1e-6,'a linear curve reaches the geometric midpoint at half the duration');
  h.api.editMotion('cards',{scale:.25,curve:[.42,0,1,1]});
  assert.equal(h.api.tween(0),original,'editing does not replace the guarded pickup');
  h.api.resize();
  assert.equal(h.api.tween(0).duration,950,'resize retains remaining actual time without applying the scale twice');
  near(h.api.tween(0).ease(.25),.25,'resize keeps the captured curve');
  h.tick(950);assertReady(h,0);
  h.views[0].emit('click');
  assert.equal(h.api.tween(0).duration,162.5,'the next view change uses the new duration');
  h.tick(162.5);assert.equal(h.api.record(0).model.opening,0);
});

check('Advanced time timing keeps the icon, clock and scene aligned and respects reduced motion', () => {
  const h=createHarness();h.api.setTime(0);
  h.api.editMotion('time',{scale:2,curve:[0,0,1,1]});h.api.travel(1440);
  h.tick(2500);near(h.api.timeState().minutes,720,'linear time reaches its midpoint at 2.5 seconds');
  assertTimeAligned(h,'custom midpoint');
  h.api.editMotion('time',{scale:.25,curve:[.42,0,1,1]});
  h.tick(2500);near(h.api.timeState().minutes,1440,'the current trip keeps its captured duration');
  h.api.travel(0);h.tick(625);near(h.api.timeState().minutes,0,'the next trip uses the shorter duration');
  const reduced=createHarness({reduced:true});reduced.api.editMotion('time',{scale:3,curve:[.42,0,1,1]});
  reduced.api.travel(1080);near(reduced.api.timeState().minutes,1080,'motion experiments do not override reduced motion');
});

check('pickup survives repeated/secondary clicks, wheel, forced controls and a held pointer', () => {
  const h = createHarness();
  const uuid = h.api.record(0).model.group.uuid;
  h.api.select(0);
  assert.equal(h.api.state().pickup, cards[0].id);
  assert.equal(h.controls.getAttribute('aria-busy'), 'true');
  assert.ok([h.slider,...h.views,h.el('reset-view')].every(control => control.disabled));
  h.tick(250);
  const tween = h.api.tween(0), angle = h.api.record(0).model.opening;
  assert.ok(angle > 22 && angle < 160, 'test operates during pickup');
  for (const props of [{pointerId:1},{pointerId:1,button:2},{pointerId:2,isPrimary:false}]) {
    h.canvas.emit('pointerdown', props);
    h.canvas.emit('pointermove', {...props,clientX:800});
    h.canvas.emit('pointerup', props);
  }
  assert.equal(h.canvas.emit('contextmenu').defaultPrevented, true);
  assert.equal(h.canvas.emit('wheel', {deltaY:-600}).defaultPrevented, true);
  h.slider.emit('pointerdown');
  h.slider.value = '3';
  h.slider.emit('input'); // Force delivery even though the fake input is disabled.
  h.views[2].emit('click');
  h.el('reset-view').emit('click');
  assert.equal(h.api.tween(0), tween, 'ignored interactions retain the original pickup tween');
  near(h.api.record(0).model.opening, angle, 'ignored controls retain displayed opening');
  assert.equal(h.api.state().drag, null);
  assert.equal(h.api.state().sliderHeld, false);
  assert.equal(h.canvas.captures.size, 0);
  h.canvas.emit('pointerdown', {pointerId:9}); // Stay held across arrival.
  h.tick(700);
  assertReady(h, 0);
  const settled = h.api.centre(0), quaternion = h.api.record(0).model.group.quaternion.clone();
  h.canvas.emit('pointermove', {pointerId:9,clientX:850});
  h.canvas.emit('pointerup', {pointerId:9,clientX:850});
  assert.ok(h.api.centre(0).equals(settled), 'held ignored pointer cannot begin dragging at arrival');
  assert.ok(h.api.record(0).model.group.quaternion.equals(quaternion));
  assert.equal(h.api.record(0).model.group.uuid, uuid, 'same scene group arrives');
});

check('fresh drag, wheel, slider and view/reset work after arrival', () => {
  const h = createHarness();
  h.api.select(0);h.tick(950);assertReady(h,0);
  const before = h.api.record(0).model.group.quaternion.clone();
  h.canvas.emit('pointerdown', {pointerId:7});
  h.canvas.emit('pointerup', {pointerId:7,button:2});
  h.canvas.emit('pointerup', {pointerId:8});
  assert.equal(h.api.state().drag, 7, 'right/secondary release cannot end accepted primary drag');
  h.canvas.emit('pointermove', {pointerId:7,clientX:710,clientY:320});
  assert.ok(h.api.record(0).model.group.quaternion.angleTo(before) > .1);
  h.canvas.emit('pointerup', {pointerId:7});
  assert.equal(h.api.state().drag, null);
  h.canvas.emit('wheel', {deltaY:-200});
  assert.ok(h.api.record(0).model.group.scale.x > 1);
  h.slider.value = '101';h.slider.emit('input');
  near(h.api.record(0).model.opening, 101, 'slider is active after arrival');
  h.views[2].emit('click');h.tick(650);
  near(h.api.record(0).model.opening, 0, 'Back preset closes the card');
  h.el('reset-view').emit('click');h.tick(650);assertReady(h,0);
});

function touch(h,type,pointerId,x,y,primary = pointerId === 11) {
  return h.canvas.emit(type,{pointerId,pointerType:'touch',isPrimary:primary,clientX:x,clientY:y});
}
function startPinch(h) {
  touch(h,'pointerdown',11,500,300);
  touch(h,'pointerdown',22,700,300);
  assert.equal(h.api.state().dragMode,'pinch');
  assert.equal(h.canvas.captures.size,2);
}

check('two touch pointers zoom and pan the picked card while preserving its fold and rotation', () => {
  const h=createHarness();h.api.select(0);h.tick(950);assertReady(h,0);
  const model=h.api.record(0).model, quaternion=model.group.quaternion.clone(), centre=h.api.centre(0);
  startPinch(h);
  const move=touch(h,'pointermove',22,800,320);
  assert.equal(move.defaultPrevented,true);
  near(model.group.scale.x,Math.hypot(300,20)/200,'pinch spread controls uniform zoom');
  const changed=h.api.centre(0);
  assert.ok(changed.x>centre.x && changed.y<centre.y,'two-finger midpoint moves the card with the hands');
  assert.ok(model.group.quaternion.angleTo(quaternion)<1e-7,'pinching does not rotate the paper');
  near(model.opening,160,'pinching does not change the opening');
  assert.equal(model.group.scale.y,model.group.scale.x);
  assert.equal(model.group.scale.z,model.group.scale.x);
});

check('pinch and wheel share finite zoom limits and pinch reversal responds immediately at either limit', () => {
  const h=createHarness();h.api.select(0);h.tick(950);
  const model=h.api.record(0).model;
  startPinch(h);
  touch(h,'pointermove',22,1500,300);
  near(model.group.scale.x,2.4,'pinch caps enlargement for readable inspection');
  touch(h,'pointermove',22,1400,300);
  assert.ok(model.group.scale.x<2.4,'reversing at max has no dead zone');
  touch(h,'pointermove',22,500,300);
  near(model.group.scale.x,.6,'coincident fingertips remain finite at minimum zoom');
  touch(h,'pointermove',22,550,300);
  assert.ok(model.group.scale.x>.6,'reversing at min has no dead zone');
  assert.ok([...model.group.position.toArray(),...model.group.scale.toArray()].every(Number.isFinite));
  h.canvas.emit('wheel',{deltaY:-100000});
  near(model.group.scale.x,2.4,'wheel shares the same upper limit');
  assert.equal(h.canvas.captures.size,0,'wheel releases held touch pointers');
  h.canvas.emit('wheel',{deltaY:100000});
  near(model.group.scale.x,.6,'wheel shares the same lower limit');
});

check('two fingers translate together and lifting one resumes rotation from the displayed pose without a jump', () => {
  const h=createHarness();h.api.select(0);h.tick(950);
  const model=h.api.record(0).model, quaternion=model.group.quaternion.clone(), centre=h.api.centre(0);
  startPinch(h);
  touch(h,'pointermove',11,540,320);
  touch(h,'pointermove',22,740,320);
  near(model.group.scale.x,1,'parallel fingertip translation preserves zoom');
  assert.ok(h.api.centre(0).distanceTo(centre)>.01,'parallel translation pans the card');
  assert.ok(model.group.quaternion.angleTo(quaternion)<1e-7);
  touch(h,'pointerup',11,540,320);
  assert.equal(h.api.state().drag,22,'remaining non-primary touch becomes the active turn pointer');
  assert.equal(h.api.state().dragMode,'turn');
  assert.equal(h.canvas.captures.size,1);
  const shownCentre=h.api.centre(0), shownQuaternion=model.group.quaternion.clone();
  touch(h,'pointermove',22,740,320);
  assert.ok(h.api.centre(0).distanceTo(shownCentre)<1e-9);
  assert.ok(model.group.quaternion.angleTo(shownQuaternion)<1e-7,'finger handover is continuous');
  touch(h,'pointermove',22,770,320);
  assert.ok(model.group.quaternion.angleTo(shownQuaternion)>.1,'one remaining finger rotates normally');
  touch(h,'pointerup',22,770,320);
  assert.equal(h.api.state().drag,null);
  assert.equal(h.api.state().touches.length,0);
  assert.equal(h.canvas.captures.size,0);
});

check('third touches and non-primary mouse inputs cannot alter an accepted pinch', () => {
  const h=createHarness();h.api.select(0);h.tick(950);
  const model=h.api.record(0).model;
  startPinch(h);
  const centre=h.api.centre(0), quaternion=model.group.quaternion.clone(), scale=model.group.scale.x;
  assert.equal(touch(h,'pointerdown',33,1100,600).defaultPrevented,true);
  touch(h,'pointermove',33,-1000,-1000);
  touch(h,'pointerup',33,-1000,-1000);
  h.canvas.emit('pointerdown',{pointerId:44,pointerType:'mouse',isPrimary:false});
  h.canvas.emit('pointermove',{pointerId:44,pointerType:'mouse',isPrimary:false,clientX:1200});
  assert.equal(h.api.state().touches.length,2);
  assert.equal(h.canvas.captures.size,2);
  near(model.group.scale.x,scale,'ignored input cannot scale');
  assert.ok(h.api.centre(0).distanceTo(centre)<1e-9);
  assert.ok(model.group.quaternion.angleTo(quaternion)<1e-7);
});

check('pinch cancellation, capture loss, blur, resize and controls release every finger without stale movement', () => {
  for(const action of ['cancel','capture','blur','resize','next','return','reset','view','slider']) {
    const h=createHarness();h.api.select(0);h.tick(950);startPinch(h);
    touch(h,'pointermove',22,760,320);
    if(action === 'cancel') touch(h,'pointercancel',11,500,300);
    else if(action === 'capture') h.canvas.emit('lostpointercapture',{pointerId:22,pointerType:'touch'});
    else if(action === 'blur') h.window.emit('blur');
    else if(action === 'resize') {h.setSize(900,700);h.api.resize();}
    else if(action === 'next') h.el('next-card').emit('click');
    else if(action === 'return') h.el('put-back').emit('click');
    else if(action === 'reset') h.el('reset-view').emit('click');
    else if(action === 'view') h.views[0].emit('click');
    else {h.slider.value='90';h.slider.emit('input');}
    assert.equal(h.api.state().touches.length,0,`${action} clears both touch records`);
    assert.equal(h.api.state().drag,null,`${action} clears drag state`);
    assert.equal(h.canvas.captures.size,0,`${action} releases both captures`);
    const scale=h.api.record(0).model.group.scale.x, centre=h.api.centre(0);
    touch(h,'pointermove',22,1400,800);
    near(h.api.record(0).model.group.scale.x,scale,`${action}: released finger cannot zoom`);
    assert.ok(h.api.centre(0).distanceTo(centre)<1e-9,`${action}: released finger cannot pan`);
  }
});

check('a second collection touch cancels the tap so neither lifted finger can accidentally pick up a card', () => {
  const h=createHarness(), point=h.api.cardPoint(0);
  touch(h,'pointerdown',11,point.clientX,point.clientY);
  touch(h,'pointerdown',22,point.clientX+30,point.clientY);
  assert.equal(h.api.state().touchSuppressed,true);
  assert.equal(h.api.state().drag,null);
  touch(h,'pointerup',11,point.clientX,point.clientY);
  touch(h,'pointerup',22,point.clientX+30,point.clientY);
  assert.equal(h.api.state().selected,null);
  assert.equal(h.api.state().touchSuppressed,false);
  assert.equal(h.canvas.captures.size,0);
  touch(h,'pointerdown',11,point.clientX,point.clientY);
  touch(h,'pointerup',11,point.clientX,point.clientY);
  h.tick(950);assertReady(h,0);
});

check('a second touch cancels experimental ground input without creating a pinch, fling or card tap', () => {
  const h=createHarness();h.api.enableGroundMovement(true);
  const point=h.api.groundPoint();
  touch(h,'pointerdown',11,point.clientX,point.clientY);
  h.tick(16);
  touch(h,'pointermove',11,point.clientX+50,point.clientY+16);
  assert.equal(h.api.groundState().held,true);
  assert.ok(Math.abs(h.api.groundState().position.x)>.1);
  touch(h,'pointerdown',22,point.clientX+90,point.clientY+16);
  assert.equal(h.api.state().drag,null);
  assert.equal(h.api.state().touchSuppressed,true);
  assert.equal(h.api.groundState().held,false);
  near(h.api.groundState().velocity.x,0,'second touch discards release momentum');
  const displayed=h.api.groundState().position;
  touch(h,'pointermove',22,1200,100);
  near(h.api.groundState().position.x,displayed.x,'suppressed pair cannot pan the floor');
  touch(h,'pointerup',22,1200,100);
  touch(h,'pointerup',11,point.clientX+50,point.clientY+16);
  assert.equal(h.api.state().selected,null);
  assert.equal(h.canvas.captures.size,0);
  assert.equal(h.api.state().touchSuppressed,false);
  settleGround(h);
});

check('reduced motion preserves direct pinch zoom and two-finger pan', () => {
  const h=createHarness({reduced:true});h.api.select(0);assertReady(h,0);
  const centre=h.api.centre(0);
  startPinch(h);
  touch(h,'pointermove',22,800,320);
  assert.ok(h.api.record(0).model.group.scale.x>1,'direct zoom still follows fingertips');
  assert.ok(h.api.centre(0).distanceTo(centre)>.01,'direct two-finger pan remains available');
  touch(h,'pointerup',22,800,320);
  touch(h,'pointerup',11,500,300);
  assert.equal(h.api.state().touches.length,0);
  assert.equal(h.canvas.captures.size,0);
});

check('touches held through pickup cannot cancel the flight or become a pinch on arrival', () => {
  const h=createHarness();h.api.select(0);
  assert.equal(touch(h,'pointerdown',11,500,300).defaultPrevented,true);
  assert.equal(touch(h,'pointerdown',22,700,300).defaultPrevented,true);
  assert.equal(h.api.state().touches.length,0);
  assert.equal(h.canvas.captures.size,0);
  h.tick(950);assertReady(h,0);
  const model=h.api.record(0).model, quaternion=model.group.quaternion.clone();
  touch(h,'pointermove',11,300,100);touch(h,'pointermove',22,900,500);
  touch(h,'pointerup',11,300,100);touch(h,'pointerup',22,900,500);
  near(model.group.scale.x,1,'held pickup touches never become a zoom');
  assert.ok(model.group.quaternion.angleTo(quaternion)<1e-7);
  startPinch(h);
  touch(h,'pointermove',22,800,300);
  assert.ok(model.group.scale.x>1,'fresh touch pair works after arrival');
});

check('Put back and Escape can abort pickup without leaving a lock', () => {
  for (const abort of ['button','escape']) {
    const h = createHarness();
    h.api.select(0);h.tick(200);
    if (abort === 'button') h.el('put-back').emit('click');
    else h.document.emit('keydown', {key:'Escape',target:h.el('put-back')});
    assert.equal(h.api.state().selected, null);
    assert.equal(h.api.state().pickup, null);
    assert.equal(h.controls.getAttribute('aria-busy'), 'false');
    assert.equal(h.controls.hidden, true);
    h.tick(800);
    near(h.api.record(0).model.opening, h.api.home(0).opening, 'aborted card returns to shelf angle');
    assert.ok(h.api.centre(0).distanceTo(h.api.home(0).centre) < 1e-8);
    h.api.select(1);h.tick(950);assertReady(h,1);
  }
});

check('Next/Previous during pickup transfer the guard to the newest selection', () => {
  for (const direction of ['next-card','previous-card']) {
    const h = createHarness();
    h.api.select(0);h.tick(100);
    const staleCompletion = h.api.tween(0).complete;
    h.el(direction).emit('click');
    const index = direction === 'next-card' ? 1 : cards.length - 1;
    assert.equal(h.api.state().pickup, cards[index].id);
    staleCompletion(); // A stale callback must never unlock a newer pickup.
    assert.equal(h.api.state().pickup, cards[index].id);
    h.tick(950);assertReady(h,index);
    assert.ok(h.api.centre(0).distanceTo(h.api.home(0).centre) < 1e-8);
  }
});

check('return and reselect of the same object reject its old completion token', () => {
  const h = createHarness();
  h.api.select(0);h.tick(100);
  const staleCompletion = h.api.tween(0).complete;
  h.el('put-back').emit('click');
  h.api.select(0);
  staleCompletion();
  assert.equal(h.api.state().pickup, cards[0].id);
  assert.equal(h.slider.disabled, true);
  h.tick(950);assertReady(h,0);
});

check('resize retains pickup completion and unlocks at the reframed target', () => {
  const h = createHarness();
  h.api.select(0);h.tick(200);
  const oldTween = h.api.tween(0);
  h.setSize(900,700);h.api.resize();
  assert.notEqual(h.api.tween(0), oldTween);
  assert.equal(h.api.tween(0).complete, oldTween.complete);
  assert.equal(h.api.state().pickup, cards[0].id);
  assert.equal(h.slider.disabled, true);
  h.tick(1000);assertReady(h,0);
});

check('initial reduced motion completes pickup and unlocks synchronously', () => {
  const h = createHarness({reduced:true});
  h.api.select(0);
  assertReady(h,0);
  assert.equal(h.api.state().tweenCount, 0);
  h.el('next-card').emit('click');
  assertReady(h,1);
  assert.equal(h.api.state().tweenCount, 0);
});

check('reduced-motion change completes an in-flight pickup synchronously', () => {
  const h = createHarness();
  h.api.select(0);h.tick(200);
  assert.equal(h.api.state().pickup, cards[0].id);
  h.media.matches = true;
  h.media.emit('change');
  assertReady(h,0);
  assert.equal(h.api.state().tweenCount, 0);
});

check('inspection light receives the displayed card centre after pickup and pan, then returns to collection', () => {
  for (const reduced of [false,true]) {
    const h = createHarness({reduced});
    assert.equal(h.api.lightView().focus, null, 'collection requests the shelf lamp position');
    h.api.select(0);
    h.tick(reduced ? 0 : 475);
    const inFlight = h.api.lightView();
    assert.equal(inFlight.camera.isPerspectiveCamera, true, 'lighting receives the actual view camera');
    assert.equal(inFlight.immediate, reduced, 'reduced-motion preference reaches lighting');
    assert.ok(inFlight.focus.distanceTo(h.api.centre(0)) < 1e-9, 'lamp follows the displayed position after the card tween advances');
    if (!reduced) h.tick(475);
    const beforePan = h.api.centre(0).clone();
    h.canvas.emit('pointerdown', {pointerId:7,shiftKey:true});
    h.canvas.emit('pointermove', {pointerId:7,clientX:710,clientY:270});
    h.canvas.emit('pointerup', {pointerId:7});
    h.tick(0);
    assert.ok(h.api.centre(0).distanceTo(beforePan) > .01, 'test actually pans the card');
    assert.ok(h.api.lightView().focus.distanceTo(h.api.centre(0)) < 1e-9, 'lamp receives the transformed centre after pan');
    h.el('put-back').emit('click');
    h.tick(0);
    assert.equal(h.api.lightView().focus, null, 'return requests the collection lamp destination');
  }
});

check('curved collection rows face inward, remain separated and stay framed at desktop and narrow widths', () => {
  const h = createHarness();
  const slots = h.api.slots();
  for (const row of [...new Set(slots.map(slot => slot.row))]) {
    const rowSlots = slots.filter(slot => slot.row === row);
    const middleDepth = Math.min(...rowSlots.map(slot => slot.z));
    assert.ok(rowSlots[0].z > middleDepth + .4 && rowSlots.at(-1).z > middleDepth + .4, 'both ends advance gently towards the viewer');
    assert.ok(rowSlots[0].turn > .1 && rowSlots.at(-1).turn < -.1, 'outside cards turn towards the centre');
    assert.ok(rowSlots.every(slot => Math.abs(slot.turn) < .4), 'the arc keeps the printed faces readable');
    for (let index = 1; index < rowSlots.length; index++) assert.ok(rowSlots[index].x > rowSlots[index-1].x, 'card ordering stays left to right');
  }
  assert.ok(Math.min(...slots.filter(slot=>slot.row===1).map(slot=>slot.z)) - Math.max(...slots.filter(slot=>slot.row===0).map(slot=>slot.z)) > 3, 'the two arcs remain distinct');
  for (const [width,height] of [[1280,632],[713,790],[375,736]]) {
    h.setSize(width,height);h.api.resize();
    const upper = 1 - 2 * Math.min(width <= 700 ? 235 : 225,height*.35)/height;
    const lower = -1 + 2 * Math.min(width <= 900 ? 124 : 88,height*.23)/height;
    for (const point of h.api.collectionProjection()) {
      assert.ok(Math.abs(point.x) <= .890001, `${width}px: collection fits horizontally`);
      assert.ok(point.y <= upper+1e-6 && point.y >= lower-1e-6, `${width}px: collection clears arc and card list`);
    }
  }
});

check('returning a card restores its original position and turn on the arc', () => {
  const h = createHarness();
  for (const index of [0,6,7,cards.length-1]) {
    const record = h.api.record(index), home = record.home;
    h.api.select(index);h.tick(950);assertReady(h,index);
    h.el('put-back').emit('click');h.tick(800);
    assert.ok(record.model.group.position.distanceTo(home.position) < 1e-8, 'return reaches its curved-row position');
    assert.ok(record.model.group.quaternion.angleTo(home.quaternion) < 1e-7, 'return reaches its inward-facing home angle');
    near(record.model.opening,home.opening,'return restores the shelf opening');
  }
});

check('postcards have only Front and Back, and returning to a folded card restores opening controls', () => {
  const index = cards.findIndex(card=>card.type === 'postcard');
  if (index < 0) return;
  const h=createHarness();
  h.api.select(index);h.tick(950);assertReady(h,index);
  assert.equal(h.controls.dataset.cardType,'postcard');
  assert.equal(h.views[1].hidden,true);
  assert.equal(h.slider.disabled,true);
  h.views[1].emit('click');
  h.slider.value='130';h.slider.emit('input');
  h.slider.emit('pointerdown');
  near(h.api.record(index).model.opening,0,'forced hidden controls cannot fold a postcard');
  assert.equal(h.api.state().sliderHeld,false);
  assert.equal(h.api.tween(index),undefined);
  h.views[2].emit('click');h.tick(650);
  assert.ok(h.views[2].classList.contains('active'),'Back rotates the single sheet');
  h.el('reset-view').emit('click');h.tick(650);assertReady(h,index);
  h.el('next-card').emit('click');h.tick(950);assertReady(h,index+1);
  assert.equal(h.controls.dataset.cardType,'folded');
  assert.equal(h.views[1].hidden,false);
  assert.equal(h.slider.disabled,false);
});

check('top-folded cards reserve vertical room while preserving their physical closed dimensions', () => {
  const index=cards.findIndex(card=>card.foldAxis === 'horizontal');
  if(index < 0)return;
  const h=createHarness();
  for(const [width,height] of [[1280,632],[713,790],[375,736]]) {
    h.setSize(width,height);h.api.resize();
    h.api.select(index);h.tick(950);assertReady(h,index);
    for(const point of h.api.inspectionProjection(index)) {
      assert.ok(Math.abs(point.x)<.81,'top-fold fits horizontal inspection area');
      const y=(1-point.y)*height/2;
      assert.ok(y>=Math.min(width<=700?225:170,height*(width<=700?.39:.27))-5,'top-fold clears the top controls');
      assert.ok(y<=height-240,'top-fold clears the lower controls');
    }
  }
});

check('pickup measures the restored folding panel after leaving a postcard through navigation or the collection', () => {
  const postcard=cards.findIndex(card=>card.type === 'postcard');
  const horizontal=cards.findIndex(card=>card.foldAxis === 'horizontal');
  if(postcard < 0 || horizontal < 0)return;
  for(const [width,height] of [[1280,632],[713,790],[375,736]]) {
    const h=createHarness();h.setSize(width,height);h.api.resize();
    for(const path of ['next','collection']) {
      h.api.select(postcard);h.tick(950);assertReady(h,postcard);
      assert.equal(h.controls.dataset.cardType,'postcard');
      let destination;
      if(path === 'next') {
        destination=postcard+1;h.el('next-card').emit('click');
      } else {
        h.el('put-back').emit('click');h.tick(800);
        destination=horizontal;h.api.select(destination);
      }
      assert.equal(h.controls.dataset.cardType,'folded','the new panel is applied before pickup frames begin');
      h.tick(950);assertReady(h,destination);
      for(const point of h.api.inspectionProjection(destination)) {
        assert.ok((1-point.y)*height/2 <= height-240,'arriving card clears the full folding controls');
      }
    }
  }
});

function assertTimeAligned(h, message) {
  const state = h.api.timeState();
  near(state.control.minutes, state.minutes, `${message}: handle follows displayed minutes`);
  assert.equal(state.control.timeLabel, state.light.solar.timeLabel, `${message}: readout and rendered solar time match`);
  assert.equal(state.light.immediate, true, `${message}: lighting follows the current animation frame immediately`);
  assert.equal(state.light.enabled, state.indoor, `${message}: independent indoor preference is preserved`);
}

check('time shortcut keeps the displayed start and reaches its exact target after 2500 ms', () => {
  const h = createHarness();
  h.api.setTime(360);
  const referenceDate = h.api.timeState().date.getTime();
  h.api.travel(1080);
  near(h.api.timeState().minutes, 360, 'click does not teleport to the target');
  assert.equal(h.api.timeState().moving, true);
  assert.equal(h.api.timeState().holdingDetails, true);
  h.tick(0);
  near(h.api.timeState().minutes, 360, 'first frame preserves displayed time');
  h.tick(1250);
  const middle = h.api.timeState().minutes;
  assert.ok(middle > 360 && middle < 1080, 'time travels through intermediate values');
  assertTimeAligned(h, 'middle frame');
  h.tick(1249);
  assert.equal(h.api.timeState().moving, true, 'animation remains active before its duration');
  h.tick(1);
  near(h.api.timeState().minutes, 1080, 'preset reaches exactly 18:00');
  assert.equal(h.api.timeState().moving, false);
  assert.equal(h.api.timeState().holdingDetails, false, 'details resume their ordinary fade after arrival');
  assert.equal(h.api.timeState().source, 'manual');
  assert.equal(h.api.timeState().date.getTime(), referenceDate, 'manual preview keeps its reference date');
  assertTimeAligned(h, 'settled frame');
  h.tick(2000);
  near(h.api.timeState().minutes, 1080, 'idle frames cannot move the settled preset');
});

check('a new shortcut reverses from the displayed time without a jump or stale arrival', () => {
  const h = createHarness();
  h.api.setTime(360);
  h.api.travel(1080);
  h.tick(900);
  const displayed = h.api.timeState().minutes;
  assert.ok(displayed > 360 && displayed < 1080);
  h.api.travel(360);
  near(h.api.timeState().minutes, displayed, 'retargeting preserves displayed time');
  h.tick(1250);
  assert.ok(h.api.timeState().minutes < displayed && h.api.timeState().minutes > 360, 'reversal travels back through intermediate times');
  assertTimeAligned(h, 'reversed frame');
  h.tick(1250);
  near(h.api.timeState().minutes, 360, 'newest target wins');
  h.tick(3000);
  near(h.api.timeState().minutes, 360, 'old transition cannot later overwrite the new target');
});

check('direct time input interrupts animated travel and preserves minute precision', () => {
  const h = createHarness();
  h.api.setTime(360);
  h.api.travel(1080);
  h.tick(500);
  h.api.setTime(721);
  near(h.api.timeState().minutes, 721, 'direct input immediately selects 12:01');
  assert.equal(h.api.timeState().moving, false);
  assert.equal(h.api.timeState().holdingDetails, false);
  assertTimeAligned(h, 'direct input');
  h.tick(4000);
  near(h.api.timeState().minutes, 721, 'cancelled travel cannot overwrite dragging or keyboard input');
});

check('daily sunrise/sunset shortcuts reach their displayed event date, including after 24:00', () => {
  for (const start of [720, 1440]) for (const event of ['sunrise', 'sunset']) {
    const h = createHarness();
    h.api.setTime(start);
    const displayed = h.api.timeState().light.solar;
    const target = displayed[`${event}Minutes`];
    h.api.travel(target, displayed.date);
    h.tick(1250);
    assert.equal(h.api.timeState().moving, true, 'event selection uses the existing animated travel');
    assert.equal(h.api.timeState().light.solar.localDate, displayed.localDate, 'intermediate time uses the displayed civil day');
    h.tick(1250);
    const settled = h.api.timeState();
    near(settled.minutes, target, 'event arrives at the calculated fractional minute');
    assert.equal(settled.control.timeLabel, displayed[`${event}Label`]);
    assert.equal(settled.light.solar.localDate, displayed.localDate, '24:00 never selects the previous day’s event');
    assert.equal(settled.moving, false);
  }
});

check('clicking Live refreshes the clock without entering a manual preview', () => {
  const h = createHarness();
  h.api.setIndoor(false);
  for (let click = 0; click < 3; click++) {
    h.api.travel();
    for (const elapsed of [0, 1250, 3000]) {
      h.tick(elapsed);
      const state = h.api.timeState();
      assert.equal(state.minutes, null, 'Live never creates a manual preview');
      assert.equal(state.source, 'live');
      assert.equal(state.moving, false, 'Live never starts a return animation');
      assert.equal(state.control.isLive, true);
      assert.equal(state.indoor, false, 'the indoor-light preference is retained');
    }
  }
});

check('Return to now travels through time then resumes the real local clock', () => {
  const h = createHarness();
  h.api.setTime(360);
  h.api.travel();
  near(h.api.timeState().minutes, 360, 'return-to-now preserves displayed start');
  h.tick(1250);
  const middle = h.api.timeState();
  assert.ok(middle.minutes > 360 && middle.minutes < 1201, 'return-to-now has a visible intermediate time');
  assert.equal(middle.source, 'manual', 'intermediate preview is not yet labelled live');
  assertTimeAligned(h, 'return-to-now frame');
  h.tick(1250);
  const live = h.api.timeState();
  const expected = getSolarState(h.currentDate());
  assert.equal(live.minutes, null, 'manual preview clears on live arrival');
  assert.equal(live.moving, false);
  assert.equal(live.source, 'live');
  assert.equal(live.control.isLive, true);
  assert.equal(live.control.timeLabel, expected.timeLabel);
  assert.ok(Math.abs(live.control.minutes - expected.minutes) < 1, 'arrival matches the current browser clock within its minute readout');
});

check('time travel preserves indoor-light preference and permits changing it while moving', () => {
  const h = createHarness();
  h.api.setTime(360);
  h.api.setIndoor(false);
  h.api.travel(1080);
  h.tick(700);
  assertTimeAligned(h, 'lamp-off travel');
  assert.equal(h.api.timeState().indoor, false);
  const displayed = h.api.timeState().minutes;
  h.api.setIndoor(true);
  near(h.api.timeState().minutes, displayed, 'lamp toggle does not move the time');
  assert.equal(h.api.timeState().moving, true, 'lamp toggle leaves time travel active');
  h.tick(1800);
  near(h.api.timeState().minutes, 1080, 'travel still reaches its target');
  assert.equal(h.api.timeState().indoor, true, 'newest indoor preference remains');
  assertTimeAligned(h, 'lamp-on arrival');
});

check('reduced motion applies shortcut and live destinations synchronously', () => {
  const h = createHarness({reduced:true});
  h.api.setTime(360);
  h.api.travel(1080);
  near(h.api.timeState().minutes, 1080, 'reduced motion reaches preset immediately');
  assert.equal(h.api.timeState().moving, false);
  assert.equal(h.api.timeState().holdingDetails, false);
  assertTimeAligned(h, 'reduced preset');
  h.api.travel();
  assert.equal(h.api.timeState().minutes, null);
  assert.equal(h.api.timeState().source, 'live');
  assert.equal(h.api.timeState().moving, false);
});

check('enabling reduced motion during time travel finishes the newest destination immediately', () => {
  const h = createHarness();
  h.api.setTime(360);
  h.api.travel(1080);
  h.tick(500);
  assert.equal(h.api.timeState().moving, true);
  h.media.matches = true;
  h.media.emit('change');
  near(h.api.timeState().minutes, 1080, 'preference change finishes the destination');
  assert.equal(h.api.timeState().moving, false);
  assert.equal(h.api.timeState().holdingDetails, false);
  h.tick(3000);
  near(h.api.timeState().minutes, 1080, 'old travel cannot restart after reduced-motion completion');
});

// The interaction harness uses simple picking solids. Check the real opened
// paper separately, including the full postcard and top-fold geometry.
const originalTextureLoad = THREE.TextureLoader.prototype.loadAsync;
try {
  THREE.TextureLoader.prototype.loadAsync = async () => new THREE.Texture();
  const {createCard} = await import('../card-mesh.js');
  const built = await Promise.all(cards.map(card => createCard(card)));
  const slots = createHarness().api.slots();
  const boxes = built.map((model,index) => {
    const slot = slots[index];
    model.setOpening(22 + index % 3 * 3);
    model.group.position.set(slot.x,0,slot.z);
    model.group.rotation.y = slot.turn;
    if (model.foldAxis === 'horizontal') model.group.position.y = Math.max(0,(model.boundsForOpening(model.opening).height-model.height)/2);
    model.group.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(model.group);
  });
  check('actual opened paper solids have clear space throughout both arcs', () => {
    for (let first = 0; first < boxes.length; first++) for (let second = first + 1; second < boxes.length; second++) {
      const a = boxes[first], b = boxes[second];
      const gap = new THREE.Vector3(...['x','y','z'].map(axis => Math.max(0,a.min[axis]-b.max[axis],b.min[axis]-a.max[axis]))).length();
      assert.ok(gap > .12, `${cards[first].id} and ${cards[second].id} keep air between their complete paper bounds (${gap})`);
    }
  });
} finally {
  THREE.TextureLoader.prototype.loadAsync = originalTextureLoad;
}

console.log(`Scene interaction checks passed (${passed} cases, actual production handlers).`);
