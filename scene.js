import * as THREE from './vendor/three/three.module.js';
import { cards } from './compatibility/cards.js';
import { createCard } from './card-mesh.js';
import { createLighting } from './lighting.js';
import { createLightControl } from './light-control.js';
import { getSolarState, dateAtMinutes } from './solar-time.js';
import { createRenderDiagnostics } from './render-diagnostics.js';
import { createSettingsPanel } from './settings-panel.js';
import { createOfflineSupport } from './offline.js';
import { createLeaves } from './leaves.js';
import { createGroundMotion } from './ground-motion.js';
import { createSettingsStore } from './preferences.js';
import { createReadingRenderer } from './reading-renderer.js';
import { createMotionController } from './motion.js';
import { createMotionEditor } from './motion-editor.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#scene-canvas');
const shell = $('#scene-shell');
const controls = $('#inspection-controls');
const list = $('#card-list');
const slider = $('#opening');
const interfaceToggle = $('#interface-toggle');
const cardActionToggle = $('#card-action-toggle');
const edgeNavigation = $('#edge-card-navigation');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const settingsStore = createSettingsStore();
const motion = createMotionController(settingsStore);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, .05, 160);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const models = [];
const pickable = [];
const tweens = new Map();
const up = new THREE.Vector3();
const right = new THREE.Vector3();
const forward = new THREE.Vector3();
const homeCameraPosition = new THREE.Vector3();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), .006);
const groundMotion = createGroundMotion({timeScale:() => 1/motion.get('ground').scale});
let renderer;
let readingRenderer;
let renderDiagnostics;
let settingsPanel;
let motionEditor;
let offlineSupport;
let leaves;
let selected = null;
let pickup = null;
let frame = 0;
let drag = null;
const touchPointers = new Map();
let touchSequenceSuppressed = false;
const MIN_CARD_ZOOM = .6;
const MAX_CARD_ZOOM = 2.4;
let groundMovementEnabled = settingsStore.state.groundMovement;
let hintTimer;
let sliderHeld = false;
let interfaceHidden = false;
let expandedCardView = null;
let ready = false;
let failed = false;
let lighting;
let lightControl;
let manualTime = null;
let timeTravel = null;
const TIME_TRAVEL_DURATION = 2500;
let indoorEnabled = settingsStore.state.indoorEnabled;
const themeInk = new THREE.Color();
const themeMuted = new THREE.Color();
const themeAccent = new THREE.Color();
const themeContrast = new THREE.Color();

function updateLightingTheme() {
  if (!scene.background) return;
  const wall = scene.background;
  const luminance = .2126 * wall.r + .7152 * wall.g + .0722 * wall.b;
  const night = luminance < .18;
  const contrast = night ? THREE.MathUtils.smoothstep(luminance, .02, .18) : 1 - THREE.MathUtils.smoothstep(luminance, .18, .72);
  // Match the light actually rendered, including during fades. Near middle
  // brightness, strengthen the foreground instead of crossfading it to grey.
  themeContrast.set(night ? '#ffffff' : '#080d10');
  themeInk.set(night ? '#e7e9e4' : '#343a32').lerp(themeContrast, contrast);
  themeMuted.set(night ? '#a8b4c3' : '#777c70').lerp(themeInk, contrast);
  themeAccent.set(night ? '#d4dcc3' : '#59664c').lerp(themeInk, contrast);
  document.body.dataset.timeMode = night ? 'night' : 'day';
  for (const [key,value] of [['wall',wall],['ink',themeInk],['muted',themeMuted],['olive',themeAccent]]) {
    document.body.style.setProperty(`--${key}`, `#${value.getHexString()}`);
  }
  document.querySelector('meta[name="theme-color"]').content = `#${wall.getHexString()}`;
}

function refreshLighting(immediate = false) {
  const now = new Date();
  const solar = getSolarState(manualTime ? dateAtMinutes(manualTime.minutes, manualTime.date) : now);
  const isLive = !manualTime;
  shell.dataset.timeSource = isLive ? 'live' : 'manual';
  shell.dataset.lightTime = solar.timeLabel;
  shell.dataset.lightDate = solar.localDate;
  shell.dataset.sunrise = solar.sunriseLabel;
  shell.dataset.sunset = solar.sunsetLabel;
  shell.dataset.indoor = indoorEnabled ? 'on' : 'off';
  shell.dataset.solarAltitude = (solar.altitude * 180 / Math.PI).toFixed(2);
  shell.dataset.lightPhase = solar.twilight;
  lightControl.update({...solar,minutes:manualTime?.minutes ?? solar.minutes,isLive,indoorEnabled});
  lighting.update(solar, indoorEnabled, immediate || reducedMotion.matches);
  invalidate();
}

function setManualTime(minutes) {
  timeTravel = null;
  lightControl.setTimeMoving(false);
  manualTime = {minutes, date:manualTime?.date ?? new Date()};
  refreshLighting(true);
}

function finishTimeTravel() {
  if (!timeTravel) return;
  const destination = timeTravel;
  timeTravel = null;
  manualTime = destination.live ? null : {minutes:destination.to, date:destination.date};
  lightControl.setTimeMoving(false);
  refreshLighting(true);
}

function travelToTime(minutes = null, referenceDate = null) {
  // Live is already following the clock; only manual previews need a journey back.
  if (minutes === null && !manualTime) { refreshLighting(); return; }
  const now = new Date();
  const timing = motion.transition('time',TIME_TRAVEL_DURATION);
  const duration = reducedMotion.matches ? 0 : timing.duration;
  const live = minutes === null;
  // Aim at the clock at arrival, including a midnight crossed during travel.
  const arrival = live ? getSolarState(new Date(now.getTime() + duration)) : null;
  // Daily event buttons use their displayed civil date. At 24:00 this rebases
  // the next day's midnight to 00:00 before travelling to that day's event.
  const from = referenceDate
    ? getSolarState(manualTime ? dateAtMinutes(manualTime.minutes, manualTime.date) : now).minutes
    : manualTime?.minutes ?? getSolarState(now).minutes;
  const to = live ? arrival.minutes : Math.max(0, Math.min(1440, Number(minutes) || 0));
  const date = live ? arrival.date : referenceDate ?? manualTime?.date ?? now;
  lightControl.cancelPointer();
  timeTravel = {from, to, date, live, duration, ease:timing.ease, began:performance.now()};
  manualTime = {minutes:from, date};
  lightControl.setTimeMoving(true);
  if (!duration || Math.abs(to - from) < .001) finishTimeTravel();
  else invalidate();
}

function advanceTime(now) {
  if (!timeTravel) return false;
  const t = Math.min(1, Math.max(0, (now - timeTravel.began) / timeTravel.duration));
  if (t === 1) { finishTimeTravel(); return false; }
  const ease = timeTravel.ease(t);
  manualTime = {minutes:timeTravel.from + (timeTravel.to - timeTravel.from) * ease, date:timeTravel.date};
  // Resolve the actual intermediate solar time, keeping the icon, readout,
  // environment and moving shadows on one timeline without a second lag.
  refreshLighting(true);
  return true;
}

function setInterfaceHidden(hidden) {
  interfaceHidden = hidden;
  if (hidden) {
    // End held gestures without interrupting card or time journeys.
    cancelCanvasDrag();
    releaseSlider();
    lightControl?.cancelPointer();
    settingsPanel?.close({restoreFocus:false});
    interfaceToggle.focus({preventScroll:true});
  }
  document.body.dataset.interfaceVisibility = hidden ? 'hidden' : 'visible';
  interfaceToggle.setAttribute('aria-pressed', String(hidden));
  const label = hidden ? 'Show interface' : 'Hide interface';
  interfaceToggle.setAttribute('aria-label', label);
  interfaceToggle.setAttribute('title', label);
  // Keep layout intact: inspection bounds still determine the card's framing.
  for (const element of [$('#scene-introduction'), list, controls, lightControl?.element, $('#graphics-status'), $('#loading')]) {
    if (element) element.inert = hidden;
  }
  if (!hidden && expandedCardView) {
    const view = expandedCardView;
    expandedCardView = null;
    if (selected && !failed) setCardView(view);
  }
  updateCardAction();
  if (hidden && selected) revealHints();
}

function showError(error) {
  failed = true;
  setInterfaceHidden(false);
  interfaceToggle.hidden = true;
  console.error('Card scene could not render:', error);
  $('#loading').hidden = true;
  $('#scene-error').hidden = false;
  controls.hidden = true;
  $('#put-back').hidden = true;
  list.hidden = true;
  shell.dataset.state = 'unavailable';
  if (lightControl) lightControl.element.hidden = true;
  if (renderDiagnostics) renderDiagnostics.element.hidden = true;
  if (settingsPanel) { settingsPanel.close({restoreFocus:false}); $('#scene-actions').hidden = true; }
}

function revealHints() {
  clearTimeout(hintTimer);
  document.body.classList.add('inspection-feedback-visible');
  if (!sliderHeld) hintTimer = setTimeout(() => document.body.classList.remove('inspection-feedback-visible'), motion.duration('ui',350));
}

function resetHints() {
  clearTimeout(hintTimer);
  sliderHeld = false;
  document.body.classList.remove('inspection-feedback-visible');
}

function restoreCanvasCursor() {
  canvas.style.cursor = drag && drag.mode !== 'pick' ? 'grabbing' : selected && !pickup ? 'grab' : 'default';
}

function updateCollectionLabel() {
  if (selected) return;
  canvas.setAttribute('aria-label', `Greeting cards on a softly lit surface. ${groundMovementEnabled ? 'Drag empty ground to look around; release to return. ' : ''}Use the card list to choose a card.`);
}

function setGroundMovementEnabled(enabled) {
  groundMovementEnabled = Boolean(enabled);
  if (!groundMovementEnabled) {
    if (drag?.mode === 'ground') cancelCanvasDrag();
    // Settle without a fling, keeping an inspected card's camera steady.
    if (!selected) groundMotion.resume(performance.now(), {reducedMotion:reducedMotion.matches});
  }
  updateCollectionLabel();
  restoreCanvasCursor();
  invalidate();
}

function applyGroundCamera() {
  const offset = groundMotion.position;
  camera.position.copy(homeCameraPosition);
  camera.position.x += offset.x;
  camera.position.z += offset.z;
  camera.updateMatrixWorld();
  shell.dataset.groundOffsetX = offset.x.toFixed(4);
  shell.dataset.groundOffsetZ = offset.z.toFixed(4);
  shell.dataset.groundMovement = groundMovementEnabled ? 'on' : 'off';
  shell.dataset.groundMotion = selected ? 'paused' : drag?.mode === 'ground' ? 'dragging' : groundMotion.moving ? 'returning' : 'idle';
}

function cancelCanvasDrag({keepTouches = false} = {}) {
  const previous = drag;
  drag = null;
  if (previous?.mode === 'ground') {
    groundMotion.release(performance.now(), {cancelled:true,reducedMotion:reducedMotion.matches});
    invalidate();
  }
  if (!keepTouches) {
    const pointers = new Set(touchPointers.keys());
    if (previous) pointers.add(previous.pointerId);
    touchPointers.clear();
    touchSequenceSuppressed = false;
    for (const pointerId of pointers) if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }
  restoreCanvasCursor();
}

function setPickup(token) {
  pickup = token;
  const busy = Boolean(pickup);
  controls.querySelectorAll('#opening, [data-view], #reset-view').forEach(control => {
    control.disabled = busy || Boolean(selected && !canFold(selected) && (control === slider || control.dataset.view === 'inside'));
  });
  controls.setAttribute('aria-busy', String(busy));
  if (selected) shell.dataset.cardMotion = busy ? 'pickup' : 'ready';
  else delete shell.dataset.cardMotion;
  restoreCanvasCursor();
  updateCardAction();
}

function centreOf(record) {
  return new THREE.Vector3(0, record.model.height / 2, 0)
    .multiplyScalar(record.model.group.scale.x)
    .applyQuaternion(record.model.group.quaternion)
    .add(record.model.group.position);
}

function applyTransform(record, centre, quaternion, scale, opening) {
  const group = record.model.group;
  record.model.setOpening(opening);
  group.quaternion.copy(quaternion);
  group.scale.setScalar(scale);
  const offset = new THREE.Vector3(0, record.model.height / 2 * scale, 0).applyQuaternion(quaternion);
  group.position.copy(centre).sub(offset);
  if (record === selected) updateControls();
}

function invalidate() {
  if (!frame && !failed) frame = requestAnimationFrame(render);
}

function render(now) {
  frame = 0;
  if (failed) return;
  const groundMoving = groundMotion.step(now, reducedMotion.matches);
  applyGroundCamera();
  const timeMoving = advanceTime(now);
  for (const [record, tween] of tweens) {
    const t = Math.max(0, Math.min(1, (now - tween.began) / tween.duration));
    const ease = tween.ease(t);
    const centre = tween.start.centre.clone().lerp(tween.end.centre, ease);
    const quaternion = tween.start.quaternion.clone().slerp(tween.end.quaternion, ease);
    const scale = THREE.MathUtils.lerp(tween.start.scale, tween.end.scale, ease);
    const opening = THREE.MathUtils.lerp(tween.start.opening, tween.end.opening, ease);
    applyTransform(record, centre, quaternion, scale, opening);
    if (record === selected) revealHints();
    if (t === 1) {
      tweens.delete(record);
      tween.complete?.();
    }
  }
  const leavesMoving = leaves?.step(now);
  if (leaves) {
    const stats = leaves.stats;
    $('#leaf-trigger').dataset.leafCount = String(stats.count);
    $('#leaf-trigger').dataset.cardImpacts = String(stats.cardCollisions);
  }
  lighting?.followView(camera, selected ? centreOf(selected) : null, reducedMotion.matches);
  const lightingMoving = lighting?.step(now);
  updateLightingTheme();
  try {
    if (readingRenderer) {
      readingRenderer.render(selected?.model.group ?? null, {
        sceneScale:renderDiagnostics.pixelRatio,
        // Preserve normal room occlusion until the card is clear of the shelf.
        inspectionDetail:renderDiagnostics.inspectionDetail && !pickup,
      });
      const quality = readingRenderer.state;
      shell.dataset.renderMode = quality.mode;
      shell.dataset.sceneScale = quality.sceneScale.toFixed(2);
      shell.dataset.readingScale = quality.readingScale.toFixed(2);
    } else renderer.render(scene, camera);
  }
  catch (error) { showError(error); return; }
  if (ready) renderDiagnostics?.frame(now,{active:Boolean(tweens.size || lightingMoving || timeMoving || leavesMoving || groundMoving || drag)});
  if (tweens.size || lightingMoving || timeMoving || leavesMoving || groundMoving || (ready && renderDiagnostics?.continuous)) invalidate();
}

function animate(record, target, duration = 750, complete = null, retainedTiming = null) {
  tweens.delete(record);
  if (reducedMotion.matches) {
    applyTransform(record, target.centre, target.quaternion, target.scale, target.opening);
    complete?.();
    if (record === selected) revealHints();
  } else {
    const timing = retainedTiming ?? motion.transition('cards',duration);
    tweens.set(record, {
      began: performance.now(), duration:timing.duration, ease:timing.ease, complete,
      start: {centre:centreOf(record),quaternion:record.model.group.quaternion.clone(),scale:record.model.group.scale.x,opening:record.model.opening},
      end: target,
    });
  }
  updateCardAction();
  invalidate();
}

function cameraAxes() {
  up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
}

function canFold(record) {
  return record.model.canFold ?? record.card.type !== 'postcard';
}

function nextCardView() {
  const target = tweens.get(selected)?.end;
  if (canFold(selected)) return (target?.opening ?? selected.model.opening) > 90 ? 'front' : 'inside';
  const local = camera.quaternion.clone().invert().multiply(target?.quaternion ?? selected.model.group.quaternion);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(local);
  return normal.z < 0 ? 'front' : 'back';
}

function updateCardAction() {
  cardActionToggle.hidden = !interfaceHidden || !selected || failed;
  edgeNavigation.hidden = cardActionToggle.hidden;
  cardActionToggle.disabled = Boolean(pickup);
  if (!selected) return;
  const view = nextCardView();
  const action = canFold(selected) ? view === 'inside' ? 'open' : 'close' : 'flip';
  const label = action === 'flip' ? `Flip card to ${view}` : action === 'open' ? 'Open card' : 'Close card';
  cardActionToggle.dataset.action = action;
  cardActionToggle.setAttribute('aria-label', label);
  cardActionToggle.setAttribute('title', label);
}

function setCardView(view, {fillViewport = false} = {}) {
  if (!selected || pickup || (!canFold(selected) && view === 'inside')) return;
  cancelCanvasDrag();
  expandedCardView = fillViewport ? view : null;
  animate(selected, inspectionTarget(selected, view, {fillViewport}), 650);
}

function cardBounds(record, opening) {
  return record.model.boundsForOpening?.(opening) ?? {
    width:record.model.width * (canFold(record) && record.card.foldAxis !== 'horizontal' ? 2 : 1),
    height:record.model.height * (record.card.foldAxis === 'horizontal' ? 2 : 1),
  };
}

// Preserve physical sizes and leave clear air between the cards. Each row
// follows a shallow arc, with its ends coming slightly towards the viewer.
function collectionSlots(built) {
  const columns = Math.min(7, built.length);
  const rows = Math.ceil(built.length / columns);
  const slots = [];
  for (let row = 0; row < rows; row++) {
    const group = built.slice(row * columns, (row + 1) * columns);
    const gap = .42;
    const rowWidth = group.reduce((total, model) => total + model.width, 0) + gap * (group.length - 1);
    const radius = Math.max(18, rowWidth * 1.38);
    let along = -rowWidth / 2;
    group.forEach((model, column) => {
      const angle = (along + model.width / 2) / radius;
      slots.push({
        x:radius * Math.sin(angle),
        z:(row - (rows - 1) / 2) * 4.6 + radius * (1 - Math.cos(angle)),
        turn:-angle + [-.018,.012,-.02,.01,-.015,.02,0][column],
        row, column,
      });
      along += model.width + gap;
    });
  }
  return slots;
}

function collectionPoints() {
  const points = [];
  for (const record of models) {
    const bounds = cardBounds(record, record.home.opening);
    const halfWidth = bounds.width / 2 + .06;
    const halfHeight = bounds.height / 2 + .03;
    const halfDepth = Math.max(record.model.width, record.model.height) * .3 + .02;
    const centre = new THREE.Vector3(0, record.model.height / 2, 0);
    for (const x of [-halfWidth,halfWidth]) for (const y of [-halfHeight,halfHeight]) for (const z of [-halfDepth,halfDepth]) {
      points.push(new THREE.Vector3(x,y,z).add(centre).applyQuaternion(record.home.quaternion).add(record.home.position));
    }
  }
  return points;
}

function frameCollection(width, height) {
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const direction = new THREE.Vector3(0, models.length > 7 ? .53 : .36, models.length > 7 ? .848 : .933).normalize();
  const viewUp = new THREE.Vector3(0, direction.z, -direction.y);
  const target = new THREE.Vector3(0, .8, 0);
  const top = 1 - 2 * Math.min(width <= 700 ? 235 : 225, height * .35) / height;
  const bottom = -1 + 2 * Math.min(width <= 900 ? 124 : 88, height * .23) / height;
  const middle = (top + bottom) / 2;
  let distance = 11.8;
  for (const point of collectionPoints()) {
    const offset = point.sub(target);
    const y = offset.dot(viewUp), z = offset.dot(direction);
    distance = Math.max(distance,
      Math.abs(offset.x) / (tangent * camera.aspect * .89) + z,
      (y + top * tangent * z) / ((top - middle) * tangent),
      (-y - bottom * tangent * z) / ((middle - bottom) * tangent));
  }
  camera.position.copy(target).addScaledVector(direction, distance).addScaledVector(viewUp, -middle * distance * tangent);
  camera.lookAt(target.clone().addScaledVector(viewUp, -middle * distance * tangent));
  if (scene.fog) {
    // A narrow viewport needs a longer viewing distance, not a foggier shelf.
    scene.fog.near = Math.max(20, distance + 8);
    scene.fog.far = Math.max(60, distance + 48);
  }
}

function inspectionTarget(record, view = 'inside', {fillViewport = false} = {}) {
  if (!canFold(record) && view === 'inside') view = 'front';
  cameraAxes();
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const bounds = shell.getBoundingClientRect();
  const controlsTop = controls.hidden ? bounds.height - 220 : controls.getBoundingClientRect().top - bounds.top;
  const safeTop = bounds.width <= 700 ? Math.min(225, bounds.height * .39) : Math.min(170, bounds.height * .27);
  const freeHeight = Math.max(100, controlsTop - safeTop - 24);
  const heightFraction = Math.min(.52, freeHeight * .92 / bounds.height);
  const widthFraction = Math.min(.79, (bounds.width - 48) / bounds.width);
  // Keep a common distance for all presets so turning a card does not resize it.
  // A top-folded card needs vertical room; a postcard needs only one leaf.
  const openBounds = cardBounds(record, canFold(record) ? 160 : 0);
  const distance = Math.max(openBounds.height * 1.06 / (2 * tangent * heightFraction), openBounds.width * 1.06 / (2 * tangent * camera.aspect * widthFraction), 3.2);
  const centreY = 1 - 2 * (safeTop + freeHeight / 2) / bounds.height;
  const centre = camera.position.clone().addScaledVector(forward, distance).addScaledVector(up, distance * tangent * centreY);
  const inside = view === 'inside';
  const localTurn = new THREE.Quaternion().setFromEuler(new THREE.Euler(inside ? .055 : 0, view === 'back' ? Math.PI : inside ? -.10 : 0, 0, 'YXZ'));
  const target = {centre,quaternion:camera.quaternion.clone().multiply(localTurn),scale:1,opening:inside ? 160 : 0};
  return fillViewport ? fitCardToViewport(record, target) : target;
}

function fitCardToViewport(record, target) {
  const viewport = shell.getBoundingClientRect();
  const margin = viewport.width <= 700 ? 16 : 24;
  // Reserve only the tools that remain visible, including their safe-area inset.
  const top = Math.max(margin, $('#put-back').getBoundingClientRect().bottom - viewport.top + 12);
  const toolsTop = Math.min($('#view-actions').getBoundingClientRect().top, $('#scene-actions').getBoundingClientRect().top);
  const bottom = Math.max(margin, viewport.bottom - toolsTop + 12);
  const topNdc = 1 - 2 * Math.min(top, viewport.height * .3) / viewport.height;
  const bottomNdc = -1 + 2 * Math.min(bottom, viewport.height * .3) / viewport.height;
  const middle = (topNdc + bottomNdc) / 2;
  const sideNdc = Math.max(.1, 1 - 2 * margin / viewport.width);
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const bounds = cardBounds(record, target.opening);
  const leafSpan = record.card.foldAxis === 'horizontal' ? record.model.height : record.model.width;
  const depth = canFold(record) ? leafSpan * Math.sin(THREE.MathUtils.degToRad(target.opening)) + .02 : .02;
  const localTurn = camera.quaternion.clone().invert().multiply(target.quaternion);
  let distance = camera.near + .1;
  // Fit the rotated paper envelope, including the fold depth, to the frustum.
  for (const x of [-bounds.width / 2, bounds.width / 2]) for (const y of [-bounds.height / 2, bounds.height / 2]) for (const z of [-depth / 2, depth / 2]) {
    const point = new THREE.Vector3(x,y,z).applyQuaternion(localTurn);
    distance = Math.max(distance,
      Math.abs(point.x) / (tangent * camera.aspect * sideNdc) + point.z,
      (point.y + topNdc * tangent * point.z) / ((topNdc - middle) * tangent),
      (-point.y - bottomNdc * tangent * point.z) / ((middle - bottomNdc) * tangent));
  }
  distance *= 1.02;
  target.centre.copy(camera.position).addScaledVector(forward, distance).addScaledVector(up, distance * tangent * middle);
  return target;
}

function homeTarget(record) {
  return {
    centre:record.home.position.clone().add(new THREE.Vector3(0, record.model.height / 2, 0).applyQuaternion(record.home.quaternion)),
    quaternion:record.home.quaternion.clone(),scale:1,opening:record.home.opening,
  };
}

function updateControls() {
  if (!selected) return;
  const folded = canFold(selected);
  controls.dataset.cardType = folded ? 'folded' : 'postcard';
  const angle = Math.round(selected.model.opening);
  slider.value = String(angle);
  slider.style.setProperty('--slider-fill', `${angle / 1.8}%`);
  $('#opening-value').textContent = `${angle}°`;
  const local = camera.quaternion.clone().invert().multiply(selected.model.group.quaternion);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(local);
  const active = angle > 90 ? 'inside' : normal.z < 0 ? 'back' : 'front';
  document.querySelectorAll('[data-view]').forEach(button => {
    button.hidden = !folded && button.dataset.view === 'inside';
    button.classList.toggle('active', button.dataset.view === active);
  });
  shell.dataset.opening = String(angle);
  updateCardAction();
}

function setCardDetail(record, detail) {
  record.model.setDetail?.(detail).catch(error => {
    // A readable preview remains usable if the larger image cannot be fetched.
    console.warn(`Could not load ${detail} card images for ${record.card.id}:`, error);
  });
}

function selectCard(index, {fillViewport = false, focusTarget = null} = {}) {
  if (!ready || failed) return;
  cancelCanvasDrag();
  // Keep the displayed camera steady while its card is being inspected.
  groundMotion.pause(performance.now());
  const record = models[(index + models.length) % models.length];
  expandedCardView = fillViewport ? (canFold(record) ? 'inside' : 'front') : null;
  if (selected && selected !== record) {
    const previous = selected;
    animate(previous, homeTarget(previous), 700, () => setCardDetail(previous, 'preview'));
  }
  selected = record;
  setCardDetail(record, 'full');
  drag = null;
  controls.hidden = false;
  // The postcard panel is shorter. Apply the new card's controls before
  // measuring the available space for its pickup destination.
  updateControls();
  list.hidden = true;
  $('#put-back').hidden = false;
  $('#selected-title').textContent = record.card.title;
  $('#scene-instruction').hidden = true;
  if (shell.dataset.state !== 'inspection') lightControl.relocate(reducedMotion.matches ? 0 : 950);
  shell.dataset.state = 'inspection';
  shell.dataset.selectedCard = record.card.id;
  shell.dataset.selectedObject = record.model.group.uuid;
  const pickupToken = {record};
  setPickup(pickupToken);
  canvas.setAttribute('aria-label', `${record.card.title}. Drag to rotate; Shift and drag to move; pinch with two fingers or scroll to zoom. Two fingers also move the card. Escape puts the card back.`);
  list.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cardId === record.card.id)));
  revealHints();
  animate(record, inspectionTarget(record, expandedCardView ?? 'inside', {fillViewport}), 950, () => {
    if (selected === record && pickup === pickupToken) setPickup(null);
  });
  (focusTarget ?? $('#put-back')).focus({preventScroll:true});
}

function navigateCard(direction, focusTarget = null) {
  if (!selected) return;
  selectCard(models.indexOf(selected) + direction, {
    fillViewport:interfaceHidden && Boolean(expandedCardView), focusTarget,
  });
}

function revealHiddenNavigation() {
  if (interfaceHidden && selected && !failed) revealHints();
}

function putBack() {
  if (!selected) return;
  cancelCanvasDrag();
  expandedCardView = null;
  const record = selected;
  selected = null;
  groundMotion.resume(performance.now(), {reducedMotion:reducedMotion.matches});
  setPickup(null);
  drag = null;
  controls.hidden = true;
  $('#put-back').hidden = true;
  $('#selected-title').textContent = '';
  $('#scene-instruction').hidden = false;
  $('#scene-instruction').textContent = 'Pick up a card';
  list.hidden = false;
  list.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', 'false'));
  lightControl.relocate(reducedMotion.matches ? 0 : 800);
  shell.dataset.state = 'collection';
  delete shell.dataset.selectedCard;
  delete shell.dataset.selectedObject;
  delete shell.dataset.opening;
  updateCollectionLabel();
  canvas.style.cursor = 'default';
  resetHints();
  animate(record, homeTarget(record), 800, () => {
    setCardDetail(record, 'preview');
    if (!selected) (interfaceHidden ? interfaceToggle : record.button).focus({preventScroll:true});
  });
}

function resize() {
  if (!renderer) return;
  if (drag || touchPointers.size) cancelCanvasDrag();
  const retained = selected && {quaternion:selected.model.group.quaternion.clone(),scale:selected.model.group.scale.x,opening:selected.model.opening,tween:tweens.get(selected)};
  const bounds = shell.getBoundingClientRect();
  const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
  renderer.setPixelRatio(renderDiagnostics?.pixelRatio ?? 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  frameCollection(width, height);
  homeCameraPosition.copy(camera.position);
  camera.updateProjectionMatrix();
  applyGroundCamera();
  cameraAxes();
  if (selected) {
    tweens.delete(selected);
    const targetPose = inspectionTarget(selected, expandedCardView ?? 'inside', {fillViewport:Boolean(expandedCardView)});
    applyTransform(selected, targetPose.centre, retained.quaternion, retained.scale, retained.opening);
    if (retained.tween) {
      const end = {...retained.tween.end,centre:targetPose.centre};
      const remaining = Math.max(120, retained.tween.duration - (performance.now() - retained.tween.began));
      animate(selected, end, remaining, retained.tween.complete,{duration:remaining,ease:retained.tween.ease});
    }
  }
  invalidate();
}

function hitCard(event) {
  const bounds = canvas.getBoundingClientRect();
  pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  scene.updateMatrixWorld(true);
  const hit = raycaster.intersectObjects(pickable, false)[0];
  return hit ? models.find(record => record.card.id === hit.object.userData.cardId) : null;
}

function hitGround(event, view = camera) {
  const bounds = canvas.getBoundingClientRect();
  pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  raycaster.setFromCamera(pointer, view);
  const hit = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
  return hit && Math.abs(hit.x) <= 100 && Math.abs(hit.z) <= 100 ? hit : null;
}

function inspectionDrag(pointerId, clientX, clientY, pan = false) {
  const local = camera.quaternion.clone().invert().multiply(selected.model.group.quaternion);
  const angles = new THREE.Euler().setFromQuaternion(local, 'YXZ');
  return {pointerId,mode:pan ? 'pan' : 'turn',x:clientX,y:clientY,pitch:angles.x,yaw:angles.y,centre:centreOf(selected),scale:selected.model.group.scale.x};
}

function touchSpan() {
  const [first,second] = [...touchPointers.values()];
  return {distance:Math.max(1,Math.hypot(second.x-first.x,second.y-first.y)),x:(first.x+second.x)/2,y:(first.y+second.y)/2};
}

canvas.addEventListener('pointerdown', event => {
  if (!ready) return;
  if (pickup) { event.preventDefault(); return; }
  if (event.button !== 0) return;
  const touch = event.pointerType === 'touch';
  if (touch && touchPointers.size) {
    // Only the first pair participates. A third finger cannot change the
    // gesture or become a new primary while the accepted pair is held.
    event.preventDefault();
    if (touchPointers.size >= 2 || touchPointers.has(event.pointerId)) return;
    touchPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    canvas.setPointerCapture(event.pointerId);
    if (!selected || touchSequenceSuppressed) {
      cancelCanvasDrag({keepTouches:true});
      touchSequenceSuppressed = true;
      return;
    }
    tweens.delete(selected);
    const span = touchSpan();
    updateCardAction();
    drag = {pointerId:touchPointers.keys().next().value,mode:'pinch',...span};
    restoreCanvasCursor();
    revealHints();
    return;
  }
  if (event.isPrimary === false || drag || touchPointers.size) return;
  if (selected) {
    tweens.delete(selected);
    updateCardAction();
    drag = inspectionDrag(event.pointerId,event.clientX,event.clientY,event.shiftKey);
    canvas.style.cursor = 'grabbing';
    revealHints();
  } else {
    const record = hitCard(event);
    if (record) drag = {pointerId:event.pointerId,mode:'pick',x:event.clientX,y:event.clientY,record};
    else {
      if (!groundMovementEnabled) return;
      const anchor = hitGround(event);
      if (!anchor) return;
      groundMotion.begin(performance.now());
      drag = {pointerId:event.pointerId,mode:'ground',x:event.clientX,y:event.clientY,anchor,base:groundMotion.position,view:camera.clone(),moved:false};
      canvas.style.cursor = 'grabbing';
    }
  }
  if (touch) touchPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', event => {
  if (!ready) return;
  if (event.pointerType === 'touch' && touchPointers.has(event.pointerId)) {
    touchPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if (touchSequenceSuppressed) { event.preventDefault(); return; }
    if (selected && drag?.mode === 'pinch' && touchPointers.size === 2) {
      event.preventDefault();
      const span = touchSpan();
      const centre = centreOf(selected);
      cameraAxes();
      const unitsPerPixel = 2 * centre.distanceTo(camera.position) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / canvas.clientHeight;
      centre.addScaledVector(right,(span.x-drag.x)*unitsPerPixel).addScaledVector(up,-(span.y-drag.y)*unitsPerPixel);
      const scale = THREE.MathUtils.clamp(selected.model.group.scale.x * span.distance / drag.distance,MIN_CARD_ZOOM,MAX_CARD_ZOOM);
      applyTransform(selected,centre,selected.model.group.quaternion.clone(),scale,selected.model.opening);
      // Rebase each move, including at zoom limits, so reversing the pinch is
      // immediate and two-finger translation remains continuous.
      Object.assign(drag,span);
      revealHints();invalidate();
      return;
    }
  } else if (touchPointers.size) return;
  if (!drag) {
    if (!selected) canvas.style.cursor = hitCard(event) ? 'pointer' : groundMovementEnabled && hitGround(event) ? 'grab' : 'default';
    return;
  }
  if (event.pointerId !== drag.pointerId) return;
  if (drag.mode === 'ground') {
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    const point = hitGround(event, drag.view);
    if (!point) return;
    drag.moved = true;
    groundMotion.move(drag.base.x + drag.anchor.x - point.x, drag.base.z + drag.anchor.z - point.z, performance.now());
    applyGroundCamera();
    invalidate();
    return;
  }
  if (!selected || drag.mode === 'pick') return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  const centre = drag.centre.clone();
  let quaternion = selected.model.group.quaternion.clone();
  cameraAxes();
  if (drag.mode === 'pan') {
    const distance = centre.distanceTo(camera.position);
    const unitsPerPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / canvas.clientHeight;
    centre.addScaledVector(right, dx * unitsPerPixel).addScaledVector(up, -dy * unitsPerPixel);
  } else {
    const pitch = THREE.MathUtils.clamp(drag.pitch + dy * .006, -1.12, 1.12);
    quaternion = camera.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, drag.yaw + dx * .007, 0, 'YXZ')));
  }
  applyTransform(selected, centre, quaternion, drag.scale, selected.model.opening);
  revealHints();
  invalidate();
});

canvas.addEventListener('pointerup', event => {
  if (event.pointerType === 'touch' && touchPointers.has(event.pointerId)) {
    event.preventDefault();
    const action = drag;
    touchPointers.delete(event.pointerId);
    // Remove membership before releasing capture; lostpointercapture then
    // cannot cancel the surviving finger's newly rebased gesture.
    if (action?.mode === 'pinch') {
      if (touchPointers.size && selected) {
        const [pointerId,point] = touchPointers.entries().next().value;
        drag = inspectionDrag(pointerId,point.x,point.y);
      } else drag = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      restoreCanvasCursor();revealHints();
      return;
    }
    if (touchSequenceSuppressed) {
      if (!touchPointers.size) touchSequenceSuppressed = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      restoreCanvasCursor();
      return;
    }
  }
  if (event.button !== 0 || !drag || event.pointerId !== drag.pointerId) return;
  const action = drag;
  drag = null;
  if (action.mode === 'ground') {
    groundMotion.release(performance.now(), {reducedMotion:reducedMotion.matches});
    applyGroundCamera();
    invalidate();
  }
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (action?.mode === 'pick' && action.record && Math.hypot(event.clientX-action.x,event.clientY-action.y) < 7) {
    selectCard(models.indexOf(action.record));
  }
  restoreCanvasCursor();
  if (selected) revealHints();
});
['pointercancel','lostpointercapture'].forEach(type => canvas.addEventListener(type, event => {
  if (!touchPointers.has(event.pointerId) && (!drag || event.pointerId !== drag.pointerId)) return;
  cancelCanvasDrag();
}));
canvas.addEventListener('contextmenu', event => { if (pickup || drag) event.preventDefault(); });
canvas.addEventListener('wheel', event => {
  if (!selected) return;
  event.preventDefault();
  if (pickup) return;
  cancelCanvasDrag();
  tweens.delete(selected);
  const scale = THREE.MathUtils.clamp(selected.model.group.scale.x * Math.exp(-event.deltaY * .001),MIN_CARD_ZOOM,MAX_CARD_ZOOM);
  applyTransform(selected, centreOf(selected), selected.model.group.quaternion.clone(), scale, selected.model.opening);
  revealHints();invalidate();
}, {passive:false});

slider.addEventListener('input', () => {
  if (!selected || !canFold(selected)) return;
  if (pickup) { updateControls(); return; }
  cancelCanvasDrag();
  tweens.delete(selected);
  selected.model.setOpening(Number(slider.value));
  updateControls();revealHints();invalidate();
});
slider.addEventListener('pointerdown', () => {if(pickup || !selected || !canFold(selected))return;cancelCanvasDrag();sliderHeld = true;tweens.delete(selected);revealHints();});
function releaseSlider() {if(sliderHeld){sliderHeld = false;revealHints();}}
['pointerup','pointercancel'].forEach(type => window.addEventListener(type, releaseSlider));
slider.addEventListener('lostpointercapture', releaseSlider);
slider.addEventListener('blur', releaseSlider);
window.addEventListener('blur', () => {cancelCanvasDrag();releaseSlider();});
controls.addEventListener('pointermove', revealHints);
controls.addEventListener('pointerenter', revealHints);
controls.addEventListener('focusin', revealHints);
controls.addEventListener('keydown', revealHints);
$('#put-back').addEventListener('click', putBack);
interfaceToggle.addEventListener('click', () => setInterfaceHidden(!interfaceHidden));
cardActionToggle.addEventListener('click', () => {
  if (interfaceHidden && selected && !pickup) setCardView(nextCardView(), {fillViewport:true});
});
$('#reset-view').addEventListener('click', () => {if(selected && !pickup){cancelCanvasDrag();animate(selected,inspectionTarget(selected),650);}});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setCardView(button.dataset.view)));
$('#previous-card').addEventListener('click', () => navigateCard(-1));
$('#next-card').addEventListener('click', () => navigateCard(1));
for (const [id,direction] of [['edge-previous-card',-1],['edge-next-card',1]]) {
  const button = $(`#${id}`);
  button.addEventListener('click', () => {
    if (interfaceHidden && selected) navigateCard(direction, button);
  });
  button.addEventListener('pointerenter', revealHiddenNavigation);
  button.addEventListener('focus', revealHiddenNavigation);
}
for (const type of ['pointermove','pointerdown','keydown']) window.addEventListener(type, revealHiddenNavigation);
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.target.closest('#settings-panel')) return;
  if (!selected) return;
  if(event.key === 'Escape'){event.preventDefault();putBack();}
  if(event.target.matches('input') || event.target.closest('.light-control'))return;
  if(event.key === 'ArrowLeft'){event.preventDefault();navigateCard(-1);}
  if(event.key === 'ArrowRight'){event.preventDefault();navigateCard(1);}
});
canvas.addEventListener('webglcontextlost', event => {event.preventDefault();showError(new Error('WebGL context lost. Reload to retry.'));});

async function initialize() {
  renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  lighting = createLighting(scene,{motion});
  renderDiagnostics = createRenderDiagnostics({element:$('#render-diagnostics'), renderer, scene, invalidate, settingsStore, motion});
  readingRenderer = createReadingRenderer({renderer,scene,camera,onModeChange:() => renderDiagnostics.resetSampling()});
  leaves = createLeaves(scene, {
    timeScale:() => 1/motion.get('leaves').scale,
    reducedMotion:() => reducedMotion.matches,
    getColliders:() => pickable.filter(mesh => {
      const record = models.find(record => record.card.id === mesh.userData.cardId);
      return record && record !== selected && !tweens.has(record);
    }),
  });
  motionEditor = createMotionEditor({element:$('#motion-editor'),motion,settingsStore,reducedMotion});
  const syncSettingsView = () => {
    renderDiagnostics.setPanelOpen(settingsPanel.open && settingsPanel.tab === 'general');
    motionEditor.setActive(settingsPanel.open && settingsPanel.tab === 'advanced');
  };
  settingsPanel = createSettingsPanel({
    settingsStore,
    onGroundMovementChange:setGroundMovementEnabled,
    onOpenChange:syncSettingsView,
    onTabChange:syncSettingsView,
    onLeaf() { if (ready) { leaves.blow(); invalidate(); } },
  });
  $('#leaf-trigger').disabled = true;
  lightControl = createLightControl({
    motion,
    onTimeChange:setManualTime,
    onTimePreset:travelToTime,
    onLive:() => travelToTime(),
    onIndoorChange(enabled) { indoorEnabled = enabled; settingsStore.update({indoorEnabled:enabled}); refreshLighting(); },
  });
  shell.append(lightControl.element);
  setInterfaceHidden(false);
  interfaceToggle.hidden = false;
  refreshLighting();
  setInterval(() => { if (!manualTime && !document.hidden) refreshLighting(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !manualTime) refreshLighting(); });
  const built = await Promise.all(cards.map(card=>createCard(card,{onInvalidate:invalidate})));
  const slots = collectionSlots(built);
  built.forEach((model,index)=>{
    const card = cards[index];
    const group = model.group;
    group.position.set(slots[index].x,0,slots[index].z);
    group.rotation.y=slots[index].turn;
    model.setOpening(22+(index%3)*3);
    if (model.foldAxis === 'horizontal') {
      group.position.y = Math.max(0, (model.boundsForOpening(model.opening).height - model.height) / 2);
    }
    scene.add(group);
    group.traverse(object=>{
      if(!object.isMesh)return;
      pickable.push(object);
      for(const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for(const texture of [material.map,material.normalMap,material.roughnessMap]) {
          if(!texture)continue;
          texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
          texture.needsUpdate=true;
        }
      }
    });
    const button=document.createElement('button');
    button.type='button';
    const scanNumber = card.scanNumber ?? card.id.match(/(?:card|scan)[-_]?(\d+)$/i)?.[1];
    button.textContent=scanNumber ? String(scanNumber).padStart(2,'0') : card.title;
    button.title=card.title;
    button.setAttribute('aria-label',`Pick up ${card.title}`);
    button.setAttribute('aria-pressed','false');
    button.dataset.cardId=card.id;button.dataset.objectId=group.uuid;
    button.addEventListener('click',()=>selectCard(index));
    list.append(button);
    models.push({model,card,button,home:{position:group.position.clone(),quaternion:group.quaternion.clone(),opening:model.opening}});
  });
  shell.dataset.engine=`three-r${THREE.REVISION}`;
  shell.dataset.state='collection';
  updateCollectionLabel();
  ready=true;
  $('#leaf-trigger').disabled = false;
  resize();
  $('#loading').hidden=true;
  offlineSupport = createOfflineSupport({onStatus:state => settingsPanel.setOffline(state)});
  new ResizeObserver(resize).observe(shell);
  reducedMotion.addEventListener('change',()=>{
    if(reducedMotion.matches){cancelCanvasDrag();groundMotion.reset(performance.now());resize();finishTimeTravel();for(const[record,tween]of tweens){applyTransform(record,tween.end.centre,tween.end.quaternion,tween.end.scale,tween.end.opening);tweens.delete(record);tween.complete?.();}refreshLighting();invalidate();}
  });
}

initialize().catch(showError);
