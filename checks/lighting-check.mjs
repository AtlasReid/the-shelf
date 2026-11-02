import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { createLighting } from '../lighting.js';
import { dateAtMinutes, getSolarState } from '../solar-time.js';

// Test the actual scene-lighting API and real Three.js objects without a
// renderer. Control the clock used by update() so transition checks have no
// wall-time tolerances, sleeps or duplicated lighting/easing equations.
const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
let clock = 0;
Object.defineProperty(globalThis, 'performance', {
  configurable:true, value:{now:() => clock},
});

const RAD = Math.PI / 180;
const SUNRISE = -.833;
const solar = (elevation, azimuth = Math.PI) => ({
  altitude:elevation * RAD, azimuth, isDay:elevation >= SUNRISE,
});
const luminance = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
const near = (actual, expected, message, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
};

function fixture() {
  const scene = new THREE.Scene();
  const lighting = createLighting(scene);
  const find = name => {
    const object = scene.getObjectByName(name);
    assert.ok(object, `Expected named scene object: ${name}`);
    return object;
  };
  const sun = find('Sunlight');
  const moon = find('Moonlight');
  const fill = find('Sky fill');
  const indoor = find('Indoor light');
  const plane = find('Ground plane');
  assert.ok(sun.isDirectionalLight && moon.isDirectionalLight);
  assert.ok(fill.isHemisphereLight && indoor.isSpotLight && plane.isMesh);
  const snapshot = () => ({
    wall:scene.background.toArray(), fog:scene.fog.color.toArray(),
    plane:plane.material.color.toArray(), sky:fill.color.toArray(),
    ground:fill.groundColor.toArray(), sunColor:sun.color.toArray(),
    sunPosition:sun.position.toArray(), moonPosition:moon.position.toArray(),
    indoorPosition:indoor.position.toArray(), indoorTarget:indoor.target.position.toArray(),
    fill:fill.intensity, sun:sun.intensity, moon:moon.intensity, indoor:indoor.intensity,
  });
  return {
    lighting, snapshot, indoor,
    sample(elevation, indoorEnabled = true, azimuth = Math.PI) {
      lighting.update(solar(elevation, azimuth), indoorEnabled, true);
      return snapshot();
    },
    sampleAt(value, indoorEnabled = false) {
      lighting.update(getSolarState(value), indoorEnabled, true);
      return snapshot();
    },
  };
}

function assertStateNear(actual, expected, label, omit = new Set()) {
  for (const key of Object.keys(expected)) {
    if (omit.has(key)) continue;
    const actualValues = Array.isArray(actual[key]) ? actual[key] : [actual[key]];
    const expectedValues = Array.isArray(expected[key]) ? expected[key] : [expected[key]];
    actualValues.forEach((value, index) => near(value, expectedValues[index], `${label}: ${key}[${index}]`));
  }
}

function normalizedValues(state) {
  return [
    ...state.wall, ...state.fog, ...state.plane, ...state.sky,
    ...state.ground, ...state.sunColor,
    ...state.sunPosition.map(value => value / 32),
    ...state.moonPosition.map(value => value / 32),
    ...state.indoorPosition.map(value => value / 32),
    ...state.indoorTarget.map(value => value / 32),
    state.fill / 3, state.sun / 4, state.moon / .4, state.indoor / 100,
  ];
}

let passed = 0;
function check(name, run) {
  run();
  passed++;
  console.log(`PASS ${name}`);
}

try {
  check('all physical solar elevations produce finite scene colours, positions and nonnegative light', () => {
    const f = fixture();
    for (let step = -360; step <= 360; step++) {
      const elevation = step / 4;
      const state = f.sample(elevation);
      assert.ok(normalizedValues(state).every(Number.isFinite), `finite state at ${elevation}°`);
      for (const key of ['wall','fog','plane','sky','ground','sunColor']) {
        assert.ok(state[key].every(value => value >= 0 && value <= 1), `${key} has valid colour at ${elevation}°`);
      }
      for (const key of ['fill','sun','moon','indoor']) assert.ok(state[key] >= 0, `${key} is nonnegative at ${elevation}°`);
      assert.deepEqual(state.wall, state.fog, 'fog and background match');
    }
  });

  check('lighting is continuous through sunset, palette stops and moon/lamp fade endpoints', () => {
    const f = fixture();
    const epsilon = .0001;
    for (const boundary of [-12,-9,-6,SUNRISE,0,1,5,7]) {
      const before = normalizedValues(f.sample(boundary - epsilon));
      const after = normalizedValues(f.sample(boundary + epsilon));
      const largestChange = Math.max(...before.map((value,index) => Math.abs(value-after[index])));
      assert.ok(largestChange < .0005, `no visible jump across ${boundary}° (normalized change ${largestChange})`);
    }
  });

  check('wall luminance and sky-fill intensity darken monotonically through dusk', () => {
    const f = fixture();
    let previous = f.sample(7);
    for (let step = 139; step >= -240; step--) {
      const elevation = step / 20;
      const current = f.sample(elevation);
      assert.ok(luminance(current.wall) <= luminance(previous.wall) + 1e-12, `wall does not brighten at ${elevation}°`);
      assert.ok(current.fill <= previous.fill + 1e-12, `ambient does not brighten at ${elevation}°`);
      previous = current;
    }
    const night = f.sample(-18), day = f.sample(20);
    assert.ok(luminance(day.wall) > luminance(night.wall) * 5, 'day and full night remain visually distinct');
    assert.ok(day.fill > night.fill && night.fill > 0, 'night retains a weaker outdoor ambient');
    assertStateNear(f.sample(-12), night, 'full-night palette is reached', new Set(['sunPosition','moonPosition','sunColor']));
    const fullDay = f.sample(7);
    near(luminance(fullDay.wall), luminance(day.wall), 'full-day wall palette is reached');
    near(fullDay.fill, day.fill, 'full-day ambient is reached');
  });

  check('moon/lamp endpoints and indoor-off preserve the independent outdoor night light', () => {
    const f = fixture();
    near(f.sample(-9).moon, .38, 'moon reaches the full-night level');
    near(f.sample(1).moon, 0, 'moon fades completely by daylight');
    near(f.sample(-9).indoor, 100, 'enabled lamp reaches the full-night level');
    near(f.sample(SUNRISE).indoor, 0, 'lamp fades before sunrise');
    for (const elevation of [-18,-9,-6,-3,SUNRISE,0,7,30]) {
      const on = f.sample(elevation, true), off = f.sample(elevation, false);
      assertStateNear(off, on, `indoor toggle leaves outdoor state at ${elevation}°`, new Set(['indoor']));
      near(off.indoor, 0, 'disabled indoor source is off');
    }
    const off = f.sample(-18, false);
    assert.ok(off.fill > 0 && off.moon > 0, 'lamp-off night retains cool ambient and moonlight');
    const dusk = f.sample(-6);
    assert.ok(dusk.indoor > 0 && dusk.indoor < 100, 'lamp rises gradually during dusk');
    assert.ok(dusk.moon > 0 && dusk.moon < .38, 'moon contribution rises gradually during dusk');
  });

  check('direct sun vanishes below sunrise and its direction crosses east to west', () => {
    const f = fixture();
    for (const elevation of [-90,-18,-12,-6,-1,SUNRISE]) near(f.sample(elevation).sun, 0, `no direct sun at ${elevation}°`);
    assert.ok(f.sample(20).sun > 0, 'daylight has a direct sun');
    const morning = f.sample(20, false, Math.PI / 2);
    const afternoon = f.sample(20, false, Math.PI * 1.5);
    assert.ok(morning.sunPosition[0] < 0 && afternoon.sunPosition[0] > 0, 'east is scene-left and west is scene-right');
    assert.ok(morning.sunPosition[1] > 0 && afternoon.sunPosition[1] > 0, 'day sun remains above the plane');
  });

  check('actual Newcastle night times move moonlight from evening east through midnight to morning west', () => {
    const f = fixture();
    const eveningDate = new Date('2026-10-30T12:00:00Z');
    const morningDate = new Date('2026-10-31T12:00:00Z');
    const evening = f.sampleAt(dateAtMinutes(18 * 60, eveningDate));
    const midnight = f.sampleAt(dateAtMinutes(1440, eveningDate));
    const morning = f.sampleAt(dateAtMinutes(5 * 60, morningDate));
    for (const state of [evening, midnight, morning]) {
      assert.ok(state.moon > 0 && state.sun === 0 && state.indoor === 0, 'moving moonlight is independent of sunlight and the lamp');
      assert.ok(state.moonPosition[1] > 0, 'night moon stays above the plane');
    }
    assert.ok(evening.moonPosition[0] < 0, 'evening moon rises on scene-left');
    assert.ok(morning.moonPosition[0] > 0, 'morning moon moves toward scene-right');
    assert.ok(midnight.moonPosition[1] > evening.moonPosition[1] && midnight.moonPosition[1] > morning.moonPosition[1], 'moon reaches a higher overnight position');
    for (const [first, second] of [[evening,midnight],[midnight,morning]]) {
      assert.ok(new THREE.Vector3(...first.moonPosition).distanceTo(new THREE.Vector3(...second.moonPosition)) > 1, 'separated night times produce different shadow directions');
    }
  });

  check('real sunset, sunrise and adjacent-date midnight retain continuous moon direction and light', () => {
    const f = fixture();
    const day = getSolarState(new Date('2026-10-30T12:00:00Z'));
    for (const event of [day.sunrise, day.sunset, dateAtMinutes(1440, day.date)]) {
      assert.ok(event instanceof Date, 'expected a real local crossing or midnight');
      const before = normalizedValues(f.sampleAt(new Date(event.getTime() - 1000)));
      const after = normalizedValues(f.sampleAt(new Date(event.getTime() + 1000)));
      const largestChange = Math.max(...before.map((value,index) => Math.abs(value-after[index])));
      assert.ok(largestChange < .0005, `no night-light jump across ${event.toISOString()} (normalized change ${largestChange})`);
    }
    const nextDay = new Date('2026-10-31T12:00:00Z');
    assertStateNear(f.sampleAt(dateAtMinutes(1440, day.date)), f.sampleAt(dateAtMinutes(0, nextDay)), '24:00 and next-day 00:00 are the same scene');
    const selectedTime = dateAtMinutes(21 * 60, day.date);
    assertStateNear(f.sampleAt(selectedTime, false), f.sampleAt(selectedTime, true), 'indoor toggle preserves actual-time moon direction', new Set(['indoor']));
  });

  check('650 ms transition starts without a jump and converges to the immediate target', () => {
    const f = fixture();
    clock = 1000;
    const day = f.sample(20), targetNight = f.sample(-18);
    f.sample(20);
    f.lighting.update(solar(-18), true);
    assertStateNear(f.snapshot(), day, 'update preserves the displayed start');
    assert.equal(f.lighting.step(clock), true);
    assertStateNear(f.snapshot(), day, 'first frame preserves the start');
    assert.equal(f.lighting.step(clock + 325), true);
    const middle = f.snapshot();
    assert.ok(luminance(middle.wall) < luminance(day.wall) && luminance(middle.wall) > luminance(targetNight.wall));
    assert.ok(middle.fill < day.fill && middle.fill > targetNight.fill);
    assert.ok(middle.indoor > day.indoor && middle.indoor < targetNight.indoor);
    const moonStart = new THREE.Vector3(...day.moonPosition);
    const moonEnd = new THREE.Vector3(...targetNight.moonPosition);
    const moonMiddle = new THREE.Vector3(...middle.moonPosition);
    assert.ok(moonStart.distanceTo(moonMiddle) > 0 && moonStart.distanceTo(moonMiddle) < moonStart.distanceTo(moonEnd), 'moon direction progresses between the displayed start and target');
    assert.equal(f.lighting.step(clock + 649), true, 'animation still active before 650 ms');
    assert.equal(f.lighting.step(clock + 650), false, 'animation signals settled at 650 ms');
    assertStateNear(f.snapshot(), targetNight, 'settled state matches the immediate target');
    assert.equal(f.lighting.step(clock + 1000), false, 'idle step requests no further frame');
    assertStateNear(f.snapshot(), targetNight, 'idle state is stable');
  });

  check('reversing a transition retains the displayed intermediate state before easing back', () => {
    const f = fixture();
    clock = 3000;
    const day = f.sample(20);
    f.lighting.update(solar(-18), true);
    clock += 200;
    f.lighting.step(clock);
    const displayed = f.snapshot();
    assert.ok(luminance(displayed.wall) < luminance(day.wall), 'first transition has visibly progressed');
    assert.notDeepEqual(displayed.moonPosition, day.moonPosition, 'moon direction has progressed before reversing');
    f.lighting.update(solar(20), false);
    assertStateNear(f.snapshot(), displayed, 'retargeting causes no immediate jump');
    f.lighting.step(clock);
    assertStateNear(f.snapshot(), displayed, 'retargeted first frame starts from displayed state');
    assert.equal(f.lighting.step(clock + 650), false);
    assertStateNear(f.snapshot(), day, 'reverse transition reaches daylight');
  });

  check('immediate updates cancel an active transition without stale later movement', () => {
    const f = fixture();
    clock = 5000;
    f.sample(20);
    f.lighting.update(solar(-18), true);
    clock += 200;
    f.lighting.step(clock);
    const immediateDay = f.sample(20, false);
    assert.equal(f.lighting.step(clock + 1000), false);
    assertStateNear(f.snapshot(), immediateDay, 'cancelled animation cannot overwrite immediate/reduced-motion state');
  });

  const viewCamera = () => {
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, .05, 160);
    camera.position.set(0, 5, 11);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld();
    return camera;
  };
  const positionOf = state => new THREE.Vector3(...state.indoorPosition);
  const targetOf = state => new THREE.Vector3(...state.indoorTarget);
  const indoorPoseKeys = new Set(['indoorPosition','indoorTarget']);

  check('inspection light aims at the picked object from the visible camera side and follows panning', () => {
    const f = fixture(), camera = viewCamera();
    f.sample(-18);
    const focus = new THREE.Vector3(0, 2, 7);
    f.lighting.followView(camera, focus, true);
    const first = f.snapshot();
    const offset = positionOf(first).sub(focus);
    const forwardFace = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    assert.ok(targetOf(first).distanceTo(focus) < 1e-10, 'beam is aimed at the actual picked-object centre');
    assert.ok(offset.clone().normalize().dot(forwardFace) > .5, 'lamp illuminates the camera-facing side rather than sitting behind the paper');
    assert.ok(offset.dot(right) > 0 && offset.dot(up) > 0, 'reading light retains shape from above and to the right');
    assert.ok(offset.length() > f.indoor.shadow.camera.near && offset.length() < f.indoor.shadow.camera.far, 'picked object lies within the spotlight shadow depth');
    const pan = new THREE.Vector3(3, -.7, 1.5);
    const pannedFocus = focus.clone().add(pan);
    f.lighting.followView(camera, pannedFocus, true);
    const panned = f.snapshot();
    assert.ok(targetOf(panned).distanceTo(pannedFocus) < 1e-10);
    assert.ok(positionOf(panned).sub(positionOf(first)).distanceTo(pan) < 1e-10, 'panning moves lamp and object together');
    near(positionOf(panned).distanceTo(pannedFocus), offset.length(), 'panning preserves the source distance');

    camera.position.set(-8, 4, 3);
    camera.lookAt(pannedFocus);
    camera.updateMatrixWorld();
    f.lighting.followView(camera, pannedFocus, true);
    const turnedOffset = positionOf(f.snapshot()).sub(pannedFocus);
    const turnedFace = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    assert.ok(turnedOffset.clone().normalize().dot(turnedFace) > .5, 'light stays on the visible side after camera orientation changes');
    near(turnedOffset.length(), offset.length(), 'camera turns preserve the source distance');
  });

  check('inspection light moves without a first-frame jump after idle and returns smoothly to the shelf', () => {
    const f = fixture(), camera = viewCamera();
    f.sample(-18);
    const home = f.snapshot();
    const focus = new THREE.Vector3(.5, 2, 7);
    const expected = fixture();
    expected.sample(-18);
    expected.lighting.followView(camera, focus, true);
    const destination = expected.snapshot();
    clock = 100_000;
    f.lighting.followView(camera, focus);
    assertStateNear(f.snapshot(), home, 'request preserves displayed shelf lighting');
    assert.equal(f.lighting.step(clock), true);
    assertStateNear(f.snapshot(), home, 'first frame after long idle preserves the start');
    clock += 160;
    assert.equal(f.lighting.step(clock), true);
    const intermediate = f.snapshot();
    assert.ok(positionOf(intermediate).distanceTo(positionOf(home)) > 0);
    assert.ok(positionOf(intermediate).distanceTo(positionOf(destination)) < positionOf(home).distanceTo(positionOf(destination)), 'lamp advances toward the picked object');
    assert.ok(targetOf(intermediate).distanceTo(focus) > 0 && targetOf(intermediate).distanceTo(focus) < targetOf(home).distanceTo(focus), 'beam aim also advances continuously');
    clock += 5000;
    assert.equal(f.lighting.step(clock), false, 'lamp settles without an idle animation loop');
    assertStateNear(f.snapshot(), destination, 'settled inspection pose');
    f.lighting.followView(camera, focus);
    assert.equal(f.lighting.step(clock + 16), false, 'unchanged focus requests no new frames');

    f.lighting.followView(camera, null);
    assertStateNear(f.snapshot(), destination, 'put-back request retains the displayed pose');
    assert.equal(f.lighting.step(clock), true);
    assertStateNear(f.snapshot(), destination, 'put-back first frame does not jump');
    clock += 160;
    assert.equal(f.lighting.step(clock), true);
    assert.ok(positionOf(f.snapshot()).distanceTo(positionOf(home)) < positionOf(destination).distanceTo(positionOf(home)), 'lamp moves back toward its shelf position');
    clock += 5000;
    assert.equal(f.lighting.step(clock), false);
    assertStateNear(f.snapshot(), home, 'return restores the shelf lamp and aim');
  });

  check('new selections and moving focus retarget from the displayed lamp pose', () => {
    const f = fixture(), camera = viewCamera();
    f.sample(-18);
    clock = 200_000;
    f.lighting.followView(camera, new THREE.Vector3(-2, 2, 6));
    f.lighting.step(clock);
    clock += 120;
    f.lighting.step(clock);
    const displayed = f.snapshot();
    const newestFocus = new THREE.Vector3(2, 3, 8);
    f.lighting.followView(camera, newestFocus);
    assertStateNear(f.snapshot(), displayed, 'Next/reselect retains the current source and aim');
    f.lighting.step(clock);
    assertStateNear(f.snapshot(), displayed, 'retargeted first frame retains the displayed pose');
    clock += 160;
    f.lighting.step(clock);
    assert.ok(targetOf(f.snapshot()).distanceTo(newestFocus) < targetOf(displayed).distanceTo(newestFocus), 'aim follows the newest moving object');
    clock += 5000;
    assert.equal(f.lighting.step(clock), false);
    assert.ok(targetOf(f.snapshot()).distanceTo(newestFocus) < 1e-10, 'newest object wins on settlement');
  });

  check('following a picked object preserves outdoor light and the indoor off/daylight behavior', () => {
    const f = fixture(), camera = viewCamera();
    const focus = new THREE.Vector3(0, 2, 7);
    for (const [elevation, enabled] of [[-18,false],[20,true],[-18,true]]) {
      const before = f.sample(elevation, enabled);
      f.lighting.followView(camera, focus, true);
      assertStateNear(f.snapshot(), before, 'focus changes only the indoor position and aim', indoorPoseKeys);
      if (!enabled || elevation > 0) near(f.snapshot().indoor, 0, 'following cannot turn an off/daytime lamp on');
      const pose = f.snapshot();
      f.sample(elevation, enabled);
      assertStateNear(f.snapshot(), pose, 'clock/intensity updates do not reset the view-following pose');
    }
  });

  check('immediate view following cancels pending movement without stale later motion', () => {
    const f = fixture(), camera = viewCamera();
    f.sample(-18);
    clock = 300_000;
    f.lighting.followView(camera, new THREE.Vector3(-1, 2, 6));
    f.lighting.step(clock);
    clock += 150;
    f.lighting.step(clock);
    const newestFocus = new THREE.Vector3(2, 1, 8);
    f.lighting.followView(camera, newestFocus, true);
    const immediate = f.snapshot();
    assert.ok(targetOf(immediate).distanceTo(newestFocus) < 1e-10, 'reduced motion applies the newest aim immediately');
    assert.equal(f.lighting.step(clock + 5000), false);
    assertStateNear(f.snapshot(), immediate, 'old movement cannot overwrite the immediate pose');
    f.lighting.followView(camera, null, true);
    assert.ok(targetOf(f.snapshot()).distanceTo(new THREE.Vector3(0, .3, 0)) < 1e-10, 'immediate return restores the shelf target');
    assert.equal(f.lighting.step(clock + 6000), false);
  });

  console.log(`Lighting checks passed (${passed} cases, actual Three.js lighting API).`);
} finally {
  if (performanceDescriptor) Object.defineProperty(globalThis, 'performance', performanceDescriptor);
  else delete globalThis.performance;
}
