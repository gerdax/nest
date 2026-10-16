import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectController } from '../project/ProjectController.js';
import { ChapterController } from '../chapter/ChapterController.js';
import { createLegacyStarterChapter } from '../chapter/model.js';
const narrative=id=>({id,kind:'event',name:id,text:id,effects:[]});
const item=(id,extra={})=>({id,kind:'item',definitionId:id,name:id,onCollect:[{op:'add',key:'energy',value:10}],...extra});
const box=(items,extra={})=>({id:'box',type:'container',intro:narrative('intro'),introEnabled:false,items,connections:{next:'after'},...extra});
const after={id:'after',type:'linear',cards:[narrative('after')],connections:{next:null}};
const energy=[{id:'energy',type:'number',initial:3}];
// Browser-shaped harness verifies actual deck event order and asynchronous commits.
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
function key(deck,name){deck.key({key:name,preventDefault(){}});settle();}
function real(nodes,extra={},options={}){const deck=new CardDeck(new Element(),{content:{id:'waiting',actions:[{id:'wait',label:'Wait'}]}});const controller=new ProjectController(deck,{startNode:nodes[0].id,nodes,variables:[],library:[],...extra},options);settle();return {deck,controller};}
function dispose(deck,controller){controller.destroy();deck.destroy();settle();}


for(const reduced of [false,true])test(`leave all remaining container items preserves collected ownership and applies no reward, reduced=${reduced}`,()=>{
 const hidden=item('hidden',{conditions:[{source:'variable',key:'energy',op:'gte',value:1000}]});
 const {deck,controller}=real([box([item('taken',{onCollect:[{op:'add',key:'energy',value:1}]}),item('left'),item('also-left'),hidden]),after],{variables:energy});deck.reduced=reduced;
 assert.equal(deck.content.discardAll,true);key(deck,'ArrowDown');assert.equal(controller.state.collectedItems.length,1);assert.equal(controller.state.variables.energy,4);
 deck.discard();if(!reduced){assert.equal(controller.state.activeNodeId,'box');assert.equal(controller.remaining.has('box:'),true);assert.equal(controller.remaining.get('box:').length,3);}settle();
 assert.equal(controller.state.activeNodeId,'after');assert.deepEqual(controller.remaining.get('box:').map(item=>item.id),['left','also-left','hidden']);
 assert.deepEqual(controller.state.collectedItems.map(i=>i.definitionId),['taken']);assert.equal(controller.state.variables.energy,4);assert.equal(deck.phase,'closed');dispose(deck,controller);
});
for(const reduced of [false,true])for(const introEnabled of [false,true])test(`leaving a container preserves uncollected items on return, intro=${introEnabled}, reduced=${reduced}`,()=>{
 const {deck,controller}=real([
  box([item('taken',{onCollect:[]}),item('left',{onCollect:[]})],{introEnabled,connections:{next:'linear'}}),
  {id:'linear',type:'linear',cards:[narrative('return')],connections:{next:'box'}}
 ]);deck.reduced=reduced;
 if(introEnabled)key(deck,'ArrowUp');
 key(deck,'ArrowDown');assert.deepEqual(controller.state.collectedItems.map(item=>item.definitionId),['taken']);
 key(deck,'ArrowUp');assert.equal(controller.state.activeNodeId,'linear');
 key(deck,'ArrowUp');assert.equal(controller.state.activeNodeId,'box');
 if(introEnabled)key(deck,'ArrowUp');
 assert.deepEqual(deck.content.actions.map(item=>item.id),['left']);
 assert.equal(controller.authorizeCollection({id:'left'},{slot:1}),true);
 key(deck,'ArrowDown');assert.equal(controller.state.activeNodeId,'linear');
 key(deck,'ArrowUp');assert.equal(controller.state.activeNodeId,'linear','fully collected container skips its introduction');
 assert.deepEqual(controller.state.collectedItems.map(item=>item.definitionId),['taken','left']);
 dispose(deck,controller);
});

test('a container self-loop can be left and revisited without erasing its items',()=>{
 const {deck,controller}=real([box([item('left')],{connections:{next:'box'}})]);
 for(let visit=0;visit<2;visit++) {
  assert.equal(controller.state.activeNodeId,'box');assert.equal(deck.content.actions[0].discardDisabled,false);
  key(deck,'ArrowUp');assert.deepEqual(deck.content.actions.map(item=>item.id),['left']);
 }
 assert.equal(controller.state.collectedItems.length,0);dispose(deck,controller);
});
for(const reduced of [false,true])test(`leaving a terminal container completes and restart ignores stale departure, reduced=${reduced}`,()=>{
 const {deck,controller}=real([box([item('one'),item('two')],{connections:{next:null}})],{variables:energy});deck.reduced=reduced;
 deck.discard();controller.restart();settle();assert.equal(controller.state.completed,false);assert.equal(deck.cards.length,2);assert.equal(controller.state.variables.energy,3);
 key(deck,'ArrowUp');assert.equal(controller.state.completed,true);assert.equal(controller.state.collectedItems.length,0);assert.equal(controller.state.variables.energy,3);assert.equal(deck.phase,'ended');dispose(deck,controller);
});
test('canceled upward leave keeps all items, inventory and variables unchanged',()=>{
 const {deck,controller}=real([box([item('one'),item('two')]),after],{variables:energy});
 const gesture={axis:'y',x:0,y:-150,vx:0,vy:0};deck.start();deck.move(gesture);deck.cancel();settle();
 assert.equal(deck.cards.length,2);assert.equal(controller.state.activeNodeId,'box');assert.equal(controller.state.variables.energy,3);assert.equal(controller.state.collectedItems.length,0);dispose(deck,controller);
});
test('bulk leave routes once using existing inventory, without rewards from discarded items',()=>{
 let draws=0;
 const nodes=[box([item('key',{onCollect:[]}),item('prize')],{connections:{next:'random'}}),{id:'random',type:'random',routes:[{id:'owned',weight:1,target:'after',conditions:[{source:'inventory',key:'key',op:'has'}]}],fallback:null},after];
 const {deck,controller}=real(nodes,{variables:energy},{rng:()=>{draws++;return 0;}});
 key(deck,'ArrowDown');assert.equal(draws,0);key(deck,'ArrowUp');assert.equal(draws,1);assert.equal(controller.state.activeNodeId,'after');assert.equal(controller.state.variables.energy,3);assert.equal(controller.state.collectedItems.length,1);dispose(deck,controller);
});
test('Linear items retain individual discard rather than leaving the Linear sequence',()=>{
 const {deck,controller}=real([{id:'linear',type:'linear',cards:[item('one'),item('two'),narrative('end')],connections:{next:null}}],{variables:energy});
 assert.equal(deck.content.discardAll,false);key(deck,'ArrowUp');assert.equal(controller.state.cardId,'two');assert.equal(controller.state.completed,false);assert.equal(controller.state.variables.energy,3);dispose(deck,controller);
});
test('legacy sequence pools leave the remaining container items and resume the queued story',()=>{
 const sequences=[{id:'items',type:'container',cards:[narrative('intro')],items:[item('one'),item('two')],exits:['next']},{id:'story',type:'linear',cards:[narrative('queued')],exits:['next']}];
 const {deck,controller}=real([{id:'pool',type:'legacyPool',sequences,pool:sequences.map(s=>({sequenceId:s.id,weight:1})),count:2,connections:{next:null}}],{variables:energy},{rng:()=>0});
 key(deck,'ArrowUp');key(deck,'ArrowUp');assert.equal(controller.state.cardId,'queued');assert.equal(controller.state.collectedItems.length,0);assert.equal(controller.state.variables.energy,3);dispose(deck,controller);
});
for(const reduced of [false,true])test(`v1 chapter containers also leave all remaining items, reduced=${reduced}`,()=>{
 const deck=new CardDeck(new Element(),{content:{id:'waiting',actions:[{id:'wait',label:'Wait'}]}});
 const controller=new ChapterController(deck,createLegacyStarterChapter(),{startNode:'supplies',rng:()=>0});settle();deck.reduced=reduced;
 key(deck,'ArrowUp');key(deck,'ArrowUp');assert.equal(controller.state.activeNodeId,'encounter');assert.equal(controller.state.collectedItems.length,0);dispose(deck,controller);
});
