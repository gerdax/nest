import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck } from '../engine/CardDeck.js';
import { stageNextContent, stageActionDeck } from '../engine/renderer.js';
import { ChapterController } from '../chapter/ChapterController.js';
import { createLegacyStarterChapter as createStarterChapter } from '../chapter/model.js';
import { ScenarioController, CHEST_ITEM_IDS } from '../demo/ScenarioController.js';
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

function key(deck, name) { const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value: name }); deck.mount.dispatchEvent(event); settle(); }
function fixture(options = {}) {
  const deck = new CardDeck(new Element(), { content: { id: 'placeholder', actions: [{ id: 'placeholder', label: 'Placeholder' }] } });
  const chapter = createStarterChapter();
  const controller = new ChapterController(deck, chapter, { rng: () => 0, ...options });
  return { deck, controller };
}
function dispose(deck, controller) { controller.destroy(); deck.destroy(); settle(); document.hidden = false; }
function revealCommit(deck) { if (deck.content.directAdvance) { key(deck, 'ArrowUp'); return; } key(deck, 'ArrowUp'); assert.equal(deck.phase, 'choices'); key(deck, 'ArrowUp'); }

test('real engine keyboard reaches every linear card and container before random encounter', () => {
  const { deck, controller } = fixture();
  revealCommit(deck);
  assert.equal(controller.state.cardId, 'hall');
  assert.equal(deck.content.title, 'Inside the hall');
  revealCommit(deck);
  assert.equal(controller.state.activeNodeId, 'supplies');
  assert.equal(deck.content.title, 'A supply box');
  assert.equal(deck.phase, 'closed');
  key(deck, 'ArrowUp');
  assert.equal(deck.content.interaction, 'container');
  assert.equal(deck.phase, 'choices');
  assert.equal(deck.content.actions.length, 2);
  dispose(deck, controller);
});

test('story and successor cards render descriptions without displaying retained titles', () => {
  const { deck, controller } = fixture();
  deck.replaceContent({ ...deck.content, showCardNumbers: true });
  for (const heading of deck.cardTitles) {
    assert.equal(heading.hidden, true, 'legacy numbering flags have no visual effect');
    assert.equal(heading.textContent, '');
  }
  assert.equal(deck.cards[0].children[0].children[1].textContent, 'Continue');
  assert.equal(deck.content.title, 'The silent city', 'legacy title remains in content data');
  const heading = deck.scene.children[0].children[0];
  assert.equal(heading.textContent, '');
  assert.equal(heading.hidden, true);
  assert.equal(deck.scene.children[0].children[1].textContent, deck.content.text);
  stageNextContent(deck, {title:'Old successor title',text:'Successor description',image:''});
  assert.equal(deck.underlay.children[0].children[0].textContent, '');
  assert.equal(deck.underlay.children[0].children[1].textContent, 'Successor description');
  dispose(deck, controller);
});

test('image mirroring affects artwork only, including successor and reused action fronts', () => {
  const chapter = createStarterChapter();
  chapter.sequences[0].cards[0].flipImage = true;
  chapter.sequences[0].cards[1].flipImage = true;
  const deck = new CardDeck(new Element(), { content: { id:'wait', actions:[{id:'wait',label:'Wait'}] } });
  const controller = new ChapterController(deck, chapter);
  assert.equal(deck.scene.children[1].style.transform, 'scaleX(-1)');
  assert.equal(deck.scene.children[0].style.transform, undefined, 'text is not mirrored');
  assert.equal(deck.underlay.children[1].style.transform, 'scaleX(-1)');
  const content = { id:'items', actions:[{id:'item',label:'Item',image:'item.png',flipImage:true}] };
  const previous = stageActionDeck(deck, content);
  assert.equal(previous.cards[0].children[1].style.transform, 'scaleX(-1)');
  const next = stageActionDeck(deck, {...content,actions:[{...content.actions[0],flipImage:false}]},0,previous);
  assert.equal(next.cards[0], previous.cards[0], 'reuses the physical card');
  assert.equal(next.cards[0].children[1].style.transform, '');
  assert.equal(next.cards[0].children[0].children[1].textContent, 'Item');
  const fallback = stageActionDeck(deck, {image:'cover.png',flipImage:false,actions:[{id:'fallback',label:'Fallback',image:'',flipImage:true}]});
  assert.equal(fallback.cards[0].children[1].style.transform, 'scaleX(-1)', 'the card controls mirroring even with fallback artwork');
  dispose(deck, controller);
});

test('layered chapter backs reach story, successor and decision cards; retained backs refresh config', () => {
  const chapter = createStarterChapter(); chapter.cardBack = {background:'back.png',icons:{default:'custom-nest.png'},iconScale:0.8,switchProgress:0.4};
  const deck = new CardDeck(new Element(), {content:{id:'wait',actions:[{id:'wait',label:'Wait'}]}});
  const controller = new ChapterController(deck, chapter);
  assert.deepEqual(deck.content.cardBack, chapter.cardBack);
  assert.equal(deck.sceneBack.style.backgroundImage, 'url("back.png")');
  assert.deepEqual(deck.sceneBack.children.map(child=>child.className), ['nest-card-texture','nest-back-icon']);
  assert.equal(deck.sceneBack.backIcons.get('default').getAttribute('src'), 'custom-nest.png');
  assert.equal(deck.sceneBack.backIcons.get('default').style.transform, 'scale(0.8)');
  assert.equal(deck.sceneBack.backIcons.get('default').hidden, false);
  assert.deepEqual([...deck.sceneBack.backIcons.keys()], ['default']);
  assert.equal(deck.underlayBack.style.backgroundImage, 'url("back.png")');
  stageNextContent(deck, {image:'front.png',text:'Future'});
  assert.equal(deck.underlayBack.style.backgroundImage, 'url("back.png")', 'simple successor preview retains chapter back');
  assert.equal(deck.underlayBack.backIcons.get('default').getAttribute('src'), 'custom-nest.png');
  const content = {decisionOnly:true,cardBack:chapter.cardBack,actions:[{id:'choice',label:'Choose'}]};
  const previous = stageActionDeck(deck, content);
  assert.equal(previous.cardBacks[0].style.backgroundImage, 'url("back.png")');
  const next = stageActionDeck(deck, {...content,cardBack:{background:'changed.png',icons:{default:'changed-nest.png'},iconScale:0.6}},0,previous);
  assert.equal(next.cards[0], previous.cards[0], 'same action retains its physical card');
  assert.equal(next.cardBacks[0], previous.cardBacks[0], 'retained back refreshes in place');
  assert.equal(next.cardBacks[0].style.backgroundImage, 'url("changed.png")');
  assert.equal(next.cardBacks[0].backIcons.get('default').getAttribute('src'), 'changed-nest.png');
  assert.equal(next.cardBacks[0].backIcons.get('default').style.transform, 'scale(0.6)');
  const defaults = stageActionDeck(deck, {...content,cardBack:undefined},0,next);
  assert.equal(defaults.cardBacks[0].style.backgroundImage, 'url("./assets/img/ui/cardback.png")');
  assert.equal(defaults.cardBacks[0].backIcons.get('default').getAttribute('src'), './assets/img/ui/default.png');
  assert.equal(defaults.cardBacks[0].children.some(child=>child.className==='nest-back-frame' || child.textContent==='NEST'), false);
  dispose(deck, controller);
});

for (const reduced of [false, true]) for (const directions of [['ArrowDown', 'ArrowDown'], ['ArrowDown', 'ArrowUp'], ['ArrowUp']]) test(`real engine collects selected items or leaves the remaining container, reduced=${reduced}, directions=${directions}`, () => {
  const { deck, controller } = fixture({ startNode: 'supplies' });
  deck.reduced = reduced;
  key(deck, 'ArrowUp');
  assert.equal(deck.phase, 'choices', 'one reveal presents container items');
  key(deck, directions[0]);
  if(directions[0]==='ArrowDown') {
    assert.equal(controller.state.activeNodeId, 'supplies');
    assert.equal(deck.content.actions.length, 1);
    assert.equal(controller.state.collectedItems.length,1);
    key(deck, directions[1]);
  }
  assert.equal(controller.state.collectedItems.length, directions.filter(key => key === 'ArrowDown').length);
  assert.equal(controller.state.activeNodeId, 'encounter');
  assert.equal(deck.content.title, 'A dark crossing');
  assert.equal(deck.phase, 'closed');
  assert.equal(deck.returnContent, null);
  dispose(deck, controller);
});

for (const reduced of [false, true]) for (const direction of ['ArrowDown', 'ArrowUp']) test(`real engine final resolution ends without generated content, reduced=${reduced}, direction=${direction}`, () => {
  const chapter = createStarterChapter();
  chapter.nodes.find(node => node.id === 'supplies').connections.next = null;
  const deck = new CardDeck(new Element(), { content: { id: 'placeholder', actions: [{ id: 'placeholder', label: 'Placeholder' }] } });
  const controller = new ChapterController(deck, chapter, { startNode: 'supplies' });
  deck.reduced = reduced;
  key(deck, 'ArrowUp');
  key(deck, direction); key(deck, direction);
  assert.equal(controller.state.completed, true);
  assert.equal(controller.state.collectedItems.length, direction === 'ArrowDown' ? 2 : 0);
  assert.notEqual(deck.content.id, 'chapter-complete');
  assert.equal(deck.mount.children.length, 0);
  assert.equal(deck.phase, 'ended');
  assert.equal(deck.returnContent, null);
  assert.equal(deck.open, false);
  dispose(deck, controller);
});

test('real engine restart during a pending linear commit cancels stale destination', () => {
  const { deck, controller } = fixture();
  deck.key({ key: 'ArrowUp', preventDefault() {} });
  assert.equal(deck.busy, true);
  controller.restart(undefined, 'supplies');
  settle();
  assert.equal(deck.content.title, 'A supply box');
  assert.equal(controller.state.activeNodeId, 'supplies');
  assert.equal(deck.phase, 'closed');
  assert.equal(deck.pending, null);
  dispose(deck, controller);
});


test('real engine final acceptance stages next content while live chapter state waits for flip', () => {
  const { deck, controller } = fixture({ startNode: 'supplies' });
  key(deck, 'ArrowUp');
  key(deck, 'ArrowDown');
  deck.collect();
  assert.equal(controller.state.activeNodeId, 'supplies');
  assert.equal(controller.state.collectedItems.length, 1);
  assert.ok(deck.pending);
  settle();
  assert.equal(controller.state.activeNodeId, 'encounter');
  assert.equal(controller.state.collectedItems.length, 2);
  dispose(deck, controller);
});

test('real engine restart cancels inventory and destination during final departure', () => {
  const { deck, controller } = fixture({ startNode: 'supplies' });
  key(deck, 'ArrowUp'); key(deck, 'ArrowDown');
  deck.collect();
  assert.equal(deck.busy, true);
  controller.restart(undefined, 'supplies');
  settle();
  assert.equal(deck.content.title, 'A supply box');
  assert.equal(deck.content.actions.length, 2);
  assert.equal(deck.phase, 'closed');
  assert.deepEqual(controller.state.collectedItems, []);
  assert.equal(controller.stagedDestination, null);
  dispose(deck, controller);
});


test('scenario resolves the direct chest and carries only taken objects through later studies', () => {
  const deck = new CardDeck(new Element(), { content: { id: 'placeholder', actions: [{ id: 'placeholder', label: 'Placeholder' }] } });
  const notices = [];
  const host = new ScenarioController(deck, { fixture: 'chest', onChange: state => notices.push(state) });
  assert.equal(deck.content.interaction, 'container');
  key(deck, 'ArrowUp');
  const collectedId = deck.content.actions[deck.index].id;
  deck.collect();
  assert.equal(host.remainingIds.size, CHEST_ITEM_IDS.length);
  assert.deepEqual(host.collectedItems, []);
  settle();
  assert.equal(host.remainingIds.size, CHEST_ITEM_IDS.length - 1);
  assert.equal(host.collectedItems[0].id, collectedId);
  assert.equal(host.collectedItems[0].sequenceId, 'chest');
  assert.equal(notices.find(state => state.reason === 'collect').detail.action.label, host.collectedItems[0].label);
  key(deck, 'ArrowUp');
  deck.commit();
  assert.equal(host.mode, 'container');
  assert.equal(host.remainingIds.size, 1);
  settle();
  assert.equal(host.mode, 'choice');
  assert.equal(host.remainingIds.size, 0);
  assert.equal(host.collectedItems.length, 1);
  assert.equal(deck.content.id, 'study-0-2');
  revealCommit(deck);
  assert.equal(host.collectedItems.length, 1);
  host.reset('chest');
  assert.deepEqual(host.collectedItems, []);
  assert.deepEqual([...host.remainingIds], CHEST_ITEM_IDS);
  dispose(deck, host);
});

for (const secondDirection of ['ArrowDown', 'ArrowUp']) test(`reused container templates have separate contents, second=${secondDirection}`, () => {
  const chapter = createStarterChapter();
  const supplies = chapter.nodes.find(node => node.id === 'supplies');
  supplies.connections.next = 'again';
  chapter.sequences.find(sequence => sequence.id === supplies.sequenceId).items.splice(1);
  chapter.nodes.push({ id: 'again', name: 'Another supply box', type: 'static', x: 800, y: 300,
    sequenceId: supplies.sequenceId, connections: { next: null } });
  const deck = new CardDeck(new Element(), { content: { id: 'placeholder', actions: [{ id: 'wait', label: 'Wait' }] } });
  const controller = new ChapterController(deck, chapter, { startNode: 'supplies' });
  key(deck, 'ArrowUp'); key(deck, 'ArrowDown');
  assert.equal(controller.state.activeNodeId, 'again');
  assert.equal(deck.content.actions.length, 1, 'reused template represents a fresh container');
  key(deck, 'ArrowUp'); key(deck, secondDirection);
  assert.equal(controller.state.completed, true);
  assert.equal(deck.busy, false);
  assert.equal(controller.state.collectedItems.length, secondDirection === 'ArrowDown' ? 2 : 1);
  dispose(deck, controller);
});

for (const reduced of [false, true]) test(`linear cover advances directly on one upward gesture, reduced=${reduced}`, () => {
  const { deck, controller } = fixture();
  deck.reduced = reduced;
  deck.start();
  deck.move({axis:'y', x:0, y:-120});
  deck.end({axis:'y', x:0, y:-120, vx:0, vy:-500});
  settle();
  assert.equal(controller.state.cardId, 'hall');
  assert.equal(deck.phase, 'closed');
  assert.equal(deck.cards.every(card => card.style.visibility === 'hidden'), true);
  dispose(deck, controller);
});
test('short linear cover gesture does not advance', () => {
  const { deck, controller } = fixture();
  const before = controller.state.cardId;
  deck.start(); deck.move({axis:'y', x:0, y:-10});
  deck.end({axis:'y', x:0, y:-10, vx:0, vy:0}); settle();
  assert.equal(controller.state.cardId, before);
  assert.equal(deck.phase, 'closed');
  dispose(deck, controller);
});

for (const reduced of [false, true]) test(`decision-only entry and choice transition require no cover reveal, reduced=${reduced}`, async () => {
  const { createStarterChapter: modern } = await import('../chapter/model.js');
  const chapter = modern();
  chapter.nodes.find(n => n.id === 'crossing').connections.explore = 'second';
  chapter.nodes.push({id:'second',name:'Second decision',type:'static',x:0,y:0,sequenceId:'route-decision',connections:{explore:null,leave:null}});
  const deck = new CardDeck(new Element(), {content:{id:'wait',actions:[{id:'wait',label:'Wait'}]}});
  deck.reduced = reduced;
  const controller = new ChapterController(deck, chapter, {startNode:'crossing'}); settle();
  assert.equal(deck.phase, 'choices');
  assert.equal(deck.open, true);
  key(deck, 'ArrowUp');
  assert.equal(controller.state.activeNodeId, 'second');
  assert.equal(deck.phase, 'choices');
  key(deck, 'ArrowRight'); key(deck, 'ArrowUp');
  assert.equal(controller.state.completed, true);
  dispose(deck, controller);
});

for (const reduced of [false, true]) test(`linear reveals face-up within its sequence and flips across node boundary, reduced=${reduced}`, () => {
  const { deck, controller } = fixture();
  deck.reduced = reduced;
  deck.key({key:'ArrowUp',preventDefault(){}});
  if (!reduced) {
    assert.equal(deck.pendingTransition, 'reveal');
    assert.equal(deck.nextFlip.x, 0);
    assert.equal(deck.nextFlip.target, 0);
    step();
    assert.ok(deck.underlay.style.transform.includes('rotateY(0deg)'));
    assert.ok(deck.underlayBack.style.transform.includes('rotateY(180deg)'));
  }
  settle();
  assert.equal(controller.state.cardId, 'hall');
  assert.equal(deck.flip.x, 0);
  deck.key({key:'ArrowUp',preventDefault(){}});
  if (!reduced) {
    assert.equal(deck.pendingTransition, 'flip');
    assert.equal(deck.nextFlip.x, 1);
    step();
    assert.ok(deck.underlay.style.transform.includes('rotateY(180deg)'));
  }
  settle();
  assert.equal(controller.state.activeNodeId, 'supplies');
  dispose(deck, controller);
});

test('linear successor preview is face-up within the node and face-down at its exit', () => {
  const { deck, controller } = fixture();
  const before = controller.state.cardId;
  assert.equal(deck.content.nextCardPreview.title, 'Inside the hall');
  assert.equal(deck.underlay.children[0].children[0].textContent, '');
  assert.equal(deck.underlay.children[0].children[1].textContent, 'A supply box waits beside the stairs.');
  assert.equal(deck.nextFlip.x, 0);
  deck.start(); deck.move({axis:'y',x:0,y:-100});
  step();
  assert.equal(deck.busy, false);
  assert.equal(deck.pending, null);
  assert.equal(controller.state.cardId, before);
  assert.equal(deck.underlay.style.visibility, 'visible');
  assert.ok(deck.underlay.style.transform.includes('rotateY(0deg)'));
  deck.cancel(); settle();
  assert.equal(controller.state.cardId, before);
  assert.equal(deck.underlay.style.visibility, 'hidden');
  key(deck, 'ArrowUp');
  assert.equal(deck.content.nextCardPreview, null);
  assert.equal(deck.nextFlip.x, 1);
  deck.start(); deck.move({axis:'y',x:0,y:-100}); step();
  assert.equal(deck.underlay.style.visibility, 'visible');
  assert.ok(deck.underlay.style.transform.includes('rotateY(180deg)'));
  deck.cancel(); settle();
  dispose(deck, controller);
});

for (const reduced of [false, true]) test(`linear flips into decisions; outgoing decision turns story and hides its successor, reduced=${reduced}`, async () => {
  const { createStarterChapter: modern } = await import('../chapter/model.js');
  const chapter = modern();
  chapter.nodes.find(n=>n.id==='arrival').connections.next='crossing';
  chapter.nodes.find(n=>n.id==='crossing').connections.explore='arrival-copy';
  chapter.nodes.push({id:'arrival-copy',name:'Another story',type:'static',x:0,y:0,sequenceId:'arrival-sequence',connections:{next:null}});
  const deck = new CardDeck(new Element(),{content:{id:'wait',actions:[{id:'wait',label:'Wait'}]}});
  deck.reduced=reduced;
  const controller=new ChapterController(deck,chapter);
  key(deck,'ArrowUp');
  deck.key({key:'ArrowUp',preventDefault(){}});
  if (!reduced) {
    assert.equal(deck.pending.decisionOnly,true);
    assert.equal(deck.nextFlip.x,1);
    assert.equal(deck.forwardDeck.cardBacks.every(Boolean),true);
    assert.ok(deck.forwardDeck.cards[0].style.transform.includes('rotateY(180deg'));
    for(let i=0;deck.commitMotion && i<2000;i++) step();
    assert.equal(deck.content.decisionOnly,true);
    assert.equal(deck.skipCover,true);
    assert.equal(deck.scene.style.visibility,'hidden');
    assert.equal(deck.cards[0].style.visibility,'visible');
    assert.equal(deck.cardBacks[0].style.visibility,'visible');
  }
  settle(); assert.equal(deck.phase,'choices');
  deck.key({key:'ArrowUp',preventDefault(){}});
  if(!reduced){
    for(let i=0;deck.commitMotion && i<2000;i++) step();
    assert.equal(deck.content.directAdvance,true);
    assert.equal(deck.operation,'commit');
    assert.equal(deck.underlay.style.visibility,'hidden','successor must stay hidden behind incoming turning story');
    assert.equal(deck.cards.every(c=>c.style.visibility==='hidden'),true);
  }
  settle();assert.equal(controller.state.activeNodeId,'arrival-copy');
  assert.equal(deck.scene.style.visibility,'visible');
  assert.equal(deck.underlay.style.visibility,'hidden');
  dispose(deck,controller);
});

test('linear to decision preview shows its back during the held swipe', async () => {
  const { createStarterChapter: modern } = await import('../chapter/model.js');
  const chapter=modern();chapter.nodes.find(n=>n.id==='arrival').connections.next='crossing';
  const deck=new CardDeck(new Element(),{content:{id:'wait',actions:[{id:'wait',label:'Wait'}]}});
  const controller=new ChapterController(deck,chapter);
  key(deck,'ArrowUp');
  assert.equal(deck.content.nextDeckPreview.presentation,'open');
  deck.start();deck.move({axis:'y',x:0,y:-100});step();
  assert.equal(deck.forwardDeck.cards[0].style.visibility,'visible');
  assert.ok(deck.forwardDeck.cards[0].style.transform.includes('rotateY(180deg'));
  assert.equal(deck.underlay.style.visibility,'hidden');
  deck.cancel();settle();
  assert.equal(deck.forwardDeck.cards[0].style.visibility,'hidden');
  dispose(deck,controller);
});

test('state effects survive direct story choreography but canceled pointer gesture changes nothing', async () => {
  const { createStarterChapter: modern }=await import('../chapter/model.js');
  const c=modern();c.variables=[{id:'energy',type:'number',initial:1}];c.sequences[0].cards[0].effects=[{op:'add',key:'energy',value:2}];
  const deck=new CardDeck(new Element(),{content:{id:'wait',actions:[{id:'wait',label:'Wait'}]}});
  const controller=new ChapterController(deck,c);
  deck.start();deck.move({axis:'y',x:0,y:-100});step();deck.cancel();settle();
  assert.equal(controller.state.variables.energy,1);
  key(deck,'ArrowUp');assert.equal(controller.state.variables.energy,3);
  controller.restart();settle();assert.equal(controller.state.variables.energy,1);
  dispose(deck,controller);
});

for (const reduced of [false,true]) test(`terminal linear swipe loads no card and restart restores it, reduced=${reduced}`,()=>{
 const chapter=createStarterChapter();chapter.nodes[0].connections.next=null;
 const deck=new CardDeck(new Element(),{content:{id:'wait',actions:[{id:'wait',label:'Wait'}]}});
 deck.reduced=reduced;const controller=new ChapterController(deck,chapter);
 key(deck,'ArrowUp');key(deck,'ArrowUp');
 assert.equal(controller.state.completed,true);assert.equal(deck.phase,'ended');assert.equal(deck.pending,null);
 assert.equal(deck.mount.children.length,0);assert.notEqual(deck.content.id,'chapter-complete');
 key(deck,'ArrowUp');assert.equal(deck.mount.children.length,0);
 controller.restart();settle();assert.equal(controller.state.completed,false);assert.equal(deck.phase,'closed');assert.ok(deck.mount.children.length);
 dispose(deck,controller);
});
