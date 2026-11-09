import * as THREE from './vendor/three/three.module.js';

// Material detail only: the four scanned/illustrative colour images stay intact.
// A repeatable height field supplies fine pulp and short fibres as surface normals.
const SIZE = 256;
const TILE_WORLD_SIZE = .28;
const sizeCache = new Map();

function randomAt(x, y, salt = 0) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ salt;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x, y, cellWidth, cellHeight, salt) {
  const gx = x / cellWidth, gy = y / cellHeight;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = gx - ix, fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const columns = SIZE / cellWidth, rows = SIZE / cellHeight;
  const at = (cx, cy) => randomAt(cx % columns, cy % rows, salt);
  const top = THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), sx);
  const bottom = THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), sx);
  return THREE.MathUtils.lerp(top, bottom, sy) - .5;
}

function dataMap(bytes, name) {
  const texture = new THREE.DataTexture(bytes, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = name;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const heights = new Uint8Array(SIZE * SIZE * 4);
const roughness = new Uint8Array(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const fine = randomAt(x, y, 1637) - .5;
    const pulp = smoothNoise(x, y, 8, 8, 7121);
    const fibres = smoothNoise(x, y, 4, 32, 1109);
    const grain = fine * .48 + pulp * .34 + fibres * .18;
    const height = Math.round(128 + grain * 72);
    const matte = Math.round(246 + pulp * 12 + fine * 6);
    const offset = (y * SIZE + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      heights[offset + channel] = height;
      roughness[offset + channel] = matte;
    }
    heights[offset + 3] = roughness[offset + 3] = 255;
  }
}
const normals = new Uint8Array(SIZE * SIZE * 4);
const heightAt = (x, y) => heights[(((y + SIZE) % SIZE) * SIZE + (x + SIZE) % SIZE) * 4] / 255;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * 4;
    const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * 4;
    const length = Math.hypot(dx, dy, 1);
    const offset = (y * SIZE + x) * 4;
    normals[offset] = Math.round((-dx / length * .5 + .5) * 255);
    normals[offset + 1] = Math.round((-dy / length * .5 + .5) * 255);
    normals[offset + 2] = Math.round((1 / length * .5 + .5) * 255);
    normals[offset + 3] = 255;
  }
}
const baseNormal = dataMap(normals, 'Fine paper pulp and fibres — surface normals');
const baseRoughness = dataMap(roughness, 'Fine paper pulp — matte roughness');

function mapsForSize(width, height) {
  const key = `${width}:${height}`;
  if (!sizeCache.has(key)) {
    const normalMap = baseNormal.clone();
    const roughnessMap = baseRoughness.clone();
    for (const texture of [normalMap, roughnessMap]) {
      // Keep fibres the same physical size on square, tall and landscape cards.
      texture.repeat.set(width / TILE_WORLD_SIZE, height / TILE_WORLD_SIZE);
      texture.needsUpdate = true;
    }
    sizeCache.set(key, {normalMap, roughnessMap});
  }
  return sizeCache.get(key);
}

export function createPaperMaterial({map = null, width = 1, height = 1, color = 0xffffff, edge = false, metallic = false, foilMap = null, metallicInk = false} = {}) {
  const {normalMap, roughnessMap} = mapsForSize(width, height);
  const ink = Boolean(foilMap && metallicInk);
  const material = new THREE.MeshStandardMaterial({
    name: edge ? 'Textured uncoated paper edges and crease' : ink ? 'Paper with selective gold metallic handwriting' : foilMap ? 'Printed paper with selective gold foil' : metallic ? 'Metallic printed exterior with fine paper grain' : 'Printed paper with subtle pulp grain',
    color,
    map,
    normalMap,
    normalScale: new THREE.Vector2(edge ? .08 : ink ? .12 : metallic ? .07 : .16, edge ? .08 : ink ? .12 : metallic ? .07 : .16),
    roughness: metallic ? .34 : .98,
    // The selective finish map uses linear green for roughness and blue for
    // metalness. Its white roughness/black metalness background stays matte.
    roughnessMap: foilMap ?? roughnessMap,
    // A partial metallic response preserves the photographed print in shade,
    // while direct sunlight or the indoor lamp produces a moving foil sheen.
    // This is an appearance approximation from one scan, not a measured BRDF.
    metalness: ink ? .30 : foilMap ? .34 : metallic ? .42 : 0,
    metalnessMap: foilMap,
    side: THREE.FrontSide,
  });
  material.userData.paperGrain = {tileWorldSize:TILE_WORLD_SIZE,source:'procedural pulp and fibres'};
  material.userData.finish = ink ? 'selective-gold-metallic-ink' : foilMap ? 'selective-gold-foil' : metallic ? 'metallic-scan-approximation' : 'matte-paper';
  return material;
}
