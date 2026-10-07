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

function collectionEnd(deck) {
  const motion = deck.collectMotion;
  if (deck.cards.length !== 1) return motion.start + motion.duration;
  const bounds = deck.mount.getBoundingClientRect();
  let low = motion.start, high = motion.start + motion.duration;
  for (let i = 0; i < 55; i++) {
    const time = (low + high) / 2;
    const bottom = projectedBounds(cardPose(deck, motion.index, time), bounds.width, bounds.height, deck.settings.perspective).bottom + (bounds.top || 0);
    if (bottom > -8) low = time; else high = time;
  }
  return high;
}

function renderedScale(card) {
  return Number(card.style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? 1);
}

test('a fully uncovered next reverse keeps its full scale while waiting for asynchronous content', () => {
  const deck = make(2, fixture(2, 'choice')); ready(deck);
  deck.start(); deck.move(gesture(-60));
  assert.ok(renderedScale(deck.underlayBack) < 1);
  deck.end(gesture(-60, -800));
  const motion = deck.commitMotion; step(motion.start + (motion.duration + (deck.cards.length - 1) * deck.settings.choiceStaggerMs) + 1 - now);
  assert.equal(deck.busy, true); assert.equal(deck.commitMotion, null);
  assert.equal(renderedScale(deck.underlayBack), 1);
  deck.render(); assert.equal(renderedScale(deck.underlayBack), 1, 'waiting does not shrink the revealed card again');
  deck.replaceContent(fixture(3, 'choice')); settle();
  assert.equal(deck.busy, false); assert.equal(renderedScale(deck.scene), 1);
  dispose(deck);
});
function exposure(deck, cover) {
  const { width, height } = deck.mount.getBoundingClientRect();
  return height - Math.max(...cover.map(pose => projectedBounds(pose, width, height, deck.settings.perspective).bottom));
}
// Position the real projected cover at a visible fraction; this also catches
// implementations that use gesture distance while ignoring tilt/perspective.
function positionAtExposure(deck, fraction, setLift, cover) {
  const { height } = deck.mount.getBoundingClientRect();
  let low = 0, high = 1;
  for (let i = 0; i < 55; i++) {
    const value = (low + high) / 2; setLift(value);
    if (exposure(deck, cover()) < fraction * height) low = value; else high = value;
  }
  setLift(high); deck.render();
}

for (const count of [2, 3, 4]) test(`${count} choices zoom from the configured start scale to full size at the configured exposure`, () => {
  const deck = make(count, fixture(count, 'choice'));
  deck.updateSettings({ maxTilt: 18 });
  deck.rotationX.x = 18; deck.rotationY.x = -18; deck.rotationZ.x = 18;
  deck.render();
  for (const [id, pose] of poses(deck)) assert.equal(pose.scale, DEFAULT_SETTINGS.revealStartScale, `${id} starts slightly smaller`);
  assert.equal(renderedScale(deck.scene), 1, 'the cover retains its normal size');
  let previous = DEFAULT_SETTINGS.revealStartScale;
  for (const progress of [.25, .5, .75, 1, 1.5]) {
    const fraction = DEFAULT_SETTINGS.revealFullScaleAt * progress;
    positionAtExposure(deck, fraction, value => { deck.p.x = value; }, () => [scenePose(deck)]);
    for (let i = 0; i < count; i++) {
      const scale = cardPose(deck, i, now).scale;
      assert.ok(scale >= previous - 1e-10 && scale <= 1, 'zoom increases without overshoot');
      assert.equal(renderedScale(deck.cards[i]), scale, 'rendered cards use the physical pose scale');
      if (progress === .5) assert.ok(Math.abs(scale - (1 + DEFAULT_SETTINGS.revealStartScale) / 2) < 1e-8, 'halfway through the reveal zoom');
      if (progress >= 1) assert.equal(scale, 1, 'full size at the configured visible exposure');
    }
    previous = cardPose(deck, 0, now).scale;
  }
  dispose(deck);
});

for (const outcome of ['cancel', 'incomplete']) test(`${outcome} uncover reverses zoom and restores the closed scale`, () => {
  const deck = make(3, fixture(3, 'choice')); deck.updateSettings({ maxTilt: 0 });
  deck.start(); deck.move(gesture(-60));
  let previous = cardPose(deck, 0, now).scale;
  assert.ok(previous > DEFAULT_SETTINGS.revealStartScale && previous < 1);
  if (outcome === 'cancel') deck.cancel(); else deck.end(gesture(-60));
  for (let i = 0; frames.size && i < 2000; i++) {
    step(); const scale = cardPose(deck, 0, now).scale;
    assert.ok(scale <= previous + 1e-10, 'returning cover smoothly reverses zoom'); previous = scale;
  }
  assert.equal(frames.size, 0); assert.equal(deck.phase, 'closed'); assert.equal(previous, DEFAULT_SETTINGS.revealStartScale);
  dispose(deck);
});

for (const interruption of ['reset', 'replace']) test(`${interruption} during source uncover restores scale without stale motion`, () => {
  const deck = make(3, fixture(3, 'choice')); deck.start(); deck.move(gesture(-60));
  assert.ok(cardPose(deck, 0, now).scale > DEFAULT_SETTINGS.revealStartScale);
  if (interruption === 'replace') deck.replaceContent(fixture(2, 'choice')); else deck.reset();
  settle(); assert.equal(deck.frame, 0); assert.equal(deck.drag, null); assert.equal(deck.phase, 'closed');
  for (const pose of poses(deck).values()) assert.equal(pose.scale, DEFAULT_SETTINGS.revealStartScale);
  deck.cards.forEach(card => assert.equal(renderedScale(card), DEFAULT_SETTINGS.revealStartScale)); dispose(deck);
});

for (const mode of ['reduced', 'hidden']) test(`${mode} finishes source reveal at full size without remaining motion`, () => {
  const deck = make(3, fixture(3, 'choice')); deck.setOpen(true); deck.schedule(); step();
  assert.ok(cardPose(deck, 0, now).scale < 1);
  if (mode === 'reduced') { deck.media.matches = true; deck.media.dispatchEvent(new Event('change')); }
  else { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
  assert.equal(deck.phase, 'choices'); assert.equal(deck.frame, 0);
  for (const pose of poses(deck).values()) assert.equal(pose.scale, 1);
  deck.cards.forEach(card => assert.equal(renderedScale(card), 1)); dispose(deck);
});

for (const count of [2, 3, 4]) for (const destination of ['back', 'items']) test(`${count} outgoing choices reveal ${destination === 'back' ? 'a back' : 'items'} at the same projected zoom`, () => {
  const deck = make(count, fixture(count, 'choice')); ready(deck);
  deck.updateSettings({ maxTilt: 18 });
  if (destination === 'items') deck.setActionPreview('item-0', fixture(3), { presentation: 'open' });
  deck.start(); deck.move(gesture(-1));
  deck.choiceHistory = null; // This geometry probe sets lift directly rather than replaying timed input.
  deck.rotationX.x = 18; deck.rotationY.x = -18; deck.rotationZ.x = 18;
  const destinationCards = destination === 'items' ? deck.forwardDeck.cards : [deck.underlayBack];
  deck.render(); destinationCards.forEach(card => assert.equal(renderedScale(card), DEFAULT_SETTINGS.revealStartScale));
  let previous = DEFAULT_SETTINGS.revealStartScale;
  for (const progress of [.25, .5, .75, 1, 1.5]) {
    const fraction = DEFAULT_SETTINGS.revealFullScaleAt * progress;
    positionAtExposure(deck, fraction, value => { deck.l.x = value; }, () => [...poses(deck).values()]);
    const scale = renderedScale(destinationCards[0]);
    assert.ok(scale >= previous - 1e-10 && scale <= 1);
    destinationCards.forEach(card => assert.equal(renderedScale(card), scale, 'all cards underneath share the same zoom'));
    if (progress === .5) assert.ok(Math.abs(scale - (1 + DEFAULT_SETTINGS.revealStartScale) / 2) < 1e-8);
    if (progress >= 1) assert.equal(scale, 1);
    previous = scale;
  }
  deck.cancel(); settle();
  destinationCards.forEach(card => assert.equal(renderedScale(card), DEFAULT_SETTINGS.revealStartScale, 'cancellation restores the staged scale'));
  assert.equal(deck.phase, 'choices'); for (const pose of poses(deck).values()) assert.equal(pose.scale, 1);
  dispose(deck);
});

for (const count of [2, 3, 4]) test(`${count} underlying choices inherit only a small fraction of the situation's tilt`, () => {
  const deck = make(count, fixture(count, 'choice'));
  const original = poses(deck);
  deck.start({ clientX: 30, clientY: 60 }); deck.move(gesture(-60));
  for (let i = 0; i < 8; i++) step();
  assert.ok(Math.abs(scenePose(deck).rz) > .1, 'the grabbed situation still tilts');
  for (const [id, pose] of poses(deck)) {
    for (const field of ['x', 'y', 'z']) assert.equal(pose[field], original.get(id)[field], 'choices do not translate with the cover');
    for (const field of ['rx', 'ry', 'rz']) {
      assert.ok(Math.abs(pose[field]) <= .9);
      assert.ok(Math.abs(pose[field]) <= Math.abs(scenePose(deck)[field]) * .12 + 1e-8, 'underlying tilt is at most 12% of the cover tilt');
    }
    assert.ok(Math.abs(pose.rz) > 0, 'a subtle friction response remains');
  }
  deck.cancel(); settle();
  deck.start({ clientX: 30, clientY: 60 }); deck.move(gesture(-150));
  for (let i = 0; i < 8; i++) step();
  deck.end(gesture(-150));
  for (let i = 0; frames.size && i < 2000; i++) {
    step();
    const actual = poses(deck), rotations = [deck.rotationX, deck.rotationY, deck.rotationZ], angles = rotations.map(s => s.x);
    rotations.forEach(s => { s.x = 0; }); const unaffected = poses(deck);
    rotations.forEach((s, index) => { s.x = angles[index]; });
    for (const [id, pose] of actual) {
      for (const field of ['x', 'y', 'z']) assert.equal(pose[field], unaffected.get(id)[field]);
      for (const field of ['rx', 'ry', 'rz']) {
        const transmitted = Math.abs(pose[field] - unaffected.get(id)[field]);
        assert.ok(transmitted <= Math.abs(scenePose(deck)[field]) * .12 * (1 - Math.min(1, deck.fan.x)) + 1e-8, 'transmitted tilt fades during expansion');
        assert.ok(transmitted <= .9 + 1e-8);
      }
    }
  }
  assert.equal(deck.phase, 'choices');
  deck.rotationX.x = 2; deck.rotationZ.x = -2;
  const beforeGrab = poses(deck); deck.start({ clientX: 30, clientY: 60 }); deck.move(gesture(0));
  for (const [id, pose] of poses(deck)) samePose(pose, beforeGrab.get(id), 'first action grab has no inherited tilt jump');
  deck.move(gesture(-60)); for (let i = 0; i < 8; i++) step();
  assert.ok(Math.abs(poses(deck).get('item-0').rz) > .1, 'direct action gestures still tilt the action');
  deck.cancel(); settle(); dispose(deck);
});

test('underlying tilt stays below one degree at maximum tuning and disappears after clearance', () => {
  const deck = make(3, fixture(3, 'choice')); deck.updateSettings({ maxTilt: 18 });
  deck.p.x = .25;
  deck.rotationX.x = 18; deck.rotationY.x = -18; deck.rotationZ.x = 18;
  for (const pose of poses(deck).values()) for (const field of ['rx', 'ry', 'rz']) {
    assert.equal(Math.abs(pose[field]), .9);
    assert.ok(Math.abs(pose[field]) < Math.abs(scenePose(deck)[field]));
  }
  deck.p.x = 1;
  for (const pose of poses(deck).values()) for (const field of ['rx', 'ry', 'rz']) assert.equal(Math.abs(pose[field]), 0);
  dispose(deck);
});

test('choice remains the default and invalid content/presentation are rejected', () => {
  const content = fixture(2); delete content.interaction;
  const deck = make(2, content); assert.equal(deck.state.interaction, 'choice');
  for (const bad of [{ ...content, interaction: 'other' }, { ...content, actions: [] }, { ...content, actions: [content.actions[0], content.actions[0]] }]) assert.throws(() => deck.replaceContent(bad), TypeError);
  assert.throws(() => deck.replaceContent(content, { presentation: 'other' }), TypeError);
  deck.replaceContent(fixture(0)); assert.equal(deck.state.actionCount, 0); readyEmpty(deck); dispose(deck);
});
function readyEmpty(deck) { deck.setOpen(true); deck.schedule(); settle(); assert.equal(deck.open, false); assert.equal(deck.phase, 'closed'); }

test('open presentation installs a ready fan directly without flipping or a source cover', () => {
  const deck = make(2, fixture(2, 'choice')); ready(deck); const events = [];
  deck.addEventListener('commit', () => deck.replaceContent(fixture(3), { presentation: 'open' }));
  deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'commit') events.push(e.detail); });
  deck.commit();
  for (let i = 0; frames.size && i < 2000; i++) { step(); assert.equal(deck.flip.x, 0); assert.equal(deck.flip.target, 0); opaque(deck); }
  assert.equal(deck.content.interaction, 'container'); assert.equal(deck.phase, 'choices'); assert.equal(deck.open, true); assert.equal(events.length, 1);
  assert.equal(deck.scene.style.visibility, 'hidden'); dispose(deck);
});
