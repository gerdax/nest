/** Reduce internal diagnostics to the events useful for drawer timing. */
export function createDrawerTraceFilter() {
  let visible = false, revealing = false, content = null, blockers = null, ready = false;
  let hideReason = 'left item context';
  let milestoneRevision = null, exposedReported = false, visualReported = false, settledReported = false, milestonesSuppressed = false;
  return (event, data = {}) => {
    const entries = [];
    const begin = id => {
      revealing = true; content = id; blockers = null; ready = false;
      entries.push({ label: 'Card reveal started', resetTime: true });
    };
    if (event === 'CardDeck.emit(reveal)' && data.interaction === 'container') begin(data.contentId);
    if (event === 'CardDeck.emit(collect)') hideReason = data.final ? 'collected last item' : 'left item context';
    if (event === 'CardDeck.emit(discard)') hideReason = 'discarded';
    if (Array.isArray(data.blockers)) {
      const itemContext = data.interaction === 'container' || !data.blockers.includes('not an item context');
      if (itemContext && data.open && !visible && data.phase !== 'ended'
        && !data.blockers.includes('no displayed items') && (!revealing || content !== data.content)) begin(data.content);
      if (data.revision !== milestoneRevision) {
        milestoneRevision = data.revision; exposedReported = visualReported = settledReported = false;
        milestonesSuppressed = visible && data.preserveContext === true;
      }
      if (!milestonesSuppressed && itemContext && data.open && data.itemsExposed && !exposedReported) {
        exposedReported = true; entries.push({ label: 'Items exposed' });
      }
      if (!milestonesSuppressed && itemContext && data.open && data.visualReady && !visualReported) {
        visualReported = true; entries.push({ label: 'Card visually ready' });
      }
      if (!milestonesSuppressed && itemContext && data.open && data.fullySettled && !settledReported) {
        settledReported = true; entries.push({ label: 'Card fully settled' });
      }
      if (revealing && !visible && itemContext) {
        const reasons = data.blockers.join(', ');
        if (reasons && reasons !== blockers) {
          entries.push({ label: 'Drawer blocked', detail: reasons }); ready = false;
        } else if (!reasons && !ready) {
          entries.push({ label: 'Drawer ready' }); ready = true;
        }
        blockers = reasons;
      }
    }
    if (event === 'InventoryView.setContext:applied' || event === 'dom-visibility') {
      const nextVisible = data.visible === true;
      if (nextVisible && !visible) {
        entries.push({ label: 'Drawer shown' }); hideReason = 'left item context';
      } else if (!nextVisible && visible) {
        entries.push({ label: 'Drawer hidden', detail: hideReason }); revealing = false;
      }
      visible = nextVisible;
    }
    if (event === 'first-visible-frame') entries.push({ label: 'First visible frame' });
    if (event === 'entrance-started') entries.push({ label: 'Entrance started' });
    if (event === 'entrance-finished') entries.push({ label: 'Entrance finished' });
    if (event === 'entrance-interrupted') entries.push({ label: 'Entrance interrupted' });
    if (event === 'exit-started') entries.push({ label: 'Exit started' });
    if (event === 'exit-finished') entries.push({ label: 'Exit finished' });
    if (event === 'exit-interrupted') entries.push({ label: 'Exit interrupted' });
    if (event === 'animationstart') entries.push({ label: 'Entrance started' });
    if (event === 'animationend') entries.push({ label: 'Entrance finished' });
    if (event === 'animationcancel') entries.push({ label: 'Entrance interrupted' });
    return entries;
  };
}

/** Opening the panel enables sampling; closing it stops all observation. */
export function mountDrawerDebug(preview) {
  const panel = document.createElement('details');
  panel.dataset.drawerDebug = '';
  panel.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:90;box-sizing:border-box;width:max-content;max-width:calc(100vw - 24px);padding:8px 10px;background:#15191f;color:#edf2f7;border:1px solid #657080;border-radius:6px;box-shadow:0 3px 16px #0006;font:12px/1.45 monospace;text-align:left;';
  const summary = document.createElement('summary');
  summary.textContent = 'Drawer trace';
  summary.style.cssText = 'cursor:pointer;user-select:none;';
  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:8px;margin:8px 0;';
  const clear = document.createElement('button'), copy = document.createElement('button');
  for (const [button, label] of [[clear, 'Clear'], [copy, 'Copy']]) {
    button.type = 'button'; button.textContent = label;
    button.style.cssText = 'font:inherit;color:#edf2f7;background:#303946;border:1px solid #657080;border-radius:3px;padding:3px 8px;cursor:pointer;';
    controls.append(button);
  }
  const output = document.createElement('pre');
  output.style.cssText = 'box-sizing:border-box;width:min(560px, calc(100vw - 46px));max-width:100%;max-height:300px;overflow:auto;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;color:inherit;background:transparent;';
  panel.append(summary, controls, output); document.body.append(panel);
  const rows = [];
  let enabled = false, disposed = false, started = 0, previous = 0, observer = null, frame = null, drawer = null;
  let filter = createDrawerTraceFilter(), visibleFrameRecorded = false;
  const log = (event, data) => {
    if (!enabled || !panel.open || disposed) return;
    for (const entry of filter(event, data)) {
      const now = performance.now();
      if (entry.resetTime) { started = previous = now; visibleFrameRecorded = false; }
      rows.push(`+${(now - started).toFixed(0)} ms  (${(now - previous).toFixed(0)} ms later)\n${entry.label}${entry.detail ? ` — ${entry.detail}` : ''}`);
      previous = now;
      if (rows.length > 150) rows.shift();
      output.textContent = rows.join('\n\n'); output.scrollTop = output.scrollHeight;
    }
    if (event === 'InventoryView.setContext:applied') {
      if (data.visible) nextFrame(); else visibleFrameRecorded = false;
    }
  };
  const nextFrame = () => {
    if (frame !== null || visibleFrameRecorded || !enabled || !drawer || drawer.hidden) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!enabled || !panel.open || !drawer || drawer.hidden) return;
      const style = getComputedStyle(drawer), rect = drawer.getBoundingClientRect();
      if (style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0) {
        visibleFrameRecorded = true; log('first-visible-frame');
      } else if (drawer.getAnimations().some(animation => animation.playState === 'running' || animation.playState === 'pending')) nextFrame();
    });
  };
  const animation = event => {
    if (event.target !== drawer || event.animationName !== 'nest-inventory-enter') return;
    log(event.type); nextFrame();
  };
  const animationEvents = ['animationstart', 'animationend', 'animationcancel'];
  const disable = () => {
    enabled = false; preview.drawerTrace = null;
    observer?.disconnect(); observer = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (drawer) for (const event of animationEvents) drawer.removeEventListener(event, animation);
    drawer = null;
  };
  const toggle = () => {
    if (disposed) return;
    if (!panel.open) { disable(); return; }
    if (enabled) return;
    enabled = true; started = previous = performance.now();
    filter = createDrawerTraceFilter(); visibleFrameRecorded = false;
    preview.drawerTrace = log;
    drawer = preview.inventory?.root ?? null;
    preview.deck?.pickup?.traceReadiness('Drawer trace:opened');
    if (drawer) {
      log('dom-visibility', { visible: !drawer.hidden });
      observer = new MutationObserver(() => {
        if (!enabled || !panel.open) return;
        log('dom-visibility', { visible: !drawer.hidden });
        if (drawer.hidden) visibleFrameRecorded = false; else nextFrame();
      });
      observer.observe(drawer, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
      for (const event of animationEvents) drawer.addEventListener(event, animation);
      nextFrame();
    }
  };
  const clearRows = () => { rows.length = 0; output.textContent = ''; started = previous = performance.now(); };
  const copyRows = async () => {
    try { await navigator.clipboard.writeText(rows.join('\n\n')); copy.textContent = 'Copied'; }
    catch { copy.textContent = 'Copy failed'; }
  };
  panel.addEventListener('toggle', toggle); clear.addEventListener('click', clearRows); copy.addEventListener('click', copyRows);
  return () => {
    if (disposed) return;
    disable(); disposed = true;
    panel.removeEventListener('toggle', toggle); clear.removeEventListener('click', clearRows); copy.removeEventListener('click', copyRows); panel.remove();
  };
}
