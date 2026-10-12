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
function make(count = 3, content = fixture(count), contextualPresentation = 'shuffle') { return new CardDeck(new Element(), { content, contextualPresentation }); }
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


function until(predicate) { for (let i=0; !predicate() && i<2000; i++) step(); assert.ok(predicate()); }
function open(deck) { deck.setOpen(true); deck.schedule(); }

test('presentation option validates and current mode preserves pre-entry hint and contextual top',()=>{
 assert.throws(()=>make(1,choices([ordinary('a')]),'other'),/Unknown contextual/);
 const deck=make(3,choices([ordinary('a'),ordinary('b'),contextual('c')]),'current');
 open(deck);until(()=>!!deck.presentationHint);assert.equal(deck.entranceTransition,null);
 settle();assert.equal(deck.index,2);dispose(deck);
 const fallback=new CardDeck(new Element(),{content:choices([ordinary('a'),contextual('c')])});
 assert.equal(fallback.contextualPresentation,'current');ready(fallback);assert.equal(fallback.index,1);dispose(fallback);
});

for(const actions of [
 [ordinary('a'),contextual('b'),ordinary('c'),contextual('d')],
 [contextual('a'),ordinary('b'),contextual('c'),ordinary('d')],
 [contextual('a'),contextual('b'),contextual('c')],
 [ordinary('a'),...Array.from({length:12},(_,i)=>contextual(`c${i}`))]
])test(`shuffle restores authored order for ${actions.map(a=>a.id).join(',')}`,()=>{
 const deck=make(actions.length,choices(actions));const cards=[...deck.cards],layers=[...deck.cardLayers],array=deck.content.actions;
 const selected=deck.content.actions[deck.index].id;let completions=0,selections=0;
 deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='reveal'){completions++;assert.equal(deck.index,0);assert.equal(deck.busy,false);assert.equal(deck.b.x,0);}});
 deck.addEventListener('selection',()=>selections++);
 open(deck);until(()=>deck.phase==='inserting');assert.equal(deck.presentationHint,undefined);
 const sequenceStart=now;assert.equal(deck.entranceNextAt,sequenceStart+200);
 for(const action of actions.filter(a=>a.entrance==='bottom')) {
  until(()=>deck.entranceActiveId===action.id);assert.equal(deck.content.actions[deck.index].id,action.id);inputBlocked(deck);
 }
 until(()=>deck.phase==='shuffling');assert.equal(completions,0);assert.equal(selections,0);inputBlocked(deck);
 assert.equal(deck.live.textContent,'Ordering choices…');assert.ok(Math.abs(deck.b.target-deck.b.x)<=actions.length/2);
 assert.equal(deck.entrances.size,0);assert.equal(deck.presentationHint,undefined);
 settle();assert.equal(completions,1);assert.equal(selections,selected===actions[0].id?0:1);
 assert.equal(deck.content.actions,array);assert.deepEqual(deck.content.actions.map(a=>a.id),actions.map(a=>a.id));
 assert.deepEqual(deck.cards,cards);assert.deepEqual(deck.cardLayers,layers);assert.equal(cardPose(deck,0).front,1);
 key(deck,'ArrowRight');settle();assert.equal(deck.index,1);key(deck,'ArrowLeft');settle();assert.equal(deck.index,0);
 let committed;deck.addEventListener('commit',e=>committed=e.detail.action.id);deck.commit();settle();assert.equal(committed,actions[0].id);dispose(deck);
});

for(const decisionOnly of [false,true])test(`open destination commit decisionOnly=${decisionOnly} shuffles without hint and completes once`,()=>{
 const deck=make(1,choices([ordinary('old')]));ready(deck);let commits=0;
 deck.addEventListener('commit',()=>deck.replaceContent({...choices([ordinary('a'),ordinary('b'),contextual('c')]),decisionOnly},{presentation:'open'}));
 deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='commit')commits++;});
 deck.commit();until(()=>deck.phase==='inserting');assert.ok(!deck.presentationHint);assert.equal(commits,0);
 until(()=>deck.phase==='shuffling');assert.equal(commits,0);assert.ok(!deck.presentationHint);
 settle();assert.equal(commits,1);assert.equal(deck.index,0);assert.ok(!deck.presentationHint);dispose(deck);
});

for(const decisionOnly of [false,true])test(`already ordered contextual top decisionOnly=${decisionOnly} plays hint after arrival before completion`,()=>{
 const actions=[contextual('a'),ordinary('b'),ordinary('c')];
 const deck=make(decisionOnly?1:3,decisionOnly?choices([ordinary('old')]):choices(actions));let completions=0;
 if(decisionOnly){ready(deck);deck.addEventListener('commit',()=>deck.replaceContent({...choices(actions),decisionOnly:true},{presentation:'open'}));}
 deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition===(decisionOnly?'commit':'reveal'))completions++;});
 if(decisionOnly)deck.commit();else open(deck);
 until(()=>deck.phase==='inserting');assert.ok(!deck.presentationHint);
 until(()=>!!deck.presentationHint);assert.equal(deck.entrances.size,0);assert.equal(deck.index,0);assert.equal(completions,0);
 assert.equal(deck.phase,'inserting');inputBlocked(deck);const stages=new Set();
 while(deck.presentationHint){stages.add(deck.presentationHint.stage);step();}
 settle();assert.ok(stages.has('out')&&stages.has('hold')&&stages.has('return'));assert.equal(completions,1);assert.equal(deck.index,0);dispose(deck);
});

test('sole contextual card skips shuffle and ineligible hint; no-context reveal keeps normal hint',()=>{
 const sole=make(1,choices([contextual('a')]));ready(sole);assert.equal(sole.index,0);assert.ok(!sole.presentationHint);dispose(sole);
 const deck=make(2,choices([ordinary('a'),ordinary('b')]));open(deck);until(()=>!!deck.presentationHint);
 assert.equal(deck.entrances.size,0);settle();assert.equal(deck.index,0);dispose(deck);
});

for(const phase of ['inserting','shuffling'])for(const mode of ['reduced','hidden','resize'])test(`${mode} settles ${phase} including long context queues`,()=>{
 const deck=make(13,choices([ordinary('a'),...Array.from({length:12},(_,i)=>contextual(`c${i}`))]));let completions=0;
 deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='reveal')completions++;});
 open(deck);until(()=>deck.phase===phase);
 if(mode==='reduced'){deck.media.matches=true;deck.media.dispatchEvent(new Event('change'));}
 else if(mode==='hidden'){document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));}
 else {deck.mount.getBoundingClientRect=()=>({left:0,top:0,width:360,height:480});deck.resize.callback([{target:deck.mount}]);}
 assert.equal(deck.phase,'choices');assert.equal(deck.index,0);assert.equal(deck.busy,false);assert.equal(deck.contextualFinalization,null);
 assert.equal(deck.entrances.size,0);assert.equal(completions,1);settle();dispose(deck);
});

for(const interruption of ['reset','destroy'])test(`${interruption} cancels a shuffle without completion`,()=>{
 const deck=make(3,choices([ordinary('a'),ordinary('b'),contextual('c')]));let completions=0;
 deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='reveal')completions++;});
 open(deck);until(()=>deck.phase==='shuffling');deck[interruption]();settle();assert.equal(completions,0);assert.equal(deck.contextualFinalization,null);
 if(interruption==='reset'){assert.equal(deck.phase,'closed');ready(deck);assert.equal(deck.index,0);assert.equal(completions,1);}dispose(deck);
});

for(const interruption of ['replace','reset','destroy'])test(`completion callback ${interruption} suppresses stale selection`,()=>{
 const deck=make(3,choices([contextual('a'),ordinary('b'),contextual('c')]));let selections=0,completions=0;
 deck.addEventListener('selection',()=>selections++);
 deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='reveal'){completions++;if(interruption==='replace')deck.replaceContent({id:'next',actions:[ordinary('next')]});else deck[interruption]();}});
 open(deck);settle();assert.equal(completions,1);assert.equal(selections,0);dispose(deck);
});

test('initial resize notification preserves active shuffle and arrivals keep overlapping cadence',()=>{
 const deck=make(4,choices([ordinary('a'),ordinary('b'),contextual('c'),contextual('d')]));open(deck);until(()=>deck.phase==='inserting');
 until(()=>deck.entranceActiveId==='c');const first=deck.entrances.get('c');until(()=>deck.entranceActiveId==='d');
 assert.ok(deck.entrances.get('d').startAt-first.startAt>=120);assert.ok(deck.entrances.get('d').startAt-first.startAt<140);assert.ok(first.travel.x>0);
 until(()=>deck.phase==='shuffling');const cursor=deck.b.x;deck.resize.callback([{target:deck.mount}]);assert.equal(deck.phase,'shuffling');assert.equal(deck.b.x,cursor);
 settle();dispose(deck);
});

test('action reconciliation reuses survivors and shuffles newly inserted contexts',()=>{
 const deck=make(2,choices([ordinary('a'),ordinary('b')]));ready(deck);key(deck,'ArrowRight');settle();const card=deck.cards[1];
 deck.updateActions([ordinary('a'),ordinary('b'),contextual('c')]);until(()=>deck.phase==='shuffling');settle();
 assert.equal(deck.cards[1],card);assert.equal(deck.index,0);assert.equal(deck.content.actions.length,3);dispose(deck);
});

for(const mode of ['reduced','hidden','resize'])test(`${mode} during post-insertion hint completes once on authored top`,()=>{
 const deck=make(3,choices([contextual('a'),ordinary('b'),ordinary('c')]));let completions=0;
 deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='reveal')completions++;});
 open(deck);until(()=>!!deck.presentationHint);assert.equal(deck.entrances.size,0);
 if(mode==='reduced'){deck.media.matches=true;deck.media.dispatchEvent(new Event('change'));}
 else if(mode==='hidden'){document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));}
 else deck.resize.callback();
 assert.equal(deck.phase,'choices');assert.equal(deck.index,0);assert.equal(deck.busy,false);assert.equal(completions,1);settle();dispose(deck);
});

for(const decisionOnly of [false,true])test(`resize before destination adoption decisionOnly=${decisionOnly} settles authored top`,()=>{
 const deck=make(1,choices([ordinary('old')]));ready(deck);let completions=0;
 deck.addEventListener('commit',()=>deck.replaceContent({...choices([ordinary('a'),ordinary('b'),contextual('c')]),decisionOnly},{presentation:'open'}));
 deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='commit')completions++;});
 deck.commit();deck.resize.callback();assert.equal(deck.phase,'choices');assert.equal(deck.index,0);assert.equal(deck.b.x,0);
 assert.equal(deck.busy,false);assert.equal(deck.entrances.size,0);assert.equal(completions,1);settle();dispose(deck);
});

test('disabled autoBrowse still shuffles, while already ordered arrivals omit hint',()=>{
 for(const actions of [[ordinary('a'),contextual('b')],[contextual('a'),ordinary('b')]]){
  const deck=make(2,{...choices(actions),autoBrowse:false});open(deck);
  if(actions[0].entrance!=='bottom')until(()=>deck.phase==='shuffling');
  settle();assert.equal(deck.index,0);assert.ok(!deck.presentationHint);dispose(deck);
 }
});

for(const mode of ['current','shuffle'])for(const addContext of [false,true])test(`${mode} reveal callback reconciliation addContext=${addContext} releases pending open commit`,()=>{
 const deck=make(1,choices([ordinary('old')]),mode);ready(deck);const events=[];
 deck.addEventListener('commit',()=>deck.replaceContent({...choices([ordinary('a'),ordinary('b')]),decisionOnly:false},{presentation:'open'}));
 deck.addEventListener('transitioncomplete',e=>{
  events.push(e.detail.transition);
  if(e.detail.transition==='reveal'){
   deck.updateActions([...deck.content.actions.map(a=>({...a,disabled:a.id==='b'})),...(addContext?[contextual('c')]:[])]);
   assert.equal(deck.openingCommit,true);
   assert.equal(events.includes('commit'),false);
  }
 });
 deck.commit();settle();assert.equal(deck.phase,'choices');assert.equal(deck.busy,false);assert.equal(deck.openingCommit,false);
 assert.equal(events.filter(t=>t==='commit').length,1);assert.deepEqual(events,['reveal','actionschange','commit']);
 assert.equal(deck.start(),true);deck.cancel();settle();dispose(deck);
});

for(const mode of ['current','shuffle'])for(const interruption of ['replace','reset','destroy'])test(`${mode} reveal callback ${interruption} suppresses abandoned open commit completion`,()=>{
 const deck=make(1,choices([ordinary('old')]),mode);ready(deck);let commits=0;
 deck.addEventListener('commit',()=>deck.replaceContent({...choices([ordinary('a'),ordinary('b')]),decisionOnly:false},{presentation:'open'}));
 deck.addEventListener('transitioncomplete',e=>{
  if(e.detail.transition==='commit')commits++;
  if(e.detail.transition==='reveal'){
   if(interruption==='replace')deck.replaceContent({id:'next',actions:[ordinary('next')]},{presentation:'open',animate:false});
   else deck[interruption]();
  }
 });
 deck.commit();settle();assert.equal(commits,0);assert.equal(deck.openingCommit,false);dispose(deck);
});

for(const mode of ['current','shuffle'])test(`${mode} reduced-motion reveal callback reconciliation completes pending commit once`,()=>{
 const deck=make(1,choices([ordinary('old')]),mode);ready(deck);deck.reduced=true;let commits=0;
 deck.addEventListener('commit',()=>deck.replaceContent({...choices([ordinary('a'),ordinary('b')]),decisionOnly:false},{presentation:'open'}));
 deck.addEventListener('transitioncomplete',e=>{
  if(e.detail.transition==='reveal')deck.updateActions(deck.content.actions.map(a=>({...a,disabled:a.id==='b'})));
  if(e.detail.transition==='commit')commits++;
 });
 deck.commit();settle();assert.equal(deck.phase,'choices');assert.equal(deck.busy,false);assert.equal(deck.openingCommit,false);assert.equal(commits,1);
 assert.equal(deck.start(),true);deck.cancel();settle();dispose(deck);
});
