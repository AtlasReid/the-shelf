import * as THREE from './vendor/three/three.module.js';

const radians = Math.PI / 180;
const clamp = THREE.MathUtils.clamp;
const smooth = (x, lo, hi) => { const t = clamp((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); };
const color = hex => new THREE.Color(hex);

function skyPosition(altitude, azimuth) {
  const aboveHorizon = Math.max(.015, altitude);
  const horizontal = 16 * Math.cos(aboveHorizon);
  // North is away from the camera; east is screen-left, west screen-right.
  return new THREE.Vector3(-Math.sin(azimuth) * horizontal,
    16 * Math.sin(aboveHorizon) + .7, -Math.cos(azimuth) * horizontal);
}

// Art-directed sky/room appearance, blended by solar elevation rather than a
// binary sunrise flag. The night endpoint preserves the existing night scene.
const ambience = [
  {elevation:-12,wall:'#121b27',plane:'#66758b',sky:'#9bafd3',ground:'#303e58',fill:.17},
  {elevation:-6,wall:'#283b57',plane:'#8c98a9',sky:'#9bb6df',ground:'#424b64',fill:.32},
  {elevation:0,wall:'#8f8589',plane:'#dedbd4',sky:'#d9dfef',ground:'#7c7c85',fill:1.05},
  {elevation:7,wall:'#f3f0e8',plane:'#e7e2d6',sky:'#fffdf6',ground:'#9b9687',fill:1.5},
].map(stop => ({...stop,...Object.fromEntries(['wall','plane','sky','ground'].map(key => [key,color(stop[key])]))}));

function sampleAmbience(elevation) {
  let lower = ambience[0], upper = ambience.at(-1);
  for (let i = 1; i < ambience.length; i++) {
    if (elevation <= ambience[i].elevation) { lower = ambience[i-1]; upper = ambience[i]; break; }
    lower = ambience[i];
  }
  const t = lower === upper ? 1 : smooth(elevation, lower.elevation, upper.elevation);
  const result = {fill:THREE.MathUtils.lerp(lower.fill, upper.fill, t)};
  for (const key of ['wall','plane','sky','ground']) result[key] = lower[key].clone().lerp(upper[key], t);
  return result;
}

// The sun follows its calculated direction. The illustrative moon travels the
// opposite night arc, rather than modelling a lunar ephemeris or phase.
// The warm room light follows inspection independently of clock/preview mode.
export function createLighting(scene,{motion = null} = {}) {
  const fill = new THREE.HemisphereLight('#fffdf6', '#9b9687', 1.65);
  const sun = new THREE.DirectionalLight('#fff4df', 3.1);
  fill.name = 'Sky fill';
  sun.name = 'Sunlight';
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {left:-12,right:12,top:12,bottom:-12,near:.1,far:44});
  sun.shadow.bias = -.00015;
  sun.shadow.normalBias = .008;
  sun.target.position.set(0, .7, 0);

  const moon = new THREE.DirectionalLight('#a6bfff', 0);
  moon.name = 'Moonlight';
  moon.target.position.set(0, .7, 0);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  Object.assign(moon.shadow.camera, {left:-12,right:12,top:12,bottom:-12,near:.1,far:44});
  moon.shadow.bias = -.00015;
  moon.shadow.normalBias = .008;
  const indoor = new THREE.SpotLight('#ffddb1', 0, 32, 1.04, .85, 2);
  const roomPosition = new THREE.Vector3(2, 6.5, 4);
  const roomTarget = new THREE.Vector3(0, .3, 0);
  indoor.name = 'Indoor light';
  indoor.position.copy(roomPosition);
  indoor.target.position.copy(roomTarget);
  indoor.castShadow = true;
  indoor.shadow.mapSize.set(1024, 1024);
  indoor.shadow.bias = -.00012;
  indoor.shadow.normalBias = .008;
  indoor.shadow.camera.near = .4;
  indoor.shadow.camera.far = 32;

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({color:'#e7e2d6',roughness:1,metalness:0}));
  plane.name = 'Ground plane';
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -.006;
  plane.receiveShadow = true;
  scene.background = color('#f3f0e8');
  scene.fog = new THREE.Fog('#f3f0e8', 20, 60);
  scene.add(fill, sun, sun.target, moon, moon.target, indoor, indoor.target, plane);

  let transition;
  let initialized = false;
  const followPosition = roomPosition.clone();
  const followTarget = roomTarget.clone();
  const viewOffset = new THREE.Vector3();
  let following = false;
  let followTime = 0;
  const capture = () => ({
    wall:scene.background.clone(), plane:plane.material.color.clone(), sky:fill.color.clone(), ground:fill.groundColor.clone(),
    sunColor:sun.color.clone(), sunPosition:sun.position.clone(), moonPosition:moon.position.clone(), fill:fill.intensity,
    sun:sun.intensity, moon:moon.intensity, indoor:indoor.intensity,
  });
  function apply(from, to, t) {
    for (const [object, property, key] of [[scene,'background','wall'],[plane.material,'color','plane'],[fill,'color','sky'],[fill,'groundColor','ground'],[sun,'color','sunColor']]) object[property].copy(from[key]).lerp(to[key], t);
    scene.fog.color.copy(scene.background);
    sun.position.copy(from.sunPosition).lerp(to.sunPosition, t);
    moon.position.copy(from.moonPosition).lerp(to.moonPosition, t);
    for (const [light,key] of [[fill,'fill'],[sun,'sun'],[moon,'moon'],[indoor,'indoor']]) light.intensity = THREE.MathUtils.lerp(from[key], to[key], t);
  }
  return {
    followView(camera, focus, immediate = false) {
      if (focus) {
        // A key light above/right of the view and in front of the paper. It
        // follows the object's centre, not its rotation, so either face reads.
        viewOffset.set(2, 3, 4).applyQuaternion(camera.quaternion);
        followPosition.copy(focus).add(viewOffset);
        followTarget.copy(focus);
      } else {
        followPosition.copy(roomPosition);
        followTarget.copy(roomTarget);
      }
      if (immediate) {
        indoor.position.copy(followPosition);
        indoor.target.position.copy(followTarget);
        following = false;
      } else if (!following && (indoor.position.distanceToSquared(followPosition) > 1e-6 || indoor.target.position.distanceToSquared(followTarget) > 1e-6)) {
        // Start from the displayed pose even after a long idle period. New
        // selections and moving cards retarget this same retained light.
        following = true;
        followTime = performance.now();
      }
    },
    update(solar, indoorEnabled, immediate = false) {
      const elevation = solar.altitude / radians;
      const sunPosition = skyPosition(solar.altitude, solar.azimuth);
      // This keeps moonlight moving east-to-west throughout each night and
      // continuous through midnight, with the existing twilight crossfade.
      const moonPosition = skyPosition(-solar.altitude, solar.azimuth + Math.PI);
      const warmth = smooth(elevation, 0, 18);
      const direct = smooth(elevation, -.833, 5);
      const target = {
        ...sampleAmbience(elevation),
        sunColor:color('#ffd0a1').lerp(color('#fff4df'), warmth), sunPosition, moonPosition,
        sun:(2.3 + Math.max(0, Math.sin(solar.altitude))) * direct,
        moon:.38 * (1 - smooth(elevation, -9, 1)),
        indoor:indoorEnabled ? 100 * (1 - smooth(elevation, -9, -.833)) : 0,
      };
      if (immediate || !initialized) { apply(target, target, 1); transition = null; }
      else transition = {from:capture(),to:target,began:performance.now(),timing:motion?.transition('lighting',650)};
      initialized = true;
    },
    step(now) {
      if (transition) {
        const t = clamp((now - transition.began) / (transition.timing?.duration ?? 650), 0, 1);
        const ease = transition.timing ? transition.timing.ease(t) : t * t * t * (t * (6 * t - 15) + 10);
        apply(transition.from, transition.to, ease);
        if (t === 1) transition = null;
      }
      if (following) {
        const alpha = 1 - Math.exp(-10 * Math.max(0, now - followTime) / (1000 * (motion?.get('lighting').scale ?? 1)));
        followTime = now;
        indoor.position.lerp(followPosition, alpha);
        indoor.target.position.lerp(followTarget, alpha);
        if (indoor.position.distanceToSquared(followPosition) < 1e-6 && indoor.target.position.distanceToSquared(followTarget) < 1e-6) {
          indoor.position.copy(followPosition);
          indoor.target.position.copy(followTarget);
          following = false;
        }
      }
      return Boolean(transition || following);
    },
  };
}
