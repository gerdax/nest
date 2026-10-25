import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectController } from '../project/ProjectController.js';
const narrative=id=>({id,kind:'event',text:id,effects:[]});
const action=(id,extra={})=>({id,kind:'action',name:id,text:id,resolution:'direct',...extra});
const item=(id,extra={})=>({id,kind:'item',definitionId:id,name:id,text:id,onCollect:[],...extra});
const linear=cards=>[{id:'linear',type:'linear',cards,connections:{next:null}}];
const energy=[{id:'energy',type:'number',initial:4,min:0}];
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
// Browser-shaped harness verifies actual deck event order and asynchronous commits.
import { CardDeck } from '../engine/CardDeck.js';
import { cardPose, scenePose } from '../engine/renderer.js';
import { projectedBounds } from '../engine/geometry.js';
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
globalThis.ResizeObserver=class {constructor(callback){this.callback=callback;}observe(){}disconnect(){}};
function settle(){for(let i=0;frames.size&&i<2000;i++){now+=16;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));}assert.equal(frames.size,0,'motion converges');}
function key(deck,name){deck.key({key:name,preventDefault(){}});settle();}
function real(nodes,extra={},options={}){const deck=new CardDeck(new Element(),{content:{id:'waiting',actions:[{id:'wait',label:'Wait'}]}});const controller=new ProjectController(deck,{startNode:nodes[0].id,nodes,variables:[],library:[],...extra},options);settle();return {deck,controller};}
function dispose(deck,controller){controller.destroy();deck.destroy();settle();}

for(const reduced of [false,true])test(`returning Linear skips taken items and deposits its remaining item, reduced=${reduced}`,async()=>{
 const {InventoryPickup}=await import('../engine/InventoryPickup.js');
 const errors=[];
 const nodes=[
  {id:'linear',type:'linear',cards:[item('one'),item('two',{conditions:[{source:'variable',key:'visit',op:'gte',value:1}]})],connections:{next:'hub'}},
  {id:'hub',type:'fork',choices:[action('again',{effects:[{op:'add',key:'visit',value:1}]}),action('end')],connections:{again:'linear',end:null}}
 ];
 const {deck,controller}=real(nodes,{unavailableActions:'hidden',variables:[{id:'visit',type:'number',initial:0}]},{onError:error=>errors.push(error)});deck.reduced=reduced;
 document.body=new Element();
 const target={slot:0,snapped:true,rect:{left:0,top:560,width:75,height:100}};
 const adapter={getTarget:()=>target,slotTarget:()=>target,preview(){},setContext(){},cancelPending(){},stageDeposit(){},clearDeposit(){},authorize:action=>controller.authorizeCollection(action,{slot:0})?{slot:0}:false};
 deck.pickup=new InventoryPickup(deck,adapter);
 for(const id of ['one','two']) {
  assert.equal(controller.state.cardId,id);assert.equal(controller.state.idle,true);
  if(id==='one')deck.collect();
  else {
   const gesture={axis:'y',x:0,y:180,vx:0,vy:600,clientX:30,clientY:600};
   assert.equal(deck.start(),true);deck.move(gesture);deck.end(gesture);
  }
  await flush();settle();
  assert.equal(controller.state.activeNodeId,'hub');assert.equal(controller.pendingItem,null);
  key(deck,'ArrowUp');
 }
 assert.equal(controller.state.activeNodeId,'hub','fully exhausted Linear skips back to its next connection');
 assert.deepEqual(controller.state.collectedItems.map(item=>item.definitionId),['one','two']);assert.deepEqual(errors,[]);
 controller.restart();settle();assert.equal(controller.state.cardId,'one');assert.equal(controller.state.collectedItems.length,0);
 dispose(deck,controller);
});

test('Linear collection removes only that placement and preserves story replay',()=>{
 const nodes=[{id:'linear',type:'linear',cards:[narrative('story'),item('shared')],connections:{next:'other'}},
  {id:'other',type:'linear',cards:[item('shared')],connections:{next:'linear'}}];
 const {deck,controller}=real(nodes);
 key(deck,'ArrowUp');deck.collect();settle();assert.equal(controller.state.activeNodeId,'other','same ID in another node stays available');
 assert.equal(deck.content.actions[0].collectDisabled,true,'another placement of an owned item cannot be collected');
 deck.discard();settle();assert.equal(controller.state.cardId,'story');assert.equal(deck.content.nextDeckPreview.content.actions[0].collectDisabled,true,'preview keeps the uncollected owned placement unavailable');
 key(deck,'ArrowUp');assert.equal(controller.state.activeNodeId,'other');deck.discard();settle();assert.equal(controller.state.cardId,'story','narrative remains replayable while collected placements stay removed');
 dispose(deck,controller);
});

test('Linear item self-loop excludes collected items but permits revisiting a discarded item',()=>{
 const {deck,controller}=real([{id:'linear',type:'linear',cards:[item('one'),item('two')],connections:{next:'linear'}}]);
 deck.collect();settle();assert.equal(controller.state.cardId,'two');
 assert.equal(deck.content.actions[0].collectDisabled,true,'exhausting a closed automatic cycle remains blocked');
 assert.equal(controller.departureBlocked(controller.card(),controller.location,controller.variables,controller.inventory,'collect'),true);
 assert.equal(deck.content.actions[0].discardDisabled,false);
 deck.discard();settle();assert.equal(controller.state.cardId,'two');
 dispose(deck,controller);
});

for(const reduced of [false,true])test(`caption returns with the discarded item while the taken item stays removed, reduced=${reduced}`,()=>{
 const {deck,controller}=real([
  {id:'linear',type:'linear',cards:[{...narrative('caption'),kind:'caption'},item('one'),item('two')],connections:{next:'next'}},
  {id:'next',type:'linear',cards:[narrative('next')],connections:{next:'linear'}}
 ]);deck.reduced=reduced;
 key(deck,'ArrowUp');assert.equal(controller.state.cardId,'one');
 deck.collect();settle();assert.equal(controller.state.cardId,'two');
 deck.discard();settle();assert.equal(controller.state.activeNodeId,'next');
 key(deck,'ArrowUp');assert.equal(controller.state.cardId,'caption');
 assert.equal(deck.content.nextDeckPreview.content.actions[0].id,'two');
 key(deck,'ArrowUp');assert.equal(controller.state.cardId,'two');
 assert.equal(controller.authorizeCollection({id:'two'},{slot:1}),true);
 deck.collect();settle();assert.deepEqual(controller.state.collectedItems.map(item=>item.definitionId),['one','two']);
 key(deck,'ArrowUp');assert.equal(controller.state.cardId,'caption');
 key(deck,'ArrowUp');assert.equal(controller.state.activeNodeId,'next','both taken items stay removed');
 dispose(deck,controller);
});

test('an item-only Linear replays discarded items and skips only after collection',()=>{
 const {deck,controller}=real([
  {id:'linear',type:'linear',cards:[item('one')],connections:{next:'next'}},
  {id:'next',type:'linear',cards:[narrative('next')],connections:{next:'linear'}}
 ]);
 for(let visit=0;visit<2;visit++) {
  assert.equal(controller.state.cardId,'one');deck.discard();settle();
  assert.equal(controller.state.activeNodeId,'next');key(deck,'ArrowUp');
 }
 deck.collect();settle();assert.equal(controller.state.activeNodeId,'next');
 key(deck,'ArrowUp');assert.equal(controller.state.activeNodeId,'next','exhausted item-only node follows its connection');
 dispose(deck,controller);
});

for(const reduced of [false,true])test(`mixed Linear cards keep one open action/item face and ordered successors, reduced=${reduced}`,()=>{
 const {deck,controller}=real(linear([narrative('event'),action('act',{costs:[{source:'variable',key:'energy',amount:2}],effects:[{op:'add',key:'energy',value:1}]}),item('apple',{onCollect:[{op:'add',key:'energy',value:3}]}),{...narrative('caption'),kind:'caption'}]),{variables:energy});deck.reduced=reduced;
 assert.equal(deck.phase,'closed');assert.equal(deck.content.nextDeckPreview.presentation,'open');assert.equal(deck.content.nextDeckPreview.content.actions[0].id,'act');
 key(deck,'ArrowUp');assert.equal(controller.state.cardId,'act');assert.equal(deck.phase,'choices');assert.equal(deck.content.directAdvance,false);assert.equal(deck.content.actions.length,1);assert.equal(deck.content.actions[0].cardKind,'action');assert.equal(deck.content.actions[0].actionEnergyCost,2);assert.equal(deck.content.actions[0].summary,'Effects: Add 1 energy');
 key(deck,'ArrowUp');assert.equal(controller.state.cardId,'apple');assert.equal(controller.state.variables.energy,3);assert.equal(deck.phase,'choices');assert.equal(deck.content.interaction,'container');assert.equal(deck.content.actions.length,1);assert.equal(deck.content.nextDeckPreview,undefined);
 deck.collect();if(!reduced){assert.equal(controller.state.collectedItems.length,0);assert.equal(controller.state.variables.energy,3);assert.equal(controller.state.cardId,'apple');}settle();
 assert.equal(controller.state.cardId,'caption');assert.equal(controller.state.variables.energy,6);assert.equal(controller.state.collectedItems[0].definitionId,'apple');assert.equal(deck.phase,'closed');key(deck,'ArrowUp');assert.equal(controller.state.completed,true);dispose(deck,controller);
});

for(const total of [1,6])test(`Linear check outcome ${total} spends costs before rolling and follows the same ordered successor`,async()=>{
 let resolve,feedback;const results=[];
 const {deck,controller}=real(linear([action('roll',{resolution:'check',check:{pool:[{sides:6,count:1}],target:4},costs:[{source:'variable',key:'energy',amount:2}],effects:[{op:'add',key:'energy',value:1}],successEffects:[{op:'add',key:'energy',value:5}],failureEffects:[{op:'add',key:'energy',value:2}]}),narrative('after')]),{variables:energy},{rollCheck:()=>new Promise(r=>resolve=r),onCheckResult:r=>{results.push(r);return new Promise(r=>feedback=r);}});
 assert.equal(deck.content.nextDeckPreview,undefined);assert.equal(deck.content.nextCardPreview,undefined);deck.commit();settle();assert.equal(controller.state.checking,true);assert.equal(controller.state.variables.energy,2);resolve(total);await flush();assert.equal(controller.state.variables.energy,2);assert.equal(controller.state.cardId,'roll');feedback();await flush();settle();
 assert.equal(results[0].success,total>=4);assert.equal(controller.state.variables.energy,total>=4?8:5);assert.equal(controller.state.cardId,'after');assert.equal(deck.phase,'closed');dispose(deck,controller);
});

test('cancelled Linear check restores an open retry and ignores late completion',async()=>{
 const rolls=[];const {deck,controller}=real(linear([action('roll',{resolution:'check',check:{pool:[{sides:6,count:1}],target:1},costs:[{source:'variable',key:'energy',amount:1}]}),item('after')]),{variables:energy},{rollCheck:(_,options)=>new Promise(resolve=>rolls.push({resolve,signal:options.signal}))});
 deck.commit();settle();assert.equal(controller.cancelCheck(),true);settle();assert.equal(rolls[0].signal.aborted,true);assert.equal(deck.phase,'choices');assert.equal(deck.busy,false);assert.equal(controller.state.variables.energy,4);rolls[0].resolve(6);await flush();settle();assert.equal(controller.state.cardId,'roll');
 deck.commit();settle();rolls[1].resolve(6);await flush();settle();assert.equal(controller.state.cardId,'after');assert.equal(controller.state.variables.energy,3);assert.equal(deck.phase,'choices');dispose(deck,controller);
});

for(const resolution of ['collect','discard'])test(`terminal Linear item ${resolution} commits only after departure, and restart ignores stale departure`,()=>{
 const {deck,controller}=real(linear([item('apple',{onCollect:[{op:'add',key:'energy',value:2}]})]),{variables:energy});
 deck[resolution]();const stale=deck.content.id;controller.restart();settle();deck.emit('transitioncomplete',{contentId:stale,transition:resolution});assert.equal(controller.state.completed,false);assert.equal(controller.state.collectedItems.length,0);assert.equal(controller.state.variables.energy,4);
 deck[resolution]();assert.equal(controller.state.completed,false);assert.equal(controller.state.collectedItems.length,0);assert.equal(controller.state.variables.energy,4);settle();assert.equal(controller.state.completed,true);assert.equal(deck.phase,'ended');assert.equal(controller.state.collectedItems.length,resolution==='collect'?1:0);assert.equal(controller.state.variables.energy,resolution==='collect'?6:4);dispose(deck,controller);
});

test('Linear unmet item conditions display a disabled card and unlock after explicit variable refresh',()=>{
 const errors=[];const {deck,controller}=real(linear([{...item('skipped'),conditions:[{source:'variable',key:'energy',op:'gte',value:10}]},action('disabled',{costs:[{source:'variable',key:'energy',amount:5}]}),narrative('after')]),{variables:energy},{onError:e=>errors.push(e)});
 assert.equal(controller.state.cardId,'skipped');assert.equal(deck.phase,'choices');assert.equal(deck.content.actions[0].disabled,true);assert.equal(deck.content.nextDeckPreview,undefined);assert.equal(errors.length,0);key(deck,'ArrowUp');assert.equal(controller.state.cardId,'skipped');
 controller.variables.energy=10;controller.show({restore:true});settle();assert.equal(deck.content.actions[0].disabled,false);deck.discard();settle();assert.equal(controller.state.cardId,'disabled');key(deck,'ArrowUp');assert.equal(controller.state.cardId,'after');assert.equal(controller.state.variables.energy,5);dispose(deck,controller);
});

test('Linear item take and discard route using resolved state without speculative random draws',()=>{
 for(const resolution of ['collect','discard']) {
 let draws=0;const nodes=[{id:'linear',type:'linear',cards:[item('apple')],connections:{next:'random'}},{id:'random',type:'random',routes:[{id:'owned',weight:1,target:'owned',conditions:[{source:'inventory',key:'apple',op:'has'}]}],fallback:'empty'},{id:'owned',type:'linear',cards:[narrative('owned')]},{id:'empty',type:'linear',cards:[narrative('empty')]}];
 const {deck,controller}=real(nodes,{}, {rng:()=>{draws++;return 0;}});assert.equal(draws,0);assert.equal(deck.content.nextDeckPreview,undefined);deck[resolution]();assert.equal(controller.state.collectedItems.length,0);settle();assert.equal(controller.state.cardId,resolution==='collect'?'owned':'empty');assert.equal(draws,resolution==='collect'?1:0);dispose(deck,controller);
 }
});

test('failed Linear collection is atomic and restores the same open item for discard',()=>{
 const errors=[];const {deck,controller}=real(linear([item('apple',{onCollect:[{op:'add',key:'unknown',value:1}]}),narrative('after')]),{}, {onError:e=>errors.push(e)});
 deck.collect();settle();assert.equal(errors.length,1);assert.equal(controller.state.cardId,'apple');assert.equal(controller.state.collectedItems.length,0);assert.equal(controller.state.idle,true);assert.equal(deck.phase,'choices');deck.discard();settle();assert.equal(controller.state.cardId,'after');assert.equal(controller.state.collectedItems.length,0);dispose(deck,controller);
});

test('failed Linear roller restores an unchanged open check with retry',async()=>{
 let attempts=0;const errors=[];const {deck,controller}=real(linear([action('roll',{resolution:'check',check:{pool:[{sides:6,count:1}],target:1},costs:[{source:'variable',key:'energy',amount:1}]}),narrative('after')]),{variables:energy},{rollCheck:async()=>{if(++attempts===1)throw new Error('roller failed');return 6;},onError:e=>errors.push(e)});
 deck.commit();await flush();settle();assert.equal(errors.length,1);assert.equal(controller.state.cardId,'roll');assert.equal(controller.state.variables.energy,4);assert.equal(deck.phase,'choices');assert.equal(controller.state.checking,false);deck.commit();await flush();settle();assert.equal(controller.state.cardId,'after');assert.equal(controller.state.variables.energy,3);dispose(deck,controller);
});


function reverseDepth(deck) {return Number(deck.underlayBack.style.transform.match(/translate3d\([^,]+,[^,]+,([\d.-]+)px\)/)[1]);}
for(const openSuccessor of [false,true])test(`actual Linear take recedes its underlying back like container followers and carries depth into successor, open=${openSuccessor}`,()=>{
 const next=openSuccessor?item('after'):narrative('after');
 const standalone=real(linear([item('apple'),next]));
 const container=real([{id:'box',type:'container',introEnabled:false,items:[item('apple'),item('other')],connections:{next:null}}]);
 const d=standalone.deck,c=container.deck;
 const start=cardPose(c,1,now).z;
 // Compare painted geometry explicitly; gesture RAF timing has separate coverage.
 for(const deck of [d,c]){deck.start();deck.move({axis:'y',x:0,y:100,vx:0,vy:0});deck.render();}
 const recession=cardPose(c,1,now).z-start;
 assert.ok(recession<0);assert.ok(Math.abs(reverseDepth(d)-(-24+recession))<1e-8,'real Linear reverse follows container follower depth');
 const transform=d.underlayBack.style.transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px,([-\d.]+)px\)/);
 const underlay={x:Number(transform[1]),y:Number(transform[2]),z:Number(transform[3]),turn:180,turnAxis:d.settings.flipAxisTilt,face:180};
 const baseline={...underlay,y:0,z:-24};
 assert.ok(underlay.y<0,'receding reverse shifts upward');
 assert.ok(Math.abs(projectedBounds(underlay,340,453,d.settings.perspective).top-projectedBounds(baseline,340,453,d.settings.perspective).top)<1e-7,'reverse top edge is stationary');
 const held=reverseDepth(d);
 d.cancel();settle();assert.equal(d.nextTakeDepth,0);assert.equal(reverseDepth(d),-24,'cancel restores the back');
 d.start();d.move({axis:'y',x:0,y:100,vx:0,vy:0});d.render();assert.equal(reverseDepth(d),held);
 d.end({axis:'y',x:0,y:100,vx:0,vy:600});
 while(d.collectMotion){now+=1;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));}
 assert.ok(d.n.x>1,'installed successor retains the receded depth');
 const incoming=openSuccessor?cardPose(d,0,now):scenePose(d,now);
 assert.ok(Math.abs(incoming.z-((openSuccessor?-36:-24)-453*.4))<1e-6,'successor has no depth jump');
 assert.ok(incoming.y<0,'successor retains upward compensation');
 const uncompensated={...incoming,y:0,z:openSuccessor?-36:-24};
 assert.ok(Math.abs(projectedBounds(incoming,340,453,d.settings.perspective).top-projectedBounds(uncompensated,340,453,d.settings.perspective).top)<1e-6,'incoming top starts anchored');
 settle();assert.equal(d.n.x,0);assert.equal(d.nextTakeDepth,0);assert.equal(standalone.controller.state.cardId,'after');
 dispose(d,standalone.controller);c.cancel();dispose(c,container.controller);
});

for(const resize of [false,true])test(`last Linear deposit keeps feedback before its successor without awaiting drawer exit, resize=${resize}`,async()=>{
 const {InventoryPickup}=await import('../engine/InventoryPickup.js');
 const {deck,controller}=real([{id:'linear',type:'linear',cards:[item('apple')],connections:{next:'box'}},{id:'box',type:'container',intro:narrative('box-intro'),items:[item('inside')],connections:{next:null}}]);
 document.body=new Element();
 const target={slot:0,rect:{left:0,top:560,width:75,height:100}};
 const exits=[],visibility=[];const unresolvedExit=new Promise(()=>{});
 const adapter={getTarget:()=>target,slotTarget:()=>target,preview(){},setContext(value){visibility.push(value);return value?undefined:unresolvedExit;},cancelPending(){},authorize:()=>({slot:0}),stageDeposit(){},clearDeposit(){},setExitProgress:value=>exits.push(value)};
 deck.pickup=new InventoryPickup(deck,adapter);deck.render();assert.equal(visibility.at(-1),true);
 deck.collect();await flush();
 const advance=ms=>{now+=ms;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));};
 if(resize){
   deck.mount.getBoundingClientRect=()=>({left:0,top:0,width:338,height:451});
   deck.resize.callback([{target:deck.mount}]);
   assert.equal(deck.phase,'collecting');
 }
 for(const state of deck.pickup.states){state.x=state.target;state.v=0;}
 advance(449);assert.equal(controller.state.activeNodeId,'linear');
 advance(1);assert.equal(deck.collectMotion,null,'collection feedback ends at 450ms');
 assert.deepEqual(exits,[],'visual exit has no engine progress clock');
 settle();assert.equal(controller.state.activeNodeId,'box');assert.equal(visibility.at(-1),false);dispose(deck,controller);
});

for(const type of ['linear','container'])for(const resize of [false,true])test(`${type} discard reaches its successor while drawer exit is unresolved, resize=${resize}`,async()=>{
 const {InventoryPickup}=await import('../engine/InventoryPickup.js');
 const source=type==='linear'?{id:'source',type,cards:[item('apple')]}:{id:'source',type,introEnabled:false,items:[item('apple'),item('other')]};
 source.connections={next:'box'};
 const {deck,controller}=real([source,{id:'box',type:'container',intro:narrative('box-intro'),items:[item('inside')],connections:{next:null}}]);
 const exits=[],visibility=[];const unresolvedExit=new Promise(()=>{});
 deck.pickup=new InventoryPickup(deck,{preview(){},setContext(value){visibility.push(value);return value?undefined:unresolvedExit;},cancelPending(){},setExitProgress:value=>exits.push(value)});
 deck.render();assert.equal(visibility.at(-1),true);deck.discard();
 if(resize){
  deck.mount.getBoundingClientRect=()=>({left:0,top:0,width:338,height:451});deck.resize.callback([{target:deck.mount}]);
 }
 settle();assert.equal(controller.state.activeNodeId,'box');assert.equal(visibility.at(-1),false);
 assert.deepEqual(exits,[],'discard never drives an exit animation');
 assert.equal(controller.state.collectedItems.length,0);dispose(deck,controller);
});


for(const reduced of [false,true])for(const type of ['container','linear'])for(const count of (type==='linear'?[1]:[1,3]))test(`full drawer swaps in place: ${type}, count=${count}, reduced=${reduced}`,async()=>{
 const {InventoryPickup}=await import('../engine/InventoryPickup.js');
 const source=Array.from({length:count},(_,i)=>item(`incoming-${i}`,{onCollect:[{op:'add',key:'energy',value:1}]}));
 const original=structuredClone(source),errors=[];
 const node={id:'items',type,introEnabled:false,...(type==='linear'?{cards:source}:{items:source}),connections:{next:false}};
 const {deck,controller}=real([node],{variables:energy},{onError:e=>errors.push(e)});deck.reduced=reduced;
 document.body=new Element();
 const target={slot:1,snapped:true,rect:{left:85,top:560,width:75,height:100}};
 const staged=[],cleared=[];let currentSlot="b";
 const adapter={getTarget:()=>target,slotTarget:()=>target,preview(){},setContext(){},cancelPending(){},stageDeposit:(a,d)=>{staged.push([a,d]);currentSlot=a.definitionId;},clearDeposit:()=>cleared.push(true),
  authorize:action=>{const decision={slot:1,replacementId:currentSlot,returnToStack:true};return controller.authorizeCollection(action,decision)?decision:false;},
  exchange:(action,decision)=>controller.exchangeCollection(action,decision)};
 deck.pickup=new InventoryPickup(deck,adapter);
 controller.inventory=['a','b','c','d'].map(id=>item(`owned-${id}`,{definitionId:id,conditions:[{source:'variable',key:'energy',op:'gte',value:99}]}));
 controller.show({restore:true});settle();cleared.length=0;
 if(count===3)key(deck,'ArrowRight');
 const index=deck.index,placement=deck.content.actions[index].id,articles=[...deck.cards],layers=[...deck.cardLayers];
 const gesture={axis:'y',x:0,y:260,vx:0,vy:600,clientX:115,clientY:600};
 const rest=cardPose(deck,index);
 for(let exchange=0;exchange<2;exchange++) {
  assert.equal(deck.start(),true);deck.move(gesture);
  const held=deck.cards.map((_,i)=>cardPose(deck,i));
  deck.end(gesture);await flush();
  assert.equal(deck.collectMotion,null,'swap never enters final collection or routing');
  if(!reduced)assert.ok(deck.itemReturn,'swap uses the separate item return-scale easing');
  assert.equal(controller.pendingItem,null);assert.equal(controller.stagedDestination,null);
  assert.equal(deck.index,index);assert.deepEqual(deck.cards,articles);assert.deepEqual(deck.cardLayers,layers);
  assert.equal(deck.content.actions[index].id,placement,'runtime slot identity is stable');
  assert.equal(deck.content.actions[index].definitionId,exchange===0?'b':source[index].definitionId);
  if(!reduced)for(let i=0;i<deck.cards.length;i++)for(const field of ['x','y','z'])assert.ok(Math.abs(cardPose(deck,i)[field]-held[i][field])<1e-8,'release preserves held stack position');
  if(!reduced) {
   assert.equal(deck.start(),false,'return is protected from immediate re-grab');
   deck.key({key:'ArrowRight',preventDefault(){}});assert.equal(deck.index,index);
   deck.collect();assert.equal(deck.collectMotion,null);
  }
  settle();
  assert.equal(controller.pendingExchange,null);
  for(const field of ['x','y','z'])assert.ok(Math.abs(cardPose(deck,index)[field]-rest[field])<1e-8,'returned card settles in original position');
  assert.equal(controller.inventory.length,4);assert.equal(controller.location.node.id,'items');
  assert.equal(controller.items().length,type==='container'?count:0);
  if(type==='linear')assert.equal(controller.card().definitionId,exchange===0?'b':source[index].definitionId);
 }
 assert.equal(staged.length,2);assert.equal(cleared.length,0,'accepted mini survives the return');
 assert.equal(controller.variables.energy,5,'ordinary collection effects run once per collected item');
 assert.deepEqual(source,original,'authored cards remain untouched');assert.deepEqual(errors,[]);
 controller.restart();settle();assert.equal(controller.itemReplacements.size,0);assert.equal(controller.inventory.length,0);
 dispose(deck,controller);
});

test('failed swap keeps ownership and runtime placement unchanged',async()=>{
 const {InventoryPickup}=await import('../engine/InventoryPickup.js');
 const incoming=item('incoming',{onCollect:[{op:'add',key:'missing',value:1}]});
 const errors=[];
 const {deck,controller}=real([{id:'box',type:'container',introEnabled:false,items:[incoming],connections:{next:null}}],{},{onError:e=>errors.push(e)});
 deck.pickup=new InventoryPickup(deck,{setContext(){},preview(){},cancelPending(){},clearDeposit(){}});
 controller.inventory=['a','b','c','d'].map(id=>item(id));
 const before=[...controller.inventory],article=deck.cards[0];
 assert.equal(controller.exchangeCollection(deck.content.actions[0],{slot:1,replacementId:'b',returnToStack:true}),false);
 assert.deepEqual(controller.inventory,before);assert.equal(deck.cards[0],article);assert.equal(controller.itemReplacements.size,0);
 assert.ok(errors.length);dispose(deck,controller);
});

for(const hidden of [false,true])test(`swap reconciles dependent cards and survives restart callbacks, hidden=${hidden}`,async()=>{
 const {InventoryPickup}=await import('../engine/InventoryPickup.js');
 const incoming=item('key');
 const dependent=item('locked',{conditions:[{source:'inventory',key:'key',op:'has'}]});
 const lost=item('needs-old',{conditions:[{source:'inventory',key:'old',op:'has'}]});
 const {deck,controller}=real([{id:'box',type:'container',introEnabled:false,items:[incoming,dependent,lost],connections:{next:null}}],{unavailableActions:'hidden'});
 deck.pickup=new InventoryPickup(deck,{setContext(){},preview(){},cancelPending(){},stageDeposit(){},clearDeposit(){}});
 controller.inventory=['old','b','c','d'].map(id=>item(id));controller.show({restore:true});settle();
 assert.deepEqual(deck.content.actions.map(a=>a.id),['key','needs-old']);
 document.hidden=hidden;
 assert.equal(controller.exchangeCollection(deck.content.actions[0],{slot:0,replacementId:'old',returnToStack:true}),true);
 settle();
 assert.deepEqual(deck.content.actions.map(a=>a.id),['key','locked']);
 assert.equal(deck.content.actions[0].definitionId,'old');
 assert.equal(controller.pendingExchange,null);
 let restarted=false;
 controller.onChange=state=>{if(!restarted&&state.collectedItems.some(i=>i.definitionId==='old')){restarted=true;controller.restart();}};
 assert.equal(controller.exchangeCollection(deck.content.actions[0],{slot:0,replacementId:'key',returnToStack:true}),true);
 settle();
 assert.equal(restarted,true);assert.equal(controller.inventory.length,0);assert.equal(controller.itemReplacements.size,0);
 assert.equal(deck.content.actions[0].definitionId,'key');
 document.hidden=false;dispose(deck,controller);
});


test('swap after ordinary collection preserves survivor order and orbit positions',async()=>{
 const {InventoryPickup}=await import('../engine/InventoryPickup.js');
 const source=Array.from({length:6},(_,i)=>item(`i-${i}`));
 const {deck,controller}=real([{id:'box',type:'container',introEnabled:false,items:source,connections:{next:null}}]);
 // Ordinary collection rearranges survivors by their painted rank.
 key(deck,'ArrowRight');deck.collect();settle();
 assert.notDeepEqual(deck.content.actions.map(a=>a.id),controller.items().map(a=>a.id));
 deck.pickup=new InventoryPickup(deck,{setContext(){},preview(){},cancelPending(){},stageDeposit(){},clearDeposit(){}});
 controller.inventory.push(...['b','c','d'].map(id=>item(id)));
 key(deck,'ArrowRight');
 const order=deck.content.actions.map(a=>a.id),articles=[...deck.cards],index=deck.index,browse=deck.b.x;
 const before=deck.cards.map((_,i)=>cardPose(deck,i));
 assert.equal(controller.exchangeCollection(deck.content.actions[index],{slot:1,replacementId:'b',returnToStack:true}),true);settle();
 assert.deepEqual(deck.content.actions.map(a=>a.id),order);assert.deepEqual(deck.cards,articles);
 assert.equal(deck.index,index);assert.equal(deck.b.x,browse);
 for(let i=0;i<deck.cards.length;i++)for(const field of ['x','y','z'])assert.ok(Math.abs(cardPose(deck,i)[field]-before[i][field])<1e-8);
 dispose(deck,controller);
});

for(const type of ['container','linear'])for(const retain of [undefined,true,false])for(const reduced of [false,true])test(`returned item revisit policy: ${type}, retain=${retain}, reduced=${reduced}`,async()=>{
 const {InventoryPickup}=await import('../engine/InventoryPickup.js');
 const node={id:'items',type,introEnabled:false,...(type==='container'?{items:[item('incoming'),item('original')]}:{cards:[item('incoming'),narrative('tail')]}),connections:{next:'return'}};
 if(retain!==undefined)node.retainInventoryItems=retain;
 const authored=structuredClone(node),errors=[];
 const {deck,controller}=real([node,{id:'return',type:'linear',cards:[narrative('return')],connections:{next:'items'}}],{},{onError:e=>errors.push(e)});deck.reduced=reduced;
 deck.pickup=new InventoryPickup(deck,{setContext(){},preview(){},cancelPending(){},stageDeposit(){},clearDeposit(){}});
 controller.inventory=['old','b','c','d'].map(id=>item(id));
 assert.equal(controller.exchangeCollection(deck.content.actions[0],{slot:0,replacementId:'old',returnToStack:true}),true);settle();
 assert.equal(deck.content.actions[0].definitionId,'old','checkbox never changes the immediate second chance');
 key(deck,'ArrowUp');
 if(type==='linear'){assert.equal(controller.card().id,'tail');key(deck,'ArrowUp');}
 assert.equal(controller.location.node.id,'return');key(deck,'ArrowUp');
 const persists=retain??type==='container';
 assert.equal(controller.location.node.id,'items');
 if(type==='container')assert.deepEqual(deck.content.actions.map(a=>a.definitionId),persists?['old','original']:['original']);
 else assert.equal(controller.card().id,persists?'incoming':'tail');
 if(type==='linear'&&persists)assert.equal(controller.card().definitionId,'old');
 assert.equal(controller.inventory.some(i=>i.definitionId==='incoming'),true);
 assert.equal(controller.inventory.some(i=>i.definitionId==='old'),false);
 assert.deepEqual(node,authored);assert.deepEqual(errors,[]);dispose(deck,controller);
});

for(const type of ['container','linear'])test(`transient returns are excluded from staged self-loop: ${type}`,async()=>{
 const {InventoryPickup}=await import('../engine/InventoryPickup.js');
 const node={id:'items',type,retainInventoryItems:false,introEnabled:false,...(type==='container'?{items:[item('incoming'),item('original')]}:{cards:[item('incoming'),narrative('tail')]}),connections:{next:'items'}};
 const {deck,controller}=real([node]);
 deck.pickup=new InventoryPickup(deck,{setContext(){},preview(){},cancelPending(){},stageDeposit(){},clearDeposit(){}});
 controller.inventory=['old','b','c','d'].map(id=>item(id));
 assert.equal(controller.exchangeCollection(deck.content.actions[0],{slot:0,replacementId:'old',returnToStack:true}),true);settle();
 key(deck,'ArrowUp');
 if(type==='linear'){assert.equal(controller.card().id,'tail');key(deck,'ArrowUp');assert.equal(controller.card().id,'tail');}
 else assert.deepEqual(deck.content.actions.map(a=>a.id),['original']);
 assert.equal(controller.itemReplacements.get('items:').has('incoming'),false);
 assert.equal(controller.remaining.get('items:').some(i=>i.id==='incoming'),false);
 dispose(deck,controller);
});

test('blocked or canceled departure preserves the transient returned item',async()=>{
 const {InventoryPickup}=await import('../engine/InventoryPickup.js');
 const {deck,controller}=real([{id:'box',type:'container',retainInventoryItems:false,introEnabled:false,items:[item('incoming')],connections:{next:false}}]);
 deck.pickup=new InventoryPickup(deck,{setContext(){},preview(){},cancelPending(){},stageDeposit(){},clearDeposit(){}});
 controller.inventory=['old','b','c','d'].map(id=>item(id));
 assert.equal(controller.exchangeCollection(deck.content.actions[0],{slot:0,replacementId:'old',returnToStack:true}),true);settle();
 const gesture={axis:'y',x:0,y:-80,vx:0,vy:0};deck.start();deck.move(gesture);deck.cancel();settle();
 deck.discard();settle();assert.equal(controller.location.node.id,'box');
 assert.equal(controller.items()[0].definitionId,'old');assert.equal(controller.remaining.has('box:'),false);
 assert.equal(controller.itemReplacements.get('box:').has('incoming'),true);dispose(deck,controller);
});


test('container collection exclusions do not skip matching placements in another node',()=>{
 const {deck,controller}=real([
  {id:'box',type:'container',introEnabled:false,items:[item('shared',{definitionId:'first'})],connections:{next:'linear'}},
  {id:'linear',type:'linear',cards:[item('shared',{definitionId:'second'}),narrative('tail')],connections:{next:null}}
 ]);
 key(deck,'ArrowDown');assert.equal(controller.location.node.id,'linear');
 assert.equal(controller.card().definitionId,'second');assert.equal(deck.content.actions[0].definitionId,'second');
 dispose(deck,controller);
});

for(const type of ['container','linear'])for(const alias of [false,true])test(`visible owned items resist collection but permit leaving: ${type}, alias=${alias}`,()=>{
 const duplicate=item('placement',{definitionId:alias?'alternate':'owned',inventoryKey:'shared-key',onCollect:[{op:'add',key:'energy',value:9}]});
 const node={id:'items',type,introEnabled:false,...(type==='container'?{items:[duplicate]}:{cards:[duplicate]}),connections:{next:'after'}};
 const errors=[];const {deck,controller}=real([node,{id:'after',type:'linear',cards:[narrative('after')],connections:{next:null}}],{variables:energy},{onError:e=>errors.push(e)});
 controller.inventory=[item('owned',{inventoryKey:'shared-key'})];controller.show({restore:true});settle();
 assert.equal(deck.content.actions[0].collectDisabled,true);assert.equal(deck.content.actions[0].alreadyOwned,true);
 assert.equal(deck.content.actions[0].discardDisabled,false);assert.equal(deck.cards[0].getAttribute('aria-disabled'),'true');
 key(deck,'ArrowDown');assert.equal(controller.location.node.id,'items');assert.equal(controller.variables.energy,4);
 const gesture={axis:'y',x:0,y:260,vx:0,vy:700};assert.equal(deck.start(),true);deck.move(gesture);deck.end(gesture);settle();
 assert.equal(controller.variables.energy,4);assert.equal(controller.inventory.length,1);assert.equal(controller.pendingItem,null);
 assert.equal(controller.authorizeCollection(duplicate,{}),false);
 controller.resolveItem({contentId:deck.content.id,action:duplicate,final:true},'collect');settle();
 assert.equal(controller.variables.energy,4);assert.equal(controller.inventory.length,1);
 key(deck,'ArrowUp');assert.equal(controller.location.node.id,'after');dispose(deck,controller);
});

for(const type of ['container','linear'])test(`project hidden owned items skip fully owned nodes: ${type}`,()=>{
 const source=item('placement',{definitionId:'owned'});
 const nodes=[{id:'items',type,introEnabled:false,...(type==='container'?{items:[source]}:{cards:[source]}),connections:{next:'after'}},
  {id:'after',type:'linear',cards:[narrative('after')],connections:{next:null}}];
 const {deck,controller}=real(nodes,{ownedItemsVisibility:'hidden'});
 controller.inventory=[item('owned')];controller.adopt(controller.locate('items'),false);controller.show({restore:true});settle();
 assert.equal(controller.location.node.id,'after');assert.equal(controller.remaining.has('items:'),false,'visibility does not consume the source placement');
 controller.inventory=[];controller.adopt(controller.locate('items'),false);controller.show({restore:true});settle();
 assert.equal(controller.location.node.id,'items');assert.equal(deck.content.actions[0].collectDisabled,false);
 dispose(deck,controller);
});

for(const visibility of ['disabled','hidden'])test(`external ownership removal refreshes sibling collection availability, visibility=${visibility}`,()=>{
 const nodes=[{id:'items',type:'container',introEnabled:false,items:[item('duplicate',{definitionId:'owned'}),item('new')],connections:{next:null}}];
 const {deck,controller}=real(nodes,{ownedItemsVisibility:visibility},{initialState:{inventory:[item('owned')]}});
 assert.deepEqual(deck.content.actions.map(a=>a.id),visibility==='hidden'?['new']:['duplicate','new']);
 controller.inventory=[];controller.show({restore:true});settle();
 assert.deepEqual(deck.content.actions.map(a=>a.id),['duplicate','new']);assert.equal(deck.content.actions[0].collectDisabled,false);
 key(deck,'ArrowDown');assert.equal(controller.inventory[0].definitionId,'owned');dispose(deck,controller);
});

for(const visibility of ['disabled','hidden'])test(`collecting one placement leaves its duplicate unavailable in the current carousel, visibility=${visibility}`,()=>{
 const nodes=[{id:'items',type:'container',introEnabled:false,items:[item('one',{definitionId:'owned'}),item('two',{definitionId:'owned'})],connections:{next:'after'}},
  {id:'after',type:'linear',cards:[narrative('after')],connections:{next:null}}];
 const {deck,controller}=real(nodes,{ownedItemsVisibility:visibility});
 key(deck,'ArrowDown');assert.equal(controller.inventory.length,1);
 assert.equal(controller.location.node.id,'items');assert.equal(deck.content.actions[0].id,'two');assert.equal(deck.content.actions[0].collectDisabled,true);
 const gesture={axis:'y',x:0,y:260,vx:0,vy:700};
 assert.equal(deck.start(),true);deck.move(gesture);deck.end(gesture);settle();
 assert.equal(controller.inventory.length,1);assert.equal(controller.pendingItem,null);
 assert.equal(deck.content.actions[0].id,'two');assert.equal(deck.phase,'choices');
 assert.equal(controller.remaining.get('items:').some(i=>i.id==='two'),true);
 dispose(deck,controller);
});

for(const alias of [false,true])test(`container ownership hiding applies on next entry and revisit, alias=${alias}`,()=>{
 const duplicate=item('two',{definitionId:alias?'alternate':'owned',...(alias?{inventoryKey:'shared'}:{})});
 const nodes=[
  {id:'box',type:'container',introEnabled:false,items:[item('one',{definitionId:'owned',inventoryKey:'shared'}),duplicate],connections:{next:'next-box'}},
  {id:'next-box',type:'container',introEnabled:false,items:[{...duplicate,id:'next-duplicate'},item('fresh')],connections:{next:'hub'}},
  {id:'hub',type:'fork',choices:[action('again')],connections:{again:'box'}}
 ];
 const {deck,controller}=real(nodes,{ownedItemsVisibility:'hidden'});
 key(deck,'ArrowDown');
 assert.equal(controller.location.node.id,'box');assert.equal(deck.content.actions[0].id,'two');
 assert.equal(deck.content.actions[0].collectDisabled,true);assert.equal(deck.content.actions[0].discardDisabled,false);
 key(deck,'ArrowUp');
 assert.equal(controller.location.node.id,'next-box');assert.deepEqual(deck.content.actions.map(a=>a.id),['fresh']);
 key(deck,'ArrowUp');assert.equal(controller.location.node.id,'hub');
 key(deck,'ArrowUp');
 assert.equal(controller.location.node.id,'next-box','revisiting box skips its now-owned duplicate');
 assert.deepEqual(deck.content.actions.map(a=>a.id),['fresh']);
 assert.deepEqual(controller.remaining.get('box:').map(i=>i.id),['two'],'hiding never consumes the duplicate');
 dispose(deck,controller);
});

test('legacy pool container entries get independent ownership visibility snapshots',()=>{
 const sequences=[
  {id:'first',type:'container',cards:[narrative('intro-one')],items:[item('one',{definitionId:'owned'}),item('two',{definitionId:'owned'})]},
  {id:'second',type:'container',cards:[narrative('intro-two')],items:[item('three',{definitionId:'owned'}),item('fresh')]}
 ];
 const {deck,controller}=real([{id:'pool',type:'legacyPool',sequences,pool:sequences.map(s=>({sequenceId:s.id,weight:1})),count:2,connections:{next:null}}],{ownedItemsVisibility:'hidden'},{rng:()=>0});
 key(deck,'ArrowUp');key(deck,'ArrowDown');
 assert.equal(controller.location.sequence.id,'first');assert.equal(deck.content.actions[0].id,'two');
 assert.equal(deck.content.actions[0].collectDisabled,true);
 key(deck,'ArrowUp');assert.equal(controller.location.sequence.id,'second');
 assert.deepEqual(deck.content.actions.map(a=>a.id),['fresh']);
 dispose(deck,controller);
});

test('ownership granted by a container introduction leaves its carousel item unavailable',()=>{
 const node={id:'box',type:'container',intro:{...narrative('intro'),effects:[{op:'addItem',key:'owned'}]},items:[item('placement',{definitionId:'owned'})],connections:{next:null}};
 const {deck,controller}=real([node],{ownedItemsVisibility:'hidden',library:[item('owned')]});
 key(deck,'ArrowUp');
 assert.equal(controller.location.node.id,'box');assert.equal(controller.inventory.length,1);
 assert.equal(deck.content.actions[0].id,'placement');assert.equal(deck.content.actions[0].collectDisabled,true);
 key(deck,'ArrowDown');assert.equal(controller.inventory.length,1);assert.equal(deck.content.actions[0].id,'placement');
 dispose(deck,controller);
});

for(const alias of [false,true])test(`Linear skips its next duplicate immediately after collection with hidden ownership, alias=${alias}`,()=>{
 const duplicate=item('two',{definitionId:alias?'alternate':'owned',...(alias?{inventoryKey:'shared'}:{})});
 const {deck,controller}=real(linear([item('one',{definitionId:'owned',inventoryKey:'shared'}),duplicate,narrative('after')]),{ownedItemsVisibility:'hidden'});
 key(deck,'ArrowDown');
 assert.equal(controller.inventory.length,1);assert.equal(controller.card().id,'after');
 assert.equal(controller.remaining.get('linear:').some(i=>i.id==='two'),true,'skipping does not consume the duplicate');
 dispose(deck,controller);
});

for(const type of ['linear','fork'])for(const projectVisibility of ['disabled','hidden'])for(const override of [undefined,'project','disabled','hidden'])for(const requirement of ['conditions','costs'])test(`node unavailable-action policy: ${type}, project=${projectVisibility}, override=${override}, requirement=${requirement}`,()=>{
 const visibility=override && override!=='project'?override:projectVisibility;
 const unavailable=action('blocked',{unavailable:visibility==='hidden'?'disabled':'hidden',...(requirement==='conditions'?{conditions:[{source:'variable',key:'energy',op:'gte',value:7}]}:{costs:[{source:'variable',key:'energy',amount:6}]})});
 const node=type==='linear'?{id:'actions',type,cards:[unavailable,narrative('after')],connections:{next:null}}
  :{id:'actions',type,choices:[unavailable,action('available')],connections:{blocked:null,available:null}};
 if(override!==undefined)node.unavailableActions=override;
 const {deck,controller}=real([node],{variables:energy,unavailableActions:projectVisibility});
 if(type==='linear'&&visibility==='hidden')assert.equal(controller.card().id,'after');
 else {
  assert.equal(deck.content.actions.some(a=>a.id==='blocked'),visibility==='disabled');
  if(visibility==='disabled'){assert.equal(deck.content.actions[0].disabled,true);key(deck,'ArrowUp');assert.equal(controller.location.node.id,'actions');assert.equal(controller.variables.energy,4);}
 }
 dispose(deck,controller);
});


test('hidden owned container items can be made available by their introduction',()=>{
 const node={id:'items',type:'container',intro:{...narrative('intro'),effects:[{op:'removeItem',key:'owned'}]},items:[item('placement',{definitionId:'owned'})],connections:{next:null}};
 const {deck,controller}=real([node],{ownedItemsVisibility:'hidden'});
 controller.inventory=[item('owned')];controller.adopt(controller.locate('items'),false);controller.show({restore:true});settle();
 assert.equal(controller.location.node.id,'items');assert.equal(controller.completed,false);assert.equal(deck.open,false);
 key(deck,'ArrowUp');assert.equal(controller.inventory.length,0);assert.equal(deck.content.actions[0].id,'placement');
 assert.equal(deck.content.actions[0].collectDisabled,false);dispose(deck,controller);
});

test('owned-item hiding detects an automatic cycle without consuming sources or inventory',()=>{
 const node={id:'items',type:'container',introEnabled:false,items:[item('placement',{definitionId:'owned'})],connections:{next:'items'}};
 const {deck,controller}=real([node],{ownedItemsVisibility:'hidden'});controller.inventory=[item('owned')];
 assert.throws(()=>controller.locate('items'),/Automatic routing cycle/);
 assert.equal(controller.inventory.length,1);assert.equal(controller.remaining.size,0);dispose(deck,controller);
});


for(const visibility of ['disabled','hidden'])test(`collection effects refresh ownership of other item definitions, visibility=${visibility}`,()=>{
 const nodes=[{id:'items',type:'container',introEnabled:false,items:[item('prize',{onCollect:[{op:'addItem',key:'owned'}]}),item('duplicate',{definitionId:'owned',onCollect:[{op:'add',key:'energy',value:9}]})],connections:{next:'after'}},
  {id:'after',type:'linear',cards:[narrative('after')],connections:{next:null}}];
 const {deck,controller}=real(nodes,{ownedItemsVisibility:visibility,variables:energy,library:[item('owned')]});
 key(deck,'ArrowDown');assert.deepEqual(controller.inventory.map(i=>i.definitionId),['prize','owned']);assert.equal(controller.variables.energy,4);
 assert.equal(controller.location.node.id,'items');
 assert.equal(deck.content.actions[0].collectDisabled,true);key(deck,'ArrowDown');assert.equal(controller.variables.energy,4);
 dispose(deck,controller);
});

for(const visibility of ['disabled','hidden'])for(const drawer of [false,true])test(`collecting one visor upgrade preserves survivor cards and drawer presentation: visibility=${visibility}, drawer=${drawer}`,async()=>{
 const {InventoryPickup}=await import('../engine/InventoryPickup.js');
 const items=[item('lockpick'),item('mackerels'),item('visor-one',{definitionId:'visor'}),item('visor-two',{definitionId:'visor'}),item('flashlight'),item('battery')];
 const {deck,controller}=real([{id:'box',type:'container',introEnabled:false,items,connections:{next:null}}],{ownedItemsVisibility:visibility});
 const contexts=[];
 if(drawer) {
  document.body=new Element();const target={slot:0,snapped:true,rect:{left:0,top:560,width:75,height:100}};
  deck.pickup=new InventoryPickup(deck,{getTarget:()=>target,slotTarget:()=>target,preview(){},setContext:value=>contexts.push(value),cancelPending(){},stageDeposit(){},clearDeposit(){},authorize:action=>controller.authorizeCollection(action,{slot:0})?{slot:0}:false});
  deck.render();
 }
 key(deck,'ArrowRight');key(deck,'ArrowRight');assert.equal(deck.content.actions[deck.index].id,'visor-one');
 const surviving=new Map(deck.content.actions.map((action,index)=>[action.id,{card:deck.cards[index],layer:deck.cardLayers[index],title:deck.cardTitles[index]}]));
 const revision=deck.presentationRevision,contentId=deck.content.id;
 let replacements=0;const replace=deck.replaceContent.bind(deck);deck.replaceContent=(...args)=>{replacements++;return replace(...args);};
 contexts.length=0;deck.collect();await flush();settle();
 assert.equal(controller.inventory[0].definitionId,'visor');
 assert.equal(replacements,0,'changing duplicate availability must not reinstall the deck');
 assert.equal(deck.presentationRevision,revision,'collection keeps the same presentation');assert.equal(deck.content.id,contentId);
 for(let index=0;index<deck.cards.length;index++) {
  const action=deck.content.actions[index],before=surviving.get(action.id);
  assert.equal(deck.cards[index],before.card,'surviving article is retained');assert.equal(deck.cardLayers[index],before.layer,'surviving layer is retained');assert.equal(deck.cardTitles[index],before.title,'surviving face content is retained');
 }
 assert.equal(deck.content.actions.find(action=>action.id==='visor-two').collectDisabled,true);
 if(drawer)assert.equal(contexts.includes(false),false,'drawer never restarts its entrance');
 assert.equal(deck.phase,'choices');dispose(deck,controller);
});

// Resource cards use the real Action gesture path and never the inventory path.
const {createDefinition:resourceDefinition,resolvePlacement:resolveResource}=await import('../project/cards.js');
for(const kind of ['health','energy'])for(const reduced of [false,true])test(`${kind} swipe consumes once with bounds and additional effects, reduced=${reduced}`,()=>{
 const definition={...resourceDefinition(kind,`def-${kind}`),value:4,onCollect:[{op:'add',key:'bonus',value:1}]};
 const resource=resolveResource({library:[definition]},{id:`p-${kind}`,definitionId:definition.id});
 const {deck,controller}=real(linear([resource,narrative('after')]),{variables:[{id:kind,type:'number',initial:8,min:0,max:10},{id:'bonus',type:'number',initial:0}]});deck.reduced=reduced;
 assert.equal(deck.phase,'choices');assert.equal(deck.content.interaction,'choice');assert.equal(deck.content.actions[0].value,4);
 assert.equal(controller.state.variables[kind],8,'prediction does not spend or gain');
 const gesture={axis:'y',x:0,y:-10,vx:0,vy:0};assert.equal(deck.start(),true);deck.move(gesture);deck.end(gesture);settle();
 assert.equal(controller.state.cardId,resource.id);assert.equal(controller.state.variables.bonus,0,'canceled swipe applies nothing');
 key(deck,'ArrowDown');assert.equal(controller.state.cardId,resource.id,'down cannot collect or discard a resource card');
 const contentId=deck.content.id,selected=deck.content.actions[0];
 key(deck,'ArrowUp');assert.equal(controller.state.cardId,'after');assert.equal(controller.state.variables[kind],10);assert.equal(controller.state.variables.bonus,1);
 controller.commit({contentId,action:selected});assert.equal(controller.state.variables.bonus,1,'duplicate event is ignored');
 assert.deepEqual(controller.state.collectedItems,[]);
 dispose(deck,controller);
});
for(const kind of ['health','energy'])test(`${kind} cannot consume through an unlinked final output`,()=>{
 const definition={...resourceDefinition(kind,kind),value:3};const resource=resolveResource({library:[definition]},{id:'resource',definitionId:kind});
 const {deck,controller}=real([{id:'linear',type:'linear',cards:[resource],connections:{next:false}}],{variables:[{id:kind,type:'number',initial:1}]});
 assert.equal(deck.content.actions[0].disabled,true);key(deck,'ArrowUp');assert.equal(controller.state.variables[kind],1);assert.equal(controller.state.cardId,'resource');
 dispose(deck,controller);
});

for(const type of ['linear','fork'])test(`preview uses destination ${type} override instead of current node policy`,()=>{
 const blocked=action('blocked',{costs:[{source:'variable',key:'energy',amount:6}]});
 const destination={id:'destination',type,unavailableActions:'disabled',...(type==='linear'?{cards:[blocked,narrative('after')],connections:{next:null}}:{choices:[blocked,action('available')],connections:{blocked:null,available:null}})};
 const nodes=[{id:'start',type:'linear',unavailableActions:'hidden',cards:[narrative('start')],connections:{next:'destination'}},destination];
 const {deck,controller}=real(nodes,{variables:energy,unavailableActions:'hidden'});
 assert.equal(deck.content.nextDeckPreview.content.actions[0].id,'blocked');
 assert.equal(deck.content.nextDeckPreview.content.actions[0].disabled,true);
 key(deck,'ArrowUp');
 assert.equal(controller.location.node.id,'destination');
 assert.equal(deck.content.actions[0].id,'blocked');
 assert.equal(deck.content.actions[0].disabled,true);
 dispose(deck,controller);
});

for(const reduced of [false,true])for(const variant of ['unlocks-next','already-available','later-only','still-unmet'])test(`Linear predicts and commits exceptional flip only for the directly unlocked next card: ${variant}, reduced=${reduced}`,()=>{
 const requiresReady=[{source:'variable',key:'ready',op:'eq',value:true}];
 const first={...narrative('first'),effects:variant==='still-unmet'?[]:[{op:'set',key:'ready',value:true}]};
 const next={...narrative('next'),conditions:['unlocks-next','still-unmet'].includes(variant)?requiresReady:[]};
 const later={...narrative('later'),conditions:variant==='later-only'?requiresReady:[]};
 const {deck,controller}=real(linear([first,next,later]),{unavailableActions:'hidden',variables:[{id:'ready',type:'flag',initial:false}]});deck.reduced=reduced;
 const expected=variant==='unlocks-next'?'flip':'reveal';
 assert.equal(deck.content.nextTransition,expected);assert.equal(controller.variables.ready,false);
 assert.equal(deck.start(),true);deck.move({axis:'y',x:0,y:-10});deck.cancel();settle();
 assert.equal(controller.variables.ready,false);
 const transitions=[],replace=deck.replaceContent.bind(deck);
 deck.replaceContent=(content,options)=>{transitions.push(options.transition);return replace(content,options);};
 key(deck,'ArrowUp');
 assert.equal(transitions[0],expected,'actual transition matches precomputed preview');
 assert.equal(controller.variables.ready,variant!=='still-unmet');
 assert.equal(controller.state.cardId,variant==='still-unmet'?'later':'next');
 dispose(deck,controller);
});
