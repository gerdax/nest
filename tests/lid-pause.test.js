import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck } from '../engine/CardDeck.js';
import { cardPose, scenePose } from '../engine/renderer.js';
import { projectedBounds } from '../engine/geometry.js';
import { ScenarioController, createChestEntry, CHEST_ITEM_IDS } from '../demo/ScenarioController.js';
import { ChapterController } from '../chapter/ChapterController.js';
import { createStarterChapter } from '../chapter/model.js';

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
function step(ms = 16) { now += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now)); }
function settle() { for (let i = 0; frames.size && i < 2000; i++) step(); assert.equal(frames.size, 0, 'animation converges'); }
const fixture = (count, interaction = 'container') => ({ id: `items-${count}`, interaction, title: 'Chest', text: 'Contents', actions: Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, label: `Item ${i}` })) });
function make(count = 3, content = fixture(count)) { return new CardDeck(new Element(), { content }); }
function ready(deck) { deck.setOpen(true); deck.schedule(); settle(); assert.equal(deck.phase, 'choices'); }
function key(deck, name) { const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value: name }); deck.mount.dispatchEvent(event); }
function dispose(deck, host) { host?.destroy(); deck.destroy(); settle(); document.hidden = false; }

function makeFlow(flow, settings = {}) {
  const deck = new CardDeck(new Element(), { content: createChestEntry(CHEST_ITEM_IDS, true), settings });
  const host = flow === 'return'
    ? new ScenarioController(deck, { fixture: 'chest', lidMotion: true })
    : new ChapterController(deck, createStarterChapter(), { startNode: 'supplies', lidMotion: true, rng: () => 0 });
  ready(deck); deck.commit(); settle();
  while (deck.cards.length > 1) { deck.commit(); settle(); }
  assert.equal(deck.content.interaction, 'container');
  return { deck, host };
}
function finalClearance(deck) {
  const start = now;
  const completeCollection = deck.completeCollection;
  deck.completeCollection = function (time, delayLid) {
    const bounds = this.mount.getBoundingClientRect();
    assert.ok(projectedBounds(cardPose(this, this.collectMotion.index, time), bounds.width, bounds.height,
      this.settings.perspective).bottom + bounds.top <= -8, 'the last item physically clears before pause starts');
    completeCollection.call(this, time, delayLid);
  };
  deck.commit();
  assert.equal(deck.lidCloseUntil, null, 'accepting collection does not start the pause');
  for (let i = 0; deck.collectMotion && i < 100; i++) step();
  assert.equal(deck.collectMotion, null);
  deck.completeCollection = completeCollection;
  assert.ok(now > start);
  assert.equal(deck.lidCloseUntil, now + 100, 'pause begins on the physical clearance frame');
  return now;
}
function returnPose(deck) {
  return deck.returnDeck?.cards.map(card => card.style.transform) ?? [];
}
function blocked(deck) {
  const state = deck.state;
  assert.equal(deck.start(), false);
  for (const name of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) key(deck, name);
  deck.commit();
  assert.deepEqual(deck.state, state);
}

for (const flow of ['return', 'chapter']) {
  test(`${flow}: final clearance holds the lid still for exactly 100ms before one completion`, () => {
    const { deck, host } = makeFlow(flow);
    const completions = [];
    deck.addEventListener('transitioncomplete', e => {
      completions.push(e.detail.transition);
      if (e.detail.transition === 'collect') {
        assert.equal(deck.state.busy, true, 'pause stays busy inside synchronous completion listeners');
        blocked(deck);
      }
    });
    const cleared = finalClearance(deck);
    assert.equal(completions.filter(t => t === 'collect').length, 1);
    const source = { ...scenePose(deck) }, returns = returnPose(deck);
    blocked(deck);
    step(99);
    assert.equal(now, cleared + 99);
    assert.deepEqual(scenePose(deck), source);
    assert.deepEqual(returnPose(deck), returns);
    assert.equal(deck.returnLift.x, 0);
    assert.equal(deck.lidArrival?.x ?? 0, 0);
    assert.equal(completions.length, 1);
    step(1);
    assert.deepEqual(scenePose(deck), source);
    assert.deepEqual(returnPose(deck), returns);
    blocked(deck);
    step(16); step(16);
    assert.ok(flow === 'chapter' ? deck.lidArrival.x > 0 : deck.returnLift.x > 0, 'closing moves after the deadline');
    settle();
    assert.equal(deck.lidCloseUntil, null);
    assert.equal(completions.filter(t => t === (flow === 'chapter' ? 'commit' : 'close')).length, 1);
    deck.finishMotion();
    assert.equal(completions.filter(t => t === (flow === 'chapter' ? 'commit' : 'close')).length, 1);
    dispose(deck, host);
  });

  for (const action of ['reset', 'replace', 'destroy']) test(`${flow}: ${action} cancels the clearance pause without stale closing completion`, () => {
    const { deck, host } = makeFlow(flow); let closes = 0;
    deck.addEventListener('transitioncomplete', e => { if (['commit', 'close'].includes(e.detail.transition)) closes++; });
    finalClearance(deck); step(40);
    if (action === 'replace') deck.replaceContent(fixture(2, 'choice'));
    else deck[action]();
    settle();
    assert.equal(deck.lidCloseUntil, null);
    assert.equal(deck.frame, 0);
    assert.equal(closes, 0);
    dispose(deck, host);
  });

  for (const mode of ['reduced', 'hidden', 'finish']) test(`${flow}: ${mode} skips an active pause and finishes exactly once`, () => {
    const { deck, host } = makeFlow(flow); let closes = 0;
    deck.addEventListener('transitioncomplete', e => { if (['commit', 'close'].includes(e.detail.transition)) closes++; });
    finalClearance(deck); step(40);
    if (mode === 'reduced') { deck.media.matches = true; deck.media.dispatchEvent(new Event('change')); }
    else if (mode === 'hidden') { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
    else deck.finishMotion();
    assert.equal(deck.lidCloseUntil, null);
    assert.equal(deck.frame, 0);
    assert.equal(deck.phase, flow === 'chapter' ? 'closed' : 'choices');
    assert.equal(closes, 1);
    deck.finishMotion(); assert.equal(closes, 1);
    dispose(deck, host);
  });

  for (const mode of ['reduced', 'hidden']) test(`${flow}: ${mode} before clearance creates no deferred pause`, () => {
    const { deck, host } = makeFlow(flow); let closes = 0;
    deck.addEventListener('transitioncomplete', e => { if (['commit', 'close'].includes(e.detail.transition)) closes++; });
    deck.commit();
    if (mode === 'reduced') { deck.media.matches = true; deck.media.dispatchEvent(new Event('change')); }
    else { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
    assert.equal(deck.lidCloseUntil, null);
    assert.equal(deck.frame, 0);
    assert.equal(closes, 1);
    dispose(deck, host);
  });
}

test('manual closing with an item remaining starts return immediately without a pause', () => {
  const { deck, host } = makeFlow('return');
  deck.setOpen(false); deck.schedule();
  for (let i = 0; deck.returnLift.x === 0 && i < 100; i++) {
    step(); assert.equal(deck.lidCloseUntil, null);
  }
  assert.ok(deck.returnLift.x > 0);
  dispose(deck, host);
});

test('ordinary containers and zero-delay lid containers do not pause', () => {
  for (const lid of [false, true]) {
    const deck = new CardDeck(new Element(), { content: { ...fixture(1), lid }, settings: { lidCloseDelay: lid ? 0 : 100 } });
    ready(deck); deck.commit();
    for (let i = 0; deck.collectMotion && i < 100; i++) step();
    assert.equal(deck.lidCloseUntil, null);
    settle(); assert.equal(deck.phase, 'closed'); dispose(deck);
  }
});
