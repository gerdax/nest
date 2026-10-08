import test from 'node:test';
import assert from 'node:assert/strict';
import { Preview } from '../editor/preview.js';
import { createStarterChapter } from '../chapter/model.js';

// A small DOM-shaped fixture for ownership/listeners, not rendering verification.
class Element extends EventTarget {
  constructor() {
    super(); this.elements = new Map(); this.children = []; this.attrs = new Map(); this.style = {};
    const classes = new Set();
    this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
  }
  querySelector(selector) {
    if (!this.elements.has(selector)) this.elements.set(selector, new Element());
    return this.elements.get(selector);
  }
  setAttribute(key, value) { this.attrs.set(key, value); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  removeAttribute(key) { this.attrs.delete(key); }
  getBoundingClientRect() { return { width: 276, height: 368, left: 0, top: 0 }; }
  remove() {}
  focus() {}
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}

function environment() {
  globalThis.document = Object.assign(new Element(), { body: new Element(), createElement: () => new Element() });
  globalThis.matchMedia = () => Object.assign(new EventTarget(), { matches: false });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
}

test('stop remains reusable; destroy releases callbacks and live resources once', () => {
  environment(); let restarts = 0, controllerStops = 0, deckStops = 0;
  const root = new Element();
  const preview = new Preview(root, { inventoryDock: true, onRestart: () => restarts++ });
  const button = preview.restartButton;
  preview.stop();
  assert.equal(document.body.classList.contains('has-inventory-dock'), true);
  button.dispatchEvent(new Event('click'));
  assert.equal(restarts, 1);
  preview.controller = { destroy: () => controllerStops++ };
  preview.deck = { destroy: () => deckStops++ };
  preview.destroy(); preview.destroy(); preview.stop(); preview.restart();
  button.dispatchEvent(new Event('click'));
  assert.equal(restarts, 1);
  assert.equal(controllerStops, 1); assert.equal(deckStops, 1);
  assert.equal(preview.state, null); assert.equal(preview.chapter, null);
  assert.equal(document.body.classList.contains('has-inventory-dock'), false);
  assert.throws(() => preview.play({}), /destroyed/);
});

for (const action of ['stop', 'destroy']) test(`initial callback can ${action} without leaking a controller`, () => {
  environment(); let deck;
  const preview = new Preview(new Element(), { onChange: () => { deck = preview.deck; preview[action](); } });
  preview.play(createStarterChapter());
  assert.equal(deck.destroyed, true);
  assert.equal(preview.deck, null);
  assert.equal(preview.controller, null);
  assert.equal(preview.destroyed, action === 'destroy');
  preview.destroy();
});

test('dock styling survives until the last owner and preserves preexisting styling', () => {
  environment();
  const first = new Preview(new Element(), { inventoryDock: true });
  const second = new Preview(new Element(), { inventoryDock: true });
  first.destroy();
  assert.equal(document.body.classList.contains('has-inventory-dock'), true);
  second.destroy();
  assert.equal(document.body.classList.contains('has-inventory-dock'), false);
  document.body.classList.add('has-inventory-dock');
  const third = new Preview(new Element(), { inventoryDock: true });
  third.destroy();
  assert.equal(document.body.classList.contains('has-inventory-dock'), true);
});
