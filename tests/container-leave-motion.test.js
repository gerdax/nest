import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck } from '../engine/CardDeck.js';
import { cardPose } from '../engine/renderer.js';
import { projectedBounds } from '../engine/geometry.js';

// Deterministic animation clock with enough DOM behavior to test real deck
// departure, staging, and retained card identity.
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
const fixture = (count, interaction = 'container') => ({ discardAll: true, id: `items-${count}`, interaction, title: 'Chest', text: 'Contents', actions: Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, label: `Item ${i}` })) });
function make(count = 3, content = fixture(count)) { return new CardDeck(new Element(), { content, settings: { choiceStaggerMs: 30 } }); }
function ready(deck) { deck.setOpen(true); deck.schedule(); settle(); assert.equal(deck.phase, 'choices'); }
function key(deck, name) { const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value: name }); deck.mount.dispatchEvent(event); }
function select(deck, index) { for (let i = 0; i < index; i++) key(deck, 'ArrowRight'); settle(); assert.equal(deck.index, index); }
const gesture = (y, vy = 0) => ({ axis: 'y', x: 0, y, vx: 0, vy });
const fields = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
function poses(deck) { return new Map(deck.content.actions.map((action, i) => [action.id, cardPose(deck, i, now)])); }
function samePose(actual, expected, message) {
  for (const field of fields) assert.ok(Math.abs(actual[field] - expected[field]) < 1e-8, `${message}: ${field} changed ${expected[field]} -> ${actual[field]}`);
  assert.ok(Math.abs((actual.scale ?? 1) - (expected.scale ?? 1)) < 1e-8, `${message}: scale changed`);
}
function recededPose(actual, expected, message) {
  samePose(actual, { ...expected, y: actual.y, z: actual.z }, message);
  assert.ok(actual.y <= expected.y, `${message}: remaining card shifts upward`);
  assert.ok(Math.abs(projectedBounds(actual,340,453,1200).top-projectedBounds(expected,340,453,1200).top)<1e-7, `${message}: top edge stays anchored`);
  assert.ok(actual.z < expected.z, `${message}: remaining card recedes`);
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function opaque(deck) { for (const node of descendants(deck.mount)) assert.equal(Object.hasOwn(node.style, 'opacity'), false); }
function inputBlocked(deck) { const index = deck.index, cursor = deck.b.target; assert.equal(deck.start(), false); for (const name of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) key(deck, name); deck.commit(); assert.equal(deck.index, index); assert.equal(deck.b.target, cursor); assert.equal(deck.open, true); }
function dispose(deck, host) { host?.destroy(); deck.destroy(); settle(); document.hidden = false; }

for (const [count, all] of [[4, true], [1, false], [3, false]]) {
  for (const [distance, velocity, accepted] of [[26, -1800, false], [150, -1800, false], [226, -1800, false], [226.5, 0, true], [240, 0, true]]) {
    test(`item discard requires half-height release: count=${count}, all=${all}, distance=${distance}`, () => {
      const deck = make(count, { ...fixture(count), discardAll: all }); ready(deck);
      const initial = poses(deck), cards = [...deck.cards]; let discards = 0;
      deck.addEventListener('discard', () => discards++);
      deck.start(); deck.move(gesture(-distance)); deck.end(gesture(-distance, velocity));
      assert.equal(discards, accepted ? 1 : 0);
      settle();
      if (!accepted) {
        assert.deepEqual(deck.cards, cards); assert.equal(deck.open, true); assert.equal(deck.phase, 'choices');
        for (const [id, pose] of poses(deck)) samePose(pose, initial.get(id), 'short release restores item');
      }
      dispose(deck);
    });
  }
}

test('crossing discard threshold then retreating before release restores all items', () => {
  const deck = make(4); ready(deck); const initial = poses(deck); let discards = 0;
  deck.addEventListener('discard', () => discards++);
  deck.start(); deck.move(gesture(-300)); step(64); deck.move(gesture(-120)); deck.end(gesture(-120, -1200)); settle();
  assert.equal(discards, 0); assert.equal(deck.cards.length, 4);
  for (const [id, pose] of poses(deck)) samePose(pose, initial.get(id), 'retreated release restores stack');
  dispose(deck);
});

test('short downward item flick still collects', () => {
  const deck = make(3); ready(deck); let collects = 0;
  deck.addEventListener('collect', () => collects++);
  deck.start(); deck.move(gesture(26)); deck.end(gesture(26, 800)); settle();
  assert.equal(collects, 1); assert.equal(deck.cards.length, 2); dispose(deck);
});

for (const index of [0, 2]) test(`up leaves the whole container with selected ${index} leading delayed followers`, () => {
  const deck = make(4); ready(deck); select(deck, index);
  const initial = poses(deck), items = [...deck.cards];
  const events = [];
  deck.addEventListener('discard', e => { events.push(e.detail); deck.replaceContent({ ...fixture(1), id: 'next' }, { presentation: 'open' }); });
  deck.start(); deck.move(gesture(-150));
  assert.equal(deck.groupChoiceMotion, true);
  assert.equal(deck.choiceRanks.get(`item-${index}`), 0);
  const rankOrder = deck.content.actions.map((a, i) => ({ id: a.id, order: Number(deck.cardLayers[i].style.zIndex) }))
    .sort((a, b) => b.order - a.order).filter(a => a.id !== `item-${index}`);
  assert.deepEqual(rankOrder.map(a => deck.choiceRanks.get(a.id)), [1, 2, 3]);
  const immediate = poses(deck);
  assert.ok(immediate.get(`item-${index}`).y < initial.get(`item-${index}`).y - 130);
  for (const item of rankOrder) samePose(immediate.get(item.id), initial.get(item.id), 'follower waits');
  step(deck.settings.choiceStaggerMs * 4);
  for (const [id, pose] of poses(deck)) assert.ok(pose.y < initial.get(id).y, 'every card follows upward');
  assert.equal(deck.underlay.style.visibility, 'visible'); opaque(deck);
  deck.move(gesture(-240));
  deck.end(gesture(-240));
  assert.equal(deck.phase, 'committing'); assert.equal(deck.commitMotion.discardAll, true);
  assert.equal(deck.content.id, 'items-4'); assert.equal(deck.pending.id, 'next'); assert.deepEqual(deck.cards, items);
  inputBlocked(deck); assert.match(deck.live.textContent, /discarding remaining items/);
  assert.deepEqual(events[0].discardedIds, ['item-0', 'item-1', 'item-2', 'item-3']);
  assert.equal(events[0].index, index); assert.equal(events[0].all, true); assert.equal(events[0].final, true);
  settle(); assert.equal(deck.content.id, 'next'); assert.equal(deck.groupLeaveActive, false); opaque(deck); dispose(deck);
});

test('down moves and takes only selected item, with survivors retaining identity', () => {
  const deck = make(3); ready(deck); select(deck, 1);
  const initial = poses(deck), items = [...deck.cards], collects = [];
  deck.addEventListener('collect', e => collects.push(e.detail));
  deck.start(); deck.move(gesture(150));
  recededPose(cardPose(deck, 0), initial.get('item-0'), 'first survivor');
  recededPose(cardPose(deck, 2), initial.get('item-2'), 'last survivor');
  deck.end(gesture(150)); settle();
  assert.deepEqual(deck.content.actions.map(a => a.id), ['item-0', 'item-2']);
  assert.deepEqual(new Set(deck.cards), new Set([items[0], items[2]]));
  assert.equal(collects.length, 1); assert.equal(collects[0].all, undefined); assert.equal(collects[0].final, false);
  dispose(deck);
});

test('cancel returns the whole stack and reversing to down clears group poses', () => {
  const deck = make(4); ready(deck); select(deck, 2); const initial = poses(deck);
  let accepts = 0; for (const name of ['collect', 'discard', 'commit']) deck.addEventListener(name, () => accepts++);
  deck.start(); deck.move(gesture(-150)); step(250); deck.cancel(); settle();
  assert.equal(accepts, 0); assert.equal(deck.groupLeaveActive, false);
  for (const [id, pose] of poses(deck)) samePose(pose, initial.get(id), 'cancel restores');
  deck.start(); deck.move(gesture(-100)); step(250); deck.move(gesture(100));
  assert.equal(deck.groupChoiceMotion, false); assert.equal(deck.choiceHistory, null);
  for (let i = 0; i < 4; i++) if (i !== 2) recededPose(cardPose(deck, i), initial.get(`item-${i}`), 'down survivor');
  deck.cancel(); settle();
  for (const [id, pose] of poses(deck)) samePose(pose, initial.get(id), 'reverse cancel restores');
  dispose(deck);
});

for (const reduced of [false, true]) for (const presentation of ['open', 'closed']) test(`discard completion precedes successor commit, reduced=${reduced}, presentation=${presentation}`, () => {
  const deck = make(3); ready(deck); const events = [];
  deck.reduced = reduced;
  deck.addEventListener('discard', e => {
    events.push('discard'); assert.equal(e.detail.all, true);
    deck.replaceContent({ ...fixture(2), id: 'next' }, { presentation });
    assert.equal(deck.content.id, 'items-3'); assert.equal(deck.commitMotion.discardAll, true);
  });
  deck.addEventListener('commit', () => assert.fail('leave must not grant a choice commit'));
  deck.addEventListener('transitioncomplete', e => {
    if (!['discard', 'commit'].includes(e.detail.transition)) return;
    events.push(e.detail.transition + '-complete');
    if (e.detail.transition === 'discard') {
      assert.deepEqual(e.detail.remainingIds, []); assert.equal(e.detail.all, true);
      assert.equal(deck.content.id, 'items-3');
    } else assert.equal(deck.content.id, 'next');
  });
  key(deck, 'ArrowUp'); settle();
  assert.deepEqual(events, ['discard', 'discard-complete', 'commit-complete']);
  assert.equal(deck.commitMotion, null); assert.equal(deck.groupLeaveActive, false); assert.equal(deck.busy, false);
  assert.match(deck.mount.getAttribute('aria-label'), /remaining items/); dispose(deck);
});

test('unflagged discard stays per item; reset and destroy cancel flagged departure', () => {
  const legacy = make(3, { ...fixture(3), discardAll: false }); ready(legacy);
  legacy.discard(); assert.equal(legacy.commitMotion, null); assert.equal(legacy.collectMotion.final, false);
  settle(); assert.equal(legacy.cards.length, 2); dispose(legacy);
  for (const operation of ['reset', 'destroy']) {
    const deck = make(3); ready(deck); let completes = 0;
    deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === 'discard') completes++; });
    deck.discard(); assert.equal(deck.groupLeaveActive, true); deck[operation](); settle();
    assert.equal(deck.groupLeaveActive, false); assert.equal(deck.commitMotion, null); assert.equal(completes, 0);
    dispose(deck);
  }
});

for (const input of ['gesture', 'Enter']) test(`new ${input} take during canceled group return resets follower poses`, () => {
  const deck = make(3); ready(deck); const initial = poses(deck);
  deck.start(); deck.move(gesture(-120)); step(120); deck.cancel(); step();
  assert.equal(deck.groupLeaveActive, true);
  if (input === 'gesture') { deck.start(); deck.move(gesture(150)); deck.end(gesture(150)); }
  else key(deck, 'Enter');
  assert.equal(deck.groupLeaveActive, false); assert.equal(deck.collectMotion.transition, 'collect');
  for (let i = 1; i < 3; i++) {
    const pose=cardPose(deck,i),base=initial.get(`item-${i}`);
    assert.ok(pose.y<=base.y);
    assert.ok(Math.abs(projectedBounds(pose,340,453,deck.settings.perspective).top-projectedBounds(base,340,453,deck.settings.perspective).top)<1e-7);
  }
  settle(); assert.equal(deck.cards.length, 2); dispose(deck);
});

test('whole-stack clearance gates final discard and ending finishes once on a hidden tab', () => {
  const deck = make(4); ready(deck); let discarded = 0, committed = 0;
  deck.addEventListener('discard', () => deck.endContent());
  deck.addEventListener('transitioncomplete', e => {
    if (e.detail.transition === 'discard') discarded++;
    if (e.detail.transition === 'commit') committed++;
  });
  deck.discard();
  const start = deck.commitMotion.start;
  now = start + deck.settings.commitDuration / 2;
  const bounds = deck.mount.getBoundingClientRect();
  assert.ok(deck.cards.some((_, i) => projectedBounds(cardPose(deck, i), bounds.width, bounds.height, deck.settings.perspective).bottom > -8));
  deck.tick(now); assert.equal(discarded, 0); assert.equal(deck.content.id, 'items-4');
  document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(discarded, 1); assert.equal(committed, 1); assert.equal(deck.phase, 'ended');
  assert.equal(deck.groupLeaveActive, false); assert.equal(deck.mount.children.length, 0); dispose(deck);
});

for (const index of [0, 2]) test(`down-to-up reversal leaves untouched followers stationary before their delay, selected=${index}`, () => {
  const deck = make(3); ready(deck); select(deck, index);
  const initial = poses(deck);
  deck.start(); deck.move(gesture(100)); step(100);
  const before = poses(deck);
  deck.move(gesture(-100));
  const after = poses(deck);
  assert.equal(deck.choiceRanks.get(`item-${index}`), 0);
  assert.ok(after.get(`item-${index}`).y < initial.get(`item-${index}`).y - 85);
  for (let i = 0; i < 3; i++) if (i !== index) samePose(after.get(`item-${i}`), before.get(`item-${i}`), 'reversal preserves untouched follower');
  step(100);
  for (let i = 0; i < 3; i++) if (i !== index) assert.ok(cardPose(deck, i).y < before.get(`item-${i}`).y, 'follower joins upward after delay');
  deck.cancel(); settle();
  for (const [id, pose] of poses(deck)) samePose(pose, initial.get(id), 'reversal cancel restores');
  dispose(deck);
});

for (const index of [0, 2]) for (const input of ['regrab', 'keyboard']) test(`returning take enters group without leader jump, selected=${index}, input=${input}`, () => {
  const deck = make(3); ready(deck); select(deck, index);
  deck.start(); deck.move(gesture(100)); step(100); deck.cancel(); step(16);
  const before = poses(deck);
  assert.ok(deck.l.x < 0);
  if (input === 'regrab') { deck.start(); deck.move(gesture(-1)); }
  else deck.discard();
  const after = poses(deck), selected = `item-${index}`;
  assert.ok(Math.abs(after.get(selected).y - before.get(selected).y + (input === 'regrab' ? 1 : 0)) < .01, 'leader follows only the new pointer displacement');
  for (let i = 0; i < 3; i++) if (i !== index) samePose(after.get(`item-${i}`), before.get(`item-${i}`), 'followers retain their pose');
  if (input === 'regrab') { deck.cancel(); settle(); }
  dispose(deck);
});

for(const count of [1,2,5])test(`discard scatter grows with upward travel and resets on cancel, items=${count}`,()=>{
 const deck=make(count);ready(deck);const initial=poses(deck);
 deck.start();deck.move(gesture(-60));step(250);const near=poses(deck);
 deck.move(gesture(-180));step(250);const far=poses(deck);
 for(const [id,pose] of far){
  const base=initial.get(id),small=near.get(id);
  assert.ok(Math.abs(pose.x-base.x)>Math.abs(small.x-base.x)+15,'horizontal scatter grows');
  assert.ok(Math.abs(pose.rz-base.rz)>Math.abs(small.rz-base.rz)+3,'Z spin grows');
  assert.ok(Math.abs(pose.rz-base.rz)>deck.settings.maxTilt,'discard spin exceeds pointer tilt');
 }
 deck.cancel();settle();
 for(const [id,pose] of poses(deck))samePose(pose,initial.get(id),'cancel restores scatter');
 deck.start();deck.move(gesture(180));
 for(const [id,pose] of poses(deck)){assert.equal(pose.x,initial.get(id).x,'taking adds no scatter');assert.equal(pose.rz,initial.get(id).rz,'taking adds no spin');}
 deck.cancel();settle();dispose(deck);
});
test('ordinary choice stacks do not gain container discard scatter',()=>{
 const deck=make(4,fixture(4,'choice'));ready(deck);const initial=poses(deck);
 deck.start();deck.move(gesture(-180));step(250);
 for(const [id,pose] of poses(deck)){assert.equal(pose.x,initial.get(id).x);assert.equal(pose.rz,initial.get(id).rz);}
 deck.cancel();settle();dispose(deck);
});

test('discard scatter has stable irregular directions and independent spin',()=>{
 const deck=make(12);ready(deck);const initial=poses(deck);
 deck.start();deck.move(gesture(-180));step(500);const first=poses(deck);
 const shifts=[...first].map(([id,pose])=>pose.x-initial.get(id).x);
 const spins=[...first].map(([id,pose])=>pose.rz-initial.get(id).rz);
 assert.ok(shifts.some(x=>x<0)&&shifts.some(x=>x>0),'spread uses both directions');
 assert.ok(shifts.some((x,i)=>i>0&&Math.sign(x)===Math.sign(shifts[i-1])),'directions do not alternate mechanically');
 assert.ok(shifts.some((x,i)=>Math.sign(x)!==Math.sign(spins[i])),'spin is independent of sideways direction');
 assert.ok(new Set(shifts.map(x=>Math.abs(x).toFixed(2))).size>8,'spread magnitudes vary');
 for(const [id,pose] of poses(deck))samePose(pose,first.get(id),'held gesture stays stable');
 deck.cancel();settle();deck.start();deck.move(gesture(-180));step(500);
 for(const [id,pose] of poses(deck))samePose(pose,first.get(id),'same cards retain their scatter');
 deck.cancel();settle();dispose(deck);
});

test('discard spin pivots below the card center with matching pose geometry',()=>{
 const deck=make(1);ready(deck);const initial=cardPose(deck,0);
 deck.start();deck.move(gesture(-150));step(250);
 for(const state of [deck.rotationX,deck.rotationY,deck.rotationZ])state.x=state.v=state.target=0;
 const pose=cardPose(deck,0);
 const angle=(pose.rz-initial.rz)*Math.PI/180;
 const pivot=deck.mount.getBoundingClientRect().height*.12;
 const centerY=initial.y-deck.choiceLift(0);
 assert.ok(Math.abs(pose.y-centerY-pivot*(1-Math.cos(angle)))<1e-8,'lower pivot translation matches rotation');
 const fixedY=pose.y+pivot*Math.cos(angle);
 assert.ok(Math.abs(fixedY-(centerY+pivot))<1e-8,'point below center stays on the vertical lift path');
 deck.cancel();settle();samePose(cardPose(deck,0),initial,'pivot cancels cleanly');dispose(deck);
});


test('standalone single item shares container discard poses throughout drag and departure without discard-all semantics', () => {
  const container=make(1), single=make(1,{...fixture(1),discardAll:false});
  ready(container);ready(single);
  const accepts=[],completions=[];
  single.addEventListener('discard',e=>accepts.push(e.detail));
  single.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='discard')completions.push(e.detail)});
  for(const deck of [container,single]) {deck.start();deck.move(gesture(-240));}
  step(64);samePose(cardPose(single,0,now),cardPose(container,0,now),'held single item uses container spin and sideways movement');
  const before=cardPose(single,0,now);
  for(const deck of [container,single]) deck.end(gesture(-240,-650));
  samePose(cardPose(single,0,now),before,'release is continuous');
  assert.equal(single.commitMotion.discardItem,true);assert.equal(single.commitMotion.discardAll,false);
  assert.equal(accepts.length,1);assert.equal(accepts[0].all,false);assert.equal(accepts[0].final,true);assert.equal(accepts[0].discardedIds,undefined);
  for(let i=0;i<5;i++){step(32);samePose(cardPose(single,0,now),cardPose(container,0,now),'single flight matches container flight');}
  settle();assert.equal(completions.length,1);assert.equal(completions[0].all,false);assert.deepEqual(completions[0].remainingIds,[]);assert.equal(single.cards.length,0);
  dispose(container);dispose(single);
});

test('standalone item discard tilt cancels, reverses to collection and respects disabled discard',()=>{
  const deck=make(1,{...fixture(1),discardAll:false});ready(deck);const initial=cardPose(deck,0,now);
  deck.start();deck.move(gesture(-180));assert.equal(deck.groupLeaveActive,true);assert.ok(Math.abs(cardPose(deck,0,now).rz-initial.rz)>1);
  deck.cancel();settle();samePose(cardPose(deck,0,now),initial,'cancel restores single item');
  deck.start();deck.move(gesture(-180));deck.move(gesture(180));assert.equal(deck.groupLeaveActive,false);deck.end(gesture(180,600));assert.equal(deck.collectMotion.transition,'collect');settle();dispose(deck);
  const blocked=make(1,{...fixture(1),discardAll:false,actions:[{id:'blocked',label:'Blocked',discardDisabled:true}]});ready(blocked);
  blocked.start();blocked.move(gesture(-180));assert.equal(blocked.groupLeaveActive,false);blocked.end(gesture(-180,-900));settle();assert.equal(blocked.commitMotion,null);assert.equal(blocked.cards.length,1);dispose(blocked);
});
