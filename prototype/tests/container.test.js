import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck } from '../engine/CardDeck.js';
import { cardPose, scenePose } from '../engine/renderer.js';
import { projectedBounds } from '../engine/geometry.js';
import { ScenarioController, CHEST_ITEM_IDS, createChestEntry, createChestContainer, createStudyContent } from '../demo/ScenarioController.js';

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
function samePose(actual, expected, message) { for (const field of fields) assert.ok(Math.abs(actual[field] - expected[field]) < 1e-8, `${message}: ${field} changed ${expected[field]} -> ${actual[field]}`); }
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function opaque(deck) { for (const node of descendants(deck.mount)) assert.equal(Object.hasOwn(node.style, 'opacity'), false); }
function inputBlocked(deck) { const index = deck.index, cursor = deck.b.target; assert.equal(deck.start(), false); for (const name of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) key(deck, name); deck.commit(); assert.equal(deck.index, index); assert.equal(deck.b.target, cursor); assert.equal(deck.open, true); }
function dispose(deck, host) { host?.destroy(); deck.destroy(); settle(); document.hidden = false; }

for (const count of [2, 3, 4]) test(`${count} underlying choices do not inherit a situation swipe's tilt or settling`, () => {
  const deck = make(count, fixture(count, 'choice'));
  const original = poses(deck);
  deck.start({ clientX: 30, clientY: 60 }); deck.move(gesture(-60));
  for (let i = 0; i < 8; i++) step();
  assert.ok(Math.abs(scenePose(deck).rz) > .1, 'the grabbed situation still tilts');
  for (const [id, pose] of poses(deck)) samePose(pose, original.get(id), 'choices stay fixed under a held cover');
  deck.cancel(); settle();
  deck.start({ clientX: 30, clientY: 60 }); deck.move(gesture(-150));
  for (let i = 0; i < 8; i++) step();
  deck.end(gesture(-150));
  for (let i = 0; frames.size && i < 2000; i++) {
    step();
    const actual = poses(deck), rotations = [deck.rotationX, deck.rotationY, deck.rotationZ], angles = rotations.map(s => s.x);
    rotations.forEach(s => { s.x = 0; }); const unaffected = poses(deck);
    rotations.forEach((s, index) => { s.x = angles[index]; });
    for (const [id, pose] of actual) samePose(pose, unaffected.get(id), 'fan expansion ignores the departing cover tilt');
  }
  assert.equal(deck.phase, 'choices');
  deck.rotationX.x = 2; deck.rotationZ.x = -2;
  const beforeGrab = poses(deck); deck.start({ clientX: 30, clientY: 60 }); deck.move(gesture(0));
  for (const [id, pose] of poses(deck)) samePose(pose, beforeGrab.get(id), 'first action grab has no inherited tilt jump');
  deck.move(gesture(-60)); for (let i = 0; i < 8; i++) step();
  assert.ok(Math.abs(poses(deck).get('item-0').rz) > .1, 'direct action gestures still tilt the action');
  deck.cancel(); settle(); dispose(deck);
});

for (let count = 1; count <= 4; count++) for (let index = 0; index < count; index++) {
  test(`container ${count}, selected ${index}: independent lift, offscreen removal and continuous survivor reflow`, () => {
    const deck = make(count); ready(deck); select(deck, index);
    const originals = new Map(deck.content.actions.map((a, i) => [a.id, { card: deck.cards[i], layer: deck.cardLayers[i] }]));
    const initial = poses(deck), selectedId = deck.content.actions[index].id;
    const accepted = [], completed = [];
    deck.addEventListener('collect', e => accepted.push(e.detail));
    deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'collect') completed.push(e.detail); });
    assert.equal(deck.start(), true); deck.move(gesture(-150));
    let held = poses(deck); assert.ok(held.get(selectedId).y < initial.get(selectedId).y - 149);
    for (const [id, pose] of held) if (id !== selectedId) samePose(pose, initial.get(id), 'held survivor');
    step(); step(); held = poses(deck);
    for (const [id, pose] of held) if (id !== selectedId) samePose(pose, initial.get(id), 'survivor while angular spring runs');
    deck.end(gesture(-150)); assert.equal(accepted.length, 1); assert.equal(accepted[0].contentId, `items-${count}`); assert.equal(accepted[0].action.id, selectedId); assert.equal(accepted[0].index, index);
    assert.equal(deck.cards.length, count); assert.equal(originals.get(selectedId).layer.parentNode, deck.mount); inputBlocked(deck);
    const motion = deck.collectMotion; step(motion.start + motion.duration - 0.001 - now);
    const beforeRemoval = poses(deck);
    const bounds = deck.mount.getBoundingClientRect();
    assert.ok(projectedBounds(beforeRemoval.get(selectedId), bounds.width, bounds.height, deck.settings.perspective).bottom < 0, 'selected card clears the visible stage before physical removal');
    for (const [id, pose] of beforeRemoval) if (id !== selectedId) samePose(pose, initial.get(id), 'flight survivor');
    assert.equal(deck.cards.length, count); opaque(deck); step(0.002);
    assert.equal(deck.cards.length, count - 1); assert.equal(originals.get(selectedId).layer.parentNode, null);
    assert.equal(completed.length, 0, 'collection completion waits for survivor settling');
    const afterRemoval = poses(deck);
    for (const [id, pose] of afterRemoval) {
      samePose(pose, beforeRemoval.get(id), 'pose at count reduction');
      const i = deck.content.actions.findIndex(a => a.id === id), original = originals.get(id);
      assert.equal(deck.cards[i], original.card); assert.equal(deck.cardLayers[i], original.layer); assert.equal(original.card.parentNode, original.layer);
    }
    if (count > 1) inputBlocked(deck);
    settle(); assert.equal(accepted.length, 1); assert.equal(completed.length, 1);
    assert.deepEqual(new Set(completed[0].remainingIds), new Set([...originals.keys()].filter(id => id !== selectedId)));
    assert.equal(deck.busy, false); assert.equal(deck.phase, count === 1 ? 'closed' : 'choices'); opaque(deck); dispose(deck);
  });
}

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

for (const outcome of ['cancel', 'slow', 'reverse', 'flick']) test(`container gesture ${outcome} settles or accepts once`, () => {
  const deck = make(); ready(deck); const original = poses(deck); let collects = 0, commits = 0;
  deck.addEventListener('collect', () => collects++); deck.addEventListener('commit', () => commits++);
  deck.start(); deck.move(gesture(-40));
  if (outcome === 'cancel') deck.cancel();
  else if (outcome === 'reverse') { deck.move(gesture(25)); deck.end(gesture(25)); }
  else deck.end(gesture(-40, outcome === 'flick' ? -900 : 0));
  settle(); assert.equal(commits, 0); assert.equal(collects, outcome === 'flick' ? 1 : 0); assert.equal(deck.cards.length, outcome === 'flick' ? 2 : 3);
  if (outcome !== 'flick') for (const [id, pose] of poses(deck)) samePose(pose, original.get(id), 'canceled pose'); dispose(deck);
});

test('custom disabled face down action springs at most 24px without preview or acceptance', () => {
  const disabled = { ...fixture(2, 'choice'), actions: [{ id: 'open', label: '', accessibleLabel: 'Open', disabled: true, faceDown: true }, { id: 'leave', label: 'Go on' }] };
  const deck = make(2, disabled); ready(deck); const initial = poses(deck); let commits = 0, collects = 0;
  deck.addEventListener('commit', () => commits++); deck.addEventListener('collect', () => collects++);
  assert.ok(deck.cardBacks[0]); assert.equal(deck.cards[0].getAttribute('aria-disabled'), 'true');
  assert.equal(deck.cards[0].children[0].children[1].textContent, '');
  for (const y of [-150, -2000]) {
    deck.start(); deck.move(gesture(y)); const held = poses(deck);
    assert.ok(initial.get('open').y - held.get('open').y <= 24 + 1e-8); samePose(held.get('leave'), initial.get('leave'), 'disabled survivor');
    assert.equal(deck.underlayBack, null); deck.end(gesture(y, -2000)); settle();
    assert.equal(deck.phase, 'choices'); assert.equal(deck.busy, false); assert.equal(deck.cards.length, 2);
  }
  key(deck, 'ArrowUp'); settle(); assert.equal(commits, 0); assert.equal(collects, 0); assert.equal(deck.underlayBack, null); opaque(deck); dispose(deck);
});

for (const interruption of ['reset', 'replaceContent', 'destroy']) for (const moment of ['flight', 'reflow']) test(`${interruption} during collection ${moment} cancels later completion`, () => {
  const deck = make(4); ready(deck); let complete = 0;
  deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'collect') complete++; });
  deck.commit(); if (moment === 'reflow') step(deck.collectMotion.start + deck.settings.commitDuration + 1 - now);
  if (interruption === 'replaceContent') deck.replaceContent(fixture(2, 'choice')); else deck[interruption]();
  settle(); assert.equal(complete, 0); assert.equal(deck.collectMotion, null); assert.equal(deck.frame, 0);
  if (interruption === 'destroy') assert.equal(deck.mount.children.length, 0);
  else { assert.equal(deck.busy, false); assert.equal(deck.phase, 'closed'); assert.equal(deck.cards.length, interruption === 'replaceContent' ? 2 : moment === 'flight' ? 4 : 3); }
  dispose(deck);
});

for (const mode of ['reduced', 'hidden']) for (const moment of ['flight', 'reflow']) test(`${mode} completes collection ${moment} exactly once`, () => {
  const deck = make(); ready(deck); let complete = 0;
  deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'collect') complete++; }); deck.commit();
  if (moment === 'reflow') step(deck.collectMotion.start + deck.settings.commitDuration + 1 - now);
  if (mode === 'reduced') { deck.media.matches = true; deck.media.dispatchEvent(new Event('change')); }
  else { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
  assert.equal(complete, 1); assert.equal(deck.cards.length, 2); assert.equal(deck.busy, false); assert.equal(deck.phase, 'choices'); assert.equal(deck.frame, 0);
  deck.finishMotion(); assert.equal(complete, 1); opaque(deck); dispose(deck);
});

test('resize and repeated collection preserve survivor identity through interrupted browse settling', () => {
  const deck = make(4); ready(deck); const originals = new Map(deck.content.actions.map((a, i) => [a.id, deck.cards[i]]));
  for (let round = 0; round < 4; round++) {
    if (deck.cards.length > 1) { key(deck, 'ArrowRight'); step(); }
    deck.start(); deck.move(gesture(-150)); deck.end(gesture(-150));
    let width = 340; deck.mount.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: width * 4 / 3 });
    width = 249; deck.resize.callback(); settle();
    for (let i = 0; i < deck.cards.length; i++) assert.equal(deck.cards[i], originals.get(deck.content.actions[i].id));
    for (const pose of poses(deck).values()) for (const field of fields) assert.ok(Number.isFinite(pose[field]));
    if (deck.cards.length) { key(deck, 'ArrowDown'); settle(); key(deck, 'ArrowUp'); settle(); }
  }
  assert.equal(deck.phase, 'closed'); assert.equal(deck.cards.length, 0); dispose(deck);
});

function chest() { const deck = make(2, createStudyContent(0, 2)); const notices = []; const host = new ScenarioController(deck, { fixture: 'chest', onChange: detail => notices.push(detail) }); return { deck, host, notices }; }
function enterChest(deck) { ready(deck); key(deck, 'ArrowUp'); settle(); assert.equal(deck.content.id, 'chest-items'); assert.equal(deck.phase, 'choices'); }
test('host completes chest cycle, remembers acceptance, returns only Go on, advances and resets', () => {
  const { deck, host, notices } = chest(); enterChest(deck); assert.equal(host.mode, 'container');
  const taken = [];
  while (deck.cards.length && deck.content.id === 'chest-items') {
    const id = deck.content.actions[deck.index].id; taken.push(id); deck.commit();
    assert.equal(host.remainingIds.has(id), false, 'host stores collection immediately on acceptance'); settle();
  }
  assert.deepEqual(new Set(taken), new Set(CHEST_ITEM_IDS)); assert.equal(host.mode, 'entry'); assert.equal(deck.content.id, 'chest-entry'); assert.equal(deck.phase, 'choices');
  assert.deepEqual(deck.content.actions.map(a => a.id), ['leave']); assert.equal(deck.scene.style.visibility, 'hidden');
  key(deck, 'ArrowUp'); settle(); assert.equal(host.mode, 'choice'); assert.equal(deck.content.id, 'study-0-2');
  host.reset('chest'); assert.deepEqual([...host.remainingIds], CHEST_ITEM_IDS); assert.equal(deck.content.id, 'chest-entry'); assert.equal(deck.phase, 'closed');
  assert.equal(notices.filter(n => n.reason === 'collect').length, 3); dispose(deck, host);
});
test('host partial collection close/reopen retains remaining IDs and original fixture cycles', () => {
  const { deck, host } = chest(); enterChest(deck); select(deck, 1); const removed = deck.content.actions[1].id; deck.commit(); settle();
  const remaining = CHEST_ITEM_IDS.filter(id => id !== removed); key(deck, 'ArrowDown'); settle(); assert.equal(host.mode, 'entry'); assert.deepEqual([...host.remainingIds], remaining);
  assert.equal(deck.phase, 'choices'); assert.equal(deck.content.actions[deck.index].id, 'open'); key(deck, 'ArrowUp'); settle(); assert.equal(deck.content.id, 'chest-items'); assert.deepEqual(new Set(deck.content.actions.map(a => a.id)), new Set(remaining)); host.reset('chest'); assert.deepEqual([...host.remainingIds], CHEST_ITEM_IDS);
  for (const count of [2, 3, 4]) { host.reset(String(count)); assert.equal(deck.content.actions.length, count); ready(deck); key(deck, 'ArrowUp'); settle(); assert.equal(host.studyIndex, 1); assert.equal(deck.content.actions.length, count === 4 ? 2 : count + 1); assert.equal(deck.content.interaction, 'choice'); }
  host.destroy(); const snapshot = [...host.remainingIds]; deck.replaceContent(createChestContainer(CHEST_ITEM_IDS), { presentation: 'open' }); settle(); deck.commit(); settle(); assert.deepEqual([...host.remainingIds], snapshot); dispose(deck);
});

for (const count of [3, 4]) for (let index = 0; index < count; index++) test(`container ${count}, selected ${index}: overlapping survivors preserve painter order at removal`, () => {
    const deck = make(count); ready(deck); select(deck, index); deck.commit();
    const motion = deck.collectMotion; step(motion.start + motion.duration - .001 - now);
    const survivors = deck.content.actions.map((a, i) => ({ id: a.id, layer: deck.cardLayers[i], pose: cardPose(deck, i, now) })).filter((_, i) => i !== index);
    const order = new Map(survivors.map(a => [a.id, Number(a.layer.style.zIndex)]));
    step(.002);
    try {
      for (let a = 0; a < survivors.length; a++) for (let b = a + 1; b < survivors.length; b++) {
        const one = survivors[a], two = survivors[b], bounds = deck.mount.getBoundingClientRect();
        const p = projectedBounds(one.pose, bounds.width, bounds.height, deck.settings.perspective);
        const q = projectedBounds(two.pose, bounds.width, bounds.height, deck.settings.perspective);
        if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom)
          assert.equal(Math.sign(Number(one.layer.style.zIndex) - Number(two.layer.style.zIndex)), Math.sign(order.get(one.id) - order.get(two.id)), `overlapping painter order changed at count ${count}, selected ${index}: ${one.id}/${two.id}`);
      }
    } finally { dispose(deck); }
});

test('re-grabbing a returning item and changing drag direction preserve current transforms', () => {
  const deck = make(4); ready(deck); select(deck, 2);
  deck.start(); deck.move(gesture(-80)); deck.cancel(); step(); step();
  const returning = poses(deck); assert.equal(deck.start(), true); deck.move(gesture(0));
  for (const [id, pose] of poses(deck)) samePose(pose, returning.get(id), 'zero-distance re-grab');
  // Crossing from lift to browse at zero horizontal displacement is a physical
  // handoff, so the card must retain its current pose while new targets settle.
  const beforeAxisChange = poses(deck); deck.move({ axis: 'x', x: 0, y: 0, vx: 0, vy: 0 });
  for (const [id, pose] of poses(deck)) samePose(pose, beforeAxisChange.get(id), 'axis reversal handoff');
  deck.cancel(); settle(); assert.equal(deck.phase, 'choices'); assert.equal(deck.cards.length, 4); opaque(deck); dispose(deck);
});

for (const action of ['reset', 'replace', 'destroy']) test(`collection acceptance callback may ${action} without stale animation`, () => {
  const deck = make(); ready(deck); let accepted = 0, completed = 0;
  deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'collect') completed++; });
  deck.addEventListener('collect', () => { accepted++; if (action === 'replace') deck.replaceContent(fixture(2, 'choice')); else deck[action](); });
  deck.commit(); settle(); assert.equal(accepted, 1); assert.equal(completed, 0); assert.equal(deck.collectMotion, null); assert.equal(deck.frame, 0);
  if (action !== 'destroy') { assert.equal(deck.busy, false); assert.equal(deck.phase, 'closed'); assert.equal(deck.cards.length, action === 'replace' ? 2 : 3); }
  dispose(deck);
});

const reflowPresets = [
  ['default', {}],
  ['captured', { axisThreshold: 27, distanceThreshold: .21, flickVelocity: 375, commitDuration: 190, perspective: 1100 }],
  ['extreme', { maxTilt: 18, stackDepth: 30, perspective: 650 }],
];
for (const [preset, settings] of reflowPresets) for (const width of [249, 340]) for (const count of [3, 4]) for (let selected = 0; selected < count; selected++) {
  test(`${preset} ${width}px container ${count}, selected ${selected}: survivors compact without painter swaps or horizontal reshuffling`, () => {
    const deck = make(count); deck.mount.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: width * 4 / 3 }); deck.updateSettings(settings);
    ready(deck); select(deck, selected);
    if (preset === 'extreme') { deck.rotationX.x = 18; deck.rotationY.x = -18; deck.rotationZ.x = 18; deck.render(); }
    const original = new Map(deck.content.actions.map((a, i) => [a.id, deck.cards[i]]));
    const orderOf = () => new Map(deck.content.actions.map((a, i) => [a.id, Number(deck.cardLayers[i].style.zIndex)]));
    let oldOrder = orderOf(), swaps = 0, completed = 0;
    const starting = poses(deck), samples = [];
    const removedId = deck.content.actions[selected].id;
    deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'collect') completed++; });
    deck.commit();
    try {
      for (let frame = 0; frames.size && frame < 1000; frame++) {
        step(); const nextOrder = orderOf(), ids = [...nextOrder.keys()], sample = poses(deck);
        for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
          const one = ids[a], two = ids[b];
          if (Math.sign(oldOrder.get(one) - oldOrder.get(two)) !== Math.sign(nextOrder.get(one) - nextOrder.get(two))) {
            swaps++;
          }
        }
        for (let i = 0; i < deck.cards.length; i++) {
          assert.equal(deck.cards[i], original.get(deck.content.actions[i].id)); assert.equal(deck.cards[i].style.visibility, 'visible');
          for (const field of fields) assert.ok(Number.isFinite(sample.get(deck.content.actions[i].id)[field]));
        }
        samples.push(sample); opaque(deck); oldOrder = nextOrder;
      }
      assert.equal(frames.size, 0, 'collection and clearance reflow settle within 16 seconds');
      assert.equal(completed, 1); assert.equal(deck.busy, false); assert.equal(deck.phase, 'choices'); assert.equal(deck.cards.length, count - 1);
      assert.equal(swaps, 0, 'relative survivor painter order never changes');
      const rest = poses(deck), tolerance = preset === 'extreme' ? 18 : 10;
      for (const sample of samples) for (const [id, pose] of sample) if (id !== removedId) {
        const low = Math.min(starting.get(id).x, rest.get(id).x) - tolerance, high = Math.max(starting.get(id).x, rest.get(id).x) + tolerance;
        assert.ok(pose.x >= low && pose.x <= high, `${id} leaves compacting corridor: ${pose.x}, expected ${low}..${high}`);
      }
      const selectedOrder = Number(deck.cardLayers[deck.index].style.zIndex);
      assert.ok(deck.cardLayers.every(layer => Number(layer.style.zIndex) <= selectedOrder), 'survivor selection finishes in the foreground');
    } finally { dispose(deck); }
  });
}

test('collecting middle Flashlight leaves two original cards in a small fan without a shuffle', () => {
  const deck = make(3, createChestContainer(CHEST_ITEM_IDS)); ready(deck); select(deck, 1);
  const initial = poses(deck), originals = new Map(deck.content.actions.map((a, i) => [a.id, deck.cards[i]]));
  const painter = new Map(deck.content.actions.map((a, i) => [a.id, Number(deck.cardLayers[i].style.zIndex)]));
  const expectedFront = ['goggles', 'pack'].sort((a, b) => painter.get(b) - painter.get(a))[0];
  deck.commit(); const samples = [];
  for (let i = 0; frames.size && i < 2000; i++) {
    step(); samples.push(poses(deck));
    const survivors = deck.content.actions.map((a, i) => ({ id: a.id, layer: deck.cardLayers[i] })).filter(a => a.id !== 'flashlight');
    assert.equal(Math.sign(Number(survivors[0].layer.style.zIndex) - Number(survivors[1].layer.style.zIndex)), Math.sign(painter.get(survivors[0].id) - painter.get(survivors[1].id)));
  }
  assert.equal(deck.cards.length, 2); assert.equal(deck.content.actions[deck.index].id, expectedFront);
  const rest = poses(deck);
  for (let i = 0; i < 2; i++) assert.equal(deck.cards[i], originals.get(deck.content.actions[i].id));
  for (const sample of samples) for (const [id, pose] of sample) if (id !== 'flashlight') {
    assert.ok(pose.x >= Math.min(initial.get(id).x, rest.get(id).x) - 10 && pose.x <= Math.max(initial.get(id).x, rest.get(id).x) + 10, `${id} shuffled away from its compact fan`);
  }
  assert.ok(Math.max(...[...rest.values()].map(pose => Math.abs(pose.x))) < 80); opaque(deck); dispose(deck);
});

test('partial and canceled container closes return to items; accepted nonempty close selects Open', () => {
  const { deck, host } = chest(); enterChest(deck); const original = poses(deck), cards = [...deck.cards];
  for (const canceled of [true, false]) {
    deck.start(); deck.move(gesture(35)); if (canceled) deck.cancel(); else deck.end(gesture(35)); settle();
    assert.equal(host.mode, 'container'); assert.equal(deck.phase, 'choices'); assert.deepEqual(deck.cards, cards);
    for (const [id, pose] of poses(deck)) samePose(pose, original.get(id), 'returned items');
  }
  key(deck, 'ArrowDown'); settle(); assert.equal(host.mode, 'entry'); assert.equal(deck.phase, 'choices');
  assert.deepEqual(new Set(deck.content.actions.map(a => a.id)), new Set(['open', 'leave']));
  assert.equal(deck.content.actions[deck.index].id, 'open'); assert.equal(deck.scene.style.visibility, 'hidden');
  assert.equal(deck.flip.x, 0); assert.equal(deck.underlayBack, null); opaque(deck); dispose(deck, host);
});

test('held Open reveals real preloaded items and adopts their same DOM and transforms without a flip', () => {
  const { deck, host } = chest(); ready(deck); const entries = [...deck.cards]; let commits = 0;
  deck.addEventListener('commit', () => commits++);
  deck.start(); deck.move(gesture(-150));
  const preloaded = deck.forwardDeck.cards; assert.equal(preloaded.length, 3, 'actual item articles exist during the held swipe');
  for (const card of preloaded) { assert.equal(card.style.visibility, 'visible'); assert.ok(Number(card.parentNode.style.zIndex) < Math.min(...entries.map(entry => Number(entry.parentNode.style.zIndex)))); }
  assert.equal(deck.underlayBack, null); assert.equal(commits, 0); assert.equal(host.mode, 'entry'); assert.equal(deck.flip.x, 0);
  deck.end(gesture(-150)); assert.equal(commits, 1);
  const motion = deck.commitMotion, adoption = motion.start + deck.settings.commitDuration;
  while (now + 16 < adoption) { step(); assert.equal(deck.flip.x, 0); assert.equal(deck.underlayBack, null); assert.ok(preloaded.every(card => card.style.visibility === 'visible')); opaque(deck); }
  step(adoption - .001 - now);
  const transforms = new Map(preloaded.map(card => [card, card.style.transform])); step(.002);
  assert.equal(deck.content.id, 'chest-items'); assert.deepEqual(new Set(deck.cards), new Set(preloaded));
  for (const card of preloaded) assert.equal(card.style.transform, transforms.get(card), 'adoption retains the physical item pose');
  for (let i = 0; frames.size && i < 2000; i++) { step(); assert.equal(deck.flip.x, 0); assert.equal(deck.underlayBack, null); opaque(deck); }
  assert.equal(deck.phase, 'choices'); assert.equal(deck.scene.style.visibility, 'hidden'); dispose(deck, host);
});

test('canceling held Open hides its item preview and preserves the host and entry fan', () => {
  const { deck, host } = chest(); ready(deck); const entry = [...deck.cards]; let commits = 0; deck.addEventListener('commit', () => commits++);
  deck.start(); deck.move(gesture(-150)); const items = deck.forwardDeck.cards; assert.equal(items.length, 3); assert.ok(items.every(card => card.style.visibility === 'visible')); deck.cancel(); settle();
  assert.equal(commits, 0); assert.equal(host.mode, 'entry'); assert.equal(deck.content.id, 'chest-entry'); assert.deepEqual(deck.cards, entry);
  assert.ok(items.every(card => card.style.visibility === 'hidden')); assert.equal(deck.underlayBack, null); assert.equal(deck.flip.x, 0); opaque(deck); dispose(deck, host);
});

for (const action of ['reset', 'replace', 'destroy']) test(`${action} discards staged Open destinations and stale gesture work`, () => {
  const content = createChestEntry(CHEST_ITEM_IDS), deck = make(2, content); ready(deck);
  deck.setActionPreview('open', createChestContainer(CHEST_ITEM_IDS), { presentation: 'open' });
  let commits = 0; deck.addEventListener('commit', () => commits++);
  deck.start(); deck.move(gesture(-150)); const items = deck.forwardDeck.cards; assert.equal(items.length, 3);
  if (action === 'replace') deck.replaceContent(fixture(2, 'choice')); else deck[action]();
  settle(); assert.equal(deck.frame, 0); assert.equal(deck.drag, null); assert.equal(commits, 0);
  assert.ok(items.every(card => !descendants(deck.mount).includes(card)), 'staged articles are detached');
  if (action === 'destroy') {
    assert.equal(deck.mount.children.length, 0); key(deck, 'ArrowUp'); document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); assert.equal(deck.frame, 0);
  } else { assert.equal(deck.phase, 'closed'); assert.equal(deck.busy, false); }
  dispose(deck);
});

for (const action of ['reset', 'replace', 'destroy']) test(`${action} clears a staged return deck and cannot later adopt it`, () => {
  const deck = make(3, createChestContainer(CHEST_ITEM_IDS)); ready(deck);
  deck.setReturnContent(createChestEntry(CHEST_ITEM_IDS), { selectedId: 'open' });
  const returned = [...deck.returnDeck.cards]; assert.equal(returned.length, 2);
  let complete = 0; deck.addEventListener('transitioncomplete', event => { if (event.detail.transition === 'close') complete++; });
  deck.setOpen(false); step();
  if (action === 'replace') deck.replaceContent(fixture(2, 'choice')); else deck[action]();
  settle(); assert.equal(complete, 0); assert.equal(deck.frame, 0); assert.equal(deck.returnDeck, null);
  assert.ok(returned.every(card => !descendants(deck.mount).includes(card)));
  if (action === 'destroy') assert.equal(deck.mount.children.length, 0);
  else { assert.equal(deck.phase, 'closed'); assert.equal(deck.busy, false); }
  dispose(deck);
});

for (const mode of ['reduced', 'hidden']) for (const transition of ['open', 'manual-return', 'empty-return']) test(`${mode} finishes direct ${transition} with one completion and no remaining motion`, () => {
  const { deck, host } = chest(); ready(deck);
  if (transition !== 'open') { key(deck, 'ArrowUp'); settle(); }
  if (transition === 'empty-return') { deck.commit(); settle(); deck.commit(); settle(); assert.equal(deck.cards.length, 1); }
  const kind = transition === 'open' ? 'commit' : 'close'; let complete = 0;
  deck.addEventListener('transitioncomplete', event => { if (event.detail.transition === kind) complete++; });
  if (transition === 'manual-return') { deck.setOpen(false); deck.schedule(); } else deck.commit();
  if (mode === 'reduced') { deck.media.matches = true; deck.media.dispatchEvent(new Event('change')); }
  else { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
  assert.equal(deck.phase, 'choices'); assert.equal(deck.busy, false); assert.equal(deck.open, true);
  assert.equal(deck.frame, 0); assert.equal(deck.flip.x, 0); assert.equal(deck.scene.style.visibility, 'hidden'); assert.equal(complete, 1);
  if (transition === 'open') { assert.equal(host.mode, 'container'); assert.equal(deck.content.id, 'chest-items'); }
  else { assert.equal(host.mode, 'entry'); assert.equal(deck.content.actions[deck.index].id, transition === 'empty-return' ? 'leave' : 'open'); assert.equal(deck.cards.length, transition === 'empty-return' ? 1 : 2); }
  deck.finishMotion(); assert.equal(complete, 1); opaque(deck); dispose(deck, host);
});

function renderedPose(card) {
  const values = [...card.style.transform.matchAll(/(-?[\d.]+)(?:px|deg)/g)].map(match => Number(match[1]));
  assert.equal(values.length, fields.length, 'article has a complete finite transform');
  return Object.fromEntries(fields.map((field, i) => [field, values[i]]));
}
function blockedDuringReturn(deck) {
  const snapshot = [deck.index, deck.b.target, deck.open, deck.content.id, deck.phase];
  assert.equal(deck.start(), false, 'returning cards cannot be grabbed');
  for (const name of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) key(deck, name);
  deck.commit();
  assert.deepEqual([deck.index, deck.b.target, deck.open, deck.content.id, deck.phase], snapshot, 'returning cards ignore selection, commit and close inputs');
}
function watchReturnAdoption(deck, returned) {
  let adopted = 0;
  const completeReturn = deck.completeReturn;
  deck.completeReturn = function () {
    const before = returned.map(renderedPose);
    completeReturn.call(this);
    assert.deepEqual(new Set(this.cards), new Set(returned), 'return adopts the same staged articles');
    returned.forEach((card, i) => samePose(renderedPose(card), before[i], 'return adoption'));
    adopted++;
  };
  return () => adopted;
}
function assertAbove(deck, card) {
  const bounds = deck.mount.getBoundingClientRect();
  assert.ok(projectedBounds(renderedPose(card), bounds.width, bounds.height, deck.settings.perspective).bottom < 0, 'return begins fully above the visible stage');
}
function traceReturn(deck, returned) {
  let visibleFrames = 0, descendingFrames = 0;
  const previous = returned.map(renderedPose);
  for (let frame = 0; frames.size && frame < 2000; frame++) {
    if (deck.phase !== 'choices') blockedDuringReturn(deck);
    step();
    returned.forEach((card, i) => {
      assert.ok(descendants(deck.mount).includes(card), 'staged article survives the whole return');
      const pose = renderedPose(card);
      for (const field of fields) assert.ok(Number.isFinite(pose[field]));
      if (card.style.visibility === 'visible') {
        visibleFrames++;
        if (pose.y > previous[i].y + 1e-8) descendingFrames++;
        // After adoption the fan may expand slightly upward; it must never
        // expose a return card from underneath the stage.
        if (!deck.cards.includes(card)) {
          assert.ok(pose.y <= 1, 'return article stays above its resting plane until the fan opens');
          assert.ok(pose.y >= previous[i].y - 1e-8, 'staged return travels downward continuously');
          assert.ok(deck.cardLayers.every(layer => Number(layer.style.zIndex) < Number(card.parentNode.style.zIndex)), 'return enters above outgoing items in painter order');
        }
      }
      previous[i] = pose;
    });
    assert.equal(deck.scene.style.visibility, 'hidden'); assert.equal(deck.flip.x, 0); opaque(deck);
  }
  assert.equal(frames.size, 0, 'return and destination fan settle');
  assert.ok(visibleFrames > 1); assert.ok(descendingFrames > 1, 'return visibly travels downward across multiple frames');
}

for (const count of [1, 2, 3]) test(`closing ${count} remaining items keeps them stationary under the descending decisions`, () => {
  const deck = make(count); ready(deck);
  deck.setReturnContent(createChestEntry(CHEST_ITEM_IDS), { selectedId: 'open' });
  const items = [...deck.cards], returned = [...deck.returnDeck.cards];
  deck.start(); deck.move(gesture(260));
  assert.equal(deck.fan.x, 0);
  const held = items.map(renderedPose);
  held.forEach(pose => assert.equal(pose.y, 0, 'downward drag compresses without translating items'));
  deck.end(gesture(260));
  let framesUnderCover = 0;
  while (frames.size && !deck.cards.includes(returned[0])) {
    step();
    if (!deck.cards.includes(returned[0])) {
      items.forEach((card, i) => {
        samePose(renderedPose(card), held[i], 'item stays fixed during return');
        assert.equal(card.style.visibility, 'visible');
      });
      framesUnderCover++;
    } else {
      const bounds = deck.mount.getBoundingClientRect();
      const cover = projectedBounds(renderedPose(returned[0]), bounds.width, bounds.height, deck.settings.perspective);
      held.forEach(pose => {
        const item = projectedBounds(pose, bounds.width, bounds.height, deck.settings.perspective);
        for (const edge of ['left', 'top']) assert.ok(cover[edge] <= item[edge] + 1e-8, 'cover reaches item edge before removal');
        for (const edge of ['right', 'bottom']) assert.ok(cover[edge] >= item[edge] - 1e-8, 'cover reaches item edge before removal');
      });
    }
  }
  assert.ok(framesUnderCover > 1); settle();
  assert.equal(deck.content.actions[deck.index].id, 'open'); dispose(deck);
});

for (const input of ['keyboard', 'downward swipe']) test(`${input} container close lowers both return choices from above, adopts without a jump and gates input until settled`, () => {
  const { deck, host } = chest(); enterChest(deck);
  const returned = [...deck.returnDeck.cards], adopted = watchReturnAdoption(deck, returned);
  returned.forEach(card => assertAbove(deck, card));
  if (input === 'keyboard') key(deck, 'ArrowDown');
  else { deck.start(); deck.move(gesture(150)); deck.end(gesture(150)); }
  deck.render(); assert.equal(deck.phase, 'closing');
  returned.forEach(card => { assert.equal(card.style.visibility, 'visible'); if (input === 'keyboard') assertAbove(deck, card); else assert.ok(renderedPose(card).y < 0); });
  traceReturn(deck, returned);
  assert.equal(adopted(), 1); assert.equal(deck.phase, 'choices'); assert.equal(host.mode, 'entry');
  assert.equal(deck.content.actions[deck.index].id, 'open'); assert.equal(deck.start(), true); deck.cancel(); settle();
  dispose(deck, host);
});

test('canceling a held downward close sends its preview back above without adoption or changing the item fan', () => {
  const { deck, host } = chest(); enterChest(deck);
  const original = poses(deck), items = [...deck.cards], returned = [...deck.returnDeck.cards];
  const adopted = watchReturnAdoption(deck, returned); let complete = 0;
  deck.addEventListener('transitioncomplete', event => { if (event.detail.transition === 'close') complete++; });
  returned.forEach(card => assertAbove(deck, card));
  deck.start(); deck.move(gesture(150));
  const held = returned.map(renderedPose);
  returned.forEach((card, i) => { assert.equal(card.style.visibility, 'visible'); assert.ok(held[i].y > -deck.departureTravel()); assert.ok(held[i].y < 0); });
  deck.cancel();
  let upwardFrames = 0, previous = held;
  for (let frame = 0; frames.size && frame < 2000; frame++) {
    step(); const next = returned.map(renderedPose);
    next.forEach((pose, i) => { if (pose.y < previous[i].y - 1e-8) upwardFrames++; assert.ok(pose.y < 0); });
    previous = next;
  }
  assert.equal(frames.size, 0); assert.ok(upwardFrames > 1); assert.equal(adopted(), 0); assert.equal(complete, 0);
  assert.equal(host.mode, 'container'); assert.equal(deck.phase, 'choices'); assert.deepEqual(deck.cards, items);
  returned.forEach(card => { assert.equal(card.style.visibility, 'hidden'); assertAbove(deck, card); });
  for (const [id, pose] of poses(deck)) samePose(pose, original.get(id), 'canceled manual close restores items');
  opaque(deck); dispose(deck, host);
});

test('last collection waits offscreen before lowering only Go on from above and adopting without a jump', () => {
  const { deck, host } = chest(); enterChest(deck); deck.commit(); settle(); deck.commit(); settle();
  deck.commit(); const goOn = deck.returnDeck.cards[0], layer = goOn.parentNode;
  const adopted = watchReturnAdoption(deck, [goOn]);
  assert.equal(deck.returnDeck.content.actions[0].id, 'leave'); assert.equal(goOn.style.visibility, 'hidden'); assertAbove(deck, goOn);
  const motion = deck.collectMotion;
  while (now + 16 < motion.start + motion.duration) {
    step(); assert.equal(goOn.style.visibility, 'hidden', 'Go on stays offstage while the last item departs'); assertAbove(deck, goOn); inputBlocked(deck);
  }
  step(motion.start + motion.duration - .001 - now);
  const transform = goOn.style.transform; step(.002);
  assert.equal(goOn.parentNode, layer); assert.equal(goOn.style.transform, transform); assertAbove(deck, goOn);
  for (let frame = 0; goOn.style.visibility !== 'visible' && frame < 10; frame++) { step(); assertAbove(deck, goOn); }
  assert.equal(goOn.style.visibility, 'visible'); assert.equal(deck.phase, 'closing');
  traceReturn(deck, [goOn]);
  assert.equal(adopted(), 1); assert.equal(deck.phase, 'choices'); assert.equal(deck.cards[0], goOn);
  assert.equal(deck.content.actions[0].id, 'leave'); assert.equal(deck.cards.length, 1); opaque(deck); dispose(deck, host);
});

for (const mode of ['reduced', 'hidden']) for (const empty of [false, true]) test(`${mode} during ${empty ? 'empty' : 'nonempty'} return descent finishes once and releases input`, () => {
  const { deck, host } = chest(); enterChest(deck);
  let completed = 0;
  deck.addEventListener('transitioncomplete', event => { if (event.detail.transition === 'close') completed++; });
  if (empty) { deck.commit(); settle(); deck.commit(); settle(); deck.commit(); }
  else key(deck, 'ArrowDown');
  for (let frame = 0; !(deck.returnLift.x > 0 && deck.returnLift.x < 1) && frames.size && frame < 2000; frame++) step();
  assert.ok(deck.returnLift.x > 0 && deck.returnLift.x < 1, 'interruption occurs while return cards are descending');
  blockedDuringReturn(deck);
  if (mode === 'reduced') { deck.media.matches = true; deck.media.dispatchEvent(new Event('change')); }
  else { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
  assert.equal(completed, 1); assert.equal(deck.phase, 'choices'); assert.equal(deck.busy, false); assert.equal(deck.frame, 0);
  assert.equal(deck.content.actions[deck.index].id, empty ? 'leave' : 'open');
  deck.finishMotion(); assert.equal(completed, 1); assert.equal(deck.start(), true); deck.cancel(); settle();
  opaque(deck); dispose(deck, host);
});

test('Open keeps a canceled Go on reverse hidden throughout its direct reveal', () => {
  const { deck, host } = chest(); ready(deck); key(deck, 'ArrowRight'); settle();
  deck.start(); deck.move(gesture(-80)); assert.ok(deck.underlayBack); deck.cancel(); settle();
  key(deck, 'ArrowLeft'); settle(); deck.start(); deck.move(gesture(-150));
  assert.ok(!deck.underlayBack || deck.underlayBack.style.visibility === 'hidden'); deck.end(gesture(-150));
  assert.ok(!deck.underlayBack || deck.underlayBack.style.visibility === 'hidden', 'stale reverse remains hidden at Open acceptance');
  for (let i = 0; frames.size && i < 2000; i++) { step(); assert.ok(!deck.underlayBack || deck.underlayBack.style.visibility === 'hidden'); assert.equal(deck.flip.x, 0); }
  assert.equal(deck.content.id, 'chest-items'); assert.equal(deck.phase, 'choices'); opaque(deck); dispose(deck, host);
});
