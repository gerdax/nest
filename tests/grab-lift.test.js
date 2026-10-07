import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck, DEFAULT_SETTINGS } from '../engine/CardDeck.js';
import { cardPose, scenePose } from '../engine/renderer.js';
import { projectedBounds, turningBounds } from '../engine/geometry.js';

// Browser-shaped tree: collection must physically detach its layer, while the
// remaining articles retain their identity and their original parent layers.
class Element extends EventTarget {
  constructor() { super(); this.attrs = new Map(); this.style = {}; this.children = []; this.parentNode = null; this.captures = new Set(); this.classList = { add() {}, remove() {} }; }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  removeAttribute(key) { this.attrs.delete(key); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  remove() { if (this.parentNode) { const siblings = this.parentNode.children; siblings.splice(siblings.indexOf(this), 1); this.parentNode = null; } }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 340, height: 453 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}
let now = 1000, serial = 0;
const frames = new Map();
Object.defineProperty(performance, 'now', { value: () => now, configurable: true });
globalThis.requestAnimationFrame = fn => { frames.set(++serial, fn); return serial; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.document = new Element();
document.createElement = () => new Element(); document.hidden = false;
globalThis.matchMedia = () => Object.assign(new EventTarget(), { matches: false });
globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} };
function step(ms = 10) { now += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now)); }
function settle() { for (let i = 0; frames.size && i < 2000; i++) step(); assert.equal(frames.size, 0, 'animation converges'); }
const fixture = (count = 4, interaction = 'choice') => ({ id: interaction, interaction, actions: Array.from({ length: count }, (_, i) => ({ id: `a${i}`, label: `Card ${i}` })) });
function make(count = 4, interaction = 'choice', settings = {}) { return new CardDeck(new Element(), { content: fixture(count, interaction), settings }); }
function ready(d) { d.setOpen(true); d.schedule(); settle(); }
const g = y => ({ axis: 'y', x: 0, y, vx: 0, vy: 0 });
const near = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-8, `${message}: ${a} != ${b}`);
function key(d, name) { const e = new Event('keydown', { cancelable: true }); Object.defineProperty(e, 'key', { value: name }); d.key(e); }
function pointer(x, y, time = now) { return { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, timeStamp: time, preventDefault() {} }; }
function dispose(...decks) { decks.forEach(d => d.destroy()); document.hidden = false; settle(); }
function withoutPickup(d, read) { const cover = d.grabCover, cards = d.grabCards; d.grabCover = { x: 0 }; d.grabCards = new Map(); const value = read(); d.grabCover = cover; d.grabCards = cards; return value; }

for (const open of [false, true]) test(`pickup waits for confirmed vertical axis, open=${open}`, () => {
  const d = make(); if (open) ready(d);
  d.input.pointerdown(pointer(100, 100)); step(30);
  assert.equal(d.grabAmount(), 0); assert.equal(d.grabCards.size, 0);
  d.input.pointermove(pointer(110, 108)); step(30);
  assert.equal(d.input.active.axis, null); assert.equal(d.grabCards.size, 0); assert.equal(d.grabAmount(), 0);
  d.input.pointermove(pointer(170, 110)); step(100);
  assert.equal(d.input.active.axis, 'x'); assert.equal(d.grabCards.size, 0); assert.equal(d.grabAmount(), 0);
  // Dominant direction stays locked even if a later pointer move is vertical.
  d.input.pointermove(pointer(170, 10)); step(100); assert.equal(d.grabCards.size, 0); assert.equal(d.grabAmount(), 0);
  dispose(d);
});

for (const direction of [-1, 1]) test(`cover pickup affects only cover and holds a bounded plateau, y=${direction}`, () => {
  const d = make(); d.start(); d.move(g(direction * 40)); for (let i = 0; i < 6; i++) step();
  assert.ok(d.grabAmount() > 8 && d.grabAmount() < 24, 'quick but smooth onset');
  near(scenePose(d).z - withoutPickup(d, () => scenePose(d).z), d.grabAmount());
  d.cards.forEach((_, i) => near(cardPose(d, i).z, withoutPickup(d, () => cardPose(d, i).z), 'underlying cards have no pickup'));
  for (let i = 0; i < 100; i++) step(); assert.equal(d.grabAmount(), 24);
  d.move(g(direction * 250)); step(500); assert.equal(d.grabAmount(), 24, 'distance never accumulates pickup');
  d.cancel(); near(scenePose(d).z - withoutPickup(d, () => scenePose(d).z), 24, 'cancel boundary'); settle(); assert.equal(d.grabAmount(), 0); dispose(d);
});

for (const stagger of [0, 30]) test(`choice pickup follows frozen painter ranks, stagger=${stagger}`, () => {
  const d = make(4, 'choice', { choiceStaggerMs: stagger }); ready(d); key(d, 'ArrowRight'); settle();
  d.start(); d.move(g(-40)); const order = [...d.choiceRanks].sort((a, b) => a[1] - b[1]); assert.equal(order[0][0], 'a1');
  step(10); const amounts = order.map(([id]) => d.grabAmount(id)); assert.ok(amounts[0] > 0);
  if (stagger) assert.deepEqual(amounts.slice(1), [0, 0, 0]); else amounts.forEach(a => near(a, amounts[0]));
  step(30); if (stagger) { assert.ok(d.grabAmount(order[0][0]) > d.grabAmount(order[1][0])); assert.equal(d.grabAmount(order[2][0]), 0); }
  for (let i = 0; i < 100; i++) step(); order.forEach(([id]) => assert.equal(d.grabAmount(id), 24));
  d.move(g(40)); d.cards.forEach((_, i) => near(d.grabAmount(d.content.actions[i].id), 24, 'reversing does not drop pickup'));
  d.cancel(); step(20); const settling = d.cards.map((_, i) => cardPose(d, i)); d.start(); d.move(g(0));
  d.cards.forEach((_, i) => near(cardPose(d, i).z, settling[i].z, 'regrab boundary'));
  d.cancel(); settle(); assert.equal(d.grabCards.size, 0); dispose(d);
});

for (const direction of [-1, 1]) test(`container pickup raises only selected item and frozen capture never doubles it, y=${direction}`, () => {
  const d = make(3, 'container'); ready(d); key(d, 'ArrowRight'); settle(); const rest = d.cards.map((_, i) => cardPose(d, i));
  d.start(); d.move(g(direction * 40)); for (let i = 0; i < 100; i++) step();
  assert.equal(d.grabAmount('a1'), 24); assert.equal(d.grabAmount('a0'), 0); assert.equal(d.grabAmount('a2'), 0);
  for (let i = 0; i < 3; i++) {
    const z = cardPose(d, i).z, baseline = withoutPickup(d, () => cardPose(d, i).z);
    near(z - baseline, i === 1 ? 24 : 0, 'single additive pickup');
    if (i !== 1) for (const field of ['x', 'y', 'z', 'rx', 'ry', 'rz']) near(cardPose(d, i)[field], rest[i][field], 'unselected card frozen');
  }
  const before = cardPose(d, 1); d.cancel(); near(cardPose(d, 1).z, before.z); step(20); const regrab = cardPose(d, 1); d.start(); d.move(g(0)); near(cardPose(d, 1).z, regrab.z);
  d.restoreLiftPoses(); near(cardPose(d, 1).z, regrab.z, 'restoring frozen poses does not add pickup twice');
  d.cancel(); settle(); assert.equal(d.grabCards.size, 0); assert.equal(d.liftPoses, null); dispose(d);
});

for (const interaction of ['choice', 'container']) test(`disabled ${interaction} never receives pickup`, () => {
  const d = make(3, interaction); d.content.actions[0].disabled = true; ready(d); d.start(); d.move(g(-50)); step(200); assert.equal(d.grabCards.size, 0); assert.equal(d.grabAmount('a0'), 0); d.cancel(); settle(); dispose(d);
});

test('camera cap, zero tuning, and downward ordinary choices keep pickup bounded', () => {
  const d = make(3, 'choice', { perspective: 400, grabLift: 1000 }); ready(d); d.start(); d.move(g(40)); for (let i = 0; i < 100; i++) step();
  assert.equal(d.grabAmount('a0'), 8); d.updateSettings({ grabLift: 0 }); assert.equal(d.grabAmount('a0'), 0); d.cancel(); settle(); dispose(d);
});

for (const action of ['reset', 'replace', 'destroy', 'reduced', 'hidden']) test(`${action} clears delayed pickup and all scheduling`, () => {
  const d = make(); ready(d); d.start(); d.move(g(-40)); step(10); assert.ok(d.grabAmount('a0') > 0);
  if (action === 'replace') d.replaceContent(fixture(2)); else if (action === 'reduced') { d.media.matches = true; d.media.dispatchEvent(new Event('change')); }
  else if (action === 'hidden') { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); } else d[action]();
  assert.equal(d.grabCards.size, 0); assert.equal(d.grabAmount(), 0); assert.equal(d.frame, 0); step(500); assert.equal(d.frame, 0); dispose(d);
});

test('newly selected follower adopts physical depth without pickup duplication', () => {
  const d = make(); ready(d); d.start(); d.move(g(-80)); step(50); d.cancel(); key(d, 'ArrowRight');
  const before = d.cards.map((_, i) => cardPose(d, i)); d.start(); d.move(g(0));
  d.cards.forEach((_, i) => { for (const field of ['x', 'y', 'z', 'rx', 'ry', 'rz']) near(cardPose(d, i)[field], before[i][field], 'adoption boundary'); });
  for (let i = 0; i < 100; i++) step(); d.cards.forEach((_, i) => assert.equal(d.grabAmount(d.content.actions[i].id), 24)); d.cancel(); settle(); dispose(d);
});

for (const interaction of ['choice', 'container']) for (const direction of (interaction === 'container' ? [-1, 1] : [-1])) test(`${interaction} accepted departure preserves pickup until safe adoption, y=${direction}`, () => {
  const d = make(interaction === 'container' ? 1 : 4, interaction); ready(d); let complete = 0;
  d.addEventListener(interaction === 'choice' ? 'commit' : direction < 0 ? 'discard' : 'collect', () => d.replaceContent({ ...fixture(2), id: 'next' }));
  d.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'commit') complete++; });
  d.start(); d.move(g(direction * 100)); for (let i = 0; i < 100; i++) step(); const before = d.cards.map((_, i) => cardPose(d, i));
  d.end({ ...g(direction * 100), vy: direction * 800 });
  d.cards.forEach((_, i) => near(cardPose(d, i).z, before[i].z, 'release boundary')); assert.equal(d.grabAmount('a0'), 24); assert.equal(d.start(), false);
  const bounds = d.mount.getBoundingClientRect();
  for (let i = 0; frames.size && i < 2000; i++) {
    if (d.commitMotion && d.nextFlip.target === 0) {
      const area = turningBounds({ z: -24, turnAxis: d.settings.flipAxisTilt }, bounds.width, bounds.height, d.settings.perspective);
      d.cards.forEach((_, index) => assert.ok(projectedBounds(cardPose(d, index), bounds.width, bounds.height, d.settings.perspective).bottom <= area.top - 8, 'flip respects picked up planes'));
    }
    step();
    if (d.content.id === 'next') { assert.equal(d.grabCards.size, 0); assert.equal(d.grabAmount(), 0); }
  }
  assert.equal(frames.size, 0); assert.equal(d.content.id, 'next'); assert.equal(d.busy, false); assert.equal(complete, 1); assert.equal(d.start(), true); dispose(d);
});

test('cancel before follower onset removes pending pickup; a quick carousel creates none', () => {
  const d = make(4, 'choice', { choiceStaggerMs: 30 }); ready(d); d.start(); d.move(g(-40)); step(10);
  const leader = d.grabAmount('a0'); assert.ok(leader > 0);
  assert.deepEqual(['a1', 'a2', 'a3'].map(id => d.grabAmount(id)), [0, 0, 0]);
  d.cancel(); near(d.grabAmount('a0'), leader, 'cancellation preserves release boundary');
  d.start(); d.move({ axis: 'x', x: -60, y: 0, vx: 0, vy: 0 });
  assert.ok([...d.grabCards.values()].every(pickup => !pickup.held && pickup.state.target === 0));
  for (let i = 0; i < 10; i++) {
    step(); assert.ok(d.grabAmount('a0') <= 24, 'return retains spring momentum without a new pickup target');
    assert.deepEqual(['a1', 'a2', 'a3'].map(id => d.grabAmount(id)), [0, 0, 0], 'canceled delayed followers never rise');
  }
  d.end({ axis: 'x', x: -60, y: 0, vx: 0, vy: 0 }); settle(); assert.equal(d.grabCards.size, 0); dispose(d);
});

test('keyboard reveal, browse, and departure retain baseline depth without pickup', () => {
  const d = make(); key(d, 'ArrowUp'); settle(); key(d, 'ArrowRight'); settle(); key(d, 'ArrowUp');
  assert.equal(d.grabCards.size, 0); assert.equal(d.grabAmount(), 0); assert.equal(d.commitMotion.continueFlight, false);
  d.reset(); dispose(d);
});

test('closing an accepted uncover before clearance releases cover pickup', () => {
  const d = make(); d.content.allowClose = true; d.start(); d.move(g(-70)); step(10); d.end(g(-70));
  assert.equal(d.phase, 'revealing'); assert.equal(d.grabCover.target, 24);
  key(d, 'ArrowDown'); assert.equal(d.phase, 'closing'); assert.equal(d.grabCover.target, 0);
  settle(); assert.equal(d.phase, 'closed'); assert.equal(d.grabAmount(), 0); dispose(d);
});
