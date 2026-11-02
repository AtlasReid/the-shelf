// A scene benchmark, not a hardware/browser fingerprint. Ordinary visits begin
// with a stable preset; only sustained slow motion starts an automatic probe.
export const qualityProfiles = Object.freeze([
  {scale:.5,shadow:0}, {scale:.75,shadow:1}, {scale:1,shadow:1},
  {scale:.75,shadow:2}, {scale:1,shadow:2}, {scale:1,shadow:3},
  {scale:1,shadow:4}, {scale:1.25,shadow:4}, {scale:1.5,shadow:4}, {scale:2,shadow:4},
].map(Object.freeze));
export const QUALITY_TARGET_FPS = 30;
export const DEFAULT_QUALITY_PROFILE = Object.freeze({scale:1,shadow:2});

const profile = value => ({
  scale:Math.max(.5,Math.min(2,Number(value?.scale) || DEFAULT_QUALITY_PROFILE.scale)),
  shadow:Math.max(0,Math.min(4,Math.round(Number(value?.shadow) || 0))),
});
const same = (a,b) => a.scale === b.scale && a.shadow === b.shadow;
const indexOf = value => qualityProfiles.findIndex(candidate => same(candidate,value));

export function createAdaptiveQuality({onApply = () => {},onChange = () => {}} = {}) {
  let enabled = false, measuring = false, reason = 'preset', direction = 'down';
  let current = {...DEFAULT_QUALITY_PROFILE}, best = current, bestFps = null;
  let index = indexOf(current), ceiling = qualityProfiles.length;
  let settling = 0, changed = 0, lastSample = null, lowSince = null, low = 0, samples = [];
  const state = () => ({enabled,measuring,index,profile:current,recommended:best,fps:bestFps,
    target:QUALITY_TARGET_FPS,reason,mode:!enabled ? 'manual' : measuring ? 'measuring' : 'automatic'});
  const publish = () => onChange(state());
  function clearSamples() { samples = []; low = 0; lowSince = null; lastSample = null; }
  function apply(value,now) {
    current = profile(value); index = indexOf(current); changed = now;
    settling = now + 900; // Shader compilation and render-target allocation.
    clearSamples();
    onApply(current);
  }
  function lower() {
    // Never raise resolution while responding to a slowdown. This also handles
    // custom slider combinations that are not entries in the preset ladder.
    return qualityProfiles.findLast(candidate => candidate.scale <= current.scale
      && candidate.shadow <= current.shadow && !same(candidate,current)) ?? null;
  }
  function finish(now,restore = false) {
    if (restore) apply(best,now);
    else changed = now;
    measuring = false; reason = 'complete'; clearSamples(); publish();
  }
  return {
    get measuring() { return enabled && measuring; },
    get state() { return state(); },
    restore(value = DEFAULT_QUALITY_PROFILE,now = 0,{enabled:automatic = true} = {}) {
      enabled = Boolean(automatic); measuring = false; reason = 'preset';
      bestFps = null; best = profile(value); ceiling = qualityProfiles.length;
      apply(best,now); publish();
    },
    start(now = 0) {
      // An explicit user-requested benchmark may explore higher quality. Ultra
      // at 1× is still considered before any scale greater than 1×.
      enabled = true; measuring = true; reason = 'requested'; direction = 'up';
      ceiling = qualityProfiles.length; bestFps = null;
      best = qualityProfiles[2]; apply(best,now); publish();
    },
    manual() { enabled = false; measuring = false; reason = 'manual'; clearSamples(); publish(); },
    resetSamples(now = null) {
      clearSamples();
      if (Number.isFinite(now)) settling = Math.max(settling,now + 900);
    },
    sample(fps,now) {
      if (!enabled || !Number.isFinite(fps) || fps <= 0 || !Number.isFinite(now)) return;
      if (lastSample !== null && (now <= lastSample || now - lastSample > 2000)) clearSamples();
      lastSample = now;
      if (now < settling) return;
      if (measuring) {
        samples.push(fps);
        if (samples.length < 2) return;
        const rate = samples.reduce((sum,value) => sum + value,0) / samples.length;
        samples = [];
        if (rate >= QUALITY_TARGET_FPS * .9) {
          best = current; bestFps = rate;
          if (direction === 'up' && index + 1 < ceiling) {
            apply(qualityProfiles[index + 1],now); publish();
          } else finish(now);
        } else {
          if (direction === 'up') ceiling = Math.min(ceiling,index);
          if (bestFps !== null && direction === 'up') finish(now,true);
          else {
            const next = lower();
            if (next) { apply(next,now); publish(); }
            else { best = current; bestFps = rate; finish(now); }
          }
        }
        return;
      }
      // Healthy frames do not launch a later upgrade sweep. A stable view stays
      // stable until the user asks for a benchmark or a real slowdown persists.
      if (now - changed < 3500) { low = 0; lowSince = null; return; }
      if (fps >= 27) { low = 0; lowSince = null; return; }
      if (!low) lowSince = now;
      low++;
      if (low < 5 || now - lowSince < 3200) return;
      const next = lower();
      if (!next) { best = current; bestFps = fps; changed = now; clearSamples(); publish(); return; }
      measuring = true; direction = 'down'; reason = 'sustained-load'; bestFps = null;
      apply(next,now); publish();
    },
  };
}
