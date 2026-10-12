import { readFileSync } from 'node:fs';
import { compileChapter } from '../project/model.js';
import { ProjectController } from '../project/ProjectController.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck, DEFAULT_SETTINGS } from '../engine/CardDeck.js';
import { cardPose, scenePose } from '../engine/renderer.js';
import { projectedBounds } from '../engine/geometry.js';

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
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function opaque(deck) { for (const node of descendants(deck.mount)) assert.equal(Object.hasOwn(node.style, 'opacity'), false); }
function inputBlocked(deck) { const index = deck.index, cursor = deck.b.target; assert.equal(deck.start(), false); for (const name of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) key(deck, name); deck.commit(); assert.equal(deck.index, index); assert.equal(deck.b.target, cursor); assert.equal(deck.open, true); }
function dispose(deck, host) { host?.destroy(); deck.destroy(); settle(); document.hidden = false; }

function renderedScale(card) {
  return Number(card.style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? 1);
}

const ordinary = id => ({ id, label: id, cardKind: 'action', text: id });
const contextual = id => ({ ...ordinary(id), entrance: 'bottom', inventoryLabel: 'Inventory · Lockpick' });
const choices = actions => ({ id: 'door', interaction: 'choice', autoBrowse: true, title: 'Door', actions });

test('ordinary choices settle before contextual cards enter onto the top in order', () => {
  const deck = make(3, choices([contextual('pick'), ordinary('open'), ordinary('leave'), contextual('key')]));
  assert.equal(deck.index, 1); assert.equal(deck.b.x, 1);
  deck.setOpen(true); deck.schedule();
  until(() => deck.phase === 'inserting');
  assert.equal(deck.fan.x, 1); assert.equal(deck.busy, true);
  assert.ok(!deck.presentationHint);
  assert.equal(deck.entrances.get('key').startAt, null);
  until(()=>deck.entranceActiveId==='pick');
  assert.equal(deck.content.actions[deck.index].id, 'pick');
  inputBlocked(deck);
  step();
  assert.ok(cardPose(deck, 0).y > cardPose(deck, 1).y + 100);
  assert.equal(cardPose(deck, 3).visible, false);
  settle();
  assert.equal(deck.phase, 'choices'); assert.equal(deck.busy, false);
  assert.equal(deck.content.actions[deck.index].id, 'key');
  assert.equal(cardPose(deck, deck.index).y, 0);
  assert.match(deck.live.textContent, /New choices: pick, key/);
  dispose(deck);
});

function until(predicate) { for (let i=0; !predicate() && i<2000; i++) step(); assert.ok(predicate()); }

test('updates reuse survivor elements and reflow their existing poses under the arriving card', () => {
  const deck = make(2, choices([ordinary('open'), ordinary('leave')])); ready(deck);
  select(deck, 1);
  const selected = deck.cards[1], first = deck.cards[0], before = cardPose(deck, 1);
  deck.updateActions([contextual('pick'), ordinary('open'), ordinary('leave')]);
  assert.equal(deck.cards[2], selected); assert.equal(deck.cards[1], first);
  assert.equal(deck.content.actions[deck.index].id, 'leave');
  samePose(cardPose(deck, 2), before, 'selected pose at reconciliation');
  inputBlocked(deck); settle();
  assert.equal(deck.phase, 'choices'); assert.equal(deck.cards[2], selected);
  assert.equal(deck.content.actions[deck.index].id, 'pick');
  assert.equal(deck.entrances.size, 0);
  dispose(deck);
});

test('removing selected action selects next survivor, then previous survivor', () => {
  const deck = make(3, choices([ordinary('a'), ordinary('b'), ordinary('c')])); ready(deck); select(deck, 1);
  deck.updateActions([ordinary('a'), ordinary('c')]); settle();
  assert.equal(deck.content.actions[deck.index].id, 'c');
  deck.updateActions([ordinary('a')]); settle();
  assert.equal(deck.content.actions[deck.index].id, 'a'); dispose(deck);
});

test('closed updates keep cover closed and defer entrance until reveal', () => {
  const deck = make(2, choices([ordinary('open'), ordinary('leave')]));
  const cover = deck.scene;
  deck.updateActions([ordinary('open'), ordinary('leave'), contextual('pick')]);
  assert.equal(deck.scene, cover); assert.equal(deck.phase, 'closed'); assert.equal(deck.open, false);
  assert.equal(cardPose(deck, 2).visible, false);
  ready(deck); assert.equal(deck.entrances.size, 0); dispose(deck);
});

test('contextual-only stacks reveal and select the first choice', () => {
  const deck = make(1, choices([contextual('pick')])); ready(deck);
  assert.equal(deck.index, 0); assert.equal(cardPose(deck, 0).visible, true); dispose(deck);
});

for (const completion of ['reduced', 'hidden', 'resize']) test(`${completion} finishes an entrance without blocked input`, () => {
  const deck = make(3, choices([ordinary('open'), contextual('pick'), contextual('key')]));
  deck.setOpen(true); deck.schedule(); until(() => deck.phase === 'inserting');
  if (completion === 'reduced') { deck.media.matches = true; deck.media.dispatchEvent(new Event('change')); }
  else if (completion === 'hidden') { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
  else deck.resize.callback();
  assert.equal(deck.busy, false); assert.equal(deck.phase, 'choices'); assert.equal(deck.entrances.size, 0);
  settle(); assert.equal(frames.size, 0); dispose(deck);
});

test('reset and destroy cancel pending entrance presentations', () => {
  const deck = make(2, choices([ordinary('open'), contextual('pick')]));
  deck.setOpen(true); deck.schedule(); until(() => deck.phase === 'inserting');
  deck.reset(); assert.equal(deck.phase, 'closed'); assert.equal(deck.busy, false);
  assert.equal(deck.entranceTransition, null); ready(deck);
  deck.updateActions([ordinary('open'), contextual('pick'), contextual('key')]);
  deck.destroy(); settle(); assert.equal(deck.entrances.size, 0); assert.equal(frames.size, 0);
});

test('updated inventory indication refreshes a reused action front', () => {
  const deck = make(1, choices([contextual('pick')])); ready(deck);
  const card = deck.cards[0];
  deck.updateActions([{...contextual('pick'), inventoryLabel: 'Inventory · Key'}]); settle();
  assert.equal(deck.cards[0], card);
  assert.ok(descendants(card).some(el => el.textContent === 'Inventory · Key')); dispose(deck);
});

test('nonanimated open replacement settles contextual cards immediately', () => {
  const deck = make(1, choices([ordinary('open')]));
  deck.replaceContent(choices([ordinary('open'), contextual('pick')]), {presentation:'open', animate:false});
  settle(); assert.equal(deck.phase, 'choices'); assert.equal(deck.busy, false);
  assert.equal(deck.entrances.size, 0); assert.equal(cardPose(deck, 1).visible, true); assert.equal(deck.index,1); dispose(deck);
});

for (const decisionOnly of [false, true]) test(`committing into open fork decisionOnly=${decisionOnly} presents its contextual entrance`, () => {
  const deck = make(1, choices([ordinary('old')])); ready(deck);
  let completions = 0;
  deck.addEventListener('transitioncomplete', e => { if(e.detail.transition==='commit')completions++; });
  deck.addEventListener('commit', () => deck.replaceContent({...choices([contextual('pick'), ordinary('open')]),decisionOnly}, {presentation:'open'}));
  deck.commit();
  assert.equal(deck.forwardDeck.selectedIndex, 1);
  assert.equal(deck.forwardDeck.cards[0].style.visibility, 'hidden');
  until(() => deck.phase === 'inserting');
  assert.equal(deck.busy, true); assert.equal(completions, 0);
  settle(); assert.equal(deck.busy, false); assert.equal(deck.entrances.size, 0);
  assert.equal(cardPose(deck, 0).visible, true); assert.equal(deck.content.actions[deck.index].id,'pick');
  assert.equal(completions, 1); dispose(deck);
});

const doorFixture = () => JSON.parse(readFileSync(new URL('./fixtures/contextual-door.json', import.meta.url), 'utf8'));
function doorRun(project=doorFixture()) {
 const deck=make(1,choices([ordinary('loading')]));
 const controller=new ProjectController(deck,compileChapter(project));settle();
 for(let i=0;i<3;i++){deck.collect();settle();}
 ready(deck);return {deck,controller};
}

test('real controller rejects item use during drag without consuming ownership or effects', () => {
 const {deck,controller}=doorRun();
 const before=JSON.stringify(controller.state);
 assert.equal(deck.start(),true);assert.equal(controller.state.idle,false);
 assert.equal(controller.useItem('potion'),false);
 deck.cancel();settle();assert.equal(JSON.stringify(controller.state),before);dispose(deck,controller);
});

test('real controller inventory use reconciles fork without rebuilding cover or selected action', () => {
 const {deck,controller}=doorRun();
 const scene=deck.scene, selected=deck.cards[deck.index], id=deck.content.actions[deck.index].id;
 assert.equal(controller.useItem('potion'),true);settle();
 assert.equal(deck.scene,scene);assert.equal(deck.cards[deck.index],selected);assert.equal(deck.content.actions[deck.index].id,id);
 assert.equal(controller.inventory.some(i=>i.definitionId==='key'),true);dispose(deck,controller);
});

test('intro effects enable contextual card through reconciliation after reveal', () => {
 const project=doorFixture();const chapter=project.chapters[0];chapter.startNode='door';
 project.library.find(d=>d.id==='door-intro').effects=[{op:'addItem',key:'key'}];
 const deck=make(1,choices([ordinary('loading')]));const controller=new ProjectController(deck,compileChapter(project));settle();
 const scene=deck.scene, ordinaryCard=deck.cards[deck.index];
 deck.setOpen(true);deck.schedule();until(()=>deck.phase==='inserting');
 assert.equal(deck.scene,scene);assert.ok(deck.cards.includes(ordinaryCard));assert.equal(deck.busy,true);
 settle();assert.equal(deck.entrances.size,0);
 const contextualIndex=deck.content.actions.findIndex(a=>a.contextItemId==='key');
 assert.ok(contextualIndex>=0);assert.equal(cardPose(deck,contextualIndex).visible,true);dispose(deck,controller);
});

for(const count of [1,3,10]) test(`${count} contextual cards each arrive on top and retain every choice`,()=>{
 const actions=[ordinary('open'),...Array.from({length:count},(_,i)=>contextual(`item-${i}`)),ordinary('leave')];
 const deck=make(actions.length,choices(actions));const cards=[...deck.cards];let selectionEvents=0;
 deck.addEventListener('selection',()=>selectionEvents++);
 deck.setOpen(true);deck.schedule();until(()=>deck.phase==='inserting');
 for(let i=0;i<count;i++){
  until(()=>deck.entranceActiveId===`item-${i}`);
  const activeIndex=deck.index;
  assert.equal(deck.content.actions[activeIndex].id,`item-${i}`);
  assert.ok(Number(deck.cardLayers[activeIndex].style.zIndex)>Math.max(...deck.cardLayers.filter((_,index)=>index!==activeIndex).map(layer=>Number(layer.style.zIndex))),'arriving card paints on top');
  if(i+1<count){assert.equal(deck.entrances.get(`item-${i+1}`).startAt,null);assert.equal(cardPose(deck,i+2).visible,false);}
  if(i+1<count)until(()=>deck.entranceActiveId===`item-${i+1}`);
 }
 settle();assert.equal(deck.content.actions[deck.index].id,`item-${count-1}`);assert.deepEqual(deck.cards,cards);
 assert.equal(selectionEvents,1);assert.equal(deck.busy,false);
 key(deck,'ArrowRight');settle();assert.equal(deck.content.actions[deck.index].id,'leave');
 key(deck,'ArrowLeft');settle();assert.equal(deck.content.actions[deck.index].id,`item-${count-1}`);
 dispose(deck);
});

for(const mode of ['reduced','hidden','resize']) test(`${mode} settles a long entrance queue on the last contextual card`,()=>{
 const actions=[ordinary('open'),...Array.from({length:12},(_,i)=>contextual(`item-${i}`))];
 const deck=make(actions.length,choices(actions));deck.setOpen(true);deck.schedule();until(()=>deck.phase==='inserting');
 if(mode==='reduced'){deck.media.matches=true;deck.media.dispatchEvent(new Event('change'));}
 else if(mode==='hidden'){document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));}
 else deck.resize.callback();
 assert.equal(deck.phase,'choices');assert.equal(deck.content.actions[deck.index].id,'item-11');assert.equal(deck.busy,false);
 assert.equal(deck.entrances.size,0);settle();dispose(deck);
});

test('entrance completion cannot emit selection for replacement content',()=>{
 const deck=make(2,choices([ordinary('open'),contextual('pick')]));const selections=[];
 deck.addEventListener('selection',e=>selections.push(e.detail));
 deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='reveal')deck.replaceContent({id:'replacement',actions:[ordinary('pick')]});});
 deck.setOpen(true);deck.schedule();settle();
 assert.equal(deck.content.id,'replacement');assert.equal(deck.phase,'closed');assert.equal(selections.length,0);dispose(deck);
});

for(const interruption of ['destroy','reset'])test(`completion-triggered ${interruption} suppresses entrance selection notification`,()=>{
 const deck=make(1,choices([contextual('pick')]));let selections=0;
 deck.addEventListener('selection',()=>selections++);
 deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='reveal')deck[interruption]();});
 deck.setOpen(true);deck.schedule();settle();assert.equal(selections,0);dispose(deck);
});

test('nonanimated replacement with browse history keeps physical and logical contextual top aligned',()=>{
 const deck=make(2,choices([ordinary('open'),ordinary('leave')]));ready(deck);
 deck.replaceContent(choices([ordinary('open'),ordinary('leave'),contextual('pick')]),{presentation:'open',animate:false});
 settle();assert.equal(deck.index,2);assert.equal(deck.b.x,2);assert.equal(deck.b.target,2);
 assert.equal(cardPose(deck,2).front,1);assert.equal(cardPose(deck,2).x,0);dispose(deck);
});

test('starting an entrance preserves painter order of the existing stack',()=>{
 const deck=make(3,choices([ordinary('open'),ordinary('leave'),ordinary('wait')]));ready(deck);
 deck.updateActions([ordinary('open'),contextual('pick'),ordinary('leave'),ordinary('wait')]);
 const orders=new Map(deck.content.actions.filter(action=>action.id!=='pick').map(action=>[action.id,deck.cardLayers[deck.content.actions.findIndex(a=>a.id===action.id)].style.zIndex]));
 until(()=>deck.entranceActiveId==='pick');
 for(const [id,order] of orders){const index=deck.content.actions.findIndex(action=>action.id===id);assert.equal(deck.cardLayers[index].style.zIndex,order);}
 assert.ok(Number(deck.cardLayers[deck.index].style.zIndex)>Math.max(...[...orders.values()].map(Number)));
 settle();assert.equal(deck.reflowOrder,null);dispose(deck);
});

test('a new ordinary choice alongside an incoming contextual card gets a valid painter layer',()=>{
 const deck=make(1,choices([ordinary('open')]));ready(deck);
 deck.updateActions([ordinary('open'),ordinary('new'),contextual('pick')]);
 assert.ok(deck.cardLayers.every(layer=>Number.isFinite(Number(layer.style.zIndex))));
 settle();assert.equal(deck.content.actions[deck.index].id,'pick');dispose(deck);
});

test('ordinary choice hint completes before contextual entrance and never repeats afterward',()=>{
 const deck=make(4,choices([ordinary('open'),ordinary('leave'),contextual('pick'),contextual('key')]));
 deck.setOpen(true);deck.schedule();until(()=>!!deck.presentationHint);
 assert.equal(deck.entranceTransition,null);assert.equal(deck.content.actions[deck.index].id,'open');
 const phases=[];
 while(deck.presentationHint){phases.push(deck.presentationHint.stage);assert.ok([...deck.entrances.values()].every(entry=>entry.startAt===null));assert.equal(cardPose(deck,2).visible,false);step();}
 assert.ok(phases.includes('out'));assert.ok(phases.includes('hold'));assert.ok(phases.includes('return'));
 until(()=>deck.phase==='inserting');assert.equal(deck.presentationBrowsePending,false);
 while(deck.entranceTransition){assert.equal(deck.presentationHint,null);step();}
 settle();assert.equal(deck.content.actions[deck.index].id,'key');assert.equal(deck.presentationHint,null);dispose(deck);
});

for(const decisionOnly of [false,true])test(`open fork commit decisionOnly=${decisionOnly} hints before contextual entrance`,()=>{
 const deck=make(1,choices([ordinary('old')]));ready(deck);
 deck.addEventListener('commit',()=>deck.replaceContent({...choices([ordinary('open'),ordinary('leave'),contextual('pick')]),decisionOnly},{presentation:'open'}));
 deck.commit();until(()=>!!deck.presentationHint);
 assert.equal(deck.content.actions[deck.index].id,'open');assert.equal(deck.entrances.get('pick').startAt,null);
 while(deck.presentationHint){assert.equal(deck.entrances.get('pick').startAt,null);step();}
 until(()=>deck.phase==='inserting');settle();assert.equal(deck.content.actions[deck.index].id,'pick');assert.equal(deck.presentationHint,null);dispose(deck);
});

test('one ordinary choice skips its hint and enters contextual cards without a later hint',()=>{
 const deck=make(3,choices([ordinary('open'),contextual('pick'),contextual('key')]));ready(deck);
 assert.equal(deck.content.actions[deck.index].id,'key');assert.equal(deck.presentationBrowsePending,false);assert.ok(!deck.presentationHint);dispose(deck);
});

for(const decisionOnly of [false,true])for(const interruption of ['reduced','hidden','resize'])test(`${interruption} during pre-entry hint decisionOnly=${decisionOnly} settles the whole sequence`,()=>{
 const actions=[ordinary('open'),ordinary('leave'),contextual('pick'),contextual('key')];
 const deck=make(decisionOnly?1:4,decisionOnly?choices([ordinary('old')]):choices(actions));
 if(decisionOnly){ready(deck);deck.addEventListener('commit',()=>deck.replaceContent({...choices(actions),decisionOnly:true},{presentation:'open'}));deck.commit();}
 else {deck.setOpen(true);deck.schedule();}
 until(()=>!!deck.presentationHint);
 if(interruption==='reduced'){deck.media.matches=true;deck.media.dispatchEvent(new Event('change'));}
 else if(interruption==='hidden'){document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));}
 else deck.resize.callback();
 assert.equal(deck.phase,'choices');assert.equal(deck.busy,false);assert.equal(deck.entrances.size,0);assert.equal(deck.presentationHint,null);
 assert.equal(deck.content.actions[deck.index].id,'key');settle();dispose(deck);
});

for(const decisionOnly of [false,true])test(`resize before destination adoption decisionOnly=${decisionOnly} skips hint and settles contextual top`,()=>{
 const deck=make(1,choices([ordinary('old')]));ready(deck);
 deck.addEventListener('commit',()=>deck.replaceContent({...choices([ordinary('open'),ordinary('leave'),contextual('pick')]),decisionOnly},{presentation:'open'}));
 deck.commit();deck.resize.callback();
 assert.equal(deck.phase,'choices');assert.equal(deck.busy,false);assert.equal(deck.entrances.size,0);assert.equal(deck.presentationHint,null);
 assert.equal(deck.content.actions[deck.index].id,'pick');settle();dispose(deck);
});

test('initial ResizeObserver notification leaves hint and entrance choreography running',()=>{
 const deck=make(3,choices([ordinary('open'),ordinary('leave'),contextual('pick')]));
 deck.setOpen(true);deck.schedule();deck.resize.callback([{target:deck.mount}]);
 assert.equal(deck.phase,'revealing');assert.ok(deck.frame);assert.equal(deck.entrances.get('pick').startAt,null);
 until(()=>!!deck.presentationHint);deck.resize.callback([{target:deck.mount}]);assert.ok(deck.presentationHint);
 deck.mount.getBoundingClientRect=()=>({left:0,top:0,width:360,height:480});
 deck.resize.callback([{target:deck.mount}]);assert.equal(deck.phase,'choices');assert.equal(deck.busy,false);assert.equal(deck.entrances.size,0);
 settle();dispose(deck);
});

test('later contextual arrivals keep their short overlapping cadence',()=>{
 const deck=make(4,choices([ordinary('open'),ordinary('leave'),contextual('pick'),contextual('key')]));
 deck.setOpen(true);deck.schedule();until(()=>deck.phase==='inserting');
 until(()=>deck.entranceActiveId==='pick');
 const first=deck.entrances.get('pick');const firstStart=first.startAt;
 assert.equal(deck.entranceActiveId,'pick');assert.equal(deck.presentationHint,null);
 until(()=>deck.entranceActiveId==='key');
 const interval=deck.entrances.get('key').startAt-firstStart;
 assert.ok(interval>=120&&interval<140,`subsequent arrival interval ${interval}ms`);
 assert.ok(first.travel.x>0,'second card starts before first finishes settling');assert.equal(first.landed,false);
 assert.equal(deck.busy,true);settle();assert.equal(deck.content.actions[deck.index].id,'key');assert.equal(deck.busy,false);dispose(deck);
});

test('first contextual card waits 200ms after the hint before starting its slide',()=>{
 const deck=make(4,choices([ordinary('open'),ordinary('leave'),contextual('pick'),contextual('key')]));
 deck.setOpen(true);deck.schedule();until(()=>deck.phase==='inserting');
 const sequenceStart=now;
 assert.equal(deck.presentationHint,null);assert.equal(deck.entranceNextAt,sequenceStart+200);
 assert.equal(deck.entrances.get('pick').startAt,null);
 step(198);assert.equal(deck.entrances.get('pick').startAt,null);assert.equal(cardPose(deck,2).visible,false);
 step(2);assert.equal(deck.entrances.get('pick').startAt,sequenceStart+200);
 assert.equal(deck.entranceNextAt,sequenceStart+200+120);
 settle();assert.equal(deck.content.actions[deck.index].id,'key');dispose(deck);
});
