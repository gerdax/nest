import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectController } from '../project/ProjectController.js';

class Deck extends EventTarget {
  reset(){this.busy=false;}
  replaceContent(content,options){this.content=content;this.options=options;}
  endContent(){this.ended=true;}
  emit(name,detail={}){const event=new Event(name);event.detail={contentId:this.content.id,...detail};this.dispatchEvent(event);}
}
const story=id=>({id,kind:'narrative',name:id,text:id});
const effect={op:'add',key:'energy',value:1};
const item={id:'apple',definitionId:'apple',kind:'item',name:'Apple'};
const box=extra=>({id:'box',type:'container',intro:{...story('intro'),effects:[effect]},items:[item],connections:{next:'after'},...extra});
const after={id:'after',type:'linear',cards:[story('after')],connections:{}};
function fixture(nodes){
  const deck=new Deck();const errors=[];
  const controller=new ProjectController(deck,{startNode:nodes[0].id,nodes,variables:[{id:'energy',type:'number',initial:0}],library:[]},{onError:error=>errors.push(error)});
  return {deck,controller,errors};
}

test('disabled intro opens eligible items directly and rejects reveal effects across refresh and restart',()=>{
  const {deck,controller,errors}=fixture([box({introEnabled:false}),after]);
  for(const refresh of [()=>{},()=>controller.show({restore:true}),()=>controller.restart()]){
    refresh();assert.equal(deck.options.presentation,'open');assert.deepEqual(deck.content.actions.map(action=>action.id),['apple']);
    deck.emit('reveal');deck.emit('transitioncomplete',{transition:'reveal'});
    assert.equal(controller.state.variables.energy,0);assert.equal(controller.pendingIntro,null);assert.equal(controller.state.activeNodeId,'box');
  }
  assert.deepEqual(errors,[]);controller.destroy();
});

for(const introEnabled of [undefined,true])test(`enabled intro retains reveal behavior, introEnabled=${introEnabled}`,()=>{
  const node=box(introEnabled===undefined?{}:{introEnabled});const {deck,controller}=fixture([node,after]);
  assert.equal(deck.options.presentation,'closed');assert.equal(controller.state.variables.energy,0);
  deck.emit('reveal');assert.equal(controller.state.variables.energy,1);assert.notEqual(controller.pendingIntro,null);
  deck.emit('transitioncomplete',{transition:'reveal'});assert.equal(deck.options.presentation,'open');
  deck.emit('reveal');assert.equal(controller.state.variables.energy,1);controller.destroy();
});

for(const items of [[],[{...item,conditions:[{source:'variable',key:'energy',op:'gte',value:1}]}]])test(`disabled intro exits without applying effects when ${items.length?'items are ineligible':'items are empty'}`,()=>{
  const {deck,controller,errors}=fixture([box({introEnabled:false,items}),after]);
  assert.equal(controller.state.activeNodeId,'after');assert.equal(controller.state.variables.energy,0);assert.equal(deck.content.text,'after');assert.deepEqual(errors,[]);controller.destroy();
});

test('disabled empty intro can exit to End and preview skips its effects',()=>{
  const terminal=fixture([box({introEnabled:false,items:[],connections:{next:null}})]);
  assert.equal(terminal.controller.state.completed,true);assert.equal(terminal.deck.ended,true);assert.equal(terminal.controller.state.variables.energy,0);terminal.controller.destroy();
  const {deck,controller}=fixture([{id:'start',type:'linear',cards:[story('start')],connections:{next:'box'}},box({introEnabled:false,items:[]}),after]);
  assert.equal(deck.content.nextDeckPreview.content.text,'after');assert.equal(controller.state.variables.energy,0);controller.destroy();
});

test('disabled intro preview presents items open and collection continues to the successor',()=>{
  const {deck,controller}=fixture([{id:'start',type:'linear',cards:[story('start')],connections:{next:'box'}},box({introEnabled:false}),after]);
  assert.equal(deck.content.nextDeckPreview.presentation,'open');assert.equal(controller.state.variables.energy,0);
  deck.emit('commit',{action:{id:'continue'}});assert.equal(deck.options.presentation,'open');
  deck.emit('collect',{action:{id:'apple'}});assert.equal(controller.state.collectedItems.length,0);
  deck.emit('transitioncomplete',{transition:'collect'});
  assert.equal(controller.state.activeNodeId,'after');assert.equal(controller.state.collectedItems[0].definitionId,'apple');assert.equal(controller.state.variables.energy,0);controller.destroy();
});

test('legacy container presentation and effects ignore the native intro toggle',()=>{
  for(const type of ['legacySequence','legacyPool']){
    const sequence={id:'legacy-box',type:'container',cards:[{...story('intro'),effects:[effect]}],items:[item],exits:['next']};
    const node=type==='legacySequence'?{id:'legacy',type,sequence,introEnabled:false,connections:{}}:{id:'legacy',type,sequences:[sequence],pool:[{sequenceId:sequence.id,weight:1}],count:1,introEnabled:false,connections:{}};
    const {deck,controller}=fixture([node]);assert.equal(deck.options.presentation,'closed');
    deck.emit('reveal');assert.equal(controller.state.variables.energy,0);assert.equal(controller.pendingIntro,null);controller.destroy();
  }
});
