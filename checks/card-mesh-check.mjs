import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { createCard } from '../card-mesh.js';
import { createPaperMaterial } from '../paper-material.js';

// Exercise the real geometry without a browser image decoder. Textures retain
// their requested URLs, so face assignment and material behaviour remain real.
const originalLoad = THREE.TextureLoader.prototype.loadAsync;
THREE.TextureLoader.prototype.loadAsync = async function(url) {
  const texture = new THREE.Texture();
  texture.name = url;
  return texture;
};
const surfaces = Object.fromEntries(['front','insideLeft','insideRight','back'].map(name => [name, `${name}.jpg`]));
const fixture = (extra = {}) => ({id:'test-fold', title:'Test card', type:'folded', width:104.3, height:150.2, surfaces, ...extra});
const near = (actual, expected, message, epsilon = 1e-5) => assert.ok(Math.abs(actual - expected) < epsilon, `${message}: ${actual} versus ${expected}`);
const meshes = model => {
  const result = [];
  model.group.traverse(object => { if (object.isMesh) result.push(object); });
  return result;
};
const leaf = (model, name) => meshes(model).find(mesh => mesh.userData.leaf === name);
function faceDirections(mesh, face) {
  const positions = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
  const corner = (u,v) => {
    for (let index = face * 4; index < face * 4 + 4; index++) {
      if (uv.getX(index) === u && uv.getY(index) === v) return new THREE.Vector3().fromBufferAttribute(positions,index).applyMatrix4(mesh.matrixWorld);
    }
    throw new Error('Missing face UV corner.');
  };
  const origin = corner(0,0);
  return {right:corner(1,0).sub(origin).normalize(), up:corner(0,1).sub(origin).normalize()};
}
function assertUpright(mesh, face, rightX, description) {
  const axes = faceDirections(mesh,face);
  near(axes.right.x, rightX, `${description} reads left to right`);
  near(axes.right.y, 0, `${description} image horizontal`);
  near(axes.up.y, 1, `${description} image upright`);
  near(axes.up.x, 0, `${description} image vertical`);
}

try {
  const postcard = await createCard(fixture({id:'card-07',type:'postcard',width:148.3,height:104.8,surfaces:{front:'postcard-front.jpg',back:'postcard-back.jpg'}}));
  assert.equal(postcard.canFold, false);
  assert.equal(meshes(postcard).length,1,'A postcard is exactly one solid sheet.');
  for (const angle of [0,22,90,160,180,NaN]) {
    assert.equal(postcard.setOpening(angle),0);
    assert.equal(postcard.opening,0);
  }
  postcard.group.updateMatrixWorld(true);
  const postBounds = new THREE.Box3().setFromObject(postcard.group);
  near(postBounds.min.y,0,'Postcard sits on ground');
  near(postBounds.getSize(new THREE.Vector3()).x,1.483,'Postcard uses full scan width');
  near(postBounds.getSize(new THREE.Vector3()).y,1.048,'Postcard uses full scan height');
  assertUpright(meshes(postcard)[0],4,1,'Postcard front');
  assertUpright(meshes(postcard)[0],5,-1,'Postcard back');

  for (const foldAxis of ['vertical','horizontal']) {
    const model = await createCard(fixture({foldAxis,width:foldAxis === 'horizontal' ? 210.6 : 104.3,height:foldAxis === 'horizontal' ? 148.4 : 150.2}));
    assert.equal(model.canFold,true);
    assert.equal(meshes(model).filter(mesh => mesh.userData.isCardLeaf).length,2);
    assert.equal(meshes(model).filter(mesh => mesh.userData.isCardCrease).length,1);
    for (const angle of [0,22,45,90,160,180]) {
      model.setOpening(angle);
      model.group.updateMatrixWorld(true);
      const actual = new THREE.Box3().setFromObject(model.group);
      const expected = model.boundsForOpening(angle), size = actual.getSize(new THREE.Vector3()), centre = actual.getCenter(new THREE.Vector3());
      near(size.x,expected.width,`${foldAxis} ${angle}° fitted width`);
      near(size.y,expected.height,`${foldAxis} ${angle}° fitted height`);
      near(centre.x,0,`${foldAxis} ${angle}° stable horizontal centre`);
      near(centre.y,model.height / 2,`${foldAxis} ${angle}° stable vertical centre`);
      near(centre.z,0,`${foldAxis} ${angle}° stable depth centre`);
      // Every end of both leaf solids meets a vertex of the capped bend. This
      // checks the actual shared surfaces across opening states and both axes.
      const crease = meshes(model).find(mesh => mesh.userData.isCardCrease);
      if (angle < 180) {
        const creasePositions = crease.geometry.getAttribute('position');
        for (const name of ['front','back']) {
          const sheet = leaf(model,name), positions = sheet.geometry.getAttribute('position');
          for (let index = 0; index < positions.count; index++) {
            if (positions.getX(index) !== 0) continue;
            const point = new THREE.Vector3().fromBufferAttribute(positions,index).applyMatrix4(sheet.matrixWorld);
            let nearest = Infinity;
            for (let other = 0; other < creasePositions.count; other++) {
              const creasePoint = new THREE.Vector3().fromBufferAttribute(creasePositions,other).applyMatrix4(crease.matrixWorld);
              nearest = Math.min(nearest,point.distanceTo(creasePoint));
            }
            assert.ok(nearest < 1e-6,`${foldAxis} ${angle}° ${name} leaf joins continuous crease`);
          }
        }
      }
    }
    model.setOpening(0); model.group.updateMatrixWorld(true);
    assertUpright(leaf(model,'front'),4,1,`${foldAxis} closed front`);
    assertUpright(leaf(model,'back'),5,-1,`${foldAxis} closed back`);
    model.setOpening(180); model.group.updateMatrixWorld(true);
    assertUpright(leaf(model,'front'),5,1,`${foldAxis} opened first inside`);
    assertUpright(leaf(model,'back'),4,1,`${foldAxis} opened second inside`);
  }

  const metallic = await createCard(fixture({finish:'metallic-outside'}));
  const front = leaf(metallic,'front').material, back = leaf(metallic,'back').material;
  assert.ok(front[4].metalness > 0 && back[5].metalness > 0,'Only exterior surfaces get metallic response.');
  assert.equal(front[5].metalness,0); assert.equal(back[4].metalness,0);
  assert.ok(front[4].roughness < front[5].roughness);
  assert.ok(front[4].normalMap && front[5].normalMap,'Both finish types retain fine paper grain.');
  assert.equal(createPaperMaterial().metalness,0,'Ordinary cards stay matte.');
  const selective = await createCard(fixture({id:'foil-03',finish:'gold-foil',
    finishMaps:{front:'material/card-03-gold.png'},
    previewSurfaces:Object.fromEntries(Object.keys(surfaces).map(name => [name,`foil-preview-${name}.jpg`])),
  }));
  const foilFront = leaf(selective,'front').material[4];
  const foilData = foilFront.metalnessMap;
  assert.ok(foilData,'The gold exterior uses a spatial metalness mask.');
  assert.equal(foilData,foilFront.roughnessMap,'The same UV-aligned data supplies selective roughness.');
  assert.equal(foilData.colorSpace,THREE.NoColorSpace,'Material data is linear rather than scan sRGB.');
  assert.equal(foilData.wrapS,THREE.ClampToEdgeWrapping);
  assert.equal(foilData.wrapT,THREE.ClampToEdgeWrapping);
  assert.ok(foilFront.metalness > 0 && foilFront.metalness < .42,'Card 03 foil is subtler than card 04.');
  for (const material of [leaf(selective,'front').material[5],...leaf(selective,'back').material.slice(4)]) {
    assert.equal(material.metalness,0,'The plain back and both insides remain matte.');
    assert.equal(material.metalnessMap,null);
  }
  await selective.setDetail('full');
  assert.equal(foilFront.metalnessMap,foilData,'Full-resolution promotion preserves the selective finish.');
  await selective.setDetail('preview');
  assert.equal(foilFront.roughnessMap,foilData,'Returning to previews preserves the selective finish.');
  await assert.rejects(createCard(fixture({width:0})),RangeError);
  await assert.rejects(createCard(fixture({type:'postcard',surfaces:{front:'only-front.jpg'}})),TypeError);
  await assert.rejects(createCard(fixture({finishMaps:{insideLeft:'invalid-inside.png'}})),TypeError);

  // Control decode completion to cover return/reselect races and failed loads.
  // Texture disposal events test actual cache ownership, not a mock counter in
  // the implementation. Preview maps stay resident while full maps are leased.
  const requests = [];
  THREE.TextureLoader.prototype.loadAsync = function(url) {
    const texture = new THREE.Texture();
    const request = {url,texture,disposed:0,settled:false};
    texture.addEventListener('dispose',() => request.disposed++);
    requests.push(request);
    if (url.includes('preview')) { request.settled = true; return Promise.resolve(texture); }
    return new Promise((resolve,reject) => {
      request.resolve = () => { request.settled = true; resolve(texture); };
      request.reject = () => { request.settled = true; reject(new Error('Simulated decode failure')); };
    });
  };
  const detailedFixture = (id, fullId = id) => fixture({id,type:'postcard',
    surfaces:{front:`detail/${fullId}-front-full.jpg`,back:`detail/${fullId}-back-full.jpg`},
    previewSurfaces:{front:`detail/${id}-front-preview.jpg`,back:`detail/${id}-back-preview.jpg`},
  });
  const pending = () => requests.filter(request => !request.settled);
  let invalidations = 0;
  const detailed = await createCard(detailedFixture('race'),{onInvalidate:() => invalidations++});
  const originalMaps = meshes(detailed)[0].material.slice(4).map(material => material.map);
  originalMaps.forEach(texture => { texture.anisotropy = 8; });
  assert.equal(detailed.detail,'preview');
  assert.equal(pending().length,0,'Collection does not eagerly request full maps.');
  const stalePromotion = detailed.setDetail('full');
  assert.equal(detailed.setDetail('full'),stalePromotion,'Repeated promotion shares one in-flight batch.');
  const staleRequests = [...pending()];
  assert.equal(staleRequests.length,2);
  await detailed.setDetail('preview');
  staleRequests.forEach(request => request.resolve());
  assert.equal(await stalePromotion,false);
  assert.equal(detailed.detail,'preview');
  assert.ok(staleRequests.every(request => request.disposed === 1),'Cancelled decodes dispose on arrival.');
  assert.deepEqual(meshes(detailed)[0].material.slice(4).map(material => material.map),originalMaps);
  assert.equal(invalidations,0,'Discarded requests do not wake idle rendering.');

  const promotion = detailed.setDetail('full');
  const firstFull = [...pending()];
  firstFull.forEach(request => request.resolve());
  assert.equal(await promotion,true);
  assert.equal(detailed.detail,'full');
  assert.equal(invalidations,1,'Completed texture swap wakes on-demand rendering.');
  assert.ok(meshes(detailed)[0].material.slice(4).every(material => material.map.name.includes('-full.jpg')));
  assert.ok(meshes(detailed)[0].material.slice(4).every(material => material.map.anisotropy === 8),'Deferred maps preserve the renderer-supported anisotropy.');
  await detailed.setDetail('preview');
  assert.equal(invalidations,2);
  assert.ok(firstFull.every(request => request.disposed === 1),'Return releases completed full textures.');
  assert.ok(requests.filter(request => request.url.includes('preview')).every(request => request.disposed === 0),'Preview textures remain resident.');

  const failed = detailed.setDetail('full');
  const failedRequests = [...pending()];
  const rejection = assert.rejects(failed,/decode failure/);
  failedRequests[0].reject(); failedRequests[1].resolve();
  await rejection;
  assert.equal(detailed.detail,'preview');
  assert.equal(invalidations,2,'Failed full decode preserves the readable preview without a false redraw.');
  assert.equal(failedRequests[1].disposed,1,'Successfully decoded map in a failed batch is released.');

  const old = detailed.setDetail('full'), oldRequests = [...pending()];
  await detailed.setDetail('preview');
  const replacement = detailed.setDetail('full'), replacementRequests = pending().filter(request => !oldRequests.includes(request));
  replacementRequests.forEach(request => request.resolve());
  await replacement;
  const replacementMaps = meshes(detailed)[0].material.slice(4).map(material => material.map);
  oldRequests.forEach(request => request.resolve());
  await old;
  assert.deepEqual(meshes(detailed)[0].material.slice(4).map(material => material.map),replacementMaps,'Late older decode cannot overwrite the new selection.');
  await detailed.setDetail('preview');

  const sharedA = await createCard(detailedFixture('shared-a','shared'));
  const sharedB = await createCard(detailedFixture('shared-b','shared'));
  const readyA = sharedA.setDetail('full'), readyB = sharedB.setDetail('full');
  const sharedRequests = [...pending()];
  assert.equal(sharedRequests.length,2,'Shared full URL is decoded once.');
  sharedRequests.forEach(request => request.resolve());
  await Promise.all([readyA,readyB]);
  await sharedA.setDetail('preview');
  assert.ok(sharedRequests.every(request => request.disposed === 0),'Another model retains a shared texture.');
  await sharedB.setDetail('preview');
  assert.ok(sharedRequests.every(request => request.disposed === 1),'Last owner releases shared full textures.');
  const foldedDetail = await createCard(fixture({id:'detail-folded',
    surfaces:Object.fromEntries(Object.keys(surfaces).map(name => [name,`detail/folded-${name}-full.jpg`])),
    previewSurfaces:Object.fromEntries(Object.keys(surfaces).map(name => [name,`detail/folded-${name}-preview.jpg`])),
  }));
  const foldedReady = foldedDetail.setDetail('full'), foldedRequests = [...pending()];
  assert.equal(foldedRequests.length,4);
  foldedRequests.forEach(request => request.resolve());
  await foldedReady;
  for (const [name, meshName, face] of [['front','front',4],['insideLeft','front',5],['insideRight','back',4],['back','back',5]]) {
    assert.ok(leaf(foldedDetail,meshName).material[face].map.name.includes(`folded-${name}-full.jpg`),`${name} retains its surface assignment after promotion`);
  }
  await foldedDetail.setDetail('preview');
  assert.ok(foldedRequests.every(request => request.disposed === 1));
  await assert.rejects(detailed.setDetail('unknown'),TypeError);
  console.log('Card mesh checks passed: postcard, both fold axes, fit/UV/crease geometry, exterior finish, and race-safe texture detail/disposal.');
} finally {
  THREE.TextureLoader.prototype.loadAsync = originalLoad;
}
