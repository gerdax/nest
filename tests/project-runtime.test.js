import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectController } from '../project/ProjectController.js';
import { conditionsMet, transact, affordCosts } from '../project/state.js';
import { createProject, validateProject, compileChapter } from '../project/model.js';
class Deck extends EventTarget {
  reset(){this.busy=false;this.pending=null;}
  replaceContent(content,options){if(this.busy){this.pending=content;}else this.content=content;this.options=options;}
  endContent(){this.ended=true;}
  emit(name,detail={}){const event=new Event(name);event.detail={contentId:this.content.id,...detail};this.dispatchEvent(event);}
  accept(id=this.content.actions[0].id){this.busy=true;this.emit('commit',{action:this.content.actions.find(a=>a.id===id)});if(this.pending){this.content=this.pending;this.pending=null;}this.busy=false;}
  take(id,final=false,transition='collect'){this.busy=true;this.emit(transition,{action:{id},final});}
  finish(transition='collect'){this.emit('transitioncomplete',{transition});if(this.pending){this.content=this.pending;this.pending=null;}this.busy=false;this.emit('transitioncomplete',{transition:'commit'});}
}
const narrative=id=>({id,kind:'narrative',name:id,text:id,effects:[]});
const action=(id,extra={})=>({id,kind:'action',name:id,resolution:'direct',...extra});
function fixture(nodes,extra={},options={}){const deck=new Deck();const controller=new ProjectController(deck,{startNode:nodes[0].id,nodes,variables:[],library:[],...extra},options);return {deck,controller};}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
test('transaction costs combine atomically, inventory aliases represent ownership, values clamp',()=>{
 const values={energy:4};const inventory=[{id:'a',definitionId:'apple',inventoryKey:'old',quantity:3}];
 assert.equal(conditionsMet([{source:'inventory',key:'old',op:'gte',value:3}],values,inventory),true);
 assert.equal(affordCosts(values,inventory,[{source:'variable',key:'energy',amount:3},{source:'variable',key:'energy',amount:2}]),false);
 assert.throws(()=>transact(values,inventory,{costs:[{source:'inventory',key:'apple',amount:2}],effects:[{op:'add',key:'missing',value:1}]}));
 assert.equal(inventory[0].quantity,3);
 const result=transact(values,inventory,{costs:[{source:'variable',key:'energy',amount:2},{source:'inventory',key:'old',amount:2}],effects:[{op:'add',key:'energy',value:100}]},[{id:'energy',type:'number',max:5,min:0}]);
 assert.deepEqual(result.variables,{energy:5});assert.deepEqual(result.inventory,[]);assert.equal(values.energy,4);
});
test('conditional story skips cards and playable graph loops remain valid',()=>{
 const {deck,controller}=fixture([{id:'a',type:'linear',cards:[{...narrative('hidden'),conditions:[{source:'variable',key:'flag',op:'eq',value:true}]},narrative('shown')],connections:{next:'a'}}],{variables:[{id:'flag',type:'flag',initial:false}]});
 assert.equal(controller.state.cardId,'shown');deck.accept();assert.equal(controller.state.cardId,'shown');assert.equal(controller.state.completed,false);controller.destroy();
});
test('random conditions choose once, fallback works, transparent cycles report error',()=>{
 let draws=0;const nodes=[{id:'r',type:'random',routes:[{id:'one',target:'a',weight:1},{id:'hidden',target:'b',weight:100,conditions:[{source:'variable',key:'missing',op:'eq',value:1}]}],fallback:'b'},{id:'a',type:'linear',cards:[narrative('a')],connections:{}},{id:'b',type:'linear',cards:[narrative('b')],connections:{}}];
 const {controller}=fixture(nodes,{}, {rng:()=>{draws++;return 0;}});assert.equal(controller.state.cardId,'a');assert.equal(draws,1);controller.destroy();
 nodes[0].routes=[];const f=fixture(nodes);assert.equal(f.controller.state.cardId,'b');f.controller.destroy();
 const errors=[];const cycle=fixture([{id:'r',type:'random',routes:[],fallback:'r'}],{}, {onError:e=>errors.push(e)});assert.equal(errors.length,1);assert.equal(cycle.controller.state.completed,false);cycle.controller.destroy();
});
test('check spends costs then applies common and failure effects after feedback',async()=>{
 let resolve,feedback;const roll=new Promise(r=>resolve=r),wait=new Promise(r=>feedback=r);
 const choice=action('try',{resolution:'check',check:{pool:[{sides:6,count:1}],modifier:1,modifierVariable:'skill',target:10},costs:[{source:'variable',key:'energy',amount:2}],effects:[{op:'add',key:'energy',value:1}],failureEffects:[{op:'add',key:'energy',value:2}]});
 const {deck,controller}=fixture([{id:'f',type:'fork',choices:[choice],connections:{'try:success':'win','try:failure':'lose'}},{id:'win',type:'linear',cards:[narrative('win')]},{id:'lose',type:'linear',cards:[narrative('lose')]}],{variables:[{id:'energy',type:'number',initial:4},{id:'skill',type:'number',initial:1}]},{rollCheck:()=>roll,onCheckResult:result=>{assert.equal(result.total,4);return wait;}});
 deck.accept();assert.equal(controller.state.checking,true);resolve([2]);await flush();assert.equal(controller.state.variables.energy,4);feedback();await flush();assert.equal(controller.state.variables.energy,5);assert.equal(controller.state.activeNodeId,'lose');controller.destroy();
});
test('cancel and restart abort late check completion without spending or duplicate retries',async()=>{
 const resolves=[];const signals=[];const {deck,controller}=fixture([{id:'f',type:'fork',choices:[action('try',{resolution:'check',check:{pool:[{sides:6,count:1}],target:1},costs:[{source:'variable',key:'energy',amount:1}]})],connections:{'try:success':null,'try:failure':null}}],{variables:[{id:'energy',type:'number',initial:2}]},{rollCheck:(_,o)=>{signals.push(o.signal);return new Promise(r=>resolves.push(r));}});
 deck.accept();controller.cancelCheck();assert.equal(signals[0].aborted,true);assert.equal(controller.state.variables.energy,2);assert.equal(deck.options.presentation,'open');resolves[0]([6]);await flush();assert.equal(controller.state.completed,false);
 deck.accept();controller.restart();assert.equal(signals[1].aborted,true);resolves[1]([6]);await flush();assert.equal(controller.state.variables.energy,2);assert.equal(controller.state.completed,false);controller.destroy();
});
test('collect commits exact placement after departure and stages route using predicted inventory',()=>{
 let draws=0;const item={id:'placement',definitionId:'apple',kind:'item',name:'Apple',quantity:2,onCollect:[{op:'add',key:'energy',value:1}]};
 const {deck,controller}=fixture([{id:'c',type:'container',intro:narrative('box'),items:[item],connections:{next:'r'}},{id:'r',type:'random',routes:[{id:'has',target:'a',weight:1,conditions:[{source:'inventory',key:'apple',op:'gte',value:2}]}]},{id:'a',type:'linear',cards:[narrative('after')]}],{variables:[{id:'energy',type:'number',initial:3,max:4}]},{rng:()=>{draws++;return 0;}});
 deck.take('placement',true);assert.equal(controller.state.collectedItems.length,0);assert.equal(controller.state.activeNodeId,'c');assert.equal(deck.pending.text,'after');deck.finish();assert.equal(controller.state.collectedItems.length,1);assert.equal(Object.hasOwn(controller.state.collectedItems[0],'quantity'),false);assert.equal(controller.state.variables.energy,4);assert.equal(controller.state.activeNodeId,'a');assert.equal(draws,1);controller.destroy();
});
test('restart ignores stale item transition and addItem uses definition library',()=>{
 const item={id:'placement',definitionId:'apple',kind:'item',name:'Apple'};const {deck,controller}=fixture([{id:'c',type:'container',intro:narrative('box'),items:[item],connections:{}}],{library:[{id:'apple',kind:'item',name:'Apple'}]});
 deck.take('placement',true);const stale=deck.content.id;controller.restart();deck.emit('transitioncomplete',{contentId:stale,transition:'collect'});assert.deepEqual(controller.state.collectedItems,[]);
 const result=transact({},[],{effects:[{op:'addItem',key:'apple',quantity:3}]},[],[{id:'apple',kind:'item'}]);assert.equal(result.inventory.length,1);assert.equal(Object.hasOwn(result.inventory[0],'quantity'),false);controller.destroy();
});
test('legacy multi-card fork keeps internal targets and pool queue exits only after all draws',()=>{
 const first={id:'s1',type:'forked',cards:[{id:'f1',choices:[{id:'inside',label:'Inside',target:'card:f2'}]},{id:'f2',choices:[{id:'out',label:'Out',target:'exit:done'}]}],exits:['done']};
 const second={id:'s2',type:'linear',cards:[narrative('end')],exits:['next']};
 const {deck,controller}=fixture([{id:'pool',type:'legacyPool',sequences:[first,second],pool:[{sequenceId:'s1',weight:1},{sequenceId:'s2',weight:1}],count:2,connections:{next:'after'}},{id:'after',type:'linear',cards:[narrative('after')]}],{}, {rng:()=>0});
 assert.equal(controller.state.cardId,'f1');assert.equal(deck.content.decisionOnly,false);deck.accept('inside');assert.equal(controller.state.cardId,'f2');deck.accept('out');assert.equal(controller.state.cardId,'end');deck.accept();assert.equal(controller.state.activeNodeId,'after');controller.destroy();
});

// Browser-shaped harness verifies actual deck event order and asynchronous commits.
import { CardDeck } from '../engine/CardDeck.js';
import { InventoryPickup } from '../engine/InventoryPickup.js';
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
for(const reduced of [false,true])test(`actual deck defers inventory to departure and retains staged destination, reduced=${reduced}`,()=>{
 const {deck,controller}=real([{id:'c',type:'container',intro:narrative('box'),items:[{id:'one',definitionId:'apple',kind:'item',name:'Apple'},{id:'two',definitionId:'apple',kind:'item',name:'Apple'}],connections:{next:'a'}},{id:'a',type:'linear',cards:[narrative('after')]}]);deck.reduced=reduced;
 key(deck,'ArrowUp');key(deck,'ArrowDown');assert.equal(controller.state.collectedItems.length,1);assert.equal(deck.phase,'choices');
 assert.equal(deck.content.actions[0].collectDisabled,true);deck.collect();settle();assert.equal(controller.state.activeNodeId,'c');
 deck.discard();if(!reduced){assert.equal(controller.state.activeNodeId,'c');assert.equal(controller.state.collectedItems.length,1);}settle();assert.equal(controller.state.activeNodeId,'a');assert.equal(controller.state.collectedItems.length,1);assert.equal(Object.hasOwn(controller.state.collectedItems[0],'quantity'),false);assert.equal(deck.phase,'closed');dispose(deck,controller);
});
test('actual deck waits for dice and recovers cancelled choice with retry',async()=>{
 let resolve;const {deck,controller}=real([{id:'f',type:'fork',choices:[action('try',{resolution:'check',check:{pool:[{sides:6,count:1}],target:2}})],connections:{'try:success':'a','try:failure':'a'}},{id:'a',type:'linear',cards:[narrative('after')]}],{}, {rollCheck:()=>new Promise(r=>resolve=r)});
 assert.equal(deck.phase,'choices');deck.commit();settle();assert.equal(controller.state.checking,true);assert.equal(deck.busy,true);controller.cancelCheck();settle();assert.equal(deck.phase,'choices');assert.equal(deck.busy,false);resolve([6]);await flush();assert.equal(controller.state.activeNodeId,'f');
 deck.commit();settle();resolve([6]);await flush();settle();assert.equal(controller.state.activeNodeId,'a');assert.equal(deck.phase,'closed');dispose(deck,controller);
});
test('actual deck terminal collection ends and restart drops stale departure',()=>{
 const nodes=[{id:'c',type:'container',intro:narrative('box'),items:[{id:'one',definitionId:'apple',kind:'item',name:'Apple'}],connections:{next:null}}];
 const {deck,controller}=real(nodes);key(deck,'ArrowUp');deck.collect();controller.restart();settle();assert.equal(controller.state.collectedItems.length,0);assert.equal(deck.phase,'closed');key(deck,'ArrowUp');key(deck,'ArrowDown');assert.equal(controller.state.completed,true);assert.equal(deck.phase,'ended');assert.equal(controller.state.collectedItems.length,1);dispose(deck,controller);
});
test('unaffordable actions hide or disable and failed dice restores unchanged state',async()=>{
 const errors=[];const nodes=[{id:'f',type:'fork',choices:[action('hidden',{unavailable:'hidden',costs:[{source:'variable',key:'energy',amount:3}]}),action('disabled',{costs:[{source:'variable',key:'energy',amount:3}]}),action('roll',{resolution:'check',check:{pool:[{sides:6,count:1}],target:1},costs:[{source:'variable',key:'energy',amount:1}]})],connections:{}}];
 const {deck,controller}=fixture(nodes,{variables:[{id:'energy',type:'number',initial:2}]},{rollCheck:async()=>{throw new Error('roller unavailable');},onError:e=>errors.push(e)});
 assert.deepEqual(deck.content.actions.map(a=>a.id),['hidden','disabled','roll'],'project default shows both unavailable actions regardless of old per-card settings');assert.equal(deck.content.actions[0].disabled,true);deck.accept('disabled');assert.equal(controller.state.variables.energy,2);deck.accept('roll');await flush();assert.equal(controller.state.checking,false);assert.equal(controller.state.variables.energy,2);assert.equal(deck.options.presentation,'open');assert.equal(errors.length,1);controller.destroy();
});
test('legacy pool container completes queue after exact collection and skips empty linear',()=>{
 const sequences=[{id:'box',type:'container',cards:[narrative('intro')],items:[{id:'legacy-item',definitionId:'def',inventoryKey:'chapter:item',label:'Item',effects:[{op:'set',key:'taken',value:true}]}],exits:['other']},{id:'empty',type:'linear',cards:[],exits:['next']},{id:'story',type:'linear',cards:[narrative('queued')],exits:['next']}];
 const {deck,controller}=fixture([{id:'pool',type:'legacyPool',sequences,pool:sequences.map(s=>({sequenceId:s.id,weight:1})),count:3,connections:{next:null}}],{variables:[{id:'taken',type:'flag',initial:false}]},{rng:()=>0});deck.take('legacy-item',true);assert.equal(controller.state.variables.taken,false);assert.equal(deck.pending.text,'queued');deck.finish();assert.equal(controller.state.cardId,'queued');assert.equal(controller.state.variables.taken,true);assert.equal(conditionsMet([{source:'inventory',key:'chapter:item',op:'has'}],{},controller.state.collectedItems),true);deck.accept();assert.equal(controller.state.completed,true);controller.destroy();
});
test('selected Random End target remains terminal even with a fallback',()=>{
 const {controller}=fixture([{id:'random',type:'random',routes:[{id:'end',target:null,weight:1}],fallback:'fallback'},{id:'fallback',type:'linear',cards:[narrative('fallback')]}],{}, {rng:()=>0});
 assert.equal(controller.state.completed,true);controller.destroy();
});
test('costs cannot spend below minimum bounds or borrow from later effects',()=>{
 const definitions=[{id:'resource',type:'number',initial:5,min:3,max:10}];const costs=[{source:'variable',key:'resource',amount:3}];
 assert.equal(affordCosts({resource:5},[],costs,definitions),false);
 assert.throws(()=>transact({resource:5},[],{costs,effects:[{op:'add',key:'resource',value:3}]},definitions),/Insufficient/);
 assert.equal(affordCosts({resource:5},[],[{source:'variable',key:'resource',amount:2}],definitions),true);
 const {deck,controller}=fixture([{id:'fork',type:'fork',choices:[action('expensive',{costs})],connections:{}}],{variables:definitions});assert.equal(deck.content.actions[0].disabled,true);controller.destroy();
});
test('linear previews apply current effects, skip newly ineligible cards and include deterministic target deck',()=>{
 const condition=value=>[{source:'variable',key:'flag',op:'eq',value}];
 const {deck,controller}=fixture([{id:'a',type:'linear',cards:[{...narrative('start'),effects:[{op:'set',key:'flag',value:true}]},{...narrative('secret'),conditions:condition(false)},{...narrative('revealed'),conditions:condition(true)}],connections:{next:'b'}},{id:'b',type:'fork',choices:[action('choice',{conditions:condition(true)})],connections:{choice:null}}],{variables:[{id:'flag',type:'flag',initial:false}]});
 assert.equal(deck.content.nextCardPreview.text,'revealed');assert.equal(deck.content.nextDeckPreview.content.text,'revealed');assert.equal(controller.state.variables.flag,false);deck.accept();assert.equal(controller.state.cardId,'revealed');assert.equal(deck.content.nextDeckPreview.content.decisionOnly,true);assert.equal(deck.content.nextDeckPreview.content.actions[0].disabled,false);assert.equal(deck.content.nextDeckPreview.presentation,'open');controller.destroy();
});
test('linear previews stop before random selection while deterministic transparent nodes are safe',()=>{
 let draws=0;const {deck,controller}=fixture([{id:'start',type:'linear',cards:[narrative('start')],connections:{next:'empty'}},{id:'empty',type:'linear',cards:[],connections:{next:'random'}},{id:'random',type:'random',routes:[{id:'route',weight:1,target:'after'}]},{id:'after',type:'linear',cards:[narrative('after')]}],{}, {rng:()=>{draws++;return 0;}});
 assert.equal(deck.content.nextDeckPreview,undefined);assert.equal(draws,0);deck.accept();assert.equal(draws,1);assert.equal(controller.state.cardId,'after');controller.destroy();
});
test('blocked fork reports actionable error without leaking speculative preview errors',()=>{
 const errors=[];const {deck,controller}=fixture([{id:'story',type:'linear',cards:[narrative('story')],connections:{next:'fork'}},{id:'fork',name:'Locked door',type:'fork',choices:[action('choice',{unavailable:'hidden',conditions:[{source:'variable',key:'flag',op:'eq',value:true}]})],connections:{}}],{variables:[{id:'flag',type:'flag',initial:false}]},{onError:e=>errors.push(e.message)});
 assert.equal(errors.length,0);assert.equal(deck.content.nextDeckPreview.content.actions[0].disabled,true);deck.accept();assert.equal(errors.length,1);assert.match(errors[0],/Locked door/);assert.match(errors[0],/requirements, costs and inventory triggers/);controller.destroy();
});
test('false container intro bypasses cover and never applies intro effects',()=>{
 const intro={...narrative('intro'),conditions:[{source:'variable',key:'flag',op:'eq',value:true}],effects:[{op:'set',key:'flag',value:true}]};
 const {deck,controller}=real([{id:'box',type:'container',intro,items:[{id:'item',kind:'item',definitionId:'apple',name:'Apple'}],connections:{next:null}}],{variables:[{id:'flag',type:'flag',initial:false}]});
 assert.equal(deck.phase,'choices');assert.equal(deck.open,true);assert.equal(controller.state.variables.flag,false);key(deck,'ArrowDown');assert.equal(controller.state.variables.flag,false);assert.equal(controller.state.completed,true);dispose(deck,controller);
});
test('actual deck idle state updates after departure for host inventory readiness',()=>{
 const notices=[];const {deck,controller}=real([{id:'story',type:'linear',cards:[narrative('first'),narrative('second')],connections:{}}],{}, {onChange:state=>notices.push(state)});
 assert.equal(controller.state.idle,true);deck.commitCover();assert.equal(controller.state.idle,false);settle();assert.equal(controller.state.idle,true);assert.equal(notices.at(-1).idle,true);dispose(deck,controller);
});
test('retired context is omitted from story/actions/previews and collected inventory; narrative summary stays private',()=>{
 const {deck,controller}=fixture([{id:'story',type:'linear',cards:[{...narrative('first'),context:'Here in the chapter.',effects:[{op:'add',key:'energy',value:1}]},{...narrative('second'),context:'Next context.'}],connections:{next:'items'}},{id:'items',type:'container',intro:narrative('box'),items:[{id:'item',definitionId:'apple',kind:'item',name:'Apple',text:'Fresh fruit.',context:'Found beside the ladder.',onCollect:[{op:'add',key:'energy',value:1}]}],connections:{next:null}}],{variables:[{id:'energy',type:'number',initial:1}]});
 assert.equal(deck.content.text,'first');assert.equal(deck.content.summary,'');assert.equal(deck.content.nextCardPreview.text,'second');deck.accept();deck.accept();assert.equal(deck.content.actions[0].text,'Fresh fruit.');assert.match(deck.content.actions[0].summary,/Collect/);deck.take('item',true);deck.finish();assert.equal(controller.state.collectedItems[0].text,'Fresh fruit.');assert.equal(controller.state.collectedItems[0].context,undefined);controller.destroy();
});
for(const reduced of [false,true])test(`fork introduction reveals once and unlocks choices before selection, reduced=${reduced}`,()=>{
 const intro={...narrative('intro'),text:'Choose carefully',effects:[{op:'add',key:'energy',value:1}]};
 const {deck,controller}=real([{id:'fork',type:'fork',intro,introEnabled:true,choices:[action('go',{costs:[{source:'variable',key:'energy',amount:1}]})],connections:{go:'after'}},{id:'after',type:'linear',cards:[narrative('after')]}],{variables:[{id:'energy',type:'number',initial:0}]});
 deck.reduced=reduced;assert.equal(deck.phase,'closed');assert.equal(deck.content.text,'Choose carefully');assert.equal(deck.content.actions[0].disabled,true);
 deck.start();deck.move({axis:'y',x:0,y:-10});deck.cancel();settle();assert.equal(controller.state.variables.energy,0);
 let reveals=0;deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='reveal')reveals++;});
 key(deck,'ArrowUp');assert.equal(reveals,1);assert.equal(deck.phase,'choices');assert.equal(deck.content.actions[0].disabled,false);assert.equal(controller.state.variables.energy,1);
 deck.emit('reveal');assert.equal(controller.state.variables.energy,1);key(deck,'ArrowUp');assert.equal(controller.state.activeNodeId,'after');assert.equal(controller.state.variables.energy,0);dispose(deck,controller);
});
for(const enabled of [false,undefined])test(`fork without enabled introduction presents choices directly, enabled=${enabled}`,()=>{
 const intro={...narrative('intro'),effects:[{op:'add',key:'energy',value:1}]};
 const {deck,controller}=real([{id:'fork',type:'fork',...(enabled===false?{intro,introEnabled:false}:{}),choices:[action('go')],connections:{go:null}}],{variables:[{id:'energy',type:'number',initial:0}]});
 assert.equal(deck.phase,'choices');deck.emit('reveal');assert.equal(controller.state.variables.energy,0);dispose(deck,controller);
});
for(const changesItems of [false,true])test(`container items unfold once after introduction, changed availability=${changesItems}`,()=>{
 const intro={...narrative('intro'),effects:changesItems?[{op:'set',key:'flag',value:true}]:[]};
 const item=id=>({id,kind:'item',definitionId:id,name:id});
 const items=changesItems?[{...item('before'),conditions:[{source:'variable',key:'flag',op:'eq',value:false}]},{...item('after'),conditions:[{source:'variable',key:'flag',op:'eq',value:true}]}]:[item('one'),item('two')];
 const {deck,controller}=real([{id:'box',type:'container',intro,items,connections:{}}],{variables:[{id:'flag',type:'flag',initial:false}]});
 let reveals=0;deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='reveal')reveals++;});
 const initialId=deck.content.id;key(deck,'ArrowUp');
 assert.equal(reveals,1);assert.equal(deck.phase,'choices');assert.equal(deck.fan.x,1);assert.equal(controller.state.idle,true);
 if(!changesItems)assert.equal(deck.content.id,initialId,'unchanged cards retain their deck');
 assert.deepEqual(deck.content.actions.map(a=>a.id),changesItems?['after']:['one','two']);dispose(deck,controller);
});
for(const reduced of [false,true])test(`container intro effects wait for accepted reveal, refresh availability and apply once, reduced=${reduced}`,()=>{
 const intro={...narrative('intro'),effects:[{op:'add',key:'energy',value:1}]};const item=id=>({id,definitionId:id,kind:'item',name:id});
 const {deck,controller}=real([{id:'box',type:'container',intro,items:[{...item('before'),conditions:[{source:'variable',key:'energy',op:'eq',value:0}]},{...item('after'),conditions:[{source:'variable',key:'energy',op:'gte',value:1}]}],connections:{}}],{variables:[{id:'energy',type:'number',initial:0}]});deck.reduced=reduced;
 assert.equal(controller.state.variables.energy,0);assert.equal(deck.content.summary,'');deck.start();deck.move({axis:'y',x:0,y:-10});deck.cancel();settle();assert.equal(controller.state.variables.energy,0);
 deck.key({key:'ArrowUp',preventDefault(){}});assert.equal(controller.state.variables.energy,1);if(!reduced)assert.equal(controller.state.idle,false);settle();assert.deepEqual(deck.content.actions.map(a=>a.id),['after']);assert.equal(deck.phase,'choices');assert.equal(controller.state.idle,true);
 deck.emit('reveal');assert.equal(controller.state.variables.energy,1);controller.show({restore:true});settle();assert.equal(deck.phase,'choices');assert.equal(controller.state.variables.energy,1);dispose(deck,controller);
});
test('intro effects can unlock initially ineligible items without skipping the cover',()=>{
 const {deck,controller}=real([{id:'box',type:'container',intro:{...narrative('intro'),effects:[{op:'set',key:'flag',value:true}]},items:[{id:'item',kind:'item',definitionId:'apple',name:'Apple',conditions:[{source:'variable',key:'flag',op:'eq',value:true}]}],connections:{next:'after'}},{id:'after',type:'linear',cards:[narrative('after')]}],{variables:[{id:'flag',type:'flag',initial:false}]});
 assert.equal(controller.state.activeNodeId,'box');assert.equal(deck.phase,'closed');assert.equal(deck.content.actions[0].disabled,true);key(deck,'ArrowUp');assert.equal(controller.state.variables.flag,true);assert.equal(deck.content.actions[0].id,'item');assert.notEqual(deck.content.actions[0].disabled,true);dispose(deck,controller);
});
test('intro reveal can auto-exit after effects hide every item, including terminal End',()=>{
 const nodes=[{id:'box',type:'container',intro:{...narrative('intro'),effects:[{op:'set',key:'flag',value:true}]},items:[{id:'item',kind:'item',definitionId:'apple',name:'Apple',conditions:[{source:'variable',key:'flag',op:'eq',value:false}]}],connections:{next:null}}];
 const {deck,controller}=real(nodes,{variables:[{id:'flag',type:'flag',initial:false}]});key(deck,'ArrowUp');assert.equal(controller.state.variables.flag,true);assert.equal(controller.state.completed,true);assert.equal(deck.phase,'ended');dispose(deck,controller);
});
test('false intro with no eligible items skips node; legacy intro effects remain inactive',()=>{
 const falseCondition=[{source:'variable',key:'flag',op:'eq',value:true}];
 const skipped=fixture([{id:'box',type:'container',intro:{...narrative('intro'),conditions:falseCondition,effects:[{op:'set',key:'flag',value:true}]},items:[{id:'item',kind:'item',definitionId:'apple',conditions:falseCondition}],connections:{next:'after'}},{id:'after',type:'linear',cards:[narrative('after')]}],{variables:[{id:'flag',type:'flag',initial:false}]});assert.equal(skipped.controller.state.activeNodeId,'after');assert.equal(skipped.controller.state.variables.flag,false);skipped.controller.destroy();
 const legacy=real([{id:'old',type:'legacySequence',sequence:{id:'old-box',type:'container',cards:[{...narrative('intro'),effects:[{op:'set',key:'flag',value:true}]}],items:[{id:'item',kind:'item',definitionId:'apple',label:'Apple'}],exits:['next']},connections:{}}],{variables:[{id:'flag',type:'flag',initial:false}]});key(legacy.deck,'ArrowUp');assert.equal(legacy.controller.state.variables.flag,false);dispose(legacy.deck,legacy.controller);
});
test('explicit variable refresh in revealed container does not reapply intro',()=>{
 const {deck,controller}=real([{id:'box',type:'container',intro:{...narrative('intro'),effects:[{op:'add',key:'energy',value:1}]},items:[{id:'a',kind:'item',definitionId:'a',name:'A'},{id:'b',kind:'item',definitionId:'b',name:'B'}],connections:{}}],{variables:[{id:'energy',type:'number',initial:0}]});key(deck,'ArrowUp');controller.variables.energy=2;controller.show({restore:true});settle();assert.equal(controller.state.variables.energy,2);assert.equal(deck.phase,'choices');deck.emit('reveal');assert.equal(controller.state.variables.energy,2);dispose(deck,controller);
});
for(const reduced of [false,true])test(`final visible collection retains container when it unlocks another item, reduced=${reduced}`,()=>{
 const nodes=[{id:'box',type:'container',intro:narrative('box'),items:[{id:'a',definitionId:'key',kind:'item',name:'Key'},{id:'b',definitionId:'prize',kind:'item',name:'Prize',conditions:[{source:'inventory',key:'key',op:'has'}]}],connections:{next:'after'}},{id:'after',type:'linear',cards:[narrative('after')]}];
 const {deck,controller}=real(nodes);deck.reduced=reduced;key(deck,'ArrowUp');assert.deepEqual(deck.content.actions.map(a=>a.id),['a']);
 deck.collect();if(!reduced){assert.equal(controller.state.collectedItems.length,0);assert.equal(controller.state.activeNodeId,'box');assert.deepEqual(deck.pending.actions.map(a=>a.id),['b']);assert.equal(deck.pendingPresentation,'open');}
 settle();assert.equal(controller.state.activeNodeId,'box');assert.equal(deck.phase,'choices');assert.deepEqual(deck.content.actions.map(a=>a.id),['b']);assert.deepEqual(controller.state.collectedItems.map(i=>i.definitionId),['key']);
 key(deck,'ArrowDown');assert.equal(controller.state.activeNodeId,'after');assert.equal(deck.phase,'closed');assert.deepEqual(controller.state.collectedItems.map(i=>i.definitionId),['key','prize']);dispose(deck,controller);
});
test('runtime error callback includes current state for host status ownership',()=>{
 const errors=[];const {controller}=fixture([{id:'blocked',type:'fork',choices:[action('no',{conditions:[{source:'variable',key:'flag',op:'eq',value:true}]})],connections:{}}],{variables:[{id:'flag',type:'flag',initial:false}]},{onError:(error,state)=>errors.push({error,state})});assert.equal(errors[0].state.activeNodeId,'blocked');controller.destroy();
});

test('player-driven node loops revisit story cards and can leave the loop',()=>{
 const {deck,controller}=fixture([{id:'story',type:'linear',cards:[narrative('story')],connections:{next:'fork'}},{id:'fork',type:'fork',choices:[action('again'),action('leave')],connections:{again:'story',leave:null}}]);
 for(let i=0;i<3;i++){assert.equal(controller.state.activeNodeId,'story');deck.accept();assert.equal(controller.state.activeNodeId,'fork');deck.accept('again');}
 deck.accept();deck.accept('leave');assert.equal(controller.state.completed,true);controller.destroy();
});
test('automatic routing loops remain bounded when node cycles are allowed',()=>{
 const errors=[];const {controller}=fixture([{id:'random',type:'random',routes:[{id:'loop',target:'random',weight:1}],fallback:null}],{allowCycles:true},{onError:e=>errors.push(e)});
 assert.equal(controller.state.completed,false);assert.match(errors[0].message,/Automatic routing cycle/);controller.destroy();
});

for(const once of [true,false,undefined])test(`Fork introductions respect per-visit/once behavior, show once=${once}`,()=>{
 const intro={...narrative('intro'),effects:[{op:'add',key:'energy',value:1}]};
 const {deck,controller}=fixture([{id:'fork',type:'fork',intro,introEnabled:true,...(once===undefined?{}:{introOnce:once}),choices:[action('go')],connections:{go:'return'}},{id:'return',type:'linear',cards:[narrative('return')],connections:{next:'fork'}}],{variables:[{id:'energy',type:'number',initial:0}]});
 deck.emit('reveal');deck.emit('transitioncomplete',{transition:'reveal'});assert.equal(controller.state.variables.energy,1);
 controller.show({restore:true});assert.equal(deck.options.presentation,'open','refresh stays in same visit');deck.emit('reveal');assert.equal(controller.state.variables.energy,1);
 deck.accept();deck.accept();assert.equal(deck.options.presentation,once===true?'open':'closed');deck.emit('reveal');deck.emit('transitioncomplete',{transition:'reveal'});assert.equal(controller.state.variables.energy,once===true?1:2);
 controller.restart();assert.equal(deck.options.presentation,'closed');assert.equal(controller.state.variables.energy,0);controller.destroy();
});
for(const once of [true,false])test(`Exhausted containers skip replay effects, show once=${once}`,()=>{
 const {deck,controller}=fixture([{id:'box',type:'container',intro:{...narrative('intro'),effects:[{op:'add',key:'energy',value:1}]},introOnce:once,items:[{id:'item',kind:'item',definitionId:'item',name:'Item'}],connections:{next:'return'}},{id:'return',type:'linear',cards:[narrative('return')],connections:{next:'box'}}],{variables:[{id:'energy',type:'number',initial:0}]});
 deck.emit('reveal');deck.emit('transitioncomplete',{transition:'reveal'});deck.take('item',true);deck.finish();assert.equal(controller.state.activeNodeId,'return');deck.accept();
 assert.equal(controller.state.variables.energy,1);assert.equal(controller.state.activeNodeId,'return');assert.equal(controller.state.collectedItems.length,1);controller.destroy();
});

test('container controller retains survivor stack and does not replay hint after removal',()=>{
 const items=['one','two','three','four'].map(id=>({id,kind:'item',definitionId:id,name:id}));
 const {deck,controller}=real([{id:'box',type:'container',intro:narrative('intro'),items,connections:{next:null}}]);
 key(deck,'ArrowUp');const contentId=deck.content.id;assert.equal(deck.presentationBrowsePending,false);
 key(deck,'ArrowDown');assert.equal(deck.cards.length,3);assert.equal(deck.content.id,contentId);assert.equal(deck.presentationBrowsePending,false);assert.equal(deck.presentationHint,null);
 key(deck,'ArrowDown');assert.equal(deck.cards.length,2);assert.equal(deck.content.id,contentId);assert.equal(deck.presentationBrowsePending,false);assert.equal(deck.presentationHint,null);dispose(deck,controller);
});

for(const reduced of [false,true])test(`linear node exits stage a back and flip, while internal cards reveal, reduced=${reduced}`,()=>{
 const {deck,controller}=real([{id:'a',type:'linear',cards:[narrative('first'),narrative('last')],connections:{next:'b'}},{id:'b',type:'linear',cards:[narrative('next')],connections:{}}]);
 deck.reduced=reduced;
 assert.equal(deck.content.nextTransition,'reveal');assert.equal(deck.nextFlip.x,0);
 key(deck,'ArrowUp');assert.equal(controller.state.cardId,'last');
 assert.equal(deck.content.nextTransition,'flip');assert.equal(deck.nextFlip.x,1);
 deck.start();deck.move({axis:'y',x:0,y:-100});
 assert.equal(deck.nextFlip.x,1);deck.cancel();settle();assert.equal(controller.state.cardId,'last');
 deck.commitCover();
 if(!reduced){assert.equal(deck.pendingTransition,'flip');assert.equal(deck.nextFlip.x,1);}
 settle();assert.equal(controller.state.activeNodeId,'b');assert.equal(deck.flip.x,0);assert.equal(controller.state.idle,true);
 dispose(deck,controller);
});
test('linear exits flip after condition skipping, random routing, and self-loop visits',()=>{
 for(const target of ['b','random','a']) {
  const {deck,controller}=fixture([{id:'a',type:'linear',cards:[narrative('first'),{...narrative('hidden'),conditions:[{source:'variable',key:'flag',op:'eq',value:true}]}],connections:{next:target}},{id:'random',type:'random',routes:[{id:'route',weight:1,target:'b'}]},{id:'b',type:'linear',cards:[narrative('next')]}],{variables:[{id:'flag',type:'flag',initial:false}]},{rng:()=>0});
  assert.equal(deck.content.nextTransition,'flip');deck.accept();assert.equal(deck.options.transition,'flip');assert.equal(controller.state.cardId,target==='a'?'first':'next');controller.destroy();
 }
});

for(const target of ['fork','container'])test(`linear exit turns a coverless ${target} successor`,()=>{
 const next=target==='fork'?{id:'next',type:'fork',choices:[action('choice')],connections:{choice:null}}:{id:'next',type:'container',introEnabled:false,items:[{id:'item',kind:'item',name:'Item'}],connections:{next:null}};
 const {deck,controller}=real([{id:'a',type:'linear',cards:[narrative('last')],connections:{next:'next'}},next]);
 assert.equal(deck.nextFlip.x,1);assert.equal(deck.forwardDeck.cardBacks.every(Boolean),true);
 deck.start();deck.move({axis:'y',x:0,y:-100});assert.equal(deck.nextFlip.x,1);deck.cancel();settle();
 deck.commitCover();assert.equal(deck.pendingTransition,'flip');assert.equal(deck.pending.decisionOnly,true);assert.equal(deck.nextFlip.x,1);
 settle();assert.equal(controller.state.activeNodeId,'next');assert.equal(deck.phase,'choices');assert.equal(deck.flip.x,0);assert.equal(controller.state.idle,true);
 if(target==='container'){key(deck,'ArrowDown');assert.equal(controller.state.collectedItems.length,1);assert.equal(controller.state.completed,true);}
 dispose(deck,controller);
});

test('container introduction reuses the coverless flip entrance and keeps semantic reveal events',()=>{
 const item=id=>({id,kind:'item',name:id});
 const {deck,controller}=real([{id:'box',type:'container',intro:narrative('intro'),items:[item('one'),item('two')],connections:{}}]);
 const originalId=deck.content.id;let accepted=0,completed=0,commits=0;
 deck.addEventListener('reveal',()=>accepted++);deck.addEventListener('commit',()=>commits++);
 deck.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='reveal')completed++;});
 deck.start();deck.move({axis:'y',x:0,y:-80,vx:0,vy:0});
 assert.equal(deck.forwardDeck.cards[0].style.visibility,'visible');assert.ok(deck.forwardDeck.cards[0].style.transform.includes('rotateY(180deg)'));
 deck.end({axis:'y',x:0,y:-80,vx:0,vy:0});settle();assert.equal(accepted,0);assert.equal(deck.phase,'closed');
 deck.start();deck.move({axis:'y',x:0,y:-150,vx:0,vy:0});deck.end({axis:'y',x:0,y:-150,vx:0,vy:0});
 assert.equal(deck.commitMotion.introduction,true);assert.equal(deck.pending.decisionOnly,true);assert.equal(deck.pendingTransition,'flip');
 assert.equal(deck.pending.id,originalId);assert.equal(accepted,1);assert.equal(completed,0);assert.equal(commits,0);assert.equal(deck.start(),false);
 for(let i=0;deck.commitMotion&&i<1000;i++){now+=16;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));}
 assert.equal(deck.skipCover,true);assert.equal(deck.content.decisionOnly,true);assert.equal(deck.scene.style.visibility,'hidden');
 assert.equal(deck.phase,'committing');assert.equal(deck.commitTransition,'reveal');assert.equal(deck.flip.target,0);assert.ok(deck.flip.x>0&&deck.flip.x<1);
 assert.equal(deck.cardBacks.every(Boolean),true);assert.equal(completed,0);
 settle();assert.equal(completed,1);assert.equal(commits,0);assert.equal(deck.flip.x,0);assert.equal(deck.phase,'choices');assert.equal(controller.state.idle,true);
 key(deck,'ArrowDown');assert.equal(controller.state.collectedItems.length,1);dispose(deck,controller);
});
test('restart during container intro departure cancels staged items and stale reveal completion',()=>{
 const {deck,controller}=real([{id:'box',type:'container',intro:{...narrative('intro'),effects:[{op:'add',key:'energy',value:1}]},items:[{id:'item',kind:'item',name:'Item'}]}],{variables:[{id:'energy',type:'number',initial:0}]});
 deck.key({key:'ArrowUp',preventDefault(){}});assert.equal(deck.commitMotion.introduction,true);assert.equal(controller.state.variables.energy,1);
 controller.restart();settle();assert.equal(deck.phase,'closed');assert.equal(deck.pending,null);assert.equal(deck.commitTransition,'commit');assert.equal(controller.state.variables.energy,0);
 key(deck,'ArrowUp');assert.equal(deck.phase,'choices');assert.equal(controller.state.variables.energy,1);dispose(deck,controller);
});

test('only fork nodes request closer choice followers',()=>{
 for(const type of ['fork','linear','container']){
  const node=type==='fork'?{id:'node',type,choices:[action('one'),action('two')]}:type==='linear'?{id:'node',type,cards:[action('one')]}:{id:'node',type,introEnabled:false,items:[{id:'one',kind:'item',name:'One'}]};
  const {deck,controller}=fixture([node]);assert.equal(deck.content.choiceFollowerRatio,type==='fork'?.82:undefined);controller.destroy();
 }
});

test('drawer replacement is authorized against current ownership and commits atomically after collection',()=>{
  const item={id:'placement',definitionId:'new',kind:'item',name:'New',onCollect:[{op:'add',key:'energy',value:2}]};
  const {deck,controller}=fixture([{id:'c',type:'container',intro:narrative('box'),items:[item],connections:{next:'done'}},{id:'done',type:'end'}],{variables:[{id:'energy',type:'number',initial:1}]});
  deck.pickup={};
  controller.inventory=['a','b','c','d'].map(id=>({id,definitionId:id,kind:'item'}));
  assert.equal(controller.authorizeCollection(item,{}),false);
  assert.equal(controller.authorizeCollection(item,{replacementId:'missing'}),false);
  assert.equal(controller.authorizeCollection(item,{replacementId:'b'}),true);
  assert.equal(controller.inventory.length,4); assert.equal(controller.variables.energy,1);
  deck.busy=true; deck.emit('collect',{action:item,final:true,replacementId:'b',slot:1});
  assert.deepEqual(controller.inventory.map(i=>i.id),['a','b','c','d']);
  assert.equal(controller.variables.energy,1);
  deck.finish();
  assert.deepEqual(controller.inventory.map(i=>i.definitionId),['a','c','d','new']);
  assert.equal(controller.variables.energy,3); controller.destroy();
});

test('drawer can replace a visible item while preserving existing inventory overflow',()=>{
  const item={id:'new',kind:'item',name:'New'};
  const {deck,controller}=fixture([{id:'c',type:'container',intro:narrative('box'),items:[item],connections:{next:'done'}},{id:'done',type:'end'}]);
  deck.pickup={};
  controller.inventory=['a','b','c','d','overflow'].map(id=>({id,definitionId:id,kind:'item'}));
  assert.equal(controller.authorizeCollection(item,{}),false);
  assert.equal(controller.authorizeCollection(item,{replacementId:'missing'}),false);
  assert.equal(controller.authorizeCollection(item,{replacementId:'b'}),true);
  deck.busy=true; deck.emit('collect',{action:item,final:true,replacementId:'b',slot:1});
  assert.equal(controller.inventory.length,5,'confirmation does not commit ownership');
  deck.finish();
  assert.deepEqual(controller.inventory.map(i=>i.definitionId??i.id),['a','c','d','overflow','new']);
  controller.destroy();
});

test('drawer rejects invalid replacement effects without losing the old item',()=>{
  const item={id:'new',kind:'item',onCollect:[{op:'add',key:'absent',value:1}]};
  const {deck,controller}=fixture([{id:'c',type:'container',intro:narrative('box'),items:[item],connections:{next:'done'}},{id:'done',type:'end'}]);
  deck.pickup={}; controller.inventory=['a','b','c','d'].map(id=>({id,definitionId:id}));
  assert.equal(controller.authorizeCollection(item,{replacementId:'b'}),false);
  assert.deepEqual(controller.inventory.map(i=>i.id),['a','b','c','d']); controller.destroy();
});

for (const reduced of [false,true]) for (const survivor of [false,true]) test(`drawer stays visible when collection unlocks another item, reduced=${reduced}, survivor=${survivor}`,async()=>{
 const items=[{id:'a',definitionId:'key',kind:'item',name:'Key'},
  ...(survivor?[{id:'c',definitionId:'coin',kind:'item',name:'Coin'}]:[]),
  {id:'b',definitionId:'prize',kind:'item',name:'Prize',conditions:[{source:'inventory',key:'key',op:'has'}]}];
 const errors=[];
 const {deck,controller}=real([{id:'box',type:'container',intro:narrative('box'),introEnabled:false,items,connections:{next:'after'}},{id:'after',type:'linear',cards:[narrative('after')]}],{},{onError:error=>errors.push(error.stack)});
 deck.reduced=reduced;
 const visibility=[],exits=[],events=[];
 for(const name of ['collect','transitioncomplete','inventoryerror'])deck.addEventListener(name,event=>events.push({name,...event.detail}));
 const target={slot:0,rect:{left:0,top:560,width:75,height:100}};
 deck.pickup=new InventoryPickup(deck,{getTarget:()=>target,slotTarget:()=>target,preview(){},presentPreview(){},stageDeposit(){},clearDeposit(){},cancelPending(){},clearExit(){},
  authorize:()=>({slot:0}),setContext:visible=>visibility.push(visible),setExitProgress:progress=>exits.push(progress)});
 deck.render();assert.equal(visibility.at(-1),true);
 visibility.length=0;
 deck.index=deck.content.actions.findIndex(action=>action.id==='a');
 deck.collect();await flush();settle();
 assert.equal(controller.state.activeNodeId,'box');assert.ok(deck.content.actions.some(action=>action.id==='b'));
 assert.deepEqual(errors,[]);assert.equal(events.some(event=>event.name==='inventoryerror'),false);
 assert.ok(visibility.length>0);assert.equal(visibility.includes(false),false,'same container never hides the drawer');
 assert.deepEqual(exits,[],'unlocking another item must not start an exit');
 assert.equal(deck.preserveInventoryContext,false,'continuation flag is consumed by installation');
 // The continuation must not suppress a later real departure.
 deck.discard();settle();assert.deepEqual(exits,[],'engine does not drive drawer animation');assert.equal(visibility.at(-1),false);
 dispose(deck,controller);
});

for(const reduced of [false,true])test(`single-item intro updates drawer visibility after hint readiness clears, reduced=${reduced}`,()=>{
 const {deck,controller}=real([{id:'box',type:'container',intro:narrative('intro'),items:[{id:'item',definitionId:'key',kind:'item',name:'Key'}],connections:{next:null}}]);
 deck.reduced=reduced;let visible=false;
 deck.pickup=new InventoryPickup(deck,{setContext:value=>{visible=value;},preview(){},cancelPending(){}});
 assert.equal(deck.open,false);assert.equal(visible,false);
 key(deck,'ArrowUp');
 assert.equal(deck.phase,'choices');assert.equal(deck.presentationBrowsePending,false);
 assert.equal(frames.size,0,'no additional interaction or animation frame is needed');
 assert.equal(visible,true,'drawer reflects final readiness even when no stack hint is animated');
 assert.equal(deck.mount.getAttribute('data-inventory-context'),'true');
 dispose(deck,controller);
});

for(const context of ['linear','container'])test(`${context} drawer starts before full settlement while input stays locked`,()=>{
 const item={id:'item',definitionId:'key',kind:'item',name:'Key'};
 const nodes=context==='container'
  ?[{id:'box',type:'container',intro:narrative('intro'),items:[item],connections:{next:null}}]
  :[{id:'before',type:'linear',cards:[narrative('before')],connections:{next:'items'}},{id:'items',type:'linear',cards:[item],connections:{next:null}}];
 const {deck,controller}=real(nodes);let shownAt=null,settledAt=null,visible=false;
 deck.pickup=new InventoryPickup(deck,{preview(){},cancelPending(){},traceEnabled:()=>true,
  trace:(source,state)=>{if(state.fullySettled&&settledAt===null)settledAt=now;},
  setContext:value=>{
   if(value&&!visible&&shownAt===null){shownAt=now;assert.equal(deck.start(),false,'early visibility must not unlock interaction');}
   visible=value;
  }});
 key(deck,context==='container'?'ArrowUp':'Enter');
 assert.equal(visible,true);assert.ok(shownAt!==null&&settledAt!==null);
 assert.ok(shownAt<settledAt,`exposure precedes settlement by ${settledAt-shownAt}ms`);
 assert.equal(deck.phase,'choices');assert.equal(deck.state.busy,false);
 dispose(deck,controller);
});

function continuityDrawer(deck) {
 const visibility=[],exits=[],entrances=[];let visible=false;
 const target={slot:0,rect:{left:0,top:560,width:75,height:100}};
 deck.pickup=new InventoryPickup(deck,{getTarget:()=>target,slotTarget:()=>target,
  preview(){},presentPreview(){},stageDeposit(){},clearDeposit(){},cancelPending(){},clearExit(){},
  authorize:()=>({slot:0}),setContext:value=>{visibility.push(value);if(value&&!visible)entrances.push(now);visible=value;},
  setExitProgress:progress=>exits.push(progress)});
 deck.render();
 return {visibility,exits,entrances,get visible(){return visible;}};
}
for(const reduced of [false,true])for(const acrossNodes of [false,true])for(const operation of ['collect','discard'])test(`consecutive linear items retain drawer across ${operation}, across nodes=${acrossNodes}, reduced=${reduced}`,async()=>{
 const item=id=>({id,definitionId:id,kind:'item',name:id});
 const nodes=acrossNodes
  ?[{id:'before',type:'linear',cards:[narrative('before')],connections:{next:'first'}},
    {id:'first',type:'linear',cards:[item('one')],connections:{next:'second'}},
    {id:'second',type:'linear',cards:[item('two')],connections:{next:'after'}},
    {id:'after',type:'linear',cards:[narrative('after')]}]
  :[{id:'items',type:'linear',cards:[narrative('before'),item('one'),item('two'),narrative('after')]}];
 const errors=[];const {deck,controller}=real(nodes,{},{onError:error=>errors.push(error.stack)});deck.reduced=reduced;
 const drawer=continuityDrawer(deck);assert.equal(drawer.visible,false);
 key(deck,'Enter');assert.equal(controller.state.cardId,'one');assert.equal(drawer.visible,true);assert.equal(drawer.entrances.length,1);
 drawer.visibility.length=0;drawer.exits.length=0;
 deck[operation]();
 assert.deepEqual(controller.state.collectedItems,[],'request and departure do not transfer ownership');
 await flush();settle();
 assert.equal(controller.state.cardId,'two');assert.equal(deck.phase,'choices');assert.equal(drawer.visible,true);
 assert.equal(drawer.visibility.includes(false),false,'consecutive item replacement never hides the drawer');
 assert.deepEqual(drawer.exits,[],'consecutive items never start a drawer exit');
 assert.equal(drawer.entrances.length,1,'the next item does not replay the entrance');
 assert.deepEqual(controller.state.collectedItems.map(item=>item.definitionId),operation==='collect'?['one']:[]);
 assert.equal(deck.preserveInventoryContext,false,'installation consumes the continuation flag');
 assert.deepEqual(errors,[]);
 // A real departure after the continuation must still end logical drawer visibility.
 deck.discard();settle();assert.equal(controller.state.cardId,'after');assert.equal(drawer.visible,false);
 assert.deepEqual(drawer.exits,[],'real departures do not drive drawer animation');
 assert.deepEqual(controller.state.collectedItems.map(item=>item.definitionId),operation==='collect'?['one']:[]);
 dispose(deck,controller);
});

for(const successor of ['narrative','closed container'])for(const operation of ['collect','discard'])test(`linear item ${operation} ends drawer visibility for ${successor}`,async()=>{
 const item=id=>({id,definitionId:id,kind:'item',name:id});
 const next=successor==='narrative'?{id:'next',type:'linear',cards:[narrative('after')]}:{id:'next',type:'container',intro:narrative('intro'),items:[item('two')]};
 const {deck,controller}=real([{id:'items',type:'linear',cards:[item('one')],connections:{next:'next'}},next]);
 const drawer=continuityDrawer(deck);assert.equal(drawer.visible,true);drawer.exits.length=0;
 deck[operation]();await flush();settle();
 assert.equal(controller.state.activeNodeId,'next');assert.equal(deck.phase,'closed');assert.equal(drawer.visible,false);
 assert.deepEqual(drawer.exits,[],'the view owns exit animation after logical visibility ends');
 assert.equal(deck.preserveInventoryContext,false);
 assert.deepEqual(controller.state.collectedItems.map(item=>item.definitionId),operation==='collect'?['one']:[]);
 if(successor==='closed container'){
  key(deck,'ArrowUp');assert.equal(drawer.visible,true);assert.equal(drawer.entrances.length,2,'the new introduction starts a fresh drawer entrance');
 }
 dispose(deck,controller);
});

test('linear item continuity uses effects and skips ineligible narrative cards',async()=>{
 const {deck,controller}=real([{id:'items',type:'linear',cards:[
  {id:'one',definitionId:'one',kind:'item',name:'One',onCollect:[{op:'set',key:'taken',value:true}]},
  {...narrative('hidden'),conditions:[{source:'variable',key:'taken',op:'eq',value:false}]},
  {id:'two',definitionId:'two',kind:'item',name:'Two',conditions:[{source:'variable',key:'taken',op:'eq',value:true}]}
 ],connections:{next:null}}],{variables:[{id:'taken',type:'flag',initial:false}]});
 const drawer=continuityDrawer(deck);assert.equal(drawer.visible,true);drawer.visibility.length=0;
 deck.collect();assert.equal(controller.state.variables.taken,false);await flush();settle();
 assert.equal(controller.state.cardId,'two');assert.equal(controller.state.variables.taken,true);
 assert.deepEqual(controller.state.collectedItems.map(item=>item.definitionId),['one']);
 assert.equal(drawer.visibility.includes(false),false);assert.deepEqual(drawer.exits,[]);assert.equal(drawer.entrances.length,1);
 dispose(deck,controller);
});

for(const direction of ['linear to container','container to linear'])for(const operation of ['collect','discard'])test(`open item continuity ${direction} across ${operation}`,async()=>{
 const item=id=>({id,definitionId:id,kind:'item',name:id});
 const first=direction==='linear to container'
  ?{id:'first',type:'linear',cards:[item('one')],connections:{next:'second'}}
  :{id:'first',type:'container',introEnabled:false,items:[item('one')],connections:{next:'second'}};
 const second=direction==='linear to container'
  ?{id:'second',type:'container',introEnabled:false,items:[item('two')],connections:{next:null}}
  :{id:'second',type:'linear',cards:[item('two')],connections:{next:null}};
 const errors=[];const {deck,controller}=real([first,second],{},{onError:error=>errors.push(error.stack)});
 const drawer=continuityDrawer(deck);assert.equal(drawer.visible,true);assert.equal(drawer.entrances.length,1);
 drawer.visibility.length=0;
 deck[operation]();assert.deepEqual(controller.state.collectedItems,[],'departure begins without transferring ownership');
 await flush();settle();
 assert.equal(controller.state.activeNodeId,'second');assert.equal(deck.content.actions[0].id,'two');assert.equal(deck.phase,'choices');
 assert.equal(drawer.visible,true);assert.equal(drawer.visibility.includes(false),false,'open item contexts share drawer visibility');
 assert.deepEqual(drawer.exits,[],'changing node kind does not start a drawer exit');assert.equal(drawer.entrances.length,1);
 assert.deepEqual(controller.state.collectedItems.map(item=>item.definitionId),operation==='collect'?['one']:[]);
 assert.equal(deck.preserveInventoryContext,false);assert.deepEqual(errors,[]);
 dispose(deck,controller);
});
