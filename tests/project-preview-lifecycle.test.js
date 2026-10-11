import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectPreview } from '../studio/ProjectPreview.js';
import { Preview } from '../editor/preview.js';
import { ProjectController } from '../project/ProjectController.js';
import { DiceService } from '../dice/DiceService.js';
import { createProject } from '../project/model.js';

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
  appendChild(child) { this.children.push(child); }
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

for (const action of ['stop', 'destroy']) test(`project initial callback can ${action} without reviving its controller`, () => {
  environment();
  const destroyed = [];
  const original = ProjectController.prototype.destroy;
  ProjectController.prototype.destroy = function () { destroyed.push(this); return original.call(this); };
  try {
    let deck;
    const preview = new ProjectPreview(new Element(), { onChange: () => { deck = preview.deck; preview[action](); } });
    preview.play(createProject());
    assert.equal(deck.destroyed, true);
    assert.equal(preview.deck, null);
    assert.equal(preview.controller, null);
    assert.equal(preview.destroyed, action === 'destroy');
    assert.equal(destroyed.length, 1);
    assert.equal(destroyed[0].destroyed, true);
    preview.destroy();
  } finally { ProjectController.prototype.destroy = original; }
});

test('nested initial play keeps only the replacement controller and callbacks', () => {
  environment();
  const replacement = createProject(); replacement.chapters[0].nodes[0].name = 'Replacement';
  const destroyed = [];
  const original = ProjectController.prototype.destroy;
  ProjectController.prototype.destroy = function () { destroyed.push(this); return original.call(this); };
  try {
    let calls = 0, firstDeck;
    const preview = new ProjectPreview(new Element(), { onChange: () => {
      if (++calls === 1) { firstDeck = preview.deck; preview.play(replacement); }
    } });
    preview.play(createProject());
    assert.equal(calls, 2);
    assert.equal(firstDeck.destroyed, true);
    assert.equal(destroyed.length, 1);
    assert.equal(destroyed[0].destroyed, true);
    assert.equal(preview.controller.destroyed, false);
    assert.equal(preview.controller.deck, preview.deck);
    assert.match(preview.status.textContent, /Replacement/);
    const currentState = preview.state;
    destroyed[0].onChange({ completed: true });
    destroyed[0].onError(new Error('obsolete'));
    assert.equal(preview.state, currentState);
    assert.match(preview.status.textContent, /Replacement/);
    preview.destroy();
  } finally { ProjectController.prototype.destroy = original; }
});

test('stop supports restart; destroy is terminal and releases retained data and callbacks', () => {
  environment(); let changes = 0;
  const preview = new ProjectPreview(new Element(), { inventoryDock: true, onChange: () => changes++ });
  const button = preview.cancelButton;
  preview.play(createProject());
  const firstController = preview.controller, firstDeck = preview.deck;
  preview.stop();
  assert.equal(firstController.destroyed, true); assert.equal(firstDeck.destroyed, true);
  assert.equal(preview.compiled, null);
  assert.equal(document.body.classList.contains('has-inventory-dock'), true);
  preview.restart();
  assert.equal(changes, 2);
  const controller = preview.controller, deck = preview.deck;
  preview.destroy(); preview.destroy(); preview.stop(); preview.restart();
  preview.update({});
  assert.equal(changes, 2);
  assert.equal(controller.destroyed, true); assert.equal(deck.destroyed, true);
  for (const key of ['project', 'compiled', 'state', 'controller', 'deck', 'cancelKey', 'releaseDock']) assert.equal(preview[key], null, key);
  assert.equal(button.onclick, null);
  assert.equal(document.body.classList.contains('has-inventory-dock'), false);
  assert.throws(() => preview.play(createProject()), /destroyed/);
});

for (const order of ['v1-first', 'v2-first']) test(`mixed preview dock ownership survives ${order} teardown`, () => {
  environment();
  const v1 = new Preview(new Element(), { inventoryDock: true });
  const v2 = new ProjectPreview(new Element(), { inventoryDock: true });
  const [first, second] = order === 'v1-first' ? [v1, v2] : [v2, v1];
  first.destroy(); first.destroy();
  assert.equal(document.body.classList.contains('has-inventory-dock'), true);
  second.destroy();
  assert.equal(document.body.classList.contains('has-inventory-dock'), false);
  document.body.classList.add('has-inventory-dock');
  const third = new ProjectPreview(new Element(), { inventoryDock: true });
  const fourth = new Preview(new Element(), { inventoryDock: true });
  third.destroy(); fourth.destroy();
  assert.equal(document.body.classList.contains('has-inventory-dock'), true);
});

test('an obsolete roll rejection cannot close the replacement dice tray', async () => {
  environment();
  const original = DiceService.prototype.roll;
  const pending = [];
  DiceService.prototype.roll = function () { return new Promise((resolve, reject) => pending.push({ resolve, reject })); };
  const preview = new ProjectPreview(new Element());
  try {
    const oldRoll = preview.roll([{ sides: 6 }]);
    preview.stop();
    const newRoll = preview.roll([{ sides: 6 }]);
    const newDice = preview.dice;
    pending[0].reject(new DOMException('Cancelled', 'AbortError'));
    await assert.rejects(oldRoll, { name: 'AbortError' });
    assert.equal(preview.overlay.hidden, false);
    assert.equal(preview.dice, newDice);
    assert.equal(newDice.destroyed, false);
    pending[1].resolve({ total: 3 });
    await newRoll;
  } finally { preview.destroy(); DiceService.prototype.roll = original; }
});

test('stopped result completion cannot close a newer result presentation', async () => {
  environment();
  const preview = new ProjectPreview(new Element());
  const oldResult = preview.showResult({ total: 1, target: 2, success: false });
  preview.stop();
  const abort = new AbortController();
  const newResult = preview.showResult({ total: 3, target: 2, success: true, signal: abort.signal });
  preview.overlay.hidden = false;
  await oldResult;
  assert.equal(preview.overlay.hidden, false);
  assert.match(preview.result.textContent, /Success/);
  abort.abort();
  await newResult;
  assert.equal(preview.overlay.hidden, true);
  assert.equal(preview.resultTimer, null);
  assert.equal(preview.resolveTimer, null);
  preview.destroy();
  await preview.showResult({ total: 4, target: 2, success: true });
  await assert.rejects(preview.roll([{ sides: 6 }]), { name: 'AbortError' });
});
