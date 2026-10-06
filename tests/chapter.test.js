import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneChapter, createStarterChapter, parseChapter, selectPool, validateChapter } from '../chapter/model.js';
import { ChapterController } from '../chapter/ChapterController.js';

class FakeDeck extends EventTarget {
  content = { id: 'placeholder', actions: [] };
  busy = false;
  previews = new Map();
  emit(name, detail) {
    const event = new Event(name);
    event.detail = { contentId: this.content.id, ...detail };
    this.dispatchEvent(event);
  }
  replaceContent(content, options = {}) {
    if (this.busy) { this.pending = content; return; }
    this.content = content;
    this.presentation = options.presentation ?? 'closed';
    this.previews.clear();
  }
  reset() { this.busy = false; this.pending = null; this.returnContent = null; this.previews.clear(); }
  setActionPreview(id, content) {
    assert.ok(this.content.actions.some(action => action.id === id));
    this.previews.set(id, content);
  }
  setReturnContent(content, { selectedId }) { this.returnContent = content; this.selectedId = selectedId; }
  choose(id) {
    const action = this.content.actions.find(action => action.id === id);
    assert.ok(action && !action.disabled);
    this.busy = true;
    this.emit('commit', { action });
    if (this.pending) { this.content = this.pending; this.pending = null; this.previews.clear(); }
    this.busy = false;
    this.emit('transitioncomplete', { transition: 'commit' });
  }
  collect(id, finish = true) {
    const action = this.content.actions.find(action => action.id === id);
    assert.ok(action);
    this.emit('collect', { action });
    this.content = { ...this.content, actions: this.content.actions.filter(action => action.id !== id) };
    if (finish) this.finishCollection();
  }
  finishCollection() {
    const content = this.content;
    this.emit('transitioncomplete', { transition: 'collect', remainingIds: content.actions.map(action => action.id) });
    this.autoClose = this.content === content && content.actions.length === 0;
  }
  close() {
    this.content = this.returnContent;
    this.returnContent = null;
    this.previews.clear();
    this.emit('transitioncomplete', { transition: 'close' });
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

test('linear card progression installs a container preview after commit adoption', () => {
  const { deck, controller } = setup();
  assert.equal(controller.state.cardId, 'city');
  assert.equal(deck.content.actions[0].label, 'Continue');
  deck.choose('continue');
  assert.equal(controller.state.cardId, 'hall');
  deck.choose('continue');
  assert.equal(controller.state.activeNodeId, 'supplies');
  assert.equal(deck.previews.get('open').interaction, 'container');
});

test('partial collection returns with Open selected and preserves remaining items', () => {
  const { deck, controller } = setup(); supply(deck);
  deck.choose('open');
  assert.equal(deck.content.interaction, 'container');
  deck.collect('flashlight', false);
  assert.deepEqual(controller.state.collectedItems, []);
  deck.finishCollection();
  assert.equal(controller.state.collectedItems[0].id, 'flashlight');
  assert.equal(deck.selectedId, 'open');
  deck.close();
  assert.equal(deck.previews.get('open').actions.length, 1);
  deck.choose('open');
  assert.equal(deck.content.actions[0].id, 'goggles');
});

test('collecting final item installs the next node before automatic close', () => {
  const { deck, controller } = setup({ rng: () => 0 }); supply(deck);
  deck.choose('open'); deck.collect('flashlight'); deck.collect('goggles');
  assert.equal(controller.state.activeNodeId, 'encounter');
  assert.equal(controller.state.cardId, 'crossing');
  assert.equal(controller.state.collectedItems.length, 2);
  assert.equal(deck.autoClose, false);
});

test('forked choices navigate explicit cards and named exits', () => {
  const { deck, controller } = setup({ startNode: 'encounter', rng: () => 0 });
  deck.choose('explore'); assert.equal(controller.state.cardId, 'exit');
  deck.choose('escape'); assert.equal(controller.state.completed, true);
  assert.equal(deck.content.id, 'chapter-complete');
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

test('terminal collection cancels automatic return and restart resets inventory', () => {
  const chapter = createStarterChapter(); chapter.nodes[1].connections.next = null;
  const deck = new FakeDeck(), states = [];
  const controller = new ChapterController(deck, chapter, { startNode: 'supplies', onChange: state => states.push(state) });
  deck.choose('open'); deck.collect('flashlight'); deck.collect('goggles');
  assert.equal(controller.state.completed, true); assert.equal(deck.autoClose, false);
  controller.restart();
  assert.equal(controller.state.activeNodeId, 'arrival');
  assert.equal(controller.state.completed, false); assert.deepEqual(controller.state.collectedItems, []);
  assert.ok(states.length > 3);
});

test('Leave it skips items; destroy detaches listeners and invalid replacement keeps chapter intact', () => {
  const { deck, controller } = setup({ startNode: 'supplies', rng: () => 0 });
  assert.throws(() => controller.restart({}), /version/);
  assert.equal(controller.state.activeNodeId, 'supplies');
  deck.choose('continue'); assert.equal(controller.state.activeNodeId, 'encounter');
  controller.destroy(); deck.choose('leave');
  assert.equal(controller.state.completed, false);
  assert.deepEqual(controller.state.collectedItems, []);
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

test('lid experiment opts only Open into hinged departure and closes the next situation after final collection', () => {
  const { deck, controller } = setup({ startNode: 'supplies', lidMotion: true, rng: () => 0 });
  assert.equal(deck.content.actions.find(a => a.id === 'open').transition, 'lid');
  assert.equal(deck.content.actions.find(a => a.id === 'continue').transition, undefined);
  assert.equal(deck.previews.get('open').lid, true);
  deck.choose('open');
  assert.equal(deck.content.lid, true);
  deck.collect('flashlight');
  deck.close();
  assert.equal(deck.content.actions.find(a => a.id === 'open').transition, 'lid');
  deck.choose('open');
  deck.collect('goggles');
  assert.equal(deck.presentation, 'lid');
  assert.equal(deck.autoClose, false);
  assert.equal(controller.state.activeNodeId, 'encounter');
  assert.ok(deck.content.actions.every(action => action.transition === undefined));
});
