const RECORDING_MS = 10_000;
const MAX_SAMPLES = 100_000;

export const effectControls = [
  { key: 'shadows', label: 'Shadows', help: 'Card box shadows.', className: 'nest-perf-no-shadows' },
  { key: 'colorize', label: 'Image colorize', help: 'Artwork color filter.', className: 'nest-perf-no-colorize' },
  { key: 'texture', label: 'Paper texture', help: 'Card paper texture overlays.', className: 'nest-perf-no-texture' },
  { key: 'rim', label: 'Card rim', help: 'Decorative card rim overlay.', className: 'nest-perf-no-rim' },
  { key: 'inventoryBlur', label: 'Inventory blur', help: 'Blur behind the inventory.', className: 'nest-perf-no-inventory-blur' },
];

/** Nearest-rank p95; reject values outside a possible ten-second recording. */
export function summarizeFrameIntervals(intervals) {
  if (!Array.isArray(intervals)) return null;
  const valid = intervals.slice(0, MAX_SAMPLES).filter(value =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= RECORDING_MS);
  if (!valid.length) return null;
  const meanMs = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  const sorted = [...valid].sort((a, b) => a - b);
  return {
    samples: valid.length,
    meanMs,
    p95Ms: sorted[Math.ceil(valid.length * .95) - 1],
    cadenceHz: 1000 / meanMs,
    longGaps: valid.filter(value => value > 33.3).length,
  };
}

/** Session-only CSS comparison. This never updates the preview or its deck. */
export function mountPerformanceTuning(root, preview) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const classes = doc.documentElement.classList;
  const controls = root.querySelector('[data-performance-controls]');
  const status = root.querySelector('[data-performance-status]');
  const report = root.querySelector('[data-performance-report]');
  const recordButton = root.querySelector('[data-performance-record]');
  const stopButton = root.querySelector('[data-performance-stop]');
  const fields = new Map();
  const listeners = [];
  const reports = [];
  let recording = null;
  let disposed = false;
  const listen = (element, event, handler) => {
    if (!element) return;
    element.addEventListener(event, handler);
    listeners.push(() => element.removeEventListener(event, handler));
  };
  const selectedEffects = () => Object.fromEntries(effectControls.map(({ key }) => [key, fields.get(key).checked]));
  const setRecordingUI = active => {
    recordButton.disabled = active;
    if (stopButton) stopButton.disabled = !active;
  };
  const finish = (reason = 'complete') => {
    if (!recording) return;
    const run = recording;
    recording = null;
    win.cancelAnimationFrame(run.frame);
    win.clearTimeout(run.timer);
    setRecordingUI(false);
    const summary = summarizeFrameIntervals(run.intervals);
    const result = [
      'Nest effect comparison — active animation/input RAF cadence estimate',
      `Result: ${reason}`,
      `Effects enabled: ${effectControls.filter(({ key }) => run.effects[key]).map(({ label }) => label).join(', ') || 'none'}`,
      `User agent: ${run.userAgent}`,
      `Viewport: ${run.width} × ${run.height}; DPR: ${run.dpr}`,
      `Chapter: ${run.chapter}; choice cards at start: ${run.cardCount}`,
      `Active-motion interval samples: ${summary?.samples || 0}`,
      ...(summary ? [
        `Mean interval: ${summary.meanMs.toFixed(2)} ms`,
        `p95 interval (nearest rank): ${summary.p95Ms.toFixed(2)} ms`,
        `RAF cadence estimate: ${summary.cadenceHz.toFixed(1)} callbacks/s`,
        `Gaps > 33.3 ms: ${summary.longGaps}`,
      ] : ['Insufficient active-motion samples. Drag or animate cards during recording.']),
      'Only consecutive visible callbacks during motion of the same deck are included; idle gaps are excluded.',
      'This is not device profiling, GPU timing, or proof of rendered FPS. Display refresh rate is not assumed.',
    ].join('\n');
    reports.push(result);
    if (reports.length > 5) reports.shift();
    report.value = reports.join('\n\n---\n\n');
    status.textContent = `Recording ${reason}. ${summary?.samples || 0} active-motion interval samples.`;
  };
  const apply = () => {
    for (const { key, className } of effectControls) classes.toggle(className, !fields.get(key).checked);
  };
  for (const { key, label, help } of effectControls) {
    const row = doc.createElement('label');
    row.className = 'performance-effect';
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset.performanceEffect = key;
    const text = doc.createElement('span');
    text.textContent = label;
    const detail = doc.createElement('small');
    detail.textContent = help;
    row.append(input, text, detail);
    controls.append(row);
    fields.set(key, input);
    listen(input, 'change', () => {
      finish('interrupted: effects changed');
      apply();
      status.textContent = 'Effects updated for this session. Earlier reports keep their recorded settings.';
    });
  }
  const preset = enabled => {
    finish('interrupted: preset changed');
    for (const input of fields.values()) input.checked = enabled;
    apply();
    status.textContent = enabled ? 'Current effects enabled.' : 'Light preset enabled.';
  };
  listen(root.querySelector('[data-performance-original]'), 'click', () => preset(true));
  listen(root.querySelector('[data-performance-light]'), 'click', () => preset(false));
  listen(recordButton, 'click', () => {
    if (disposed || recording) return;
    if (doc.hidden) { status.textContent = 'Show this page before recording.'; return; }
    const run = {
      intervals: [], previous: null, frame: 0, timer: 0,
      effects: selectedEffects(), userAgent: win.navigator.userAgent,
      width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio,
      chapter: preview.chapterId || 'unavailable', cardCount: preview.deck?.cards?.length ?? 'unavailable',
    };
    recording = run;
    const tick = timestamp => {
      if (recording !== run) return;
      if (doc.hidden) { finish('interrupted: page hidden'); return; }
      const deck = preview.deck;
      const active = deck && !deck.destroyed && (deck.drag || deck.frame || deck.commitMotion || deck.collectMotion || deck.openingCommit || deck.openingReturn);
      if (active && Number.isFinite(timestamp)) {
        if (run.previous?.deck === deck && run.intervals.length < MAX_SAMPLES) {
          const interval = timestamp - run.previous.timestamp;
          if (interval > 0 && interval <= RECORDING_MS) run.intervals.push(interval);
        }
        run.previous = { deck, timestamp };
      } else run.previous = null;
      run.frame = win.requestAnimationFrame(tick);
    };
    setRecordingUI(true);
    status.textContent = 'Recording for 10 seconds. Drag or animate cards now.';
    run.frame = win.requestAnimationFrame(tick);
    run.timer = win.setTimeout(() => finish(), RECORDING_MS);
  });
  listen(stopButton, 'click', () => finish('interrupted: stopped manually'));
  listen(doc, 'visibilitychange', () => finish('interrupted: page visibility changed'));
  report.readOnly = true;
  apply();
  setRecordingUI(false);
  status.textContent = 'Current effects enabled. Changes last for this session.';
  if (new URLSearchParams(win.location.search).get('perf') === '1') root.open = true;
  return () => {
    if (disposed) return;
    finish('interrupted: panel removed');
    disposed = true;
    for (const remove of listeners) remove();
    for (const { className } of effectControls) classes.remove(className);
    controls.replaceChildren();
  };
}
