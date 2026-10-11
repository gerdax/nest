import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectController } from '../project/ProjectController.js';
import { conditionsMet, transact, affordCosts } from '../project/state.js';
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
 const errors=[];const cycle=fixture([{id:'r',type:'random',routes:[],fallback:'r'}],{}, {onError:e=>errors.push(e)});assert.equal(errors.length,1);assert.equal(cycle.controller.state.completed,true);cycle.controller.destroy();
});
test('check spends costs then applies common and failure effects after feedback',async()=>{
 let resolve,feedback;const roll=new Promise(r=>resolve=r),wait=new Promise(r=>feedback=r);
 const choice=action('try',{resolution:'check',check:{pool:[{sides:6,count:1}],modifier:1,modifierVariable:'skill',target:10},costs:[{source:'variable',key:'energy',amount:2}],effects:[{op:'add',key:'energy',value:1}],failureEffects:[{op:'add',key:'energy',value:2}]});
 const {deck,controller}=fixture([{id:'f',type:'fork',choices:[choice],connections:{'try:success':'win','try:failure':'lose'}},{id:'win',type:'linear',cards:[narrative('win')]},{id:'lose',type:'linear',cards:[narrative('lose')]}],{variables:[{id:'energy',type:'number',initial:4},{id:'skill',type:'number',initial:1}]},{rollCheck:()=>roll,onCheckResult:result=>{assert.equal(result.total,4);return wait;}});
 deck.accept();assert.equal(controller.state.checking,true);resolve([2]);await flush();assert.equal(controller.state.variables.energy,4);feedback();await flush();assert.equal(controller.state.variables.energy,5);assert.equal(controller.state.activeNodeId,'lose');controller.destroy();
});
test('cancel and restart abort late check completion without spending or duplicate retries',async()=>{
 const resolves=[];const signals=[];const {deck,controller}=fixture([{id:'f',type:'fork',choices:[action('try',{resolution:'check',check:{pool:[{sides:6,count:1}],target:1},costs:[{source:'variable',key:'energy',amount:1}]})],connections:{'try:success':null}}],{variables:[{id:'energy',type:'number',initial:2}]},{rollCheck:(_,o)=>{signals.push(o.signal);return new Promise(r=>resolves.push(r));}});
 deck.accept();controller.cancelCheck();assert.equal(signals[0].aborted,true);assert.equal(controller.state.variables.energy,2);assert.equal(deck.options.presentation,'open');resolves[0]([6]);await flush();assert.equal(controller.state.completed,false);
 deck.accept();controller.restart();assert.equal(signals[1].aborted,true);resolves[1]([6]);await flush();assert.equal(controller.state.variables.energy,2);assert.equal(controller.state.completed,false);controller.destroy();
});
test('collect commits exact placement after departure and stages route using predicted inventory',()=>{
 let draws=0;const item={id:'placement',definitionId:'apple',kind:'item',name:'Apple',quantity:2,onCollect:[{op:'add',key:'energy',value:1}],use:{effects:[{op:'add',key:'energy',value:5}]}};
 const {deck,controller}=fixture([{id:'c',type:'container',intro:narrative('box'),items:[item],connections:{next:'r'}},{id:'r',type:'random',routes:[{id:'has',target:'a',weight:1,conditions:[{source:'inventory',key:'apple',op:'gte',value:2}]}]},{id:'a',type:'linear',cards:[narrative('after')]}],{variables:[{id:'energy',type:'number',initial:3,max:4}]},{rng:()=>{draws++;return 0;}});
 deck.take('placement',true);assert.equal(controller.state.collectedItems.length,0);assert.equal(controller.state.activeNodeId,'c');assert.equal(deck.pending.text,'after');deck.finish();assert.equal(controller.state.collectedItems.length,1);assert.equal(Object.hasOwn(controller.state.collectedItems[0],'quantity'),false);assert.equal(controller.state.variables.energy,4);assert.equal(controller.state.activeNodeId,'a');assert.equal(draws,1);assert.equal(controller.useItem('apple'),true);assert.equal(controller.state.collectedItems.length,0);assert.equal(controller.state.variables.energy,4);controller.destroy();
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
 deck.collect();if(!reduced){assert.equal(controller.state.activeNodeId,'c');assert.equal(controller.state.collectedItems.length,1);}settle();assert.equal(controller.state.activeNodeId,'a');assert.equal(controller.state.collectedItems.length,1);assert.equal(Object.hasOwn(controller.state.collectedItems[0],'quantity'),false);assert.equal(deck.phase,'closed');dispose(deck,controller);
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
 assert.deepEqual(deck.content.actions.map(a=>a.id),['disabled','roll']);assert.equal(deck.content.actions[0].disabled,true);deck.accept('disabled');assert.equal(controller.state.variables.energy,2);deck.accept('roll');await flush();assert.equal(controller.state.checking,false);assert.equal(controller.state.variables.energy,2);assert.equal(deck.options.presentation,'open');assert.equal(errors.length,1);controller.destroy();
});
test('use-item failure is atomic and refresh can unlock a choice at variable maximum',()=>{
 const use={effects:[{op:'add',key:'energy',value:2}]},apple={id:'apple',definitionId:'apple',kind:'item',use};
 const {deck,controller}=fixture([{id:'f',type:'fork',choices:[action('choose',{conditions:[{source:'inventory',key:'apple',op:'missing'}]})],connections:{}}],{variables:[{id:'energy',type:'number',initial:5,max:5}]});controller.inventory=[apple];controller.show();assert.equal(deck.content.actions[0].disabled,true);deck.busy=true;assert.equal(controller.useItem('apple'),false);deck.busy=false;assert.equal(controller.useItem('apple'),true);assert.equal(controller.state.variables.energy,5);assert.equal(controller.state.collectedItems.length,0);assert.equal(deck.content.actions[0].disabled,false);
 controller.inventory=[{...apple,use:{effects:[{op:'removeItem',key:'absent',quantity:1}]}}];assert.equal(controller.useItem('apple'),false);assert.equal(controller.state.collectedItems.length,1);controller.destroy();
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
 const {deck,controller}=fixture([{id:'a',type:'linear',cards:[{...narrative('start'),effects:[{op:'set',key:'flag',value:true}]},{...narrative('secret'),conditions:condition(false)},{...narrative('revealed'),conditions:condition(true)}],connections:{next:'b'}},{id:'b',type:'fork',choices:[action('choice',{conditions:condition(true)})],connections:{}}],{variables:[{id:'flag',type:'flag',initial:false}]});
 assert.equal(deck.content.nextCardPreview.text,'revealed');assert.equal(deck.content.nextDeckPreview.content.text,'revealed');assert.equal(controller.state.variables.flag,false);deck.accept();assert.equal(controller.state.cardId,'revealed');assert.equal(deck.content.nextDeckPreview.content.decisionOnly,true);assert.equal(deck.content.nextDeckPreview.content.actions[0].disabled,false);assert.equal(deck.content.nextDeckPreview.presentation,'open');controller.destroy();
});
test('linear previews stop before random selection while deterministic transparent nodes are safe',()=>{
 let draws=0;const {deck,controller}=fixture([{id:'start',type:'linear',cards:[narrative('start')],connections:{next:'empty'}},{id:'empty',type:'linear',cards:[],connections:{next:'random'}},{id:'random',type:'random',routes:[{id:'route',weight:1,target:'after'}]},{id:'after',type:'linear',cards:[narrative('after')]}],{}, {rng:()=>{draws++;return 0;}});
 assert.equal(deck.content.nextDeckPreview,undefined);assert.equal(draws,0);deck.accept();assert.equal(draws,1);assert.equal(controller.state.cardId,'after');controller.destroy();
});
test('blocked fork reports actionable error without leaking speculative preview errors',()=>{
 const errors=[];const {deck,controller}=fixture([{id:'story',type:'linear',cards:[narrative('story')],connections:{next:'fork'}},{id:'fork',name:'Locked door',type:'fork',choices:[action('choice',{unavailable:'hidden',conditions:[{source:'variable',key:'flag',op:'eq',value:true}]})],connections:{}}],{variables:[{id:'flag',type:'flag',initial:false}]},{onError:e=>errors.push(e.message)});
 assert.equal(errors.length,0);assert.equal(deck.content.nextDeckPreview.content.actions[0].disabled,true);deck.accept();assert.equal(errors.length,1);assert.match(errors[0],/Locked door/);assert.match(errors[0],/requirements and costs/);controller.destroy();
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
 const {deck,controller}=fixture([{id:'story',type:'linear',cards:[{...narrative('first'),context:'Here in the chapter.',effects:[{op:'add',key:'energy',value:1}]},{...narrative('second'),context:'Next context.'}],connections:{next:'items'}},{id:'items',type:'container',intro:narrative('box'),items:[{id:'item',definitionId:'apple',kind:'item',name:'Apple',text:'Fresh fruit.',context:'Found beside the ladder.',onCollect:[{op:'add',key:'energy',value:1}]}],connections:{}}],{variables:[{id:'energy',type:'number',initial:1}]});
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
 assert.equal(controller.state.activeNodeId,'box');assert.equal(deck.phase,'closed');assert.equal(deck.content.actions[0].disabled,true);key(deck,'ArrowUp');assert.equal(controller.state.variables.flag,true);assert.equal(deck.content.actions[0].id,'item');assert.equal(deck.content.actions[0].disabled,undefined);dispose(deck,controller);
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
test('using an item in revealed container refreshes actions without reapplying intro',()=>{
 const {deck,controller}=real([{id:'box',type:'container',intro:{...narrative('intro'),effects:[{op:'add',key:'energy',value:1}]},items:[{id:'a',kind:'item',definitionId:'a',name:'A'},{id:'b',kind:'item',definitionId:'b',name:'B'}],connections:{}}],{variables:[{id:'energy',type:'number',initial:0}]});key(deck,'ArrowUp');controller.inventory=[{id:'potion',definitionId:'potion',kind:'item',use:{effects:[{op:'add',key:'energy',value:1}]}}];assert.equal(controller.useItem('potion'),true);settle();assert.equal(controller.state.variables.energy,2);assert.equal(deck.phase,'choices');deck.emit('reveal');assert.equal(controller.state.variables.energy,2);dispose(deck,controller);
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
 assert.equal(controller.state.completed,true);assert.match(errors[0].message,/Automatic routing cycle/);controller.destroy();
});
