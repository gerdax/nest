import { CardDeck } from '../../engine/CardDeck.js';
import { InventoryView } from '../../studio/InventoryView.js';
import { InventorySurface } from '../../studio/InventorySurface.js';

const stage = document.querySelector('#stage');
const mount = document.querySelector('#deck');
const report = document.querySelector('#report');
const status = document.querySelector('#status');
const run = document.querySelector('#run');
const FRAMES = 48;
// Renderer artwork resolves against the host document, which in this fixture
// lives below /tests/fixtures rather than beside the production HTML hosts.
const cardBack = { background: new URL('../../assets/img/ui/cardback.png', import.meta.url).href,
  icons: { default: new URL('../../assets/img/ui/default.png', import.meta.url).href } };
const scenarios = ['closed-cover-vertical', 'open-choice-vertical', 'open-choice-horizontal', 'container-down-reversal'];
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const round = n => Math.round(n * 1000) / 1000;
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, total: round(values.reduce((a, b) => a + b, 0)),
    mean: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
    p95: sorted.length ? round(sorted[Math.ceil(sorted.length * .95) - 1]) : 0,
    max: sorted.length ? round(sorted.at(-1)) : 0 };
}
function snapshot(deck, inventory) {
  return { state: deck.state, p: deck.p.x, b: deck.b.x, l: deck.l.x, fan: deck.fan.x,
    dragAxis: deck.drag?.axis ?? null, pickupTarget: deck.pickup?.target ? {
      slot: deck.pickup.target.slot, snapped: deck.pickup.target.snapped } : null,
    pickupMix: deck.pickup?.mix.x ?? null, drawerVisible: inventory.visible,
    previewCount: stage.querySelectorAll('.nest-inventory-drag-preview').length,
    cardTransforms: deck.cards.map(card => card.style.transform) };
}
async function settle(deck, inventory) {
  const start = performance.now();
  let quiet = 0;
  while (performance.now() - start < 4000) {
    await frame();
    if (!deck.frame && !deck.busy && !inventory.motion.animation) quiet++; else quiet = 0;
    if (quiet >= 3) return { elapsedMs: round(performance.now() - start), settled: true };
  }
  throw new Error('Deck/drawer did not settle within the fixture timeout');
}
function createScenario(name) {
  const drawer = document.createElement('div');
  const surface = new InventorySurface({ container: stage });
  surface.mount(drawer);
  const inventory = new InventoryView(drawer, { getBounds: () => surface.bounds() });
  inventory.update([{ id: 'owned-1', name: 'Owned rope' }]);
  const isContainer = name.startsWith('container');
  const deck = new CardDeck(mount, { content: {
    id: name, title: 'Gesture benchmark', text: 'Deterministic logical gesture path.',
    cardBack,
    interaction: isContainer ? 'container' : 'choice', discardAll: isContainer,
    actions: [0, 1, 2].map(i => ({ id: `action-${i}`, label: `Action ${i + 1}`, text: `Benchmark card ${i + 1}` }))
  }, inventoryDrawer: isContainer ? {
    getTarget: options => inventory.getTarget(options),
    preview: target => inventory.preview(target),
    presentPreview: (element, bounds) => surface.presentPreview(element, bounds),
    setContext: visible => inventory.setContext(visible),
    cancelPending: () => inventory.cancelPending(),
    clearDeposit: () => inventory.clearDeposit(),
    authorize: async () => false,
    slotTarget: slot => inventory.slotTarget(slot)
  } : null });
  // Browser preference is recorded below; use the same spring path in both origins.
  deck.reduced = false;
  const events = [];
  for (const type of ['reveal', 'close', 'selection', 'commit', 'collect', 'discard', 'transitioncomplete', 'inventoryerror']) {
    deck.addEventListener(type, event => events.push({ type, transition: event.detail.transition ?? null, actionId: event.detail.actionId ?? null }));
  }
  return { deck, inventory, surface, events, destroy() { deck.destroy(); inventory.destroy(); surface.destroy(); drawer.remove(); } };
}
function gesture(name, progress, target) {
  const wave = Math.sin(Math.PI * progress);
  const axis = name.endsWith('horizontal') ? 'x' : 'y';
  // First half enters a real drawer slot; second half reverses upward out of it.
  const y = name.startsWith('container') ? 135 * Math.sin(2 * Math.PI * progress) : -90 * wave;
  return { axis, x: axis === 'x' ? -65 * wave : 0, y: axis === 'y' ? y : 0,
    vx: 0, vy: 0, clientX: target.left + target.width / 2,
    clientY: y > 0 ? target.top + target.height * .65 : target.top - target.height * 2 };
}
async function motion(context, name, samples, frames) {
  const { deck, inventory, surface, events } = context;
  const calls = { deckRender: [], pickupRender: [], drawerPreview: [], move: [] };
  // Wrappers are installed once per scenario; replace metric arrays between phases.
  context.metrics = calls;
  const mutations = { attributes: 0, childList: 0, characterData: 0, addedNodes: 0, removedNodes: 0, byRegion: { deck: 0, drawerAndPreview: 0 } };
  const consume = records => { for (const record of records) {
    mutations[record.type]++;
    if (record.type === 'childList') { mutations.addedNodes += record.addedNodes.length; mutations.removedNodes += record.removedNodes.length; }
    mutations.byRegion[mount.contains(record.target) || record.target === mount ? 'deck' : 'drawerAndPreview']++;
  } };
  const observer = new MutationObserver(consume);
  // start() and first-use lifecycle writes are reported separately from motion.
  observer.observe(mount, { subtree: true, attributes: true, childList: true, characterData: true });
  observer.observe(surface.frame, { subtree: true, attributes: true, childList: true, characterData: true });
  const beforeEvents = events.length;
  if (!deck.start()) throw new Error(`start rejected for ${name}`);
  consume(observer.takeRecords());
  const startMutations = structuredClone(mutations);
  for (const key of ['attributes', 'childList', 'characterData', 'addedNodes', 'removedNodes']) mutations[key] = 0;
  mutations.byRegion = { deck: 0, drawerAndPreview: 0 };
  const target = inventory.slotTarget(1).rect;
  const intervals = [];
  let targetedSamples = 0, snappedSamples = 0, hiddenDuringMotion = document.hidden;
  let previous = await frame();
  const started = performance.now();
  for (let i = 0; i < frames; i++) {
    const now = await frame(); intervals.push(now - previous); previous = now;
    hiddenDuringMotion ||= document.hidden;
    for (let sample = 1; sample <= samples; sample++) {
      const g = gesture(name, (i + sample / samples) / frames, target);
      const start = performance.now(); deck.move(g); calls.move.push(performance.now() - start);
      if (deck.pickup?.target) { targetedSamples++; if (deck.pickup.target.snapped) snappedSamples++; }
    }
  }
  // Flush the render scheduled by the final move before ending measurement.
  await frame();
  consume(observer.takeRecords()); observer.disconnect();
  const motionElapsedMs = round(performance.now() - started);
  const finalPose = snapshot(deck, inventory);
  const motionEvents = events.slice(beforeEvents);
  context.metrics = null;
  deck.cancel();
  const settlement = await settle(deck, inventory);
  return { samplesPerFrame: samples, frames, moveSamples: frames * samples,
    elapsedMs: motionElapsedMs, targetedSamples, snappedSamples, hiddenDuringMotion,
    mutationRecords: mutations, gestureStartMutationRecords: startMutations,
    timingsMs: Object.fromEntries(Object.entries(calls).map(([key, values]) => [key, summary(values)])),
    frameIntervalsMs: summary(intervals), finalPose, motionEvents, settlement,
    settledPose: snapshot(deck, inventory), eventsAfterCancel: events.slice(beforeEvents),
    acceptedActionEvents: events.slice(beforeEvents).filter(e => ['commit', 'collect', 'discard'].includes(e.type)).length };
}
async function benchmark() {
  run.disabled = true;
  const output = { method: 'native DOM MutationObserver records; inclusive synchronous method CPU via performance.now; requestAnimationFrame timestamps',
    environment: { url: location.href, userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio,
      reducedMotionPreference: matchMedia('(prefers-reduced-motion: reduce)').matches, deckReducedMotionOverride: false },
    workload: { framesPerScenario: FRAMES, densities: [1, 4, 8], scenarios,
      notes: 'Same continuous logical path and frame-end sample at each density. Extra intermediate synchronous samples do not model physical input dispatch, compositor latency or guarantee FPS. Render CPU is inclusive; deckRender includes pickupRender. Mutation counts include same-value attribute writes. Start, warmup, cancellation and settlement excluded from steady motion. Container warmup exercises staging; per-gesture preview creation/removal remains included. No end/release acceptance is requested.' },
    results: [] };
  report.textContent = JSON.stringify(output, null, 2);
  try {
    for (const url of [cardBack.background, cardBack.icons.default]) {
      const image = new Image(); image.src = url; await image.decode();
    }
    await document.fonts.ready;
    for (const name of scenarios) {
      for (const samples of [1, 4, 8]) {
        status.textContent = `Running ${name}, ${samples} samples/frame…`;
        const context = createScenario(name);
        try {
          for (const [object, method, key] of [[context.deck, 'render', 'deckRender'], [context.deck.pickup, 'render', 'pickupRender'], [context.inventory, 'preview', 'drawerPreview']]) {
            if (!object) continue;
            const original = object[method];
            object[method] = function (...args) {
              if (!context.metrics) return original.apply(this, args);
              const start = performance.now();
              try { return original.apply(this, args); }
              finally { context.metrics?.[key].push(performance.now() - start); }
            };
          }
          await settle(context.deck, context.inventory);
          if (name !== 'closed-cover-vertical') { context.deck.setOpen(true); context.deck.schedule(); await settle(context.deck, context.inventory); }
          const warmup = await motion(context, name, samples, 8);
          const measured = await motion(context, name, samples, FRAMES);
          output.results.push({ scenario: name, warmup, measured });
          report.textContent = JSON.stringify(output, null, 2);
        } finally { context.destroy(); }
      }
    }
    output.completed = true;
    output.valid = !document.hidden && output.results.every(r => r.measured.acceptedActionEvents === 0 && r.measured.settlement.settled && !r.measured.hiddenDuringMotion
      && (!r.scenario.startsWith('container') || r.measured.targetedSamples > 0));
    status.textContent = output.valid ? 'Completed. JSON report below.' : 'Completed with validation failure; inspect report.';
  } catch (error) { output.error = error.stack || error.message; status.textContent = `Failed: ${error.message}`; }
  finally { output.environment.visibleAtEnd = !document.hidden; report.textContent = JSON.stringify(output, null, 2); run.disabled = false; }
}
run.addEventListener('click', benchmark);
