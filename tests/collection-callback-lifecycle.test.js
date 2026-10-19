import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck } from '../engine/CardDeck.js';
import { ProjectController } from '../project/ProjectController.js';

// DOM-shaped fixture checks runtime ownership and motion, not browser rendering.
class Element extends EventTarget {
  constructor() {
    super(); this.attrs = new Map(); this.style = {}; this.children = []; this.parentNode = null;
    this.classList = { add() {}, remove() {} };
  }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  removeAttribute(key) { this.attrs.delete(key); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  remove() { if (this.parentNode) { const children = this.parentNode.children; children.splice(children.indexOf(this), 1); this.parentNode = null; } }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 340, height: 453 }; }
}

let now = 1000, serial = 0;
const frames = new Map();
Object.defineProperty(performance, 'now', { value: () => now, configurable: true });
globalThis.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.document = new Element();
document.createElement = () => new Element();
document.hidden = false;
globalThis.matchMedia = () => Object.assign(new EventTarget(), { matches: false });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

function settle() {
  for (let count = 0; frames.size && count < 2000; count++) {
    now += 16;
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach(callback => callback(now));
  }
  assert.equal(frames.size, 0, 'motion converges');
}

const item = id => ({ id, definitionId: 'apple', kind: 'item', name: 'Apple', onCollect: [{ op: 'add', key: 'energy', value: 1 }] });
function compiled() {
  return {
    startNode: 'box', variables: [{ id: 'energy', type: 'number', initial: 3 }], library: [],
    nodes: [
      { id: 'box', type: 'container', introEnabled: false, items: [item('first'), item('duplicate')], connections: { next: 'after' } },
      { id: 'after', type: 'linear', cards: [{ id: 'after-card', kind: 'event', name: 'After' }], connections: { next: null } },
    ],
  };
}
function runtime(options = {}) {
  const mount = new Element();
  const deck = new CardDeck(mount, { content: { id: 'loading', actions: [{ id: 'wait', label: 'Wait' }] } });
  const controller = new ProjectController(deck, compiled(), options);
  settle();
  return { mount, deck, controller };
}
function dispose(runtime) { runtime.controller.destroy(); runtime.deck.destroy(); settle(); }

for (const action of ['destroy', 'restart', 'replace']) {
  test(`collection onChange can ${action} playback without obsolete reconciliation`, () => {
    let current, armed = false, callbackFinished = false, obsoleteReads = 0, notifications = 0;
    const first = runtime({ onChange: state => {
      if (!armed || !state.collectedItems.length) return;
      armed = false; notifications++;
      assert.equal(state.variables.energy, 4, 'collection effects commit before notification');
      assert.equal(state.collectedItems[0].definitionId, 'apple');
      assert.equal(current.controller.pendingItem, null);
      assert.deepEqual(current.controller.remaining.get('box:').map(item => item.id), ['duplicate']);
      if (action === 'restart') current.controller.restart();
      else {
        dispose(current);
        if (action === 'replace') current = runtime();
      }
      callbackFinished = true;
    } });
    current = first;
    const items = first.controller.items.bind(first.controller);
    first.controller.items = (...args) => { if (callbackFinished) obsoleteReads++; return items(...args); };
    try {
      armed = true;
      first.deck.collect(); settle();
      assert.equal(notifications, 1);
      assert.equal(obsoleteReads, 0, 'completed callback invalidates the old reconciliation');
      if (action === 'destroy') {
        assert.equal(first.deck.destroyed, true);
        assert.equal(first.mount.children.length, 0, 'destroyed deck stays empty');
        assert.equal(first.controller.state.collectedItems.length, 1, 'accepted collection is retained');
      } else {
        assert.equal(current.controller.state.variables.energy, 3);
        assert.deepEqual(current.controller.state.collectedItems, []);
        assert.deepEqual(current.deck.content.actions.map(action => action.id), ['first', 'duplicate']);
        assert.equal(current.controller.completed, false);
      }
    } finally { dispose(current); }
  });
}

test('direct inventory refresh after destroy does not recreate cards or schedule work', () => {
  const active = runtime();
  dispose(active);
  const { deck, mount } = active, content = deck.content, cards = deck.cards;
  const scheduled = frames.size;
  assert.doesNotThrow(() => deck.refreshInventoryActions([{ id: 'new', label: 'New' }]));
  assert.equal(deck.content, content);
  assert.equal(deck.cards, cards);
  assert.equal(mount.children.length, 0);
  assert.equal(frames.size, scheduled);
});

for (const action of ['destroy', 'restart']) {
  test(`staged commit onChange can ${action} without reporting obsolete blocked actions`, () => {
    let active, armed = false, blocked = 0;
    active = runtime({ onChange: () => {
      if (!armed) return;
      armed = false;
      if (action === 'destroy') dispose(active);
      else active.controller.restart();
      // Ignore legitimate reporting performed by restart itself.
      blocked = 0;
    } });
    const reportBlocked = active.controller.reportBlocked.bind(active.controller);
    active.controller.reportBlocked = (...args) => { blocked++; return reportBlocked(...args); };
    try {
      active.controller.stagedDestination = active.controller.locate('after');
      armed = true;
      active.controller.transitionComplete({ transition: 'commit' });
      assert.equal(blocked, 0);
      assert.equal(active.controller.completed, false);
      assert.equal(active.controller.stagedDestination, null);
    } finally { dispose(active); }
  });
}
