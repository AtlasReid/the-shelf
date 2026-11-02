import * as THREE from './vendor/three/three.module.js';

const READING_LAYER = 1;
const PIXEL_BUDGET = 16 * 1024 * 1024;

// Keep the room inexpensive while rendering only the picked-up paper at 2×.
// The first pass retains the card's shadows but masks its colour/depth writes.
// The final pass draws its original geometry/materials over the room image.
export function createReadingRenderer({renderer, scene, camera, onModeChange = () => {}}) {
  const size = new THREE.Vector2();
  const clear = new THREE.Color();
  const halfFloat = Boolean(renderer.extensions?.has('EXT_color_buffer_float'));
  const room = new THREE.WebGLRenderTarget(1,1, {
    type:THREE.HalfFloatType, depthBuffer:true, stencilBuffer:false,
    minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
  });
  room.texture.name = 'Lower-resolution room';
  room.texture.colorSpace = THREE.LinearSRGBColorSpace;
  room.texture.generateMipmaps = false;
  const screen = new THREE.Scene();
  const screenCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,2);
  screenCamera.position.z = 1;
  const geometry = new THREE.PlaneGeometry(2,2);
  const material = new THREE.MeshBasicMaterial({
    map:room.texture, transparent:true, depthTest:false, depthWrite:false,
    toneMapped:true,
  });
  const quad = new THREE.Mesh(geometry,material);
  quad.frustumCulled = false;
  screen.add(quad);
  let lastMode = '', destroyed = false;
  let state = {mode:'collection',sceneScale:1,readingScale:1};

  function ratio(value,width,height) {
    const wanted = Number.isFinite(Number(value)) ? Number(value) : 1;
    const max = renderer.capabilities.maxTextureSize || 4096;
    return Math.max(.1,Math.min(Math.max(.5,wanted),2,max / width,max / height,
      Math.sqrt(PIXEL_BUDGET / (width * height))));
  }

  return {
    get state() { return {...state}; },
    render(selected = null,{sceneScale = 1,inspectionDetail = true} = {}) {
      if (destroyed) return;
      renderer.getSize(size);
      const width = Math.max(1,size.x), height = Math.max(1,size.y);
      const base = ratio(sceneScale,width,height);
      const sharp = selected && inspectionDetail ? ratio(2,width,height) : base;
      const selective = Boolean(selected && inspectionDetail && sharp > base && halfFloat);
      const output = selected && inspectionDetail ? Math.max(base,sharp) : base;
      state = {mode:selective ? 'selected-card' : selected ? 'inspection' : 'collection',
        sceneScale:selective ? base : output,readingScale:output};
      const key = `${width}:${height}:${base}:${output}:${selected?.uuid ?? ''}:${selective}`;
      if (key !== lastMode) { lastMode = key; onModeChange(state); }
      if (renderer.getPixelRatio() !== output) renderer.setPixelRatio(output);
      if (!selective) { renderer.render(scene,camera); return; }

      const targetWidth = Math.max(1,Math.round(width * base));
      const targetHeight = Math.max(1,Math.round(height * base));
      if (room.width !== targetWidth || room.height !== targetHeight) room.setSize(targetWidth,targetHeight);
      const target = renderer.getRenderTarget();
      const background = scene.background;
      const autoClear = renderer.autoClear;
      const shadows = renderer.shadowMap.autoUpdate;
      const clearAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      const cameraMask = camera.layers.mask;
      const objects = [], lights = [], materials = new Map();
      selected.traverse(object => {
        if (!object.isMesh) return;
        objects.push([object,object.layers.mask]);
        object.layers.set(READING_LAYER);
        for (const item of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!materials.has(item)) materials.set(item,{colorWrite:item.colorWrite,depthWrite:item.depthWrite});
          item.colorWrite = false; item.depthWrite = false;
        }
      });
      scene.traverse(object => {
        if (!object.isLight) return;
        lights.push([object,object.layers.mask]);
        object.layers.enable(READING_LAYER);
      });
      try {
        camera.layers.mask = cameraMask | (1 << READING_LAYER);
        scene.background = null;
        renderer.autoClear = true;
        renderer.setClearColor(0x000000,0);
        renderer.setRenderTarget(room);
        renderer.render(scene,camera);

        // The room target is linear HDR, so this pass applies the same display
        // transform as the paper. Its transparent sky keeps the original clear
        // colour, avoiding a tone-mapped seam against the HTML background.
        renderer.setRenderTarget(target);
        screen.background = background;
        renderer.render(screen,screenCamera);
        for (const [item,values] of materials) Object.assign(item,values);
        camera.layers.set(READING_LAYER);
        renderer.autoClear = false;
        renderer.shadowMap.autoUpdate = false;
        renderer.clearDepth();
        renderer.render(scene,camera);
      } finally {
        for (const [item,values] of materials) Object.assign(item,values);
        objects.forEach(([object,mask]) => { object.layers.mask = mask; });
        lights.forEach(([object,mask]) => { object.layers.mask = mask; });
        camera.layers.mask = cameraMask;
        scene.background = background;
        screen.background = null;
        renderer.autoClear = autoClear;
        renderer.shadowMap.autoUpdate = shadows;
        renderer.setRenderTarget(target);
        renderer.setClearColor(clear,clearAlpha);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      room.dispose(); geometry.dispose(); material.dispose();
    },
  };
}
