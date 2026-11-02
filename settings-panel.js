// Non-modal scene settings: the page stays interactive while this panel is open.
// Performance and offline work are supplied by their own modules.
export function createSettingsPanel({element = document.querySelector('#settings-panel'), settingsStore = null, onLeaf = () => {}, onOpenChange = () => {}, onTabChange = () => {}, onGroundMovementChange = () => {}} = {}) {
  const toggle = document.querySelector('#settings-toggle');
  const closeButton = element.querySelector('#settings-close');
  const actions = document.querySelector('#scene-actions');
  const leaf = document.querySelector('#leaf-trigger');
  const offline = element.querySelector('#offline-state');
  const offlineStatus = element.querySelector('#offline-status');
  const offlineMode = element.querySelector('#offline-installed');
  const offlineProgress = element.querySelector('#offline-progress');
  const offlineProgressLabel = element.querySelector('#offline-progress-label');
  const groundMovement = element.querySelector('#ground-movement');
  const storageNote = element.querySelector('#settings-storage-note');
  const tabs = [...(element.querySelectorAll?.('[role="tab"]') ?? [])];
  const lifetime = new AbortController();
  let opened = false;
  let activeTab = 'general';
  let offlineState = {status:'preparing', message:'Preparing offline access…', cached:0, total:0, installed:false};

  function setOpen(next, {restoreFocus = true} = {}) {
    const value = Boolean(next);
    if (opened === value) return;
    opened = value;
    element.hidden = !opened;
    toggle.setAttribute('aria-expanded', String(opened));
    toggle.setAttribute('aria-label', opened ? 'Close settings' : 'Open settings');
    if (opened) closeButton.focus({preventScroll:true});
    else if (restoreFocus) toggle.focus({preventScroll:true});
    onOpenChange(opened);
  }

  const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, {...options, signal:lifetime.signal});
  function selectTab(name,{focus = false} = {}) {
    if (!['general','advanced'].includes(name)) return;
    const changed = activeTab !== name;
    activeTab = name;
    for (const tab of tabs) {
      const selected = tab.id === `settings-${name}-tab`;
      tab.setAttribute('aria-selected',String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = element.querySelector(`#${tab.getAttribute('aria-controls')}`);
      if (panel) panel.hidden = !selected;
      if (selected && focus) tab.focus({preventScroll:true});
    }
    if (changed) onTabChange(activeTab);
  }
  tabs.forEach((tab,index) => {
    listen(tab,'click',() => selectTab(tab.id === 'settings-advanced-tab' ? 'advanced' : 'general'));
    listen(tab,'keydown',event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectTab(tabs[next].id === 'settings-advanced-tab' ? 'advanced' : 'general',{focus:true});
    });
  });
  listen(toggle, 'click', () => setOpen(!opened));
  listen(closeButton, 'click', () => setOpen(false));
  listen(leaf, 'click', () => onLeaf());
  listen(groundMovement, 'change', () => {
    settingsStore?.update({groundMovement:groundMovement.checked});
    onGroundMovementChange(groundMovement.checked);
  });
  // Capture Escape before the card's document listener so closing settings does
  // not also put an inspected card back on the shelf.
  listen(document, 'keydown', event => {
    if (!opened || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  }, {capture:true});
  listen(element, 'keydown', event => event.stopPropagation());
  listen(actions, 'keydown', event => {
    if (event.key.startsWith('Arrow')) event.stopPropagation();
  });
  function setOffline(next = {}) {
    offlineState = {...offlineState, ...next};
    const {status, message, installed} = offlineState;
    const cached = Math.max(0, Number(offlineState.cached) || 0);
    const total = Math.max(0, Number(offlineState.total) || 0);
    offline.dataset.status = status;
    offlineStatus.textContent = message || (status === 'ready' ? 'Ready to use offline.' : 'Preparing offline access…');
    offlineMode.textContent = installed ? 'Installed app' : 'Progressive web app';
    offlineProgress.max = Math.max(1, total);
    offlineProgress.value = Math.min(cached, total || 1);
    offlineProgress.setAttribute('aria-valuetext', `${cached} of ${total} files downloaded`);
    const showProgress = status === 'preparing' && total > 0;
    offlineProgress.hidden = !showProgress;
    offlineProgressLabel.hidden = !showProgress;
    offlineProgressLabel.textContent = `${cached} / ${total} files downloaded`;
  }

  function showSavedSettings(state = settingsStore?.state) {
    groundMovement.checked = state?.groundMovement ?? false;
    if (storageNote) {
      const message = settingsStore?.persistent ? 'Saved on this browser. No cookies.' : 'Settings are kept for this visit.';
      if (storageNote.textContent !== message) storageNote.textContent = message;
    }
  }

  element.hidden = true;
  selectTab('general');
  showSavedSettings();
  const unsubscribeSettings = settingsStore?.subscribe(showSavedSettings);
  toggle.setAttribute('aria-expanded', 'false');
  actions.hidden = false;
  setOffline();
  return {
    element,
    get open() { return opened; },
    get tab() { return activeTab; },
    selectTab,
    setOpen,
    show() { setOpen(true); },
    close(options) { setOpen(false, options); },
    setOffline,
    destroy() {
      setOpen(false, {restoreFocus:false});
      unsubscribeSettings?.();
      lifetime.abort();
      actions.hidden = true;
    },
  };
}
