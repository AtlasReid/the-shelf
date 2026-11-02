import assert from 'node:assert/strict';
import {createGroundMotion} from '../ground-motion.js';

let passed = 0;
function check(name, run) {
  run();
  passed++;
  console.log(`PASS ${name}`);
}
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const gesture = (motion, x = .5, z = 0) => {
  motion.begin(0);
  motion.move(x, z, 60);
  motion.release(60);
};

check('release carries momentum, softly overshoots and settles exactly in 3–5 seconds', () => {
  const motion = createGroundMotion();
  gesture(motion);
  const released = motion.position.x;
  assert.ok(motion.velocity.x > 0);
  assert.equal(motion.held, false);
  let peak = released, lowest = 0, settledAt = null;
  for (let frame = 1; frame <= 720; frame++) {
    const active = motion.step(60 + frame * 1000 / 120);
    peak = Math.max(peak, motion.position.x);
    lowest = Math.min(lowest, motion.position.x);
    if (!active) { settledAt = frame / 120; break; }
  }
  assert.ok(peak > released + .1, 'the camera initially coasts in the release direction');
  assert.ok(lowest < 0 && lowest > -.01, 'the return has only a tiny overshoot');
  assert.ok(settledAt >= 3 && settledAt <= 5);
  assert.deepEqual(motion.position, {x:0, z:0});
  assert.deepEqual(motion.velocity, {x:0, z:0});
  assert.equal(motion.moving, false);
  assert.equal(motion.step(100_000), false, 'settled motion does not keep requesting frames');
});

check('30/60/120 Hz rendering follows the same two-axis trajectory', () => {
  const sample = fps => {
    const motion = createGroundMotion();
    gesture(motion, .45, -.35);
    const samples = [];
    for (let frame = 1; frame <= fps * 5; frame++) {
      motion.step(60 + frame * 1000 / fps);
      if (frame % (fps / 2) === 0) samples.push({...motion.position, ...{vx:motion.velocity.x, vz:motion.velocity.z}});
    }
    return samples;
  };
  const reference = sample(120);
  for (const fps of [30, 60]) sample(fps).forEach((point, index) => {
    for (const key of ['x', 'z', 'vx', 'vz']) near(point[key], reference[index][key]);
  });
});

check('resistance and autonomous momentum stay inside finite custom bounds', () => {
  const motion = createGroundMotion({limitX:.3, limitZ:.4});
  motion.begin(0);
  motion.move(Number.MAX_VALUE, -Number.MAX_VALUE, 40);
  const bounded = () => {
    assert.ok(Number.isFinite(motion.position.x) && Number.isFinite(motion.position.z));
    assert.ok(Number.isFinite(motion.velocity.x) && Number.isFinite(motion.velocity.z));
    assert.ok(Math.abs(motion.position.x) <= .3);
    assert.ok(Math.abs(motion.position.z) <= .4);
  };
  bounded();
  motion.release(40);
  for (let frame = 1; frame <= 600; frame++) { motion.step(40 + frame * 1000 / 120); bounded(); }
  assert.deepEqual(motion.position, {x:0, z:0});
  motion.begin(6000);
  motion.move(.2, .3, 6010);
  motion.release(6010);
  assert.equal(motion.step(1e100), false, 'a suspended frame gap settles instead of destabilising');
  assert.deepEqual(motion.position, {x:0, z:0});
});

check('stationary release and pointer cancellation discard stale fling velocity', () => {
  for (const cancelled of [false, true]) {
    const motion = createGroundMotion();
    motion.begin(0);
    motion.move(.5, 0, 60);
    assert.ok(motion.velocity.x > 0);
    const releaseAt = cancelled ? 60 : 200;
    motion.release(releaseAt, {cancelled});
    assert.deepEqual(motion.velocity, {x:0, z:0});
    const before = motion.position.x;
    motion.step(releaseAt + 30);
    assert.ok(motion.position.x < before, 'without a recent fling, spring return starts inward');
  }
});

check('held and paused positions do not drift; inspection resume returns without a fling', () => {
  const motion = createGroundMotion();
  motion.begin(0);
  motion.move(.4, -.2, 50);
  const held = motion.position;
  assert.equal(motion.step(1000), false);
  assert.deepEqual(motion.position, held);
  motion.pause(1000);
  assert.equal(motion.held, false);
  assert.equal(motion.moving, false);
  assert.deepEqual(motion.velocity, {x:0, z:0});
  assert.equal(motion.step(20_000), false);
  assert.deepEqual(motion.position, held);
  motion.resume(20_000);
  assert.equal(motion.moving, true);
  assert.deepEqual(motion.velocity, {x:0, z:0});
  motion.step(20_100);
  assert.ok(motion.position.x < held.x && motion.position.z > held.z);
  motion.step(30_000);
  assert.deepEqual(motion.position, {x:0, z:0});
});

check('re-grabbing a moving offset has no jump or repeated nonlinear compression', () => {
  const motion = createGroundMotion();
  gesture(motion, .5, -.2);
  motion.step(160);
  const retained = motion.position;
  motion.begin(160);
  assert.equal(motion.held, true);
  assert.equal(motion.moving, false);
  assert.deepEqual(motion.position, retained);
  assert.deepEqual(motion.velocity, {x:0, z:0});
  motion.move(retained.x, retained.z, 180);
  assert.deepEqual(motion.position, retained, 'zero pointer delta preserves the exact displayed offset');
  motion.move(retained.x + .05, retained.z - .03, 200);
  assert.ok(motion.position.x > retained.x && motion.position.z < retained.z);
  assert.ok(motion.position.x - retained.x <= .05);
});

check('reduced motion and explicit reset stop and restore the exact home pose', () => {
  for (const path of ['release', 'step', 'resume', 'reset']) {
    const motion = createGroundMotion();
    motion.begin(0);
    motion.move(.5, -.3, 60);
    if (path === 'release') motion.release(60, {reducedMotion:true});
    if (path === 'step') { motion.release(60); motion.step(80, true); }
    if (path === 'resume') { motion.pause(60); motion.resume(80, {reducedMotion:true}); }
    if (path === 'reset') motion.reset(80);
    assert.deepEqual(motion.position, {x:0, z:0});
    assert.deepEqual(motion.velocity, {x:0, z:0});
    assert.equal(motion.held, false);
    assert.equal(motion.moving, false);
    assert.equal(motion.step(100), false);
  }
});

check('invalid input, repeated release and backwards timestamps remain harmless', () => {
  const motion = createGroundMotion({limitX:NaN, limitZ:-4});
  motion.begin(100);
  motion.move(.3, -.3, 120);
  const retained = motion.position;
  motion.move(NaN, Infinity, NaN);
  assert.deepEqual(motion.position, retained);
  motion.release(120);
  const velocity = motion.velocity;
  motion.release(10_000, {cancelled:true});
  assert.deepEqual(motion.velocity, velocity, 'a duplicate release does not cancel the current return');
  motion.step(110);
  assert.deepEqual(motion.position, retained, 'a backwards clock does not integrate backwards');
  motion.step(200);
  assert.ok(Number.isFinite(motion.position.x) && Number.isFinite(motion.position.z));
  const copy = motion.position;
  copy.x = 1e100;
  assert.ok(Math.abs(motion.position.x) <= 1.25, 'public snapshots cannot mutate the simulation');
});

console.log(`Ground-motion checks passed (${passed} cases; standalone production motion controller).`);
