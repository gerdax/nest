import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck, DEFAULT_SETTINGS } from '../engine/CardDeck.js';
import { cardPose, scenePose } from '../engine/renderer.js';
import { projectedBounds, turningBounds } from '../engine/geometry.js';

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
const fixture = (count, interaction = 'container') => ({ id: `items-${count}`, interaction, title: 'Chest', text: 'Contents', actions: Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, label: `Item ${i}` })) });
function make(count = 3, content = fixture(count)) { return new CardDeck(new Element(), { content }); }
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
  assert.ok(actual.z < expected.z, `${message}: take recedes remaining cards`);
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function opaque(deck) { for (const node of descendants(deck.mount)) assert.equal(Object.hasOwn(node.style, 'opacity'), false); }
function inputBlocked(deck) { const index = deck.index, cursor = deck.b.target; assert.equal(deck.start(), false); for (const name of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) key(deck, name); deck.commit(); assert.equal(deck.index, index); assert.equal(deck.b.target, cursor); assert.equal(deck.open, true); }
function dispose(deck, host) { host?.destroy(); deck.destroy(); settle(); document.hidden = false; }

function renderedScale(card) {
  return Number(card.style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? 1);
}

test('container opens directly from its one cover and cannot return manually', () => {
  const deck = make(); assert.equal(deck.content.allowClose, false);
  key(deck, 'ArrowUp'); settle(); assert.equal(deck.phase, 'choices');
  const cards = [...deck.cards]; let closes = 0;
  deck.addEventListener('close', () => closes++);
  deck.setOpen(false); assert.equal(deck.open, true);
  key(deck, 'Escape'); settle(); assert.deepEqual(deck.cards, cards); assert.equal(closes, 0);
  dispose(deck);
});

for (const resolution of ['collect', 'discard']) for (const count of [2, 3, 4]) for (let index = 0; index < count; index++) {
  test(`${resolution} ${count} items at ${index}: selected departure, survivor identity and order`, () => {
    const deck = make(count); ready(deck); select(deck, index);
    const initial = poses(deck), selected = deck.content.actions[index].id;
    const originals = new Map(deck.content.actions.map((a, i) => [a.id, { card: deck.cards[i], layer: deck.cardLayers[i], order: Number(deck.cardLayers[i].style.zIndex) }]));
    const accepts = [], completes = [];
    deck.addEventListener(resolution, e => accepts.push(e.detail));
    deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === resolution) completes.push(e.detail); });
    const direction = resolution === 'collect' ? 1 : -1, distance = resolution === 'collect' ? 150 : 240;
    const survivorPose = resolution === 'collect' ? recededPose : samePose;
    deck.start(); deck.move(gesture(direction * distance));
    assert.ok(direction * (poses(deck).get(selected).y - initial.get(selected).y) >= distance - 1);
    for (const [id, pose] of poses(deck)) if (id !== selected) survivorPose(pose, initial.get(id), 'held survivor');
    step(); step();
    for (const [id, pose] of poses(deck)) if (id !== selected) survivorPose(pose, initial.get(id), 'held angular survivor');
    deck.end(gesture(direction * distance));
    assert.equal(accepts.length, 1); assert.equal(accepts[0].action.id, selected); assert.equal(accepts[0].index, index); assert.equal(accepts[0].final, false);
    let before;
    while (deck.collectMotion) {
      inputBlocked(deck); before = poses(deck); step(1);
      if (deck.collectMotion) for (const [id, pose] of poses(deck)) if (id !== selected) survivorPose(pose, initial.get(id), 'flight survivor');
    }
    assert.equal(originals.get(selected).layer.parentNode, null); assert.equal(deck.cards.length, count - 1);
    for (const [id, pose] of poses(deck)) {
      samePose(pose, before.get(id), 'physical removal continuity');
      const i = deck.content.actions.findIndex(a => a.id === id);
      assert.equal(deck.cards[i], originals.get(id).card); assert.equal(deck.cardLayers[i], originals.get(id).layer);
      assert.equal(Number(deck.cardLayers[i].style.zIndex), originals.get(id).order);
    }
    assert.equal(completes.length, 0, 'resolution waits for survivor reflow'); settle();
    assert.equal(completes.length, 1); assert.equal(deck.busy, false); assert.equal(deck.phase, 'choices');
    assert.deepEqual(new Set(completes[0].remainingIds), new Set([...initial.keys()].filter(id => id !== selected)));
    opaque(deck); deck.finishMotion(); assert.equal(completes.length, 1); dispose(deck);
  });
}

for (const resolution of ['collect', 'discard']) test(`final ${resolution} stages its reverse while held and flips only after clearance`, () => {
  const deck = make(1); ready(deck);
  const direction = resolution === 'collect' ? 1 : -1, distance = resolution === 'collect' ? 150 : 240, events = [];
  deck.addEventListener(resolution, e => {
    events.push('accepted'); assert.equal(e.detail.final, true);
    deck.replaceContent({ ...fixture(2, 'choice'), id: 'next', title: 'Next situation' });
    assert.equal(deck.content.id, 'items-1'); assert.equal(deck.pending.id, 'next');
  });
  deck.addEventListener('transitioncomplete', e => {
    if (e.detail.transition === resolution) {
      events.push('removed'); assert.deepEqual(e.detail.remainingIds, []); assert.equal(deck.cards.length, 0); assert.equal(deck.busy, true);
      assert.equal(deck.underlayBack.style.visibility, 'visible', 'reverse covers the cleared stage at removal');
    }
    if (e.detail.transition === 'commit') events.push('flipped');
  });
  deck.start(); deck.move(gesture(direction * distance));
  const back = deck.underlayBack;
  assert.ok(back); assert.equal(back.style.visibility, 'visible'); assert.equal(deck.nextFlip.x, 1); assert.deepEqual(events, []);
  deck.end(gesture(direction * distance, direction * 1600));
  while (deck.collectMotion || deck.commitMotion?.discardItem) {
    inputBlocked(deck);
    if (resolution === 'collect') assert.equal(deck.nextFlip.x, 1);
    else if (deck.nextFlip.x < 1) {
      const bounds=deck.mount.getBoundingClientRect();
      const incoming=turningBounds({x:0,y:0,z:-24,turnAxis:deck.settings.flipAxisTilt},bounds.width,bounds.height,deck.settings.perspective);
      assert.ok(projectedBounds(cardPose(deck,0,now),bounds.width,bounds.height,deck.settings.perspective).bottom<=incoming.top-8,'container-style flip waits for projected clearance');
    }
    assert.equal(deck.underlayBack, back); assert.equal(back.style.visibility, 'visible'); opaque(deck); step(1);
  }
  assert.deepEqual(events, ['accepted', 'removed']); assert.equal(deck.phase, 'committing'); assert.ok(deck.flip.x>0&&deck.flip.x<=1);
  assert.equal(deck.scene.style.visibility, 'visible'); assert.equal(deck.sceneBack.style.visibility, 'visible');
  while (frames.size) { assert.equal(deck.start(), false); opaque(deck); step(); }
  assert.deepEqual(events, ['accepted', 'removed', 'flipped']); assert.equal(deck.content.id, 'next'); assert.equal(deck.phase, 'closed'); assert.equal(deck.busy, false); assert.equal(deck.flip.x, 0);
  deck.finishMotion(); assert.equal(events.length, 3); dispose(deck);
});

for (const resolution of ['collect', 'discard']) for (const mode of ['reduced', 'hidden', 'resize']) for (const final of [false, true]) test(`${mode} finishes ${resolution} ${final ? 'final flip' : 'survivor reflow'} once`, () => {
  const deck = make(final ? 1 : 3); ready(deck); const events = [];
  deck.addEventListener(resolution, () => { if (final) deck.replaceContent(fixture(2, 'choice')); });
  deck.addEventListener('transitioncomplete', e => { if ([resolution, 'commit'].includes(e.detail.transition)) events.push(e.detail.transition); });
  deck[resolution](); step();
  if (mode === 'reduced') { deck.media.matches = true; deck.media.dispatchEvent(new Event('change')); }
  else if (mode === 'hidden') { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
  else deck.resize.callback();
  assert.deepEqual(events, final ? [resolution, 'commit'] : [resolution]); assert.equal(deck.frame, 0); assert.equal(deck.busy, false);
  assert.equal(deck.phase, final ? 'closed' : 'choices'); deck.finishMotion(); assert.equal(events.length, final ? 2 : 1); dispose(deck);
});

for (const resolution of ['collect', 'discard']) for (const action of ['reset', 'replace', 'destroy']) test(`${action} cancels accepted ${resolution} without stale completion`, () => {
  const deck = make(3); ready(deck); let completions = 0;
  deck.addEventListener('transitioncomplete', e => { if (e.detail.transition === resolution) completions++; });
  deck[resolution](); step();
  if (action === 'replace') deck.replaceContent(fixture(2, 'choice')); else deck[action]();
  settle(); assert.equal(completions, 0); assert.equal(deck.collectMotion, null); assert.equal(deck.frame, 0); assert.equal(deck.busy, false); dispose(deck);
});

for (const y of [-150, 150]) test(`Escape cancels held ${y < 0 ? 'discard' : 'take'} without closing or accepting`, () => {
  const deck = make(1); ready(deck); let accepts = 0;
  deck.addEventListener('collect', () => accepts++); deck.addEventListener('discard', () => accepts++);
  deck.start(); deck.move(gesture(y)); key(deck, 'Escape'); settle();
  assert.equal(deck.drag, null); assert.equal(deck.open, true); assert.equal(deck.cards.length, 1); assert.equal(accepts, 0);
  assert.equal(deck.underlayBack.style.visibility, 'hidden'); dispose(deck);
});

for (const [name, resolution] of [['ArrowUp', 'discard'], ['ArrowDown', 'collect'], ['Enter', 'collect']]) test(`${name} accepts ${resolution} on selected item`, () => {
  const deck = make(3); ready(deck); key(deck, 'ArrowRight'); settle(); const selected = deck.content.actions[1].id; let action;
  deck.addEventListener(resolution, e => { action = e.detail.action; }); key(deck, name);
  assert.equal(action.id, selected); settle(); assert.equal(deck.cards.length, 2); dispose(deck);
});

for (const resolution of ['collect', 'discard']) test(`keyboard final ${resolution} reveals its reverse continuously before physical removal`, () => {
  const deck = make(1); ready(deck); let observedFullScale = false, previous = DEFAULT_SETTINGS.revealStartScale;
  deck.addEventListener(resolution, () => deck.replaceContent(fixture(2, 'choice')));
  deck[resolution]();
  while (deck.collectMotion || deck.commitMotion?.discardItem) {
    assert.equal(deck.underlayBack.style.visibility, 'visible');
    const scale = renderedScale(deck.underlayBack);
    assert.ok(scale >= previous - 1e-10, 'reverse grows monotonically as selected item departs');
    if (scale === 1) observedFullScale = true;
    previous = scale; step(1);
  }
  assert.ok(observedFullScale, 'reverse reaches full size before item is detached');
  settle(); dispose(deck);
});

for (const resolution of ['collect', 'discard']) test(`rapid browsing resolves a rear item on a tall viewport: ${resolution}`, () => {
  const savedHeight = globalThis.innerHeight;
  globalThis.innerHeight = 1500;
  const deck = make(2);
  deck.updateSettings({ perspective: 650, stackDepth: 30 }); ready(deck);
  let accepted = 0, completed = 0;
  deck.addEventListener(resolution, () => accepted++);
  deck.addEventListener('transitioncomplete', event => { if (event.detail.transition === resolution) completed++; });
  key(deck, 'ArrowRight');
  deck[resolution](); settle();
  assert.equal(accepted, 1); assert.equal(completed, 1);
  assert.equal(deck.collectMotion, null); assert.equal(deck.busy, false);
  assert.equal(deck.cards.length, 1);
  dispose(deck); globalThis.innerHeight = savedHeight;
});


for(const transition of ['collect','discard'])for(const shown of [false,true])test(`surviving item keeps authored heading throughout ${transition}, shown=${shown}`,()=>{
 const content=fixture(2);content.actions=content.actions.map((a,i)=>({...a,cardKind:'item',heading:shown?`Authored ${i}`:'',text:`Description ${i}`}));
 const deck=make(2,content);ready(deck);deck[transition]();
 const check=()=>deck.cardTitles.forEach((title,i)=>{
  assert.equal(title.textContent,deck.content.actions[i].heading);assert.equal(title.hidden,!shown);assert.doesNotMatch(title.textContent,/ITEM \d+\s*\//);
 });
 check();for(let i=0;frames.size&&i<2000;i++){step();check();}
 assert.equal(frames.size,0);assert.equal(deck.content.actions.length,1);check();dispose(deck);
});

function drawerFixture(deck, { authorize, full = false } = {}) {
  document.body = new Element();
  const target = { slot: 1, rect: {left:80, top:560, width:75, height:100}, occupied:full };
  const adapter = {
    getTarget: ({clientY, keyboard}) => keyboard ? target : clientY >= 560 && clientY <= 660 ? target : null,
    slotTarget: () => target, preview() {}, setContext() {}, cancelPending() {},
    authorize: authorize ?? (() => Promise.resolve({slot:1}))
  };
  return import('../engine/InventoryPickup.js').then(({InventoryPickup}) => {
    deck.pickup = new InventoryPickup(deck, adapter);
    return {target, adapter};
  });
}
const flushPickup = async () => { for (let i=0;i<5;i++) await Promise.resolve(); };

test('drawer preview reverses without collection and rejects a short flick outside its slots', async () => {
  const deck=make(); ready(deck); await drawerFixture(deck);
  let collections=0; deck.addEventListener('collect',()=>collections++);
  deck.start();
  deck.move({...gesture(260),clientX:115,clientY:600}); settle();
  assert.equal(deck.pickup.mix.x,1);
  assert.equal(deck.pickup.layer.parentNode,document.body);
  const mini=cardPose(deck,deck.index);
  assert.equal(mini.visible,false,'large card is hidden only in drawer context');
  assert.equal(deck.pickup.layer.style.width,'75px','drawer mini has its own fixed dimensions');
  deck.move({...gesture(90),clientX:115,clientY:430}); settle();
  assert.equal(deck.pickup.mix.x,0);
  assert.equal(deck.pickup.layer,null);
  deck.end({...gesture(90,4000),clientX:115,clientY:430}); settle();
  assert.equal(collections,0); assert.equal(deck.cards.length,3);
  deck.destroy();
});

test('drawer release recomputes target and completes once at slot arrival', async () => {
  const deck=make(); ready(deck); await drawerFixture(deck);
  let collections=0,completions=0;
  deck.addEventListener('collect',()=>collections++);
  deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='collect')completions++;});
  deck.start(); deck.move({...gesture(80),clientX:115,clientY:420});
  deck.end({...gesture(260),clientX:115,clientY:600});
  await flushPickup(); settle();
  assert.equal(collections,1); assert.equal(completions,1); assert.equal(deck.cards.length,2);
  assert.equal(document.body.children.length,0); deck.destroy();
});

test('drawer confirmation locks input; cancellation restores the card; reset invalidates stale approval', async () => {
  const deck=make(); ready(deck);
  let approve; await drawerFixture(deck,{authorize:()=>new Promise(resolve=>{approve=resolve;})});
  let collections=0; deck.addEventListener('collect',()=>collections++);
  deck.start(); deck.move({...gesture(260),clientX:115,clientY:600});
  deck.end({...gesture(260),clientX:115,clientY:600});
  assert.equal(deck.pickup.pending,true); assert.equal(deck.start(),false);
  approve(false); await flushPickup(); settle();
  assert.equal(deck.pickup.pending,false); assert.equal(deck.pickup.mix.x,0); assert.equal(collections,0);
  deck.collect(); assert.equal(deck.pickup.pending,true);
  deck.reset(); approve({slot:1}); await flushPickup(); settle();
  assert.equal(collections,0); assert.equal(document.body.children.length,0); deck.destroy();
});

test('drawer deposits and reversals support reduced motion', async () => {
  const deck=make(); ready(deck); await drawerFixture(deck); deck.reduced=true;
  deck.start(); deck.move({...gesture(260),clientX:115,clientY:600});
  assert.equal(deck.pickup.mix.x,1);
  deck.move({...gesture(80),clientX:115,clientY:420});
  assert.equal(deck.pickup.mix.x,0);
  deck.end({...gesture(260),clientX:115,clientY:600}); await flushPickup();
  assert.equal(deck.cards.length,2); assert.equal(document.body.children.length,0); deck.destroy();
});

test('disabled drawer pickup released over slots settles without a permanent miniature', async () => {
  const deck=make(); ready(deck); await drawerFixture(deck);
  deck.content.actions[deck.index].collectDisabled=true;
  deck.start(); deck.move({...gesture(260),clientX:115,clientY:600});
  deck.end({...gesture(260),clientX:115,clientY:600}); await flushPickup(); settle();
  assert.equal(deck.pickup.mix.x,0); assert.equal(deck.pickup.pending,false);
  assert.equal(deck.cards.length,3); assert.equal(document.body.children.length,0); deck.destroy();
});

test('leaving drawer context immediately restores the full card and permits browsing', async () => {
  const deck=make(); ready(deck); await drawerFixture(deck);
  deck.start(); deck.move({...gesture(260),clientX:115,clientY:600}); settle();
  const owner=deck.content.actions[deck.index].id;
  deck.cancel(); settle(); key(deck,'ArrowRight'); settle();
  assert.notEqual(deck.content.actions[deck.index].id,owner);
  assert.equal(document.body.children.length,0); deck.destroy();
});

test('Escape cancels the held drawer gesture and releasing afterwards cannot collect', async () => {
  const deck=make(); ready(deck); await drawerFixture(deck);
  let collections=0; deck.addEventListener('collect',()=>collections++);
  deck.start(); deck.move({...gesture(260),clientX:115,clientY:600}); settle();
  key(deck,'Escape');
  assert.equal(deck.drag,null); assert.equal(deck.pickup.mix.x,0);
  deck.move({...gesture(280),clientX:115,clientY:620});
  deck.end({...gesture(280),clientX:115,clientY:620}); await flushPickup(); settle();
  assert.equal(collections,0); assert.equal(deck.cards.length,3); deck.destroy();
});

test('Escape during an accepted deposit does not reverse its presentation or cancel its transaction', async () => {
  const deck=make(); ready(deck); await drawerFixture(deck);
  deck.collect(); await flushPickup();
  assert.ok(deck.collectMotion?.deposit);
  key(deck,'Escape'); assert.equal(deck.pickup.mix.x,1);
  settle(); assert.equal(deck.cards.length,2); assert.equal(document.body.children.length,0); deck.destroy();
});

test('before the drawer boundary the large card keeps exactly the original drag pose', async () => {
  const original=make(),drawer=make(); ready(original); ready(drawer); await drawerFixture(drawer);
  original.start(); drawer.start();
  const movement={...gesture(150),clientX:115,clientY:490};
  original.move(movement); drawer.move(movement);
  const expected=cardPose(original,original.index),actual=cardPose(drawer,drawer.index);
  samePose(actual,expected,'drawer must not shrink or change the ordinary card drag');
  assert.equal(drawer.pickup.mix.x,0); assert.equal(drawer.pickup.layer,null);
  original.destroy(); drawer.destroy();
});

test('final drawer deposit completes once, clears the mini and ends the item context', async () => {
  const deck=make(1); ready(deck); await drawerFixture(deck);
  let completed=0;
  deck.addEventListener('collect',()=>deck.endContent());
  deck.addEventListener('transitioncomplete',event=>{if(event.detail.transition==='collect')completed++;});
  deck.collect(); await flushPickup(); settle();
  assert.equal(completed,1); assert.equal(deck.phase,'ended');
  assert.equal(document.body.children.length,0); deck.destroy();
});


test('drawer mini tracks the pointer before insertion; releasing there does not collect', async () => {
  const deck=make(); ready(deck); const {adapter,target}=await drawerFixture(deck);
  adapter.getTarget=({clientX,clientY})=>({...target,snapped:false,clientX,clientY});
  let collections=0; deck.addEventListener('collect',()=>collections++);
  deck.start(); deck.move({...gesture(180),clientX:160,clientY:510});
  assert.equal(deck.pickup.x.x,160-target.rect.width/2);
  assert.equal(deck.pickup.y.x,510-target.rect.height/2);
  deck.move({...gesture(190),clientX:195,clientY:520});
  assert.equal(deck.pickup.x.x,195-target.rect.width/2);
  deck.end({...gesture(190),clientX:195,clientY:520}); await flushPickup(); settle();
  assert.equal(collections,0); assert.equal(deck.cards.length,3); deck.destroy();
});

test('moving deeper snaps the pointer-following mini into its grid destination', async () => {
  const deck=make(); ready(deck); const {adapter,target}=await drawerFixture(deck);
  adapter.getTarget=({clientX,clientY})=>({...target,snapped:clientY>=560,clientX,clientY});
  deck.start(); deck.move({...gesture(180),clientX:160,clientY:510});
  deck.move({...gesture(260),clientX:160,clientY:600});
  assert.equal(deck.pickup.target.snapped,true);
  assert.equal(deck.pickup.x.target,target.rect.left); assert.equal(deck.pickup.y.target,target.rect.top);
  deck.end({...gesture(260),clientX:160,clientY:600}); await flushPickup(); settle();
  assert.equal(deck.cards.length,2); deck.destroy();
});


test('accepted drawer deposit appears immediately and persists through stack reflow', async () => {
  const deck=make(); ready(deck); const {adapter}=await drawerFixture(deck);
  let staged=0,cleared=0;
  adapter.stageDeposit=()=>staged++; adapter.clearDeposit=()=>cleared++;
  deck.collect(); await flushPickup();
  assert.equal(staged,1,'slot accepts before any animation frames');
  assert.equal(deck.pickup.layer,null,'floating replica hands off without duplication');
  assert.equal(cleared,0);
  settle(); assert.equal(cleared,0,'stack reflow must not erase accepted slot');
  deck.destroy(); assert.equal(cleared,1);
});

test('replacement confirmation keeps the main stack at its held pose until a decision', async () => {
  const deck=make(); ready(deck);
  let answer; await drawerFixture(deck,{full:true,authorize:()=>new Promise(resolve=>{answer=resolve;})});
  deck.start(); deck.move({...gesture(260),clientX:115,clientY:600}); settle();
  const held=poses(deck);
  deck.end({...gesture(260),clientX:115,clientY:600});
  assert.equal(deck.pickup.pending,true);
  for(let i=0;i<60;i++) {
    step();
    for(let index=0;index<deck.cards.length;index++) samePose(cardPose(deck,index),held.get(deck.content.actions[index].id),'confirmation must not release stack recession');
  }
  answer(false); await flushPickup(); settle();
  assert.equal(deck.pickup.pending,false); assert.equal(deck.cards.length,3); deck.destroy();
});

test('reduced-motion replacement question holds the drag offset until confirmation', async () => {
  const deck=make(); ready(deck); deck.reduced=true;
  let answer; await drawerFixture(deck,{full:true,authorize:()=>new Promise(resolve=>{answer=resolve;})});
  deck.start(); deck.move({...gesture(260),clientX:115,clientY:600});
  const lift=deck.l.x;
  deck.end({...gesture(260),clientX:115,clientY:600});
  assert.equal(deck.pickup.pending,true); assert.equal(deck.l.x,lift);
  assert.equal(deck.cards.length,3);
  answer({slot:1,replacementId:'old'}); await flushPickup();
  assert.equal(deck.pickup.pending,false); assert.equal(deck.cards.length,2); deck.destroy();
});

for(const exitCapability of [false,true])test(`last deposit keeps 450ms feedback independently of drawer animation capability=${exitCapability}`, async () => {
  const deck=make(1); ready(deck); const {adapter}=await drawerFixture(deck);
  const exit=[]; let completed=0,visible=false;
  if(exitCapability) adapter.setExitProgress=progress=>exit.push(progress);
  adapter.setContext=value=>{visible=value;};
  deck.render();assert.equal(visible,true);
  deck.addEventListener('collect',()=>deck.endContent());
  deck.addEventListener('transitioncomplete',event=>{if(event.detail.transition==='collect')completed++;});
  deck.collect(); await flushPickup();
  // Isolate the feedback clock after the mini has reached its slot.
  for(const state of deck.pickup.states){state.x=state.target;state.v=0;}
  step(449);assert.equal(completed,0);assert.equal(visible,true);
  step(1);assert.equal(completed,1);assert.equal(deck.phase,'ended');assert.equal(visible,false);
  assert.deepEqual(exit,[],'engine never drives visual exit progress');
  deck.destroy();
});

for(const mode of ['reduced','hidden'])test(`final drawer deposit completes immediately with ${mode} motion`,async()=>{
  const deck=make(1);ready(deck);await drawerFixture(deck);let completed=0;
  if(mode==='reduced')deck.reduced=true;else document.hidden=true;
  deck.addEventListener('collect',()=>deck.endContent());
  deck.addEventListener('transitioncomplete',event=>{if(event.detail.transition==='collect')completed++;});
  const start=now;deck.collect();await flushPickup();
  assert.equal(now,start,'completion does not require an animation frame');
  assert.equal(completed,1);assert.equal(deck.phase,'ended');
  deck.destroy();document.hidden=false;
});

test('final deposit still requires its duration and dock arrival after feedback elapses',async()=>{
  const deck=make(1);ready(deck);await drawerFixture(deck);deck.collect();await flushPickup();
  for(const state of deck.pickup.states){state.x=state.target;state.v=0;}
  deck.collectMotion.duration=500;
  assert.equal(deck.itemCleared(deck.collectMotion.start+450),false);
  assert.equal(deck.itemCleared(deck.collectMotion.start+500),true);
  deck.pickup.x.x-=20;
  assert.equal(deck.itemCleared(deck.collectMotion.start+600),false);
  deck.destroy();
});

test('reset and intermediate pickups leave visual exit cleanup to the view', async () => {
  const deck=make(1); ready(deck); const {adapter}=await drawerFixture(deck);
  let progressCalls=0,cleanupCalls=0,completed=0;
  adapter.setExitProgress=()=>progressCalls++;adapter.clearExit=()=>cleanupCalls++;
  deck.addEventListener('transitioncomplete',event=>{if(event.detail.transition==='collect')completed++;});
  deck.collect();await flushPickup();step(430);
  deck.reset();settle();assert.equal(progressCalls,0);assert.equal(cleanupCalls,0);assert.equal(completed,0);deck.destroy();
  const another=make();ready(another);const {adapter:remaining}=await drawerFixture(another);
  remaining.setExitProgress=()=>progressCalls++;
  another.collect();await flushPickup();settle();assert.equal(progressCalls,0);assert.equal(another.cards.length,2);another.destroy();
});

test('drawer enters before the stack hint starts, stays through pickups, and remains hidden on the next intro',async()=>{
  const deck=make(3,{...fixture(3),autoBrowse:true});
  const {adapter}=await drawerFixture(deck);const visibility=[];
  adapter.setContext=visible=>visibility.push(visible);
  deck.setOpen(true);deck.schedule();
  for(let i=0;i<1000&&!deck.presentationHint;i++)step();
  assert.ok(deck.presentationHint,'multi-card stack presents its hint');
  assert.equal(deck.presentationHint.stage,'waiting','the stack hint has not started moving');
  assert.equal(visibility.at(-1),true,'the shared exposure milestone opens the drawer before the hint starts');
  settle();assert.equal(visibility.at(-1),true);
  visibility.length=0;
  deck.collect();await flushPickup();settle();
  assert.equal(deck.cards.length,2);
  assert.ok(visibility.length>0);assert.equal(visibility.includes(false),false,'same-context collection never hides/restarts the drawer');
  const next={...fixture(2),id:'next-box',autoBrowse:true};
  deck.replaceContent(next,{presentation:'closed'});settle();
  assert.equal(deck.open,false);assert.equal(visibility.at(-1),false);
  visibility.length=0;
  deck.render();step();assert.equal(visibility.includes(true),false,'container intro cannot re-enter item context');
  deck.destroy();
});

for(const id of [undefined,'reused'])test(`new drawer presentation re-enters even when content id is ${id}`,async()=>{
  const deck=make(1,{...fixture(1),id});ready(deck);
  const {adapter}=await drawerFixture(deck);let visible=false,entrances=0;
  adapter.setContext=value=>{if(value&&!visible)entrances++;visible=value;};
  deck.render();assert.equal(visible,true);
  deck.addEventListener('discard',()=>deck.replaceContent({...fixture(2),id},{presentation:'open'}));
  deck.discard();settle();
  assert.equal(deck.phase,'choices');assert.equal(visible,true);assert.equal(entrances,2);
  deck.destroy();
});

test('terminal container discard ends logical drawer visibility',async()=>{
  const deck=make(3,{...fixture(3),discardAll:true});ready(deck);
  const {adapter}=await drawerFixture(deck);let visible=false;
  adapter.setContext=value=>{visible=value;};
  deck.render();assert.equal(visible,true);
  deck.addEventListener('discard',()=>deck.endContent());
  deck.discard();settle();
  assert.equal(deck.phase,'ended');assert.equal(visible,false);
  assert.equal(deck.mount.getAttribute('data-inventory-context'),'false');
  deck.destroy();
});


test('ending content cancels a queued inventory continuation',async()=>{
  const deck=make(1);ready(deck);const {adapter}=await drawerFixture(deck);
  let visible=false;const exits=[];
  adapter.setContext=value=>{visible=value;};adapter.setExitProgress=value=>exits.push(value);
  deck.render();assert.equal(visible,true);
  deck.addEventListener('collect',()=>{
    deck.replaceContent(fixture(2),{presentation:'open',preserveInventoryContext:true});
    assert.equal(deck.preserveInventoryContext,true);
    deck.endContent();
    assert.equal(deck.preserveInventoryContext,false);
  });
  deck.collect();await flushPickup();settle();
  assert.equal(deck.phase,'ended');assert.equal(visible,false);assert.deepEqual(exits,[]);
  deck.destroy();
});


test('drawer diagnostics expose readiness blockers without changing visibility or scheduling',async()=>{
  const deck=make(2);ready(deck);const {adapter}=await drawerFixture(deck);
  const trace=[];let enabled=false;
  adapter.traceEnabled=()=>enabled;adapter.trace=(source,state)=>trace.push({source,state});
  deck.pickup.traceReadiness();assert.equal(trace.length,0,'closed diagnostics do no tracing');
  enabled=true;deck.openingCommit=true;
  deck.pickup.traceReadiness();
  assert.equal(trace.at(-1).state.openingCommit,true);
  assert.equal(trace.at(-1).state.blockers.includes('openingCommit'),false,'input locks are not visual blockers');
  const before=trace.length;deck.pickup.traceReadiness();assert.equal(trace.length,before,'unchanged render snapshots are deduplicated');
  deck.openingCommit=false;deck.presentationBrowsePending=true;
  deck.pickup.traceReadiness('CardDeck.completePhase:finished');
  assert.equal(trace.at(-1).state.blockers.includes('stack hint pending'),false,'hint timing no longer blocks the drawer');
  deck.presentationBrowsePending=false;
  deck.pickup.traceReadiness('CardDeck.completePhase:finished');
  assert.deepEqual(trace.at(-1).state.blockers,[]);
  assert.equal(deck.pickup.contextEntered,undefined,'diagnostics do not enter the context');
  assert.equal(frames.size,0,'diagnostics do not schedule a render');
  deck.destroy();
});

for(const flag of ['openingCommit','openingReturn'])test(`drawer visual readiness is independent of the ${flag} input lock`,async()=>{
 const deck=make(1);ready(deck);const {adapter}=await drawerFixture(deck);let visible=false;
 adapter.setContext=value=>{visible=value;};
 deck[flag]=true;deck.render();assert.equal(visible,true);
 assert.equal(deck.start(),false,'showing the drawer does not unlock the card');
 deck.completePhase('choices','reveal');
 assert.equal(deck[flag],false);assert.equal(visible,true);
 assert.equal(frames.size,0,'visibility refresh does not depend on another frame');
 deck.destroy();
});

test('visual readiness excludes compressed targets, departures and queued entrances',()=>{
 const deck=make(2);
 deck.open=true;deck.phase='revealing';
 deck.fan.x=deck.fan.target=0;
 deck.updatePresentationReadiness();assert.equal(deck.presentationState.visualReady,false,'a compressed stack at rest is not ready');
 deck.skipCover=true;deck.fan.x=.98;deck.fan.target=1;deck.fan.v=.2;
 deck.updatePresentationReadiness();assert.equal(deck.presentationState.visualReady,true);
 for(const blocker of ['commitMotion','collectMotion','pending','drag']) {
  deck.presentationRevision++;deck[blocker]={};
  deck.updatePresentationReadiness();assert.equal(deck.presentationState.visualReady,false,blocker);
  deck[blocker]=null;
 }
 deck.presentationRevision++;deck.entrances.set('item-0',{startAt:null});
 deck.updatePresentationReadiness();assert.equal(deck.presentationState.visualReady,false,'queued cards must enter first');
 deck.entrances.clear();deck.phase='closing';deck.presentationRevision++;
 deck.updatePresentationReadiness();assert.equal(deck.presentationState.visualReady,false,'closing is never an entrance');
 deck.destroy();
});

for(const distance of [100,360])test(`returning item shrinks early without changing its travel or followers, distance=${distance}`,()=>{
 const deck=make();ready(deck);
 const resting=poses(deck);
 deck.start();deck.move(gesture(distance));settle();
 const held=poses(deck);
 deck.cancel();
 const returning=deck.itemReturn;assert.ok(returning);
 for(const [id,pose] of poses(deck))samePose(pose,held.get(id),'release boundary is continuous');
 deck.cancelPickup();assert.equal(deck.itemReturn,returning,'repeated cancel does not restart the easing');
 const initialDepth=held.get('item-0').z-resting.get('item-0').z;
 let previous=held.get('item-0').z,compared=false;
 for(let i=0;frames.size&&i<2000;i++) {
  step();
  const current=cardPose(deck,0);
  assert.ok(current.z<=previous+1e-8,'return shrinks monotonically');previous=current.z;
  if(deck.itemReturn&&deck.l.x/returning.startLift<.75&&!compared) {
   const marker=deck.itemReturn;deck.itemReturn=null;
   const old=poses(deck);deck.itemReturn=marker;
   const updated=poses(deck);
   assert.ok(old.get('item-0').z-current.z>initialDepth*.1,'a noticeable part of the shrink happens earlier');
   for(const field of ['x','y','rx','ry','rz'])assert.equal(current[field],old.get('item-0')[field],'travel and tilt are unchanged');
   for(const [id,pose]of updated)if(id!=='item-0')samePose(pose,old.get(id),'follower motion is unchanged');
   compared=true;
  }
 }
 assert.equal(compared,true);assert.equal(frames.size,0);assert.equal(deck.itemReturn,null);
 for(const[id,pose]of poses(deck))samePose(pose,resting.get(id),'returns to original stack pose');
 dispose(deck);
});

test('re-grabbing a returning item preserves the displayed pose and settles to its original size',()=>{
 const deck=make();ready(deck);const resting=poses(deck);
 deck.start();deck.move(gesture(250));settle();deck.cancel();step(64);
 assert.ok(deck.itemReturn);const before=poses(deck);
 assert.equal(deck.start(),true);assert.equal(deck.itemReturn,null);
 for(const[id,pose]of poses(deck))samePose(pose,before.get(id),'re-grab boundary is continuous');
 deck.move(gesture(120));deck.cancel();settle();
 assert.equal(deck.itemReturn,null);
 for(const[id,pose]of poses(deck))samePose(pose,resting.get(id),'interrupted return settles to original size');
 dispose(deck);
});

for(const mode of ['reset','reduced','hidden'])test(`item return easing cleans up with ${mode}`,()=>{
 const deck=make();ready(deck);
 deck.start();deck.move(gesture(240));settle();deck.cancel();assert.ok(deck.itemReturn);
 if(mode==='reset')deck.reset();else {if(mode==='reduced')deck.reduced=true;else document.hidden=true;deck.finishMotion();}
 settle();assert.equal(deck.itemReturn,null);dispose(deck);
});
