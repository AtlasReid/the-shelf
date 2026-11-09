import * as THREE from './vendor/three/three.module.js';
import { createPaperMaterial } from './paper-material.js';

// The image records are shared with the preserved CSS study. A model is created
// once and can then move between the plane and the inspection position.
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
const SURFACES = ['front', 'insideLeft', 'insideRight', 'back'];
const PAPER_THICKNESS = 0.004;
const INNER_GAP = 0.0004;

function acquireSurface(url, {data = false} = {}) {
  const key = data ? `${url.href}#material-data` : url.href;
  if (!textureCache.has(key)) {
    const resource = {key, references:0, texture:null, pending:null};
    resource.pending = textureLoader.loadAsync(url.href).then(texture => {
      texture.name = url.href;
      texture.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      resource.texture = texture;
      // Returning to the shelf can release a request before decoding finishes.
      // That stale request must never retain an unowned full-resolution map.
      if (!resource.references) texture.dispose();
      return texture;
    }).catch(error => {
      if (textureCache.get(key) === resource) textureCache.delete(key);
      throw error;
    });
    textureCache.set(key, resource);
  }
  const resource = textureCache.get(key);
  resource.references++;
  return resource;
}

function releaseSurface(resource) {
  if (--resource.references > 0) return;
  if (textureCache.get(resource.key) === resource) textureCache.delete(resource.key);
  resource.texture?.dispose();
}

function detailControl({card, base, surfaceNames, previewResources, materials, onInvalidate}) {
  const previewMaps = previewResources.map(resource => resource.texture);
  const fullURLs = surfaceNames.map(surface => new URL(card.surfaces[surface],base));
  const separateDetail = fullURLs.some((url,index) => url.href !== previewResources[index].key);
  let detail = separateDetail ? 'preview' : 'full';
  let fullBatch = null;
  const swap = textures => {
    let changed = false;
    surfaceNames.forEach((surface,index) => {
      const material = materials[surface];
      if (material.map === textures[index]) return;
      // The scene assigns its supported anisotropy to the initial preview.
      // Preserve that choice when a deferred full map replaces it.
      textures[index].anisotropy = Math.max(textures[index].anisotropy, material.map?.anisotropy ?? 1);
      textures[index].needsUpdate = true;
      material.map = textures[index];
      material.needsUpdate = true;
      changed = true;
    });
    if (changed) onInvalidate();
    return changed;
  };
  const release = batch => {
    if (batch.released) return;
    batch.released = true;
    batch.resources.forEach(releaseSurface);
  };
  return {
    get detail() { return detail; },
    setDetail(value) {
      if (value !== 'full' && value !== 'preview') return Promise.reject(new TypeError('Card detail must be full or preview.'));
      if (!separateDetail) return Promise.resolve(false);
      if (value === 'preview') {
        // Restore resident small maps before disposing maps currently used by
        // the meshes. The stable objects, dimensions and pose never change.
        const changed = swap(previewMaps);
        detail = 'preview';
        if (fullBatch) { release(fullBatch); fullBatch = null; }
        return Promise.resolve(changed);
      }
      if (fullBatch) return fullBatch.ready;
      const batch = {resources:fullURLs.map(acquireSurface), released:false, ready:null};
      fullBatch = batch;
      batch.ready = Promise.all(batch.resources.map(resource => resource.pending)).then(textures => {
        // A return/reselect can finish an older request after a new one. Only
        // the current retained batch may replace the displayed preview maps.
        if (fullBatch !== batch || batch.released) return false;
        swap(textures);
        detail = 'full';
        return true;
      }, error => {
        const current = fullBatch === batch;
        release(batch);
        if (current) fullBatch = null;
        // A cancelled request has no active caller or error UI to update.
        if (!current) return false;
        throw error;
      });
      return batch.ready;
    },
  };
}

function createCrease(width, height, material, cardId) {
  // A constant-thickness annular sector joins the two paper solids. At 0°
  // opening this is a rounded U-fold; at 180° it flattens into their shared edge.
  // Separate face vertices preserve smooth radial normals and hard top/end caps.
  const segments = 32;
  const quadCount = segments * 4 + 2;
  const positions = new Float32Array(quadCount * 12);
  const normals = new Float32Array(quadCount * 12);
  const uvs = new Float32Array(quadCount * 8);
  const indices = new Uint16Array(quadCount * 6);
  for (let quad = 0; quad < quadCount; quad++) {
    const vertex = quad * 4;
    indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], quad * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Continuous rounded paper crease';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { cardId, leaf: 'crease', isCardCrease: true };

  const radius = (PAPER_THICKNESS + INNER_GAP) / 2;
  const innerRadius = radius - PAPER_THICKNESS / 2;
  const outerRadius = radius + PAPER_THICKNESS / 2;
  const point = (r, angle, y) => [-r * Math.sin(angle), y, -r * Math.cos(angle)];
  const radial = (angle, sign) => [-Math.sin(angle) * sign, 0, -Math.cos(angle) * sign];
  let quadIndex = 0;

  function writeQuad(points, faceNormals, faceUVs) {
    const [a, b, c] = points;
    const ab = b.map((value, axis) => value - a[axis]);
    const ac = c.map((value, axis) => value - a[axis]);
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const dot = cross.reduce((sum, value, axis) => sum + value * faceNormals[0][axis], 0);
    const order = dot < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3];
    order.forEach((source, index) => {
      const vertex = quadIndex * 4 + index;
      positions.set(points[source], vertex * 3);
      normals.set(faceNormals[source], vertex * 3);
      uvs.set(faceUVs[source], vertex * 2);
    });
    quadIndex++;
  }

  function update(bendAngle) {
    quadIndex = 0;
    // Flat still updates to degenerate edge geometry, keeping bounding-box
    // queries correct even when they include invisible descendants.
    mesh.visible = bendAngle > 1e-7;
    for (let segment = 0; segment < segments; segment++) {
      const start = bendAngle * segment / segments;
      const end = bendAngle * (segment + 1) / segments;
      for (const [r, sign] of [[outerRadius, 1], [innerRadius, -1]]) {
        writeQuad(
          [point(r, start, 0), point(r, start, height), point(r, end, height), point(r, end, 0)],
          [radial(start, sign), radial(start, sign), radial(end, sign), radial(end, sign)],
          [[r * start / width, 0], [r * start / width, 1], [r * end / width, 1], [r * end / width, 0]],
        );
      }
      for (const [y, normal] of [[height, [0, 1, 0]], [0, [0, -1, 0]]]) {
        const points = [point(outerRadius, start, y), point(outerRadius, end, y), point(innerRadius, end, y), point(innerRadius, start, y)];
        writeQuad(points, [normal, normal, normal, normal], points.map(p => [p[0] / width, p[2] / height]));
      }
    }
    for (const [angle, normal] of [[0, [1, 0, 0]], [bendAngle, [-Math.cos(bendAngle), 0, Math.sin(bendAngle)]]]) {
      writeQuad(
        [point(outerRadius, angle, 0), point(innerRadius, angle, 0), point(innerRadius, angle, height), point(outerRadius, angle, height)],
        [normal, normal, normal, normal],
        [[PAPER_THICKNESS / width, 0], [0, 0], [0, 1], [PAPER_THICKNESS / width, 1]],
      );
    }
    for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return { mesh, update, innerRadius, outerRadius, radius };
}

/**
 * Create an upright folded card or a single two-sided postcard.
 *
 * width/height are single-leaf world dimensions (record dimensions / 100).
 * group is the stable interaction root. Its nominal centre is (0,height/2,0).
 * Horizontal folds unfold around that same centre, rather than making the
 * inspection pivot travel as their total vertical extent changes.
 * A 0-degree opening shows the front cover towards +Z; 180 shows both insides.
 * The front leaf follows the end of a rounded physical crease while rotating.
 * The stable crease geometry updates its existing buffers; model objects,
 * materials and textures are reused. Printed surfaces remain unchanged box
 * faces. The narrow air space between closed leaves ends at the solid U-fold.
 */
export async function createCard(card, {
  assetBase = new URL('./compatibility/', import.meta.url),
  onInvalidate = () => {},
} = {}) {
  const physicalWidth = Number(card?.width) / 100;
  const physicalHeight = Number(card?.height) / 100;
  if (!Number.isFinite(physicalWidth) || !Number.isFinite(physicalHeight) || physicalWidth <= 0 || physicalHeight <= 0) {
    throw new RangeError('Card width and height must be positive finite numbers.');
  }
  const postcard = card.type === 'postcard';
  const horizontal = !postcard && card.foldAxis === 'horizontal';
  const surfaceNames = postcard ? ['front', 'back'] : SURFACES;
  if (!surfaceNames.every(surface => typeof card?.surfaces?.[surface] === 'string')) {
    throw new TypeError(postcard ? 'A postcard needs front and back image URLs.' : 'A folded card needs front, insideLeft, insideRight and back image URLs.');
  }
  const base = assetBase instanceof URL ? assetBase : new URL(assetBase, import.meta.url);
  const finishEntries = Object.entries(card.finishMaps ?? {});
  if (finishEntries.some(([surface,path]) => !surfaceNames.includes(surface) || typeof path !== 'string')) {
    throw new TypeError('Selective finish maps must reference this card’s printed surfaces.');
  }
  const previewResources = surfaceNames.map(surface => acquireSurface(new URL(card.previewSurfaces?.[surface] ?? card.surfaces[surface], base)));
  const finishResources = finishEntries.map(([,path]) => acquireSurface(new URL(path,base), {data:true}));
  let textures;
  try { textures = await Promise.all([...previewResources,...finishResources].map(resource => resource.pending)); }
  catch (error) { [...previewResources,...finishResources].forEach(releaseSurface); throw error; }
  const maps = Object.fromEntries(surfaceNames.map((surface, index) => [surface, textures[index]]));
  const finishMaps = Object.fromEntries(finishEntries.map(([surface],index) => [surface,finishResources[index].texture]));
  const metallic = card.finish === 'metallic-outside';
  const printedPaper = (surface, width, height) => createPaperMaterial({
    map: maps[surface], width, height,
    metallic: metallic && ['front','back'].includes(surface),
    foilMap: finishMaps[surface],
    metallicInk: card.finish === 'gold-metallic-ink',
  });

  const group = new THREE.Group();
  group.name = `${card.id || 'card'} — interaction root`;
  group.userData = {
    cardId: String(card.id || ''),
    cardTitle: String(card.title || ''),
    leafWidth: physicalWidth,
    leafHeight: physicalHeight,
    type: postcard ? 'postcard' : 'folded',
    foldAxis: postcard ? null : horizontal ? 'horizontal' : 'vertical',
    canFold: !postcard,
    isCard: true,
  };

  if (postcard) {
    const geometry = new THREE.BoxGeometry(physicalWidth, physicalHeight, PAPER_THICKNESS);
    geometry.translate(0, physicalHeight / 2, 0);
    const edge = createPaperMaterial({ width:physicalWidth, height:physicalHeight, color:'#f6f2e8', edge:true });
    const sheet = new THREE.Mesh(geometry, [edge, edge, edge, edge,
      printedPaper('front', physicalWidth, physicalHeight),
      printedPaper('back', physicalWidth, physicalHeight),
    ]);
    sheet.name = 'Single two-sided postcard';
    sheet.castShadow = sheet.receiveShadow = true;
    sheet.userData = {cardId:group.userData.cardId, leaf:'postcard', isCardLeaf:true};
    group.add(sheet);
    group.userData.opening = 0;
    const detail = detailControl({card, base, surfaceNames, previewResources, onInvalidate,
      materials:{front:sheet.material[4],back:sheet.material[5]}});
    return {
      group, width:physicalWidth, height:physicalHeight, canFold:false, foldAxis:null,
      setOpening() { return 0; },
      get opening() { return 0; },
      setDetail:detail.setDetail,
      get detail() { return detail.detail; },
      boundsForOpening() { return {width:physicalWidth, height:physicalHeight, centreY:physicalHeight / 2}; },
    };
  }

  // The same connected crease builds both fold directions. A horizontal card
  // mounts the hinge at the top by rotating the complete local book -90° in Z.
  const width = horizontal ? physicalHeight : physicalWidth;
  const height = horizontal ? physicalWidth : physicalHeight;
  const book = new THREE.Group();
  book.name = 'Opening-centred book';
  book.userData.cardId = group.userData.cardId;
  if (horizontal) {
    const mount = new THREE.Group();
    mount.name = 'Top-fold orientation';
    mount.rotation.z = -Math.PI / 2;
    mount.position.set(-physicalWidth / 2, physicalHeight / 2, 0);
    mount.add(book);
    group.add(mount);
  } else group.add(book);

  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z. Its opposing
  // face UVs read correctly from each outside viewing direction.
  const geometry = new THREE.BoxGeometry(width, height, PAPER_THICKNESS);
  geometry.translate(width / 2, height / 2, 0);
  // Snap the spine to exact local x=0 after Float32 translation, rather than
  // inheriting a tiny width-dependent rounding offset at the connected edge.
  const leafPositions = geometry.getAttribute('position');
  for (let index = 0; index < leafPositions.count; index++) {
    leafPositions.setX(index, leafPositions.getX(index) < width / 2 ? 0 : width);
    leafPositions.setY(index, leafPositions.getY(index) < height / 2 ? 0 : height);
  }
  leafPositions.needsUpdate = true;
  const backGeometry = horizontal ? geometry.clone() : geometry;
  if (horizontal) {
    // Each supplied image is upright in its own reading orientation. Rotate UVs
    // instead of rotating scan pixels at runtime. The back exterior faces the
    // opposite viewing direction, so its correction has the opposite sign.
    for (const [leafGeometry, isBack] of [[geometry, false], [backGeometry, true]]) {
      const uv = leafGeometry.getAttribute('uv');
      for (let face = 4; face <= 5; face++) {
        for (let vertex = face * 4; vertex < face * 4 + 4; vertex++) {
          const u = uv.getX(vertex), v = uv.getY(vertex);
          if (isBack && face === 5) uv.setXY(vertex, 1 - v, u);
          else uv.setXY(vertex, v, 1 - u);
        }
      }
      uv.needsUpdate = true;
    }
  }
  const edgePaper = createPaperMaterial({ width, height, color: '#f6f2e8', edge: true });
  const edges = [edgePaper, edgePaper, edgePaper, edgePaper];
  const backLeaf = new THREE.Mesh(backGeometry, [
    ...edges, printedPaper('insideRight', width, height), printedPaper('back', width, height),
  ]);
  const frontLeaf = new THREE.Mesh(geometry, [
    ...edges, printedPaper('front', width, height), printedPaper('insideLeft', width, height),
  ]);
  const hingeOffset = (PAPER_THICKNESS + INNER_GAP) / 2;
  backLeaf.name = 'Back leaf';
  frontLeaf.name = 'Front hinged leaf';
  backLeaf.position.z = -hingeOffset;
  frontLeaf.position.z = hingeOffset;
  for (const [leaf, name] of [[backLeaf, 'back'], [frontLeaf, 'front']]) {
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    leaf.userData = { cardId: group.userData.cardId, leaf: name, isCardLeaf: true };
    book.add(leaf);
  }
  const crease = createCrease(width, height, edgePaper, group.userData.cardId);
  book.add(crease.mesh);

  function localBounds(value) {
    const angle = THREE.MathUtils.degToRad(value);
    const cosine = Math.cos(angle), sine = Math.max(0, Math.sin(angle));
    const halfThickness = PAPER_THICKNESS / 2;
    const frontX = -hingeOffset * sine, frontZ = hingeOffset * cosine;
    const minX = Math.min(0, frontX + Math.min(0, width * cosine) - halfThickness * sine,
      -crease.outerRadius * (angle <= Math.PI / 2 ? 1 : sine));
    const maxX = Math.max(width, frontX + Math.max(0, width * cosine) + halfThickness * sine);
    const minZ = Math.min(-hingeOffset - halfThickness, frontZ - halfThickness * Math.abs(cosine));
    const maxZ = Math.max(-hingeOffset + halfThickness, frontZ + width * sine + halfThickness * Math.abs(cosine));
    return {minX, maxX, minZ, maxZ};
  }

  let opening = 0;
  let creaseInitialized = false;
  function setOpening(value) {
    const numeric = Number(value);
    const nextOpening = Number.isFinite(numeric) ? THREE.MathUtils.clamp(numeric, 0, 180) : opening;
    if (creaseInitialized && nextOpening === opening) return opening;
    opening = nextOpening;
    const angle = THREE.MathUtils.degToRad(opening);
    const cosine = Math.cos(angle);
    const sine = Math.max(0, Math.sin(angle));
    frontLeaf.rotation.y = -angle;
    frontLeaf.position.set(-hingeOffset * sine, 0, hingeOffset * cosine);
    crease.update(Math.PI - angle);

    // Compute local bounds analytically, so recentering remains correct while
    // the caller also translates, rotates or scales the interaction root.
    const {minX, maxX, minZ, maxZ} = localBounds(opening);
    book.position.set(-(minX + maxX) / 2, 0, -(minZ + maxZ) / 2);
    group.userData.opening = opening;
    creaseInitialized = true;
    return opening;
  }

  setOpening(22);
  const detail = detailControl({card, base, surfaceNames, previewResources, onInvalidate,
    materials:{front:frontLeaf.material[4],insideLeft:frontLeaf.material[5],insideRight:backLeaf.material[4],back:backLeaf.material[5]}});
  return {
    group,
    width:physicalWidth,
    height:physicalHeight,
    canFold:true,
    foldAxis:horizontal ? 'horizontal' : 'vertical',
    setOpening,
    get opening() { return opening; },
    setDetail:detail.setDetail,
    get detail() { return detail.detail; },
    boundsForOpening(value = opening) {
      const number = Number(value);
      const {minX,maxX} = localBounds(Number.isFinite(number) ? THREE.MathUtils.clamp(number, 0, 180) : opening);
      return {
        width:horizontal ? physicalWidth : maxX - minX,
        height:horizontal ? maxX - minX : physicalHeight,
        centreY:physicalHeight / 2,
      };
    },
  };
}
