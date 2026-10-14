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
globalThis.ResizeObserver=class {observe(){}disconnect(){}};
function settle(){for(let i=0;frames.size&&i<2000;i++){now+=16;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));}assert.equal(frames.size,0,'motion converges');}
function key(deck,name){deck.key({key:name,preventDefault(){}});settle();}
function real(nodes,extra={},options={}){const deck=new CardDeck(new Element(),{content:{id:'waiting',actions:[{id:'wait',label:'Wait'}]}});const controller=new ProjectController(deck,{startNode:nodes[0].id,nodes,variables:[],library:[],...extra},options);settle();return {deck,controller};}
function dispose(deck,controller){controller.destroy();deck.destroy();settle();}

for(const reduced of [false,true])test(`mixed Linear cards keep one open action/item face and ordered successors, reduced=${reduced}`,()=>{
 const {deck,controller}=real(linear([narrative('event'),action('act',{costs:[{source:'variable',key:'energy',amount:2}],effects:[{op:'add',key:'energy',value:1}]}),item('apple',{onCollect:[{op:'add',key:'energy',value:3}]}),{...narrative('caption'),kind:'caption'}]),{variables:energy});deck.reduced=reduced;
 assert.equal(deck.phase,'closed');assert.equal(deck.content.nextDeckPreview.presentation,'open');assert.equal(deck.content.nextDeckPreview.content.actions[0].id,'act');
 key(deck,'ArrowUp');assert.equal(controller.state.cardId,'act');assert.equal(deck.phase,'choices');assert.equal(deck.content.directAdvance,false);assert.equal(deck.content.actions.length,1);assert.equal(deck.content.actions[0].cardKind,'action');assert.match(deck.content.actions[0].summary,/Cost/);
 key(deck,'ArrowUp');assert.equal(controller.state.cardId,'apple');assert.equal(controller.state.variables.energy,3);assert.equal(deck.phase,'choices');assert.equal(deck.content.interaction,'container');assert.equal(deck.content.actions.length,1);assert.equal(deck.content.nextDeckPreview,undefined);
 deck.collect();if(!reduced){assert.equal(controller.state.collectedItems.length,0);assert.equal(controller.state.variables.energy,3);assert.equal(controller.state.cardId,'apple');}settle();
 assert.equal(controller.state.cardId,'caption');assert.equal(controller.state.variables.energy,6);assert.equal(controller.state.collectedItems[0].definitionId,'apple');assert.equal(deck.phase,'closed');key(deck,'ArrowUp');assert.equal(controller.state.completed,true);dispose(deck,controller);
});

for(const total of [1,6])test(`Linear check outcome ${total} spends costs after feedback and follows the same ordered successor`,async()=>{
 let resolve,feedback;const results=[];
 const {deck,controller}=real(linear([action('roll',{resolution:'check',check:{pool:[{sides:6,count:1}],target:4},costs:[{source:'variable',key:'energy',amount:2}],effects:[{op:'add',key:'energy',value:1}],successEffects:[{op:'add',key:'energy',value:5}],failureEffects:[{op:'add',key:'energy',value:2}]}),narrative('after')]),{variables:energy},{rollCheck:()=>new Promise(r=>resolve=r),onCheckResult:r=>{results.push(r);return new Promise(r=>feedback=r);}});
 assert.equal(deck.content.nextDeckPreview,undefined);assert.equal(deck.content.nextCardPreview,undefined);deck.commit();settle();assert.equal(controller.state.checking,true);resolve(total);await flush();assert.equal(controller.state.variables.energy,4);assert.equal(controller.state.cardId,'roll');feedback();await flush();settle();
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

test('Linear conditions skip cards, hidden costs skip actions, and disabled costs can unlock through inventory use',()=>{
 const errors=[];const {deck,controller}=real(linear([{...item('skipped'),conditions:[{source:'variable',key:'energy',op:'gte',value:10}]},action('hidden',{unavailable:'hidden',costs:[{source:'variable',key:'energy',amount:8}]}),action('disabled',{costs:[{source:'variable',key:'energy',amount:5}]}),narrative('after')]),{variables:energy},{onError:e=>errors.push(e)});
 assert.equal(controller.state.cardId,'disabled');assert.equal(deck.phase,'choices');assert.equal(deck.content.actions[0].disabled,true);assert.equal(deck.content.nextDeckPreview,undefined);assert.equal(errors.length,1);key(deck,'ArrowUp');assert.equal(controller.state.cardId,'disabled');
 controller.inventory=[item('boost',{use:{effects:[{op:'add',key:'energy',value:2}]}})];assert.equal(controller.useItem('boost'),true);settle();assert.equal(deck.content.actions[0].disabled,false);key(deck,'ArrowUp');assert.equal(controller.state.cardId,'after');assert.equal(controller.state.variables.energy,1);dispose(deck,controller);
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
 for(const deck of [d,c]){deck.start();deck.move({axis:'y',x:0,y:100,vx:0,vy:0});}
 const recession=cardPose(c,1,now).z-start;
 assert.ok(recession<0);assert.ok(Math.abs(reverseDepth(d)-(-24+recession))<1e-8,'real Linear reverse follows container follower depth');
 const transform=d.underlayBack.style.transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px,([-\d.]+)px\)/);
 const underlay={x:Number(transform[1]),y:Number(transform[2]),z:Number(transform[3]),turn:180,turnAxis:d.settings.flipAxisTilt,face:180};
 const baseline={...underlay,y:0,z:-24};
 assert.ok(underlay.y<0,'receding reverse shifts upward');
 assert.ok(Math.abs(projectedBounds(underlay,340,453,d.settings.perspective).top-projectedBounds(baseline,340,453,d.settings.perspective).top)<1e-7,'reverse top edge is stationary');
 const held=reverseDepth(d);
 d.cancel();settle();assert.equal(d.nextTakeDepth,0);assert.equal(reverseDepth(d),-24,'cancel restores the back');
 d.start();d.move({axis:'y',x:0,y:100,vx:0,vy:0});assert.equal(reverseDepth(d),held);
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
