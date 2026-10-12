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

test('hidden autoplay playback can skip focus and inert preview ignores Escape',()=>{
  environment();
  const root=new Element(),preview=new ProjectPreview(root);
  let focused=0,canceled=0,inert=true;
  preview.mount.focus=()=>focused++;
  root.closest=()=>inert?{}:null;
  preview.play(createProject(),undefined,undefined,{focus:false});
  assert.equal(focused,0);assert.ok(preview.controller);
  preview.controller.cancelCheck=()=>canceled++;
  preview.overlay.hidden=false;preview.cancelButton.disabled=false;
  const escape=new Event('keydown',{cancelable:true});Object.defineProperty(escape,'key',{value:'Escape'});
  document.dispatchEvent(escape);assert.equal(canceled,0);
  inert=false;document.dispatchEvent(escape);assert.equal(canceled,1);
  preview.play(createProject());assert.equal(focused,1);preview.destroy();
});

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

test('card link is optional, starts enabled after controller assignment, and resolves fresh on click', () => {
  environment();
  const standalone = new ProjectPreview(new Element());
  assert.equal(standalone.goToCardButton, undefined); standalone.destroy();
  const root = new Element(), targets = [], inserted = [];
  root.querySelector('[data-status]').parentNode = { insertBefore: button => inserted.push(button) };
  const preview = new ProjectPreview(root, { onGoToCard: target => targets.push(target) });
  const button = preview.goToCardButton;
  assert.equal(button.disabled, true); assert.deepEqual(inserted, [button]);
  preview.play(createProject());
  assert.equal(button.disabled, false);
  button.onclick();
  assert.deepEqual(targets[0], { chapterId: 'chapter-1', nodeId: 'arrival', placementId: 'arrival-card', definitionId: 'arrival' });
  preview.deck.busy = true;
  button.onclick();
  assert.equal(targets.length, 1); assert.equal(button.disabled, true);
  preview.stop(); assert.equal(button.disabled, true); button.onclick(); assert.equal(targets.length, 1);
  preview.restart(); assert.equal(button.disabled, false);
  preview.destroy(); assert.equal(button.onclick, null); assert.equal(preview.onGoToCard, null);
});

test('card link tracks deck selection and reveal transitions and removes obsolete listeners', () => {
  environment();
  const project = createProject();
  const route = project.chapters[0].nodes.find(node => node.id === 'route');
  route.choices.push({ id: 'second-choice', definitionId: 'explore' });
  route.connections['second-choice'] = 'quiet-passage';
  const targets = [], preview = new ProjectPreview(new Element(), { onGoToCard: target => targets.push(target) });
  preview.play(project, 'chapter-1', 'route');
  const oldDeck = preview.deck, oldListener = preview.cardLinkListener;
  const removed = [], remove = oldDeck.removeEventListener.bind(oldDeck);
  oldDeck.removeEventListener = (name, listener) => { if (listener === oldListener) removed.push(name); remove(name, listener); };
  assert.equal(preview.goToCardButton.disabled, true);
  oldDeck.completePhase('choices', 'reveal');
  assert.equal(preview.goToCardButton.disabled, false);
  oldDeck.index = 1; oldDeck.emit('selection', { action: oldDeck.content.actions[1] });
  preview.goToCardButton.onclick();
  assert.equal(targets[0].placementId, 'second-choice');
  oldDeck.phase = 'closing'; oldDeck.emit('close');
  assert.equal(preview.goToCardButton.disabled, true);
  preview.play(project);
  assert.deepEqual(removed.sort(), ['selection', 'reveal', 'close', 'commit', 'collect', 'discard', 'transitioncomplete'].sort());
  assert.equal(preview.goToCardButton.disabled, false);
  oldDeck.phase = 'collecting'; oldDeck.emit('collect'); oldListener();
  assert.equal(preview.goToCardButton.disabled, false);
  preview.goToCardButton.onclick(); assert.equal(targets[1].placementId, 'arrival-card');
  preview.controller.checking = new AbortController();
  preview.update(preview.controller.state);
  assert.equal(preview.goToCardButton.disabled, true);
  preview.goToCardButton.onclick(); assert.equal(targets.length, 2);
  preview.destroy();
});
