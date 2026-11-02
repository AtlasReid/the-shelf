import { createAdaptiveQuality, DEFAULT_QUALITY_PROFILE } from './adaptive-quality.js';

// Measured rendering settings. Automatic sampling never interprets an idle,
// on-demand frame gap as poor GPU performance. Manual choices pause adaptation.
export function createRenderDiagnostics({ element, renderer, scene, invalidate, pixelRatio: initialRatio = 1,
  settingsStore = null, noticeElement = document.querySelector('#graphics-status'), motion = null }) {
  const fps = element.querySelector('#perf-fps');
  const live = element.querySelector('#perf-live');
  const scale = element.querySelector('#render-scale');
  const scaleValue = element.querySelector('#render-scale-value');
  const shadows = element.querySelector('#shadow-quality');
  const shadowValue = element.querySelector('#shadow-quality-value');
  const automatic = element.querySelector('#quality-auto');
  const status = element.querySelector('#quality-status');
  const recommendation = element.querySelector('#perf-recommendation');
  const benchmark = element.querySelector('#quality-benchmark');
  const presets = [...element.querySelectorAll('[data-render-scale]')];
  const graph = element.querySelector('#fps-graph');
  const inspection = element.querySelector('#inspection-detail');
  const history = [];
  const lifetime = new AbortController();
  const names = ['Off', 'Low', 'Balanced', 'High', 'Ultra'];
  const lights = [];
  scene.traverse(object => { if (object.isLight && object.shadow) lights.push(object); });
  const defaults = {automatic:true,renderScale:initialRatio,shadowQuality:2,inspectionDetail:true,liveFps:true};
  let saved = defaults;
  try { saved = {...defaults,...settingsStore?.state}; } catch { /* Use this visit's preset if storage is unavailable. */ }
  let pixelRatio = Math.max(.5, Math.min(2, Number(saved.renderScale) || DEFAULT_QUALITY_PROFILE.scale));
  let inspectionDetail = saved.inspectionDetail !== false;
  let sampleStart = null;
  let frames = 0;
  let destroyed = false;
  let panelOpen = false;
  let lastFrame = null;
  let sampling = false;
  let previousState = null;
  let noticeTimer = null;
  let unsubscribeSettings = null;
  automatic.checked = saved.automatic !== false;
  live.checked = saved.liveFps !== false;
  if (inspection) inspection.checked = inspectionDetail;

  const continuous = () => !destroyed && !document.hidden && (adaptive.measuring || (panelOpen && live.checked));
  function resetMeter() {
    sampleStart = null;
    frames = 0;
    lastFrame = null;
    sampling = false;
    fps.textContent = document.hidden ? 'Paused' : '…';
  }

  function saveSettings(patch) {
    try { settingsStore?.update(patch); } catch { /* UI and graphics remain usable without persistence. */ }
  }
  function clearNotice() {
    clearTimeout(noticeTimer); noticeTimer = null;
    if (!noticeElement) return;
    noticeElement.classList.remove('is-visible');
    noticeElement.setAttribute('aria-hidden','true');
    noticeElement.hidden = true;
  }
  function showNotice(message,detail = '',complete = false) {
    if (!noticeElement) return;
    clearTimeout(noticeTimer);
    const main = noticeElement.querySelector('#graphics-status-message');
    const secondary = noticeElement.querySelector('#graphics-status-detail');
    if (main) main.textContent = message;
    if (secondary) secondary.textContent = detail;
    noticeElement.hidden = false;
    noticeElement.setAttribute('aria-hidden','false');
    noticeElement.classList.add('is-visible');
    if (complete) noticeTimer = setTimeout(() => {
      noticeElement.classList.remove('is-visible');
      noticeElement.setAttribute('aria-hidden','true');
      noticeTimer = null;
    },motion?.duration('ui',2500) ?? 2500);
  }

  function updateScale() {
    scale.value = String(Math.round(pixelRatio * 100));
    scaleValue.textContent = `${pixelRatio.toFixed(2)}×`;
    scale.setAttribute('aria-valuetext', `${Math.round(pixelRatio * 100)} percent render scale`);
    renderer.setPixelRatio(pixelRatio);
    element.dataset.pixelRatio = pixelRatio.toFixed(2);
    presets.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.renderScale) === Math.round(pixelRatio * 100))));
  }

  function setShadows(value) {
    const level = Math.max(0, Math.min(4, Math.round(Number(value) || 0)));
    const enabled = level > 0;
    const changedEnabled = renderer.shadowMap.enabled !== enabled;
    renderer.shadowMap.enabled = enabled;
    const sizes = [];
    for (const light of lights) {
      const requested = level === 1 ? 512 : level === 2 ? (light.name === 'Sunlight' ? 2048 : 1024) : level === 3 ? 2048 : 4096;
      const size = Math.min(requested, renderer.capabilities.maxTextureSize);
      const shadow = light.shadow;
      if (!enabled || shadow.mapSize.x !== size || shadow.mapSize.y !== size) {
        // r185 retains allocated targets when mapSize alone changes.
        shadow.map?.dispose();
        shadow.map = null;
        shadow.mapPass?.dispose();
        shadow.mapPass = null;
      }
      if (enabled) shadow.mapSize.set(size, size);
      shadow.needsUpdate = true;
      sizes.push(`${light.name}: ${enabled ? `${size} × ${size}` : 'off'}`);
    }
    if (changedEnabled) scene.traverse(object => {
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.needsUpdate = true;
    });
    renderer.shadowMap.needsUpdate = true;
    shadows.value = String(level);
    shadows.setAttribute('aria-valuetext', names[level]);
    shadowValue.textContent = names[level];
    shadowValue.title = sizes.join('\n');
    element.dataset.shadowQuality = names[level].toLowerCase();
    element.dataset.shadowSizes = sizes.join('; ');
  }

  function drawGraph() {
    if (!graph || !panelOpen) return;
    const width = Math.max(120, graph.clientWidth), height = Math.max(70, graph.clientHeight);
    const density = Math.min(devicePixelRatio || 1, 2);
    if (graph.width !== Math.round(width*density) || graph.height !== Math.round(height*density)) {
      graph.width = Math.round(width*density); graph.height = Math.round(height*density);
    }
    const ctx = graph.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(density,0,0,density,0,0);
    ctx.clearRect(0,0,width,height);
    const styles = getComputedStyle(document.body);
    const muted = styles.getPropertyValue('--muted').trim() || '#777c70';
    const line = styles.getPropertyValue('--line').trim() || '#dadbd0';
    const accent = styles.getPropertyValue('--olive').trim() || '#59664c';
    const max = Math.max(80, ...history.map(point => Math.min(180, point.fps)));
    const left = 24, bottom = height - 8, top = 8;
    const y = rate => bottom - Math.min(max,rate) / max * (bottom-top);
    ctx.font = '8px Arial'; ctx.fillStyle = muted; ctx.lineWidth = 1;
    for (const rate of [adaptive.state.target,60]) {
      ctx.strokeStyle = rate === adaptive.state.target ? accent : line; ctx.setLineDash([3,4]);
      ctx.beginPath(); ctx.moveTo(left,y(rate)); ctx.lineTo(width,y(rate)); ctx.stroke();
      ctx.fillText(String(rate),0,y(rate)+3);
    }
    ctx.setLineDash([]); ctx.strokeStyle = accent; ctx.lineWidth = 1.6;
    if (history.length) {
      ctx.beginPath();
      history.forEach((point,index) => {
        const x = left + index / Math.max(1,history.length-1) * (width-left-4);
        if (!index) ctx.moveTo(x,y(point.fps)); else ctx.lineTo(x,y(point.fps));
      });
      ctx.stroke();
      const latest = history.at(-1).fps;
      ctx.fillStyle = accent; ctx.beginPath();ctx.arc(width-4,y(latest),2.5,0,Math.PI*2);ctx.fill();
      graph.setAttribute('aria-label', `Recent frame rate, latest ${Math.round(latest)} FPS. Target ${adaptive.state.target} FPS.`);
    }
  }

  function showRecommendation(state) {
    element.dataset.qualityMode = state.mode;
    const profile = state.recommended;
    const chosen = `${names[profile.shadow]} shadows at ${profile.scale}×`;
    const measured = state.fps === null ? '' : `Measured ${Math.round(state.fps)} FPS. `;
    if (state.mode === 'manual') {
      status.textContent = 'Your settings';
      recommendation.textContent = state.fps === null ? 'Automatic adjustment is paused. Choose any scale or shadow level.' : `Browser recommendation: ${chosen}. ${measured}Automatic adjustment is paused.`;
    } else if (state.measuring) {
      status.textContent = 'Adjusting graphics';
      recommendation.textContent = `Testing ${names[state.profile.shadow]} shadows at ${state.profile.scale}×. Aiming for ${state.target} FPS; shadows take priority over resolution.`;
    } else {
      status.textContent = state.fps === null ? 'Ready to view' : 'Configured for this browser';
      recommendation.textContent = `${chosen}. ${measured}Aiming for ${state.target} FPS; quality checks start only after a sustained slowdown.`;
    }
    const targetLabel = element.querySelector('.settings-graph-labels span:last-child');
    if (targetLabel) targetLabel.textContent = `Target ${state.target} FPS`;
    if (state.measuring) showNotice('Adjusting graphics for smoother viewing…','Picture quality may change briefly.');
    else if (!state.enabled) clearNotice();
    else if (previousState?.measuring && state.reason === 'complete') {
      saveSettings({automatic:true,renderScale:pixelRatio,shadowQuality:Number(shadows.value)});
      showNotice('Graphics adjusted for this browser.','',true);
    }
    previousState = state;
  }

  const adaptive = createAdaptiveQuality({
    onApply(profile) { pixelRatio = profile.scale; updateScale(); setShadows(profile.shadow); resetMeter(); invalidate(); },
    onChange:showRecommendation,
  });
  function manual() {
    automatic.checked = false;
    adaptive.manual();
  }
  function startBenchmark() {
    automatic.checked = true;
    resetMeter();
    saveSettings({automatic:true});
    adaptive.start(performance.now());
    invalidate();
  }
  function resetSampling(now = performance.now()) {
    resetMeter();
    adaptive.resetSamples(now);
  }

  const listen = (target, type, handler) => target.addEventListener(type, handler, {signal:lifetime.signal});
  listen(scale, 'input', () => {
    manual();
    pixelRatio = Math.max(.5, Math.min(2, Number(scale.value) / 100));
    updateScale();
    resetMeter();
    saveSettings({automatic:false,renderScale:pixelRatio,shadowQuality:Number(shadows.value)});
    invalidate();
  });
  presets.forEach(button => listen(button, 'click', () => {
    manual(); pixelRatio = Number(button.dataset.renderScale)/100;
    updateScale(); resetMeter();
    saveSettings({automatic:false,renderScale:pixelRatio,shadowQuality:Number(shadows.value)});
    invalidate();
  }));
  listen(shadows, 'input', () => {
    manual(); setShadows(shadows.value); resetMeter();
    saveSettings({automatic:false,renderScale:pixelRatio,shadowQuality:Number(shadows.value)});
    invalidate();
  });
  listen(automatic, 'change', () => {
    if (automatic.checked) adaptive.restore({scale:pixelRatio,shadow:Number(shadows.value)},performance.now());
    else manual();
    saveSettings({automatic:automatic.checked,renderScale:pixelRatio,shadowQuality:Number(shadows.value)});
    invalidate();
  });
  listen(benchmark, 'click', startBenchmark);
  listen(live, 'change', () => { saveSettings({liveFps:live.checked}); resetSampling(); invalidate(); });
  if (inspection) listen(inspection,'change',() => {
    inspectionDetail = inspection.checked;
    saveSettings({inspectionDetail}); resetSampling(); invalidate();
  });
  listen(document, 'visibilitychange', () => { resetSampling(); if (continuous()) invalidate(); });
  clearNotice();
  adaptive.restore({scale:pixelRatio,shadow:Number(saved.shadowQuality)},performance.now(),{enabled:automatic.checked});
  try { unsubscribeSettings = settingsStore?.subscribe(next => {
    // Trial profiles are deliberately not stored until a probe completes.
    // An unrelated preference write must not restore the older saved quality.
    const changedProfile = next.renderScale !== saved.renderScale || next.shadowQuality !== saved.shadowQuality;
    const changedMode = next.automatic !== saved.automatic;
    const changedDetail = next.inspectionDetail !== saved.inspectionDetail;
    const changedLive = next.liveFps !== saved.liveFps;
    const applyProfile = changedProfile && (next.renderScale !== pixelRatio || next.shadowQuality !== Number(shadows.value));
    const applyMode = changedMode && next.automatic !== automatic.checked;
    saved = {...saved,...next};
    automatic.checked = next.automatic;
    live.checked = next.liveFps;
    inspectionDetail = next.inspectionDetail;
    if (inspection) inspection.checked = inspectionDetail;
    if (applyProfile || applyMode) {
      pixelRatio = next.renderScale;
      adaptive.restore({scale:pixelRatio,shadow:next.shadowQuality},performance.now(),{enabled:next.automatic});
    }
    if (changedDetail || changedLive) resetSampling();
    if (changedProfile || changedMode || changedDetail || changedLive) invalidate();
  }); } catch { /* A missing preference subscription does not block the scene. */ }
  element.hidden = false;

  return {
    element,
    get pixelRatio() { return pixelRatio; },
    get inspectionDetail() { return inspectionDetail; },
    get continuous() { return continuous(); },
    resetSampling,
    setPanelOpen(open) { panelOpen = Boolean(open); resetSampling(); drawGraph(); invalidate(); },
    frame(now,{active = false} = {}) {
      if (destroyed) return;
      if (document.hidden || !Number.isFinite(now) || (lastFrame !== null && now <= lastFrame)) { resetSampling(Number.isFinite(now) ? now : performance.now()); return; }
      const shouldSample = active || continuous();
      if (!shouldSample) { resetMeter(); adaptive.resetSamples(); return; }
      if (!sampling) { sampleStart = null; frames = 0; }
      sampling = true;
      lastFrame = now;
      if (sampleStart === null) { sampleStart = now; return; }
      frames++;
      const elapsed = now - sampleStart;
      if (elapsed < 800) return;
      const rate = frames * 1000 / elapsed;
      fps.textContent = rate < 10 ? rate.toFixed(1) : String(Math.round(rate));
      fps.title = 'Rendered frames per second, averaged over the latest measurement window.';
      history.push({fps:rate});
      if (history.length > 75) history.shift();
      adaptive.sample(rate, now);
      drawGraph();
      sampleStart = now;
      frames = 0;
    },
    destroy() { destroyed = true; clearNotice(); adaptive.manual(); unsubscribeSettings?.(); lifetime.abort(); element.hidden = true; },
  };
}
