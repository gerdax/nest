import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectController } from '../project/ProjectController.js';

// This harness records the controller's choreography contract. Browser/device
// motion is tested separately by the engine tests and is not implied here.
class Deck extends EventTarget {
  reset(){this.resets=(this.resets??0)+1;this.busy=false;this.phase='closed';this.pending=null;this.ended=false;}
  replaceContent(content,options){this.replacements=(this.replacements??0)+1;if(this.busy)this.pending=content;else this.content=content;this.options=options;}
  endContent(){this.ended=true;this.pending=null;}
  emit(name,detail={}){const event=new Event(name);event.detail={contentId:this.content.id,...detail};this.dispatchEvent(event);}
  accept(){this.busy=true;this.phase='committing';this.emit('commit',{action:this.content.actions[0]});this.arrive();}
  arrive(){if(this.pending){this.content=this.pending;this.pending=null;}this.busy=false;this.phase=this.ended?'ended':'closed';this.emit('transitioncomplete',{transition:'commit'});}
  take(id,final=true){this.busy=true;this.phase='collecting';this.emit('collect',{action:{id},final});}
  finishTake(final=true){if(!final){this.busy=false;this.phase='choices';}this.emit('transitioncomplete',{transition:'collect'});if(final)this.arrive();}
  transitionContent(content,options){this.turns=(this.turns??0)+1;this.turnOptions=options;this.content=content;return Promise.resolve(true);}
  refreshInventoryActions(actions){this.content={...this.content,actions};}
  exchangePickup(){this.busy=true;return this.exchangeAccepted!==false;}
}
const story=(id,extra={})=>({id,kind:'narrative',name:id,text:id,...extra});
const lethal=[{op:'add',key:'health',value:-10}];
const death=(cards=[story('death-one'),story('death-two')])=>({id:'death',type:'death',cards,connections:{next:'after'}});
const after={id:'after',type:'linear',cards:[story('after')],connections:{next:null}};
const health={id:'health',type:'number',initial:5,min:0};
function fixture(nodes,extra={},options={}){
  const deck=new Deck(),errors=[];
  const controller=new ProjectController(deck,{startNode:nodes[0].id,nodes:[...nodes,death(),after],deathNode:'death',variables:[health],library:[],...extra},{onError:error=>errors.push(error),...options});
  return {deck,controller,errors};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};

test('lethal direct departure overrides an unlinked output; previews never commit it',()=>{
  const {deck,controller,errors}=fixture([{id:'start',type:'linear',cards:[story('danger',{effects:lethal}),story('unreachable')],connections:{}}],{}, {nodeEntryEffects:{death:[{op:'add',key:'health',value:1}]}});
  assert.equal(controller.state.variables.health,5);assert.equal(controller.state.activeNodeId,'start');
  assert.equal(deck.content.nextDeckPreview.content.text,'death-one');assert.equal(deck.content.nextTransition,'flip');
  assert.equal(deck.content.advanceDisabled,false);assert.equal(deck.resets,1);
  assert.equal(controller.deathDestination({health:0}).node.id,'death');assert.equal(controller.state.variables.health,5);
  deck.accept();
  assert.equal(controller.state.activeNodeId,'death');assert.equal(controller.state.variables.health,1,'Death entry effects are adopted once');
  assert.equal(deck.options.transition,'flip');assert.equal(deck.resets,1,'accepted flight is never reset');assert.deepEqual(errors,[]);
  controller.destroy();
});

test('Death cards progress once at zero health and halt without chapter completion',()=>{
  const {deck,controller}=fixture([{id:'start',type:'linear',cards:[story('danger',{effects:lethal})],connections:{next:null}}]);
  deck.accept();assert.equal(controller.state.cardId,'death-one');assert.equal(controller.state.completed,false);
  deck.accept();assert.equal(controller.state.cardId,'death-two');assert.equal(deck.options.transition,'reveal');
  const lastContentId=deck.content.id;deck.accept();
  assert.equal(controller.state.cardId,'death-two');assert.equal(controller.state.activeNodeId,'death');
  assert.equal(controller.state.terminalReason,'death');assert.equal(controller.state.completed,false);assert.equal(controller.state.idle,false);assert.equal(deck.ended,true);
  const snapshot=controller.state;const replacements=deck.replacements;
  for(const name of ['commit','reveal','collect','discard'])deck.emit(name,{contentId:lastContentId,action:{id:'continue'}});
  assert.deepEqual(controller.state,snapshot);assert.equal(deck.replacements,replacements);
  controller.restart();assert.equal(controller.state.terminalReason,null);assert.equal(controller.state.activeNodeId,'start');controller.destroy();
});

for(const initial of [0,-2])test(`initial health ${initial} adopts Death before ordinary node entry`,()=>{
  const {deck,controller,errors}=fixture([{id:'start',type:'random',routes:[],fallback:false}],{}, {initialState:{variables:{health:initial}},nodeEntryEffects:{start:[{op:'add',key:'health',value:100}]},rng:()=>{throw new Error('No random draw during death');}});
  assert.equal(controller.state.activeNodeId,'death');assert.equal(controller.state.variables.health,0);assert.equal(deck.content.text,'death-one');assert.deepEqual(errors,[]);controller.destroy();
});

for(const variables of [[],[{id:'health',type:'flag',initial:false}],[{id:'health',initial:'0'}]])test(`missing or nonnumeric health does not infer player death: ${JSON.stringify(variables)}`,()=>{
  const {deck,controller}=fixture([{id:'start',type:'linear',cards:[story('alive')],connections:{next:null}}],{variables});
  assert.equal(controller.state.activeNodeId,'start');assert.equal(controller.deathDestination(),null);deck.accept();assert.equal(controller.state.completed,true);assert.equal(controller.state.terminalReason,null);controller.destroy();
});

test('lethal node entry preempts random routing and carries committed entry state',()=>{
  let draws=0;
  const {deck,controller,errors}=fixture([{id:'start',type:'linear',cards:[story('start')],connections:{next:'route'}},{id:'route',type:'random',routes:[{weight:1,target:false}]}],{}, {nodeEntryEffects:{route:lethal},rng:()=>{draws++;return 0;}});
  assert.equal(controller.state.variables.health,5);assert.equal(draws,0);assert.equal(deck.content.advanceDisabled,false);
  deck.accept();assert.equal(controller.state.activeNodeId,'death');assert.equal(controller.state.variables.health,0);assert.equal(draws,0);assert.deepEqual(errors,[]);controller.destroy();
});

test('adoption redirects externally committed zero health and ignores ordinary destination',()=>{
  const {controller}=fixture([{id:'start',type:'linear',cards:[story('start')],connections:{next:null}}]);
  controller.variables.health=0;controller.adopt({node:after,index:0,queue:[]});
  assert.equal(controller.state.activeNodeId,'death');assert.equal(controller.handoffDeath(),false,'Death cannot reenter itself');controller.destroy();
});

for(const result of [1,6])test(`resolved check ${result} routes lethal committed effects after feedback`,async()=>{
  let resolve,feedback;
  const choice={id:'try',kind:'action',resolution:'check',check:{pool:[{sides:6,count:1}],target:3},successEffects:lethal,failureEffects:lethal};
  const {deck,controller,errors}=fixture([{id:'start',type:'fork',introEnabled:false,choices:[choice],connections:{}}],{}, {rollCheck:()=>new Promise(r=>resolve=r),onCheckResult:()=>new Promise(r=>feedback=r)});
  assert.equal(deck.content.actions[0].disabled,false);deck.accept();
  assert.equal(controller.state.activeNodeId,'start');assert.equal(controller.state.variables.health,5);
  resolve(result);await flush();assert.equal(controller.state.activeNodeId,'start');assert.equal(controller.state.variables.health,5);
  feedback();await flush();assert.equal(controller.state.activeNodeId,'death');assert.equal(controller.state.variables.health,0);assert.deepEqual(errors,[]);controller.destroy();
});

for(const cancel of [false,true])test(`provisional health costs never trigger Death, cancelled=${cancel}`,async()=>{
  let resolve;
  const choice={id:'try',kind:'action',resolution:'check',check:{pool:[{sides:6,count:1}],target:1},costs:[{source:'variable',key:'health',amount:5}],effects:[{op:'add',key:'health',value:2}]};
  const {deck,controller}=fixture([{id:'start',type:'fork',introEnabled:false,choices:[choice],connections:{'try:success':'after','try:failure':'after'}}],{}, {rollCheck:()=>new Promise(r=>resolve=r)});
  deck.accept();assert.equal(controller.state.variables.health,0);assert.equal(controller.state.activeNodeId,'start');assert.equal(controller.handoffDeath(),false);
  if(cancel)controller.cancelCheck();resolve(6);await flush();
  assert.equal(controller.state.activeNodeId,cancel?'start':'after');assert.equal(controller.state.variables.health,cancel?5:2);controller.destroy();
});

for(const type of ['container','linear'])test(`final ${type} collection stages Death without early ownership or health commit`,()=>{
  const item={id:'poison',kind:'item',onCollect:lethal};
  const node=type==='linear'?{id:'start',type,cards:[item],connections:{}}:{id:'start',type,introEnabled:false,items:[item],connections:{}};
  const {deck,controller,errors}=fixture([node]);
  assert.equal(deck.content.actions[0].collectDisabled,false);deck.take('poison');
  assert.equal(controller.state.variables.health,5);assert.deepEqual(controller.state.collectedItems,[]);assert.equal(controller.state.activeNodeId,'start');assert.equal(deck.pending.text,'death-one');assert.equal(deck.resets,1);
  deck.finishTake();assert.equal(controller.state.activeNodeId,'death');assert.equal(controller.state.variables.health,0);assert.equal(controller.state.collectedItems[0].definitionId,'poison');assert.equal(deck.resets,1);assert.deepEqual(errors,[]);controller.destroy();
});

test('partial collection waits for accepted departure then turns away from surviving items',async()=>{
  const {deck,controller,errors}=fixture([{id:'start',type:'container',introEnabled:false,items:[{id:'poison',kind:'item',onCollect:lethal},{id:'safe',kind:'item'}],connections:{}}]);
  deck.take('poison',false);assert.equal(deck.pending,null);assert.equal(deck.resets,1);assert.equal(controller.state.variables.health,5);
  deck.finishTake(false);await flush();
  assert.equal(controller.state.activeNodeId,'death');assert.equal(controller.state.variables.health,0);assert.equal(deck.turns,1);assert.equal(deck.turnOptions.transition,'front-turn');assert.equal(deck.resets,1);assert.deepEqual(errors,[]);controller.destroy();
});

for(const departing of [false,true])test(`lethal intro uses accepted reveal choreography, outgoing=${departing}`,async()=>{
  const {deck,controller}=fixture([{id:'start',type:'fork',intro:story('intro',{effects:lethal}),choices:[{id:'choice',kind:'action'}],connections:{}}]);
  if(departing){deck.busy=true;deck.phase='committing';deck.commitMotion={introduction:true};}
  const id=deck.content.id;deck.emit('reveal');
  assert.equal(controller.state.variables.health,0);assert.equal(deck.resets,1);
  if(departing){assert.equal(controller.state.activeNodeId,'death');assert.equal(deck.pending.text,'death-one');deck.arrive();}
  else {assert.equal(controller.state.activeNodeId,'start');deck.emit('transitioncomplete',{transition:'reveal'});await flush();assert.equal(deck.turns,1);}
  assert.equal(controller.state.activeNodeId,'death');assert.equal(controller.pendingIntro,null);
  deck.emit('transitioncomplete',{contentId:id,transition:'reveal'});assert.equal(controller.state.cardId,'death-one');controller.destroy();
});

for(const accepted of [false,true])test(`lethal exchange redirects only after accepted return completes, accepted=${accepted}`,async()=>{
  const inventory=Array.from({length:4},(_,i)=>({id:`owned-${i}`,kind:'item'}));
  const {deck,controller}=fixture([{id:'start',type:'container',introEnabled:false,items:[{id:'poison',kind:'item',onCollect:lethal}],connections:{}}],{}, {initialState:{inventory}});
  deck.pickup={};deck.phase='choices';deck.exchangeAccepted=accepted;
  assert.equal(controller.exchangeCollection({id:'poison'},{returnToStack:true,replacementId:'owned-0'}),accepted);
  assert.equal(controller.state.activeNodeId,'start');assert.equal(deck.resets,1);
  if(accepted){assert.equal(controller.state.variables.health,0);deck.busy=false;deck.emit('transitioncomplete',{transition:'cancel'});await flush();assert.equal(controller.state.activeNodeId,'death');assert.equal(deck.turns,1);}
  else {assert.equal(controller.state.variables.health,5);assert.deepEqual(controller.state.collectedItems.map(i=>i.definitionId),inventory.map(i=>i.id));}
  controller.destroy();
});

test('restart during accepted lethal collection callback suppresses stale Death adoption',()=>{
  let current;
  const {deck,controller}=fixture([{id:'start',type:'container',introEnabled:false,items:[{id:'poison',kind:'item',onCollect:lethal}],connections:{}}],{}, {onSuccess:()=>current.restart()});
  current=controller;deck.take('poison');const stale=deck.content.id;deck.finishTake();
  assert.equal(controller.state.activeNodeId,'start');assert.equal(controller.state.variables.health,5);assert.deepEqual(controller.state.collectedItems,[]);
  deck.emit('transitioncomplete',{contentId:stale,transition:'commit'});assert.equal(controller.state.activeNodeId,'start');controller.destroy();
});

// Actual engine + deterministic RAF probes ensure controller handoffs preserve
// an in-flight deck. These verify event order, not browser rendering or devices.
import { CardDeck } from '../engine/CardDeck.js';
class Element extends EventTarget {
  constructor(){super();this.attrs=new Map();this.style={};this.children=[];this.parentNode=null;this.classList={add(){},remove(){}};this.captures=new Set();}
  setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}
  append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n);}}
  remove(){if(this.parentNode){const a=this.parentNode.children;a.splice(a.indexOf(this),1);this.parentNode=null;}}
  replaceChildren(...nodes){for(const n of [...this.children])n.remove();this.append(...nodes);}
  focus(){}getBoundingClientRect(){return {left:0,top:0,width:340,height:453};}
  setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);}
}
let now=1000,serial=0;const frames=new Map();
Object.defineProperty(performance,'now',{value:()=>now,configurable:true});
globalThis.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
globalThis.document=new Element();document.createElement=()=>new Element();document.hidden=false;
globalThis.matchMedia=()=>Object.assign(new EventTarget(),{matches:false});
globalThis.ResizeObserver=class {observe(){}disconnect(){}};
function settle(){for(let i=0;frames.size&&i<2000;i++){now+=16;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));}assert.equal(frames.size,0,'motion converges');}
function real(node){const deck=new CardDeck(new Element(),{content:{id:'wait',actions:[{id:'wait',label:'Wait'}]}});const errors=[];const controller=new ProjectController(deck,{startNode:node.id,nodes:[node,death(),after],deathNode:'death',variables:[health],library:[]},{onError:error=>errors.push(error)});settle();return {deck,controller,errors};}
function dispose(deck,controller){controller.destroy();deck.destroy();settle();}
for(const reduced of [false,true])test(`native deck preserves lethal intro departure and Death halt, reduced=${reduced}`,async()=>{
  const {deck,controller,errors}=real({id:'start',type:'container',intro:story('intro',{effects:lethal}),items:[{id:'item',kind:'item'}],connections:{}});deck.reduced=reduced;
  let resets=0;const reset=deck.reset.bind(deck);deck.reset=(...args)=>{resets++;return reset(...args);};
  deck.commitIntroduction();assert.equal(controller.state.activeNodeId,'death');assert.equal((deck.pending??deck.content).text,'death-one');settle();await flush();
  assert.equal(deck.content.text,'death-one');assert.equal(deck.phase,'closed');assert.equal(resets,0);
  deck.commitCover();settle();assert.equal(controller.state.cardId,'death-two');
  deck.commitCover();settle();assert.equal(deck.phase,'ended');assert.equal(controller.state.terminalReason,'death');assert.equal(controller.state.completed,false);assert.deepEqual(errors,[]);dispose(deck,controller);
});
for(const final of [false,true])test(`native deck collection Death handoff preserves accepted motion, final=${final}`,async()=>{
  const {deck,controller,errors}=real({id:'start',type:'container',introEnabled:false,items:[{id:'poison',kind:'item',onCollect:lethal},...(!final?[{id:'safe',kind:'item'}]:[])],connections:{}});
  let resets=0;const reset=deck.reset.bind(deck);deck.reset=(...args)=>{resets++;return reset(...args);};
  deck.index=0;deck.b.x=deck.b.target=0;deck.collect();assert.equal(controller.state.variables.health,5);assert.notEqual(deck.collectMotion,null);assert.equal(resets,0);
  settle();await flush();settle();assert.equal(controller.state.activeNodeId,'death');assert.equal(controller.state.variables.health,0);assert.equal(deck.content.text,'death-one');assert.equal(deck.phase,'closed');assert.equal(resets,0);assert.deepEqual(errors,[]);dispose(deck,controller);
});
