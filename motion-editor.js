import { MOTION_CHANNELS, ORIGINAL_CURVES, originalEase } from './motion.js';

const PRESETS = {smooth:[.42,0,.58,1],linear:[0,0,1,1],accelerate:[.42,0,1,1],decelerate:[0,0,.58,1]};
const X=32,Y=20,W=236,H=160;
const clamp = value => Math.max(0,Math.min(1,value));

export function createMotionEditor({element, motion, settingsStore, reducedMotion = {matches:false}}) {
  const $ = selector => element.querySelector(selector);
  const target = $('#motion-target'), duration = $('#motion-duration'), value = $('#motion-duration-value');
  const graph = $('#motion-graph'), path = $('#motion-path'), originalPath = $('#motion-original-path');
  const lines = [...element.querySelectorAll('[data-motion-line]')];
  const handles = [...element.querySelectorAll('[data-motion-handle]')];
  const presets = [...element.querySelectorAll('[data-motion-preset]')];
  const play = $('#motion-preview'), dot = $('#motion-dot'), paper = $('#motion-preview-paper');
  const state = $('#motion-state'), description = $('#motion-description');
  const lifetime = new AbortController();
  let key = Object.hasOwn(MOTION_CHANNELS,target.value) ? target.value : 'cards';
  let pointer = null, frame = 0, active = false, began = null, preview;
  const listen = (node,type,handler) => node.addEventListener(type,handler,{signal:lifetime.signal});

  function applyCss() {
    const style = document.body.style;
    for (const [name,ms] of Object.entries({fast:120,fade:650,feedback:180,color:300,tick:150,status:250,panel:200,'bulb-in':380,'bulb-out':240})) {
      style.setProperty(`--motion-ui-${name}`,`${motion.duration('ui',ms)}ms`);
    }
    for (const channel of ['ui','layout']) {
      const curve = motion.get(channel).curve;
      if (curve) style.setProperty(`--motion-${channel}-ease`,`cubic-bezier(${curve.join(',')})`);
      else style.removeProperty(`--motion-${channel}-ease`);
    }
  }
  function pose(t = 0,ease = motion.transition(key).ease) {
    const progress = ease(t);
    dot.setAttribute('cx',String(X+W*t)); dot.setAttribute('cy',String(Y+H*(1-progress)));
    paper.setAttribute('transform',`translate(${10+progress*240} 6)`);
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; began = null;
    play.textContent = 'Play preview'; play.setAttribute('aria-pressed','false');
    pose();
  }
  function cancelPointer() {
    const held = pointer;
    pointer = null;
    if (held && graph.hasPointerCapture(held.id)) graph.releasePointerCapture(held.id);
  }
  function draw() {
    const config = MOTION_CHANNELS[key], current = motion.get(key);
    const transition = motion.transition(key);
    const points = current.curve ?? ORIGINAL_CURVES[key] ?? [0,0,1,1];
    const d = ease => Array.from({length:81},(_,i) => `${i ? 'L' : 'M'}${(X+W*i/80).toFixed(2)},${(Y+H*(1-ease(i/80))).toFixed(2)}`).join(' ');
    path.setAttribute('d',d(transition.ease));
    // The ghost always shows the original curve, even after customising.
    const original = t => originalEase(key,t);
    originalPath.setAttribute('d',d(original));
    originalPath.style.opacity = current.curve ? '.3' : '0';
    handles.forEach((handle,index) => {
      const x = X+W*points[index*2], y = Y+H*(1-points[index*2+1]);
      handle.setAttribute('transform',`translate(${x} ${y})`);
      handle.setAttribute('aria-valuenow',String(Math.round(points[index*2]*100)));
      handle.setAttribute('aria-valuetext',`${Math.round(points[index*2]*100)}% time, ${Math.round(points[index*2+1]*100)}% movement`);
      handle.setAttribute('aria-disabled',String(!config.curve));
      handle.setAttribute('tabindex',config.curve ? '0' : '-1');
      handle.style.display = config.curve ? '' : 'none';
      lines[index].setAttribute('x1',String(index ? X+W : X));
      lines[index].setAttribute('y1',String(index ? Y : Y+H));
      lines[index].setAttribute('x2',String(x)); lines[index].setAttribute('y2',String(y));
      lines[index].style.display = config.curve ? '' : 'none';
    });
    duration.value = String(Math.round(current.scale*100));
    value.textContent = `${Math.round(current.scale*100)}%${config.curve ? ` · ${(transition.duration/1000).toFixed(2)} s` : ''}`;
    duration.setAttribute('aria-valuetext',`${Math.round(current.scale*100)} percent of original duration`);
    description.textContent = config.description;
    state.textContent = !config.curve ? 'Natural physics · adjustable duration'
      : current.curve ? `Custom · cubic-bezier(${current.curve.map(n=>Number(n.toFixed(2))).join(', ')})` : 'Original curve';
    presets.forEach(button => {
      const name = button.dataset.motionPreset;
      const pressed = name === 'original' ? !current.curve : JSON.stringify(current.curve) === JSON.stringify(PRESETS[name]);
      button.setAttribute('aria-pressed',String(pressed)); button.disabled = !config.curve;
    });
    $('#motion-handle-help').textContent = config.curve
      ? 'Drag either point. Arrow keys adjust a focused point; Shift makes a larger step. The dashed curve is the original.'
      : 'Physics keeps its own acceleration and collision response. Adjust duration to change its pace.';
    play.disabled = reducedMotion.matches;
    $('#motion-reduced-note').hidden = !reducedMotion.matches;
    pose();
  }
  function refresh() { stop(); applyCss(); draw(); }
  function editPoint(index,x,y) {
    const points = motion.get(key).curve ?? [...ORIGINAL_CURVES[key]];
    points[index*2] = Math.round(clamp(x)*1000)/1000;
    points[index*2+1] = Math.round(clamp(y)*1000)/1000;
    motion.update(key,{curve:points});
  }
  function move(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const bounds = graph.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    event.preventDefault();
    editPoint(pointer.index,((event.clientX-bounds.left)*300/bounds.width-X)/W,
      1-((event.clientY-bounds.top)*218/bounds.height-Y)/H);
  }
  listen(graph,'pointerdown',event => {
    if (event.button !== 0 || pointer || !MOTION_CHANNELS[key].curve) return;
    const handle = event.target.closest('[data-motion-handle]');
    if (!handle) return;
    event.preventDefault(); stop();
    pointer = {id:event.pointerId,index:Number(handle.dataset.motionHandle)};
    handle.focus(); graph.setPointerCapture(event.pointerId);
  });
  listen(graph,'pointermove',move);
  listen(graph,'pointerup',event => { if (pointer?.id === event.pointerId) { move(event); cancelPointer(); } });
  for (const type of ['pointercancel','lostpointercapture']) listen(graph,type,event => {
    if (pointer?.id === event.pointerId) cancelPointer();
  });
  handles.forEach((handle,index) => listen(handle,'keydown',event => {
    if (!MOTION_CHANNELS[key].curve || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const points = motion.get(key).curve ?? [...ORIGINAL_CURVES[key]], step = event.shiftKey ? .1 : .01;
    editPoint(index,points[index*2]+(event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      points[index*2+1]+(event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0));
  }));
  listen(target,'change',() => {
    if (!Object.hasOwn(MOTION_CHANNELS,target.value)) return;
    cancelPointer(); key = target.value; refresh();
  });
  listen(duration,'input',() => motion.update(key,{scale:Number(duration.value)/100}));
  presets.forEach(button => listen(button,'click',() => motion.update(key,{curve:PRESETS[button.dataset.motionPreset] ?? null})));
  listen($('#motion-reset'),'click',() => motion.reset(key));
  listen($('#motion-reset-all'),'click',() => motion.reset());
  function tick(now) {
    frame = 0;
    if (!active || document.hidden || reducedMotion.matches) { stop(); return; }
    if (began === null) began = now;
    const t = Math.min(1,(now-began)/preview.duration);
    pose(t,preview.ease);
    if (t < 1) frame = requestAnimationFrame(tick);
    else { play.textContent='Replay preview'; play.setAttribute('aria-pressed','false'); began=null; }
  }
  listen(play,'click',() => {
    if (frame) { stop(); return; }
    if (!active || reducedMotion.matches) return;
    preview = motion.transition(key); began = null;
    play.textContent='Stop preview'; play.setAttribute('aria-pressed','true');
    frame = requestAnimationFrame(tick);
  });
  listen(document,'visibilitychange',() => { if (document.hidden) { stop(); cancelPointer(); } });
  listen(window,'blur',() => { stop(); cancelPointer(); });
  if (reducedMotion.addEventListener) listen(reducedMotion,'change',refresh);
  const unsubscribe = settingsStore.subscribe(refresh);
  refresh();
  return {
    setActive(value) { active=Boolean(value); if (!active) { stop(); cancelPointer(); } },
    destroy() { stop(); cancelPointer(); unsubscribe(); lifetime.abort(); },
  };
}
