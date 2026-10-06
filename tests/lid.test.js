import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck } from '../engine/CardDeck.js';
import { cardPose, scenePose } from '../engine/renderer.js';
import { projectedBounds } from '../engine/geometry.js';
import { topEdgeHinge, lidPose } from '../engine/lid.js';
import { ScenarioController, CHEST_ITEM_IDS, createChestEntry, createChestContainer } from '../demo/ScenarioController.js';

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

function chest() {
  const deck = make(2, createChestEntry(CHEST_ITEM_IDS, true));
  const host = new ScenarioController(deck, { fixture: 'chest', lidMotion: true });
  ready(deck);
  return { deck, host };
}
function renderedPose(card) {
  const values = [...card.style.transform.matchAll(/(-?[\d.]+)(?:px|deg)/g)].map(match => Number(match[1]));
  return { ...Object.fromEntries(fields.map((field, i) => [field, values[i]])), scale: Number(card.style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? 1) };
}

test('rigid X hinge preserves the physical top edge and projected top through its full angle', () => {
  const base = { x: 0, y: -18, z: 4, rx: 0, ry: 0, rz: 0 };
  const top = projectedBounds(base, 340, 453, 1200).top;
  for (const angle of [0, 10, 30, 65, 85]) {
    const pose = topEdgeHinge(base, 453, angle), radians = angle * Math.PI / 180;
    assert.ok(Math.abs(pose.y - 453 / 2 * Math.cos(radians) - (base.y - 453 / 2)) < 1e-10);
    assert.ok(Math.abs(pose.z - 453 / 2 * Math.sin(radians) - base.z) < 1e-10);
    const topY = pose.y - 453 / 2 * Math.cos(radians);
    const topZ = pose.z - 453 / 2 * Math.sin(radians);
    const projectedTop = 453 * .45 + (453 * .05 + topY) * 1200 / (1200 - topZ);
    assert.ok(Math.abs(projectedTop - top) < 1e-10, 'the hinge edge stays fixed under perspective');
    const bounds = projectedBounds(pose, 340, 453, 1200);
    assert.ok(bounds.top <= projectedTop + 1e-10 && bounds.bottom >= projectedTop - 1e-10);
  }
  const held = lidPose(base, .3, 453, 653);
  const topLift = held.y - 453 / 2 * Math.cos(held.rx * Math.PI / 180) - (base.y - 453 / 2);
  assert.ok(topLift < 0 && topLift >= -120, 'hinging pickup stays within its lift envelope');
});

test('only Open hinges; its continuous held gesture reverses and cancels without changing the entry fan', () => {
  const { deck, host } = chest(); const before = poses(deck), originalCards = [...deck.cards];
  deck.start(); deck.move(gesture(-150));
  const held = poses(deck);
  assert.ok([...held.values()].every(pose => pose.rx > 10), 'the entire outgoing decision stack hinges');
  const selected = held.get('open');
  assert.ok(Math.abs(selected.y - 453 / 2 * (Math.cos(selected.rx * Math.PI / 180) - 1)) <= 120, 'selected top edge lifts by at most 120px');
  deck.move(gesture(-90));
  assert.ok(Math.abs(cardPose(deck, 0).rx) < Math.abs(selected.rx), 'reversing the gesture reverses its hinge');
  const atCancel = poses(deck); deck.cancel();
  for (const [id, pose] of poses(deck)) samePose(pose, atCancel.get(id), 'cancellation begins at the held pose');
  settle(); assert.equal(host.mode, 'entry'); assert.deepEqual(deck.cards, originalCards);
  for (const [id, pose] of poses(deck)) samePose(pose, before.get(id), 'canceled Open restores entry');
  select(deck, 1); deck.start(); deck.move(gesture(-150));
  assert.equal(cardPose(deck, 1).rx, 0, 'Go on retains the ordinary vertical lift');
  assert.equal(cardPose(deck, 1).y, -150);
  deck.cancel(); settle(); dispose(deck, host);
});

test('Open adopts its existing staged items without a pose jump and item collection stays ordinary', () => {
  const { deck, host } = chest(); deck.start(); deck.move(gesture(-150));
  const items = [...deck.forwardDeck.cards]; let adopted = 0;
  const install = deck.install;
  deck.install = function (content, options) {
    const before = items.map(renderedPose);
    install.call(this, content, options);
    if (content.id === 'chest-items') {
      items.forEach((card, i) => samePose(renderedPose(card), before[i], 'forward adoption'));
      assert.deepEqual(new Set(this.cards), new Set(items)); adopted++;
    }
  };
  deck.end(gesture(-150)); settle(); assert.equal(adopted, 1); assert.equal(deck.content.id, 'chest-items');
  deck.start(); deck.move(gesture(-100));
  assert.equal(cardPose(deck, deck.index).rx, 0); assert.equal(cardPose(deck, deck.index).y, -100);
  deck.cancel(); settle(); dispose(deck, host);
});

test('browsing during a canceled Open preserves its current hinge until a new grab adopts it', () => {
  const { deck, host } = chest();
  deck.start(); deck.move(gesture(-150)); deck.cancel(); const before = poses(deck);
  key(deck, 'ArrowRight');
  for (const [id, pose] of poses(deck)) samePose(pose, before.get(id), 'browse preserves canceled hinge');
  deck.start();
  for (const [id, pose] of poses(deck)) samePose(pose, before.get(id), 'new grab adopts canceled hinge');
  deck.cancel(); settle(); assert.equal(deck.content.actions[deck.index].id, 'leave'); dispose(deck, host);
});

test('committing Go on during canceled Open settling transfers its current pose to an ordinary throw', () => {
  const { deck, host } = chest(); deck.start(); deck.move(gesture(-150)); deck.cancel();
  key(deck, 'ArrowRight'); const before = poses(deck); deck.commit();
  for (const [id, pose] of poses(deck)) samePose(pose, before.get(id), 'commit transfers canceled hinge');
  assert.equal(deck.content.actions.find(a => deck.choiceRanks.get(a.id) === 0).id, 'leave');
  const angle = cardPose(deck, deck.index).rx; step(); assert.ok(cardPose(deck, deck.index).rx <= angle, 'ordinary throw settles its inherited hinge');
  settle(); assert.equal(host.mode, 'choice'); dispose(deck, host);
});

for (const lift of [150, 420, 450]) for (const angle of [0, 65]) test(`Go on adopted from a canceled ${lift}px / ${angle}deg lid lift clears the actual outgoing geometry before removal`, () => {
  const { deck, host } = chest(); deck.start(); deck.move(gesture(-lift));
  deck.updateSettings({ lidAngle: angle });
  for (let i = 0; i < 10; i++) step();
  deck.cancel(); key(deck, 'ArrowRight');
  let adoptions = 0; const completeCommit = deck.completeCommit;
  deck.completeCommit = function () {
    const { width, height } = this.mount.getBoundingClientRect();
    for (let i = 0; i < this.cards.length; i++) assert.ok(projectedBounds(cardPose(this, i, now), width, height, this.settings.perspective).bottom <= -8,
      'outgoing inherited pose is fully clear before removal');
    completeCommit.call(this); adoptions++;
  };
  deck.commit(); settle(); assert.equal(adoptions, 1); assert.equal(host.mode, 'choice'); dispose(deck, host);
});

test('a disabled Open action keeps the ordinary unavailable-item nudge', () => {
  const content = createChestEntry(CHEST_ITEM_IDS, true); content.actions[0].disabled = true;
  const deck = make(2, content); ready(deck); let commits = 0;
  deck.addEventListener('commit', () => commits++);
  deck.start(); deck.move(gesture(-150));
  assert.equal(cardPose(deck, 0).rx, 0); assert.ok(cardPose(deck, 0).y >= -24);
  deck.end(gesture(-150)); settle(); assert.equal(commits, 0); assert.equal(deck.phase, 'choices'); dispose(deck);
});

test('Open regrab adopts an ordinary canceled follower pose before starting its lid path', () => {
  const { deck, host } = chest(); select(deck, 1); deck.start(); deck.move(gesture(-150));
  for (let i = 0; i < 10; i++) step();
  deck.cancel(); key(deck, 'ArrowLeft'); const before = poses(deck); deck.start();
  for (const [id, pose] of poses(deck)) samePose(pose, before.get(id), 'lid regrab preserves ordinary lift');
  deck.cancel(); settle(); dispose(deck, host);
});

test('Open keyboard commit adopts an ordinary canceled follower and then hinges', () => {
  const { deck, host } = chest(); select(deck, 1); deck.start(); deck.move(gesture(-150));
  for (let i = 0; i < 10; i++) step();
  deck.cancel(); key(deck, 'ArrowLeft'); const before = poses(deck); deck.commit();
  for (const [id, pose] of poses(deck)) samePose(pose, before.get(id), 'lid commit preserves ordinary lift');
  assert.equal(deck.content.actions.find(a => deck.choiceRanks.get(a.id) === 0).id, 'open');
  const angle = cardPose(deck, deck.index).rx; step(); assert.ok(cardPose(deck, deck.index).rx > angle, 'Open adds its hinge after adoption');
  settle(); assert.equal(host.mode, 'container'); dispose(deck, host);
});

for (const empty of [false, true]) test(`${empty ? 'empty' : 'manual'} return reverses the hinge and adopts decisions continuously`, () => {
  const { deck, host } = chest(); deck.commit(); settle();
  let adopted = 0, hinges = 0;
  const completeReturn = deck.completeReturn;
  deck.completeReturn = function () {
    const cards = [...this.returnDeck.cards], before = cards.map(renderedPose);
    completeReturn.call(this);
    cards.forEach((card, i) => samePose(renderedPose(card), before[i], 'return adoption'));
    adopted++;
  };
  if (empty) { deck.commit(); settle(); deck.commit(); settle(); deck.commit(); }
  else { deck.setOpen(false); deck.schedule(); }
  for (let i = 0; frames.size && i < 2000; i++) {
    step();
    if (deck.returnDeck && deck.returnDeck.cards.some(card => card.style.visibility === 'visible' && renderedPose(card).rx > 1)) hinges++;
    assert.equal(deck.flip.x, 0);
  }
  assert.equal(frames.size, 0); assert.ok(hinges > 1); assert.equal(adopted, 1);
  assert.equal(deck.phase, 'choices'); assert.equal(deck.content.actions[deck.index].id, empty ? 'leave' : 'open');
  dispose(deck, host);
});

test('canceling a held lid return reverses from its current pose and restores all items', () => {
  const { deck, host } = chest(); deck.commit(); settle(); const before = poses(deck), items = [...deck.cards];
  deck.start(); deck.move(gesture(40));
  const cards = [...deck.returnDeck.cards], held = cards.map(renderedPose);
  assert.ok(held.every(pose => pose.rx > 1)); deck.cancel();
  cards.forEach((card, i) => samePose(renderedPose(card), held[i], 'return cancellation'));
  settle(); assert.equal(deck.phase, 'choices'); assert.deepEqual(deck.cards, items);
  assert.ok(cards.every(card => card.style.visibility === 'hidden'));
  for (const [id, pose] of poses(deck)) samePose(pose, before.get(id), 'canceled return restores items');
  dispose(deck, host);
});

for (const mode of ['reduced', 'hidden']) test(`${mode} finishes lid open, return and final arrival once with no remaining motion`, () => {
  const { deck, host } = chest(); let commits = 0, closes = 0;
  deck.addEventListener('transitioncomplete', e => {
    if (e.detail.transition === 'commit') commits++;
    if (e.detail.transition === 'close') closes++;
  });
  deck.commit(); step();
  if (mode === 'reduced') { deck.media.matches = true; deck.media.dispatchEvent(new Event('change')); }
  else { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
  assert.equal(deck.phase, 'choices'); assert.equal(commits, 1); assert.equal(deck.frame, 0);
  deck.setOpen(false); deck.schedule(); assert.equal(closes, 1); assert.equal(deck.phase, 'choices');
  deck.replaceContent(fixture(2, 'choice'), { presentation: 'lid' });
  assert.equal(commits, 2); assert.equal(deck.phase, 'closed'); assert.equal(deck.busy, false); assert.equal(deck.frame, 0);
  assert.equal(scenePose(deck).rx, 0); deck.finishMotion(); assert.equal(commits, 2);
  dispose(deck, host);
});

test('final lid arrival starts hinged, closes continuously and completes one committed destination', () => {
  const deck = make(1, createChestContainer(['goggles'], true)); ready(deck);
  let complete = 0;
  deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'commit') complete++; });
  deck.replaceContent(fixture(2, 'choice'), { presentation: 'lid' });
  assert.equal(deck.start(), false); assert.equal(deck.busy, true);
  assert.equal(scenePose(deck).rx, 75); const angles = [];
  for (let i = 0; frames.size && i < 2000; i++) { step(); angles.push(scenePose(deck).rx); }
  assert.ok(angles.some(angle => angle < 60 && angle > 5));
  assert.equal(deck.phase, 'closed'); assert.equal(deck.busy, false); assert.equal(complete, 1);
  assert.equal(deck.lidArrival, null); assert.equal(scenePose(deck).rx, 0); dispose(deck);
});

for (const action of ['reset', 'replace', 'destroy']) test(`${action} cancels lid arrival with no stale completion`, () => {
  const deck = make(2, fixture(2, 'choice')); let complete = 0;
  deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'commit') complete++; });
  deck.replaceContent(fixture(2, 'choice'), { presentation: 'lid' }); step();
  if (action === 'replace') deck.replaceContent(fixture(3, 'choice')); else deck[action]();
  settle(); assert.equal(deck.lidArrival, null); assert.equal(complete, 0); assert.equal(deck.frame, 0);
  dispose(deck);
});

test('a short opening gesture already gives a pronounced hinge and pickup', () => {
  const pose = lidPose({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }, .1, 453, 653);
  assert.ok(pose.rx > 9, 'short gesture rotates visibly before departure');
  const hingeTop = pose.y - 453 / 2 * Math.cos(pose.rx * Math.PI / 180);
  assert.ok(hingeTop < -453 / 2 - 20, 'the top edge is already lifted');
});

test('the lid stays inside the camera at the shortest supported perspective', () => {
  const { deck, host } = chest();
  deck.updateSettings({ perspective: 400 });
  deck.start(); deck.move(gesture(-300));
  for (let i = 0; i < deck.cards.length; i++) assert.doesNotThrow(() => projectedBounds(cardPose(deck, i), 340, 453, 400));
  deck.end(gesture(-300)); settle();
  deck.setOpen(false); deck.schedule(); settle();
  assert.equal(deck.phase, 'choices');
  deck.replaceContent(fixture(2, 'choice'), { presentation: 'lid' }); settle();
  assert.equal(deck.phase, 'closed');
  dispose(deck, host);
});

test('a temporarily hidden lid mount does not throw while rendering or arriving', () => {
  const { deck, host } = chest();
  deck.mount.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
  assert.doesNotThrow(() => deck.render());
  assert.doesNotThrow(() => deck.replaceContent(fixture(2, 'choice'), { presentation: 'lid' }));
  settle(); dispose(deck, host);
});

test('a short downward drag reveals the lid before release and before items fully compress', () => {
  const { deck, host } = chest(); deck.commit(); settle();
  deck.start(); deck.move(gesture(40));
  assert.equal(host.mode, 'container', 'the gesture has not committed');
  assert.equal(deck.phase, 'choices');
  assert.ok(deck.fan.x > 0, 'items are still compressing');
  for (const card of deck.returnDeck.cards) {
    assert.equal(card.style.visibility, 'visible');
    assert.ok(projectedBounds(renderedPose(card), 340, 453, 1200).bottom > 0, 'lid already enters the visible stage');
  }
  const before = deck.returnDeck.cards.map(renderedPose);
  deck.move(gesture(55));
  deck.returnDeck.cards.forEach((card, i) => assert.ok(renderedPose(card).y > before[i].y, 'lid follows downward movement'));
  deck.cancel(); settle();
  assert.equal(host.mode, 'container');
  assert.ok(deck.returnDeck.cards.every(card => card.style.visibility === 'hidden'));
  dispose(deck, host);
});

test('manual lid closing stays ajar even on a long held swipe and finishes only after release', () => {
  const { deck, host } = chest(); deck.commit(); settle();
  deck.start(); deck.move(gesture(400));
  const partial = deck.returnDeck.cards.map(renderedPose);
  assert.ok(deck.returnLift.x < .9);
  assert.ok(partial.every(pose => pose.rx > 5), 'lid remains tilted open');
  assert.equal(host.mode, 'container');
  deck.move(gesture(700));
  assert.ok(deck.returnLift.x < .9, 'further finger travel cannot fully close the lid');
  deck.returnDeck.cards.forEach((card, i) => {
    assert.ok(renderedPose(card).y > partial[i].y, 'longer drags still move the lid');
    assert.ok(renderedPose(card).rx < partial[i].rx, 'longer drags still rotate toward closure');
  });
  deck.end(gesture(700)); settle();
  assert.equal(host.mode, 'entry');
  assert.equal(deck.phase, 'choices');
  assert.equal(host.remainingIds.size, 3);
  assert.ok(deck.cards.every(card => Math.abs(renderedPose(card).rx) < 1e-8), 'released lid finishes flat');
  dispose(deck, host);
});

test('manual closing response stays smooth and keeps moving with diminishing sensitivity', () => {
  const { deck, host } = chest(); deck.commit(); settle(); deck.start();
  const points = [40, 80, 120, 160, 200, 400, 600, 800, 1000];
  let previous = 0, previousSlope = Infinity;
  for (let i = 0; i < points.length; i++) {
    deck.move(gesture(points[i]));
    const current = deck.returnLift.x;
    const slope = (current - previous) / (points[i] - (points[i - 1] || 0));
    assert.ok(current > previous && current < .9, 'every additional drag moves the lid but leaves it ajar');
    assert.ok(slope > 0 && slope < previousSlope, 'resistance increases continuously');
    previous = current; previousSlope = slope;
  }
  deck.move(gesture(100)); const near = deck.returnLift.x;
  deck.move(gesture(100.1)); assert.ok(deck.returnLift.x > near && deck.returnLift.x - near < .001, 'no sudden stop or jump');
  deck.cancel(); settle(); dispose(deck, host);
});

test('held Open has a strong initial response then keeps opening slowly until release', () => {
  const { deck, host } = chest(); deck.start();
  deck.move(gesture(-40));
  assert.ok(cardPose(deck, deck.index).rx > 15, 'initial short gesture opens the hinge noticeably');
  let lastAngle = 0, lastSlope = Infinity;
  const distances = [40, 80, 120, 200, 400, 700, 1000];
  for (let i = 0; i < distances.length; i++) {
    deck.move(gesture(-distances[i]));
    const pose = cardPose(deck, deck.index);
    assert.ok(pose.rx > lastAngle && pose.rx < 65, 'held gesture keeps opening but never completes the lid departure');
    const slope = (pose.rx - lastAngle) / (distances[i] - (distances[i - 1] || 0));
    assert.ok(slope > 0 && slope < lastSlope, 'opening response softens as the finger travels farther');
    assert.ok(projectedBounds(pose, 340, 453, 1200).bottom > 0, 'lid is still partly in the scene');
    lastAngle = pose.rx; lastSlope = slope;
  }
  assert.equal(host.mode, 'entry');
  const before = poses(deck); deck.end(gesture(-1000));
  for (const [id, pose] of poses(deck)) samePose(pose, before.get(id), 'release continues from the exact held pose');
  settle(); assert.equal(host.mode, 'container'); assert.equal(deck.phase, 'choices');
  dispose(deck, host);
});
