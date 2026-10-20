import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectPreview } from '../studio/ProjectPreview.js';
import { Preview } from '../editor/preview.js';
import { ProjectController } from '../project/ProjectController.js';
import { DiceService } from '../dice/DiceService.js';
import { createProject, compileChapter } from '../project/model.js';

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

test('stopping preview clears and hides its status message',()=>{
  environment();
  const preview=new ProjectPreview(new Element());
  preview.play(createProject());
  preview.status.textContent='Previous error';preview.status.hidden=false;
  preview.stop();
  assert.equal(preview.status.textContent,'');
  assert.equal(preview.status.hidden,true);
  preview.destroy();
});

test('next chapter requires completion and carries only shared inventory; restart retains entry state',()=>{
  environment();
  const project=createProject(), first=project.chapters[0], second=structuredClone(first);
  second.id='second';second.name='Second';second.variables=[{id:'chapter_flag',type:'flag',initial:false}];second.initialValues={energy:7};
  project.chapters.push(second);first.nextChapterId=second.id;
  project.library.push({id:'chapter-wedge',kind:'item',visibility:'local',chapterId:first.id,name:'Wedge',text:'',image:'',permability:0,onCollect:[]});
  project.library.push({id:'shared-key',kind:'item',name:'Key',text:'',image:'',permability:2,onCollect:[]});
  const preview=new ProjectPreview(new Element());preview.play(project);
  assert.equal(preview.nextChapter(),false);assert.equal(preview.nextChapterButton.hidden,true);
  preview.controller.variables.health=5;preview.controller.variables.energy=1;
  preview.controller.inventory=[{id:'chapter-wedge',definitionId:'chapter-wedge',name:'Wedge'}, {id:'shared-key',definitionId:'shared-key',name:'Key',permability:2,remainingTriggers:1}];
  preview.controller.completed=true;preview.controller.notify();
  assert.equal(preview.nextChapterButton.hidden,false);assert.equal(preview.nextChapter(),true);
  assert.equal(preview.chapterId,second.id);assert.equal(preview.state.variables.health,5);assert.equal(preview.state.variables.energy,7);
  assert.equal(preview.state.variables.chapter_flag,false);assert.deepEqual(preview.state.collectedItems.map(item=>item.definitionId),['shared-key']);
  assert.equal(preview.nextChapterButton.hidden,true);
  preview.controller.variables.health=2;preview.controller.inventory=[];preview.restart();
  assert.equal(preview.state.variables.health,5);assert.equal(preview.state.collectedItems[0].remainingTriggers,1);
  preview.controller.completed=true;preview.controller.notify();assert.equal(preview.nextChapter(),false);
  preview.destroy();
});

test('chapter completion follows only its explicit target, independent of stored or alphabetical order',()=>{
  environment();
  const project=createProject(), first=project.chapters[0], second=structuredClone(first),third=structuredClone(first);
  second.id='second';second.name='Alpha';third.id='third';third.name='Zulu';project.chapters.push(second,third);
  const preview=new ProjectPreview(new Element());preview.play(project);
  preview.controller.completed=true;preview.controller.notify();
  assert.equal(preview.nextChapterButton.hidden,true);assert.equal(preview.nextChapter(),false);
  first.nextChapterId=third.id;preview.play(project);
  preview.controller.completed=true;preview.controller.notify();
  assert.equal(preview.nextChapter(),true);assert.equal(preview.chapterId,third.id);
  preview.destroy();
});

test('run state includes all owned items and refreshes when ownership clears', () => {
  environment();
  const preview = new ProjectPreview(new Element());
  const items = Array.from({length: 5}, (_, index) => ({
    id: `placement-${index}`, definitionId: `item-${index}`, name: `Item ${index}`,
  }));
  const update = (variables, collectedItems) => preview.update({variables, collectedItems, idle: true});
  update({}, items);
  assert.equal(preview.stateReadout.hidden, false);
  const readout = () => preview.stateReadout.querySelector('pre').textContent;
  assert.deepEqual(JSON.parse(readout().split('Owned items\n')[1]), items.map(item => ({id: item.definitionId, name: item.name})));
  update({energy: 3}, []);
  assert.equal(preview.stateReadout.hidden, false);
  assert.equal(readout(), 'Variables\n{\n  "energy": 3\n}\n\nOwned items\n[]');
  update({}, []);
  assert.equal(preview.stateReadout.hidden, true);
  assert.ok(!readout().includes('item-0'));
  preview.destroy();
});

test('unavailable choices stay disabled without a player banner; real errors remain visible', () => {
  environment();
  const project=createProject(),chapter=project.chapters[0];
  const fork=chapter.nodes.find(node=>node.type==='fork');
  fork.introEnabled=false;
  const action=project.library.find(card=>card.id===fork.choices[0].definitionId);
  action.conditions=[{source:'variable',key:'energy',op:'gte',value:100}];
  const preview=new ProjectPreview(new Element());
  preview.play(project,chapter.id,fork.id);
  assert.equal(preview.deck.content.actions.every(action=>action.disabled),true);
  assert.equal(preview.status.hidden,true);
  assert.equal(preview.errorMessage,null);
  preview.controller.onError(new Error('Unlinked output'),preview.state);
  assert.equal(preview.status.hidden,false);
  assert.equal(preview.status.textContent,'Unlinked output');
  preview.destroy();
});

test('player preserves authored resources, bounds and chapter starts', () => {
  environment();
  const project = createProject(), root = new Element(), preview = new ProjectPreview(root);
  project.chapters[0].initialValues = {energy:7};
  project.library.find(card=>card.id==='arrival').effects = [{op:'add',key:'energy',value:20}];
  preview.play(project);
  assert.deepEqual(preview.compiled.variables,compileChapter(project).variables);
  assert.deepEqual(preview.state.variables,{energy:7,health:10,agility:3,intelligence:3,composure:3});
  assert.equal(root.querySelector('[data-health]').hidden,false);
  assert.equal(root.querySelector('[data-health]').getAttribute('aria-label'),'Health 10 out of 10');
  assert.equal(root.querySelector('[data-energy]').getAttribute('aria-label'),'Energy 7 out of 10');
  const result = preview.controller.transaction(preview.controller.card());
  assert.deepEqual(result.variables,{energy:10,health:10,agility:3,intelligence:3,composure:3});
  preview.update({...preview.state,variables:result.variables});
  assert.equal(preview.energyValue.textContent,10);
  preview.destroy();
});

test('resource HUD accepts flags, unbounded numbers and absent resource definitions', () => {
  environment();
  const project = createProject(), root = new Element(), preview = new ProjectPreview(root);
  project.variables = [{id:'health',type:'flag',initial:false},{id:'energy',type:'number',initial:123}];
  preview.play(project);
  assert.deepEqual(preview.state.variables,{health:false,energy:123});
  assert.equal(root.querySelector('[data-health]').hidden,true);
  assert.equal(root.querySelector('[data-energy]').getAttribute('aria-label'),'Energy 123');
  project.variables = [];
  preview.play(project);
  assert.deepEqual(preview.state.variables,{});
  assert.equal(preview.resources.hidden,true);
  preview.destroy();
});

test('hidden autoplay skips focus and committed checks ignore Escape',()=>{
  environment();
  const root=new Element(),preview=new ProjectPreview(root);
  let focused=0,canceled=0,inert=true;
  preview.mount.focus=()=>focused++;
  root.closest=()=>inert?{}:null;
  preview.play(createProject(),undefined,undefined,{focus:false});
  assert.equal(focused,0);assert.ok(preview.controller);
  preview.controller.cancelCheck=()=>canceled++;
  preview.overlay.hidden=false;
  const escape=new Event('keydown',{cancelable:true});Object.defineProperty(escape,'key',{value:'Escape'});
  document.dispatchEvent(escape);assert.equal(canceled,0);
  inert=false;document.dispatchEvent(escape);assert.equal(canceled,0);
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
  for (const key of ['project', 'compiled', 'state', 'controller', 'deck', 'releaseDock']) assert.equal(preview[key], null, key);
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
    preview.deck = {waitForCheckSurface:async()=>new Element(),destroy(){}};
    const oldRoll = preview.roll([{ sides: 6 }]);
    await Promise.resolve();
    preview.stop();
    preview.deck = {waitForCheckSurface:async()=>new Element(),destroy(){}};
    const newRoll = preview.roll([{ sides: 6 }]);
    await Promise.resolve();
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
  assert.equal(preview.actionContext.checkChance.textContent, 'SUCCESS');
  abort.abort();
  await newResult;
  assert.equal(preview.overlay.hidden, true);
  assert.equal(preview.resultTimer, null);
  assert.equal(preview.resolveTimer, null);
  preview.destroy();
  await preview.showResult({ total: 4, target: 2, success: true });
  await assert.rejects(preview.roll([{ sides: 6 }]), { name: 'AbortError' });
});

test('check departure leaves the shared caption faded until a result arrives', async () => {
  environment();
  const preview = new ProjectPreview(new Element()), slot = new Element();
  let settle;
  preview.deck = { waitForCheckSurface({ prepare }) {
    prepare(slot);
    return new Promise(resolve => { settle = () => resolve(slot); });
  }, destroy() {} };
  const roll = preview.roll([{ sides: 6, count: 3 }], { target: 14 });
  assert.equal(preview.overlay.hidden, false);
  assert.equal(preview.actionContext.visible, false);
  assert.equal(preview.checkPresentation, null, 'target waits for the completed result');
  assert.equal(preview.actionContext.checkChance.textContent, '');
  assert.equal(preview.dice, null, 'no dice until normal departure settles');
  preview.stop(); settle();
  await assert.rejects(roll, { name: 'AbortError' });
  preview.destroy();
});

test('result holds one second, fades dice for 200ms and leaves the result for handoff', async () => {
  environment();
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,jobs=[];
  globalThis.setTimeout=(callback,delay)=>{jobs.push({callback,delay});return jobs.length;};
  globalThis.clearTimeout=()=>{};
  const preview=new ProjectPreview(new Element());let destroyed=0,faded=0,layerDestroyed=0;
  preview.overlay.hidden=false;preview.dice={destroy(){destroyed++;}};
  preview.diceLayer={fade(){faded++;},destroy(){layerDestroyed++;}};
  try {
    const result=preview.showResult({total:15,target:13,success:true});
    assert.equal(jobs[0].delay,1000);assert.equal(destroyed,0);
    jobs[0].callback();await Promise.resolve();
    assert.equal(faded,1);assert.equal(layerDestroyed,0);
    assert.equal(jobs[1].delay,200);assert.equal(destroyed,0);
    jobs[1].callback();await result;
    assert.equal(destroyed,1);assert.equal(layerDestroyed,1);assert.equal(preview.overlay.hidden,false);
    assert.equal(preview.actionContext.caption.textContent,'TARGET: 13  CHECK: 15');
    assert.equal(preview.actionContext.checkChance.textContent,'SUCCESS');
  } finally {preview.destroy();globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test('card link is optional, starts enabled after controller assignment, and resolves fresh on click', () => {
  environment();
  const standalone = new ProjectPreview(new Element());
  assert.equal(standalone.goToCardButton, undefined); standalone.destroy();
  const root = new Element(), targets = [], inserted = [];
  root.querySelector('[data-preview-actions]').append = button => inserted.push(button);
  const preview = new ProjectPreview(root, { onGoToCard: target => targets.push(target) });
  const button = preview.goToCardButton;
  assert.equal(button.disabled, true); assert.deepEqual(inserted, [preview.nextChapterButton, button]);
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

test('stop notification observes cleared playback without changing onChange or recursing on repeated stop',()=>{
 environment();let changes=0,stops=0;
 const preview=new ProjectPreview(new Element(),{onChange:()=>changes++,onStop:()=>{
  stops++;assert.equal(preview.state,null);assert.equal(preview.deck,null);assert.equal(preview.controller,null);
  preview.stop();
 }});
 preview.play(createProject());assert.equal(changes,1);assert.equal(stops,0);
 preview.stop();preview.stop();assert.equal(changes,1);assert.equal(stops,1);
 preview.restart();assert.equal(changes,2);
 preview.destroy();assert.equal(stops,2);assert.equal(changes,2);
 preview.stop();assert.equal(stops,2);
});

test('stop observer can destroy the preview without repeating teardown',()=>{
 environment();let stops=0;
 const preview=new ProjectPreview(new Element(),{onStop:()=>{stops++;preview.destroy();}});
 preview.play(createProject());preview.destroy();
 assert.equal(stops,1);assert.equal(preview.destroyed,true);
 assert.equal(preview.root.children.length,0);
});

test('a stop observer destroying during replacement play cannot revive the preview',()=>{
 environment();let stops=0;
 const preview=new ProjectPreview(new Element(),{onStop:()=>{stops++;preview.destroy();}});
 preview.play(createProject());const deck=preview.deck,controller=preview.controller;
 preview.play(createProject());
 assert.equal(stops,1);assert.equal(preview.destroyed,true);assert.equal(deck.destroyed,true);assert.equal(controller.destroyed,true);
 assert.equal(preview.deck,null);assert.equal(preview.controller,null);assert.equal(preview.project,null);
});

test('a stop observer replacing play keeps only the replacement controller and callbacks',()=>{
 environment();let stops=0,changes=0;
 const replacement=createProject();replacement.name='Observer replacement';
 const preview=new ProjectPreview(new Element(),{onChange:()=>changes++,onStop:()=>{if(++stops===1)preview.play(replacement);}});
 preview.play(createProject());const firstDeck=preview.deck,firstController=preview.controller;
 const superseded=createProject();superseded.name='Superseded outer play';
 preview.play(superseded);
 assert.equal(firstDeck.destroyed,true);assert.equal(firstController.destroyed,true);
 assert.equal(preview.project.name,'Observer replacement');assert.equal(preview.controller.deck,preview.deck);
 assert.equal(preview.deck.destroyed,false);assert.equal(changes,2);
 preview.destroy();
});

test('terminal destroy ignores stop-observer restart and direct play attempts',()=>{
 environment();let stops=0,changes=0;
 const preview=new ProjectPreview(new Element(),{onChange:()=>changes++,onStop:()=>{
  stops++;preview.restart();preview.play(createProject());
 }});
 preview.play(createProject());const deck=preview.deck,controller=preview.controller;
 preview.destroy();
 assert.equal(stops,1);assert.equal(changes,1);assert.equal(deck.destroyed,true);assert.equal(controller.destroyed,true);
 assert.equal(preview.deck,null);assert.equal(preview.controller,null);assert.equal(preview.root.children.length,0);
});

test('an explicit inventory host is respected with dock ownership enabled',()=>{
 environment();
 const host=new Element(),preview=new ProjectPreview(new Element(),{inventoryDock:true,inventoryHost:host});
 assert.equal(preview.inventorySurface.container,host);
 assert.equal(preview.inventorySurface.frame.style.position,'absolute');
 assert.equal(host.children.includes(preview.inventorySurface.frame),true);
 assert.equal(document.body.classList.contains('has-inventory-dock'),true);
 preview.destroy();
 assert.equal(document.body.classList.contains('has-inventory-dock'),false);
});

test('check information follows selection and hides for story, commit, stop and restart',()=>{
 environment();
 const project=createProject(),chapter=project.chapters[0];
 const fork=chapter.nodes.find(node=>node.type==='fork');fork.introEnabled=false;
 const source=project.library.find(card=>card.id===fork.choices[0].definitionId);
 source.resolution='check';source.check={mode:'stat',modifierVariable:'agility',difficulty:5};
 fork.connections={[`${fork.choices[0].id}:success`]:null,[`${fork.choices[0].id}:failure`]:null};
 const preview=new ProjectPreview(new Element());preview.play(project,chapter.id,fork.id);
 preview.deck.finishMotion();preview.syncActionContext();
 assert.equal(preview.actionContext.checkDetails.hidden,false);
 assert.equal(preview.actionContext.checkChance.textContent,'38%');
 assert.equal(preview.actionContext.caption.textContent,'Agility: 3');
 preview.deck.start();
 preview.deck.move({axis:'y',x:0,y:-40,vx:0,vy:0});
 preview.syncActionContext();
 assert.equal(preview.actionContext.visible,true,'uncommitted swipe keeps odds and stat visible');
 preview.deck.cancel();preview.syncActionContext();
 assert.equal(preview.actionContext.visible,true,'cancelled swipe keeps odds visible');
 const phase=preview.deck.phase;preview.deck.phase='committing';
 preview.syncActionContext();
 assert.equal(preview.actionContext.visible,false,'commit starts the shared caption and odds fade');
 assert.equal(preview.actionContext.caption.textContent,'Agility: 3','last caption remains painted during fade');
 assert.equal(preview.actionContext.checkChance.textContent,'38%');
 preview.deck.phase=phase;preview.syncActionContext();
 assert.equal(preview.actionContext.checkRules.textContent,'Low');
 preview.actionContext.mini.update({id:'tool'});preview.syncActionContext();
 assert.equal(preview.actionContext.mini.item,null,'odds panel takes the source mini lane');
 assert.equal(preview.deck.content.actions[0].summary,'');
 preview.deck.content.actions.push({id:'direct',label:'Leave'});preview.deck.index=1;
 preview.deck.dispatchEvent(new Event('selection'));
 assert.equal(preview.actionContext.visible,false);
 assert.equal(preview.actionContext.root.getAttribute('aria-hidden'),'true');
 assert.equal(preview.actionContext.checkChance.textContent,'38%','last content remains painted for fade-out');
 preview.deck.index=0;preview.deck.dispatchEvent(new Event('selection'));
 assert.equal(preview.actionContext.checkDetails.hidden,false);
 preview.update({...preview.state,checking:true});assert.equal(preview.actionContext.visible,false);
 preview.stop();assert.equal(preview.actionContext.checkDetails.hidden,true);
 preview.restart();preview.deck.finishMotion();preview.syncActionContext();
 assert.equal(preview.actionContext.checkChance.textContent,'38%');
 preview.destroy();assert.equal(preview.actionContext.checkDetails.hidden,true);
});


test('active dice roll keeps target and outcome hidden until showResult', async () => {
  environment();
  const preview = new ProjectPreview(new Element()), slot = new Element();
  const original = DiceService.prototype.roll;
  let finish;
  DiceService.prototype.roll = () => new Promise(resolve => { finish = resolve; });
  preview.deck = { async waitForCheckSurface({prepare}) { prepare(slot); return slot; }, destroy(){} };
  try {
    const rolling = preview.roll([{sides:6,count:3}], {target:14});
    await Promise.resolve();
    assert.ok(preview.dice, 'dice are actively rolling');
    assert.equal(preview.checkPresentation,null);
    assert.equal(preview.actionContext.visible,false);
    assert.equal(preview.actionContext.caption.textContent,'');
    finish({total:15}); await rolling;
    assert.equal(preview.actionContext.visible,false,'raw dice completion does not reveal partial result');
    preview.pauseResult = async () => {};
    await preview.showResult({target:14,total:15,success:true});
    assert.equal(preview.actionContext.caption.textContent,'TARGET: 14  CHECK: 15');
    assert.equal(preview.actionContext.checkChance.textContent,'SUCCESS');
    assert.equal(preview.actionContext.visible,true);
  } finally { preview.destroy(); DiceService.prototype.roll = original; }
});
