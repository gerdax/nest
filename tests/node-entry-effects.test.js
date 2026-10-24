import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectController } from '../project/ProjectController.js';

// Event and state fixture; it does not verify browser rendering.
class Deck extends EventTarget {
 reset(){this.busy=false;this.pending=null;}
 replaceContent(content,options){if(this.busy)this.pending=content;else this.content=content;this.options=options;}
 endContent(){this.ended=true;}
 emit(name,detail={}){const event=new Event(name);event.detail={contentId:this.content.id,...detail};this.dispatchEvent(event);}
 accept(){this.busy=true;this.emit('commit',{action:this.content.actions[0]});if(this.pending){this.content=this.pending;this.pending=null;}this.busy=false;}
 take(){this.busy=true;this.emit('collect',{action:this.content.actions[0],final:true});}
 finish(){this.emit('transitioncomplete',{transition:'collect'});if(this.pending){this.content=this.pending;this.pending=null;}this.busy=false;this.emit('transitioncomplete',{transition:'commit'});}
}
const story=(id,extra={})=>({id,kind:'event',text:id,effects:[],...extra});
const linear=(id,next,cards=[story(`${id}-card`)])=>({id,type:'linear',cards,connections:{next}});
const add=value=>({op:'add',key:'count',value});
const flag=value=>({op:'set',key:'flag',value});
const requiresFlag=value=>[{source:'variable',key:'flag',op:'eq',value}];
const lockpick={id:'lockpick',definitionId:'lockpick',kind:'item',name:'Lockpick',permability:2,onCollect:[]};
function run(nodes,effects={},options={},extra={}){
 const deck=new Deck(),errors=[];
 const compiled={startNode:nodes[0].id,nodes,variables:[{id:'count',type:'number',initial:0},{id:'flag',type:'flag',initial:false}],library:[lockpick],...extra};
 const controller=new ProjectController(deck,compiled,{onError:error=>errors.push(error),nodeEntryEffects:effects,...options});
 return {deck,controller,errors};
}

test('arrival overrides reveal Shoot from earlier linear playback and leave speculative previews side-effect free',()=>{
 const shoot={id:'shoot',kind:'action',name:'Shoot',resolution:'direct',contextItemId:'lockpick'};
 const nodes=[linear('before','fork',[story('before-card',{effects:[add(4)]})]),{id:'fork',type:'fork',introEnabled:false,choices:[shoot],connections:{shoot:null}}];
 const effects={fork:[{op:'addItem',key:'lockpick'},add(2)]};
 const s=run(nodes,effects);
 assert.equal(s.controller.state.variables.count,0);assert.deepEqual(s.controller.state.collectedItems,[]);
 assert.equal(s.deck.content.nextDeckPreview.content.actions[0].id,'shoot');
 assert.equal(s.deck.content.nextDeckPreview.content.actions[0].disabled,false);
 for(let i=0;i<3;i++){s.controller.content();s.controller.departureBlocked(s.controller.card());}
 assert.equal(s.controller.state.variables.count,0);assert.deepEqual(s.controller.state.collectedItems,[]);
 s.deck.accept();assert.equal(s.controller.state.activeNodeId,'fork');assert.equal(s.controller.state.variables.count,6);
 assert.equal(s.controller.state.collectedItems[0].definitionId,'lockpick');assert.equal(s.deck.content.actions[0].id,'shoot');
 assert.deepEqual(s.errors,[]);s.controller.destroy();
 const direct=run(nodes,effects,{}, {startNode:'fork'});
 assert.equal(direct.controller.state.variables.count,2);assert.equal(direct.controller.state.collectedItems.length,1);
 assert.equal(direct.deck.content.actions[0].id,'shoot');direct.controller.destroy();
});

test('effects run once per node entry, never per card or render, and run again on revisits',()=>{
 const s=run([linear('a','b',[story('one'),story('two')]),linear('b','a')],{a:[add(1)],b:[add(10)]});
 assert.equal(s.controller.state.variables.count,1);
 s.controller.show();s.deck.accept();assert.equal(s.controller.state.variables.count,1);
 s.deck.accept();assert.equal(s.controller.state.variables.count,11);
 s.deck.accept();assert.equal(s.controller.state.variables.count,12);
 assert.equal(s.controller.state.cardId,'one');s.controller.destroy();
});

test('transparent entry overrides precede card conditions and Random routing and persist through completion',()=>{
 const nodes=[linear('start','hidden'),linear('hidden','random',[story('hidden-card',{conditions:requiresFlag(true)})]),
  {id:'random',type:'random',routes:[{id:'route',weight:1,conditions:requiresFlag(true),target:'end'}],fallback:false},
  linear('end',null,[story('end-card',{conditions:requiresFlag(false)})])];
 let draws=0;
 const s=run(nodes,{hidden:[add(2)],random:[flag(true),add(3)],end:[add(4)]},{rng:()=>{draws++;return 0;}});
 assert.equal(draws,0);assert.equal(s.deck.content.advanceDisabled,false);assert.equal(s.controller.state.variables.count,0);
 s.deck.accept();assert.equal(s.controller.state.completed,true);assert.equal(s.controller.state.variables.count,9);
 assert.equal(s.controller.state.variables.flag,true);assert.equal(draws,1);assert.deepEqual(s.errors,[]);s.controller.destroy();
});

test('failed arrival rolls back source effects and preceding transparent entry effects',()=>{
 const nodes=[linear('start','hidden',[story('start-card',{effects:[add(5)]})]),linear('hidden','bad',[]),linear('bad',null)];
 const s=run(nodes,{hidden:[add(3)],bad:[add(2),{op:'set',key:'missing',value:1}]});
 s.deck.accept();assert.equal(s.controller.state.activeNodeId,'start');assert.equal(s.controller.state.variables.count,0);
 assert.deepEqual(s.controller.state.collectedItems,[]);assert.match(s.errors[0].message,/Unknown variable/);s.controller.destroy();
});

test('reconverging Random preflight distinguishes different incoming override states',()=>{
 const nodes=[linear('start','random'),{id:'random',type:'random',routes:[{id:'good',weight:1,target:'good'},{id:'bad',weight:1,target:'bad'}]},
  linear('good','join',[]),linear('bad','join',[]),linear('join',false,[story('shown',{conditions:requiresFlag(false)})])];
 const s=run(nodes,{good:[flag(false)],bad:[flag(true)]});
 assert.equal(s.deck.content.advanceDisabled,true);assert.equal(s.controller.state.variables.flag,false);assert.deepEqual(s.errors,[]);s.controller.destroy();
});

test('Random preflight sibling paths do not inherit one another’s entry effects',()=>{
 const nodes=[linear('start','random'),{id:'random',type:'random',routes:[{id:'one',weight:1,target:'one'},{id:'two',weight:1,target:'two'}]},
  linear('one',null),linear('two',false,[story('two-card',{conditions:requiresFlag(true)})])];
 const s=run(nodes,{one:[flag(true)]});
 assert.equal(s.deck.content.advanceDisabled,true);assert.equal(s.controller.state.variables.flag,false);s.controller.destroy();
});

test('staged collection renders arrival effects and commits them once after departure',()=>{
 const item={...lockpick,id:'pickup'},choice={id:'shoot',kind:'action',resolution:'direct',contextItemId:'lockpick'};
 const nodes=[{id:'items',type:'container',introEnabled:false,items:[item],connections:{next:'fork'}},
  {id:'fork',type:'fork',introEnabled:false,choices:[choice],connections:{shoot:null}}];
 const s=run(nodes,{fork:[add(2),{op:'removeItem',key:'lockpick'}]});
 s.deck.take();assert.equal(s.controller.state.variables.count,0);assert.equal(s.deck.pending.actions[0].id,'unavailable');
 s.deck.finish();assert.equal(s.controller.state.activeNodeId,'fork');assert.equal(s.controller.state.variables.count,2);
 assert.deepEqual(s.controller.state.collectedItems,[]);s.controller.show();assert.equal(s.controller.state.variables.count,2);s.controller.destroy();
});

test('restart applies snapshotted entry effects once over initial state',()=>{
 const effects={a:[add(2)]};const s=run([linear('a',null)],effects,{initialState:{variables:{count:5}}});
 assert.equal(s.controller.state.variables.count,7);effects.a[0].value=100;
 s.deck.accept();s.controller.restart();assert.equal(s.controller.state.variables.count,7);assert.deepEqual(s.errors,[]);s.controller.destroy();
});

test('removing an absent override item is harmless',()=>{
 const s=run([linear('a','a')],{a:[{op:'removeItem',key:'lockpick'},add(1)]});
 s.deck.accept();assert.equal(s.controller.state.variables.count,2);assert.deepEqual(s.errors,[]);s.controller.destroy();
});

test('prototype node IDs remain usable without configured entry effects',()=>{
 const s=run([linear('constructor',null)]);assert.equal(s.controller.state.activeNodeId,'constructor');assert.deepEqual(s.errors,[]);s.controller.destroy();
});

test('failed arrival after a paid dice check refunds costs and preserves trigger uses',async()=>{
 const action={id:'shoot',kind:'action',resolution:'check',contextItemId:'lockpick',
  check:{pool:[{sides:6,count:1}],target:1},costs:[{source:'variable',key:'count',amount:2}],effects:[add(1)]};
 const nodes=[{id:'fork',type:'fork',introEnabled:false,choices:[action],connections:{'shoot:success':'bad','shoot:failure':'bad'}},linear('bad',null)];
 let resolveRoll;
 const s=run(nodes,{bad:[add(3),{op:'set',key:'missing',value:1}]},{
  initialState:{variables:{count:10},inventory:[{...lockpick,remainingTriggers:2}]},rollCheck:()=>new Promise(resolve=>{resolveRoll=resolve;})});
 const inventory=structuredClone(s.controller.state.collectedItems);
 const pending=s.controller.runCheck(action);
 assert.equal(s.controller.state.variables.count,8);assert.equal(s.controller.state.checking,true);
 resolveRoll([6]);await pending;
 assert.equal(s.controller.state.variables.count,10);assert.equal(s.controller.state.activeNodeId,'fork');
 assert.deepEqual(s.controller.state.collectedItems,inventory);assert.equal(s.controller.state.checking,false);
 assert.match(s.errors[0].message,/Unknown variable/);s.controller.destroy();
});

test('restart during a staged arrival discards its effects and ignores the late transition',()=>{
 const nodes=[{id:'items',type:'container',introEnabled:false,items:[{...lockpick,id:'pickup'}],connections:{next:'after'}},linear('after',null)];
 const s=run(nodes,{after:[add(2)]});const oldContent=s.deck.content.id;
 s.deck.take();assert.equal(s.deck.pending.actions[0].id,'continue');assert.equal(s.controller.state.variables.count,0);
 s.controller.restart();s.deck.emit('transitioncomplete',{transition:'collect',contentId:oldContent});
 s.deck.emit('transitioncomplete',{transition:'commit',contentId:oldContent});
 assert.equal(s.controller.state.activeNodeId,'items');assert.equal(s.controller.state.variables.count,0);
 assert.deepEqual(s.controller.state.collectedItems,[]);assert.deepEqual(s.errors,[]);s.controller.destroy();
});
