import test from 'node:test';
import assert from 'node:assert/strict';
import { effectControls, mountPerformanceTuning, summarizeFrameIntervals } from '../player/performance-tuning.js';

test('interval summary filters invalid values, bounds input, and leaves source intact', () => {
  const values = [0, -1, NaN, Infinity, '16', null, 10_001, 10, 20, 40];
  const original = [...values];
  assert.deepEqual(summarizeFrameIntervals(values), {
    samples: 3, meanMs: 70 / 3, p95Ms: 40, cadenceHz: 1000 / (70 / 3), longGaps: 1,
  });
  assert.deepEqual(values, original);
  assert.equal(summarizeFrameIntervals([]), null);
  assert.equal(summarizeFrameIntervals([0, -1, Infinity]), null);
  assert.equal(summarizeFrameIntervals(null), null);
  assert.equal(summarizeFrameIntervals(Array(100_001).fill(10)).samples, 100_000);
});

test('nearest-rank p95 and strict long-gap boundary do not assume a 60 Hz display', () => {
  assert.equal(summarizeFrameIntervals(Array.from({ length: 20 }, (_, i) => i + 1)).p95Ms, 19);
  assert.equal(summarizeFrameIntervals([33.3, 33.31]).longGaps, 1);
  assert.equal(summarizeFrameIntervals([8, 8]).cadenceHz, 125);
});

// DOM-shaped lifecycle fixture, not a rendering or device test.
class Element extends EventTarget {
  constructor() {
    super(); this.children = []; this.value = ''; this.dataset = {};
    const values = new Set();
    this.classList = {
      toggle: (name, on) => on ? values.add(name) : values.delete(name),
      remove: name => values.delete(name), contains: name => values.has(name),
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
}
function fixture(search = '') {
  const doc = new Element(); doc.documentElement = new Element();
  doc.createElement = () => new Element();
  let nextId = 0;
  const frames = new Map(), timers = new Map();
  doc.defaultView = {
    location: { search }, navigator: { userAgent: 'test agent' }, innerWidth: 400, innerHeight: 800, devicePixelRatio: 2,
    requestAnimationFrame: callback => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (callback, delay) => { assert.equal(delay, 10_000); timers.set(++nextId, callback); return nextId; },
    clearTimeout: id => timers.delete(id),
  };
  const nodes = new Map();
  for (const name of ['controls', 'status', 'report', 'record', 'stop', 'original', 'light']) nodes.set(name, new Element());
  const root = new Element(); root.ownerDocument = doc;
  root.querySelector = selector => nodes.get(selector.match(/data-performance-(.*)\]/)[1]);
  const deck = { frame: 1, cards: [{}, {}] };
  const preview = { deck, chapterId: 'chapter-1', state: { untouched: true }, deckSettings: { mass: 1 } };
  const cleanup = mountPerformanceTuning(root, preview);
  const click = name => nodes.get(name).dispatchEvent(new Event('click'));
  const tick = timestamp => {
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(timestamp));
  };
  const expire = () => [...timers.values()][0]();
  return { root, doc, nodes, frames, timers, deck, preview, cleanup, click, tick, expire };
}

test('effects use session CSS flags, preserve preview state, and clean up listeners', () => {
  const f = fixture('?perf=1'), saved = JSON.stringify(f.preview);
  assert.equal(f.root.open, true);
  assert.equal(f.nodes.get('report').readOnly, true);
  assert.equal(f.frames.size, 0);
  f.click('light');
  for (const effect of effectControls) assert.equal(f.doc.documentElement.classList.contains(effect.className), true);
  assert.equal(JSON.stringify(f.preview), saved);
  f.click('original');
  assert.ok(f.nodes.get('controls').children.every(row => row.children[0].checked));
  const checkbox = f.nodes.get('controls').children[0].children[0];
  checkbox.checked = false; checkbox.dispatchEvent(new Event('change'));
  assert.equal(f.doc.documentElement.classList.contains('nest-perf-no-shadows'), true);
  f.cleanup(); f.cleanup(); f.click('light');
  assert.ok(effectControls.every(effect => !f.doc.documentElement.classList.contains(effect.className)));
  assert.equal(f.nodes.get('controls').children.length, 0);
});

test('recording excludes idle gaps, busy dice waits, and deck replacements', () => {
  const f = fixture(); f.click('record');
  f.tick(0); f.tick(10); // One valid interval.
  f.deck.frame = 0; f.deck.busy = true;
  f.tick(20); f.tick(500); // Busy alone is not motion.
  f.deck.frame = 1; f.tick(1000); f.tick(1020); // One valid interval.
  f.preview.deck = { frame: 1, cards: [] };
  f.tick(1040); f.tick(1070); // Same new deck only: one interval.
  f.expire();
  assert.match(f.nodes.get('report').value, /samples: 3/);
  assert.match(f.nodes.get('report').value, /Mean interval: 20.00 ms/);
  assert.match(f.nodes.get('report').value, /not device profiling/);
  assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0);
  f.cleanup();
});

test('effect changes, visibility and manual stop interrupt; prior comparison reports remain', () => {
  const f = fixture();
  f.click('record'); f.tick(0); f.tick(10); f.click('light');
  assert.match(f.nodes.get('report').value, /interrupted: preset changed/);
  f.click('record'); f.tick(0); f.tick(8); f.doc.hidden = true;
  f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.match(f.nodes.get('report').value, /Effects enabled: none/);
  assert.match(f.nodes.get('report').value, /Effects enabled: Shadows/);
  assert.match(f.nodes.get('report').value, /interrupted: page visibility changed/);
  assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0);
  f.click('record'); assert.equal(f.frames.size, 0);
  f.doc.hidden = false; f.click('record'); f.click('stop');
  assert.match(f.nodes.get('report').value, /interrupted: stopped manually/);
  f.click('record'); f.cleanup();
  assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0);
  f.click('record'); assert.equal(f.frames.size, 0);
});
