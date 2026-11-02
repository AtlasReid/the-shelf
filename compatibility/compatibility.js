import { cards } from './cards.js';

const $ = (selector) => document.querySelector(selector);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const viewer = $('#card-viewer');
const pose = $('#inspection-pose');
const shell = $('#focus-shell');
const stage = $('#inspection-stage');
const openingSlider = $('#opening');
const openingValue = $('#opening-value');
let inspectionFadeTimer;
let sliderPointerActive = false;
let selectedIndex = 0;
let sourceButton = null;
let viewingRig;
let opening = 160;
let rotation = { x: 4, y: -7 };
let pan = { x: 0, y: 0 };
let zoom = 1;
let flight = null;
let foldFrame = 0;
let finishFold = null;
let operation = 0;
let busy = false;

function sizeCard(element, card) {
  const width = Math.max(1, Number(card.width) || 105);
  const height = Math.max(1, Number(card.height) || 148);
  element.style.setProperty('--leaf-width', String(width));
  element.style.setProperty('--leaf-height', String(height));
  element.style.setProperty('--card-ratio', String(width / height));
  element.dataset.cardType = card.type || 'folded';
  element.dataset.foldAxis = card.foldAxis || 'vertical';
}

function makeRig(card, angle = 22, detail = false) {
  const rig = document.createElement('div');
  rig.className = 'card-rig';
  rig.dataset.cardType = card.type || 'folded';
  rig.dataset.foldAxis = card.foldAxis || 'vertical';
  rig.setAttribute('aria-hidden', 'true');
  rig.style.setProperty('--paper', card.paper || '#fffaf0');
  function face(className, surface) {
    const panel = document.createElement('div');
    panel.className = `paper-face ${className}`;
    const image = document.createElement('img');
    image.src = (detail ? card.surfaces : card.previewSurfaces || card.surfaces)[surface];
    image.alt = '';
    image.draggable = false;
    image.decoding = 'async';
    panel.append(image);
    return panel;
  }
  const book = document.createElement('div');
  book.className = 'card-book';
  if (card.type === 'postcard') {
    const sheet = document.createElement('div');
    sheet.className = 'card-leaf postcard-sheet';
    sheet.append(face('front-outside', 'front'), face('back-outside', 'back'));
    book.append(sheet);
    rig.append(book);
    setRigAngle(rig, 0);
    return rig;
  }
  const back = document.createElement('div');
  back.className = 'card-leaf card-back';
  back.append(face('inside-right', 'insideRight'), face('back-outside', 'back'));
  const front = document.createElement('div');
  front.className = 'card-leaf card-front';
  front.append(face('front-outside', 'front'), face('front-inside', 'insideLeft'));
  book.append(back, front);
  rig.append(book);
  setRigAngle(rig, angle);
  return rig;
}

function setRigAngle(rig, angle) {
  if (rig.dataset.cardType === 'postcard') angle = 0;
  rig.style.setProperty('--fold', `${-angle}deg`);
  rig.style.setProperty('--top-fold', `${angle}deg`);
  const offset = angle < 90 ? -50 : -(1 + Math.cos(angle * Math.PI / 180)) * 50;
  rig.style.setProperty('--book-offset', `${offset}%`);
}

function decoration(type) {
  const item = document.createElement('div');
  item.className = 'shelf-object decoration';
  item.setAttribute('aria-hidden', 'true');
  if (type === 'plant') item.innerHTML = `<svg class="plant" viewBox="0 0 180 180" fill="none"><g stroke="#7c8668" stroke-width="2"><path d="M91 180C85 129 89 77 66 25M91 180c7-68 35-91 40-132M89 143C63 116 43 95 40 70M96 135c20-27 39-37 55-45"/></g><g fill="#8a9476"><ellipse cx="66" cy="33" rx="8" ry="21" transform="rotate(-22 66 33)"/><ellipse cx="79" cy="72" rx="8" ry="22" transform="rotate(38 79 72)"/><ellipse cx="59" cy="77" rx="8" ry="20" transform="rotate(-44 59 77)"/><ellipse cx="41" cy="76" rx="8" ry="21" transform="rotate(-34 41 76)"/><ellipse cx="66" cy="111" rx="8" ry="22" transform="rotate(44 66 111)"/><ellipse cx="130" cy="53" rx="8" ry="22" transform="rotate(10 130 53)"/><ellipse cx="114" cy="90" rx="8" ry="21" transform="rotate(-28 114 90)"/><ellipse cx="137" cy="95" rx="8" ry="21" transform="rotate(49 137 95)"/><ellipse cx="150" cy="92" rx="7" ry="18" transform="rotate(52 150 92)"/></g></svg><div class="object-vase"></div>`;
  else item.innerHTML = `<div class="books"><div class="book-vessel"></div><div class="book-spine">THE EVERYDAY</div><div class="book-spine">A SLOWER KIND OF LIFE</div><div class="book-spine">COLLECTED MOMENTS</div></div>`;
  return item;
}

function renderShelves() {
  const shelves = $('#shelves');
  shelves.replaceChildren();
  const arrangements = [cards.slice(0,3), cards.slice(3,5)];
  for (let offset = 5; offset < cards.length; offset += 3) arrangements.push(cards.slice(offset, offset + 3));
  let index = 0;
  arrangements.forEach((group, rowIndex) => {
    const row = document.createElement('div');
    row.className = 'shelf-row';
    const objects = document.createElement('div');
    objects.className = 'shelf-objects';
    group.forEach((card, slot) => {
      const cardIndex = index++;
      const object = document.createElement('div');
      object.className = 'shelf-object';
      const button = document.createElement('button');
      button.className = 'card-item';
      button.dataset.cardId = card.id;
      button.type = 'button';
      sizeCard(button, card);
      button.setAttribute('aria-label', `Open ${card.title}, ${card.occasion}`);
      button.append(makeRig(card, 22 + slot * 3));
      const caption = document.createElement('span');
      caption.className = 'card-caption';
      caption.textContent = card.title;
      button.append(caption);
      button.addEventListener('click', () => openCard(cardIndex, button));
      object.append(button);
      objects.append(object);
    });
    if (rowIndex === 0) objects.append(decoration('plant'));
    if (rowIndex === 1) objects.append(decoration('books'));
    const deck = document.createElement('div');
    deck.className = 'shelf-deck';
    deck.setAttribute('aria-hidden', 'true');
    row.append(objects, deck);
    shelves.append(row);
  });
  $('#card-count').textContent = `${String(cards.length).padStart(2,'0')} CARDS`;
}

function updatePose() {
  pose.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom}) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`;
  revealInspectionHints();
}

function revealInspectionHints() {
  clearTimeout(inspectionFadeTimer);
  viewer.classList.add('inspection-feedback-visible');
  if (!sliderPointerActive) {
    inspectionFadeTimer = setTimeout(() => viewer.classList.remove('inspection-feedback-visible'), 350);
  }
}

function endSliderInteraction() {
  if (!sliderPointerActive) return;
  sliderPointerActive = false;
  revealInspectionHints();
}

function resetInspectionHints() {
  clearTimeout(inspectionFadeTimer);
  sliderPointerActive = false;
  viewer.classList.remove('inspection-feedback-visible');
}

function setOpening(value) {
  opening = cards[selectedIndex].type === 'postcard' ? 0 : Math.max(0, Math.min(180, Number(value)));
  if (viewingRig) setRigAngle(viewingRig, opening);
  openingSlider.value = String(Math.round(opening));
  openingValue.textContent = `${Math.round(opening)}°`;
  openingSlider.style.setProperty('--slider-fill', `${opening / 1.8}%`);
  revealInspectionHints();
  const activeView = opening > 90 ? 'inside' : Math.cos(rotation.y * Math.PI / 180) < 0 ? 'back' : 'front';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', activeView === button.dataset.view));
}

function cancelFold() {
  cancelAnimationFrame(foldFrame);
  finishFold?.();
  finishFold = null;
}

function animateFold(target, duration = 550, delay = 0, targetPose = null) {
  cancelFold();
  const start = opening;
  const startPose = { rotation: {...rotation}, pan: {...pan}, zoom };
  function applyFrame(progress) {
    if (targetPose) {
      const mix = (from, to) => from + (to - from) * progress;
      rotation = {x:mix(startPose.rotation.x,targetPose.rotation.x),y:mix(startPose.rotation.y,targetPose.rotation.y)};
      pan = {x:mix(startPose.pan.x,targetPose.pan.x),y:mix(startPose.pan.y,targetPose.pan.y)};
      zoom = mix(startPose.zoom,targetPose.zoom);
      updatePose();
    }
    setOpening(start + (target - start) * progress);
  }
  if (reducedMotion.matches) { applyFrame(1); return Promise.resolve(); }
  const began = performance.now() + delay;
  return new Promise(resolve => {
    finishFold = resolve;
    function step(now) {
      const t = Math.max(0, Math.min(1, (now - began) / duration));
      // Smootherstep: a symmetric bell-shaped speed profile, resting at both ends.
      const eased = t * t * t * (t * (6 * t - 15) + 10);
      applyFrame(eased);
      if (t < 1) foldFrame = requestAnimationFrame(step);
      else { finishFold = null; resolve(); }
    }
    foldFrame = requestAnimationFrame(step);
  });
}

function loadViewerCard(index) {
  resetInspectionHints();
  selectedIndex = (index + cards.length) % cards.length;
  const card = cards[selectedIndex];
  const postcard = card.type === 'postcard';
  $('.opening-control').hidden = postcard;
  $('[data-view="inside"]').hidden = postcard;
  openingSlider.disabled = postcard;
  $('#viewer-title').textContent = card.title;
  $('#viewer-occasion').textContent = card.occasion.toUpperCase();
  $('#viewer-position').textContent = `${String(selectedIndex + 1).padStart(2,'0')} / ${String(cards.length).padStart(2,'0')}`;
  sizeCard(shell, card);
  pose.replaceChildren(viewingRig = makeRig(card, 22, true));
  viewingRig.setAttribute('aria-hidden', 'true');
  rotation = { x:4, y:-7 }; pan = { x:0, y:0 }; zoom = 1;
  updatePose();
  setOpening(22);
}

async function openCard(index, button) {
  if (busy) return;
  busy = true;
  const version = ++operation;
  sourceButton = button;
  const from = button.getBoundingClientRect();
  loadViewerCard(index);
  viewer.showModal();
  document.body.style.overflow = 'hidden';
  button.classList.add('is-selected');
  const target = shell.getBoundingClientRect();
  const dx = from.left + from.width / 2 - target.left - target.width / 2;
  const dy = from.top + from.height / 2 - target.top - target.height / 2;
  const scale = from.height / target.height * .94;
  if (!reducedMotion.matches) {
    flight = shell.animate([{transform:`translate(${dx}px, ${dy}px) scale(${scale})`},{transform:'translate(0,0) scale(1)'}], {duration:680,easing:'cubic-bezier(.45,0,.55,1)',fill:'none'});
  }
  await animateFold(160, 650, reducedMotion.matches ? 0 : 160);
  if (version !== operation) return;
  busy = false;
  $('.close-viewer').focus({preventScroll:true});
}

async function closeViewer() {
  if (!viewer.open) return;
  ++operation;
  busy = true;
  cancelFold();
  flight?.cancel();
  // Return the object to its own shelf position, even after using next/previous.
  const cardId = cards[selectedIndex].id;
  const destination = [...document.querySelectorAll('.card-item')].find(item => item.dataset.cardId === cardId) || sourceButton;
  sourceButton?.classList.remove('is-selected');
  destination?.classList.add('is-selected');
  if (destination && !reducedMotion.matches) {
    rotation = {x:-3,y:-13}; pan = {x:0,y:0}; zoom=1;
    updatePose();
    const end = destination.getBoundingClientRect();
    const start = shell.getBoundingClientRect();
    const dx = end.left + end.width / 2 - start.left - start.width / 2;
    const dy = end.top + end.height / 2 - start.top - start.height / 2;
    animateFold(22, 350);
    flight = shell.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${dx}px,${dy}px) scale(${end.height/start.height*.94})`,opacity:1}], {duration:430,easing:'cubic-bezier(.55,0,.45,1)',fill:'forwards'});
    await flight.finished.catch(() => {});
    flight.cancel();
  }
  viewer.close();
  resetInspectionHints();
  destination?.classList.remove('is-selected');
  document.body.style.overflow = '';
  destination?.focus({preventScroll:true});
  busy = false;
}

openingSlider.addEventListener('input', event => { cancelFold(); setOpening(event.target.value); });
document.querySelectorAll('.opening-control, .inspection-tools').forEach(control => {
  ['pointerenter', 'pointermove', 'focusin', 'keydown'].forEach(type => control.addEventListener(type, revealInspectionHints));
});
openingSlider.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  cancelFold();
  sliderPointerActive = true;
  revealInspectionHints();
});
['pointerup', 'pointercancel'].forEach(type => window.addEventListener(type, endSliderInteraction));
window.addEventListener('blur', endSliderInteraction);
openingSlider.addEventListener('blur', endSliderInteraction);
openingSlider.addEventListener('lostpointercapture', endSliderInteraction);
$('.close-viewer').addEventListener('click', closeViewer);
viewer.addEventListener('cancel', event => { event.preventDefault(); if (!busy) closeViewer(); });
$('#reset-view').addEventListener('click', () => {
  cancelFold();
  rotation = {x:4,y:-7};pan={x:0,y:0};zoom=1;updatePose();setOpening(160);
});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  if (cards[selectedIndex].type === 'postcard' && button.dataset.view === 'inside') return;
  const inside = button.dataset.view === 'inside';
  const targetYaw = button.dataset.view === 'back' ? 180 : inside ? -7 : 0;
  // Choose the nearest equivalent orientation after any number of manual turns.
  const yawDelta = ((targetYaw - rotation.y) % 360 + 540) % 360 - 180;
  animateFold(inside ? 160 : 0, 650, 0, {
    rotation:{x:inside ? 4 : 0,y:rotation.y + (yawDelta === -180 ? 180 : yawDelta)},
    pan:{x:0,y:0},zoom:1
  });
}));
function nextCard(direction) {
  if (busy) return;
  cancelFold();
  sourceButton?.classList.remove('is-selected');
  loadViewerCard(selectedIndex + direction);
  sourceButton = [...document.querySelectorAll('.card-item')].find(item => item.dataset.cardId === cards[selectedIndex].id);
  sourceButton?.classList.add('is-selected');
  setOpening(160);
}
$('#previous-card').addEventListener('click', () => nextCard(-1));
$('#next-card').addEventListener('click', () => nextCard(1));
viewer.addEventListener('keydown', event => {
  if (event.target.closest('input,button')) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); nextCard(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); nextCard(1); }
});
let drag = null;
stage.addEventListener('pointerdown', event => {
  if (busy || event.button !== 0) return;
  event.preventDefault();
  cancelFold();
  drag = {x:event.clientX,y:event.clientY,startX:rotation.x,startY:rotation.y,panX:pan.x,panY:pan.y,move:event.shiftKey};
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener('pointermove', event => {
  if (!drag) return;
  const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  if (drag.move) pan={x:drag.panX+dx,y:drag.panY+dy};
  else rotation={x:Math.max(-65,Math.min(65,drag.startX-dy*.35)),y:drag.startY+dx*.4};
  updatePose();
  setOpening(opening);
});
['pointerup','pointercancel','lostpointercapture'].forEach(type => stage.addEventListener(type, () => {drag=null;}));
stage.addEventListener('wheel', event => {
  event.preventDefault();
  cancelFold();
  zoom=Math.max(.65,Math.min(1.6,zoom-event.deltaY*.001));updatePose();
}, {passive:false});

renderShelves();
