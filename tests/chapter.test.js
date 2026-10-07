import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneChapter, createLegacyStarterChapter as createStarterChapter, parseChapter, selectPool, validateChapter } from '../chapter/model.js';
import { ChapterController } from '../chapter/ChapterController.js';

class FakeDeck extends EventTarget {
  content = { id: 'placeholder', actions: [] };
  busy = false;
  emit(name, detail) {
    const event = new Event(name);
    event.detail = { contentId: this.content.id, ...detail };
    this.dispatchEvent(event);
  }
  replaceContent(content, options = {}) {
    if (this.busy) { this.pending = content; return; }
    this.content = content;
    this.presentation = options.presentation ?? 'closed';
  }
  endContent() { this.ending = true; }
  reset() { this.busy = false; this.pending = null; this.resolution = null; }
  choose(id) {
    const action = this.content.actions.find(action => action.id === id);
    assert.ok(action && !action.disabled);
    this.busy = true;
    this.emit('commit', { action });
    if (this.pending) { this.content = this.pending; this.pending = null; }
    this.busy = false;
    this.emit('transitioncomplete', { transition: 'commit' });
  }
  collect(id, finish = true) { this.resolve(id, 'collect', finish); }
  discard(id, finish = true) { this.resolve(id, 'discard', finish); }
  resolve(id, transition, finish) {
    const action = this.content.actions.find(action => action.id === id);
    assert.ok(action);
    this.busy = true;
    this.resolution = { transition, contentId: this.content.id, final: this.content.actions.length === 1 };
    this.emit(transition, { action, final: this.resolution.final });
    this.content = { ...this.content, actions: this.content.actions.filter(action => action.id !== id) };
    if (finish) this.finishCollection();
  }
  finishCollection(adopt = true) {
    const { transition, contentId, final } = this.resolution;
    this.emit('transitioncomplete', { transition, contentId, remainingIds: this.content.actions.map(action => action.id) });
    this.resolution = null;
    if (final && adopt) this.finishFlip();
    else if (!final) this.busy = false;
  }
  finishFlip() {
    if(this.ending){this.ending=false;this.busy=false;this.emit('transitioncomplete',{transition:'commit'});return;}
    assert.ok(this.pending, 'next front was supplied synchronously');
    this.content = this.pending;
    this.pending = null;
    this.busy = false;
    this.emit('transitioncomplete', { transition: 'commit' });
  }

}

function setup(options = {}) {
  const chapter = createStarterChapter(), deck = new FakeDeck();
  const controller = new ChapterController(deck, chapter, options);
  return { chapter, deck, controller };
}

function supply(deck) { deck.choose('continue'); deck.choose('continue'); }

test('starter, cloning and parser preserve valid JSON data', () => {
  const chapter = createStarterChapter();
  assert.deepEqual(validateChapter(chapter), []);
  assert.deepEqual(parseChapter(JSON.stringify(chapter)), chapter);
  const copy = cloneChapter(chapter); copy.nodes[0].name = 'Different';
  assert.equal(chapter.nodes[0].name, 'Arrival');
});

test('validator rejects references, invalid weights, malformed choices and cycles', () => {
  const chapter = createStarterChapter();
  chapter.nodes[0].connections.next = 'missing';
  chapter.nodes[2].pool[0].weight = 0;
  chapter.sequences[2].cards[0].choices[0].target = 'card:crossing';
  chapter.sequences[2].cards[1].choices[0].target = 'exit:missing';
  const errors = validateChapter(chapter);
  for (const fragment of ['unknown node', 'weights', 'card cycle', 'invalid target']) assert.ok(errors.some(error => error.message.includes(fragment)), fragment);
  chapter.nodes[0].connections.next = 'supplies';
  chapter.nodes[1].connections.next = 'arrival';
  assert.ok(validateChapter(chapter).some(error => error.message.includes('node cycle')));
  assert.throws(() => parseChapter(JSON.stringify(chapter)), /cycle/);
  assert.ok(validateChapter(null).length);
  assert.ok(validateChapter({ version: 1, nodes: [null], sequences: [null] }).length);
});

test('pool draws weighted sequences without replacement without mutating input', () => {
  const pool = [{ sequenceId: 'a', weight: 9 }, { sequenceId: 'b', weight: 1 }];
  assert.deepEqual(selectPool(pool, 2, () => 0), ['a', 'b']);
  assert.deepEqual(selectPool(pool, 1, () => .95), ['b']);
  assert.equal(pool.length, 2);
  assert.throws(() => selectPool(pool, 1, () => 1), /Random source/);
});

test('linear progression installs the direct container cover with all items', () => {
  const { deck, controller } = setup();
  assert.equal(controller.state.cardId, 'city');
  deck.choose('continue');
  assert.equal(controller.state.cardId, 'hall');
  deck.choose('continue');
  assert.equal(controller.state.activeNodeId, 'supplies');
  assert.equal(deck.content.interaction, 'container');
  assert.equal(deck.content.allowClose, false);
  assert.deepEqual(deck.content.actions.map(item => item.id), ['flashlight', 'goggles']);
});

test('mixed item resolutions update remaining and inventory only at completion', () => {
  const { deck, controller } = setup({ rng: () => 0 }); supply(deck);
  deck.collect('flashlight', false);
  assert.deepEqual(controller.state.collectedItems, []);
  assert.equal(controller.remaining().length, 2);
  deck.finishCollection();
  assert.equal(controller.state.collectedItems[0].sequenceId, 'supply-sequence');
  assert.equal(controller.remaining().length, 1);
  deck.discard('goggles', false);
  assert.equal(controller.state.activeNodeId, 'supplies');
  assert.equal(deck.pending.title, 'A dark crossing');
  deck.finishCollection(false);
  assert.equal(controller.state.activeNodeId, 'supplies', 'node waits for the staged front to settle');
  assert.equal(controller.remaining().length, 0);
  assert.equal(controller.state.collectedItems.length, 1);
  deck.finishFlip();
  assert.equal(controller.state.activeNodeId, 'encounter');
  assert.equal(controller.state.cardId, 'crossing');
});

test('taking every item carries the full inventory into the next node', () => {
  const { deck, controller } = setup({ rng: () => 0 }); supply(deck);
  deck.collect('flashlight'); deck.collect('goggles');
  assert.equal(controller.state.activeNodeId, 'encounter');
  assert.equal(controller.state.collectedItems.length, 2);
  deck.choose('leave');
  assert.equal(controller.state.completed, true);
  assert.equal(controller.state.collectedItems.length, 2);
});

test('forked choices navigate explicit cards and named exits', () => {
  const { deck, controller } = setup({ startNode: 'encounter', rng: () => 0 });
  deck.choose('explore'); assert.equal(controller.state.cardId, 'exit');
  deck.choose('escape'); assert.equal(controller.state.completed, true);
  assert.notEqual(deck.content.id, 'chapter-complete');
  assert.equal(deck.ending, true);
});

test('random executes its selected queue then uses next independent of sequence exit', () => {
  const chapter = createStarterChapter();
  chapter.startNode = 'encounter';
  chapter.nodes[2].count = 2;
  chapter.nodes[2].connections.next = 'supplies';
  chapter.nodes[1].connections.next = null;
  const deck = new FakeDeck(), controller = new ChapterController(deck, chapter, { rng: () => 0 });
  deck.choose('leave');
  assert.equal(controller.state.sequenceId, 'quiet-sequence');
  deck.choose('continue');
  assert.equal(controller.state.activeNodeId, 'supplies');
});

test('terminal discard ends without a generated card and restart resets inventory', () => {
  const chapter = createStarterChapter(); chapter.nodes[1].connections.next = null;
  const deck = new FakeDeck(), states = [];
  const controller = new ChapterController(deck, chapter, { startNode: 'supplies', onChange: state => states.push(state) });
  deck.collect('flashlight'); deck.discard('goggles', false);
  assert.equal(deck.pending, undefined);
  assert.equal(deck.ending, true);
  assert.equal(controller.state.completed, false);
  deck.finishCollection();
  assert.equal(controller.state.completed, true);
  assert.equal(controller.state.collectedItems.length, 1);
  controller.restart();
  assert.equal(controller.state.activeNodeId, 'arrival');
  assert.equal(controller.state.completed, false); assert.deepEqual(controller.state.collectedItems, []);
  assert.ok(states.length > 3);
});

test('all discards leave inventory empty and destroy detaches resolution listeners', () => {
  const { deck, controller } = setup({ startNode: 'supplies', rng: () => 0 });
  assert.throws(() => controller.restart({}), /version/);
  assert.equal(controller.state.activeNodeId, 'supplies');
  deck.discard('flashlight'); deck.discard('goggles');
  assert.equal(controller.state.activeNodeId, 'encounter');
  assert.deepEqual(controller.state.collectedItems, []);
  controller.destroy(); deck.choose('leave');
  assert.equal(controller.state.completed, false);
});

test('draft parsing permits incomplete graph work while strict imports reject it', () => {
  const draft = createStarterChapter();
  draft.nodes[0].sequenceId = 'missing';
  draft.nodes[2].count = 0;
  draft.sequences[2].cards[0].choices = [];
  assert.deepEqual(parseChapter(JSON.stringify(draft), { allowDraft: true }), draft);
  assert.throws(() => parseChapter(JSON.stringify(draft)), /Unknown sequence/);
  draft.nodes[0].connections = [];
  assert.throws(() => parseChapter(JSON.stringify(draft), { allowDraft: true }), /draft structure/);
});


test('restart cancels a pending engine commit before replacing content', () => {
  const { deck, controller } = setup();
  deck.busy = true;
  deck.pending = { id: 'old-pending', actions: [] };
  controller.restart(undefined, 'supplies');
  assert.equal(deck.busy, false);
  assert.equal(deck.pending, null);
  assert.equal(deck.content.id, 'supplies:supply-sequence:box');
  assert.equal(controller.state.activeNodeId, 'supplies');
});

test('restart cancels pending final resolution and its staged destination', () => {
  const { deck, controller } = setup({ startNode: 'supplies' });
  deck.collect('flashlight'); deck.collect('goggles', false);
  assert.ok(deck.pending);
  controller.restart(undefined, 'supplies');
  assert.equal(deck.pending, null);
  assert.equal(controller.pendingItem, null);
  assert.equal(controller.stagedDestination, null);
  assert.deepEqual(controller.state.collectedItems, []);
  assert.equal(deck.content.actions.length, 2);
});

test('blank card titles are valid and survive JSON import', () => {
  const chapter = createStarterChapter();
  for (const seq of chapter.sequences) for (const card of seq.cards) card.title = '';
  assert.deepEqual(validateChapter(chapter), []);
  assert.deepEqual(parseChapter(JSON.stringify(chapter)), chapter);
  chapter.sequences[0].cards[0].title = null;
  assert.ok(validateChapter(chapter).length);
});

test('new decisions present open and route each output directly to a chapter node', async () => {
  const { createStarterChapter: modern } = await import('../chapter/model.js');
  const chapter = modern(); const deck = new FakeDeck();
  const controller = new ChapterController(deck, chapter, { startNode: 'crossing', rng: () => 0 });
  assert.equal(deck.presentation, 'open');
  assert.deepEqual(deck.content.actions.map(a => a.id), ['explore', 'leave']);
  deck.choose('explore');
  assert.equal(controller.state.activeNodeId, 'encounter');
  controller.restart(chapter, 'crossing'); deck.choose('leave');
  assert.equal(controller.state.completed, true);
  controller.destroy();
});
test('legacy static fork upgrade preserves internal and chapter routes', async () => {
  const { upgradeDecisionNodes } = await import('../chapter/model.js');
  const old = createStarterChapter();
  old.nodes.push({id:'fork',name:'Fork',type:'static',sequenceId:'fork-sequence',x:0,y:0,connections:{next:null,escape:'supplies'}});
  const upgraded = upgradeDecisionNodes(old);
  assert.deepEqual(validateChapter(upgraded), []);
  const root = upgraded.nodes.find(n => n.id === 'fork');
  const branch = upgraded.nodes.find(n => n.id === root.connections.explore);
  assert.equal(root.connections.leave, 'supplies');
  assert.equal(branch.connections.escape, 'supplies');
  assert.equal(upgraded.sequences.find(s => s.id === root.sequenceId).decisionOnly, true);
  assert.deepEqual(upgradeDecisionNodes(upgraded), upgraded);
  assert.equal(old.nodes.find(n => n.id === 'fork').sequenceId, 'fork-sequence');
});
