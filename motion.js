// Optional motion experiments. An empty override retains every original curve
// and duration; snapshots keep an in-flight animation stable while editing.
export const MOTION_CHANNELS = Object.freeze({
  cards:{label:'Card motion',base:950,curve:true,description:'Pickup, put back and view changes. Their durations stay in proportion; the time shown is for pickup.'},
  time:{label:'Time travel',base:2500,curve:true,description:'Time shortcuts and Return to now. The icon, clock and daylight travel together.'},
  lighting:{label:'Lighting',base:650,curve:true,description:'Light and colour transitions. Duration also changes how quickly the indoor light follows the view.'},
  layout:{label:'Arc movement',base:950,curve:true,description:'The time arc and its icons moving between the shelf and card layouts.'},
  ui:{label:'Controls & fades',base:650,curve:true,description:'Fading hints, the orbiting bulb, button feedback and Settings entrance. Duration also scales hint delays.'},
  leaves:{label:'Falling leaves',base:1000,curve:false,description:'Duration changes the simulation pace. Leaves keep their natural motion and physical collisions.'},
  ground:{label:'Ground return',base:1000,curve:false,description:'Duration changes the spring return pace. Enable Ground movement below to try it.'},
});

export const ORIGINAL_CURVES = Object.freeze(Object.fromEntries(Object.entries({
  cards:[.42,0,.58,1],time:[.42,0,.58,1],lighting:[.42,0,.58,1],
  layout:[.76,0,.24,1],ui:[.25,.1,.25,1],
}).map(([key,curve]) => [key,Object.freeze(curve)])));
export const EMPTY_MOTION = Object.freeze({});
const clamp = value => Math.max(0,Math.min(1,Number.isFinite(value) ? value : 0));
const record = value => value && typeof value === 'object' && !Array.isArray(value);

export function validateMotion(value) {
  if (!record(value)) return null;
  const result = {};
  for (const [key,config] of Object.entries(MOTION_CHANNELS)) {
    const item = value[key];
    if (!record(item)) continue;
    const scale = typeof item.scale === 'number' && Number.isFinite(item.scale) && item.scale >= .25 && item.scale <= 3 ? item.scale : 1;
    const curve = config.curve && Array.isArray(item.curve) && item.curve.length === 4
      && item.curve.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) ? Object.freeze([...item.curve]) : null;
    if (scale !== 1 || curve) result[key] = Object.freeze({scale,curve});
  }
  return Object.freeze(result);
}

export function cubicBezier(points,t) {
  t = clamp(t);
  if (t === 0 || t === 1) return t;
  const [x1,y1,x2,y2] = points;
  if (x1 === y1 && x2 === y2) return t;
  const axis = (p,a,b) => 3*(1-p)*(1-p)*p*a + 3*(1-p)*p*p*b + p*p*p;
  // Solve x(u)=elapsed time. Using t as the Bezier parameter would give the
  // wrong acceleration, especially for handles close to the vertical edges.
  let low = 0, high = 1;
  for (let i=0;i<24;i++) {
    const middle = (low+high)/2;
    if (axis(middle,x1,x2) < t) low = middle; else high = middle;
  }
  return clamp(axis((low+high)/2,y1,y2));
}

export function originalEase(key,t) {
  t = clamp(t);
  if (['cards','time','lighting'].includes(key)) return t*t*t*(t*(6*t-15)+10);
  return ORIGINAL_CURVES[key] ? cubicBezier(ORIGINAL_CURVES[key],t) : t;
}

export function createMotionController(settingsStore = null) {
  function get(key) {
    const value = settingsStore?.state.motion?.[key];
    return {scale:value?.scale ?? 1,curve:value?.curve ? [...value.curve] : null};
  }
  return {
    get,
    duration(key,base) { return base * get(key).scale; },
    transition(key,base = MOTION_CHANNELS[key].base) {
      const {scale,curve} = get(key);
      return {duration:base*scale,ease:curve ? t => cubicBezier(curve,t) : t => originalEase(key,t)};
    },
    update(key,patch) {
      if (!Object.hasOwn(MOTION_CHANNELS,key)) return;
      settingsStore?.update({motion:{...settingsStore.state.motion,[key]:{...get(key),...patch}}});
    },
    reset(key = null) {
      if (!key) { settingsStore?.update({motion:EMPTY_MOTION}); return; }
      const next = {...settingsStore?.state.motion};
      delete next[key]; settingsStore?.update({motion:next});
    },
  };
}
