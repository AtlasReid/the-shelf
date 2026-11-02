import * as THREE from './vendor/three/three.module.js';

// Lightweight leaves: a small sphere is the collision proxy for each flexible
// blade. Cards are fixed obstacles; impacts do not move the much heavier cards.
const FIXED_STEP = 1 / 120;
const MAX_LEAVES = 64;
const BURST = 16;
const LIFETIME = 35;
const GROUND_Y = .004;
const EPSILON = 1e-5;
const colliderCache = new WeakMap();
const queryBox = new THREE.Box3();
const delta = new THREE.Vector3();
const relative = new THREE.Vector3();
const closest = new THREE.Vector3();
const point = new THREE.Vector3();
const normal = new THREE.Vector3();
const edge = new THREE.Vector3();
const perpendicular = new THREE.Vector3();
const perpendicularVelocity = new THREE.Vector3();

function colliderFor(mesh) {
  if (!mesh?.isMesh || !mesh.visible || !mesh.geometry?.attributes?.position) return null;
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry;
  const positions = geometry.attributes.position;
  const index = geometry.index;
  const old = colliderCache.get(mesh);
  if (old && old.positions === positions && old.positionVersion === positions.version
    && old.index === index && old.indexVersion === index?.version
    && old.matrix.every((value, i) => value === mesh.matrixWorld.elements[i])) return old;
  const triangles = [];
  const bounds = new THREE.Box3();
  const count = index ? index.count : positions.count;
  const vertex = i => new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
  for (let i = 0; i + 2 < count; i += 3) {
    const triangle = new THREE.Triangle(vertex(i), vertex(i + 1), vertex(i + 2));
    const faceNormal = triangle.getNormal(new THREE.Vector3());
    if (faceNormal.lengthSq() < .5) continue;
    const box = new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]);
    bounds.union(box);
    triangles.push({triangle, normal:faceNormal, bounds:box});
  }
  const result = {positions, positionVersion:positions.version, index, indexVersion:index?.version,
    matrix:mesh.matrixWorld.elements.slice(), triangles, bounds};
  colliderCache.set(mesh, result);
  return result;
}

function firstRoot(a, b, c) {
  if (a < 1e-16) return null;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= -EPSILON && t <= 1 + EPSILON ? Math.max(0, Math.min(1, t)) : null;
}

/** Swept sphere against the actual world-space card triangles, including edges. */
export function sweepSphereAgainstMeshes(start, end, radius, meshes) {
  delta.subVectors(end, start);
  const speedSquared = delta.lengthSq();
  queryBox.makeEmpty().expandByPoint(start).expandByPoint(end).expandByScalar(radius + EPSILON);
  let hit = null;
  const consider = (t, n, mesh, penetration = 0) => {
    if (t < -EPSILON || t > 1 + EPSILON || (hit && t >= hit.time)) return;
    hit = {time:Math.max(0, Math.min(1, t)), normal:n.clone(), object:mesh, penetration};
  };
  for (const mesh of meshes) {
    const collider = colliderFor(mesh);
    if (!collider || !queryBox.intersectsBox(collider.bounds)) continue;
    for (const face of collider.triangles) {
      if (!queryBox.intersectsBox(face.bounds)) continue;
      const triangle = face.triangle;
      triangle.closestPointToPoint(start, closest);
      relative.subVectors(start, closest);
      const initialDistance = relative.length();
      if (initialDistance < radius - EPSILON) {
        if (initialDistance > EPSILON) normal.copy(relative).divideScalar(initialDistance);
        else {
          normal.copy(face.normal);
          if (normal.dot(delta) > 0) normal.negate();
        }
        consider(0, normal, mesh, radius - initialDistance);
      }
      if (speedSquared < 1e-16) continue;

      relative.subVectors(start, triangle.a);
      const distance = relative.dot(face.normal);
      const travel = delta.dot(face.normal);
      for (const sign of [-1, 1]) {
        if (travel * sign >= -1e-12 || distance * sign < radius - EPSILON) continue;
        const t = (sign * radius - distance) / travel;
        if (t < -EPSILON || t > 1 || (hit && t >= hit.time)) continue;
        point.copy(start).addScaledVector(delta, t).addScaledVector(face.normal, -sign * radius);
        if (triangle.containsPoint(point)) {
          normal.copy(face.normal).multiplyScalar(sign);
          consider(t, normal, mesh);
        }
      }

      // Vertex spheres and finite edge cylinders complete the swept volume,
      // preventing fast leaves from slipping through a thin paper edge.
      const vertices = [triangle.a, triangle.b, triangle.c];
      for (let i = 0; i < 3; i++) {
        const a = vertices[i], b = vertices[(i + 1) % 3];
        relative.subVectors(start, a);
        const vertexTime = firstRoot(speedSquared, 2 * relative.dot(delta), relative.lengthSq() - radius * radius);
        if (vertexTime !== null && (!hit || vertexTime < hit.time)) {
          normal.copy(start).addScaledVector(delta, vertexTime).sub(a).normalize();
          if (normal.dot(delta) < 0) consider(vertexTime, normal, mesh);
        }
        edge.subVectors(b, a);
        const edgeLengthSquared = edge.lengthSq();
        if (edgeLengthSquared < 1e-16) continue;
        const along = relative.dot(edge) / edgeLengthSquared;
        const alongVelocity = delta.dot(edge) / edgeLengthSquared;
        perpendicular.copy(relative).addScaledVector(edge, -along);
        perpendicularVelocity.copy(delta).addScaledVector(edge, -alongVelocity);
        const edgeTime = firstRoot(perpendicularVelocity.lengthSq(),
          2 * perpendicular.dot(perpendicularVelocity), perpendicular.lengthSq() - radius * radius);
        if (edgeTime === null || (hit && edgeTime >= hit.time)) continue;
        const projection = along + edgeTime * alongVelocity;
        if (projection < 0 || projection > 1) continue;
        normal.copy(perpendicular).addScaledVector(perpendicularVelocity, edgeTime).normalize();
        if (normal.dot(delta) < 0) consider(edgeTime, normal, mesh);
      }
    }
  }
  return hit;
}

function leafGeometry() {
  const widths = [0, .043, .071, .084, .074, .045, 0];
  const positions = [], colors = [], indices = [];
  for (let ring = 0; ring < widths.length; ring++) {
    const t = ring / (widths.length - 1);
    const z = -.18 + t * .38;
    for (const side of [-1, 0, 1]) {
      positions.push(side * widths[ring], side === 0 ? Math.sin(t * Math.PI) * .016 : 0, z);
      const shade = side === 0 ? 1 : .76 + t * .12;
      colors.push(shade, shade, shade);
    }
    if (ring) {
      const before = (ring - 1) * 3, current = ring * 3;
      indices.push(before, current, before + 1, before + 1, current, current + 1,
        before + 1, current + 1, before + 2, before + 2, current + 1, current + 2);
    }
  }
  const stem = positions.length / 3;
  positions.push(-.008, 0, -.18, .008, 0, -.18, 0, 0, -.235);
  colors.push(.6, .6, .6, .6, .6, .6, .6, .6, .6);
  indices.push(stem, stem + 1, stem + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createLeaves(scene, {getColliders = () => [], reducedMotion = () => false, random = Math.random, timeScale = () => 1} = {}) {
  const group = new THREE.Group();
  group.name = 'Wind-blown leaves';
  scene.add(group);
  const geometry = leafGeometry();
  const materials = ['#a77e49', '#9b8f51', '#b97c50', '#8b8753', '#b49b66'].map(color =>
    new THREE.MeshStandardMaterial({color, vertexColors:true, roughness:.94, metalness:0, side:THREE.DoubleSide}));
  const bodies = [];
  const end = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const localY = new THREE.Vector3();
  const localX = new THREE.Vector3();
  const localZ = new THREE.Vector3();
  const counters = {cardCollisions:0, groundContacts:0};
  const cardsHit = new Set();
  let lastNow = null;
  let accumulator = 0;
  let destroyed = false;

  function remove(body) {
    group.remove(body.mesh);
    bodies.splice(bodies.indexOf(body), 1);
  }

  function gustTracks() {
    // The collection can have several rows and differently sized cards. Aim
    // through the actual stationary paper, rather than the old one-row z=0
    // corridor. Include the complete card before deriving its central track.
    const cards = new Map();
    for (const mesh of getColliders()) {
      const collider = colliderFor(mesh);
      if (!collider || collider.bounds.isEmpty()) continue;
      const key = mesh.userData.cardId || mesh;
      if (!cards.has(key)) cards.set(key,new THREE.Box3());
      cards.get(key).union(collider.bounds);
    }
    const bounds = new THREE.Box3();
    const tracks = [];
    for (const card of cards.values()) {
      bounds.union(card);
      tracks.push({z:(card.min.z + card.max.z) / 2, depth:card.max.z - card.min.z,
        front:card.max.z, left:card.min.x, right:card.max.x});
    }
    return {tracks, right:bounds.isEmpty() ? 6.6 : bounds.max.x,
      left:bounds.isEmpty() ? -4.5 : bounds.min.x};
  }

  function clearance(body) {
    localX.set(1, 0, 0).applyQuaternion(body.mesh.quaternion);
    localY.set(0, 1, 0).applyQuaternion(body.mesh.quaternion);
    localZ.set(0, 0, 1).applyQuaternion(body.mesh.quaternion);
    return GROUND_Y + body.scale * (.085 * Math.abs(localX.y) + .235 * Math.abs(localZ.y) + .016 * Math.max(0, -localY.y));
  }

  function integrate(body, dt, colliders) {
    if (body.settled) return;
    body.age += dt;
    const mesh = body.mesh;
    const velocity = body.velocity;
    if (body.grounded) {
      mesh.quaternion.slerp(body.rest, 1 - Math.exp(-18 * dt));
      velocity.x *= Math.exp(-1.8 * dt);
      velocity.z *= Math.exp(-1.8 * dt);
    } else {
      const wind = -2.7 * Math.exp(-body.age * .4);
      velocity.x += (wind - velocity.x) * (1 - Math.exp(-.45 * dt));
      velocity.z += Math.sin(body.age * 4.1 + body.phase) * .25 * dt;
      mesh.rotateX((body.spin.x + Math.sin(body.age * 6 + body.phase) * 1.6) * dt);
      mesh.rotateY(body.spin.y * dt);
      mesh.rotateZ((body.spin.z + Math.cos(body.age * 4 + body.phase)) * dt);
    }
    velocity.y -= 2.2 * dt;
    velocity.y *= Math.exp(-.55 * dt);
    const floor = clearance(body);
    let remaining = dt;
    for (let iteration = 0; iteration < 4 && remaining > 1e-7; iteration++) {
      end.copy(mesh.position).addScaledVector(velocity, remaining);
      let hit = sweepSphereAgainstMeshes(mesh.position, end, body.radius, colliders);
      if (end.y < floor && velocity.y < 0) {
        const time = mesh.position.y <= floor ? 0 : (mesh.position.y - floor) / (mesh.position.y - end.y);
        if (!hit || time <= hit.time) hit = {time, normal:new THREE.Vector3(0, 1, 0), ground:true, penetration:Math.max(0, floor - mesh.position.y)};
      }
      if (!hit) { mesh.position.copy(end); break; }
      mesh.position.lerp(end, hit.time).addScaledVector(hit.normal, EPSILON + hit.penetration);
      const approach = velocity.dot(hit.normal);
      if (approach < 0) {
        const impulse = -(1 + (hit.ground ? .08 : .22)) * approach;
        velocity.addScaledVector(hit.normal, impulse);
        tangent.copy(velocity).addScaledVector(hit.normal, -velocity.dot(hit.normal));
        const speed = tangent.length();
        if (speed > 1e-8) velocity.addScaledVector(tangent, -Math.min(1, (hit.ground ? .8 : .26) * impulse / speed));
        if (!hit.ground && approach < -.12) {
          counters.cardCollisions++;
          if (hit.object?.userData.cardId) cardsHit.add(hit.object.userData.cardId);
        }
      }
      if (hit.ground) {
        if (!body.grounded) counters.groundContacts++;
        body.grounded = true;
      }
      remaining *= 1 - hit.time;
    }
    if (body.grounded && mesh.position.y - floor < .015 && Math.hypot(velocity.x, velocity.z) < .08
      && Math.abs(velocity.y) < .12 && mesh.quaternion.angleTo(body.rest) < .02) {
      body.settled = true;
      velocity.set(0, 0, 0);
      mesh.quaternion.copy(body.rest);
      mesh.position.y = GROUND_Y;
    }
  }

  return {
    blow() {
      if (destroyed) return 0;
      const gentle = reducedMotion();
      const count = gentle ? 4 : BURST;
      const region = gustTracks();
      if (!bodies.some(body => !body.settled)) { lastNow = null; accumulator = 0; }
      for (let i = 0; i < count; i++) {
        if (bodies.length >= MAX_LEAVES) remove(bodies[0]);
        const scale = .75 + random() * .55;
        const mesh = new THREE.Mesh(geometry, materials[Math.min(materials.length - 1, Math.floor(random() * materials.length))]);
        mesh.name = 'Falling autumn leaf';
        mesh.userData.isWindLeaf = true;
        mesh.scale.setScalar(scale);
        mesh.castShadow = mesh.receiveShadow = true;
        const track = region.tracks.length ? region.tracks[i % region.tracks.length] : {z:.6,depth:.8,front:1};
        const z = gentle ? track.front + .35 + random() * .3
          : track.z + (random() - .5) * Math.max(.12,Math.min(.35,track.depth * .6));
        // Keep static placement beside the same card as its depth track. With
        // curved rows, a global random X could land inside a different card.
        const left = track.left ?? region.left, right = track.right ?? region.right;
        mesh.position.set(gentle ? left + random() * (right - left) : region.right + .6 + random() * 1.2,
          gentle ? GROUND_Y : .55 + random() * 2.7, z);
        mesh.rotation.set(random() * Math.PI, random() * Math.PI * 2, random() * Math.PI);
        const rest = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2);
        if (gentle) mesh.quaternion.copy(rest);
        group.add(mesh);
        bodies.push({mesh, scale, radius:.065 * scale, rest, velocity:new THREE.Vector3(-4 - random() * 1.7, .2 + random() * .5, -.1 + random() * .15),
          spin:new THREE.Vector3((random() - .5) * 4, (random() - .5) * 3, (random() - .5) * 4),
          phase:random() * Math.PI * 2, age:0, bornAt:null, grounded:gentle, settled:gentle});
      }
      return count;
    },
    step(now) {
      if (destroyed || !Number.isFinite(now)) return false;
      for (const body of bodies) if (body.bornAt === null) body.bornAt = now;
      for (const body of [...bodies]) if ((now - body.bornAt) / 1000 > LIFETIME || body.mesh.position.x < -14) remove(body);
      if (lastNow === null) { lastNow = now; return bodies.some(body => !body.settled); }
      const elapsed = Math.max(0, (now - lastNow) / 1000);
      lastNow = now;
      const rate = timeScale();
      accumulator += Math.min(elapsed, .15) * (Number.isFinite(rate) ? Math.max(1/3,Math.min(4,rate)) : 1);
      const colliders = getColliders();
      while (accumulator + 1e-10 >= FIXED_STEP) {
        for (const body of bodies) integrate(body, FIXED_STEP, colliders);
        accumulator -= FIXED_STEP;
      }
      return bodies.some(body => !body.settled);
    },
    get stats() { return {count:bodies.length, moving:bodies.filter(body => !body.settled).length, ...counters,cardsHit:[...cardsHit]}; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const body of [...bodies]) remove(body);
      scene.remove(group);
      geometry.dispose();
      materials.forEach(material => material.dispose());
    },
  };
}
