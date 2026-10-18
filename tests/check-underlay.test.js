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


for(const reduced of [false,true]) for(const success of [false,true]) for(const successor of ['story','fork']) test(`check waits on real underlying back then advances once, reduced=${reduced}, success=${success}, successor=${successor}`,async()=>{
 let resolveRoll,resolveFeedback,started=false,rolled=false,feedback;
 const roll=new Promise(resolve=>resolveRoll=resolve),hold=new Promise(resolve=>resolveFeedback=resolve);
 const source=action('try',{resolution:'check',check:{mode:'stat',modifierVariable:'composure',difficulty:3},costs:[{source:'variable',key:'energy',amount:1}],successEffects:[{op:'add',key:'composure',value:1}]});
 const nodes=[{id:'fork',type:'fork',choices:[source,action('other')],connections:{'try:success':'win','try:failure':'lose',other:null}},
 ...['win','lose'].map(id=>successor==='fork'?{id,type:'fork',introEnabled:false,choices:[action(id)],connections:{[id]:null}}:{id,type:'linear',cards:[narrative(id)],connections:{next:null}})];
 let deck;
 const current=real(nodes,{variables:[...energy,{id:'composure',type:'number',initial:3,min:1,max:10,stat:true}]},{
  rollCheck:async(_,options)=>{started=true;const slot=await deck.waitForCheckSurface({...options,prepare:slot=>{assert.equal(slot.hidden,false);assert.equal(options.target,13);}});assert.equal(slot,deck.underlayBack.checkSlot);rolled=true;return roll;},
  onCheckResult:result=>{feedback=result;return hold;}
 });
 deck=current.deck;const controller=current.controller;deck.reduced=reduced;
 // Prepare the same target during the initial swipe, before commitment.
 const {stageNextBack,renderDeck}=await import('../engine/renderer.js');
 stageNextBack(deck);renderDeck(deck);
 assert.equal(deck.underlayBack.checkPreview.textContent,'Target: 13');
 assert.equal(deck.underlayBack.checkPreview.hidden,false);
 deck.commit();assert.equal(started,true);assert.equal(rolled,false);assert.equal(controller.state.checking,true);
 settle();await flush();assert.equal(rolled,true);assert.equal(deck.checkSurface.ready,true);
 assert.equal(deck.underlayBack.checkSlot.hidden,false);assert.equal(deck.underlayBack.style.visibility,'visible');
 assert.ok(deck.cards.every((_,index)=>cardPose(deck,index).visible===false));
 assert.equal(deck.pending,null);assert.equal(controller.state.variables.energy,4);
 deck.finishMotion();await flush();assert.equal(controller.state.checking,true);assert.equal(deck.pending,null);
 resolveRoll(success?[4,4,4]:[1,1,1]);await flush();assert.equal(feedback.success,success);assert.equal(feedback.total,success?15:6);assert.equal(controller.state.variables.composure,3);assert.equal(controller.state.variables.energy,4);
 assert.equal(controller.state.activeNodeId,'fork');
 const surface=deck.checkSurface, slot=surface.slot, background=surface.back.style.backgroundImage;
 resolveFeedback();await flush();
 if(!reduced){
   assert.equal(deck.checkSurface,surface,'check surface survives successor installation');
   assert.equal(surface.turning,true);
   assert.equal(surface.slot,slot);
   assert.equal(slot.parentNode,deck.content.decisionOnly?deck.cardBacks[deck.index]:deck.sceneBack);
   assert.equal(surface.back.style.backgroundImage,background,'check background stays until turn finishes');
 }
 settle();assert.equal(controller.state.activeNodeId,success?'win':'lose');
 assert.equal(controller.state.variables.energy,3);assert.equal(controller.state.variables.composure,success?4:3);
 assert.equal(deck.checkSurface,null);assert.equal(successor==='fork'?deck.content.actions[0].text:deck.content.text,success?'win':'lose');
 dispose(deck,controller);
});

test('terminal asynchronous check completes after result rather than holding forever',async()=>{
 let deck;
 const current=real([{id:'f',type:'fork',choices:[action('try',{resolution:'check',check:{pool:[{sides:6,count:1}],target:1}})],connections:{'try:success':null,'try:failure':null}}],{},
 {rollCheck:async(_,options)=>{await deck.waitForCheckSurface(options);return [6];}});
 deck=current.deck;let completions=0;deck.addEventListener('transitioncomplete',event=>{if(event.detail.transition==='commit')completions++;});
 deck.commit();settle();await flush();settle();
 assert.equal(current.controller.state.completed,true);assert.equal(deck.phase,'ended');assert.equal(deck.mount.children.length,0);
 assert.equal(completions,1);
 dispose(deck,current.controller);
});

test('reset rejects an unfinished departure wait and never mounts a stale tray',async()=>{
 const {deck,controller}=real(linear([action('plain')]));
 deck.commitMotion={};deck.phase='committing';deck.operation=null;
 const pending=deck.waitForCheckSurface();deck.reset();await assert.rejects(pending,{name:'AbortError'});
 assert.equal(deck.checkSurface,null);dispose(deck,controller);
});

test('explicit stat refresh updates the current Action check panel data without replacing its card',()=>{
 const source=action('try',{resolution:'check',check:{mode:'stat',modifierVariable:'composure',difficulty:5}});
 const booster=item('booster');
 const {deck,controller}=real([{id:'f',type:'fork',choices:[source],connections:{'try:success':null,'try:failure':null}}],
 {variables:[{id:'composure',type:'number',initial:3,min:1,max:10,stat:true}],library:[booster]});
 assert.equal(deck.content.actions[0].summary,'');
 assert.equal(deck.content.actions[0].checkInfo.chance,'37.5%');
 assert.equal(deck.content.actions[0].checkInfo.formula,'composure 3 · 3d6 + 3 ≥ 15');
 const before=deck.cards[0];controller.inventory=[booster];
 controller.variables.composure=7;controller.inventory=[];deck.updateActions(controller.content().actions);settle();
 assert.equal(controller.state.variables.composure,7);
 assert.equal(deck.content.actions[0].summary,'');
 assert.equal(deck.content.actions[0].checkInfo.chance,'83.8%');
 assert.equal(deck.content.actions[0].checkInfo.formula,'composure 7 · 3d6 + 7 ≥ 15');
 assert.equal(deck.cards[0],before);
 assert.equal(controller.inventory.length,0);dispose(deck,controller);
});
