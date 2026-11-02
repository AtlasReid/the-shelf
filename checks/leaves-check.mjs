import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three/three.module.js';
import { cards } from '../compatibility/cards.js';
import { createLeaves, sweepSphereAgainstMeshes } from '../leaves.js';

// Exercise the real card geometry without requiring image decoding or WebGL.
// Collision surfaces, transforms, geometry updates and simulation remain real.
const loadAsync = THREE.TextureLoader.prototype.loadAsync;
THREE.TextureLoader.prototype.loadAsync = async () => new THREE.Texture();
const { createCard } = await import('../card-mesh.js');
const sceneSource = await readFile(new URL('../scene.js',import.meta.url),'utf8');
const slotSource = sceneSource.match(/function collectionSlots\(built\) \{[\s\S]*?\r?\n\}/)?.[0];
assert.ok(slotSource,'Use the production collection arrangement rather than an outdated fixture.');
const collectionSlots = new Function(`${slotSource}; return collectionSlots;`)();
const near = (value, expected, label, epsilon = 1e-8) => assert.ok(Math.abs(value - expected) < epsilon, `${label}: ${value} != ${expected}`);
function seeded(seed = 1) {
  let value = seed;
  return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function leafMeshes(scene) { return scene.getObjectByName('Wind-blown leaves')?.children || []; }
async function shelf(seed = 1, {reducedMotion = () => false} = {}) {
  const scene = new THREE.Scene(), colliders = [], boundsByCard = new Map();
  const built = await Promise.all(cards.map(card => createCard(card)));
  const slots = collectionSlots(built);
  for (let i = 0; i < built.length; i++) {
    const model = built[i];
    model.group.position.set(slots[i].x, 0, slots[i].z);
    model.group.rotation.y = slots[i].turn;
    model.setOpening(22 + i % 3 * 3);
    if (model.foldAxis === 'horizontal') model.group.position.y = Math.max(0,(model.boundsForOpening(model.opening).height - model.height) / 2);
    assert.ok([...model.group.position.toArray(),...model.group.quaternion.toArray()].every(Number.isFinite),'Every real card has a finite pose.');
    scene.add(model.group);
    boundsByCard.set(cards[i].id,new THREE.Box3().setFromObject(model.group));
    model.group.traverse(object => { if (object.isMesh) colliders.push(object); });
  }
  const effect = createLeaves(scene, {getColliders:() => colliders, reducedMotion, random:seeded(seed)});
  return {scene, colliders, effect, slots, boundsByCard};
}
function run(effect, seconds, frequency) {
  effect.step(0);
  let active = true;
  for (let i = 1; i <= seconds * frequency; i++) active = effect.step(i * 1000 / frequency);
  return active;
}
let passed = 0;
async function check(name, callback) {
  await callback();
  passed++;
  console.log(`PASS ${name}`);
}

try {
  await check('swept collisions stop a fast leaf proxy on both sides of thin paper', () => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(.004, 4, 3), new THREE.MeshBasicMaterial());
    const front = sweepSphereAgainstMeshes(new THREE.Vector3(2, 1, 0), new THREE.Vector3(-2, 1, 0), .1, [wall]);
    const back = sweepSphereAgainstMeshes(new THREE.Vector3(-2, 1, 0), new THREE.Vector3(2, 1, 0), .1, [wall]);
    assert.ok(front && back, 'thin closed paper blocks either travelling direction');
    assert.ok(front.time > 0 && front.time < .5 && front.normal.x > .99);
    assert.ok(back.time > 0 && back.time < .5 && back.normal.x < -.99);
    const contactedX = 2 - 4 * front.time;
    assert.ok(contactedX >= .099 && contactedX <= .103, 'collision occurs before the sphere centre reaches the paper');
  });

  await check('swept sphere includes finite triangle edges and ignores empty space', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const paper = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const edge = sweepSphereAgainstMeshes(new THREE.Vector3(1.05, .05, 1), new THREE.Vector3(1.05, .05, -1), .1, [paper]);
    assert.ok(edge && edge.time < .5, 'a grazing leaf hits the edge rather than tunnelling past it');
    assert.ok(edge.normal.z > 0 && edge.normal.x > 0, 'contact normal follows the finite edge/vertex');
    assert.equal(sweepSphereAgainstMeshes(new THREE.Vector3(3, 2, 1), new THREE.Vector3(3, 2, -1), .1, [paper]), null);
  });

  await check('collision cache respects transformed parents and changed card geometry', () => {
    const parent = new THREE.Group();
    const paper = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .004), new THREE.MeshBasicMaterial());
    parent.add(paper); parent.position.x = 3; parent.rotation.y = Math.PI / 2;
    const hitAt = (start, end) => sweepSphereAgainstMeshes(new THREE.Vector3(start, 0, 0), new THREE.Vector3(end, 0, 0), .1, [paper]);
    assert.ok(hitAt(4, 2));
    parent.position.x = 4;
    assert.ok(hitAt(5, 3), 'moved parent is rebuilt');
    const positions = paper.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setZ(i, positions.getZ(i) + 1);
    positions.needsUpdate = true;
    const changed = hitAt(6, 4);
    assert.ok(changed, 'changed leaf buffer is rebuilt');
    near(6 - changed.time * 2, 5.102, 'geometry moves the actual contact', .001);
  });

  await check('a gust hits both rows of the actual 14-card shelf and all blades settle above the ground', async () => {
    const {scene, effect, slots, boundsByCard} = await shelf();
    assert.equal(effect.blow(), 16);
    // Curved rows have several depths. Use row membership for coverage, and
    // actual rotated paper bounds for entry tracks rather than exact z values.
    const rowOf = index => slots[index].row ?? Math.floor(index / 7);
    const rows = new Set(slots.map((_,index) => rowOf(index)));
    assert.equal(rows.size,2);
    const bounds = [...boundsByCard.values()];
    const rightEdge = Math.max(...bounds.map(box => box.max.x));
    for (const mesh of leafMeshes(scene)) {
      assert.ok(mesh.position.x > rightEdge,'Leaves enter from beyond the rightmost actual card.');
      assert.ok(bounds.some(box => mesh.position.z >= box.min.z - .18 && mesh.position.z <= box.max.z + .18),'Each gust track crosses real paper instead of a hardcoded empty aisle.');
    }
    assert.equal(run(effect, 10, 120), false, 'settled leaves do not require an idle frame loop');
    assert.equal(effect.stats.count, 16);
    assert.ok(effect.stats.cardCollisions > 0, 'real standing card triangles deflect leaves');
    const impactedRows = new Set(effect.stats.cardsHit.map(id => rowOf(cards.findIndex(card => card.id === id))));
    assert.equal(impactedRows.size,rows.size,'The same gust makes real contacts in both curved rows.');
    assert.equal(effect.stats.groundContacts, 16);
    for (const mesh of leafMeshes(scene)) {
      assert.ok(mesh.position.toArray().every(Number.isFinite));
      near(mesh.position.y, .004, 'resting blade rests on top of the floor');
      assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).y > .99, 'blade lies flat after settling');
      assert.ok(mesh.position.x < 7, 'wind carries the leaf in from the right');
    }
    effect.destroy();
  });

  await check('fixed-step motion and contact response agree at 30 and 120 display FPS', async () => {
    const first = await shelf(7), second = await shelf(7);
    first.effect.blow(); second.effect.blow();
    run(first.effect, 5, 30); run(second.effect, 5, 120);
    const a = leafMeshes(first.scene), b = leafMeshes(second.scene);
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) assert.ok(a[i].position.distanceTo(b[i].position) < 1e-8, `same physical trajectory for leaf ${i}`);
    assert.equal(first.effect.stats.cardCollisions, second.effect.stats.cardCollisions);
    first.effect.destroy(); second.effect.destroy();
  });

  await check('repeated gusts keep geometry/material resources and the leaf count bounded', () => {
    const scene = new THREE.Scene();
    const effect = createLeaves(scene, {random:seeded()});
    for (let i = 0; i < 8; i++) effect.blow();
    const meshes = leafMeshes(scene);
    assert.equal(meshes.length, 64);
    assert.equal(effect.stats.count, 64);
    assert.equal(new Set(meshes.map(mesh => mesh.geometry)).size, 1, 'geometry is shared across every gust');
    assert.ok(new Set(meshes.map(mesh => mesh.material)).size <= 5, 'bounded shared palette');
    let geometryDisposals = 0, materialDisposals = 0;
    meshes[0].geometry.addEventListener('dispose', () => geometryDisposals++);
    const materials = new Set(meshes.map(mesh => mesh.material));
    materials.forEach(material => material.addEventListener('dispose', () => materialDisposals++));
    effect.destroy(); effect.destroy();
    assert.equal(geometryDisposals, 1);
    assert.equal(materialDisposals, materials.size);
    assert.equal(scene.getObjectByName('Wind-blown leaves'), undefined);
    assert.equal(effect.blow(), 0);
    assert.equal(effect.step(1000), false);
  });

  await check('reduced motion places a few resting leaves without an animated gust', () => {
    const scene = new THREE.Scene();
    const effect = createLeaves(scene, {reducedMotion:() => true, random:seeded()});
    assert.equal(effect.blow(), 4);
    assert.equal(effect.stats.moving, 0);
    assert.equal(effect.step(0), false);
    for (const mesh of leafMeshes(scene)) near(mesh.position.y, .004, 'reduced-motion leaf is grounded');
    effect.step(36_000);
    assert.equal(effect.stats.count, 0, 'old resting blades expire on the next scene step');
    effect.destroy();
  });

  await check('reduced-motion leaves use the current collection and rest clear of its card bases', async () => {
    const {scene,effect,colliders,boundsByCard} = await shelf(2,{reducedMotion:() => true});
    effect.destroy();
    for (let seed = 0; seed < 32; seed++) {
      const staticLeaves = createLeaves(scene,{getColliders:() => colliders,reducedMotion:() => true,random:seeded(seed)});
      assert.equal(staticLeaves.blow(),4);
      assert.equal(staticLeaves.step(0),false);
      for (const mesh of leafMeshes(scene)) {
        near(mesh.position.y,.004,'resting height');
        assert.ok([...boundsByCard.values()].some(box => mesh.position.x >= box.min.x && mesh.position.x <= box.max.x && mesh.position.z > box.max.z + .34 && mesh.position.z < box.max.z + .66),'Static X and Z placement use the same actual card.');
        assert.ok(!sweepSphereAgainstMeshes(mesh.position,mesh.position,.15,colliders),`Static leaf clears curved card bases (seed ${seed}).`);
      }
      staticLeaves.destroy();
    }
  });

  console.log(`Leaf checks passed (${passed} cases, real Three.js collision geometry).`);
} finally {
  THREE.TextureLoader.prototype.loadAsync = loadAsync;
}
