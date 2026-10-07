import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck } from '../engine/CardDeck.js';
import { PointerInput } from '../engine/PointerInput.js';

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

const content = (id, count = 3, interaction = 'choice') => ({
  id, interaction, title: id, allowClose: true,
  actions: Array.from({ length: count }, (_, i) => ({ id: `${id}-${i}`, label: `Item ${i}` })),
});
const make = (interaction = 'choice') => new CardDeck(new Element(), { content: content('source', 3, interaction) });
const pointer = (y = 220, extra = {}) => ({
  isPrimary: true, button: 0, buttons: 1, pointerId: 1, clientX: 170,
  clientY: y, timeStamp: now, preventDefault() {}, ...extra,
});
function until(predicate) {
  for (let i = 0; !predicate() && i < 2000; i++) step();
  assert.ok(predicate(), 'input reaches the requested state');
}
function ready(deck) {
  deck.setOpen(true); deck.schedule(); settle();
  assert.equal(deck.phase, 'choices');
}
function hold(deck) {
  deck.input.pointerdown(pointer());
  assert.equal(deck.input.active?.waiting, true, 'blocked press is retained');
  deck.input.pointermove(pointer(80));
  assert.equal(deck.drag, null, 'waiting movement cannot interrupt departure or reveal');
}
function admitted(deck) {
  until(() => deck.input.active && !deck.input.active.waiting);
  assert.ok(deck.drag, 'held pointer becomes an active drag');
  assert.equal(deck.input.active.y, 80, 'baseline uses the latest held coordinates');
  assert.equal(deck.input.active.axis, null);
  assert.equal(deck.input.active.vy, 0, 'waiting movement contributes no flick velocity');
}
function dispose(deck) { deck.destroy(); settle(); }

test('early source hold completes reveal, admits current coordinates, and never replays its swipe', () => {
  const deck = make(); let commits = 0, reveals = 0;
  deck.addEventListener('commit', () => commits++);
  deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'reveal') reveals++; });
  deck.setOpen(true); deck.schedule(); step();
  hold(deck); admitted(deck);
  assert.equal(deck.phase, 'choices'); assert.equal(reveals, 1);
  assert.equal(deck.l.x, 0); assert.equal(deck.drag.ready, true);
  deck.input.pointermove(pointer(70));
  assert.equal(deck.input.active.axis, null, '10px movement remains below the axis threshold');
  deck.input.pointerup(pointer(70)); settle();
  assert.equal(commits, 0, '140px waiting displacement does not become a commit');
  assert.equal(reveals, 1);
  dispose(deck);
});

test('held pointer can start a fresh swipe after admission', () => {
  const deck = make(); let commits = 0;
  deck.addEventListener('commit', () => { commits++; deck.replaceContent(content('next')); });
  deck.setOpen(true); deck.schedule(); step(); hold(deck); admitted(deck);
  step(); deck.input.pointermove(pointer(-20)); deck.input.pointerup(pointer(-20));
  assert.equal(commits, 1); settle(); assert.equal(commits, 1);
  dispose(deck);
});

for (const destination of ['closed', 'open']) test(`hold during choice departure resumes on the ${destination} destination`, () => {
  const deck = make(); ready(deck); let commits = 0, completions = 0;
  deck.addEventListener('commit', () => { commits++; deck.replaceContent(content('next'), { presentation: destination }); });
  deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'commit') completions++; });
  deck.commit(); hold(deck); admitted(deck);
  assert.equal(deck.content.id, 'next'); assert.equal(commits, 1); assert.equal(completions, 1);
  assert.equal(deck.drag.ready, destination === 'open');
  assert.equal(deck.phase, destination === 'open' ? 'choices' : 'closed');
  deck.input.pointerup(pointer(80)); settle(); assert.equal(commits, 1);
  dispose(deck);
});

test('hold during collection resumes against survivors after exactly one completion', () => {
  const deck = make('container'); ready(deck); let accepts = 0, completes = 0;
  deck.addEventListener('collect', () => accepts++);
  deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'collect') completes++; });
  deck.collect(); hold(deck); admitted(deck);
  assert.equal(deck.cards.length, 2); assert.equal(deck.drag.ready, true);
  assert.equal(accepts, 1); assert.equal(completes, 1); assert.equal(deck.l.x, 0);
  deck.input.pointerup(pointer(80)); settle();
  assert.equal(accepts, 1); assert.equal(completes, 1); dispose(deck);
});

for (const resolution of ['collect', 'discard']) test(`hold during final ${resolution} resumes only after next flip`, () => {
  const deck = new CardDeck(new Element(), { content: content('source', 1, 'container') }); ready(deck);
  let completions = 0;
  deck.addEventListener(resolution, () => deck.replaceContent(content('next')));
  deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'commit') completions++; });
  deck[resolution](); hold(deck); admitted(deck);
  assert.equal(deck.content.id, 'next'); assert.equal(deck.phase, 'closed');
  assert.equal(deck.drag.ready, false); assert.equal(completions, 1);
  deck.input.pointerup(pointer(80)); settle(); assert.equal(completions, 1); dispose(deck);
});

for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  test(`${ending} clears waiting input without calling gesture completion or cancellation`, () => {
    const mount = new Element(); let allowed = false, starts = 0, ends = 0, cancels = 0, moves = 0;
    const input = new PointerInput(mount, {
      start() { starts++; return allowed; }, canWait() { return true; }, move() { moves++; },
      end() { ends++; }, cancel() { cancels++; },
    }, () => ({ axisThreshold: 34 }));
    input.pointerdown(pointer()); input.pointermove(pointer(80));
    assert.equal(input.active?.waiting, true);
    const attempts = starts; input[ending](pointer(80)); allowed = true; input.resume();
    assert.equal(input.active, null); assert.equal(starts, attempts);
    assert.equal(ends, 0); assert.equal(cancels, 0); assert.equal(moves, 0);
    input.destroy();
  });
  test(`${ending} during a blocked reveal never acts after readiness`, () => {
    const deck = make(); let commits = 0;
    deck.addEventListener('commit', () => commits++);
    deck.setOpen(true); deck.schedule(); step(); hold(deck);
    deck.input[ending](pointer(80)); settle();
    assert.equal(deck.phase, 'choices'); assert.equal(deck.input.active, null);
    assert.equal(deck.drag, null); assert.equal(commits, 0); dispose(deck);
  });
}

for (const interruption of ['reset', 'replace', 'destroy']) test(`${interruption} cancels waiting input`, () => {
  const deck = make(); deck.setOpen(true); deck.schedule(); step(); hold(deck);
  if (interruption === 'replace') deck.replaceContent(content('replacement'));
  else deck[interruption]();
  settle(); assert.equal(deck.input.active, null); assert.equal(deck.drag, null);
  if (interruption !== 'destroy') { ready(deck); assert.equal(deck.input.active, null); dispose(deck); }
});

test('a partial unaccepted source lift remains continuously regrabbable', () => {
  const deck = make();
  deck.start(); deck.move({ axis: 'y', x: 0, y: -40, vx: 0, vy: 0 });
  deck.end({ axis: 'y', x: 0, y: -40, vx: 0, vy: 0 }); step();
  const lift = deck.p.x; assert.ok(lift > 0); assert.equal(deck.open, false);
  deck.input.pointerdown(pointer()); assert.ok(deck.drag);
  assert.equal(deck.input.active.waiting, false); assert.equal(deck.p.x, lift);
  deck.input.pointerup(pointer()); settle(); dispose(deck);
});
