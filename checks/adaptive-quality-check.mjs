import assert from 'node:assert/strict';
import {createAdaptiveQuality,qualityProfiles,QUALITY_TARGET_FPS,DEFAULT_QUALITY_PROFILE} from '../adaptive-quality.js';

function harness({rate = () => 60,initial = DEFAULT_QUALITY_PROFILE,automatic = true} = {}) {
  let now = 0;
  const applied = [],states = [];
  const controller = createAdaptiveQuality({onApply:p => applied.push({...p}),onChange:s => states.push(s)});
  controller.restore(initial,now,{enabled:automatic});
  function tick(fps = rate(controller.state.profile),elapsed = 1000) { now += elapsed; controller.sample(fps,now); }
  function finish() { for(let i=0;i<60 && controller.measuring;i++)tick(); assert.equal(controller.measuring,false); }
  return {controller,applied,states,tick,finish,get now(){return now;}};
}

assert.equal(QUALITY_TARGET_FPS,30);
const passive = harness();
assert.equal(passive.controller.measuring,false,'Loading the preset does not start a benchmark.');
assert.deepEqual(passive.controller.state.profile,{scale:1,shadow:2});
for(let i=0;i<200;i++)passive.tick();
assert.equal(passive.applied.length,1,'A fast browser does not trigger an unsolicited upgrade sweep.');

const restored = harness({initial:{scale:1.25,shadow:3}});
assert.deepEqual(restored.controller.state.profile,{scale:1.25,shadow:3});
assert.equal(restored.controller.measuring,false,'Saved graphics begin passively too.');

const sustained = harness({rate:p => p.shadow >= 2 ? 20 : 40});
for(let i=0;i<7;i++)sustained.tick();
assert.equal(sustained.controller.measuring,false,'Several low samples plus startup warmup are tolerated.');
sustained.tick();
assert.equal(sustained.controller.measuring,true,'Five consecutive low windows trigger a quality check.');
assert.equal(sustained.controller.state.reason,'sustained-load');
assert.deepEqual(sustained.controller.state.profile,{scale:.75,shadow:2},'The first downward trial reduces resolution while preserving Balanced shadows.');
sustained.finish();
assert.equal(sustained.controller.state.fps,40,'The reported FPS remains the measured rate, not the target.');
assert.deepEqual(sustained.controller.state.profile,{scale:.75,shadow:1});

const spikes = harness();
for(let i=0;i<6;i++)spikes.tick(60);
for(const fps of [10,20,60,15,60,20,60,10,60])spikes.tick(fps);
assert.equal(spikes.applied.length,1,'Separated slow windows cannot launch a benchmark.');
for(let i=0;i<4;i++)spikes.tick(20);
spikes.controller.resetSamples();
for(let i=0;i<4;i++)spikes.tick(20);
assert.equal(spikes.controller.measuring,false,'An idle/visibility reset breaks a low-frame-rate streak.');
spikes.tick(20,10_000);
assert.equal(spikes.controller.measuring,false,'A long gap is not sustained load.');
spikes.controller.sample(1,spikes.now-1000);
assert.equal(spikes.controller.measuring,false,'A backwards clock does not complete an old streak.');

const tinyWindows = harness();
for(let i=0;i<5;i++)tinyWindows.tick(60);
for(let i=0;i<10;i++)tinyWindows.tick(10,10);
assert.equal(tinyWindows.controller.measuring,false,'Several rapid calls are not several seconds of poor performance.');

const manual = harness({initial:{scale:1.5,shadow:4},automatic:false});
for(let i=0;i<30;i++)manual.tick(5);
assert.equal(manual.controller.state.mode,'manual');
assert.equal(manual.applied.length,1,'Restored manual settings are not overwritten.');

const explicit = harness();
explicit.controller.start(explicit.now);explicit.finish();
assert.deepEqual(explicit.controller.state.profile,{scale:2,shadow:4});
const firstScaleUp = explicit.applied.findIndex(p => p.scale > 1);
assert.ok(firstScaleUp > 0 && explicit.applied.slice(0,firstScaleUp).at(-1).shadow === 4,'An explicit benchmark tests Ultra at 1× before raising resolution.');

const limited = harness({rate:p => p.scale > 1 ? 23 : p.shadow === 4 ? 35 : 50});
limited.controller.start(limited.now);limited.finish();
assert.deepEqual(limited.controller.state.profile,{scale:1,shadow:4});
assert.equal(limited.controller.state.fps,35);
const stable = limited.applied.length;
for(let i=0;i<80;i++)limited.tick(29);
assert.equal(limited.applied.length,stable,'Steady performance close to 30 FPS retains the measured profile.');

const weak = harness({rate:() => 10});
for(let i=0;i<8;i++)weak.tick();
weak.finish();
assert.deepEqual(weak.controller.state.profile,{scale:.5,shadow:0},'A weak browser can still reach the minimum fallback.');
const minimum = weak.applied.length;
for(let i=0;i<40;i++)weak.tick();
assert.equal(weak.applied.length,minimum,'The minimum profile cannot enter a perpetual allocation loop.');

const interrupted = harness();
interrupted.controller.start(interrupted.now);interrupted.tick();interrupted.controller.manual();
const stopped = interrupted.applied.length;
for(let i=0;i<30;i++)interrupted.tick(10);
assert.equal(interrupted.controller.measuring,false);
assert.equal(interrupted.applied.length,stopped,'Manual input cancels a running quality check.');
interrupted.controller.restore({scale:.9,shadow:3},interrupted.now,{enabled:true});
assert.equal(interrupted.controller.measuring,false,'Re-enabling automatic mode watches the current settings first.');
for(let i=0;i<8;i++)interrupted.tick(15);
assert.equal(interrupted.controller.measuring,true);
assert.ok(interrupted.controller.state.profile.scale <= .9 && interrupted.controller.state.profile.shadow <= 3,'Custom slider combinations degrade without raising another resource.');

const warmup = harness();
warmup.controller.start(0);warmup.controller.sample(1,100);warmup.controller.sample(1,200);
assert.equal(warmup.applied.length,2,'Compilation and allocation warmup is ignored.');
warmup.finish();
assert.ok(qualityProfiles.some(p=>p.scale === .75 && p.shadow === 2));
console.log('Adaptive quality checks passed: passive presets/restoration, sustained-load-only downward tuning, fixed 30 FPS budget, explicit shadow-first benchmark, idle/spike/clock guards, fallback, manual cancellation and warmup.');
