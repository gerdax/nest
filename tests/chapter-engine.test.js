import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck } from '../engine/CardDeck.js';
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

function key(deck, name) { const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value: name }); deck.mount.dispatchEvent(event); settle(); }
function fixture(options = {}) {
  const deck = new CardDeck(new Element(), { content: { id: 'placeholder', actions: [{ id: 'placeholder', label: 'Placeholder' }] } });
  const chapter = createStarterChapter();
  const controller = new ChapterController(deck, chapter, { rng: () => 0, ...options });
  return { deck, controller };
}
function dispose(deck, controller) { controller.destroy(); deck.destroy(); settle(); document.hidden = false; }
function revealCommit(deck) { key(deck, 'ArrowUp'); assert.equal(deck.phase, 'choices'); key(deck, 'ArrowUp'); }

test('real engine keyboard reaches every linear card and container before random encounter', () => {
  const { deck, controller } = fixture();
  revealCommit(deck);
  assert.equal(controller.state.cardId, 'hall');
  assert.equal(deck.content.title, 'Inside the hall');
  revealCommit(deck);
  assert.equal(controller.state.activeNodeId, 'supplies');
  assert.equal(deck.content.title, 'A supply box');
  assert.equal(deck.phase, 'closed');
  revealCommit(deck);
  assert.equal(deck.content.interaction, 'container');
  assert.equal(deck.phase, 'choices');
  assert.equal(deck.returnContent.actions[0].id, 'open');
  dispose(deck, controller);
});

for (const reduced of [false, true]) for (const lidMotion of [false, true]) test(`real engine partial/final collection advances correctly, reduced=${reduced}, lid=${lidMotion}`, () => {
  const { deck, controller } = fixture({ startNode: 'supplies', lidMotion });
  deck.reduced = reduced;
  revealCommit(deck);
  key(deck, 'ArrowUp');
  assert.equal(controller.state.collectedItems.length, 1);
  key(deck, 'ArrowDown');
  assert.equal(deck.content.actions[deck.index].id, 'open');
  key(deck, 'ArrowUp');
  assert.equal(deck.content.actions.length, 1);
  key(deck, 'ArrowUp');
  assert.equal(controller.state.collectedItems.length, 2);
  assert.equal(controller.state.activeNodeId, 'encounter');
  assert.equal(deck.content.title, 'A dark crossing');
  assert.equal(deck.phase, 'closed');
  assert.equal(deck.returnContent, null);
  dispose(deck, controller);
});

for (const reduced of [false, true]) for (const lidMotion of [false, true]) test(`real engine terminal collection suppresses empty automatic return, reduced=${reduced}, lid=${lidMotion}`, () => {
  const chapter = createStarterChapter();
  chapter.nodes.find(node => node.id === 'supplies').connections.next = null;
  const deck = new CardDeck(new Element(), { content: { id: 'placeholder', actions: [{ id: 'placeholder', label: 'Placeholder' }] } });
  const controller = new ChapterController(deck, chapter, { startNode: 'supplies', lidMotion });
  deck.reduced = reduced;
  revealCommit(deck);
  key(deck, 'ArrowUp'); key(deck, 'ArrowUp');
  assert.equal(controller.state.completed, true);
  assert.equal(controller.state.collectedItems.length, 2);
  assert.equal(deck.content.id, 'chapter-complete');
  assert.equal(deck.phase, 'closed');
  assert.equal(deck.returnContent, null);
  assert.equal(deck.open, false);
  dispose(deck, controller);
});

test('real engine restart during a pending linear commit cancels stale destination', () => {
  const { deck, controller } = fixture();
  key(deck, 'ArrowUp');
  deck.commit();
  assert.equal(deck.busy, true);
  controller.restart(undefined, 'supplies');
  settle();
  assert.equal(deck.content.title, 'A supply box');
  assert.equal(controller.state.activeNodeId, 'supplies');
  assert.equal(deck.phase, 'closed');
  assert.equal(deck.pending, null);
  dispose(deck, controller);
});
