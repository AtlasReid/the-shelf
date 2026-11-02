import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { createReadingRenderer } from '../reading-renderer.js';

function fixture({float = true,width = 1000,height = 700} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f3f0e8');
  const camera = new THREE.PerspectiveCamera();
  const selected = new THREE.Group();
  const card = new THREE.Mesh(new THREE.BoxGeometry(1,1.5,.004),new THREE.MeshStandardMaterial());
  card.castShadow = true;
  selected.add(card); scene.add(selected);
  const neighbour = new THREE.Mesh(card.geometry,new THREE.MeshStandardMaterial());
  const light = new THREE.DirectionalLight();
  scene.add(neighbour,light);
  let pixelRatio = .75, target = null, alpha = 1;
  const clear = new THREE.Color('#123456'), calls = [];
  const renderer = {
    extensions:{has:() => float},capabilities:{maxTextureSize:8192},
    autoClear:true,shadowMap:{autoUpdate:true},failAt:0,
    getSize(out) { return out.set(width,height); },
    getPixelRatio() { return pixelRatio; },setPixelRatio(value) { pixelRatio = value; },
    getRenderTarget() { return target; },setRenderTarget(value) { target = value; },
    getClearColor(out) { return out.copy(clear); },getClearAlpha() { return alpha; },
    setClearColor(value,nextAlpha) { clear.set(value); if (nextAlpha !== undefined) alpha = nextAlpha; },
    clearDepth() { this.depthCleared = true; },
    render(passScene,passCamera) {
      const call = {target,passScene,cameraMask:passCamera.layers.mask,
        cardMask:card.layers.mask,lightMask:light.layers.mask,
        colorWrite:card.material.colorWrite,depthWrite:card.material.depthWrite,
        shadows:this.shadowMap.autoUpdate,visible:card.visible,castShadow:card.castShadow,
        background:passScene.background,autoClear:this.autoClear};
      calls.push(call);
      if (this.failAt === calls.length) throw new Error('Synthetic render failure');
    },
  };
  let changes = 0;
  const effect = createReadingRenderer({renderer,scene,camera,onModeChange:() => changes++});
  return {effect,renderer,scene,camera,selected,card,neighbour,light,calls,
    get changes() { return changes; },get clear() { return clear.getHexString(); }};
}

const f = fixture();
f.effect.render(null,{sceneScale:.75});
assert.equal(f.calls.length,1,'The collection uses one direct lower-scale render.');
assert.equal(f.renderer.getPixelRatio(),.75);
assert.equal(f.effect.state.mode,'collection');
f.calls.length = 0;
const originalBackground = f.scene.background;
const originalPose = f.selected.matrix.clone();
f.effect.render(f.selected,{sceneScale:.75,inspectionDetail:true});
assert.equal(f.calls.length,3,'Reading uses room, composition and selected-paper passes.');
const [room,composition,paper] = f.calls;
assert.ok(room.target?.isWebGLRenderTarget);
assert.deepEqual([room.target.width,room.target.height],[750,525]);
assert.equal(room.target.texture.type,THREE.HalfFloatType,'HDR room colours are retained before the display transform.');
assert.equal(room.colorWrite,false); assert.equal(room.depthWrite,false);
assert.equal(room.visible,true); assert.equal(room.castShadow,true);
assert.ok(room.cameraMask & room.cardMask,'The colour-masked card still participates in room shadows.');
assert.equal(room.background,null,'Transparent sky avoids tone-mapping the HTML-matched clear colour.');
assert.equal(composition.background,originalBackground);
assert.equal(composition.target,null);
assert.equal(paper.cameraMask,paper.cardMask,'Only the selected paper is drawn at reading resolution.');
assert.equal(paper.cameraMask & f.neighbour.layers.mask,0,'Other cards remain in the lower-scale room.');
assert.ok(paper.cameraMask & paper.lightMask);
assert.equal(paper.colorWrite,true); assert.equal(paper.depthWrite,true);
assert.equal(paper.shadows,false,'Shadow maps are reused rather than recalculated twice.');
assert.equal(paper.autoClear,false); assert.equal(f.renderer.depthCleared,true);
assert.equal(f.renderer.getPixelRatio(),2);
assert.deepEqual(f.effect.state,{mode:'selected-card',sceneScale:.75,readingScale:2});
assert.equal(f.scene.background,originalBackground);
assert.equal(f.camera.layers.mask,1); assert.equal(f.card.layers.mask,1); assert.equal(f.light.layers.mask,1);
assert.equal(f.card.material.colorWrite,true); assert.equal(f.card.material.depthWrite,true);
assert.equal(f.renderer.shadowMap.autoUpdate,true);
assert.equal(f.clear,'123456'); assert.equal(f.renderer.getClearAlpha(),1);
assert.ok(f.selected.matrix.equals(originalPose),'Rendering does not move, clone or replace the card.');
const changes = f.changes;
f.effect.render(f.selected,{sceneScale:.75,inspectionDetail:true});
assert.equal(f.changes,changes,'Stable frames do not repeatedly reset performance sampling.');
f.effect.render(f.selected,{sceneScale:.75,inspectionDetail:false});
assert.equal(f.renderer.getPixelRatio(),.75,'The saved detail switch can disable the extra reading pass.');
f.effect.render(null,{sceneScale:.75});
assert.equal(f.renderer.getPixelRatio(),.75,'Returning to the collection restores its lower resolution.');
f.effect.destroy(); f.effect.destroy();

for (const failAt of [1,2,3]) {
  const broken = fixture(); broken.renderer.failAt = failAt;
  const background = broken.scene.background;
  assert.throws(()=>broken.effect.render(broken.selected),/Synthetic render failure/);
  assert.equal(broken.card.material.colorWrite,true); assert.equal(broken.card.material.depthWrite,true);
  assert.equal(broken.card.layers.mask,1); assert.equal(broken.light.layers.mask,1); assert.equal(broken.camera.layers.mask,1);
  assert.equal(broken.scene.background,background);
  assert.equal(broken.renderer.getRenderTarget(),null); assert.equal(broken.renderer.shadowMap.autoUpdate,true);
  assert.equal(broken.clear,'123456'); broken.effect.destroy();
}
const simple = fixture({float:false});
simple.effect.render(simple.selected,{sceneScale:.75});
assert.equal(simple.calls.length,1,'Drivers without HDR targets retain a direct sharp-reading fallback.');
assert.equal(simple.renderer.getPixelRatio(),2);
simple.effect.destroy();
const huge = fixture({width:9000,height:5000});
huge.effect.render(huge.selected);
assert.ok(huge.effect.state.readingScale < 2,'Large displays respect GPU size/pixel limits.');
assert.ok(9000 * 5000 * huge.effect.state.readingScale ** 2 <= 16 * 1024 * 1024 + 1);
huge.effect.destroy();
console.log('Reading renderer checks passed: selected-only 2× detail, lower-scale room/shadows, colour pipeline, return, cleanup and GPU limits.');
