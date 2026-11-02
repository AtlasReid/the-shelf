// Bounded, collection-view camera drift. This module has no scene/DOM dependency.
// A lightly underdamped spring gives a short coast, a slow return and a tiny
// overshoot, then settles exactly so the scene can return to on-demand rendering.
const SPRING = 2.4 ** 2;
const DECAY = 2.1;
const FREQUENCY = Math.sqrt(SPRING - DECAY ** 2);
const STEP_SECONDS = 1 / 120;
const STALE_RELEASE_MS = 100;

const validLimit = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function createGroundMotion({limitX = 1.25, limitZ = 1.5, timeScale = () => 1} = {}) {
  const limits = {x:validLimit(limitX, 1.25), z:validLimit(limitZ, 1.5)};
  const position = {x:0, z:0};
  const velocity = {x:0, z:0};
  let origin = {x:0, z:0};
  let held = false;
  let paused = false;
  let active = false;
  let clock = 0;
  let lastStep = 0;
  let lastSample = 0;

  function time(now) {
    if (Number.isFinite(now)) clock = Math.max(clock, now);
    return clock;
  }

  function clearVelocity() { velocity.x = velocity.z = 0; }

  function settle() {
    const resting = ['x', 'z'].every(axis => Math.abs(position[axis]) < limits[axis] * .00025
      && Math.abs(velocity[axis]) < limits[axis] * .001);
    if (resting) {
      position.x = position.z = 0;
      clearVelocity();
      active = false;
    }
    return resting;
  }

  function reset(now) {
    lastStep = lastSample = time(now);
    position.x = position.z = 0;
    origin = {x:0, z:0};
    clearVelocity();
    held = paused = active = false;
  }

  // Resistance is anchored at the start of each grab. Applying tanh to the
  // complete retained offset would compress it again and cause a re-grab jump.
  function resisted(request, axis) {
    if (!Number.isFinite(request)) return position[axis];
    const delta = request - origin[axis];
    if (!delta) return origin[axis];
    const direction = Math.sign(delta);
    const room = Math.max(0, limits[axis] - direction * origin[axis]);
    return room ? origin[axis] + direction * room * Math.tanh(Math.abs(delta) / room) : origin[axis];
  }

  return {
    get position() { return {...position}; },
    get velocity() { return {...velocity}; },
    get held() { return held; },
    get moving() { return active && !held && !paused; },

    begin(now) {
      lastStep = lastSample = time(now);
      origin = {...position};
      clearVelocity();
      held = true;
      paused = active = false;
    },

    move(x, z, now) {
      if (!held) return;
      const stamp = time(now);
      const seconds = (stamp - lastSample) / 1000;
      const next = {x:resisted(x, 'x'), z:resisted(z, 'z')};
      if (seconds > 0) {
        // The estimate follows recent motion, rather than the entire gesture.
        const blend = 1 - Math.exp(-seconds / .045);
        for (const axis of ['x', 'z']) {
          const measured = clamp((next[axis] - position[axis]) / seconds, -3 * limits[axis], 3 * limits[axis]);
          velocity[axis] += (measured - velocity[axis]) * blend;
        }
      }
      position.x = next.x;
      position.z = next.z;
      lastSample = stamp;
    },

    release(now, {cancelled = false, reducedMotion = false} = {}) {
      if (!held) return;
      const stamp = time(now);
      const age = stamp - lastSample;
      held = paused = false;
      if (reducedMotion) { reset(stamp); return; }
      if (cancelled || age >= STALE_RELEASE_MS) clearVelocity();
      else {
        const freshness = Math.exp(-age / 60);
        velocity.x *= freshness;
        velocity.z *= freshness;
      }
      lastStep = stamp;
      active = true;
      settle();
    },

    pause(now) {
      lastStep = time(now);
      held = active = false;
      paused = true;
      clearVelocity();
    },

    resume(now, {reducedMotion = false} = {}) {
      lastStep = time(now);
      held = paused = false;
      clearVelocity();
      if (reducedMotion) { reset(lastStep); return; }
      active = true;
      settle();
    },

    reset,

    step(now, reducedMotion = false) {
      const stamp = time(now);
      if (held || paused || !active) { lastStep = stamp; return false; }
      if (reducedMotion) { reset(stamp); return false; }
      let remaining = (stamp - lastStep) / 1000;
      lastStep = stamp;
      // After a long suspended/background interval this spring is settled.
      if (remaining >= 8) { reset(stamp); return false; }
      const rate = timeScale();
      remaining *= Number.isFinite(rate) ? clamp(rate,1/3,4) : 1;
      while (remaining > 1e-9 && active) {
        const dt = Math.min(STEP_SECONDS, remaining);
        const envelope = Math.exp(-DECAY * dt);
        const cosine = Math.cos(FREQUENCY * dt);
        const sine = Math.sin(FREQUENCY * dt);
        for (const axis of ['x', 'z']) {
          const oldPosition = position[axis], oldVelocity = velocity[axis];
          position[axis] = envelope * (oldPosition * cosine + (oldVelocity + DECAY * oldPosition) / FREQUENCY * sine);
          velocity[axis] = envelope * (oldVelocity * cosine - (DECAY * oldVelocity + SPRING * oldPosition) / FREQUENCY * sine);
          if (Math.abs(position[axis]) > limits[axis]) {
            position[axis] = Math.sign(position[axis]) * limits[axis];
            if (position[axis] * velocity[axis] > 0) velocity[axis] = 0;
          }
        }
        remaining -= dt;
        settle();
      }
      return active;
    },
  };
}
