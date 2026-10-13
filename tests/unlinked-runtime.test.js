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

const effects=[{op:'add',key:'energy',value:2}];
function unchanged(controller,before){assert.deepEqual(controller.state,before);}
function swipe(deck,y=-170){deck.start();deck.move({axis:'y',x:0,y,vx:0,vy:0});deck.end({axis:'y',x:0,y,vx:0,vy:0});settle();}
for(const target of [false,undefined])test(`Unlinked narrative ${target} rejects keyboard, pointer, and forged commits atomically`,()=>{
 const {deck,controller}=real([{id:'beat',type:'linear',cards:[narrative('first'),{...narrative('last'),effects}],connections:{next:target}}],{variables:energy});
 assert.equal(deck.content.advanceDisabled,false);key(deck,'ArrowUp');assert.equal(controller.state.cardId,'last');assert.equal(deck.content.advanceDisabled,true);
 const before=controller.state;
 for(const name of ['ArrowUp','Enter']){key(deck,name);unchanged(controller,before);assert.equal(deck.phase,'closed');assert.equal(deck.busy,false);}
 swipe(deck);unchanged(controller,before);assert.equal(deck.phase,'closed');assert.equal(deck.p.x,0);
 deck.commitCover();settle();unchanged(controller,before);
 controller.commit({contentId:deck.content.id,action:deck.content.actions[0]});settle();unchanged(controller,before);dispose(deck,controller);
});
for(const next of [null,'after'])test(`explicit ${next} departure still works`,()=>{
 const nodes=[{id:'beat',type:'linear',cards:[{...narrative('event'),effects}],connections:{next}},{id:'after',type:'linear',cards:[narrative('after')],connections:{next:null}}];
 const {deck,controller}=real(nodes,{variables:energy});key(deck,'Enter');assert.equal(controller.state.variables.energy,6);assert.equal(controller.state.completed,next===null);if(next)assert.equal(controller.state.cardId,'after');dispose(deck,controller);
});
test('fork outputs gate independently; introduction reveal remains allowed',()=>{
 const nodes=[{id:'fork',type:'fork',intro:{...narrative('intro'),effects},choices:[action('blocked',{costs:[{source:'variable',key:'energy',amount:1}],effects}),action('end')],connections:{blocked:false,end:null}}];
 const {deck,controller}=real(nodes,{variables:energy});key(deck,'ArrowUp');assert.equal(deck.phase,'choices');assert.equal(controller.state.variables.energy,6);assert.equal(deck.content.actions[0].disabled,true);assert.equal(deck.content.actions[1].disabled,false);
 const before=controller.state;key(deck,'Enter');swipe(deck);unchanged(controller,before);key(deck,'ArrowRight');key(deck,'Enter');assert.equal(controller.state.completed,true);dispose(deck,controller);
});
test('check with either Unlinked outcome does not roll or charge',()=>{
 let rolls=0;
 for(const blocked of ['success','failure']){
 const source=action('roll',{resolution:'check',check:{pool:[{sides:6,count:1}],target:4},costs:[{source:'variable',key:'energy',amount:1}],effects});
 const {deck,controller}=real([{id:'fork',type:'fork',introEnabled:false,choices:[source],connections:{'roll:success':blocked==='success'?false:null,'roll:failure':blocked==='failure'?false:null}}],{variables:energy},{rollCheck:()=>{rolls++;return 6;}});
 assert.equal(deck.content.actions[0].disabled,true);const before=controller.state;key(deck,'Enter');controller.runCheck(source);unchanged(controller,before);assert.equal(rolls,0);dispose(deck,controller);
 }
});
for(const transition of ['collect','discard'])test(`final Linear item ${transition} is blocked before effects or ownership change`,()=>{
 const {deck,controller}=real([{id:'beat',type:'linear',cards:[item('apple',{onCollect:effects})],connections:{next:false}}],{variables:energy});const before=controller.state;
 assert.equal(deck.content.actions[0][`${transition}Disabled`],true);deck[transition]();settle();unchanged(controller,before);assert.equal(deck.busy,false);
 controller.resolveItem({contentId:deck.content.id,action:deck.content.actions[0],final:true},transition);settle();unchanged(controller,before);dispose(deck,controller);
});
test('Unlinked container allows earlier take, blocks discard-all, then blocks final take',()=>{
 const {deck,controller}=real([{id:'box',type:'container',introEnabled:false,items:[item('a',{onCollect:effects}),item('b',{onCollect:effects})],connections:{next:false}}],{variables:energy});
 assert.equal(deck.content.actions[0].collectDisabled,false);assert.equal(deck.content.actions[0].discardDisabled,true);const before=controller.state;key(deck,'ArrowUp');swipe(deck);unchanged(controller,before);
 key(deck,'ArrowDown');assert.equal(controller.state.collectedItems.length,1);assert.equal(controller.state.variables.energy,6);assert.equal(deck.content.actions.length,1);assert.equal(deck.content.actions[0].collectDisabled,true);
 const after=controller.state;key(deck,'ArrowDown');key(deck,'Enter');unchanged(controller,after);assert.equal(controller.items().length,1);dispose(deck,controller);
});
test('post-action eligibility blocks departure when remaining cards become hidden',()=>{
 const {deck,controller}=real([{id:'beat',type:'linear',cards:[{...narrative('event'),effects:[{op:'add',key:'energy',value:-4}]},{...narrative('hidden'),conditions:[{source:'variable',key:'energy',op:'gte',value:1}]}],connections:{next:false}}],{variables:energy});
 assert.equal(deck.content.advanceDisabled,true);const before=controller.state;key(deck,'ArrowUp');unchanged(controller,before);dispose(deck,controller);
});
test('automatic random routing with Unlinked eligible target is blocked without RNG draws',()=>{
 let draws=0;const nodes=[{id:'beat',type:'linear',cards:[narrative('event')],connections:{next:'random'}},{id:'random',type:'random',routes:[{id:'r',weight:1,target:false}],fallback:null}];
 const {deck,controller}=real(nodes,{}, {rng:()=>{draws++;return 0;}});assert.equal(deck.content.advanceDisabled,true);key(deck,'Enter');assert.equal(draws,0);assert.equal(controller.state.completed,false);dispose(deck,controller);
});
test('startup automatic Unlinked routing reports a blocked playback instead of completion',()=>{
 const errors=[];const {deck,controller}=real([{id:'random',type:'random',routes:[{id:'r',weight:1,target:false}],fallback:null}],{}, {rng:()=>0,onError:e=>errors.push(e.message)});
 assert.deepEqual(errors,['Unlinked output']);assert.equal(controller.state.completed,false);assert.equal(deck.content.actions[0].disabled,true);key(deck,'Enter');assert.equal(controller.state.completed,false);dispose(deck,controller);
});
for(const cycleFirst of [true,false])test(`mixed automatic cycle and Unlinked routes block without draws, cycleFirst=${cycleFirst}`,()=>{
 let draws=0;const routes=[{id:'cycle',weight:1,target:'random'},{id:'unlinked',weight:1,target:false}];
 if(!cycleFirst)routes.reverse();
 const {deck,controller}=real([{id:'beat',type:'linear',cards:[{...narrative('event'),effects}],connections:{next:'random'}},{id:'random',type:'random',routes,fallback:null}],{variables:energy},{rng:()=>{draws++;return 0;}});
 assert.equal(deck.content.advanceDisabled,true);const before=controller.state;key(deck,'Enter');swipe(deck);unchanged(controller,before);assert.equal(draws,0);dispose(deck,controller);
});
