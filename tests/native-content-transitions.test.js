import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck } from '../engine/CardDeck.js';
import { departureDistance, spring } from '../engine/motion.js';

// A deterministic browser-shaped RAF/DOM harness checks ownership and painted
// poses; real browser compositing and touch/device behavior require visual QA.
class Element extends EventTarget {
  constructor() { super(); this.attrs = new Map(); this.style = {}; this.children = []; this.parentNode = null; this.classList = { add() {}, remove() {} }; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); } getAttribute(k) { return this.attrs.get(k) ?? null; } removeAttribute(k) { this.attrs.delete(k); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  remove() { if (this.parentNode) { const children = this.parentNode.children; children.splice(children.indexOf(this), 1); this.parentNode = null; } }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
  focus() {} getBoundingClientRect() { return { left: 0, top: 0, width: 340, height: 453 }; }
  hasPointerCapture() { return false; } releasePointerCapture() {}
  cloneNode() { throw new Error('Content transitions must use actual engine faces'); }
  animate() { throw new Error('Content transitions must use the engine RAF'); }
}
let now = 1000, serial = 0;
const frames = new Map(), page = new EventTarget();
Object.defineProperty(performance, 'now', { value: () => now, configurable: true });
globalThis.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.document = new Element(); document.createElement = () => new Element(); document.hidden = false;
globalThis.addEventListener = page.addEventListener.bind(page);
globalThis.matchMedia = () => Object.assign(new EventTarget(), { matches: false });
globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} };
const content = (id, extra = {}) => ({ id, title: id, text: id, actions: [{ id: `${id}-action`, label: id }], ...extra });
const create = () => new CardDeck(new Element(), { content: content('enemy', { directAdvance: true }) });
function step(ms = 16) { now += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)); }
function settle() { for (let i = 0; frames.size && i < 2000; i++) step(); assert.equal(frames.size, 0, 'native motion converges'); }
function angle(face) { return Number([...face.style.transform.matchAll(/rotateY\(([-.\d]+)deg\)/g)][1]?.[1] || 0); }
const descendants = node => [node, ...node.children.flatMap(descendants)];

for (const presentation of ['closed', 'open']) test(`slide uncovers and adopts the actual flat ${presentation} successor`, async () => {
  const deck = create(), source = deck.scene, events = [];
  deck.addEventListener('transitioncomplete', event => events.push(event.detail.transition));
  const promise = deck.transitionContent(content('linear'), { transition: 'slide', presentation });
  const active = deck.contentTransition, successor = presentation === 'open' ? active.staged.cards[0] : active.staged.scene;
  assert.equal(active.source.face, source); assert.equal(deck.busy, true); assert.equal(deck.start(), false);
  assert.equal(successor.style.visibility, 'visible'); assert.equal(angle(successor), 0);
  step(active.motion.duration / 2);
  assert.equal(deck.scene, source); assert.equal(successor.style.visibility, 'visible');
  assert.ok(source.style.transform.includes(`translate3d(0px,${-departureDistance(active.motion, now)}px`));
  step(active.motion.duration + 50);
  assert.equal(deck.content.id, 'linear'); assert.equal(deck.contentTransition.phase, 'settling');
  assert.equal(successor, presentation === 'open' ? deck.cards[0] : deck.scene);
  assert.equal(successor.style.visibility, 'visible', 'adoption never hides the uncovered successor');
  settle(); assert.equal(await promise, true); assert.equal(deck.busy, false);
  assert.equal(deck.phase, presentation === 'open' ? 'choices' : 'closed');
  assert.deepEqual(events, ['slide']); assert.equal(descendants(deck.mount).includes(source), false);
  deck.destroy();
});

test('a settled check slides its actual reverse and retires the slot only after departure', async () => {
  const deck = create(); deck.commitCover();
  const prepared = deck.waitForCheckSurface();
  assert.equal(await deck.transitionContent(content('too-early'), { surface: 'check' }), false);
  settle(); const slot = await prepared;
  const check = deck.checkSurface, reverse = check.back;
  const promise = deck.transitionContent(content('after-check'), { transition: 'slide', surface: 'check' });
  assert.equal(deck.contentTransition.source.face, reverse); assert.equal(slot.parentNode, reverse);
  assert.equal(reverse.style.visibility, 'visible'); assert.equal(angle(reverse), 0);
  const staged = deck.contentTransition.staged.scene;
  step(deck.contentTransition.motion.duration / 2);
  assert.equal(deck.checkSurface, check); assert.equal(slot.parentNode, reverse); assert.equal(staged.style.visibility, 'visible');
  settle(); assert.equal(await promise, true); assert.equal(deck.checkSurface, null);
  assert.equal(slot.parentNode, null); assert.equal(deck.scene, staged); assert.equal(reverse.parentNode.parentNode, null);
  deck.destroy();
});

for (const presentation of ['closed', 'open']) test(`front turn exchanges actual fronts at the negative-Y edge into ${presentation}`, async () => {
  const deck = create(); deck.updateSettings({ flipAxisTilt: 7 });
  const original = deck.scene, back = deck.sceneBack;
  const promise = deck.transitionContent(content('hero', { actions: [{ id: 'hit', label: 'Hit' }, { id: 'wait', label: 'Wait' }] }), { transition: 'front-turn', presentation });
  const active = deck.contentTransition, successor = presentation === 'open' ? active.staged.cards[0] : active.staged.scene;
  active.turn.x = -.25; deck.render(); assert.equal(angle(original), -45);
  assert.ok(original.style.transform.includes('rotateZ(7deg) rotateY(-45deg) rotateZ(-7deg)'));
  assert.equal(back.style.visibility, 'hidden'); assert.equal(successor.style.visibility, 'hidden');
  const turn = active.turn;
  active.turn.x = -.5; active.turn.v = -1; deck.adoptContentTransition(); deck.render();
  assert.equal(active.turn, turn, 'the same spring owns both halves');
  assert.equal(active.turn.v, -1, 'angular velocity survives face handoff');
  assert.equal(active.turn.target, -1);
  assert.equal(deck.content.id, 'hero'); assert.equal(active.phase, 'incoming');
  assert.equal(angle(successor), 90); assert.equal(deck.sceneBack.style.visibility, 'hidden');
  if (deck.open) assert.ok(deck.cardBacks.every(face => !face || face.style.visibility === 'hidden'));
  active.turn.x = -.75; deck.render(); assert.equal(angle(successor), 45);
  settle(); assert.equal(await promise, true); assert.equal(angle(successor), 0); assert.equal(deck.busy, false);
  assert.equal(deck.open, presentation === 'open'); deck.destroy();
});

for (const transition of ['slide', 'front-turn']) for (const reason of ['abort', 'reset', 'destroy', 'replace']) test(`${transition} resolves false exactly once on ${reason}`, async () => {
  const deck = create(), controller = new AbortController(), events = [];
  deck.addEventListener('transitioncomplete', event => events.push(event.detail.transition));
  let resolutions = 0;
  const promise = deck.transitionContent(content('discarded'), { transition, signal: controller.signal }).then(result => { resolutions++; return result; });
  const staged = deck.contentTransition.staged;
  if (reason === 'abort') controller.abort();
  if (reason === 'reset') deck.reset();
  if (reason === 'destroy') deck.destroy();
  if (reason === 'replace') deck.replaceContent(content('replacement'));
  assert.equal(await promise, false); assert.equal(resolutions, 1); assert.equal(deck.contentTransition, null);
  assert.equal(staged.sceneLayer.parentNode, null); assert.equal(deck.frame, 0); assert.deepEqual(events, []);
  if (!deck.destroyed) { assert.equal(deck.busy, false); assert.equal(deck.start(), true); deck.cancel(); deck.destroy(); }
});

for (const transition of ['slide', 'front-turn']) test(`${transition} abort after adoption settles the installed successor without completion`, async () => {
  const deck = create(), controller = new AbortController();
  const promise = deck.transitionContent(content('hero'), { transition, signal: controller.signal });
  deck.adoptContentTransition(); controller.abort();
  assert.equal(await promise, false); assert.equal(deck.content.id, 'hero'); assert.equal(deck.busy, false);
  assert.equal(deck.scene.style.visibility, 'visible'); assert.equal(deck.frame, 0); deck.destroy();
});

for (const policy of ['finish', 'hidden', 'resize', 'pagehide', 'reduced']) test(`native transition safely completes on ${policy}`, async () => {
  const deck = create(); if (policy === 'reduced') deck.reduced = true;
  const events = []; deck.addEventListener('transitioncomplete', event => events.push(event.detail.transition));
  const promise = deck.transitionContent(content('hero'), { transition: 'front-turn', presentation: 'open' });
  if (policy === 'finish') deck.finishMotion();
  if (policy === 'hidden') { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); document.hidden = false; }
  if (policy === 'resize') deck.resize.callback([]);
  if (policy === 'pagehide') page.dispatchEvent(new Event('pagehide'));
  assert.equal(await promise, true); assert.equal(deck.frame, 0); assert.equal(deck.busy, false);
  assert.equal(deck.phase, 'choices'); assert.equal(deck.contentTransition, null); assert.deepEqual(events, ['front-turn']); deck.destroy();
});

test('unavailable surfaces and concurrent calls return false; invalid options reject', async () => {
  const deck = create(), controller = new AbortController(); controller.abort();
  assert.equal(await deck.transitionContent(content('x'), { signal: controller.signal }), false);
  assert.equal(await deck.transitionContent(content('x'), { surface: 'check' }), false);
  const promise = deck.transitionContent(content('next'));
  assert.equal(await deck.transitionContent(content('other')), false);
  await assert.rejects(deck.transitionContent(content('bad'), { transition: 'unknown' }));
  await assert.rejects(deck.transitionContent(content('bad'), { surface: 'unknown' }));
  await assert.rejects(deck.transitionContent(content('bad'), { presentation: 'unknown' }));
  deck.finishMotion(); assert.equal(await promise, true); deck.destroy();
  assert.equal(await deck.transitionContent(content('late')), false);
});


test('aborting a check slide restores its settled accessible surface and permits a retry', async () => {
  const deck = create(); deck.commitCover();
  const prepared = deck.waitForCheckSurface(); settle(); await prepared;
  const check = deck.checkSurface, controller = new AbortController();
  const promise = deck.transitionContent(content('retry'), { surface: 'check', signal: controller.signal });
  step(); controller.abort();
  assert.equal(await promise, false); assert.equal(deck.checkSurface, check); assert.equal(check.slot.parentNode, check.back);
  assert.equal(check.back.style.visibility, 'visible'); assert.equal(check.back.getAttribute('aria-hidden'), null);
  assert.equal(deck.busy, true); assert.equal(deck.start(), false);
  const retry = deck.transitionContent(content('retry'), { surface: 'check' }); settle();
  assert.equal(await retry, true); assert.equal(deck.busy, false); deck.destroy();
});


for (const mutation of ['destroy', 'reset', 'replace', 'abort', 'reentrant']) test(`callback-driven ${mutation} during preparation cancels the superseded request`, { timeout: 1000 }, async () => {
  const deck = create(), controller = new AbortController();
  let nested;
  deck.operation = 'settle';
  deck.addEventListener('transitioncomplete', () => {
    if (mutation === 'destroy') deck.destroy();
    if (mutation === 'reset') deck.reset();
    if (mutation === 'replace') deck.replaceContent(content('replacement'));
    if (mutation === 'abort') controller.abort();
    if (mutation === 'reentrant') nested = deck.transitionContent(content('nested'));
  }, { once: true });
  assert.equal(await deck.transitionContent(content('superseded'), { signal: controller.signal }), false);
  assert.ok(!descendants(deck.mount).some(face => face.textContent === 'superseded'));
  if (nested) {
    assert.equal(deck.contentTransition.next.id, 'nested'); settle(); assert.equal(await nested, true);
  } else {
    assert.equal(deck.contentTransition, null); assert.equal(deck.frame, 0); assert.equal(deck.busy, false);
  }
  if (!deck.destroyed) deck.destroy();
});

test('a hero choice check uses a full native departure from the settled reverse despite retained gesture lift', async () => {
  const deck = new CardDeck(new Element(), { content: content('hero', {
    actions: [{ id: 'hit', label: 'Hit' }, { id: 'wait', label: 'Wait' }]
  }) });
  deck.setOpen(true); deck.schedule(); settle();
  assert.equal(deck.phase, 'choices');
  deck.start(); deck.move({ axis: 'y', x: 0, y: -200, vx: 0, vy: 0 });
  deck.end({ axis: 'y', x: 0, y: -200, vx: 0, vy: 0 });
  const prepared = deck.waitForCheckSurface(); settle(); await prepared;
  assert.ok(deck.l.x > 0, 'accepted choice gesture retains its lift while waiting');
  const promise = deck.transitionContent(content('result'), { surface: 'check' });
  const active = deck.contentTransition;
  assert.equal(active.motion.lift, 0);
  assert.ok(Math.abs(departureDistance(active.motion, active.motion.start + active.motion.duration) - deck.departureTravel()) < 1e-8);
  step(active.motion.duration + 16);
  assert.equal(active.adopted, true, 'check clears after the ordinary full-duration throw');
  settle(); assert.equal(await promise, true); deck.destroy();
});

test('front turn hands off without stopping and matches one native flip duration', async () => {
  const deck = create();
  const promise = deck.transitionContent(content('hero'), { transition: 'front-turn' });
  const active = deck.contentTransition, started = now;
  let midpoint = null;
  while (deck.contentTransition && now - started < 3000) {
    step();
    if (active.adopted && midpoint === null) {
      midpoint = now - started;
      assert.ok(active.turn.v < -.1, 'handoff must still be moving');
      assert.ok(active.turn.x > -.65, 'handoff happens at the edge, not after settling');
    }
  }
  assert.equal(await promise, true);
  const elapsed = now - started;
  assert.ok(midpoint < elapsed * .5, 'no stop-and-restart at the midpoint');
  // Compare against the actual same angular spring used by a native 180° flip.
  const native = spring(1); native.target = 0; deck.flip = native;
  let nativeMs = 0;
  do { deck.stepAngular(native, .016); nativeMs += 16; } while (!deck.atRest(native));
  assert.ok(Math.abs(elapsed - nativeMs) <= 32, `${elapsed}ms front turn vs ${nativeMs}ms native flip`);
  deck.destroy();
});

test('native departure promise resolves only after the outgoing face leaves, without a successor',async()=>{const deck=create();await assert.rejects(deck.waitForDeparture(deck.content.id),/No accepted departure/);deck.commitCover();let done=false;const waiting=deck.waitForDeparture(deck.content.id).then(()=>{done=true;});step(deck.commitMotion.duration/2);await Promise.resolve();assert.equal(done,false);settle();await waiting;assert.equal(done,true);assert.equal(deck.commitMotion,null);deck.destroy();});
for(const operation of ['reset','destroy'])test(`native departure wait is canceled by ${operation}`,async()=>{const deck=create();deck.commitCover();const waiting=deck.waitForDeparture(deck.content.id);deck[operation]();await assert.rejects(waiting,{name:'AbortError'});if(operation!=='destroy')deck.destroy();});
