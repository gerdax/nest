import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DeckInteractionMotion } from '../engine/DeckInteractionMotion.js';
import { DeckEntranceSequence } from '../engine/DeckEntranceSequence.js';
import { CardDeck } from '../engine/CardDeck.js';
import { cardPose } from '../engine/renderer.js?v=no-ending-card-1';
import { spring, DEFAULT_SETTINGS, departureDistance } from '../engine/motion.js?v=no-ending-card-1';

const followers = { time: 100, lift: .1, orderedIds: ['back', 'front', 'selected'], selectedId: 'selected' };
const snapshot = { id: 'back', count: 3, enabled: true, ratio: .5, height: 400,
  currentLift: .6, time: 200, staggerMs: 30, reduced: false, departure: null };

test('interaction instances isolate maps and clearing followers preserves grab and reflow state', () => {
  const a = new DeckInteractionMotion(), b = new DeckInteractionMotion();
  a.beginFollowers(followers);
  a.beginGrab({ time: 100, amount: 8, candidates: [{ id: 'selected', rank: 0 }], staggerMs: 30 });
  a.addReflow('selected', { x: 1, y: 2, z: 3, rx: 4, ry: 5, rz: 6 }, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  a.clearFollowers();
  assert.equal(a.choiceHistory, null); assert.equal(a.choiceRanks.size, 0);
  assert.equal(a.grabCards.size, 1); assert.equal(a.reflowOffsets.size, 1);
  assert.equal(b.grabCards.size, 0); assert.equal(b.reflowOffsets.size, 0); assert.equal(b.choiceHistory, null);
  a.beginFollowers(followers); a.clearGrab();
  assert.ok(a.choiceHistory); assert.equal(a.reflowOffsets.size, 1);
  assert.equal(a.grabCards.size, 0); assert.deepEqual(a.grabCover, spring());
});

test('grab preserves recognition ranks and reuses released springs on a new recognition', () => {
  const motion = new DeckInteractionMotion();
  motion.beginGrab({ time: 100, amount: 8, candidates: [{ id: 'lead', rank: 0 }, { id: 'follow', rank: 2 }], staggerMs: 30 });
  const follow = motion.grabCards.get('follow');
  motion.beginGrab({ time: 110, amount: 10, candidates: [{ id: 'follow', rank: 0 }], staggerMs: 30 });
  assert.equal(motion.grabCards.get('follow'), follow);
  assert.equal(motion.stepGrab(.016, 150), true); assert.equal(follow.state.x, 0);
  motion.stepGrab(.016, 165); assert.equal(follow.started, true); assert.ok(follow.state.x > 0);
  const state = follow.state;
  motion.releaseGrab(); assert.equal(state.target, 0);
  motion.beginGrab({ time: 170, amount: 9, candidates: [{ id: 'follow', rank: 1 }], staggerMs: 30 });
  assert.equal(motion.grabCards.get('follow').state, state);
  assert.equal(motion.grabCards.get('follow').delay, 30);
  assert.equal(motion.grabAmount('follow', .01), .01);
  assert.equal(motion.grabAmount('follow', 8, true), 0);
  motion.releaseGrab();
  for (let i = 0; i < 300; i++) motion.stepGrab(.016, 200 + i * 16);
  assert.equal(motion.grabCards.size, 0);
});

test('followers sample stable painter ranks, delayed history, reduced motion and departure', () => {
  const motion = new DeckInteractionMotion(); motion.beginFollowers(followers);
  assert.deepEqual([...motion.choiceRanks], [['selected', 0], ['back', 1], ['front', 2]]);
  motion.sampleFollowers(200, .6, false);
  const expected = motion.choiceHistory.at(170) * 400 * .75;
  assert.equal(motion.followerLift(snapshot), expected);
  assert.equal(motion.followerLift({ ...snapshot, reduced: true }), .6 * 400 * .75);
  assert.equal(motion.travelRatio({ ...snapshot, enabled: false }), 1);
  assert.equal(motion.travelRatio({ ...snapshot, count: 1 }), 1);
  const historyLength = motion.choiceHistory.samples.length;
  motion.sampleFollowers(250, .9, true); assert.equal(motion.choiceHistory.samples.length, historyLength);
  const departure = { start: 180, duration: 200, lift: .6, velocity: -300, gravity: 100 };
  assert.equal(motion.followerLift({ ...snapshot, time: 250, departure }), .6 * 400 * .75 + departureDistance(departure, 220));
  assert.equal(motion.followersMoving({ ...snapshot, ids: ['selected', 'back', 'front'] }), true);
  motion.clearFollowers(); assert.equal(motion.followersMoving({ ...snapshot, ids: ['back'] }), false);
});

test('reflow differences route each field to the supplied precision-specific stepper', () => {
  const motion = new DeckInteractionMotion();
  motion.addReflow('a', { x: 10, y: 20, z: 30, rx: 40, ry: 50, rz: 60 }, { x: 1, y: 2, z: 3, rx: 4, ry: 5, rz: 6 });
  const offset = motion.reflowOffsets.get('a');
  assert.deepEqual(Object.values(offset).map(s => s.x), [9, 18, 27, 36, 45, 54]);
  const angular = [], position = [];
  motion.stepReflow(.02, (state, dt) => angular.push([state, dt]), (state, dt) => position.push([state, dt]));
  assert.deepEqual(position, ['x', 'y', 'z'].map(field => [offset[field], .02]));
  assert.deepEqual(angular, ['rx', 'ry', 'rz'].map(field => [offset[field], .02]));
  motion.clearReflow(); assert.equal(motion.reflowOffsets.size, 0);
});

test('entrance instances preserve the 200ms first and 120ms later queue deadlines', () => {
  const a = new DeckEntranceSequence(), b = new DeckEntranceSequence();
  a.prepare(['one', 'two'], 600); a.begin({ transition: 'reveal', selectedId: 'ordinary', time: 100 });
  assert.equal(a.nextDue(299), null); assert.equal(a.nextDue(300)[0], 'one');
  a.start('one', 300); assert.equal(a.entrances.get('one').travel.target, 0);
  assert.equal(a.nextDue(419), null); assert.equal(a.nextDue(420)[0], 'two');
  a.start('two', 420); assert.equal(a.nextDue(540), null); assert.equal(a.entranceNextAt, null);
  assert.equal(a.entranceSelectedId, 'ordinary'); assert.equal(a.allLanded(), false);
  for (const entry of a.entrances.values()) { entry.travel.x = 0; entry.travel.v = 0; }
  a.markLanded(); assert.equal(a.allLanded(), true);
  assert.equal(b.entrances.size, 0); assert.equal(b.entranceTransition, null);
  a.beginHint(); a.presentationBrowsePending = true; a.clear();
  assert.ok(a.presentationHint); assert.equal(a.presentationBrowsePending, true);
  assert.equal(a.entrances.size, 0); assert.equal(a.entranceActiveId, null); assert.equal(a.entranceTransition, null);
});

test('unstarted entrance cannot land and prepare resets only the queue', () => {
  const sequence = new DeckEntranceSequence();
  sequence.prepare(['one'], 0); sequence.markLanded(); assert.equal(sequence.allLanded(), false);
  sequence.beginHint(); const hint = sequence.presentationHint;
  sequence.begin({ transition: 'change', selectedId: 'one', time: 0 });
  sequence.prepare(['replacement'], 500);
  assert.equal(sequence.presentationHint, hint); assert.equal(sequence.entranceNextAt, null);
  assert.deepEqual([...sequence.entrances.keys()], ['replacement']);
});

test('hint clock waits from first frame, holds 220ms, returns and cancels without queue reset', () => {
  const sequence = new DeckEntranceSequence(); sequence.prepare(['incoming'], 600); sequence.beginHint();
  sequence.stepHint(0, 1000, DEFAULT_SETTINGS); assert.equal(sequence.presentationHint.startAt, 1100);
  sequence.stepHint(0, 1099, DEFAULT_SETTINGS); assert.equal(sequence.presentationHint.stage, 'waiting');
  sequence.stepHint(0, 1100, DEFAULT_SETTINGS); assert.equal(sequence.presentationHint.stage, 'out');
  sequence.presentationHint.travel.x = .93; sequence.stepHint(0, 1200, DEFAULT_SETTINGS);
  assert.equal(sequence.presentationHint.stage, 'hold'); assert.equal(sequence.presentationHint.holdUntil, 1420);
  sequence.stepHint(0, 1419, DEFAULT_SETTINGS); assert.equal(sequence.presentationHint.stage, 'hold');
  sequence.stepHint(0, 1420, DEFAULT_SETTINGS); assert.equal(sequence.presentationHint.stage, 'return');
  sequence.presentationHint.travel = spring(); sequence.stepHint(0, 1430, DEFAULT_SETTINGS);
  assert.equal(sequence.presentationHint, null); assert.equal(sequence.entrances.size, 1);
  sequence.beginHint(); sequence.cancelHint(); assert.equal(sequence.presentationHint.stage, 'return');
  assert.equal(sequence.presentationHint.travel.target, 0);
});

class Element extends EventTarget {
  constructor() { super(); this.attrs = new Map(); this.style = {}; this.children = []; this.parentNode = null; this.classList = { add() {}, remove() {} }; }
  setAttribute(key, value) { this.attrs.set(key, value); } getAttribute(key) { return this.attrs.get(key) ?? null; } removeAttribute(key) { this.attrs.delete(key); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
  focus() {} getBoundingClientRect() { return { left: 0, top: 0, width: 340, height: 453 }; }
}
function makeDeck() {
  globalThis.document = new Element(); document.createElement = () => new Element(); document.hidden = false;
  globalThis.matchMedia = () => Object.assign(new EventTarget(), { matches: false });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  return new CardDeck(new Element(), { content: { id: 'deck', actions: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } });
}

test('actual deck repeated reflow captures destination after clearing old offsets', () => {
  const deck = makeDeck();
  try {
    deck.open = true; deck.phase = 'choices'; deck.fan = spring(1); deck.p = spring(1);
    const fields = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
    const initial = new Map(deck.content.actions.map((action, i) => [action.id, cardPose(deck, i)]));
    const shifted = new Map([...initial].map(([id, pose]) => [id, Object.fromEntries(fields.map((field, i) => [field, pose[field] + (i + 1) * 7]))]));
    deck.createReflow(shifted);
    const before = new Map(deck.content.actions.map((action, i) => [action.id, cardPose(deck, i)]));
    deck.b.x = deck.b.target = 1; deck.index = 1;
    deck.createReflow(before);
    for (const [i, action] of deck.content.actions.entries()) {
      const actual = cardPose(deck, i);
      for (const field of fields) assert.ok(Math.abs(actual[field] - before.get(action.id)[field]) < 1e-8, `${action.id}.${field} retained old offsets in destination`);
    }
  } finally { deck.destroy(); }
});

test('idle followers do not measure the mount when no history exists', () => {
  const deck = makeDeck();
  const bounds = deck.mount.getBoundingClientRect;
  try {
    deck.mount.getBoundingClientRect = () => { throw new Error('idle DOM measurement'); };
    assert.equal(deck.followersMoving(100), false);
  } finally { deck.mount.getBoundingClientRect = bounds; deck.destroy(); }
});

test('deck compatibility accessors forward replacement state to the single component owner', () => {
  const deck = makeDeck();
  try {
    for (const [owner, fields] of [
      ['interactionMotion', ['grabCover', 'grabCards', 'choiceHistory', 'choiceRanks', 'reflowOffsets']],
      ['entranceSequence', ['entrances', 'entranceActiveId', 'entranceNextAt', 'entranceSelectedId', 'entranceTransition', 'presentationHint', 'presentationBrowsePending']]
    ]) {
      for (const field of fields) {
        const original = deck[field], replacement = { field };
        deck[field] = replacement; assert.equal(deck[owner][field], replacement); assert.equal(deck[field], replacement);
        assert.equal(Object.hasOwn(deck, field), false); deck[field] = original;
      }
    }
  } finally { deck.destroy(); }
});

test('components import and run without browser or deck dependencies', () => {
  const modules = ['DeckInteractionMotion', 'DeckEntranceSequence'];
  for (const name of modules) {
    const source = readFileSync(new URL(`../engine/${name}.js`, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
    assert.ok(imports.every(path => ['./motion.js?v=no-ending-card-1', './MovementHistory.js?v=no-ending-card-1'].includes(path)));
    assert.doesNotMatch(source.replace(/\/\/[^\n]*/g, ''), /\b(document|window|requestAnimationFrame|renderDeck|CardDeck|getDeck)\b(?=\s*[.(])/);
  }
  const interactionUrl = new URL('../engine/DeckInteractionMotion.js', import.meta.url).href;
  const entranceUrl = new URL('../engine/DeckEntranceSequence.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    delete globalThis.document; delete globalThis.window; delete globalThis.requestAnimationFrame;
    const { DeckInteractionMotion } = await import(${JSON.stringify(interactionUrl)});
    const { DeckEntranceSequence } = await import(${JSON.stringify(entranceUrl)});
    const motion = new DeckInteractionMotion(); motion.beginGrab({time:0,amount:8,cover:true}); motion.stepGrab(.016,16);
    const sequence = new DeckEntranceSequence(); sequence.prepare(['a'],600); sequence.begin({time:0,transition:'reveal',selectedId:'a'});
    sequence.start('a',200); sequence.markLanded(); sequence.beginHint(); sequence.cancelHint(); sequence.clear();
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
