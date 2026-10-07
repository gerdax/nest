import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck, DEFAULT_SETTINGS } from '../engine/CardDeck.js';
import { cardPose, scenePose } from '../engine/renderer.js';
import { projectedBounds } from '../engine/geometry.js';

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
function select(deck, index) { for (let i = 0; i < index; i++) key(deck, 'ArrowRight'); settle(); assert.equal(deck.index, index); }
const gesture = (y, vy = 0) => ({ axis: 'y', x: 0, y, vx: 0, vy });
const fields = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
function poses(deck) { return new Map(deck.content.actions.map((action, i) => [action.id, cardPose(deck, i, now)])); }
function samePose(actual, expected, message) {
  for (const field of fields) assert.ok(Math.abs(actual[field] - expected[field]) < 1e-8, `${message}: ${field} changed ${expected[field]} -> ${actual[field]}`);
  assert.ok(Math.abs((actual.scale ?? 1) - (expected.scale ?? 1)) < 1e-8, `${message}: scale changed`);
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function opaque(deck) { for (const node of descendants(deck.mount)) assert.equal(Object.hasOwn(node.style, 'opacity'), false); }
function inputBlocked(deck) { const index = deck.index, cursor = deck.b.target; assert.equal(deck.start(), false); for (const name of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) key(deck, name); deck.commit(); assert.equal(deck.index, index); assert.equal(deck.b.target, cursor); assert.equal(deck.open, true); }
function dispose(deck, host) { host?.destroy(); deck.destroy(); settle(); document.hidden = false; }

function renderedScale(card) {
  return Number(card.style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? 1);
}

test('container opens directly from its one cover and cannot return manually', () => {
  const deck = make(); assert.equal(deck.content.allowClose, false);
  key(deck, 'ArrowUp'); settle(); assert.equal(deck.phase, 'choices');
  const cards = [...deck.cards]; let closes = 0;
  deck.addEventListener('close', () => closes++);
  deck.setOpen(false); assert.equal(deck.open, true);
  key(deck, 'Escape'); settle(); assert.deepEqual(deck.cards, cards); assert.equal(closes, 0);
  dispose(deck);
});

for (const resolution of ['collect', 'discard']) for (const count of [2, 3, 4]) for (let index = 0; index < count; index++) {
  test(`${resolution} ${count} items at ${index}: selected departure, survivor identity and order`, () => {
    const deck = make(count); ready(deck); select(deck, index);
    const initial = poses(deck), selected = deck.content.actions[index].id;
    const originals = new Map(deck.content.actions.map((a, i) => [a.id, { card: deck.cards[i], layer: deck.cardLayers[i], order: Number(deck.cardLayers[i].style.zIndex) }]));
    const accepts = [], completes = [];
    deck.addEventListener(resolution, e => accepts.push(e.detail));
    deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === resolution) completes.push(e.detail); });
    const direction = resolution === 'collect' ? 1 : -1;
    deck.start(); deck.move(gesture(direction * 150));
    assert.ok(direction * (poses(deck).get(selected).y - initial.get(selected).y) >= 149);
    for (const [id, pose] of poses(deck)) if (id !== selected) samePose(pose, initial.get(id), 'held survivor');
    step(); step();
    for (const [id, pose] of poses(deck)) if (id !== selected) samePose(pose, initial.get(id), 'held angular survivor');
    deck.end(gesture(direction * 150));
    assert.equal(accepts.length, 1); assert.equal(accepts[0].action.id, selected); assert.equal(accepts[0].index, index); assert.equal(accepts[0].final, false);
    let before;
    while (deck.collectMotion) {
      inputBlocked(deck); before = poses(deck); step(1);
      if (deck.collectMotion) for (const [id, pose] of poses(deck)) if (id !== selected) samePose(pose, initial.get(id), 'flight survivor');
    }
    assert.equal(originals.get(selected).layer.parentNode, null); assert.equal(deck.cards.length, count - 1);
    for (const [id, pose] of poses(deck)) {
      samePose(pose, before.get(id), 'physical removal continuity');
      const i = deck.content.actions.findIndex(a => a.id === id);
      assert.equal(deck.cards[i], originals.get(id).card); assert.equal(deck.cardLayers[i], originals.get(id).layer);
      assert.equal(Number(deck.cardLayers[i].style.zIndex), originals.get(id).order);
    }
    assert.equal(completes.length, 0, 'resolution waits for survivor reflow'); settle();
    assert.equal(completes.length, 1); assert.equal(deck.busy, false); assert.equal(deck.phase, 'choices');
    assert.deepEqual(new Set(completes[0].remainingIds), new Set([...initial.keys()].filter(id => id !== selected)));
    opaque(deck); deck.finishMotion(); assert.equal(completes.length, 1); dispose(deck);
  });
}

for (const resolution of ['collect', 'discard']) test(`final ${resolution} stages its reverse while held and flips only after clearance`, () => {
  const deck = make(1); ready(deck);
  const direction = resolution === 'collect' ? 1 : -1, events = [];
  deck.addEventListener(resolution, e => {
    events.push('accepted'); assert.equal(e.detail.final, true);
    deck.replaceContent({ ...fixture(2, 'choice'), id: 'next', title: 'Next situation' });
    assert.equal(deck.content.id, 'items-1'); assert.equal(deck.pending.id, 'next');
  });
  deck.addEventListener('transitioncomplete', e => {
    if (e.detail.transition === resolution) {
      events.push('removed'); assert.deepEqual(e.detail.remainingIds, []); assert.equal(deck.cards.length, 0); assert.equal(deck.busy, true);
      assert.equal(deck.underlayBack.style.visibility, 'visible', 'reverse covers the cleared stage at removal');
    }
    if (e.detail.transition === 'commit') events.push('flipped');
  });
  deck.start(); deck.move(gesture(direction * 150));
  const back = deck.underlayBack;
  assert.ok(back); assert.equal(back.style.visibility, 'visible'); assert.equal(deck.nextFlip.x, 1); assert.deepEqual(events, []);
  deck.end(gesture(direction * 150, direction * 1600));
  while (deck.collectMotion) {
    inputBlocked(deck); assert.equal(deck.nextFlip.x, 1); assert.equal(deck.underlayBack, back); assert.equal(back.style.visibility, 'visible'); opaque(deck); step(1);
  }
  assert.deepEqual(events, ['accepted', 'removed']); assert.equal(deck.phase, 'committing'); assert.equal(deck.flip.x, 1);
  assert.equal(deck.scene.style.visibility, 'visible'); assert.equal(deck.sceneBack.style.visibility, 'visible');
  while (frames.size) { assert.equal(deck.start(), false); opaque(deck); step(); }
  assert.deepEqual(events, ['accepted', 'removed', 'flipped']); assert.equal(deck.content.id, 'next'); assert.equal(deck.phase, 'closed'); assert.equal(deck.busy, false); assert.equal(deck.flip.x, 0);
  deck.finishMotion(); assert.equal(events.length, 3); dispose(deck);
});

for (const resolution of ['collect', 'discard']) for (const mode of ['reduced', 'hidden', 'resize']) for (const final of [false, true]) test(`${mode} finishes ${resolution} ${final ? 'final flip' : 'survivor reflow'} once`, () => {
  const deck = make(final ? 1 : 3); ready(deck); const events = [];
  deck.addEventListener(resolution, () => { if (final) deck.replaceContent(fixture(2, 'choice')); });
  deck.addEventListener('transitioncomplete', e => { if ([resolution, 'commit'].includes(e.detail.transition)) events.push(e.detail.transition); });
  deck[resolution](); step();
  if (mode === 'reduced') { deck.media.matches = true; deck.media.dispatchEvent(new Event('change')); }
  else if (mode === 'hidden') { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
  else deck.resize.callback();
  assert.deepEqual(events, final ? [resolution, 'commit'] : [resolution]); assert.equal(deck.frame, 0); assert.equal(deck.busy, false);
  assert.equal(deck.phase, final ? 'closed' : 'choices'); deck.finishMotion(); assert.equal(events.length, final ? 2 : 1); dispose(deck);
});

for (const resolution of ['collect', 'discard']) for (const action of ['reset', 'replace', 'destroy']) test(`${action} cancels accepted ${resolution} without stale completion`, () => {
  const deck = make(3); ready(deck); let completions = 0;
  deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === resolution) completions++; });
  deck[resolution](); step();
  if (action === 'replace') deck.replaceContent(fixture(2, 'choice')); else deck[action]();
  settle(); assert.equal(completions, 0); assert.equal(deck.collectMotion, null); assert.equal(deck.frame, 0); assert.equal(deck.busy, false); dispose(deck);
});

for (const y of [-150, 150]) test(`Escape cancels held ${y < 0 ? 'discard' : 'take'} without closing or accepting`, () => {
  const deck = make(1); ready(deck); let accepts = 0;
  deck.addEventListener('collect', () => accepts++); deck.addEventListener('discard', () => accepts++);
  deck.start(); deck.move(gesture(y)); key(deck, 'Escape'); settle();
  assert.equal(deck.drag, null); assert.equal(deck.open, true); assert.equal(deck.cards.length, 1); assert.equal(accepts, 0);
  assert.equal(deck.underlayBack.style.visibility, 'hidden'); dispose(deck);
});

for (const [name, resolution] of [['ArrowUp', 'discard'], ['ArrowDown', 'collect'], ['Enter', 'collect']]) test(`${name} accepts ${resolution} on selected item`, () => {
  const deck = make(3); ready(deck); key(deck, 'ArrowRight'); settle(); const selected = deck.content.actions[1].id; let action;
  deck.addEventListener(resolution, e => { action = e.detail.action; }); key(deck, name);
  assert.equal(action.id, selected); settle(); assert.equal(deck.cards.length, 2); dispose(deck);
});

for (const resolution of ['collect', 'discard']) test(`keyboard final ${resolution} reveals its reverse continuously before physical removal`, () => {
  const deck = make(1); ready(deck); let observedFullScale = false, previous = DEFAULT_SETTINGS.revealStartScale;
  deck.addEventListener(resolution, () => deck.replaceContent(fixture(2, 'choice')));
  deck[resolution]();
  while (deck.collectMotion) {
    assert.equal(deck.underlayBack.style.visibility, 'visible');
    const scale = renderedScale(deck.underlayBack);
    assert.ok(scale >= previous - 1e-10, 'reverse grows monotonically as selected item departs');
    if (scale === 1) observedFullScale = true;
    previous = scale; step(1);
  }
  assert.ok(observedFullScale, 'reverse reaches full size before item is detached');
  settle(); dispose(deck);
});

for (const resolution of ['collect', 'discard']) test(`rapid browsing resolves a rear item on a tall viewport: ${resolution}`, () => {
  const savedHeight = globalThis.innerHeight;
  globalThis.innerHeight = 1500;
  const deck = make(2);
  deck.updateSettings({ perspective: 650, stackDepth: 30 }); ready(deck);
  let accepted = 0, completed = 0;
  deck.addEventListener(resolution, () => accepted++);
  deck.addEventListener('transitioncomplete', event => { if (event.detail.transition === resolution) completed++; });
  key(deck, 'ArrowRight');
  deck[resolution](); settle();
  assert.equal(accepted, 1); assert.equal(completed, 1);
  assert.equal(deck.collectMotion, null); assert.equal(deck.busy, false);
  assert.equal(deck.cards.length, 1);
  dispose(deck); globalThis.innerHeight = savedHeight;
});
