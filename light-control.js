// A time-of-day control. Solar calculations and scene lighting belong to scene.js.
let controlSequence = 0;

const clampMinutes = value => Math.max(0, Math.min(1440, Math.round(Number(value) || 0)));
const formatMinutes = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function createLightControl({ onTimeChange = () => {}, onTimePreset = onTimeChange, onLive = () => {}, onIndoorChange = () => {}, motion = null } = {}) {
  const id = `light-time-${++controlSequence}`;
  const element = document.createElement('section');
  element.className = 'light-control';
  element.setAttribute('aria-label', 'Time and lighting in Newcastle');
  element.innerHTML = `
    <label class="light-control__sr-only" for="${id}">Time of day in Newcastle</label>
    <input class="light-control__range" id="${id}" type="range" min="0" max="1440" step="1" value="720">
    <div class="light-control__arc-wrap">
      <svg class="light-control__arc" viewBox="0 0 1000 180" aria-hidden="true">
        <path class="light-control__rail light-control__detail" d="M40 112 Q500 -10 960 112"/>
        <path class="light-control__hit" data-hit d="M40 112 Q500 -10 960 112"/>
      </svg>
      <span class="light-control__handle" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <g data-sun><circle cx="12" cy="12" r="4"/><path d="M12 1.5v2.2m0 16.6v2.2M1.5 12h2.2m16.6 0h2.2M4.6 4.6l1.6 1.6m11.6 11.6 1.6 1.6m0-14.8-1.6 1.6M6.2 17.8l-1.6 1.6"/></g>
          <g data-moon display="none"><path d="M20.7 15.1A9 9 0 0 1 8.9 3.3 9 9 0 1 0 20.7 15.1Z"/></g>
        </svg>
      </span>
      <button type="button" class="light-control__indoor" data-indoor aria-label="Indoor light" aria-hidden="true" aria-pressed="true" title="Turn indoor light off" disabled><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.8 15.5c-.2-1.2-.7-1.9-1.5-2.7a6 6 0 1 1 9.4 0c-.8.8-1.3 1.5-1.5 2.7M9 18h6m-5.2 3h4.4M9 15.5h6"/></svg></button>
      <div class="light-control__ticks light-control__detail">
        <button type="button" data-time-preset="0" style="--tick-x:4%;--tick-y:62.222%" aria-label="Set time to 00:00">00</button>
        <button type="button" data-time-preset="360" style="--tick-x:27%;--tick-y:36.806%" aria-label="Set time to 06:00">06</button>
        <button type="button" data-time-preset="720" style="--tick-x:50%;--tick-y:28.333%" aria-label="Set time to 12:00">12</button>
        <button type="button" data-time-preset="1080" style="--tick-x:73%;--tick-y:36.806%" aria-label="Set time to 18:00">18</button>
        <button type="button" data-time-preset="1440" style="--tick-x:96%;--tick-y:62.222%" aria-label="Set time to 24:00">24</button>
      </div>
      <div class="light-control__toolbar light-control__detail">
        <div class="light-control__readout"><output for="${id}" aria-live="off" data-time>12:00</output><span>Newcastle</span></div>
        <button type="button" class="light-control__live" data-live><span class="light-control__live-dot" aria-hidden="true"></span><span data-live-label>Live</span></button>
      </div>
      <div class="light-control__boundaries light-control__detail"><button type="button" data-sunrise disabled></button><button type="button" data-sunset disabled></button></div>
    </div>`;

  const range = element.querySelector('input');
  const hit = element.querySelector('[data-hit]');
  const arc = element.querySelector('.light-control__arc-wrap');
  const time = element.querySelector('[data-time]');
  const toolbar = element.querySelector('.light-control__toolbar');
  const live = element.querySelector('[data-live]');
  const liveLabel = element.querySelector('[data-live-label]');
  const indoor = element.querySelector('[data-indoor]');
  const sun = element.querySelector('[data-sun]');
  const moon = element.querySelector('[data-moon]');
  const sunrise = element.querySelector('[data-sunrise]');
  const sunset = element.querySelector('[data-sunset]');
  const timePresets = element.querySelectorAll('[data-time-preset]');
  const lifetime = new AbortController();
  let state = { minutes: 720, timeLabel: '12:00', isDay: true, isLive: true, indoorEnabled: true, sunriseLabel: '', sunsetLabel: '' };
  let pointerId = null;
  let fadeTimer;
  let relocationTimer;
  let relocating = false;
  let timeMoving = false;
  let indoorVisible = false;

  function setIndoorVisible(visible) {
    if (!visible && document.activeElement === indoor) range.focus({preventScroll:true});
    indoor.disabled = !visible;
    indoor.setAttribute('aria-hidden', String(!visible));
    if (visible === indoorVisible) return;
    indoorVisible = visible;
    // Resolve the tiny base state after mount, so the initial night entrance
    // also grows from a dot. CSS reverses from the current scale on scrubbing.
    if (visible) indoor.getBoundingClientRect();
    indoor.classList.toggle('is-present', visible);
  }

  function reveal() {
    clearTimeout(fadeTimer);
    element.classList.add('is-revealed');
    if (pointerId === null && !relocating && !timeMoving) fadeTimer = setTimeout(() => element.classList.remove('is-revealed'), motion?.duration('ui',900) ?? 900);
  }

  function render() {
    const t = state.minutes / 1440;
    const x = 40 + 920 * t;
    const y = 112 - 244 * t * (1 - t);
    element.style.setProperty('--light-handle-x', `${x / 10}%`);
    element.style.setProperty('--light-handle-y', `${y / 1.8}%`);
    // Place the satellite outside the curve, along its upward normal. Its
    // bearing changes with the handle, without running an idle animation.
    const slope = (488 * t - 244) / 920;
    const orbit = 54 / Math.hypot(1, slope);
    element.style.setProperty('--light-orbit-x', `${slope * orbit}px`);
    element.style.setProperty('--light-orbit-y', `${-orbit}px`);
    element.style.setProperty('--light-orbit-outward-x', t < .5 ? '-72px' : '72px');
    element.dataset.timeMode = state.isDay ? 'day' : 'night';
    range.value = String(state.minutes);
    range.setAttribute('aria-valuetext', `${state.timeLabel}, ${state.isDay ? 'daylight' : 'night'}, Newcastle${state.isLive ? ', live' : ''}`);
    time.textContent = state.timeLabel;
    liveLabel.textContent = state.isLive ? 'Live' : 'Return to now';
    live.classList.toggle('is-live', state.isLive);
    live.setAttribute('aria-label', state.isLive ? 'Current local time in Newcastle, live' : 'Return to the current local time in Newcastle');
    live.title = state.isLive ? 'Using the current local time' : 'Return to now';
    setIndoorVisible(!state.isDay);
    indoor.setAttribute('aria-pressed', String(state.indoorEnabled));
    indoor.title = state.indoorEnabled ? 'Turn indoor light off' : 'Turn indoor light on';
    sun.setAttribute('display', state.isDay ? 'inline' : 'none');
    moon.setAttribute('display', state.isDay ? 'none' : 'inline');
    for (const [button, event, label] of [[sunrise, 'sunrise', 'Sunrise'], [sunset, 'sunset', 'Sunset']]) {
      const timeLabel = state[`${event}Label`] || '—';
      button.textContent = `${label} ${timeLabel}`;
      button.disabled = !Number.isFinite(state[`${event}Minutes`]);
      button.setAttribute('aria-label', `Set time to ${event} at ${timeLabel} in Newcastle`);
    }
  }

  function chooseTime(value) {
    const minutes = clampMinutes(value);
    reveal();
    if (minutes === state.minutes && !state.isLive && !timeMoving) return;
    state = { ...state, minutes, timeLabel: formatMinutes(minutes), isLive: false };
    render();
    onTimeChange(minutes);
  }

  function minutesAt(clientX) {
    const bounds = arc.getBoundingClientRect();
    if (!bounds.width) return state.minutes;
    return clampMinutes(((clientX - bounds.left) / bounds.width * 1000 - 40) / 920 * 1440);
  }

  function finishPointer(event) {
    if (pointerId === null || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
    const previous = pointerId;
    pointerId = null;
    if (hit.hasPointerCapture(previous)) hit.releasePointerCapture(previous);
    element.classList.remove('is-dragging');
    reveal();
  }

  const listen = (target, type, listener, options = {}) => target.addEventListener(type, listener, { ...options, signal: lifetime.signal });
  listen(hit, 'pointerdown', event => {
    if (event.button !== 0 || pointerId !== null) return;
    event.preventDefault();
    event.stopPropagation();
    pointerId = event.pointerId;
    hit.setPointerCapture(pointerId);
    element.classList.add('is-dragging');
    range.focus({ preventScroll: true });
    chooseTime(minutesAt(event.clientX));
  });
  listen(hit, 'pointermove', event => {
    if (pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    chooseTime(minutesAt(event.clientX));
  });
  listen(hit, 'pointerup', event => {
    if (pointerId !== event.pointerId) return;
    chooseTime(minutesAt(event.clientX));
    finishPointer(event);
  });
  listen(hit, 'pointercancel', finishPointer);
  listen(hit, 'lostpointercapture', finishPointer);
  listen(window, 'pointerup', finishPointer);
  listen(window, 'pointercancel', finishPointer);
  listen(window, 'blur', () => finishPointer());
  listen(range, 'input', event => chooseTime(event.target.value));
  listen(range, 'change', reveal);
  for (const preset of timePresets) listen(preset, 'click', () => { reveal(); onTimePreset(Number(preset.dataset.timePreset)); });
  for (const [button, event] of [[sunrise, 'sunrise'], [sunset, 'sunset']]) listen(button, 'click', () => {
    const minutes = state[`${event}Minutes`];
    if (!Number.isFinite(minutes)) return;
    reveal();
    onTimePreset(minutes, state.date);
  });
  listen(element, 'focusin', reveal);
  listen(element, 'keydown', event => { event.stopPropagation(); reveal(); });
  listen(element, 'pointermove', reveal, { passive: true });
  listen(element, 'pointerenter', reveal, { passive: true });
  listen(window, 'pointermove', event => {
    if (pointerId !== null || event.pointerType === 'touch') return;
    const bounds = arc.getBoundingClientRect();
    if (!bounds.width || event.clientX < bounds.left - 30 || event.clientX > bounds.right + 30 || event.clientY < bounds.top - 30 || event.clientY > bounds.bottom + 30) return;
    const t = Math.max(0, Math.min(1, ((event.clientX - bounds.left) / bounds.width * 1000 - 40) / 920));
    const railY = bounds.top + (112 - 244 * t * (1 - t)) / 1000 * bounds.width;
    if (Math.abs(event.clientY - railY) < 42) reveal();
  }, { passive: true });
  listen(live, 'click', () => { reveal(); onLive(); });
  listen(indoor, 'click', () => {
    state = { ...state, indoorEnabled: !state.indoorEnabled };
    render();
    reveal();
    onIndoorChange(state.indoorEnabled);
  });

  render();
  return {
    element,
    cancelPointer() { finishPointer(); },
    setTimeMoving(moving) {
      if (timeMoving === Boolean(moving)) return;
      timeMoving = Boolean(moving);
      element.dataset.timeMotion = timeMoving ? 'moving' : 'idle';
      reveal();
    },
    relocate(duration = 950) {
      duration = motion?.duration('layout',duration) ?? duration;
      const wasVisible = element.classList.contains('is-revealed') || Number(getComputedStyle(toolbar).opacity) > .01;
      clearTimeout(relocationTimer);
      clearTimeout(fadeTimer);
      relocating = duration > 0;
      element.style.setProperty('--light-layout-duration', `${duration}ms`);
      if (wasVisible) reveal();
      if (relocating) relocationTimer = setTimeout(() => {
        relocating = false;
        if (element.classList.contains('is-revealed')) reveal();
      }, duration);
    },
    update(next = {}) {
      // Animated time retains sub-minute position precision; direct range and
      // pointer input still choose whole minutes through chooseTime().
      const minutes = next.minutes === undefined ? state.minutes : Math.max(0, Math.min(1440, Number(next.minutes) || 0));
      const timeLabel = next.timeLabel ?? (minutes !== state.minutes ? formatMinutes(minutes) : state.timeLabel);
      state = { ...state, ...next, minutes, timeLabel };
      render();
    },
    destroy() {
      lifetime.abort();
      clearTimeout(fadeTimer);
      clearTimeout(relocationTimer);
      if (pointerId !== null && hit.hasPointerCapture(pointerId)) hit.releasePointerCapture(pointerId);
      element.remove();
    },
  };
}
